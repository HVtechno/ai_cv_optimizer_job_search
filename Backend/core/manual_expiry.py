"""
core/manual_expiry.py — Lazy expiry for MANUAL (iDEAL) Pro grants.

WHY THIS EXISTS
---------------
Stripe-paid users are downgraded automatically: when a subscription lapses,
Stripe sends `customer.subscription.deleted` / `.updated` to /billing/webhook,
which flips the user back to basic. That path is untouched and keeps working.

MANUAL iDEAL grants have NO such webhook — nobody tells us when 30 days are up.
So we enforce expiry ourselves, lazily, the next time the user's document is
loaded. If a manual Pro grant's `current_period_end` is in the past, we flip the
user back to basic (exactly the "falls back to free" behaviour you wanted).

SAFETY — this NEVER touches Stripe users
----------------------------------------
The check only acts when the user doc is tagged `manual_plan_source == "ideal"`.
A Stripe user (or a basic user, or an enterprise user) is left completely alone:
the function returns the doc unchanged. There is no code path here that can
downgrade or modify a Stripe-managed subscription.

The function is a no-op unless ALL of these hold:
  - plan == "pro"
  - manual_plan_source == "ideal"
  - current_period_end is set AND in the past

It returns the (possibly updated) user dict so callers can use the fresh value
without a second DB read.
"""

from datetime import datetime, timezone
from typing import Optional


MANUAL_SOURCE_IDEAL = "ideal"


def _as_aware_utc(value) -> Optional[datetime]:
    """Coerce a stored period-end into a tz-aware UTC datetime, or None.
    Mongo usually returns a naive datetime; treat naive values as UTC."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    # ISO string fallback (defensive — we always store datetimes).
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except (ValueError, TypeError):
        return None


def is_manual_pro(user: Optional[dict]) -> bool:
    """True only for an active MANUAL iDEAL Pro grant (not Stripe, not basic).

    NOTE: Polar grants are tagged manual_plan_source="polar", NOT "ideal", so
    they never match here — Polar manages its own expiry via webhooks and must
    not be touched by this lazy-expiry path. The strict equality to
    MANUAL_SOURCE_IDEAL is what keeps Polar (and Stripe) users safe.
    """
    if not user:
        return False
    return (
        user.get("plan") == "pro"
        and user.get("manual_plan_source") == MANUAL_SOURCE_IDEAL
    )


def manual_pro_expired(user: Optional[dict], *, now: Optional[datetime] = None) -> bool:
    """True if this is a manual iDEAL Pro grant whose period has elapsed."""
    if not is_manual_pro(user):
        return False
    end = _as_aware_utc(user.get("current_period_end"))
    if end is None:
        # Manual Pro with no end date — treat as NOT expired (defensive; a
        # missing end should never silently revoke access). The confirm flow
        # always sets an end, so this branch is just belt-and-suspenders.
        return False
    now = now or datetime.now(timezone.utc)
    return now >= end


def expire_manual_if_needed(user: Optional[dict], db) -> Optional[dict]:
    """
    If `user` is an EXPIRED manual iDEAL Pro grant, downgrade them to basic and
    return the updated dict. Otherwise return `user` untouched.

    `db` is the MongoDB singleton (passed in to avoid an import cycle). We reuse
    the existing `update_user_subscription` grant seam — the SAME function the
    Stripe webhook uses — so there's one and only one place that flips plans.
    """
    if not manual_pro_expired(user):
        return user

    email = user.get("email")
    if not email:
        return user

    # Downgrade via the canonical grant function. We clear the manual marker so
    # we don't repeatedly re-process an already-expired user, and record why.
    db.update_user_subscription(
        email,
        plan="basic",
        subscription_status="canceled",
    )
    db.users.update_one(
        {"email": email},
        {"$set": {
            "manual_plan_source": None,
            "manual_expired_at": datetime.now(timezone.utc),
        }},
    )

    # Return a fresh copy reflecting the downgrade so the caller is consistent
    # within this request without another round-trip.
    updated = dict(user)
    updated["plan"] = "basic"
    updated["subscription_status"] = "canceled"
    updated["manual_plan_source"] = None
    return updated
