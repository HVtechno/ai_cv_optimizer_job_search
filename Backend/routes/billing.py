"""
routes/billing.py — Stripe subscription billing.

Endpoints:
  GET  /billing/plans                    -> public plan catalog (for pricing page + settings)
  GET  /billing/subscription             -> current user's plan/status (auth)
  POST /billing/create-checkout-session  -> start Pro checkout (auth)
  POST /billing/create-portal-session    -> open Stripe customer portal to manage/cancel (auth)
  POST /billing/webhook                  -> Stripe -> us; flips plans. NO auth, signature-verified.

IMPORTANT — webhook raw body:
  Stripe signs the EXACT bytes of the request body. We must read `await
  request.body()` (raw bytes) and pass them to stripe.Webhook.construct_event.
  Do NOT use a Pydantic model or `await request.json()` for the webhook — any
  re-serialization breaks the signature check. That's why this route takes the
  raw Request.

Enterprise has no checkout here by design — the pricing page "Contact sales"
button opens a mailto/contact form on the frontend. You flip enterprise plans
manually via db.update_user_subscription(..., plan="enterprise").

Env vars required (.env):
  STRIPE_SECRET_KEY=sk_test_...
  STRIPE_WEBHOOK_SECRET=whsec_...
  STRIPE_PRO_MONTHLY_PRICE_ID=price_...
  STRIPE_PRO_ANNUAL_PRICE_ID=price_...        # optional; only if you sell annual
  FRONTEND_URL=http://localhost:5173          # where Stripe redirects back to
"""

import os
import json
from datetime import datetime, timezone

import stripe
from fastapi import APIRouter, Depends, HTTPException, Request
from dotenv import load_dotenv

from core.security import get_current_user, get_current_user_doc
from core.plans import public_plans, PLAN_BASIC, PLAN_PRO
from core.email_service import send_goodbye_email
from db.mongodb import MongoDB

load_dotenv()

stripe.api_key        = os.getenv("STRIPE_SECRET_KEY")
WEBHOOK_SECRET        = os.getenv("STRIPE_WEBHOOK_SECRET")
PRICE_PRO_MONTHLY     = os.getenv("STRIPE_PRO_MONTHLY_PRICE_ID")
PRICE_PRO_ANNUAL      = os.getenv("STRIPE_PRO_ANNUAL_PRICE_ID")
FRONTEND_URL          = os.getenv("FRONTEND_URL", "http://localhost:5173")

router = APIRouter()
db     = MongoDB()


# Map a Stripe price id back to the plan it grants. Extend this if you add tiers.
def _plan_for_price(price_id: str) -> str:
    if price_id and price_id in {PRICE_PRO_MONTHLY, PRICE_PRO_ANNUAL}:
        return PLAN_PRO
    return PLAN_BASIC


def _resolve_price_id(billing_period: str) -> str:
    """Pick the Stripe price based on the requested period (monthly|annual)."""
    if billing_period == "annual":
        if not PRICE_PRO_ANNUAL:
            raise HTTPException(status_code=400, detail="Annual billing not configured")
        return PRICE_PRO_ANNUAL
    if not PRICE_PRO_MONTHLY:
        raise HTTPException(status_code=500, detail="Stripe price not configured")
    return PRICE_PRO_MONTHLY


def _ensure_customer(user: dict) -> str:
    """
    Return the user's Stripe customer id, creating one (and persisting it) on
    first use. We key the customer by email and stash our email in metadata so
    the webhook can always find the user even if a payload is sparse.
    """
    existing = user.get("stripe_customer_id")
    if existing:
        return existing
    customer = stripe.Customer.create(
        email=user["email"],
        metadata={"app_user_id": user["email"]},
    )
    db.set_stripe_customer_id(user["email"], customer.id)
    return customer.id


# ── Public catalog (no auth) ──────────────────────────────────────────────────

@router.get("/plans")
async def list_plans():
    """Plan catalog for the pricing page + settings. Mirrors core.plans."""
    return {"plans": public_plans()}


# ── Current subscription (auth) ───────────────────────────────────────────────

