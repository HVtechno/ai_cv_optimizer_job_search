"""
routes/prompt_admin.py — Phase 2: admin-only API for the prompt registry.

SCOPE (read + version management only):
  This router lets an admin LIST prompts, READ version history, VIEW a specific
  version, CREATE a new version (a draft save), and DIFF two versions. It does
  NOT deploy, schedule, notify, or refresh anything — those are Phases 4-6. The
  one mutating action here (create version) is append-only and never changes
  which version is live, so it cannot affect production output.

SECURITY:
  Every endpoint depends on require_admin — the SAME gate ideal_billing and
  admin_metrics use (single source of truth = ADMIN_EMAILS). The admin identity
  comes from the JWT, never the request body, so it can't be spoofed.

ISOLATION:
  - Imports only the new prompts package + the existing require_admin.
  - Touches no existing collection, service, or behavior.
  - Mounted in main.py with its own /prompts prefix (added additively).

Endpoints (all under the /prompts prefix set in main.py):
  GET    /prompts/catalog                       list all manageable keys + state
  GET    /prompts/{key}/versions                 version history for a key
  GET    /prompts/{key}/versions/{version_no}    one specific version
  GET    /prompts/{key}/active                   the currently-deployed version
  POST   /prompts/{key}/versions                 create a new (draft) version
  GET    /prompts/{key}/diff                     diff two versions (?a=&b=)
  GET    /prompts/{key}/live                      the CURRENT text in your code
  POST   /prompts/seed                            idempotent seed from constants
"""

import difflib
from fastapi import APIRouter, HTTPException, Depends, Query

from routes.ideal_billing import require_admin   # reuse the existing admin gate
from prompts.prompt_store import PromptStore
from prompts.prompt_keys import PROMPT_CATALOG, KEY_LABEL, is_valid_key, resolve_default

router = APIRouter()


def _store() -> PromptStore:
    # Constructed per-request; PromptStore reuses the Mongo singleton internally,
    # so this is cheap and avoids import-time DB work.
    return PromptStore()


@router.get("/catalog")
async def catalog(_: str = Depends(require_admin)):
    """
    The full list of manageable prompts with their current state: how many
    versions exist and which one (if any) is live. Powers the admin list view.
    """
    store = _store()
    items = []
    for key, label, _src in PROMPT_CATALOG:
        latest = store.latest_version_no(key)
        ptr = store.get_active_pointer(key)
        items.append({
            "key":               key,
            "label":             label,
            "latest_version_no": latest,            # None if never seeded
            "active_version_no": ptr["active_version_no"] if ptr else None,
            "deployed_at":       ptr["deployed_at"] if ptr else None,
            "kind":              "system" if key.endswith("_system") else "prompt",
        })
    return {"items": items, "count": len(items)}


@router.get("/{key}/versions")
async def list_versions(key: str, limit: int = 100, _: str = Depends(require_admin)):
    if not is_valid_key(key):
        raise HTTPException(status_code=404, detail="Unknown prompt key")
    store = _store()
    return {
        "key":      key,
        "label":    KEY_LABEL.get(key, key),
        "versions": store.list_versions(key, limit=limit),
    }


@router.get("/{key}/active")
async def get_active(key: str, _: str = Depends(require_admin)):
    if not is_valid_key(key):
        raise HTTPException(status_code=404, detail="Unknown prompt key")
    store = _store()
    active = store.get_active_text(key)
    return {"key": key, "active": active}   # active is None if nothing deployed


@router.get("/{key}/versions/{version_no}")
async def get_version(key: str, version_no: int, _: str = Depends(require_admin)):
    if not is_valid_key(key):
        raise HTTPException(status_code=404, detail="Unknown prompt key")
    store = _store()
    doc = store.get_version(key, version_no)
    if doc is None:
        raise HTTPException(status_code=404, detail="Version not found")
    return doc


