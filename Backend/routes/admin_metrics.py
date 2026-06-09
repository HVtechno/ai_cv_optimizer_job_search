"""
routes/admin_metrics.py — read-only ADMIN analytics for the dashboard.

Additive and side-effect free: every endpoint here only READS from MongoDB and
never mutates anything. It reuses the SAME admin gate as the manual-iDEAL admin
flow (require_admin -> ADMIN_EMAILS), and is mounted under the SAME /ideal prefix
in main.py, so there are no new CORS origins, no new auth, and no schema changes.

Endpoint
  GET /ideal/admin/metrics   -> ADMIN; one payload powering the whole metrics page

Why one endpoint instead of five:
  The metrics page wants ~6 numbers at once. Doing it in a single aggregation
  round-trip keeps the page snappy and avoids six parallel authed calls. If the
  page grows, split later — the frontend only reads named fields, so splitting
  is non-breaking.

Data sources (collections in the `linkedin_jobs` db; see db/mongodb.py)
  job_matches  -> rows your app writes per resume_id, with created_at/updated_at.
                  This is the signal you OWN for "jobs matched today". The raw
                  `jobs` collection is filled by an external crawler and has no
                  reliable import timestamp in this codebase, so we report what
                  we can actually attribute: matches your app produced today,
                  plus the raw jobs total for context.
  users        -> plan (basic|pro|enterprise), verified, created_at.
  resumes      -> uploaded_at, has_embedding.
  feedback     -> rating, comment, source, created_at.
  visits       -> presence sessions. NOTE: a 24h TTL index expires these, so
                  "visitors" here means the last 24h only (today), not history.
"""

from datetime import datetime, timezone, timedelta
import ipaddress

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query

from db.mongodb import MongoDB
# Reuse the EXACT admin gate from the manual-iDEAL flow — single source of truth
# for who is an admin (ADMIN_EMAILS). No second definition to drift out of sync.
from routes.ideal_billing import require_admin
# Plan helpers so management actions go through the canonical seams, never raw writes.
from core.plans import PLAN_BASIC, PLAN_PRO, PLAN_ENTERPRISE, VALID_PLANS, is_admin_user, _admin_emails
from core.manual_expiry import MANUAL_SOURCE_IDEAL

router = APIRouter()
db = MongoDB()

# IP→location cache collection. We reach it through the existing db.db handle so
# we DON'T modify db/mongodb.py. Each IP is resolved once via a free HTTP service
# and stored forever, so a 50-row visitor page never re-hammers the API.
_geo_cache = db.db["ip_geo"]
# Tiny in-process LRU-ish cache on top of the DB cache, so repeated rows within a
# single page render don't even hit Mongo. Bounded so it can't grow unbounded.
_geo_mem: dict = {}
_GEO_MEM_MAX = 2000


def _is_public_ip(ip: str) -> bool:
    """True only for routable public addresses — skip private/loopback/dev IPs."""
    try:
        addr = ipaddress.ip_address(ip)
        return not (addr.is_private or addr.is_loopback or addr.is_reserved
                    or addr.is_link_local or addr.is_unspecified)
    except ValueError:
        return False


def _geo_lookup(ip: str) -> dict | None:
    """
    Resolve one IP to a coarse {city, region, country, country_code} via a free
    no-key service, cached in Mongo + memory. Returns None for private/unknown
    IPs or on any failure (never raises into a response).
    """
    if not ip or ip == "unknown" or not _is_public_ip(ip):
        return None
    if ip in _geo_mem:
        return _geo_mem[ip]

    # DB cache hit?
    try:
        cached = _geo_cache.find_one({"_id": ip}, {"_id": 0, "geo": 1})
        if cached and "geo" in cached:
            if len(_geo_mem) < _GEO_MEM_MAX:
                _geo_mem[ip] = cached["geo"]
            return cached["geo"]
    except Exception as e:
        print(f"[admin_metrics] geo cache read failed for {ip}: {e}")

    # Miss -> look it up. ip-api.com: free, no key, ~45 req/min/IP of the caller.
    geo = None
    try:
        # `fields` trims the payload to just what we render.
        r = httpx.get(
            f"http://ip-api.com/json/{ip}",
            params={"fields": "status,country,countryCode,regionName,city"},
            timeout=3.0,
        )
        data = r.json()
        if data.get("status") == "success":
            geo = {
                "city": data.get("city") or "",
                "region": data.get("regionName") or "",
                "country": data.get("country") or "",
                "country_code": data.get("countryCode") or "",
            }
    except Exception as e:
        print(f"[admin_metrics] geo lookup failed for {ip}: {e}")

    # Cache the result (even a None, as an empty marker, so we don't retry dead IPs
    # on every page load — but only persist successful lookups to keep junk out).
    if geo is not None:
        try:
            _geo_cache.update_one(
                {"_id": ip},
                {"$set": {"geo": geo, "updated_at": _utc_now()}},
                upsert=True,
            )
        except Exception as e:
            print(f"[admin_metrics] geo cache write failed for {ip}: {e}")
        if len(_geo_mem) < _GEO_MEM_MAX:
            _geo_mem[ip] = geo
    return geo