@router.get("/subscription")
async def get_subscription(user: dict = Depends(get_current_user_doc)):
    period_end  = user.get("current_period_end")
    sub_id      = user.get("stripe_subscription_id")
    customer_id = user.get("stripe_customer_id")

    interval     = None   # "month" | "year"
    amount_eur   = None   # numeric price for the interval, in euros

    # Pull live details from Stripe when we have a subscription. This gives us
    # the renewal date (already correct for monthly vs annual — Stripe sets the
    # period end one month or one year out depending on the plan they bought),
    # plus the billing interval and amount so the UI can show "€290/year" etc.
    # Best-effort — never fail the endpoint if Stripe is unreachable.
    if sub_id or customer_id:
        try:
            sub = None
            if sub_id:
                sub = stripe.Subscription.retrieve(sub_id)
            elif customer_id:
                subs = stripe.Subscription.list(customer=customer_id, status="all", limit=1)
                # Index directly — no dict()/.get on the StripeObject (avoids the
                # KeyError: 0 SDK quirk on this version).
                data = subs["data"] if subs and "data" in subs else []
                if data:
                    sub = data[0]
                    sub_id = sub["id"]

            if sub is not None:
                cpe = getattr(sub, "current_period_end", None)
                if not cpe:
                    try:
                        items_data = sub["items"]["data"]
                        if items_data:
                            cpe = items_data[0]["current_period_end"]
                    except (KeyError, TypeError, IndexError):
                        cpe = None
                if cpe and period_end is None:
                    period_end = datetime.fromtimestamp(cpe, tz=timezone.utc)
                    db.update_user_subscription(
                        user["email"],
                        plan=user.get("plan", PLAN_BASIC),
                        stripe_subscription_id=sub_id,
                        current_period_end=period_end,
                    )

                # Interval + amount from the subscription's price (first item).
                try:
                    price = sub["items"]["data"][0]["price"]
                    recurring = price.get("recurring") if hasattr(price, "get") else price["recurring"]
                    interval = (recurring or {}).get("interval")            # "month" | "year"
                    unit_amount = price.get("unit_amount") if hasattr(price, "get") else price["unit_amount"]
                    if unit_amount is not None:
                        amount_eur = round(unit_amount / 100)              # cents -> euros
                except (KeyError, TypeError, IndexError):
                    pass
        except Exception as e:
            print(f"[get_subscription] Stripe fetch failed: {type(e).__name__}: {e}")

    return {
        "plan":                user.get("plan", PLAN_BASIC),
        "subscription_status": user.get("subscription_status", "none"),
        "current_period_end":  period_end.isoformat() if hasattr(period_end, "isoformat") else period_end,
        "has_stripe_customer": bool(user.get("stripe_customer_id")),
        "billing_interval":    interval,      # "month" | "year" | None
        "amount_eur":          amount_eur,    # e.g. 29 or 290 | None
    }


# ── Feedback (auth) ───────────────────────────────────────────────────────────
# 1-5 star rating + optional comment, stored in Mongo. Two entry points:
#   - periodic prompt after an optimization (source="optimization"), gated by a
#     30-day cooldown via last_feedback_prompt on the user doc;
#   - an always-available Settings link (source="settings"), no cooldown.

FEEDBACK_COOLDOWN_DAYS = 30


@router.get("/feedback/should-prompt")
async def feedback_should_prompt(user: dict = Depends(get_current_user_doc)):
    """Tells the frontend whether to show the periodic prompt. True if the user
    has never been prompted or the cooldown has elapsed."""
    last = db.get_last_feedback_prompt(user["email"])
    if not last:
        return {"should_prompt": True}
    # last may be a datetime (from Mongo) — compare in UTC.
    try:
        if last.tzinfo is None:
            last = last.replace(tzinfo=timezone.utc)
    except AttributeError:
        return {"should_prompt": True}
    elapsed_days = (datetime.now(timezone.utc) - last).days
    return {"should_prompt": elapsed_days >= FEEDBACK_COOLDOWN_DAYS}


@router.post("/feedback/dismiss")
async def feedback_dismiss(user: dict = Depends(get_current_user_doc)):
    """Mark the periodic prompt as shown (starts the cooldown) without a rating.
    Called when the user closes/Esc the prompt so we don't re-ask for 30 days."""
    db.set_last_feedback_prompt(user["email"])
    return {"ok": True}


@router.post("/feedback")
async def submit_feedback(payload: dict, user: dict = Depends(get_current_user_doc)):
    """Store a feedback entry. payload: {rating:1-5, comment?:str, source?:str}."""
    rating = payload.get("rating")
    try:
        rating = int(rating)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="rating must be an integer 1-5")
    if rating < 1 or rating > 5:
        raise HTTPException(status_code=400, detail="rating must be between 1 and 5")

    comment = (payload.get("comment") or "")[:2000]   # cap comment length
    source  = payload.get("source") or "settings"
    if source not in ("optimization", "settings"):
        source = "settings"

    db.save_feedback(user["email"], rating, comment, source)
    # Submitting from the periodic prompt also starts the cooldown.
    if source == "optimization":
        db.set_last_feedback_prompt(user["email"])
    return {"ok": True}


