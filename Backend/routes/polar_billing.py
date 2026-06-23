"""
routes/polar_billing.py — Polar subscription billing (NEW, additive).

Polar is a Merchant of Record: it is the legal seller, handles VAT/tax globally,
and requires no company registration on your side. This file is the Polar
equivalent of routes/billing.py (Stripe) and grants/revokes Pro through the
SAME seam every other flow uses: db.update_user_subscription(...). That means
plan state stays consistent no matter which processor granted it.

Endpoints
  GET  /polar/subscription       -> current user's plan/status (auth)
  POST /polar/create-checkout    -> start Pro checkout, returns {url} (auth)
  POST /polar/webhook            -> Polar -> us; flips plans. NO auth, signature-verified.

WHY THE WEBHOOK IS THE SOURCE OF TRUTH
--------------------------------------
Exactly like the Stripe code, we NEVER grant Pro based on the browser's
"success" redirect — that's just UX. Access is granted here, after Polar
confirms payment via a signed webhook. The signature proves the request really
came from Polar.

IDENTITY RESOLUTION
-------------------
When we create the checkout we stash the user's email in BOTH:
  - metadata.app_user_email   (our own marker), and
  - external_customer_id      (Polar's customer-linking field)
and we pass customer_email so Polar pre-fills it. On every webhook we resolve
the user by, in order: metadata.app_user_email -> the nested customer.email ->
the polar customer_id we previously stored. This mirrors the belt-and-suspenders
approach in the Stripe webhook.

RECURRING & HANDS-OFF
---------------------
Polar manages renewals automatically. We listen for:
  - subscription.created / .active / .updated -> grant/refresh Pro
  - subscription.canceled / .revoked          -> downgrade to basic
  - order.paid                                -> belt-and-suspenders grant
No admin approval, no manual links. Unlike the manual iDEAL flow, there is no
lazy-expiry to run: Polar tells us when a subscription ends.

Env vars: see core/polar_client.py.
"""

import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from polar_sdk.webhooks import (
    validate_event,
    WebhookVerificationError,
    WebhookUnknownTypeError,
)

from core.security import get_current_user_doc
from core.plans import PLAN_BASIC, PLAN_PRO
from core.polar_client import (
    get_polar,
    polar_configured,
    POLAR_PRODUCT_ID,
    POLAR_SUCCESS_URL,
    POLAR_WEBHOOK_SECRET,
)
from db.mongodb import MongoDB
# Reuse the EXACT admin gate used by the iDEAL/metrics admin routes — single
# source of truth for who is an admin (ADMIN_EMAILS via JWT). No new admin logic.
from routes.ideal_billing import require_admin

router = APIRouter()
db     = MongoDB()


# Marker stored on a Polar-granted user doc so we can tell Polar grants apart
# from Stripe ("stripe_*") and manual iDEAL ("manual_plan_source=ideal"). This
# is purely additive metadata; it never affects Stripe or iDEAL users.
POLAR_PLAN_SOURCE = "polar"