def _geo_label(geo: dict | None) -> str:
    """Human 'City, Country' string for the table cell."""
    if not geo:
        return ""
    parts = [p for p in (geo.get("city"), geo.get("country")) if p]
    return ", ".join(parts)

# Fields we NEVER return to the client, even to an admin. The password hash has
# no business leaving the server, and _id is noise for the UI.
_USER_HIDE = {"_id": 0, "password": 0}
# Hard ceiling on page size so a bad query can't try to stream the whole DB.
_MAX_LIMIT = 200

# Whitelist of sortable fields per list. A sort key not in the set falls back to
# the list's default, so a malformed/injected ?sort= can't reach arbitrary fields.
_SORTABLE = {
    "users":       {"created_at", "email", "plan", "verified", "current_period_end", "resume_count"},
    "resumes":     {"uploaded_at", "file_name", "candidate_name", "user_id", "has_embedding"},
    "feedback":    {"created_at", "rating", "email", "source"},
    "job_matches": {"updated_at", "created_at", "user_id", "resume_id", "refresh_count"},
    "visits":      {"last_seen", "first_seen", "hits", "email", "ip"},
    "jobs":        {"postedAt", "expireAt", "title", "standardizedTitle", "companyName", "location", "jobPostedLanguage"},
}
_DEFAULT_SORT = {
    "users": "created_at", "resumes": "uploaded_at", "feedback": "created_at",
    "job_matches": "updated_at", "visits": "last_seen", "jobs": "postedAt",
}


def _sort_spec(collection: str, sort: str | None, order: str | None):
    """Resolve (field, direction) against the whitelist; bad input -> safe default."""
    allowed = _SORTABLE.get(collection, set())
    field = sort if (sort in allowed) else _DEFAULT_SORT.get(collection, "_id")
    direction = -1 if (str(order or "desc").lower() != "asc") else 1
    return field, direction


def _date_range(field: str, frm: str | None, to: str | None) -> dict:
    """
    Build a {field: {$gte, $lte}} clause from ISO date strings. Accepts plain
    dates (YYYY-MM-DD) or full ISO timestamps. Silently ignores unparseable input
    so a bad date in the URL never 500s the list.
    """
    clause: dict = {}
    for key, val in (("$gte", frm), ("$lte", to)):
        if not val:
            continue
        try:
            s = str(val).replace("Z", "+00:00")
            dt = datetime.fromisoformat(s)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            # A bare date as the upper bound should include the whole day.
            if key == "$lte" and len(str(val)) <= 10:
                dt = dt.replace(hour=23, minute=59, second=59, microsecond=999000)
            clause[key] = dt
        except (ValueError, TypeError):
            continue
    return {field: clause} if clause else {}


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _start_of_today_utc() -> datetime:
    n = _utc_now()
    return n.replace(hour=0, minute=0, second=0, microsecond=0)


def _safe_count(coll, query: dict) -> int:
    """count_documents that never raises into the response."""
    try:
        return coll.count_documents(query)
    except Exception as e:
        print(f"[admin_metrics] count failed on {getattr(coll, 'name', '?')}: {e}")
        return 0


def _ensure_admins_tagged() -> int:
    """
    Stamp plan="admin" on every configured admin account that doesn't already
    have it. Touches ONLY the `plan` field (nothing else on the document), and
    ONLY for emails in ADMIN_EMAILS. Idempotent and side-effect-light: it writes
    only when a value actually differs, so repeated calls are no-ops.

    Safe because "admin" is coerced back to "basic" by core.plans.normalize_plan
    wherever a real plan tier is needed (so /me, manual-expiry, etc. are
    unaffected), while feature limits come from effective_limits (already
    unlimited for admins). The stored value is purely a clearer DB record.
    Returns the number of accounts updated.
    """
    updated = 0
    try:
        for email in _admin_emails():
            res = db.users.update_one(
                {"email": email, "plan": {"$ne": "admin"}},
                {"$set": {"plan": "admin"}},
            )
            updated += res.modified_count
    except Exception as e:
        print(f"[admin_metrics] _ensure_admins_tagged failed: {e}")
    return updated


