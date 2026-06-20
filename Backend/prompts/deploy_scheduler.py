"""
prompts/deploy_scheduler.py — Phase 5: weekend-only scheduled deploys.

WHAT THIS ADDS (all additive, isolated to the prompt registry):
  - schedule_weekend_deploy(): records a PENDING deploy for the next Saturday or
    Sunday slot in CET, and emails the team that it's coming.
  - apply_due_deploys(): called by the existing scheduler poller every minute;
    activates any scheduled deploy whose time has arrived, logs it, flushes the
    resolver cache. Mirrors how batch/scheduler.py already drives batch runs.
  - team recipients are read from an env var so you control exactly who is
    notified, with a safe fallback to the admin list.

WHY CET WITHOUT pytz:
  We compute the slot in Europe/Amsterdam using the stdlib zoneinfo (Python 3.9+,
  already available on your Render image). No new dependency. CET/CEST is handled
  correctly by zoneinfo's DST rules, then converted to UTC for storage/compare —
  the rest of your system stores UTC (see batch_store), so we stay consistent.

STATE:
  Scheduled deploys live in the SAME prompt_deployments collection used for the
  activation log, distinguished by type="scheduled_deploy" and a status field:
      scheduled -> applied | canceled
  This avoids a new collection while keeping the audit trail in one place.
"""

import os
import uuid
from datetime import datetime, timedelta, timezone

try:
    from zoneinfo import ZoneInfo
    _CET = ZoneInfo("Europe/Amsterdam")
except Exception:  # pragma: no cover - zoneinfo always present on 3.9+
    _CET = timezone(timedelta(hours=1))  # static fallback; DST not handled

from prompts.prompt_store import PromptStore
from prompts.prompt_keys import is_valid_key, KEY_LABEL


# ── slot computation ──────────────────────────────────────────────────────────

def _next_weekend_slot(day: str = "saturday", hour: int = 3, after: datetime | None = None) -> datetime:
    """
    Return the next Saturday or Sunday at `hour`:00 CET, as a UTC datetime.

    `after` defaults to now (UTC). If the chosen weekday/hour is already past for
    this week, it rolls to next week. Off-peak hour default (03:00 CET) so the
    deploy + any follow-on refresh don't compete with daytime traffic.
    """
    after = after or datetime.now(timezone.utc)
    target_wd = 5 if day.lower() == "saturday" else 6   # Mon=0 .. Sat=5, Sun=6

    # Work in CET so "Saturday 03:00" means local wall-clock time.
    now_cet = after.astimezone(_CET)
    days_ahead = (target_wd - now_cet.weekday()) % 7
    candidate = (now_cet + timedelta(days=days_ahead)).replace(
        hour=hour, minute=0, second=0, microsecond=0
    )
    if candidate <= now_cet:
        candidate += timedelta(days=7)
    return candidate.astimezone(timezone.utc)


def _team_recipients() -> list[str]:
    """
    Who gets the heads-up email. DEPLOY_NOTIFY_EMAILS (comma-separated) if set,
    else falls back to ADMIN_EMAILS so a deploy is never silent.
    """
    raw = os.getenv("DEPLOY_NOTIFY_EMAILS", "") or os.getenv("ADMIN_EMAILS", "")
    return [e.strip() for e in raw.split(",") if e.strip()]


# ── schedule a deploy ─────────────────────────────────────────────────────────

def schedule_weekend_deploy(
    key: str,
    version_no: int,
    scheduled_by: str,
    day: str = "saturday",
    hour: int = 3,
    note: str = "",
) -> dict:
    """
    Record a pending weekend deploy and notify the team. Does NOT change live
    output now — apply_due_deploys() flips it at the scheduled time.

    Validates key + that the version exists (so we never schedule a phantom).
    Returns the scheduled-deploy record.
    """
    if not is_valid_key(key):
        raise ValueError(f"Unknown prompt key: {key}")
    store = PromptStore()
    if store.get_version(key, version_no) is None:
        raise ValueError(f"Version {version_no} does not exist for key {key}")

    when_utc = _next_weekend_slot(day=day, hour=hour)
    when_cet_label = when_utc.astimezone(_CET).strftime("%A %d %b %Y, %H:%M")

    record = {
        "type":           "scheduled_deploy",
        "deployment_id":  f"sched_{uuid.uuid4().hex}",
        "status":         "scheduled",
        "key":            key,
        "version_no":     int(version_no),
        "scheduled_for":  when_utc,                 # stored UTC
        "scheduled_cet":  when_cet_label,           # human label for UI/email
        "scheduled_by":   scheduled_by,
        "note":           note or "",
        "created_at":     datetime.now(timezone.utc),
    }
    store.deployments.insert_one(dict(record))
    record.pop("_id", None)

    # Notify the team (best-effort; never blocks scheduling).
    _notify_team(key, version_no, when_cet_label, scheduled_by, note)
    return record