def _as_utc(value):
    """Coerce an ISO string / datetime to a tz-aware UTC datetime, or None."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except (ValueError, TypeError):
        return None


# ── Current subscription (auth) ───────────────────────────────────────────────

@router.get("/subscription")
async def get_polar_subscription(user: dict = Depends(get_current_user_doc)):
    """
    Lightweight view of the caller's plan for the Polar-powered UI. We read it
    straight from our own user doc (kept current by the webhook) rather than
    calling Polar on every page load — fast and avoids rate concerns.
    """
    period_end = user.get("current_period_end")
    return {
        "plan":               user.get("plan", PLAN_BASIC),
        "subscription_status": user.get("subscription_status", "none"),
        "current_period_end": period_end.isoformat() if hasattr(period_end, "isoformat") else period_end,
        "is_polar":           user.get("manual_plan_source") == POLAR_PLAN_SOURCE,
        "provider":           "polar",
    }


# ── Start checkout (auth) ─────────────────────────────────────────────────────

@router.post("/create-checkout")
async def create_polar_checkout(user: dict = Depends(get_current_user_doc)):
    """
    Create a Polar Checkout session for Pro and return {url}. The frontend
    redirects the browser there. Polar's hosted page offers cards, iDEAL, etc.

    We attach our identity so the webhook can always resolve the user:
      - customer_email           -> pre-fills + links the Polar customer
      - external_customer_id     -> stable link to our user (their email)
      - metadata.app_user_email  -> our own resolution marker
    """
    if not polar_configured():
        raise HTTPException(
            status_code=500,
            detail="Polar billing is not configured (missing access token or product id).",
        )

    email = user["email"]

    try:
        with get_polar() as polar:
            checkout = polar.checkouts.create(request={
                "products": [POLAR_PRODUCT_ID],
                "customer_email": email,
                "external_customer_id": email,
                "success_url": POLAR_SUCCESS_URL,
                "metadata": {"app_user_email": email},
            })
        url = getattr(checkout, "url", None)
        if not url:
            raise HTTPException(status_code=502, detail="Polar did not return a checkout URL")
        return {"url": url}
    except HTTPException:
        raise
    except Exception as e:
        # Surface a clean error to the UI; log the detail server-side.
        print(f"[polar] create-checkout failed for {email}: {type(e).__name__}: {e}")
        raise HTTPException(status_code=502, detail="Could not start Polar checkout. Please try again.")


# ── Webhook (NO auth — verified by Polar signature) ───────────────────────────

def _resolve_email(data) -> str | None:
    """
    Pull our user's email out of a webhook payload's data object. Order:
      1. metadata.app_user_email  (set by us at checkout)
      2. nested customer.email
      3. None (caller falls back to polar customer_id lookup)
    `data` is a pydantic model; use getattr defensively.
    """
    meta = getattr(data, "metadata", None) or {}
    try:
        if isinstance(meta, dict) and meta.get("app_user_email"):
            return meta["app_user_email"]
    except Exception:
        pass

    customer = getattr(data, "customer", None)
    if customer is not None:
        cem = getattr(customer, "email", None)
        if cem:
            return cem
    return None


def _grant_pro(email: str, data, customer_id: str | None):
    """Flip a user to Pro via the canonical seam + tag the grant as Polar."""
    period_end = _as_utc(getattr(data, "current_period_end", None))
    db.update_user_subscription(
        email,
        plan=PLAN_PRO,
        subscription_status="active",
        current_period_end=period_end,
    )
    db.set_manual_plan_source(email, POLAR_PLAN_SOURCE)
    if customer_id:
        db.set_polar_customer_id(email, customer_id)


def _downgrade(email: str):
    """Flip a user back to basic via the canonical seam."""
    db.update_user_subscription(
        email,
        plan=PLAN_BASIC,
        subscription_status="canceled",
    )
    db.set_manual_plan_source(email, None)


@router.post("/webhook")
async def polar_webhook(request: Request):
    """
    Polar -> us. The ONLY place Polar grants/revokes Pro. Signature-verified
    with the Standard Webhooks spec via the SDK's validate_event (it handles the
    base64-encoded secret for you — pass POLAR_WEBHOOK_SECRET as Polar gave it).
    """
    if not POLAR_WEBHOOK_SECRET:
        # Misconfigured — refuse rather than trust an unverifiable payload.
        raise HTTPException(status_code=500, detail="Polar webhook secret not configured")

    raw_body = await request.body()
    headers  = dict(request.headers)

    # 1) Verify signature. A bad signature means it didn't come from Polar.
    try:
        event = validate_event(raw_body, headers, POLAR_WEBHOOK_SECRET)
    except WebhookVerificationError:
        raise HTTPException(status_code=403, detail="Invalid Polar webhook signature")
    except WebhookUnknownTypeError:
        # Signature was valid but the event type is newer than this SDK knows.
        # Acknowledge so Polar doesn't retry; nothing for us to do.
        return {"received": True}

    # SDK payload models expose the discriminator as `.TYPE` (aliased to the
    # JSON key "type"). Read TYPE first, fall back to type for safety.
    etype = getattr(event, "TYPE", None) or getattr(event, "type", None)
    data  = getattr(event, "data", None)
    if data is None:
        return {"received": True}

    customer_id = getattr(data, "customer_id", None)

    # 2) Route by event type.
    # Grants: a new/active/updated subscription, or a paid order.
    if etype in ("subscription.created", "subscription.active", "subscription.updated", "order.paid"):
        # For subscription.updated, only keep Pro while status is active/trialing.
        status = getattr(data, "status", None)
        if etype == "subscription.updated" and status not in ("active", "trialing", None):
            email = _resolve_email(data) or _email_by_customer(customer_id)
            if email:
                _downgrade(email)
            return {"received": True}

        email = _resolve_email(data) or _email_by_customer(customer_id)
        if email:
            _grant_pro(email, data, customer_id)

    # Revocations: subscription ended or was cancelled outright.
    elif etype in ("subscription.canceled", "subscription.revoked"):
        email = _resolve_email(data) or _email_by_customer(customer_id)
        if email:
            _downgrade(email)

    # Everything else (checkout.*, customer.*, refunds, benefits, ...) is
    # acknowledged so Polar stops retrying. We don't act on it.
    return {"received": True}


def _email_by_customer(customer_id: str | None) -> str | None:
    """Fallback: map a Polar customer id back to our user via stored id."""
    if not customer_id:
        return None
    u = db.get_user_by_polar_customer(customer_id)
    return u["email"] if u else None


# ── Admin: read-only Polar subscriptions overview ─────────────────────────────
# NOTE: This is READ-ONLY. It does NOT approve, grant, revoke, or mutate
# anything — Polar handles all of that automatically via webhooks. It simply
# lets the owner SEE who is on a Polar-granted plan, their status, and when the
# period ends. Admin-gated by the existing require_admin (ADMIN_EMAILS via JWT).

@router.get("/admin/subscriptions")
async def admin_polar_subscriptions(_admin: str = Depends(require_admin)):
    """
    Return every user whose plan was granted via Polar, for the admin Overview.
    Reads straight from our own MongoDB (kept current by the webhook) — no calls
    to Polar, so it's fast and has no external dependency on page load.

    Shape:
      {
        "summary": {"active": N, "canceled": M, "total": N+M},
        "subscriptions": [
          {"email","plan","subscription_status","current_period_end","polar_customer_id"},
          ...
        ]
      }
    """
    # Only Polar-sourced grants. Stripe/iDEAL/manual users are excluded by the
    # manual_plan_source tag, so this view is unambiguously "Polar subscribers".
    query = {"manual_plan_source": POLAR_PLAN_SOURCE}
    projection = {
        "_id": 0,
        "email": 1,
        "plan": 1,
        "subscription_status": 1,
        "current_period_end": 1,
        "polar_customer_id": 1,
    }

    rows = []
    active = canceled = 0
    try:
        cursor = db.users.find(query, projection)
        for u in cursor:
            status = u.get("subscription_status", "none")
            if status == "active":
                active += 1
            elif status == "canceled":
                canceled += 1
            pe = u.get("current_period_end")
            rows.append({
                "email":               u.get("email"),
                "plan":                u.get("plan", PLAN_BASIC),
                "subscription_status": status,
                "current_period_end":  pe.isoformat() if hasattr(pe, "isoformat") else pe,
                "polar_customer_id":   u.get("polar_customer_id"),
            })
    except Exception as e:
        print(f"[polar] admin/subscriptions query failed: {type(e).__name__}: {e}")
        raise HTTPException(status_code=500, detail="Could not load Polar subscriptions")

    # Sort: active first, then by soonest renewal/end date.
    rows.sort(key=lambda r: (
        0 if r["subscription_status"] == "active" else 1,
        str(r["current_period_end"] or "9999"),
    ))

    return {
        "summary": {"active": active, "canceled": canceled, "total": len(rows)},
        "subscriptions": rows,
    }
