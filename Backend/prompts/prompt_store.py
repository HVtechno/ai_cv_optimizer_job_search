"""
prompts/prompt_store.py — the prompt registry data layer.

DESIGN (mirrors your existing data layer exactly):
  - Reuses the SAME MongoDB() singleton from db.mongodb — no second client, no new
    connection. Just three NEW collections on the same `linkedin_jobs` db:

        prompt_versions      immutable; one document PER SAVE. Never updated,
                             never deleted. This IS the version history.
        prompt_active        one tiny document PER KEY: which version is live.
                             Rollback = rewrite this pointer. O(1), instant.
        prompt_deployments   the deploy queue + audit log (used from Phase 4/5).

  - Additive only: creating these collections does not touch jobs/users/resumes/
    job_matches/etc. Nothing reads them yet (Phase 3 wires reads in), so deploying
    this file changes NO runtime behavior.

  - Fail-safe like core/openai_client._track and db index setup: index creation is
    wrapped so a hiccup can never crash app startup.

VERSIONING MODEL:
  version_no is a per-key monotonically increasing integer (1, 2, 3, ...). It is
  allocated by counting existing versions for that key at insert time inside a
  single document insert. Last-write-wins on concurrent saves is acceptable here
  because prompt edits are a low-frequency, single-admin action (same assumption
  your monthly-usage counter makes).

NOTHING here calls OpenAI or touches resume outputs. It is pure storage.
"""

from datetime import datetime, timezone

from db.mongodb import MongoDB
from prompts.prompt_keys import is_valid_key, VALID_KEYS, resolve_default


def _utcnow():
    return datetime.now(timezone.utc)