@router.post("/admin/tag-admins")
async def tag_admins(_: str = Depends(require_admin)):
    """Manually (re)stamp plan='admin' on all configured admin accounts."""
    return {"ok": True, "updated": _ensure_admins_tagged()}


@router.get("/admin/metrics")
async def admin_metrics(_: str = Depends(require_admin)):
    """
    One read-only payload for the admin metrics page. Every block is wrapped so a
    single slow/empty collection can't take the whole page down — missing data
    degrades to zeros rather than a 500.
    """
    # Opportunistically ensure admin accounts carry plan="admin" in the DB. This
    # is idempotent and only ever writes admin emails, so it's safe to run here.
    _ensure_admins_tagged()

    today_start = _start_of_today_utc()
    now = _utc_now()

    # ── Jobs matched today (the signal your app owns) ─────────────────────────
    # job_matches rows are upserted per resume_id with created_at / updated_at.
    # "matched today" = rows whose match run touched them since midnight UTC.
    jobs_total = _safe_count(db.jobs, {})
    job_matches_total = _safe_count(db.job_matches, {})
    job_matches_today = _safe_count(
        db.job_matches, {"updated_at": {"$gte": today_start}}
    )
    # How many individual job results were returned across today's match runs.
    matched_results_today = 0
    try:
        agg = list(
            db.job_matches.aggregate(
                [
                    {"$match": {"updated_at": {"$gte": today_start}}},
                    {
                        "$group": {
                            "_id": None,
                            "n": {"$sum": {"$size": {"$ifNull": ["$results", []]}}},
                        }
                    },
                ]
            )
        )
        matched_results_today = (agg[0]["n"] if agg else 0)
    except Exception as e:
        print(f"[admin_metrics] matched_results_today agg failed: {e}")

    # ── Users by plan + registrations ─────────────────────────────────────────
    # Admins are not customers: exclude their emails from the plan buckets so the
    # Free/Pro/Enterprise numbers reflect real users only. They're counted
    # separately as `admins`.
    admin_set = sorted(_admin_emails())
    not_admin = {"email": {"$nin": admin_set}} if admin_set else {}

    def _count_users(extra: dict) -> int:
        q = dict(extra)
        if admin_set:
            q["email"] = {"$nin": admin_set}
        return _safe_count(db.users, q)

    users_total = _count_users({})                       # excludes admins
    admins_count = _safe_count(db.users, {"email": {"$in": admin_set}}) if admin_set else 0
    users_verified = _count_users({"verified": True})
    # Plan field: legacy users may lack `plan`; treat missing/null as basic.
    free_users = _count_users(
        {"$or": [{"plan": "basic"}, {"plan": {"$exists": False}}, {"plan": None}]}
    )
    pro_users = _count_users({"plan": "pro"})
    enterprise_users = _count_users({"plan": "enterprise"})
    users_registered_today = _count_users({"created_at": {"$gte": today_start}})

    # Registrations per day for the last 14 days (UTC), for a small trend chart.
    registrations_by_day = []
    try:
        since = today_start - timedelta(days=13)
        rows = list(
            db.users.aggregate(
                [
                    {"$match": {"created_at": {"$gte": since}, **not_admin}},
                    {
                        "$group": {
                            "_id": {
                                "$dateToString": {
                                    "format": "%Y-%m-%d",
                                    "date": "$created_at",
                                    "timezone": "UTC",
                                }
                            },
                            "count": {"$sum": 1},
                        }
                    },
                    {"$sort": {"_id": 1}},
                ]
            )
        )
        counts = {r["_id"]: r["count"] for r in rows}
        # Emit a dense 14-day series (zero-fill missing days) so the chart is stable.
        for i in range(14):
            d = (since + timedelta(days=i)).strftime("%Y-%m-%d")
            registrations_by_day.append({"date": d, "count": counts.get(d, 0)})
    except Exception as e:
        print(f"[admin_metrics] registrations_by_day agg failed: {e}")

    # ── Resumes ───────────────────────────────────────────────────────────────
    resumes_total = _safe_count(db.resumes, {})
    resumes_embedded = _safe_count(db.resumes, {"has_embedding": True})
    # resume_embeddings is the cache keyed by content hash (deduped across users).
    resume_embeddings_cached = _safe_count(db.resume_embeddings, {})
    resumes_uploaded_today = _safe_count(
        db.resumes, {"uploaded_at": {"$gte": today_start}}
    )

    # ── Feedback ──────────────────────────────────────────────────────────────
    feedback_total = _safe_count(db.feedback, {})
    feedback_today = _safe_count(db.feedback, {"created_at": {"$gte": today_start}})
    feedback_avg_rating = None
    recent_feedback = []
    try:
        avg = list(
            db.feedback.aggregate(
                [{"$group": {"_id": None, "avg": {"$avg": "$rating"}, "n": {"$sum": 1}}}]
            )
        )
        if avg and avg[0].get("avg") is not None:
            feedback_avg_rating = round(float(avg[0]["avg"]), 2)
        recent = list(
            db.feedback.find(
                {}, {"_id": 0, "email": 1, "rating": 1, "comment": 1, "source": 1, "created_at": 1}
            )
            .sort("created_at", -1)
            .limit(8)
        )
        for r in recent:
            ca = r.get("created_at")
            r["created_at"] = ca.isoformat() if hasattr(ca, "isoformat") else ca
            # Light privacy: trim long comments for the dashboard preview.
            if isinstance(r.get("comment"), str) and len(r["comment"]) > 160:
                r["comment"] = r["comment"][:157] + "…"
        recent_feedback = recent
    except Exception as e:
        print(f"[admin_metrics] feedback agg failed: {e}")

    # ── Visitors (last 24h only — visits has a 24h TTL index) ─────────────────
    # We surface a couple of presence windows. "Active now" = last 5 min.
    visitors_active = {}
    visitors_today = {}
    try:
        visitors_active = db.count_active_visitors(window_minutes=5)
    except Exception as e:
        print(f"[admin_metrics] active visitors failed: {e}")
    try:
        # Everything still in the collection is within the last 24h (TTL),
        # so this is effectively "visitors today (rolling 24h)".
        cutoff = now - timedelta(hours=24)
        match = {"last_seen": {"$gte": cutoff}}
        visitors_today = {
            "sessions": _safe_count(db.visits, match),
            "unique_ips": len(db.visits.distinct("ip", match)),
            "logged_in_users": len(
                db.visits.distinct("email", {**match, "email": {"$ne": None}})
            ),
            "window_hours": 24,
        }
    except Exception as e:
        print(f"[admin_metrics] visitors today failed: {e}")

    return {
        "generated_at": now.isoformat(),
        "jobs": {
            "raw_jobs_total": jobs_total,            # crawler-owned pool (context)
            "matches_total": job_matches_total,      # resumes that have a match doc
            "matches_today": job_matches_today,      # match docs touched since midnight
            "matched_results_today": matched_results_today,  # job rows returned today
        },
        "users": {
            "total": users_total,
            "admins": admins_count,
            "verified": users_verified,
            "free": free_users,
            "pro": pro_users,
            "enterprise": enterprise_users,
            "registered_today": users_registered_today,
            "registrations_by_day": registrations_by_day,
        },
        "resumes": {
            "total": resumes_total,
            "embedded": resumes_embedded,
            "embeddings_cached": resume_embeddings_cached,
            "uploaded_today": resumes_uploaded_today,
        },
        "feedback": {
            "total": feedback_total,
            "today": feedback_today,
            "avg_rating": feedback_avg_rating,
            "recent": recent_feedback,
        },
        "visitors": {
            "active_now": visitors_active,
            "today": visitors_today,
        },
    }


