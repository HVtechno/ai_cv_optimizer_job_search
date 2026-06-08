import json
import re
import math
from datetime import datetime, timedelta, timezone


# ── Existing helper (unchanged) ───────────────────────────────────────────────

def extract_json(text: str):
    try:
        return json.loads(text)
    except Exception:
        pass

    match = re.search(r"\{.*\}", text, re.DOTALL)

    if match:
        try:
            return json.loads(match.group())
        except Exception:
            return {}

    return {}


# ── Candidate name resolution ─────────────────────────────────────────────────
# NEW: single source of truth for the display/optimization name. Prefers the
# user-set candidate_name stored on the resume; falls back to deriving a name
# from the file name (the original behavior) when none is set.

def derive_name_from_filename(file_name: str | None) -> str:
    """Original filename-based derivation, kept identical to prior inline logic."""
    return (
        (file_name or "Candidate")
        .replace(".pdf", "").replace(".docx", "").replace("_", " ").strip()
    ) or "Candidate"


def resolve_candidate_name(resume: dict) -> str:
    """
    Return the best candidate display name for a resume document:
      1. The user-set `candidate_name` field, if present and non-empty.
      2. Otherwise, the name derived from the file name (legacy behavior).
    """
    if not isinstance(resume, dict):
        return "Candidate"
    explicit = (resume.get("candidate_name") or "").strip()
    if explicit:
        return explicit
    return derive_name_from_filename(resume.get("file_name"))


# ── NL city geocoding table (lat, lng) ────────────────────────────────────────
# No external API needed — covers all major Dutch cities your DB will have.

NL_CITY_COORDS = {
    "amsterdam":    (52.3676, 4.9041),
    "rotterdam":    (51.9244, 4.4777),
    "the hague":    (52.0705, 4.3007),
    "den haag":     (52.0705, 4.3007),
    "utrecht":      (52.0907, 5.1214),
    "eindhoven":    (51.4416, 5.4697),
    "groningen":    (53.2194, 6.5665),
    "tilburg":      (51.5555, 5.0913),
    "breda":        (51.5719, 4.7683),
    "nijmegen":     (51.8126, 5.8372),
    "leiden":       (52.1601, 4.4970),
    "haarlem":      (52.3874, 4.6462),
    "delft":        (52.0116, 4.3571),
    "almere":       (52.3508, 5.2647),
    "amersfoort":   (52.1561, 5.3878),
    "arnhem":       (51.9851, 5.8987),
    "dordrecht":    (51.8133, 4.6901),
    "enschede":     (52.2215, 6.8937),
    "maastricht":   (50.8514, 5.6910),
    "zoetermeer":   (52.0575, 4.4938),
    "zwolle":       (52.5168, 6.0830),
    "deventer":     (52.2550, 6.1552),
    "den bosch":    (51.6978, 5.3037),
    "'s-hertogenbosch": (51.6978, 5.3037),
    "helmond":      (51.4817, 5.6614),
    "venlo":        (51.3704, 6.1724),
    "leeuwarden":   (53.2014, 5.7999),
    "alkmaar":      (52.6324, 4.7534),
    "zaandam":      (52.4386, 4.8296),
}