class PromptStore:
    _ready = False

    def __init__(self):
        self._db = MongoDB()                 # reuse the singleton (same client)
        self.db = self._db.db                # the pymongo Database
        self.versions    = self.db["prompt_versions"]
        self.active      = self.db["prompt_active"]
        self.deployments = self.db["prompt_deployments"]
        self._ensure_indexes()

    # ── index setup (idempotent, fail-safe) ──────────────────────────────────
    def _ensure_indexes(self):
        if PromptStore._ready:
            return
        try:
            # History lookups + "latest version for key" are the hot paths.
            self.versions.create_index([("key", 1), ("version_no", -1)])
            self.versions.create_index([("key", 1), ("version_no", 1)], unique=True)
            # One active pointer per key.
            self.active.create_index("key", unique=True)
            # Deployment queue: find scheduled/pending by time and status.
            self.deployments.create_index([("status", 1), ("scheduled_for", 1)])
            self.deployments.create_index("deployment_id", unique=True)
            PromptStore._ready = True
        except Exception as e:
            print(f"[prompt_store] index setup skipped (non-fatal): {e}")

    # ── version writes (immutable) ───────────────────────────────────────────
    def _next_version_no(self, key: str) -> int:
        last = self.versions.find_one(
            {"key": key}, sort=[("version_no", -1)], projection={"version_no": 1}
        )
        return (last["version_no"] + 1) if last else 1

    def add_version(
        self,
        key: str,
        system_text: str,
        prompt_text: str,
        created_by: str = "system",
        note: str = "",
    ) -> dict:
        """
        Append a NEW immutable version for `key`. Returns the stored document
        (minus _id). Does NOT change which version is active — saving and
        deploying are deliberately separate actions.
        """
        if not is_valid_key(key):
            raise ValueError(f"Unknown prompt key: {key}")

        version_no = self._next_version_no(key)
        doc = {
            "key":          key,
            "version_no":   version_no,
            "system_text":  system_text or "",
            "prompt_text":  prompt_text or "",
            "created_by":   created_by or "system",
            "created_at":   _utcnow(),
            "note":         note or "",
        }
        self.versions.insert_one(dict(doc))   # copy so _id is not added to `doc`
        return doc

    # ── version reads ────────────────────────────────────────────────────────
    def get_version(self, key: str, version_no: int) -> dict | None:
        return self.versions.find_one(
            {"key": key, "version_no": int(version_no)}, {"_id": 0}
        )

    def list_versions(self, key: str, limit: int = 100) -> list:
        """Newest first. History for the admin UI."""
        cur = (
            self.versions.find({"key": key}, {"_id": 0})
            .sort("version_no", -1)
            .limit(int(limit))
        )
        return list(cur)

    def latest_version_no(self, key: str) -> int | None:
        doc = self.versions.find_one(
            {"key": key}, sort=[("version_no", -1)], projection={"version_no": 1}
        )
        return doc["version_no"] if doc else None

    # ── active pointer (deploy / rollback target) ────────────────────────────
    # NOTE: Phase 1 exposes these so the store is complete and testable, but no
    # live code path calls get_active_text yet. Phase 3 introduces the shim that
    # does — and even that falls back to your hardcoded constant.
    def get_active_pointer(self, key: str) -> dict | None:
        return self.active.find_one({"key": key}, {"_id": 0})

    def set_active(self, key: str, version_no: int, deployed_by: str = "system") -> dict:
        """
        Point `key` at an existing version. Used by deploy AND rollback (rollback
        is just set_active to an older version_no). Verifies the version exists
        first so we can never activate a non-existent version.
        """
        if not is_valid_key(key):
            raise ValueError(f"Unknown prompt key: {key}")
        if self.get_version(key, version_no) is None:
            raise ValueError(f"Version {version_no} does not exist for key {key}")

        pointer = {
            "key":                key,
            "active_version_no":  int(version_no),
            "deployed_at":        _utcnow(),
            "deployed_by":        deployed_by or "system",
        }
        self.active.update_one({"key": key}, {"$set": pointer}, upsert=True)
        return pointer

    def get_active_text(self, key: str) -> dict | None:
        """
        Resolve the currently-deployed (system_text, prompt_text) for a key.
        Returns the full version doc, or None if nothing is deployed for it yet.

        This is the ONLY method Phase 3's shim needs. Until a key is deployed,
        this returns None and the shim falls back to the hardcoded constant.
        """
        ptr = self.get_active_pointer(key)
        if not ptr:
            return None
        return self.get_version(key, ptr["active_version_no"])

    # ── seeding (one-time, explicit, safe) ───────────────────────────────────
    def seed_from_constants(self, created_by: str = "seed") -> dict:
        """
        For every catalog key that has NO versions yet, create version 1 from the
        live constant and mark it active. Idempotent: a key that already has any
        version is skipped entirely, so re-running never duplicates or overwrites.

        This makes the registry start as a faithful mirror of TODAY's prompts —
        so when Phase 3 wires reads in, get_active_text returns text identical to
        the constant, and behavior is unchanged.

        Returns a per-key report. Never raises for a single bad key.
        """
        report = {"seeded": [], "skipped": [], "failed": []}
        for key in VALID_KEYS:
            try:
                if self.latest_version_no(key) is not None:
                    report["skipped"].append(key)
                    continue
                default_text = resolve_default(key)
                if default_text is None:
                    report["failed"].append({"key": key, "reason": "no default resolved"})
                    continue
                # System prompts vs user prompts: our catalog stores each separately,
                # so a given key holds EITHER a system OR a prompt string. We put the
                # resolved text in the matching slot and leave the other empty.
                is_system = key.endswith("_system")
                v = self.add_version(
                    key=key,
                    system_text=default_text if is_system else "",
                    prompt_text="" if is_system else default_text,
                    created_by=created_by,
                    note="seeded from live constant",
                )
                self.set_active(key, v["version_no"], deployed_by=created_by)
                report["seeded"].append(key)
            except Exception as e:
                report["failed"].append({"key": key, "reason": str(e)})
        return report

    # ── deployment records (storage only in Phase 1; used in Phase 4/5) ───────
    def create_deployment(self, doc: dict) -> dict:
        """Insert a deployment record as-is. Schema is owned by Phase 4/5; Phase 1
        only provides the collection + insert so the store is complete."""
        rec = dict(doc)
        rec.setdefault("created_at", _utcnow())
        self.deployments.insert_one(dict(rec))
        rec.pop("_id", None)
        return rec

    # ── Phase 4: deploy / rollback ────────────────────────────────────────────
    # Deploy and rollback are the SAME primitive: point a key's active pointer at
    # a chosen existing version. We record each as an immutable log entry so the
    # admin has a full audit trail of what went live, when, and by whom.

    def deploy_version(
        self,
        key: str,
        version_no: int,
        deployed_by: str = "system",
        action: str = "deploy",
        note: str = "",
    ) -> dict:
        """
        Make `version_no` the live version for `key`, and log it.

        `action` is "deploy" or "rollback" — purely a label for the audit log;
        mechanically they are identical (move the pointer). set_active validates
        that the target version exists, so we can never activate a missing one.

        Returns {pointer, log}. Raises ValueError on bad key/version (caller maps
        to a 4xx). The active-pointer move is atomic at the document level.
        """
        prev = self.get_active_pointer(key)
        prev_version = prev["active_version_no"] if prev else None

        pointer = self.set_active(key, version_no, deployed_by=deployed_by)

        import uuid
        log = {
            "type":             "prompt_activation",
            "deployment_id":    f"act_{uuid.uuid4().hex}",  # own id: never collides
            "action":           action,                 # deploy | rollback
            "key":              key,
            "from_version_no":  prev_version,
            "to_version_no":    int(version_no),
            "deployed_by":      deployed_by or "system",
            "deployed_at":      pointer["deployed_at"],
            "note":             note or "",
        }
        try:
            self.deployments.insert_one(dict(log))
        except Exception as e:
            # Logging must never undo a successful pointer move. Surface, don't fail.
            print(f"[prompt_store] activation log write failed (non-fatal): {e}")
        log.pop("_id", None)
        return {"pointer": pointer, "log": log}

    def activation_history(self, key: str | None = None, limit: int = 100) -> list:
        """Newest-first deploy/rollback log, optionally filtered to one key."""
        q = {"type": "prompt_activation"}
        if key:
            q["key"] = key
        cur = (
            self.deployments.find(q, {"_id": 0})
            .sort("deployed_at", -1)
            .limit(int(limit))
        )
        return list(cur)

    # ── Phase 5: safe discard of a draft version ──────────────────────────────
    def discard_version(self, key: str, version_no: int) -> dict:
        """
        Permanently delete ONE draft version — but only when it is safe:
          - It must NOT be the currently live version.
          - It must NOT be referenced by any deploy/rollback history entry
            (from_version_no or to_version_no), so the audit trail stays intact.
          - It must NOT be the target of a pending scheduled deploy.
        Raises ValueError (caller -> 4xx) if any guard fails. This is the only
        delete path; we never expose raw version deletion.
        """
        if not is_valid_key(key):
            raise ValueError(f"Unknown prompt key: {key}")
        version_no = int(version_no)

        if self.get_version(key, version_no) is None:
            raise ValueError(f"Version {version_no} does not exist for key {key}")

        ptr = self.get_active_pointer(key)
        if ptr and ptr.get("active_version_no") == version_no:
            raise ValueError("Cannot discard the live version. Deploy or roll back to another version first.")

        ref = self.deployments.find_one({
            "type": "prompt_activation",
            "key": key,
            "$or": [{"from_version_no": version_no}, {"to_version_no": version_no}],
        })
        if ref:
            raise ValueError("Cannot discard a version that appears in deploy history.")

        pending = self.deployments.find_one({
            "type": "scheduled_deploy",
            "status": "scheduled",
            "key": key,
            "version_no": version_no,
        })
        if pending:
            raise ValueError("Cannot discard a version with a pending scheduled deploy. Cancel the schedule first.")

        self.versions.delete_one({"key": key, "version_no": version_no})
        return {"discarded": True, "key": key, "version_no": version_no}

