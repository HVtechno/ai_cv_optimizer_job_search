"""
scheduler.py — in-process APScheduler. No Redis, no broker, no extra paid service.

Runs inside your existing FastAPI app (Render Starter stays always-on, so the
process never sleeps and the poller fires reliably).

HOW IT WORKS:
  A single lightweight poller runs every minute, asks BatchStore for any active
  batches whose next_run has passed, and runs them. Per-batch cron is computed
  from a simple schedule spec stored on the batch definition, so we don't create
  one APScheduler job per batch (which would be fragile across restarts).

  This keeps ALL state in Mongo (the source of truth) and treats APScheduler as
  a dumb heartbeat — restart-safe by construction.

WIRING (add to your main.py):
    from batch.scheduler import start_scheduler, shutdown_scheduler

    @app.on_event("startup")
    async def _start_batch_scheduler():
        start_scheduler()

    @app.on_event("shutdown")
    async def _stop_batch_scheduler():
        shutdown_scheduler()
"""

from datetime import datetime, timezone, timedelta
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from batch.batch_store import BatchStore
from batch.batch_worker import run_batch

_scheduler: AsyncIOScheduler | None = None


def _compute_next_run(schedule: dict, after: datetime) -> datetime | None:
    """
    Minimal schedule spec -> next datetime.
      {"type": "once"}                         -> None (no further runs)
      {"type": "interval", "hours": 24}        -> after + interval
      {"type": "daily", "hour": 3}             -> next day at hour (off-peak!)
    Off-peak scheduling is recommended so heavy batches don't compete with live
    site traffic for the single Render process.
    """
    t = schedule.get("type")
    if t == "once":
        return None
    if t == "interval":
        return after + timedelta(
            hours=schedule.get("hours", 0),
            minutes=schedule.get("minutes", 0),
        )
    if t == "daily":
        hour = schedule.get("hour", 3)
        nxt = after.replace(hour=hour, minute=0, second=0, microsecond=0)
        if nxt <= after:
            nxt += timedelta(days=1)
        return nxt
    return None


async def _poll_and_run():
    store = BatchStore()
    now   = datetime.now(timezone.utc)
    for batch in store.due_batches(now):
        # Mark next_run immediately so a long run doesn't get double-triggered
        # by the next poll tick.
        next_run = _compute_next_run(batch.get("schedule", {}), now)
        run_id   = await run_batch(store, batch)
        store.mark_run(batch["batch_id"], run_id, next_run)
        if next_run is None:
            store.set_status(batch["batch_id"], "completed")


async def _poll_prompt_deploys():
    """Phase 5: apply any weekend-scheduled prompt deploys that are now due.
    Isolated from batch polling — wrapped so a failure here never affects batches
    or the app. Cheap: one indexed Mongo query per minute unless work is due."""
    try:
        from prompts.deploy_scheduler import apply_due_deploys
        apply_due_deploys()
    except Exception as e:
        print(f"[scheduler] prompt-deploy poll skipped (non-fatal): {e}")


def start_scheduler():
    global _scheduler
    if _scheduler is not None:
        return
    _scheduler = AsyncIOScheduler(timezone="UTC")
    # One poller, every minute. Cheap: it only hits Mongo unless work is due.
    _scheduler.add_job(_poll_and_run, "interval", minutes=1,
                       id="batch_poller", max_instances=1, coalesce=True)
    # Phase 5: separate 1-min poller that applies weekend-scheduled prompt
    # deploys. Independent job so it can't interfere with batch polling.
    _scheduler.add_job(_poll_prompt_deploys, "interval", minutes=1,
                       id="prompt_deploy_poller", max_instances=1, coalesce=True)
    _scheduler.start()
    print("✅ Batch scheduler started (in-process APScheduler, 1-min poll)")


def shutdown_scheduler():
    global _scheduler
    if _scheduler:
        _scheduler.shutdown(wait=False)
        _scheduler = None
