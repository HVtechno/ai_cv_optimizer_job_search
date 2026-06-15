"""
auth/auth.py

CHANGES vs your version:
  - signup now stamps plan="basic", subscription_status="none", created_at, and
    leaves Stripe fields null. Existing users are unaffected (they read as basic).
  - /me now returns the user's plan, subscription status, and resolved limits so
    the frontend can gate UI and render the Settings/billing panel in one call.

NEW (email verification + password reset — all additive):
  - signup now stamps verified=False and emails a verification link.
  - /login blocks unverified users (returns EMAIL_NOT_VERIFIED) AND auto-resends
    a fresh verification email so nobody is ever stuck. Existing users (no
    `verified` field) are treated as unverified and get the same one-time
    verify-then-login path.
  - POST /verify-email           : consume a verify token, mark user verified.
  - POST /resend-verification    : re-send a verification email (anti-enumeration).
  - POST /forgot-password        : email a reset link (anti-enumeration).
  - POST /reset-password         : consume a reset token, set a new password.
Everything else is identical.
"""

from fastapi import APIRouter, HTTPException, Depends
from datetime import datetime, timezone

from core.security import (
    hash_password, verify_password,
    create_access_token, create_refresh_token,
    get_current_user, get_current_user_doc,
    create_verification_token, create_reset_token, verify_email_token,
)
from core.plans import normalize_plan, effective_limits, PLAN_BASIC
from core.email_service import send_verification_email, send_password_reset_email
from db.mongodb import MongoDB

router = APIRouter()
db     = MongoDB()


@router.post("/signup")
async def signup(data: dict):
    email    = data.get("email", "").strip().lower()
    password = data.get("password", "")

    if not email or not password:
        raise HTTPException(status_code=400, detail="Email and password required")

    if len(password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")

    if db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="User already exists")

    db.users.insert_one({
        "email":                  email,
        "password":               hash_password(password),
        # ── verification (new) ──
        "verified":               False,
        # ── subscription fields ──
        "plan":                   PLAN_BASIC,
        "subscription_status":    "none",        # none | active | past_due | canceled
        "stripe_customer_id":     None,
        "stripe_subscription_id": None,
        "current_period_end":     None,
        "created_at":             datetime.now(timezone.utc),
    })

    # If an admin pre-granted contributor access to this email before they
    # signed up, apply it now and clear the pending record. (Additive: only
    # affects emails the admin explicitly invited.)
    try:
        pending = db.db["pending_contributors"].find_one({"email": email})
        if pending:
            db.users.update_one(
                {"email": email},
                {"$set": {
                    "role": "contributor",
                    "contributor_since": pending.get("contributor_since"),
                    "contributor_by": pending.get("contributor_by"),
                }},
            )
            db.db["pending_contributors"].delete_one({"email": email})
    except Exception as _e:
        print(f"[signup] pending contributor apply skipped: {_e}")

    # Fire the verification email. We don't fail signup if mail sending hiccups —
    # the user can request a resend, and login will resend too.
    send_verification_email(email, create_verification_token(email))

    return {
        "message":  "User created. Please check your email to verify your account.",
        "verified": False,
    }


@router.post("/login")
async def login(data: dict):
    email    = data.get("email", "").strip().lower()
    password = data.get("password", "")

    user = db.users.find_one({"email": email})
    if not user:
        raise HTTPException(status_code=404, detail="USER_NOT_FOUND")

    # Defensive: a user doc with no password is not a completed registration
    # (e.g. a legacy/partial record). Treat as not-registered instead of
    # crashing on user["password"].
    if not user.get("password"):
        raise HTTPException(status_code=404, detail="USER_NOT_FOUND")

    if not verify_password(password, user["password"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    # Strict verification gate: a missing `verified` field (legacy users) counts
    # as NOT verified. We auto-resend a fresh verification link so the user has a
    # path in, then block the login with a machine-readable detail the frontend
    # recognizes to show the "check your email" state.
    if user.get("verified") is not True:
        send_verification_email(email, create_verification_token(email))
        raise HTTPException(status_code=403, detail="EMAIL_NOT_VERIFIED")

    return {
        "access_token":  create_access_token({"sub": email}),
        "refresh_token": create_refresh_token({"sub": email}),
        "token_type":    "bearer",
    }


@router.post("/verify-email")
async def verify_email(data: dict):
    """
    Consume a verification token (from the email link). On success the user is
    marked verified and can log in. We also return access/refresh tokens so the
    frontend can log them straight in after they click the link.
    """
    token = (data or {}).get("token", "")
    email = verify_email_token(token, "verify")
    if not email:
        raise HTTPException(status_code=400, detail="INVALID_OR_EXPIRED_TOKEN")

    user = db.users.find_one({"email": email})
    if not user:
        raise HTTPException(status_code=404, detail="USER_NOT_FOUND")

    if user.get("verified") is not True:
        db.mark_user_verified(email)

    return {
        "message":       "Email verified successfully.",
        "verified":      True,
        "access_token":  create_access_token({"sub": email}),
        "refresh_token": create_refresh_token({"sub": email}),
        "token_type":    "bearer",
    }


@router.post("/resend-verification")
async def resend_verification(data: dict):
    """
    Re-send a verification email. Always returns the same generic response so an
    attacker can't use it to discover which emails are registered.
    """
    email = (data or {}).get("email", "").strip().lower()
    if email:
        user = db.users.find_one({"email": email})
        if user and user.get("verified") is not True:
            send_verification_email(email, create_verification_token(email))
    return {"message": "If that account exists and is unverified, a new link has been sent."}


@router.post("/forgot-password")
async def forgot_password(data: dict):
    """
    Email a password-reset link. Anti-enumeration: the response is identical
    whether or not the email exists.
    """
    email = (data or {}).get("email", "").strip().lower()
    if email:
        user = db.users.find_one({"email": email})
        if user:
            send_password_reset_email(email, create_reset_token(email))
    return {"message": "If an account exists for that email, a reset link has been sent."}


@router.post("/reset-password")
async def reset_password(data: dict):
    """
    Consume a reset token and set a new password. A successful reset also marks
    the email verified (clicking a link sent to that inbox proves ownership), so
    a user who reset before ever verifying can now log in.
    """
    token        = (data or {}).get("token", "")
    new_password = (data or {}).get("password", "")

    if len(new_password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")

    email = verify_email_token(token, "reset")
    if not email:
        raise HTTPException(status_code=400, detail="INVALID_OR_EXPIRED_TOKEN")

    user = db.users.find_one({"email": email})
    if not user:
        raise HTTPException(status_code=404, detail="USER_NOT_FOUND")

    db.set_user_password(email, hash_password(new_password))
    if user.get("verified") is not True:
        db.mark_user_verified(email)

    return {"message": "Password updated successfully. You can now log in."}


@router.get("/me")
async def get_me(user: dict = Depends(get_current_user_doc)):
    """
    Returns the verified user identity AND their plan/limits, derived from the
    JWT — never from the request body. The frontend uses this to gate features
    and render the billing panel without a second round trip.
    """
    plan = normalize_plan(user.get("plan"))
    return {
        "user_id":             user.get("email"),
        "email":               user.get("email"),
        "plan":                plan,
        "subscription_status": user.get("subscription_status", "none"),
        "current_period_end":  user.get("current_period_end"),
        "limits":              effective_limits(user),
    }