@router.post("/{key}/versions")
async def create_version(key: str, payload: dict, admin: str = Depends(require_admin)):
    """
    Append a NEW immutable version (a draft). This does NOT deploy it — the live
    version is unchanged until an explicit deploy (Phase 4). Append-only, so it
    can never corrupt or overwrite existing history or production behavior.

    Body: { "system_text": "...", "prompt_text": "...", "note": "..." }
    For a *_system key only system_text is meaningful; for a *_prompt key only
    prompt_text is — but we store whatever is sent without judgment.
    """
    if not is_valid_key(key):
        raise HTTPException(status_code=404, detail="Unknown prompt key")

    system_text = payload.get("system_text", "")
    prompt_text = payload.get("prompt_text", "")
    note        = payload.get("note", "")

    if not (system_text or prompt_text):
        raise HTTPException(status_code=400, detail="Provide system_text or prompt_text")

    store = _store()
    try:
        doc = store.add_version(
            key=key,
            system_text=system_text,
            prompt_text=prompt_text,
            created_by=admin,
            note=note,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"created": True, "version": doc}


@router.get("/{key}/diff")
async def diff_versions(
    key: str,
    a: int = Query(..., description="older version_no"),
    b: int = Query(..., description="newer version_no"),
    _: str = Depends(require_admin),
):
    """Unified diff between two versions of a key (system + prompt text)."""
    if not is_valid_key(key):
        raise HTTPException(status_code=404, detail="Unknown prompt key")
    store = _store()
    va = store.get_version(key, a)
    vb = store.get_version(key, b)
    if va is None or vb is None:
        raise HTTPException(status_code=404, detail="One or both versions not found")

    def _diff(field):
        left  = (va.get(field) or "").splitlines()
        right = (vb.get(field) or "").splitlines()
        return "\n".join(difflib.unified_diff(
            left, right,
            fromfile=f"v{a}:{field}", tofile=f"v{b}:{field}", lineterm="",
        ))

    return {
        "key":          key,
        "a":            a,
        "b":            b,
        "system_diff":  _diff("system_text"),
        "prompt_diff":  _diff("prompt_text"),
    }


@router.get("/{key}/live")
async def get_live(key: str, _: str = Depends(require_admin)):
    """
    Return the text CURRENTLY hardcoded in your code for this key, read straight
    from the live constant (not from the registry DB). This lets an admin see
    exactly what is running TODAY, even before anything has been seeded.

    Read-only: it imports the module to READ the constant and returns its text.
    It changes nothing — not the code, not the registry.
    """
    if not is_valid_key(key):
        raise HTTPException(status_code=404, detail="Unknown prompt key")
    text = resolve_default(key)
    if text is None:
        raise HTTPException(status_code=404, detail="Could not resolve live constant")
    return {
        "key":   key,
        "label": KEY_LABEL.get(key, key),
        "kind":  "system" if key.endswith("_system") else "prompt",
        "text":  text,
    }


@router.post("/seed")
async def seed(admin: str = Depends(require_admin)):
    """
    Idempotent seed: create v1 (active) from the live constant for any key that
    has no versions yet. Safe to call repeatedly. Lets an admin populate the
    registry from the UI instead of running the CLI script.
    """
    store = _store()
    report = store.seed_from_constants(created_by=f"seed:{admin}")
    return {"ok": True, "report": report}


# ── Phase 4: deploy + rollback ────────────────────────────────────────────────