# ── Live usage counters (auth) ────────────────────────────────────────────────
# Powers the "X of Y" meters on the Settings panel. Free metering is account-wide
# per month; Pro metering is per-resume. Pass ?resume_id=... to get the per-resume
# figures (refreshes used / optimized jobs used for that resume). Always returns
# resume-upload usage and the monthly figures too.

@router.get("/usage")
async def get_usage(resume_id: str | None = None, user: dict = Depends(get_current_user_doc)):
    from core.plans import effective_limits, optimization_quota
    email  = user["email"]
    limits = effective_limits(user)
    quota  = optimization_quota(user)   # {"model","cap"} for optimizations

    # Resume uploads (account-wide).
    resumes_used = db.count_user_resumes(email)

    # Optimizations + refreshes depend on the model.
    if quota["model"] == "month":
        opt_used = len(db.get_optimized_jobs_this_month(email))
        opt_cap  = quota["cap"]
        opt_scope = "month"
    else:
        opt_used = len(db.get_optimized_jobs_resume(resume_id)) if resume_id else 0
        opt_cap  = quota["cap"]
        opt_scope = "resume"

    refresh_month_cap  = limits.get("max_refreshes_month")
    refresh_resume_cap = limits.get("max_refreshes_resume")
    if refresh_month_cap is not None:
        refresh_used  = db.get_usage_this_month(email, "refreshes")
        refresh_cap   = refresh_month_cap
        refresh_scope = "month"
    elif refresh_resume_cap is not None:
        refresh_used  = db.get_resume_refresh_count(resume_id) if resume_id else 0
        refresh_cap   = refresh_resume_cap
        refresh_scope = "resume"
    else:
        refresh_used, refresh_cap, refresh_scope = 0, None, "unlimited"

    return {
        "plan": user.get("plan", PLAN_BASIC),
        "resumes":       {"used": resumes_used, "cap": limits.get("max_resumes")},
        "optimizations": {"used": opt_used, "cap": opt_cap, "scope": opt_scope},
        "refreshes":     {"used": refresh_used, "cap": refresh_cap, "scope": refresh_scope},
        "job_matches":   {"cap": limits.get("max_job_matches")},
    }


# ── Delete account (auth) ─────────────────────────────────────────────────────
# Wipes everything for the user: cancels the Stripe subscription (best-effort),
# then deletes resumes, embeddings, job_matches, and the user document. This is
# irreversible. The frontend asks for explicit confirmation before calling it.

@router.delete("/account")
async def delete_account(user: dict = Depends(get_current_user_doc)):
    email = user["email"]

    # Best-effort: cancel any active Stripe subscription so they aren't billed
    # again. We don't fail the deletion if Stripe errors — local data still goes.
    sub_id = user.get("stripe_subscription_id")
    if sub_id:
        try:
            stripe.Subscription.delete(sub_id)
        except Exception as e:
            print(f"[delete_account] Stripe cancel failed for {email}: {e}")

    # Send a goodbye / confirmation email BEFORE we wipe the record, while we
    # still have a valid address. Best-effort: a mail failure must never block
    # the deletion the user asked for.
    try:
        send_goodbye_email(email)
    except Exception as e:
        print(f"[delete_account] goodbye email failed for {email}: {e}")

    summary = db.delete_account(email)
    return {"success": True, **summary}


# ── Start checkout (auth) ─────────────────────────────────────────────────────

@router.post("/create-checkout-session")
async def create_checkout_session(
    payload: dict | None = None,
    user: dict = Depends(get_current_user_doc),
):
    """
    Create a Stripe Checkout session for Pro. Body: {"billing_period": "monthly"|"annual"}.
    Returns {url} — the frontend redirects the browser there.
    """
    billing_period = (payload or {}).get("billing_period", "monthly")
    price_id       = _resolve_price_id(billing_period)
    customer_id    = _ensure_customer(user)

    try:
        session = stripe.checkout.Session.create(
            mode="subscription",
            customer=customer_id,
            line_items=[{"price": price_id, "quantity": 1}],
            # Where Stripe sends the browser after success/cancel.
            success_url=f"{FRONTEND_URL}/dashboard?checkout=success",
            cancel_url=f"{FRONTEND_URL}/dashboard?checkout=cancel",
            # Belt-and-suspenders: our identity travels with the session so the
            # webhook can resolve the user even before the customer lookup.
            client_reference_id=user["email"],
            metadata={"app_user_id": user["email"]},
            allow_promotion_codes=True,
        )
        return {"url": session.url}
    except stripe.error.StripeError as e:
        raise HTTPException(status_code=502, detail=f"Stripe error: {e.user_message or str(e)}")