# ════════════════════════════════════════════════════════════════════════════
# DRILL-DOWN LISTS  (read-only)
# Each clickable stat on the metrics page maps to one list endpoint below. All
# are paginated (skip/limit) and projection-filtered so the password hash never
# leaves the server. None of these mutate anything.
# ════════════════════════════════════════════════════════════════════════════


def _iso_doc(d: dict, *date_fields: str) -> dict:
    """Stringify datetime fields in-place for JSON, leaving everything else."""
    for f in date_fields:
        v = d.get(f)
        if hasattr(v, "isoformat"):
            d[f] = v.isoformat()
    return d


def _paginate(skip: int, limit: int) -> tuple[int, int]:
    skip = max(0, int(skip or 0))
    limit = max(1, min(_MAX_LIMIT, int(limit or 50)))
    return skip, limit


# ── Users ─────────────────────────────────────────────────────────────────────

@router.get("/admin/users")
async def admin_users(
    _: str = Depends(require_admin),
    plan: str | None = Query(None, description="basic | pro | enterprise | (omit for all)"),
    segment: str | None = Query(None, description="verified | unverified | registered_today"),
    search: str | None = Query(None, description="email substring (case-insensitive)"),
    sort: str | None = Query(None, description="created_at | email | plan | verified | current_period_end"),
    order: str | None = Query("desc", description="asc | desc"),
    created_from: str | None = Query(None, description="ISO date lower bound on created_at"),
    created_to: str | None = Query(None, description="ISO date upper bound on created_at"),
    skip: int = 0,
    limit: int = 50,
):
    """
    List users with full management detail (password hash excluded).

    Click "Free"  -> ?plan=basic
    Click "Pro"   -> ?plan=pro
    Click "Enterprise" -> ?plan=enterprise
    Click "Verified"/"Total" -> ?segment=verified  (or no filter)

    Supports server-side search (email), sort, and a created_at date range so
    every control acts on the FULL dataset, not just the loaded page.
    """
    skip, limit = _paginate(skip, limit)
    query: dict = {}

    if plan:
        p = plan.strip().lower()
        if p == PLAN_BASIC:
            # Legacy users without a plan field read as basic, so include them.
            query["$or"] = [{"plan": PLAN_BASIC}, {"plan": {"$exists": False}}, {"plan": None}]
        elif p in VALID_PLANS:
            query["plan"] = p
        else:
            raise HTTPException(status_code=400, detail="Unknown plan filter")

    if segment == "verified":
        query["verified"] = True
    elif segment == "unverified":
        query["verified"] = {"$ne": True}
    elif segment == "registered_today":
        query["created_at"] = {"$gte": _start_of_today_utc()}

    if search:
        # Escape regex metacharacters so a search like "a.b" is literal.
        import re
        safe = re.escape(search.strip())
        query["email"] = {"$regex": safe, "$options": "i"}

    # Date range on created_at (merges with a possible registered_today bound).
    rng = _date_range("created_at", created_from, created_to)
    if rng:
        query.setdefault("created_at", {}).update(rng["created_at"])

    field, direction = _sort_spec("users", sort, order)
    total = _safe_count(db.users, query)

    # `resume_count` is computed per row (not stored), so it can't be sorted in
    # Mongo. When asked, we sort the current page in Python — accurate for the
    # page, and noted as such so nobody expects global ordering on a derived field.
    sort_in_python = field == "resume_count"
    cursor = db.users.find(query, _USER_HIDE)
    if not sort_in_python:
        cursor = cursor.sort(field, direction)
    cursor = cursor.skip(skip).limit(limit)

    users = []
    for u in cursor:
        try:
            u["resume_count"] = db.resumes.count_documents({"user_id": u.get("email")})
        except Exception:
            u["resume_count"] = None
        u["is_admin"] = is_admin_user(u)   # so the UI can show "Admin" not a plan
        _iso_doc(
            u,
            "created_at", "current_period_end", "verified_at",
            "subscription_updated_at", "last_feedback_prompt", "manual_expired_at",
        )
        users.append(u)

    if sort_in_python:
        users.sort(key=lambda x: (x.get("resume_count") or 0), reverse=(direction == -1))

    return {"total": total, "skip": skip, "limit": limit, "sort": field,
            "order": "asc" if direction == 1 else "desc", "users": users}