@router.post("/{key}/deploy")
async def deploy(key: str, payload: dict, admin: str = Depends(require_admin)):
    """
    Make a saved version live for `key`. This is what changes production output.

    Body: { "version_no": <int>, "note": "<optional>" }

    After moving the active pointer we flush the resolver cache for this key so
    the new text takes effect immediately on the next request (no TTL wait).
    """
    if not is_valid_key(key):
        raise HTTPException(status_code=404, detail="Unknown prompt key")
    version_no = payload.get("version_no")
    if version_no is None:
        raise HTTPException(status_code=400, detail="version_no is required")

    store = _store()
    try:
        result = store.deploy_version(
            key=key,
            version_no=int(version_no),
            deployed_by=admin,
            action="deploy",
            note=payload.get("note", ""),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    _flush_resolver_cache(key)
    return {"ok": True, **result}


@router.post("/{key}/rollback")
async def rollback(key: str, payload: dict, admin: str = Depends(require_admin)):
    """
    Roll `key` back to an earlier version. Mechanically identical to deploy (it
    moves the active pointer), but logged as a rollback for the audit trail.

    Body: { "version_no": <int>, "note": "<optional>" }
    """
    if not is_valid_key(key):
        raise HTTPException(status_code=404, detail="Unknown prompt key")
    version_no = payload.get("version_no")
    if version_no is None:
        raise HTTPException(status_code=400, detail="version_no is required")

    store = _store()
    try:
        result = store.deploy_version(
            key=key,
            version_no=int(version_no),
            deployed_by=admin,
            action="rollback",
            note=payload.get("note", ""),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    _flush_resolver_cache(key)
    return {"ok": True, **result}


@router.get("/{key}/history")
async def history(key: str, limit: int = 100, _: str = Depends(require_admin)):
    """Deploy/rollback audit log for a key, newest first."""
    if not is_valid_key(key):
        raise HTTPException(status_code=404, detail="Unknown prompt key")
    store = _store()
    return {"key": key, "history": store.activation_history(key, limit=limit)}


def _flush_resolver_cache(key: str):
    """Flush the live resolver cache so a deploy/rollback is visible immediately.
    Imported lazily and wrapped so a cache miss can never fail the deploy."""
    try:
        from prompts.active_prompt import flush_cache
        flush_cache(key)
    except Exception as e:
        print(f"[prompt_admin] cache flush skipped (non-fatal): {e}")


# ── Phase 5: weekend scheduling + discard ─────────────────────────────────────

@router.post("/{key}/schedule")
async def schedule_deploy(key: str, payload: dict, admin: str = Depends(require_admin)):
    """
    Schedule a deploy for the next weekend slot (CET) and notify the team.
    Does NOT change live output now — the scheduler applies it at the slot.

    Body: { "version_no": <int>, "day": "saturday"|"sunday", "hour": <0-23>,
            "note": "<optional>" }
    """
    if not is_valid_key(key):
        raise HTTPException(status_code=404, detail="Unknown prompt key")
    version_no = payload.get("version_no")
    if version_no is None:
        raise HTTPException(status_code=400, detail="version_no is required")

    day  = str(payload.get("day", "saturday")).lower()
    if day not in ("saturday", "sunday"):
        raise HTTPException(status_code=400, detail="day must be saturday or sunday")
    try:
        hour = int(payload.get("hour", 3))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="hour must be an integer 0-23")
    if not (0 <= hour <= 23):
        raise HTTPException(status_code=400, detail="hour must be 0-23")

    from prompts.deploy_scheduler import schedule_weekend_deploy
    try:
        rec = schedule_weekend_deploy(
            key=key, version_no=int(version_no), scheduled_by=admin,
            day=day, hour=hour, note=payload.get("note", ""),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"ok": True, "scheduled": rec}


@router.get("/scheduled/list")
async def scheduled_list(active_only: bool = True, _: str = Depends(require_admin)):
    """All pending (or all) scheduled deploys, soonest first."""
    from prompts.deploy_scheduler import list_scheduled
    return {"scheduled": list_scheduled(active_only=active_only)}


@router.post("/scheduled/{deployment_id}/cancel")
async def scheduled_cancel(deployment_id: str, admin: str = Depends(require_admin)):
    """Cancel a still-pending scheduled deploy."""
    from prompts.deploy_scheduler import cancel_scheduled
    ok = cancel_scheduled(deployment_id, canceled_by=admin)
    if not ok:
        raise HTTPException(status_code=404, detail="No pending scheduled deploy with that id")
    return {"ok": True, "canceled": deployment_id}


@router.delete("/{key}/versions/{version_no}")
async def discard_version(key: str, version_no: int, _: str = Depends(require_admin)):
    """
    Permanently discard a DRAFT version. Blocked by the store if the version is
    live, appears in deploy history, or has a pending scheduled deploy.
    """
    if not is_valid_key(key):
        raise HTTPException(status_code=404, detail="Unknown prompt key")
    store = _store()
    try:
        result = store.discard_version(key, version_no)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"ok": True, **result}