# ── Customer portal (auth) — manage/cancel/update card ────────────────────────

@router.post("/create-portal-session")
async def create_portal_session(user: dict = Depends(get_current_user_doc)):
    customer_id = user.get("stripe_customer_id")
    if not customer_id:
        raise HTTPException(status_code=400, detail="No billing account yet")
    try:
        session = stripe.billing_portal.Session.create(
            customer=customer_id,
            return_url=f"{FRONTEND_URL}/dashboard",
        )
        return {"url": session.url}
    except stripe.error.StripeError as e:
        raise HTTPException(status_code=502, detail=f"Stripe error: {e.user_message or str(e)}")


# ── Webhook (NO auth — verified by Stripe signature) ──────────────────────────

@router.post("/webhook")
async def stripe_webhook(request: Request):
    """
    Stripe -> us. The ONLY source of truth for flipping a user's plan. We never
    trust the browser's "success" redirect to grant access — that's just UX.
    Access is granted here, after Stripe confirms payment.
    """
    raw_body  = await request.body()                       # raw bytes — required
    signature = request.headers.get("stripe-signature", "")

    # Verify the signature first (security): this proves the bytes really came
    # from Stripe. We ignore the StripeObject it returns and instead parse the
    # SAME raw bytes ourselves into a plain dict — StripeObject's dict-conversion
    # behaviour varies across SDK versions (dict(obj) can raise KeyError), so a
    # plain json.loads gives us normal .get()/indexing that always works.
    try:
        stripe.Webhook.construct_event(raw_body, signature, WEBHOOK_SECRET)
    except (ValueError, stripe.error.SignatureVerificationError):
        # Bad signature or malformed body — reject. Never act on unverified data.
        raise HTTPException(status_code=400, detail="Invalid webhook signature")

    event = json.loads(raw_body)            # plain dict — verified above
    etype = event.get("type")
    obj   = (event.get("data") or {}).get("object") or {}   # plain nested dict

    # 1) Checkout finished -> subscription is live. Grant Pro.
    if etype == "checkout.session.completed":
        email = (
            obj.get("client_reference_id")
            or (obj.get("metadata") or {}).get("app_user_id")
        )
        customer_id = obj.get("customer")
        sub_id      = obj.get("subscription")
        if email:
            db.update_user_subscription(
                email,
                plan=PLAN_PRO,
                subscription_status="active",
                stripe_subscription_id=sub_id,
            )
            if customer_id:
                db.set_stripe_customer_id(email, customer_id)

    # 2) Subscription created/updated -> sync status + period end + plan.
    elif etype in ("customer.subscription.updated", "customer.subscription.created"):
        customer_id = obj.get("customer")
        status_str  = obj.get("status")          # active, past_due, canceled, ...
        period_end  = obj.get("current_period_end")
        # obj is a plain dict, so normal .get() chaining is safe here.
        items_data  = ((obj.get("items") or {}).get("data")) or []
        price_id    = (items_data[0].get("price", {}).get("id") if items_data else None)
        user = db.get_user_by_stripe_customer(customer_id)
        if user:
            # Active/trialing keeps the paid plan; anything else falls to basic.
            new_plan = _plan_for_price(price_id) if status_str in ("active", "trialing") else PLAN_BASIC
            db.update_user_subscription(
                user["email"],
                plan=new_plan,
                subscription_status=status_str,
                stripe_subscription_id=obj.get("id"),
                current_period_end=(
                    datetime.fromtimestamp(period_end, tz=timezone.utc) if period_end else None
                ),
            )

    # 3) Subscription deleted/canceled -> downgrade to basic.
    elif etype == "customer.subscription.deleted":
        customer_id = obj.get("customer")
        user = db.get_user_by_stripe_customer(customer_id)
        if user:
            db.update_user_subscription(
                user["email"],
                plan=PLAN_BASIC,
                subscription_status="canceled",
            )

    # Acknowledge everything else so Stripe stops retrying.
    return {"received": True}