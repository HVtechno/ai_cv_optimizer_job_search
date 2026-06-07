"""
core/security.py

UNCHANGED from your version: password hashing, token creation, get_current_user.
ADDED (at the bottom):
  - get_current_user_doc : dependency returning the FULL user record, not just email
  - require_feature(...)  : dependency factory that 403s if the user's plan lacks a feature
These are additive — every existing route that uses get_current_user keeps working.
"""

from passlib.context import CryptContext
from datetime import datetime, timedelta
from jose import jwt, JWTError
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import hashlib, os
from dotenv import load_dotenv

load_dotenv()

SECRET_KEY = os.getenv("JWT_SECRET_KEY")
ALGORITHM  = "HS256"
ACCESS_DAYS  = 30
REFRESH_DAYS = 30

pwd_context   = CryptContext(schemes=["bcrypt"], deprecated="auto")
bearer_scheme = HTTPBearer()


def _normalize(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()

def hash_password(password: str) -> str:
    return pwd_context.hash(_normalize(password))

def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(_normalize(plain), hashed)

def create_access_token(data: dict) -> str:
    payload = {**data, "exp": datetime.utcnow() + timedelta(days=ACCESS_DAYS)}
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)

def create_refresh_token(data: dict) -> str:
    payload = {**data, "exp": datetime.utcnow() + timedelta(days=REFRESH_DAYS)}
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
) -> str:
    """
    FastAPI dependency. Decodes Bearer JWT and returns verified user_id (email).
    Never trust user_id from request body/params — always use this.
    """
    try:
        payload = jwt.decode(credentials.credentials, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: str = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token payload")
        return user_id
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token invalid or expired",
            headers={"WWW-Authenticate": "Bearer"},
        )


# ── ADDED: full user-doc dependency + plan gating ─────────────────────────────
# Imported lazily inside the functions to avoid a circular import
# (db.mongodb imports nothing from here, but keeping it lazy is safest and the
# cost is negligible since the singleton is already constructed).

def get_current_user_doc(user_id: str = Depends(get_current_user)) -> dict:
    """
    Resolve the verified email to the full user document. Use this when a route
    needs the user's plan/limits. Falls back to a minimal doc so a legacy user
    with no record edge case still resolves to a (basic) identity rather than
    500-ing.
    """
    from db.mongodb import MongoDB
    db = MongoDB()
    user = db.get_user(user_id)
    if not user:
        # Should not happen for a valid token, but degrade gracefully to basic.
        return {"email": user_id, "plan": "basic"}
    # Lazily expire MANUAL (iDEAL) Pro grants whose 30 days have elapsed. This is
    # a no-op for Stripe-managed and basic users (Stripe expiry is handled by its
    # own webhook), so it cannot affect any Stripe subscription.
    from core.manual_expiry import expire_manual_if_needed
    user = expire_manual_if_needed(user, db)
    return user


# ── ADDED: short-lived, single-purpose tokens for email flows ────────────────
# These are stateless JWTs scoped by a "purpose" claim so a verification token
# can NEVER be used as a reset token (or as a login token), and vice-versa.
# They reuse the same SECRET_KEY/ALGORITHM — no new secrets, no DB table needed.

VERIFY_TOKEN_HOURS = 24    # email verification link lifetime
RESET_TOKEN_HOURS  = 1     # password reset link lifetime


def create_email_token(email: str, purpose: str, hours: int) -> str:
    """purpose is 'verify' or 'reset'. Encodes an expiry `hours` from now."""
    payload = {
        "sub":     email,
        "purpose": purpose,
        "exp":     datetime.utcnow() + timedelta(hours=hours),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def verify_email_token(token: str, expected_purpose: str) -> str | None:
    """
    Decode and validate an email-flow token. Returns the email on success, or
    None if the token is invalid/expired OR was issued for a different purpose.
    """
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        return None
    if payload.get("purpose") != expected_purpose:
        return None
    email = payload.get("sub")
    return email or None


def create_verification_token(email: str) -> str:
    return create_email_token(email, "verify", VERIFY_TOKEN_HOURS)


def create_reset_token(email: str) -> str:
    return create_email_token(email, "reset", RESET_TOKEN_HOURS)


def require_feature(feature: str):
    """
    Dependency factory. Use on routes that should be Pro/Enterprise-only:

        @router.post("/resume-optimize/{resume_id}",
                     dependencies=[Depends(require_feature("resume_rewrite"))])

    Returns 403 with a machine-readable detail the frontend can use to pop the
    upgrade modal. Does not change the route's own signature.
    """
    from core.plans import feature_enabled

    def _dep(user: dict = Depends(get_current_user_doc)) -> dict:
        if not feature_enabled(user, feature):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "error":        "plan_upgrade_required",
                    "feature":      feature,
                    "current_plan": user.get("plan", "basic"),
                    "message":      f"Your plan does not include '{feature}'. Upgrade to Pro to unlock it.",
                },
            )
        return user
    return _dep