def _notify_team(key, version_no, when_cet_label, scheduled_by, note):
    try:
        from core.email_service import send_deployment_notice_email
        label = KEY_LABEL.get(key, key)
        summary = f"• {label} → version {version_no}"
        if note:
            summary += f" ({note})"
        for addr in _team_recipients():
            send_deployment_notice_email(
                to_email=addr,
                deploy_when_cet=when_cet_label,
                items_summary=summary,
                scheduled_by=scheduled_by,
            )
    except Exception as e:
        print(f"[deploy_scheduler] team notify skipped (non-fatal): {e}")


# ── apply due deploys (called by the scheduler poller) ────────────────────────

def apply_due_deploys(now: datetime | None = None) -> list:
    """
    Activate any scheduled deploy whose time has passed. Idempotent: each record
    is flipped to status="applied" as it runs, so a later poll won't re-run it.
    Returns a list of applied records (for logging). Never raises out.
    """
    now = now or datetime.now(timezone.utc)
    store = PromptStore()
    applied = []
    try:
        due = list(store.deployments.find({
            "type":          "scheduled_deploy",
            "status":        "scheduled",
            "scheduled_for": {"$lte": now},
        }))
    except Exception as e:
        print(f"[deploy_scheduler] due query failed: {e}")
        return applied

    for rec in due:
        key = rec.get("key")
        version_no = rec.get("version_no")
        # Claim it first (so a concurrent poll can't double-apply), then deploy.
        claimed = store.deployments.update_one(
            {"deployment_id": rec["deployment_id"], "status": "scheduled"},
            {"$set": {"status": "applying", "applying_at": now}},
        )
        if claimed.modified_count != 1:
            continue  # someone else claimed it
        try:
            store.deploy_version(
                key=key,
                version_no=version_no,
                deployed_by=rec.get("scheduled_by", "scheduler"),
                action="deploy",
                note=f"scheduled weekend deploy ({rec.get('scheduled_cet','')})",
            )
            store.deployments.update_one(
                {"deployment_id": rec["deployment_id"]},
                {"$set": {"status": "applied", "applied_at": datetime.now(timezone.utc)}},
            )
            _flush(key)
            rec["status"] = "applied"
            rec.pop("_id", None)
            applied.append(rec)
            print(f"[deploy_scheduler] applied scheduled deploy {key} -> v{version_no}")
        except Exception as e:
            # Leave a clear failed state; do NOT silently lose the record.
            store.deployments.update_one(
                {"deployment_id": rec["deployment_id"]},
                {"$set": {"status": "failed", "error": str(e),
                          "failed_at": datetime.now(timezone.utc)}},
            )
            print(f"[deploy_scheduler] FAILED scheduled deploy {key} v{version_no}: {e}")
    return applied


def list_scheduled(active_only: bool = True, limit: int = 100) -> list:
    """Scheduled deploys for the admin UI, newest slot first."""
    store = PromptStore()
    q = {"type": "scheduled_deploy"}
    if active_only:
        q["status"] = "scheduled"
    cur = (store.deployments.find(q, {"_id": 0})
           .sort("scheduled_for", 1).limit(int(limit)))
    return list(cur)


def cancel_scheduled(deployment_id: str, canceled_by: str = "admin") -> bool:
    """Cancel a still-pending scheduled deploy. Returns True if one was canceled."""
    store = PromptStore()
    res = store.deployments.update_one(
        {"deployment_id": deployment_id, "type": "scheduled_deploy", "status": "scheduled"},
        {"$set": {"status": "canceled", "canceled_by": canceled_by,
                  "canceled_at": datetime.now(timezone.utc)}},
    )
    return res.modified_count == 1


def _flush(key):
    try:
        from prompts.active_prompt import flush_cache
        flush_cache(key)
    except Exception as e:
        print(f"[deploy_scheduler] flush skipped: {e}")