@router.get("/admin/users/detail")
async def admin_user_detail(
    _: str = Depends(require_admin),
    email: str = Query(..., description="exact user email"),
):
    """Full record for one user, plus their resumes and recent feedback."""
    email = email.strip().lower()
    user = db.users.find_one({"email": email}, _USER_HIDE)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user["is_admin"] = is_admin_user(user)   # UI shows "Admin" instead of a plan
    _iso_doc(
        user,
        "created_at", "current_period_end", "verified_at",
        "subscription_updated_at", "last_feedback_prompt", "manual_expired_at",
    )

    resumes = []
    try:
        for r in db.resumes.find(
            {"user_id": email},
            {"_id": 0, "resume_id": 1, "file_name": 1, "candidate_name": 1,
             "uploaded_at": 1, "has_embedding": 1},
        ).sort("uploaded_at", -1):
            resumes.append(_iso_doc(r, "uploaded_at"))
    except Exception as e:
        print(f"[admin_metrics] user resumes failed: {e}")

    feedback = []
    try:
        for f in db.feedback.find(
            {"email": email},
            {"_id": 0, "rating": 1, "comment": 1, "source": 1, "created_at": 1},
        ).sort("created_at", -1).limit(10):
            feedback.append(_iso_doc(f, "created_at"))
    except Exception as e:
        print(f"[admin_metrics] user feedback failed: {e}")

    # The open Pro request (if any) so you can act on it from the detail view.
    open_request = None
    try:
        req = db.get_open_pro_request(email)
        if req:
            open_request = {
                "request_id": req.get("request_id"),
                "status": req.get("status"),
                "amount_eur": req.get("amount_eur"),
                "payment_url": req.get("payment_url"),
            }
    except Exception as e:
        print(f"[admin_metrics] open request lookup failed: {e}")

    return {
        "user": user,
        "resumes": resumes,
        "feedback": feedback,
        "open_pro_request": open_request,
    }


