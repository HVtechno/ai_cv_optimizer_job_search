"""
batch_routes.py — enterprise batch endpoints.

Mount in main.py:
    from batch.batch_routes import router as batch_router
    app.include_router(batch_router)

These reuse your existing auth dependency (get_current_user_doc). The "org_id"
here is a thin multi-tenancy seam: for now it can just be the user's email/id;
when you add real orgs later, swap the source without changing the routes.

Endpoints:
    POST   /batch                  create a batch (resumes + filters + schedule)
    GET    /batch                  list this org's batches
    GET    /batch/{id}             one batch definition + status
    POST   /batch/{id}/run-now     trigger immediately (manual, off-schedule)
    POST   /batch/{id}/pause       pause / resume
    GET    /batch/{id}/results     latest run's results for the sidebar tab
"""

import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from batch.batch_store import BatchStore
from batch.batch_worker import run_batch
from batch.scheduler import _compute_next_run

# Reuse your real auth dependency (defined in core.security, same as your
# existing routes import it).
from core.security import get_current_user_doc
# Reuse the EXACT admin gate the iDEAL/metrics panels use — single source of
# truth for who is an admin (ADMIN_EMAILS). No second definition to drift.
from routes.ideal_billing import require_admin

router = APIRouter(prefix="/batch", tags=["batch"])


class ScheduleSpec(BaseModel):
    type: str = "once"            # once | interval | daily
    hours: int | None = None
    minutes: int | None = None
    hour: int | None = None       # for daily


class BatchCreate(BaseModel):
    name: str
    resume_ids: list[str]
    candidate_names: dict = {}    # {resume_id: "Display Name"} — shown in results
    max_jobs_per_resume: int = 15 # how many jobs to score per resume (1–100)
    filters: dict = {}            # role/location/language/seniority — passed through
    schedule: ScheduleSpec = ScheduleSpec()


class BatchUpdate(BaseModel):
    # All optional — only provided fields are changed. Lets a user tweak filters
    # (or resumes/schedule/name) on an existing batch and re-run for same resumes.
    name: str | None = None
    resume_ids: list[str] | None = None
    candidate_names: dict | None = None
    max_jobs_per_resume: int | None = None
    filters: dict | None = None
    schedule: ScheduleSpec | None = None


def _org_id(user: dict) -> str:
    # Thin tenancy seam — swap for a real org id when you add orgs.
    return user.get("email") or user.get("user_id")


@router.post("")
async def create_batch(body: BatchCreate, user: dict = Depends(get_current_user_doc)):
    if not body.resume_ids:
        raise HTTPException(400, "Select at least one resume.")
    store = BatchStore()
    now   = datetime.now(timezone.utc)
    sched = body.schedule.model_dump(exclude_none=True)
    doc = {
        "batch_id":   uuid.uuid4().hex,
        "org_id":     _org_id(user),
        "name":       body.name,
        "resume_ids": body.resume_ids,
        "candidate_names": body.candidate_names or {},
        "max_jobs_per_resume": max(1, min(body.max_jobs_per_resume, 100)),
        "filters":    body.filters,
        "schedule":   sched,
        "next_run":   now,   # first run ASAP; scheduler picks it up next poll
    }
    return store.create_batch(doc)


@router.get("")
async def list_batches(user: dict = Depends(get_current_user_doc)):
    return BatchStore().list_batches(_org_id(user))


@router.get("/{batch_id}")
async def get_batch(batch_id: str, user: dict = Depends(get_current_user_doc)):
    batch = BatchStore().get_batch(batch_id)
    if not batch or batch["org_id"] != _org_id(user):
        raise HTTPException(404, "Batch not found.")
    return batch


@router.post("/{batch_id}/run-now")
async def run_now(batch_id: str, user: dict = Depends(get_current_user_doc)):
    store = BatchStore()
    batch = store.get_batch(batch_id)
    if not batch or batch["org_id"] != _org_id(user):
        raise HTTPException(404, "Batch not found.")
    run_id   = await run_batch(store, batch)
    next_run = _compute_next_run(batch.get("schedule", {}),
                                 datetime.now(timezone.utc))
    store.mark_run(batch_id, run_id, next_run)
    return {"run_id": run_id, "status": "completed"}


@router.post("/{batch_id}/update")
async def update_batch(batch_id: str, body: BatchUpdate,
                       user: dict = Depends(get_current_user_doc)):
    store = BatchStore()
    batch = store.get_batch(batch_id)
    if not batch or batch["org_id"] != _org_id(user):
        raise HTTPException(404, "Batch not found.")
    fields = body.model_dump(exclude_none=True)
    # Normalize nested schedule model -> plain dict if present.
    if "schedule" in fields and hasattr(body.schedule, "model_dump"):
        fields["schedule"] = body.schedule.model_dump(exclude_none=True)
    return store.update_batch(batch_id, fields)


@router.post("/{batch_id}/pause")
async def pause_batch(batch_id: str, user: dict = Depends(get_current_user_doc)):
    store = BatchStore()
    batch = store.get_batch(batch_id)
    if not batch or batch["org_id"] != _org_id(user):
        raise HTTPException(404, "Batch not found.")
    new_status = "paused" if batch["status"] == "active" else "active"
    store.set_status(batch_id, new_status)
    return {"status": new_status}


@router.get("/{batch_id}/results")
async def batch_results(batch_id: str, user: dict = Depends(get_current_user_doc)):
    store = BatchStore()
    batch = store.get_batch(batch_id)
    if not batch or batch["org_id"] != _org_id(user):
        raise HTTPException(404, "Batch not found.")
    return {
        "batch_id":   batch_id,
        "last_run":   batch.get("last_run"),
        "results":    store.latest_results(batch_id),
    }


# ── Admin-only views (every org's batches) ───────────────────────────────────
# Gated by require_admin (ADMIN_EMAILS) — the same enforcement as your iDEAL
# admin and metrics endpoints. Admins bypass the per-org ownership checks above.

@router.get("/admin/all")
async def admin_all_batches(admin_id: str = Depends(require_admin)):
    return BatchStore().all_batches()


@router.get("/admin/overview")
async def admin_overview(admin_id: str = Depends(require_admin)):
    """Operational metrics across all orgs: who's running batches, how many
    users are active, totals — powers the admin metrics header."""
    return BatchStore().admin_overview()


@router.get("/admin/{batch_id}/results")
async def admin_batch_results(batch_id: str, admin_id: str = Depends(require_admin)):
    store = BatchStore()
    batch = store.get_batch(batch_id)
    if not batch:
        raise HTTPException(404, "Batch not found.")
    return {
        "batch_id":   batch_id,
        "org_id":     batch.get("org_id"),
        "last_run":   batch.get("last_run"),
        "results":    store.latest_results(batch_id),
    }
