"""
routes/ideal_billing.py — MANUAL iDEAL Pro via request -> emailed link -> confirm.

Additive: Stripe (routes/billing.py) is untouched and ready for the day you
register a KvK. Both flows grant Pro through the SAME function
(db.update_user_subscription), so plan state is consistent either way.

Flow (no KvK, works with per-user Tikkie links)
-----------------------------------------------
  1. Logged-in user clicks "Request Pro" -> POST /ideal/request.
     A request row is created (status "requested"). Nothing else needed from
     them — we already know who they are from the JWT.
  2. You (admin) see it in the queue -> create a Tikkie link in your banking app
     -> paste it into POST /ideal/admin/send-link. We email the link to the user
     and mark the request "link_sent".
  3. User pays via the emailed iDEAL link.
  4. You confirm -> POST /ideal/admin/confirm -> grants 30 days of Pro and tags
     the grant as manual so it auto-expires (falls back to free) after 30 days.

No auto-renewal (that needs a real processor + KvK). After 30 days the user
requests again.

Endpoints
  POST /ideal/request            -> auth; create/return the caller's open request
  GET  /ideal/status             -> auth; caller's request + plan status
  GET  /ideal/admin/requests     -> ADMIN; open-request queue
  POST /ideal/admin/send-link    -> ADMIN; attach a Tikkie link + email it
  POST /ideal/admin/confirm      -> ADMIN; confirm payment, grant 30 days Pro

Admin gating
  ADMIN_EMAILS env var (comma-separated). Only those verified identities may hit
  /admin/*. No schema/role change.

Env vars (.env)
  IDEAL_PRICE_EUR=29                          # price for 30 days
  ADMIN_EMAILS=support@resuviq-ai.nl          # who can send links / confirm
"""

import os
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Depends, HTTPException
from dotenv import load_dotenv

from core.security import get_current_user, get_current_user_doc
from core.plans import PLAN_PRO, PLAN_BASIC
from core.manual_expiry import MANUAL_SOURCE_IDEAL
from core.email_service import send_payment_link_email, send_pro_activated_email
from db.mongodb import MongoDB

load_dotenv()

IDEAL_PRICE_EUR    = int(os.getenv("IDEAL_PRICE_EUR", "29"))
MANUAL_PERIOD_DAYS = 30   # one month of Pro per manual payment

router = APIRouter()
db     = MongoDB()


def _admin_emails() -> set:
    raw = os.getenv("ADMIN_EMAILS", "")
    return {e.strip().lower() for e in raw.split(",") if e.strip()}


def require_admin(user_id: str = Depends(get_current_user)) -> str:
    """Gate /admin/* to verified emails in ADMIN_EMAILS. user_id is from the JWT
    (never the body), so it can't be spoofed by a request payload."""
    if user_id.lower() not in _admin_emails():
        raise HTTPException(status_code=403, detail="Admin access required")
    return user_id


def _iso(v):
    return v.isoformat() if hasattr(v, "isoformat") else v


# ── User-facing ───────────────────────────────────────────────────────────────

@router.post("/request")
async def request_pro(user: dict = Depends(get_current_user_doc)):
    """
    Create (or return) the caller's open Pro request. Idempotent — clicking twice
    won't create duplicates. The admin will follow up with a payment link.
    """
    req = db.create_pro_request(user["email"], IDEAL_PRICE_EUR)
    return {
        "ok":          True,
        "request_id":  req["request_id"],
        "status":      req["status"],
        "amount_eur":  req["amount_eur"],
        "period_days": MANUAL_PERIOD_DAYS,
        "payment_url": req.get("payment_url"),
        "message": (
            "Thanks! We've received your Pro request. We'll email an iDEAL "
            f"payment link to {user['email']} shortly. Once you pay and we "
            f"confirm it, you'll get {MANUAL_PERIOD_DAYS} days of Pro."
        ),
    }


@router.get("/status")
async def ideal_status(user: dict = Depends(get_current_user_doc)):
    """
    The caller's current manual status: their plan, their open request (if any,
    including a payment link once you've sent one), and renewal date.
    get_current_user_doc already applies lazy expiry, so an elapsed manual grant
    reads as basic here.
    """
    req = db.get_open_pro_request(user["email"])
    return {
        "plan":               user.get("plan", PLAN_BASIC),
        "is_manual":          user.get("manual_plan_source") == MANUAL_SOURCE_IDEAL,
        "current_period_end": _iso(user.get("current_period_end")),
        "auto_renew":         False,
        "amount_eur":         IDEAL_PRICE_EUR,
        "period_days":        MANUAL_PERIOD_DAYS,
        "request": {
            "request_id":  req["request_id"],
            "status":      req["status"],                 # requested | link_sent
            "payment_url": req.get("payment_url"),        # set once you send a link
            "link_expires_at": _iso(req.get("payment_link_expires_at")),
        } if req else None,
    }