# ── Resumes ─────────────────────────────────────────────────────────────────

@router.get("/admin/resumes")
async def admin_resumes(
    _: str = Depends(require_admin),
    segment: str | None = Query(None, description="embedded | uploaded_today"),
    search: str | None = Query(None, description="match user_id / file_name / candidate_name"),
    sort: str | None = Query(None, description="uploaded_at | file_name | candidate_name | user_id"),
    order: str | None = Query("desc", description="asc | desc"),
    created_from: str | None = Query(None, description="ISO lower bound on uploaded_at"),
    created_to: str | None = Query(None, description="ISO upper bound on uploaded_at"),
    skip: int = 0,
    limit: int = 50,
):
    """List resumes (metadata only — no resume text/binary)."""
    skip, limit = _paginate(skip, limit)
    query: dict = {}
    if segment == "embedded":
        query["has_embedding"] = True
    elif segment == "uploaded_today":
        query["uploaded_at"] = {"$gte": _start_of_today_utc()}

    if search:
        import re
        safe = re.escape(search.strip())
        rx = {"$regex": safe, "$options": "i"}
        query["$or"] = [{"user_id": rx}, {"file_name": rx}, {"candidate_name": rx}]

    rng = _date_range("uploaded_at", created_from, created_to)
    if rng:
        query.setdefault("uploaded_at", {}).update(rng["uploaded_at"])

    field, direction = _sort_spec("resumes", sort, order)
    total = _safe_count(db.resumes, query)
    rows = []
    for r in (
        db.resumes.find(
            query,
            {"_id": 0, "resume_id": 1, "user_id": 1, "file_name": 1,
             "candidate_name": 1, "uploaded_at": 1, "has_embedding": 1},
        )
        .sort(field, direction)
        .skip(skip)
        .limit(limit)
    ):
        rows.append(_iso_doc(r, "uploaded_at"))
    return {"total": total, "skip": skip, "limit": limit, "sort": field,
            "order": "asc" if direction == 1 else "desc", "resumes": rows}


# ── Feedback ──────────────────────────────────────────────────────────────────

@router.get("/admin/feedback")
async def admin_feedback(
    _: str = Depends(require_admin),
    search: str | None = Query(None, description="match email / comment"),
    min_rating: int | None = Query(None, ge=1, le=5, description="only ratings >= this"),
    sort: str | None = Query(None, description="created_at | rating | email | source"),
    order: str | None = Query("desc", description="asc | desc"),
    created_from: str | None = Query(None, description="ISO lower bound on created_at"),
    created_to: str | None = Query(None, description="ISO upper bound on created_at"),
    skip: int = 0,
    limit: int = 50,
):
    """Full feedback list with search, rating filter, sort, and date range."""
    skip, limit = _paginate(skip, limit)
    query: dict = {}
    if search:
        import re
        safe = re.escape(search.strip())
        rx = {"$regex": safe, "$options": "i"}
        query["$or"] = [{"email": rx}, {"comment": rx}]
    if min_rating is not None:
        query["rating"] = {"$gte": int(min_rating)}
    rng = _date_range("created_at", created_from, created_to)
    if rng:
        query["created_at"] = rng["created_at"]

    field, direction = _sort_spec("feedback", sort, order)
    total = _safe_count(db.feedback, query)
    rows = []
    for f in (
        db.feedback.find(
            query, {"_id": 0, "email": 1, "rating": 1, "comment": 1, "source": 1, "created_at": 1}
        )
        .sort(field, direction)
        .skip(skip)
        .limit(limit)
    ):
        rows.append(_iso_doc(f, "created_at"))
    return {"total": total, "skip": skip, "limit": limit, "sort": field,
            "order": "asc" if direction == 1 else "desc", "feedback": rows}


# ── Job matches ───────────────────────────────────────────────────────────────