def geocode_city(city: str):
    """Return (lat, lng) for a NL city name, or None if unknown."""
    return NL_CITY_COORDS.get(city.lower().strip())


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Great-circle distance in km between two lat/lng points."""
    R = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi  = math.radians(lat2 - lat1)
    dlam  = math.radians(lng2 - lng1)
    a = math.sin(dphi/2)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam/2)**2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def extract_city_coords_from_location(location_str: str):
    """
    Job location is stored as e.g. "Rotterdam, South Holland, Netherlands".
    Try to geocode the first token (city name).
    Returns (lat, lng) or None.
    """
    if not location_str:
        return None
    first_part = location_str.split(",")[0].strip()
    return geocode_city(first_part)


def _to_utc(value):
    """
    Coerce a Mongo date value into a timezone-AWARE UTC datetime.
    Handles both real datetime objects (BSON dates come back as datetime) and
    ISO strings. Returns None if it can't be parsed.

    Aware-vs-aware is the key fix: previously expireAt was made naive while the
    comparison `now` was aware, which raised TypeError and got swallowed —
    silently disabling the expiry filter entirely.
    """
    if value is None:
        return None
    # Already a datetime (most common — BSON date field)
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    # String form
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def filter_jobs(
    jobs: list,
    languages: list | None = None,
    expiry_days: int | None = None,
    location: str | None = None,
    radius_km: int | None = None,
    remote_only: bool = False,
) -> list:
    """
    Apply language, expiry, and location filters to a job list.
    """
    now = datetime.now(timezone.utc)
    origin_coords = geocode_city(location) if location else None
    filtered = []

    for job in jobs:
        # ── Language filter ──────────────────────────────────────────────────
        if languages:
            raw_lang = job.get("jobPostedLanguage") or job.get("language") or job.get("lang")
            if raw_lang is None:
                # Field missing in DB — don't filter out, treat as passing
                pass
            elif raw_lang.lower() not in [l.lower() for l in languages]:
                continue

        # ── Expiry filter ────────────────────────────────────────────────────
        if expiry_days is not None:
            expire_at = job.get("expireAt")
            if expire_at:
                try:
                    exp_dt = _to_utc(expire_at)
                    if exp_dt is not None:
                        cutoff = now + timedelta(days=expiry_days)
                        if exp_dt > cutoff:
                            continue          # expires too far in the future
                        if exp_dt < now:
                            continue          # already expired
                    # If we couldn't parse it, fall through and keep the job.
                except Exception:
                    pass                  # never drop a job due to a parse hiccup

        # ── Location filter ──────────────────────────────────────────────────
        job_location = job.get("location", "")

        if remote_only:
            if "remote" not in job_location.lower():
                continue

        elif origin_coords and radius_km:
            if "remote" in job_location.lower():
                # Remote jobs pass location filter always
                filtered.append(job)
                continue
            job_coords = extract_city_coords_from_location(job_location)
            if job_coords is None:
                # Unknown city — skip (can't verify distance)
                continue
            dist = haversine_km(origin_coords[0], origin_coords[1],
                                job_coords[0],   job_coords[1])
            if dist > radius_km:
                continue

        filtered.append(job)

    return filtered


# ── Result formatting ─────────────────────────────────────────────────────────

# Some scraped LinkedIn jobs carry a junk `title` that's actually a section header
# from the posting body ("Requirements:", "The role", "Welcome to Eficode!") rather
# than the real role name. `standardizedTitle` holds a clean normalised title but is
# blank on ~43% of rows. best_title() prefers a usable `title`, falls back to
# `standardizedTitle`, and only uses the raw title as a last resort — so the user
# never sees a section header as the job name when a better label exists.
_SECTION_TITLES = {
    "requirements", "the role", "responsibilities", "about us", "about the role",
    "overview", "your role", "what you will do", "the company", "welcome",
    "introduction", "job description", "the opportunity", "who we are",
}


def _looks_like_junk_title(t) -> bool:
    if not t or not str(t).strip():
        return True
    s = str(t).strip().lower().rstrip(":")
    if s in _SECTION_TITLES:
        return True
    if len(s) < 4:
        return True
    return False


def best_title(job: dict) -> str:
    """Pick the most presentable job title: clean title > standardizedTitle > company > raw."""
    title = job.get("title", "")
    if not _looks_like_junk_title(title):
        return str(title).strip()
    std = job.get("standardizedTitle")
    if std and str(std).strip():
        return str(std).strip()
    # Both title and standardizedTitle are unusable (e.g. a scraped "Requirements:"
    # row with no standardized title). Fall back to the company name so the user
    # sees something meaningful rather than a section header.
    company = job.get("companyName")
    if company and str(company).strip():
        return f"Role at {str(company).strip()}"
    return str(title).strip() if title else "Untitled role"


def format_date(val) -> str:
    if not val: return "N/A"
    try:
        return datetime.fromisoformat(str(val)).strftime("%d %b %Y")
    except Exception:
        return str(val)


def _job_language_label(job: dict) -> str:
    """
    Map the stored job language to the exact label the optimize dropdown uses
    ("English" / "Dutch"). Falls back to "English" when the field is missing or
    unrecognised — a safe default that matches the dropdown's baseline.
    """
    raw = (job.get("jobPostedLanguage") or job.get("language") or job.get("lang") or "")
    r = str(raw).strip().lower()
    if r in ("nl", "nld", "dut", "dutch", "nederlands"):
        return "Dutch"
    return "English"


def normalize_result(item: dict, index: int) -> dict:
    job = item.get("job", {})
    ats = item.get("ats", {})
    return {
        "id":                          job.get("job_id") or str(index),
        "title":                       best_title(job),
        "company":                     job.get("companyName", ""),
        "link":                        job.get("link", ""),
        "location":                    job.get("location", ""),
        "expiry":                      format_date(job.get("expireAt")),
        # Posted language of the JD, normalised to a UI label ("English"/"Dutch").
        # The optimize modal uses this to default the resume/cover/motivation
        # language to the job's own language (user can still override).
        "job_language":                _job_language_label(job),
        "match":                       ats.get("score", 0),
        "semantic_similarity":         ats.get("semantic_similarity", 0),
        "keyword_score":               ats.get("keyword_score", 0),
        "matched_keywords":            ats.get("matched_keywords", []),
        "missing_keywords":            ats.get("missing_keywords", []),
        "strong_skills":               ats.get("strong_skills", []),
        "weak_skills":                 ats.get("weak_skills", []),
        "missing_skills":              ats.get("missing_skills", []),
        "summary":                     ats.get("summary", ""),
        "interview_probability":       ats.get("interview_probability", "low"),
        "interview_probability_pct":   ats.get("interview_probability_pct", 0),
        "interview_probability_color": ats.get("interview_probability_color", "red"),
    }


def get_selected_job(job_match: dict, job_id: str):
    for result in job_match.get("results", []):
        jid = (
            result["job"].get("job_id") or
            result["job"].get("id") or
            result["job"].get("_id")
        )
        if str(jid) == str(job_id):
            return result
    return None