# ── Admin ─────────────────────────────────────────────────────────────────────

@router.get("/admin/requests")
async def admin_requests(_: str = Depends(require_admin)):
    """Open Pro requests (requested + link_sent), oldest first."""
    reqs = db.list_pro_requests()
    for r in reqs:
        r["created_at"]   = _iso(r.get("created_at"))
        r["link_sent_at"] = _iso(r.get("link_sent_at"))
        r["payment_link_expires_at"] = _iso(r.get("payment_link_expires_at"))
    return {"requests": reqs}


@router.post("/admin/send-link")
async def admin_send_link(payload: dict, admin: str = Depends(require_admin)):
    """
    Attach the Tikkie link you created to a request and EMAIL it to the user.

    Body: {"request_id": "req_...", "payment_url": "https://tikkie.me/..."}
    """
    request_id  = (payload or {}).get("request_id", "").strip()
    payment_url = (payload or {}).get("payment_url", "").strip()
    if not request_id or not payment_url:
        raise HTTPException(status_code=400, detail="request_id and payment_url are required")
    if not (payment_url.startswith("https://") or payment_url.startswith("http://")):
        raise HTTPException(status_code=400, detail="payment_url must be a valid URL")

    req = db.get_pro_request(request_id)
    if not req:
        raise HTTPException(status_code=404, detail="Unknown request")
    if req["status"] == "confirmed":
        raise HTTPException(status_code=409, detail="Request already confirmed")

    # Record the link + mark link_sent (sets a 14-day expiry).
    updated = db.attach_pro_request_link(request_id, payment_url)
    if not updated:
        raise HTTPException(status_code=409, detail="Could not update request (already confirmed or expired)")

    # Format the link-expiry date for the email + response.
    exp = updated.get("payment_link_expires_at")
    link_expires_human = exp.strftime("%d %b %Y") if hasattr(exp, "strftime") else None

    # Email it to the user. If mail fails we still kept the link on the request
    # (visible in-app via /ideal/status), so the user isn't stuck — but report it.
    emailed = False
    try:
        emailed = send_payment_link_email(
            req["email"], payment_url, req["amount_eur"], MANUAL_PERIOD_DAYS,
            link_expires=link_expires_human,
        )
    except Exception as e:
        print(f"[ideal] send_payment_link_email failed for {req['email']}: {e}")

    return {
        "ok":                 True,
        "request_id":         request_id,
        "email":              req["email"],
        "emailed":            emailed,
        "status":             "link_sent",
        "link_expires_at":    _iso(exp),
        "link_expires_human": link_expires_human,
    }


@router.post("/admin/confirm")
async def admin_confirm(payload: dict, admin: str = Depends(require_admin)):
    """
    Confirm a paid request and grant 30 days of Pro.

    Body: {"request_id": "req_..."}

    Grants via the SAME db.update_user_subscription used by Stripe, then tags the
    grant manual so the lazy expiry helper manages its 30-day lifetime.
    """
    request_id = (payload or {}).get("request_id", "").strip()
    if not request_id:
        raise HTTPException(status_code=400, detail="request_id is required")

    req = db.get_pro_request(request_id)
    if not req:
        raise HTTPException(status_code=404, detail="Unknown request")
    if req["status"] == "confirmed":
        raise HTTPException(status_code=409, detail="Request already confirmed")

    email      = req["email"]
    period_end = datetime.now(timezone.utc) + timedelta(days=MANUAL_PERIOD_DAYS)

    # 1) Grant Pro through the canonical seam (same as the Stripe webhook).
    db.update_user_subscription(
        email,
        plan=PLAN_PRO,
        subscription_status="active",
        current_period_end=period_end,
    )
    # 2) Tag as a MANUAL grant so expiry logic owns it (Stripe never does).
    db.set_manual_plan_source(email, MANUAL_SOURCE_IDEAL)
    # 3) Mark the request confirmed (audit trail).
    db.mark_pro_request_confirmed(request_id, confirmed_by=admin, period_end=period_end)

    # 4) Email the user that Pro is now active. Best-effort: if mail fails, the
    #    grant still stands — we just report it so you know.
    emailed = False
    try:
        emailed = send_pro_activated_email(
            email,
            period_days=MANUAL_PERIOD_DAYS,
            period_end=period_end.strftime("%d %b %Y"),
        )
    except Exception as e:
        print(f"[ideal] send_pro_activated_email failed for {email}: {e}")

    return {
        "ok":           True,
        "email":        email,
        "plan":         PLAN_PRO,
        "period_end":   period_end.isoformat(),
        "confirmed_by": admin,
        "emailed":      emailed,
    }