@router.get("/admin/job-matches")
async def admin_job_matches(
    _: str = Depends(require_admin),
    segment: str | None = Query(None, description="today | (omit for all)"),
    search: str | None = Query(None, description="match user_id / resume_id"),
    sort: str | None = Query(None, description="updated_at | created_at | user_id | refresh_count"),
    order: str | None = Query("desc", description="asc | desc"),
    skip: int = 0,
    limit: int = 50,
):
    """
    List match runs (one row per resume_id). We return counts and timestamps,
    not the full results array, to keep the payload light.
    """
    skip, limit = _paginate(skip, limit)
    query: dict = {}
    if segment == "today":
        query["updated_at"] = {"$gte": _start_of_today_utc()}
    if search:
        import re
        safe = re.escape(search.strip())
        rx = {"$regex": safe, "$options": "i"}
        query["$or"] = [{"user_id": rx}, {"resume_id": rx}]

    field, direction = _sort_spec("job_matches", sort, order)
    total = _safe_count(db.job_matches, query)
    rows = []
    try:
        cursor = (
            db.job_matches.find(
                query,
                {"_id": 0, "resume_id": 1, "user_id": 1, "results": 1,
                 "refresh_count": 1, "created_at": 1, "updated_at": 1},
            )
            .sort(field, direction)
            .skip(skip)
            .limit(limit)
        )
        for m in cursor:
            results = m.pop("results", []) or []
            m["match_count"] = len(results)
            rows.append(_iso_doc(m, "created_at", "updated_at"))
    except Exception as e:
        print(f"[admin_metrics] job matches list failed: {e}")
    return {"total": total, "skip": skip, "limit": limit, "sort": field,
            "order": "asc" if direction == 1 else "desc", "matches": rows}


# ── Jobs pool (crawler-fed `jobs` collection) ─────────────────────────────────

# Light projection: everything the table needs, but NEVER embedding_chunks (a
# 3072-dim vector per chunk — huge and useless to the UI).
_JOB_FIELDS = {
    "_id": 0, "job_id": 1, "title": 1, "standardizedTitle": 1, "companyName": 1,
    "location": 1, "jobPostedLanguage": 1, "postedAt": 1, "expireAt": 1, "link": 1,
}


@router.get("/admin/jobs")
async def admin_jobs(
    _: str = Depends(require_admin),
    search: str | None = Query(None, description="match title / standardizedTitle / companyName / location"),
    language: str | None = Query(None, description="exact jobPostedLanguage (e.g. en, nl)"),
    expiry: str | None = Query(None, description="active | expired | (omit for all)"),
    sort: str | None = Query(None, description="postedAt | expireAt | title | companyName | location"),
    order: str | None = Query("desc", description="asc | desc"),
    posted_from: str | None = Query(None, description="ISO lower bound on postedAt"),
    posted_to: str | None = Query(None, description="ISO upper bound on postedAt"),
    skip: int = 0,
    limit: int = 50,
):
    """
    Drill-down for the 'Jobs in pool' stat: the raw crawler-fed `jobs` collection.
    Filters (search/language/expiry/posted-range), sort, and pagination all run
    server-side so they act on the FULL pool, not just the visible page. The CSV
    export on the client pulls every matching row via the same endpoint.
    """
    skip, limit = _paginate(skip, limit)
    query: dict = {}

    if search:
        import re
        safe = re.escape(search.strip())
        rx = {"$regex": safe, "$options": "i"}
        query["$or"] = [
            {"title": rx}, {"standardizedTitle": rx},
            {"companyName": rx}, {"location": rx},
        ]
    if language:
        query["jobPostedLanguage"] = {"$regex": f"^{language.strip()}$", "$options": "i"}

    # Expiry filter. expireAt may be a BSON date or ISO string; for active/expired
    # we compare against "now" — works for date types. (String dates still sort and
    # display fine; the active/expired split is best-effort on those.)
    if expiry == "active":
        query["expireAt"] = {"$gte": _utc_now()}
    elif expiry == "expired":
        query["expireAt"] = {"$lt": _utc_now()}

    rng = _date_range("postedAt", posted_from, posted_to)
    if rng:
        query.setdefault("postedAt", {}).update(rng["postedAt"])

    field, direction = _sort_spec("jobs", sort, order)
    total = _safe_count(db.jobs, query)
    rows = []
    try:
        for j in (
            db.jobs.find(query, _JOB_FIELDS)
            .sort(field, direction)
            .skip(skip)
            .limit(limit)
        ):
            rows.append(_iso_doc(j, "postedAt", "expireAt"))
    except Exception as e:
        print(f"[admin_metrics] jobs list failed: {e}")
    return {"total": total, "skip": skip, "limit": limit, "sort": field,
            "order": "asc" if direction == 1 else "desc", "jobs": rows}


# ── Visitors ──────────────────────────────────────────────────────────────────

