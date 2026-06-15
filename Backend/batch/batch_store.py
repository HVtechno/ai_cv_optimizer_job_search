"""
batch_store.py — Mongo persistence for enterprise batch jobs.

Two collections (additive — does NOT touch your existing collections):
  batch_jobs    : the definition + schedule + status of a recurring/one-off batch
  batch_results : one document per (batch_run, resume), newest surfaced in the UI

Design rules that protect cost + correctness:
  - Matching runs against the ALREADY-SCRAPED jobs collection via your existing
    search_similar_jobs (Mongo $vectorSearch). No Apify/Playwright call happens
    here, so a scheduled batch never triggers paid scraping.
  - Every result is tagged with run_id + finished resume hashes so a crashed run
    resumes without redoing (and re-paying for) completed work.
"""

from datetime import datetime, timezone
from db.mongodb import MongoDB


class BatchStore:
    def __init__(self):
        self.db = MongoDB().db
        self.jobs    = self.db["batch_jobs"]
        self.results = self.db["batch_results"]
        self._ensure_indexes()

    def _ensure_indexes(self):
        self.jobs.create_index("batch_id", unique=True)
        self.jobs.create_index("org_id")
        self.jobs.create_index("status")
        self.jobs.create_index("next_run")
        self.results.create_index([("batch_id", 1), ("run_id", 1)])
        self.results.create_index([("batch_id", 1), ("resume_id", 1)])

    # ── Batch definitions ────────────────────────────────────────────────────

    def create_batch(self, doc: dict) -> dict:
        doc.setdefault("created_at", datetime.now(timezone.utc))
        doc.setdefault("status", "active")
        doc.setdefault("last_run", None)
        self.jobs.insert_one(doc)
        doc.pop("_id", None)
        return doc

    def list_batches(self, org_id: str) -> list:
        return list(self.jobs.find({"org_id": org_id}, {"_id": 0}))

    def get_batch(self, batch_id: str) -> dict | None:
        return self.jobs.find_one({"batch_id": batch_id}, {"_id": 0})

    def due_batches(self, now: datetime) -> list:
        """Active batches whose next_run has passed."""
        return list(self.jobs.find(
            {"status": "active", "next_run": {"$lte": now}}, {"_id": 0}
        ))

    def set_status(self, batch_id: str, status: str):
        self.jobs.update_one({"batch_id": batch_id}, {"$set": {"status": status}})

    def update_batch(self, batch_id: str, fields: dict):
        """Update editable fields (filters / schedule / resume_ids / name).
        Only whitelisted keys are written — never touches status/run bookkeeping."""
        allowed = {k: v for k, v in fields.items()
                   if k in ("name", "filters", "schedule", "resume_ids",
                            "candidate_names", "max_jobs_per_resume")}
        if allowed:
            self.jobs.update_one({"batch_id": batch_id}, {"$set": allowed})
        return self.get_batch(batch_id)

    def mark_run(self, batch_id: str, run_id: str, next_run: datetime | None):
        self.jobs.update_one(
            {"batch_id": batch_id},
            {"$set": {
                "last_run":     datetime.now(timezone.utc),
                "last_run_id":  run_id,
                "next_run":     next_run,
            }},
        )

    # ── Results ──────────────────────────────────────────────────────────────

    def already_done(self, batch_id: str, run_id: str, resume_id: str) -> bool:
        """Idempotency check — has this resume already been processed this run?"""
        return self.results.find_one(
            {"batch_id": batch_id, "run_id": run_id, "resume_id": resume_id},
            {"_id": 1},
        ) is not None

    def save_result(self, batch_id: str, run_id: str, org_id: str,
                    resume_id: str, matches: list, candidate: str | None = None):
        self.results.update_one(
            {"batch_id": batch_id, "run_id": run_id, "resume_id": resume_id},
            {"$set": {
                "batch_id":  batch_id,
                "run_id":    run_id,
                "org_id":    org_id,
                "resume_id": resume_id,
                "candidate": candidate or resume_id[:8],
                "matches":   matches,
                "finished_at": datetime.now(timezone.utc),
            }},
            upsert=True,
        )

    def latest_results(self, batch_id: str) -> list:
        """Most recent run's results for the sidebar tab."""
        batch = self.get_batch(batch_id)
        if not batch or not batch.get("last_run_id"):
            return []
        return list(self.results.find(
            {"batch_id": batch_id, "run_id": batch["last_run_id"]},
            {"_id": 0},
        ))

    # ── Admin-wide views (every org) ─────────────────────────────────────────
    # Used only behind the admin gate. Mirrors how the iDEAL admin panel sees
    # all users' data, not just its own.

    def all_batches(self) -> list:
        """Every batch across every org, newest first."""
        return list(self.jobs.find({}, {"_id": 0}).sort("created_at", -1))

    def admin_overview(self) -> dict:
        """
        Operational metrics across ALL orgs for the admin dashboard:
          - total batches, and how many are active / paused / completed
          - distinct users (orgs) who have ever created a batch
          - distinct users with at least one ACTIVE batch (currently running)
          - total resumes enrolled across all batches
          - per-user breakdown: how many batches each user runs + their status
        """
        batches = self.all_batches()

        status_counts = {"active": 0, "paused": 0, "completed": 0}
        per_user: dict[str, dict] = {}
        total_resumes = 0
        active_users: set[str] = set()

        for b in batches:
            org = b.get("org_id", "unknown")
            status = b.get("status", "active")
            status_counts[status] = status_counts.get(status, 0) + 1
            n_res = len(b.get("resume_ids", []))
            total_resumes += n_res

            u = per_user.setdefault(org, {
                "org_id": org, "total_batches": 0,
                "active": 0, "paused": 0, "completed": 0,
                "resumes_enrolled": 0, "last_run": None,
            })
            u["total_batches"] += 1
            u[status] = u.get(status, 0) + 1
            u["resumes_enrolled"] += n_res
            lr = b.get("last_run")
            if lr and (u["last_run"] is None or lr > u["last_run"]):
                u["last_run"] = lr
            if status == "active":
                active_users.add(org)

        # Count distinct runs recorded (a rough "how many batch runs have fired").
        total_runs = len(self.results.distinct("run_id"))

        return {
            "total_batches":    len(batches),
            "status_counts":    status_counts,
            "distinct_users":   len(per_user),       # users who ever made a batch
            "active_users":     len(active_users),   # users with a live batch now
            "total_resumes_enrolled": total_resumes,
            "total_runs":       total_runs,
            "per_user":         sorted(
                per_user.values(),
                key=lambda x: x["total_batches"], reverse=True
            ),
        }
