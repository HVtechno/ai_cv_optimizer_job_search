"""
Visitor presence tracking (consent-gated).

Drop-in NEW file. Does not modify any existing route or feature.

Endpoints:
  POST /presence/track   -> records a heartbeat for the current visitor.
                            Only records if the request body has consent: true
                            (ePrivacy / GDPR — the .nl site needs prior consent
                            for a non-essential tracking cookie + IP storage).
  GET  /presence/active  -> returns how many visitors are currently active.

A visitor is identified by a first-party "vid" cookie. The frontend pings
/presence/track on load and every ~60s while the tab is visible. "Active"
means seen within the last `minutes` window (default 5).
"""

import uuid
from fastapi import APIRouter, Request, Response, Cookie
from jose import jwt, JWTError
from db.mongodb import MongoDB
from core.security import SECRET_KEY, ALGORITHM   # reuse existing JWT config

router = APIRouter()
db = MongoDB()


def _client_ip(request: Request) -> str:
    """
    Real client IP. On Render / behind any reverse proxy the socket peer is the
    proxy, so the true client is the first hop in X-Forwarded-For. Falls back to
    the socket peer for local dev.
    """
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _email_from_token(request: Request) -> str | None:
    """
    If a valid Bearer token is present, return its subject (email). Anonymous
    visitors return None. Never raises — auth is optional for tracking.
    """
    auth = request.headers.get("authorization", "")
    if not auth.startswith("Bearer "):
        return None
    try:
        payload = jwt.decode(auth[7:], SECRET_KEY, algorithms=[ALGORITHM])
        return payload.get("sub")
    except JWTError:
        return None


@router.post("/track")
async def track(
    request: Request,
    response: Response,
    payload: dict | None = None,
    vid: str | None = Cookie(default=None),
):
    body = payload or {}

    # ePrivacy gate: do nothing (and set no cookie) until the user consents.
    if not body.get("consent"):
        return {"tracked": False, "reason": "no_consent"}

    # Issue a first-party visitor id cookie on first consented visit.
    if not vid:
        vid = uuid.uuid4().hex
        response.set_cookie(
            key="vid",
            value=vid,
            max_age=60 * 60 * 24 * 30,   # 30 days
            httponly=True,
            secure=True,
            samesite="none",             # API is on a different subdomain
        )

    db.record_visit(
        vid=vid,
        ip=_client_ip(request),
        user_agent=request.headers.get("user-agent", "")[:300],
        path=str(body.get("path", "/"))[:200],
        email=_email_from_token(request),   # None if not logged in
    )
    return {"tracked": True}


@router.get("/active")
async def active(minutes: int = 5):
    minutes = max(1, min(minutes, 60))
    return db.count_active_visitors(window_minutes=minutes)