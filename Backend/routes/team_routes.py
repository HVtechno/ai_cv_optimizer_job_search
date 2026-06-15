"""
team_routes.py — admin team / contributor management. Admin-gated.

Grants the internal 'contributor' role by EMAIL (the person signs up / logs in
themselves — we never create accounts or set passwords here). Contributors get
full product access via plans.is_contributor(); they do NOT get admin pages.

  GET    /team                 list contributors
  POST   /team/grant           grant contributor to an email (sends email)
  POST   /team/remove          revoke contributor (back to normal user)
  GET    /team/check           (any logged-in user) returns own role for the UI

Additive: new routes only. Reuses your existing users collection, auth, and
email_service. Nothing existing is modified.
"""

from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from db.mongodb import MongoDB
from core.security import get_current_user_doc
from routes.ideal_billing import require_admin
from core.email_service import send_contributor_access_email, send_contributor_removed_email

router = APIRouter(prefix="/team", tags=["team"])


def _users():
    return MongoDB().users


def _valid_email(e: str) -> bool:
    e = (e or "").strip()
    return "@" in e and "." in e.split("@")[-1] and len(e) >= 5


class GrantBody(BaseModel):
    email: str


@router.get("")
async def list_contributors(admin_id: str = Depends(require_admin)):
    rows = list(_users().find(
        {"role": "contributor"},
        {"_id": 0, "email": 1, "role": 1, "contributor_since": 1,
         "contributor_by": 1, "verified": 1},
    ))
    # Also surface pending grants (invited but not registered yet).
    db = MongoDB().db
    registered_emails = {r["email"] for r in rows}
    for p in db["pending_contributors"].find({}, {"_id": 0}):
        if p["email"] not in registered_emails:
            rows.append({
                "email": p["email"],
                "role": "contributor",
                "contributor_since": p.get("contributor_since"),
                "contributor_by": p.get("contributor_by"),
                "verified": False,
                "pending": True,
            })
    return {"contributors": rows}


@router.post("/grant")
async def grant_contributor(body: GrantBody, admin_id: str = Depends(require_admin)):
    email = body.email.lower().strip()
    if not _valid_email(email):
        raise HTTPException(400, "Please provide a valid email address.")
    users = _users()
    db = MongoDB().db
    existing = users.find_one({"email": email}, {"_id": 0, "email": 1, "role": 1})

    if existing:
        # Real, registered user: just set the role on their existing doc.
        users.update_one(
            {"email": email},
            {"$set": {
                "role": "contributor",
                "contributor_since": datetime.now(timezone.utc),
                "contributor_by": admin_id,
            }},
        )
    else:
        # Not registered yet. DO NOT create a partial (passwordless) user doc —
        # that would break login/signup. Record a PENDING grant instead; it's
        # applied automatically when they sign up with this email.
        db["pending_contributors"].update_one(
            {"email": email},
            {"$set": {
                "email": email,
                "contributor_since": datetime.now(timezone.utc),
                "contributor_by": admin_id,
            }},
            upsert=True,
        )

    # Best-effort email notification (never fails the request).
    emailed = False
    try:
        emailed = send_contributor_access_email(email, inviter=admin_id)
    except Exception as e:
        print(f"[team] grant email failed (non-fatal): {e}")

    return {
        "email": email,
        "role": "contributor",
        "existing_user": bool(existing),
        "email_sent": emailed,
    }


@router.post("/remove")
async def remove_contributor(body: GrantBody, admin_id: str = Depends(require_admin)):
    email = body.email.lower().strip()
    users = _users()
    db = MongoDB().db

    # Clear any pending (not-yet-registered) grant.
    pending_removed = db["pending_contributors"].delete_one({"email": email}).deleted_count

    doc = users.find_one({"email": email}, {"_id": 0, "role": 1})
    if not doc and not pending_removed:
        raise HTTPException(404, "No such contributor.")

    emailed = False
    if doc:
        # Registered user: revoke role only — we do NOT delete the account/data.
        users.update_one(
            {"email": email},
            {"$set": {"role": "user"},
             "$unset": {"contributor_since": "", "contributor_by": ""}},
        )
        try:
            emailed = send_contributor_removed_email(email, remover=admin_id)
        except Exception as e:
            print(f"[team] removal email failed (non-fatal): {e}")
    return {"email": email, "role": "user", "email_sent": emailed,
            "was_pending": bool(pending_removed and not doc)}


@router.get("/check")
async def check_my_role(user: dict = Depends(get_current_user_doc)):
    """Any logged-in user can read their own role so the UI knows what to show.
    Admin status stays email-based; this just surfaces the contributor flag."""
    from core.plans import is_admin_user, is_contributor
    return {
        "email": user.get("email"),
        "is_admin": is_admin_user(user),
        "is_contributor": is_contributor(user),
        "role": user.get("role", "user"),
    }