@router.get("/admin/visitors")
async def admin_visitors(
    _: str = Depends(require_admin),
    window_minutes: int = Query(1440, ge=1, le=1440, description="lookback window (max 24h)"),
    search: str | None = Query(None, description="match email / ip / path"),
    sort: str | None = Query(None, description="last_seen | first_seen | hits | email | ip"),
    order: str | None = Query("desc", description="asc | desc"),
    skip: int = 0,
    limit: int = 50,
):
    """
    Active/recent visitor sessions. Bounded to 24h because the visits collection
    has a 24h TTL index — older sessions no longer exist.
    """
    skip, limit = _paginate(skip, limit)
    cutoff = _utc_now() - timedelta(minutes=window_minutes)
    query: dict = {"last_seen": {"$gte": cutoff}}
    if search:
        import re
        safe = re.escape(search.strip())
        rx = {"$regex": safe, "$options": "i"}
        query["$or"] = [{"email": rx}, {"ip": rx}, {"path": rx}]

    field, direction = _sort_spec("visits", sort, order)
    total = _safe_count(db.visits, query)
    rows = []
    try:
        for v in (
            db.visits.find(
                query,
                {"_id": 0, "vid": 1, "ip": 1, "email": 1, "path": 1,
                 "user_agent": 1, "hits": 1, "first_seen": 1, "last_seen": 1},
            )
            .sort(field, direction)
            .skip(skip)
            .limit(limit)
        ):
            _iso_doc(v, "first_seen", "last_seen")
            # Resolve location from IP (cached). Adds a `location` string +
            # structured `geo` object. Private/dev IPs resolve to "" cleanly.
            geo = _geo_lookup(v.get("ip", ""))
            v["geo"] = geo or {}
            v["location"] = _geo_label(geo)
            rows.append(v)
    except Exception as e:
        print(f"[admin_metrics] visitors list failed: {e}")
    return {"total": total, "skip": skip, "limit": limit, "sort": field,
            "order": "asc" if direction == 1 else "desc", "visitors": rows}


# ════════════════════════════════════════════════════════════════════════════
# MANAGEMENT ACTIONS  (write — narrow + reversible)
# These reuse the SAME canonical methods your Stripe/iDEAL flows use, so plan
# state stays consistent. Intentionally NO account-deletion endpoint here:
# db.delete_account permanently wipes a user's resumes/embeddings/matches and is
# unrecoverable, so it's left out of the panel by design. Ask if you want it.
# ════════════════════════════════════════════════════════════════════════════

@router.post("/admin/users/set-plan")
async def admin_set_plan(payload: dict, admin: str = Depends(require_admin)):
    """
    Change a user's plan from the panel. Goes through update_user_subscription —
    the exact same seam the Stripe webhook and iDEAL confirm use.

    Body: {"email": "...", "plan": "basic|pro|enterprise", "days": 30 (optional)}
      - days: for pro/enterprise, sets current_period_end now+days and tags it as
        a manual grant so your existing lazy-expiry logic owns its lifetime.
        Omit for an open-ended grant (e.g. enterprise deals you manage by hand).
      - basic: clears the period end and the manual tag (a downgrade).
    """
    email = (payload or {}).get("email", "").strip().lower()
    plan = (payload or {}).get("plan", "").strip().lower()
    days = (payload or {}).get("days")

    if not email or plan not in VALID_PLANS:
        raise HTTPException(status_code=400, detail="email and a valid plan are required")
    if email in _admin_emails():
        raise HTTPException(status_code=400, detail="Admins are unlimited and not on a plan; nothing to change.")
    if not db.get_user(email):
        raise HTTPException(status_code=404, detail="User not found")

    period_end = None
    if plan != PLAN_BASIC and days:
        try:
            period_end = _utc_now() + timedelta(days=int(days))
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="days must be a number")

    db.update_user_subscription(
        email,
        plan=plan,
        subscription_status="active" if plan != PLAN_BASIC else "none",
        current_period_end=period_end,
    )
    # Tag/untag the manual source so expiry logic behaves correctly.
    if plan != PLAN_BASIC and period_end is not None:
        db.set_manual_plan_source(email, MANUAL_SOURCE_IDEAL)
    elif plan == PLAN_BASIC:
        db.set_manual_plan_source(email, None)

    updated = db.get_user(email) or {}
    return {
        "ok": True,
        "email": email,
        "plan": updated.get("plan"),
        "current_period_end": _iso_doc(dict(updated), "current_period_end").get("current_period_end"),
        "changed_by": admin,
    }