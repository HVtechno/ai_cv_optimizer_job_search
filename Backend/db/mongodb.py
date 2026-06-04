from pymongo import MongoClient
from urllib.parse import quote_plus
from datetime import datetime, timezone
import os
from dotenv import load_dotenv

load_dotenv()


class MongoDB:
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            username = quote_plus(os.getenv("MONGODB_USERNAME", ""))
            password = quote_plus(os.getenv("MONGODB_PASSWORD", ""))
            cluster  = os.getenv("MONGODB_CLUSTER", "")
            uri = (
                f"mongodb+srv://{username}:{password}@{cluster}"
                f"/?retryWrites=true&w=majority"
            )
            inst = super().__new__(cls)
            inst.client = MongoClient(uri)
            inst.db     = inst.client["linkedin_jobs"]

            # Collections
            inst.jobs              = inst.db["jobs"]
            inst.users             = inst.db["users"]
            inst.resumes           = inst.db["resumes"]           # metadata + text, NO binary
            inst.resume_embeddings = inst.db["resume_embeddings"] # keyed by resume_hash
            inst.job_embeddings    = inst.db["job_embeddings"]    # keyed by job_id
            inst.job_matches       = inst.db["job_matches"]       # keyed by resume_id
            inst.feedback          = inst.db["feedback"]          # user feedback entries

            cls._instance = inst
        return cls._instance

    # ── Vector search ─────────────────────────────────────────────────────────

    def search_similar_jobs(self, query_embedding: list, limit: int = 50) -> list:
        pipeline = [
            {
                "$vectorSearch": {
                    "index": "airesume",
                    "path": "embedding_chunks",
                    "queryVector": query_embedding,
                    "numCandidates": limit * 10,
                    "limit": limit,
                }
            },
            {
                "$project": {
                    "_id": 0,
                    "job_id": 1,
                    "title": 1,
                    "descriptionText": 1,
                    "companyName": 1,
                    "link": 1,
                    "location": 1,
                    "expireAt": 1,
                    # Needed by filter_jobs — without these the language/recency
                    # filters have no field to read and silently pass everything.
                    "jobPostedLanguage": 1,
                    "postedAt": 1,
                    # Include the precomputed job embedding so the scoring path can
                    # reuse it directly instead of re-embedding the description via
                    # a paid OpenAI call. Same model/space as the resume embedding
                    # (text-embedding-3-large, 3072-dim).
                    "embedding_chunks": 1,
                    "score": {"$meta": "vectorSearchScore"},
                }
            },
        ]
        return list(self.jobs.aggregate(pipeline))

    # ── Users ───────────────────────────────────────────────────────────────
    # Email is the canonical user_id across the whole data layer. New users are
    # created in auth.signup with a `plan` field; legacy users with no `plan`
    # field read as "basic" via core.plans.normalize_plan, so nothing here needs
    # a migration.

    def get_user(self, email: str) -> dict | None:
        """Full user document (minus _id)."""
        return self.users.find_one({"email": email}, {"_id": 0})

    # ── Email verification helpers (additive) ─────────────────────────────────
    # Existing users have no `verified` field. We treat a MISSING field as "not
    # verified" so the strict-login rule applies to everyone, but the login route
    # auto-sends a fresh verification email so nobody is locked out without a
    # path back in.

    def is_user_verified(self, email: str) -> bool:
        doc = self.users.find_one({"email": email}, {"_id": 0, "verified": 1})
        return bool(doc and doc.get("verified") is True)

    def mark_user_verified(self, email: str):
        from datetime import datetime, timezone
        self.users.update_one(
            {"email": email},
            {"$set": {"verified": True, "verified_at": datetime.now(timezone.utc)}},
        )

    def set_user_password(self, email: str, hashed_password: str):
        """Used by the password-reset flow. Stores an already-hashed password."""
        self.users.update_one(
            {"email": email},
            {"$set": {"password": hashed_password}},
        )

    def get_user_by_stripe_customer(self, customer_id: str) -> dict | None:
        """Used by the Stripe webhook to map an event back to our user."""
        if not customer_id:
            return None
        return self.users.find_one({"stripe_customer_id": customer_id}, {"_id": 0})

    def set_stripe_customer_id(self, email: str, customer_id: str):
        """Persist the Stripe customer id the first time we create one."""
        self.users.update_one(
            {"email": email},
            {"$set": {"stripe_customer_id": customer_id}},
        )

    def update_user_subscription(
        self,
        email: str,
        *,
        plan: str,
        subscription_status: str | None = None,
        stripe_subscription_id: str | None = None,
        current_period_end=None,
    ):
        """
        Single place that flips a user's plan. Called by the Stripe webhook on
        checkout completion / subscription update / cancellation, and by you
        manually for enterprise deals.
        """
        update = {"plan": plan, "subscription_updated_at": datetime.now(timezone.utc)}
        if subscription_status is not None:
            update["subscription_status"] = subscription_status
        if stripe_subscription_id is not None:
            update["stripe_subscription_id"] = stripe_subscription_id
        if current_period_end is not None:
            update["current_period_end"] = current_period_end
        self.users.update_one({"email": email}, {"$set": update})

    # ── Monthly usage counter (for free-tier refresh cap) ──────────────────────
    # Keyed per user per calendar month: {"usage": {"2026-05": {"refreshes": 2}}}.
    # Cheap, self-resetting (a new month is just a new key), no cron needed.

    def _month_key(self) -> str:
        now = datetime.now(timezone.utc)
        return f"{now.year:04d}-{now.month:02d}"

    def get_usage_this_month(self, email: str, metric: str) -> int:
        doc = self.users.find_one(
            {"email": email},
            {"_id": 0, f"usage.{self._month_key()}.{metric}": 1},
        )
        if not doc:
            return 0
        return (
            doc.get("usage", {})
               .get(self._month_key(), {})
               .get(metric, 0)
        )

    def increment_usage(self, email: str, metric: str, amount: int = 1):
        self.users.update_one(
            {"email": email},
            {"$inc": {f"usage.{self._month_key()}.{metric}": amount}},
        )

    def count_user_resumes(self, email: str) -> int:
        """How many resumes this user currently has (for the upload cap)."""
        return self.resumes.count_documents({"user_id": email})

    # ── Optimization metering ──────────────────────────────────────────────────
    # An "optimized job" = a distinct job a user has claimed for rewrite/cover/
    # motivation. We store the SET of claimed job_ids (not a counter) so that:
    #   - generating any artifact for an already-claimed job is always allowed,
    #   - claiming a NEW job is what consumes quota,
    #   - the count is just len(set).
    #
    # FREE: claimed jobs live on the user doc per month -> usage.{month}.optimized_jobs
    # PRO : claimed jobs live on the resume doc        -> optimized_jobs (per resume)
    # Enterprise: unlimited (we still record for display, harmless).

    # -- monthly (free) --
    def get_optimized_jobs_this_month(self, email: str) -> list:
        mk = self._month_key()
        doc = self.users.find_one(
            {"email": email},
            {"_id": 0, f"usage.{mk}.optimized_jobs": 1},
        )
        if not doc:
            return []
        return doc.get("usage", {}).get(mk, {}).get("optimized_jobs", []) or []

    def add_optimized_job_month(self, email: str, job_id: str):
        """Add job_id to this month's claimed set (no-op if already present)."""
        mk = self._month_key()
        self.users.update_one(
            {"email": email},
            {"$addToSet": {f"usage.{mk}.optimized_jobs": job_id}},
        )

    # -- per-resume (pro) --
    def get_optimized_jobs_resume(self, resume_id: str) -> list:
        doc = self.resumes.find_one(
            {"resume_id": resume_id},
            {"_id": 0, "optimized_jobs": 1},
        )
        if not doc:
            return []
        return doc.get("optimized_jobs", []) or []

    def add_optimized_job_resume(self, resume_id: str, job_id: str):
        self.resumes.update_one(
            {"resume_id": resume_id},
            {"$addToSet": {"optimized_jobs": job_id}},
        )

    # -- per-resume refresh counter (pro) --
    def get_resume_refresh_count(self, resume_id: str) -> int:
        doc = self.resumes.find_one(
            {"resume_id": resume_id},
            {"_id": 0, "refresh_used": 1},
        )
        if not doc:
            return 0
        return int(doc.get("refresh_used", 0) or 0)

    def increment_resume_refresh_count(self, resume_id: str, amount: int = 1):
        self.resumes.update_one(
            {"resume_id": resume_id},
            {"$inc": {"refresh_used": amount}},
        )

    # ── Feedback ────────────────────────────────────────────────────────────────
    # A 1-5 star rating + optional comment. `source` is "optimization" (the
    # periodic prompt) or "settings" (the always-available link). The periodic
    # prompt is gated by last_feedback_prompt on the user doc (30-day cooldown).

    def save_feedback(self, email: str, rating: int, comment: str, source: str):
        from datetime import datetime, timezone
        self.feedback.insert_one({
            "email":      email,
            "rating":     int(rating),
            "comment":    (comment or "").strip(),
            "source":     source,
            "created_at": datetime.now(timezone.utc),
        })

    def get_last_feedback_prompt(self, email: str):
        doc = self.users.find_one({"email": email}, {"_id": 0, "last_feedback_prompt": 1})
        return (doc or {}).get("last_feedback_prompt")

    def set_last_feedback_prompt(self, email: str):
        """Stamp 'now' as the last time we prompted this user (starts cooldown).
        Called whether they rate OR dismiss, so dismiss also respects cooldown."""
        from datetime import datetime, timezone
        self.users.update_one(
            {"email": email},
            {"$set": {"last_feedback_prompt": datetime.now(timezone.utc)}},
        )

    # ── Account deletion ────────────────────────────────────────────────────────
    # Wipes EVERYTHING for a user: their resumes, embeddings (only those no other
    # resume shares), job_matches, and the user document itself. Returns a small
    # summary dict for logging/UX. The Stripe subscription is cancelled separately
    # in the route (so the DB layer stays Stripe-agnostic).

    def delete_account(self, email: str) -> dict:
        # Gather this user's resumes first so we can clean their embeddings.
        resumes = list(self.resumes.find({"user_id": email}, {"_id": 0, "resume_id": 1, "resume_hash": 1}))
        resume_ids = [r.get("resume_id") for r in resumes if r.get("resume_id")]
        hashes     = [r.get("resume_hash") for r in resumes if r.get("resume_hash")]

        # Delete job_matches for each resume.
        jm_deleted = 0
        for rid in resume_ids:
            jm_deleted += self.job_matches.delete_many({"resume_id": rid}).deleted_count

        # Delete the resumes.
        res_deleted = self.resumes.delete_many({"user_id": email}).deleted_count

        # Delete embeddings only for hashes no longer referenced by ANY resume
        # (another user could share an identical resume hash — don't nuke theirs).
        emb_deleted = 0
        for h in set(hashes):
            if h and self.resumes.count_documents({"resume_hash": h}) == 0:
                emb_deleted += self.resume_embeddings.delete_one({"resume_hash": h}).deleted_count

        # Finally, the user document.
        user_deleted = self.users.delete_one({"email": email}).deleted_count

        # Their feedback entries too (keyed by email, which is being removed).
        fb_deleted = self.feedback.delete_many({"email": email}).deleted_count

        return {
            "resumes_deleted":     res_deleted,
            "job_matches_deleted": jm_deleted,
            "embeddings_deleted":  emb_deleted,
            "feedback_deleted":    fb_deleted,
            "user_deleted":        bool(user_deleted),
        }

    # ── Resume ────────────────────────────────────────────────────────────────

    def save_resume(self, doc: dict):
        self.resumes.insert_one(doc)

    def get_resume(self, resume_id: str) -> dict | None:
        return self.resumes.find_one({"resume_id": resume_id}, {"_id": 0})

    def get_user_resumes(self, user_id: str) -> list:
        return list(self.resumes.find(
            {"user_id": user_id},
            {"_id": 0, "resume_id": 1, "file_name": 1, "uploaded_at": 1,
             "has_embedding": 1, "filters": 1, "candidate_name": 1},  # NEW: candidate_name
        ))

    def update_resume_filters(self, resume_id: str, filters: dict):
        """Overwrite the saved filters on a resume (used when the user edits
        filters via the Agent/refresh modal)."""
        self.resumes.update_one(
            {"resume_id": resume_id},
            {"$set": {"filters": filters}},
        )

    def update_resume_candidate_name(self, resume_id: str, candidate_name: str):
        """Set/overwrite the user-chosen candidate display name on a resume.
        Used when the name is edited via the Agent/refresh modal."""
        self.resumes.update_one(
            {"resume_id": resume_id},
            {"$set": {"candidate_name": candidate_name}},
        )

    def get_user_resume_by_hash(self, user_id: str, resume_hash: str) -> dict | None:
        """
        Return this user's existing resume that matches the given content hash,
        or None. Used for duplicate detection on upload so we don't store a
        second copy of identical resume text.
        """
        if not resume_hash:
            return None
        return self.resumes.find_one(
            {"user_id": user_id, "resume_hash": resume_hash},
            {"_id": 0},
        )

    def delete_resume(self, resume_id: str, user_id: str) -> bool:
        result = self.resumes.delete_one({"resume_id": resume_id, "user_id": user_id})
        return result.deleted_count > 0

    # ── Resume embedding cache ────────────────────────────────────────────────

    def get_resume_embedding(self, resume_hash: str) -> list | None:
        doc = self.resume_embeddings.find_one({"resume_hash": resume_hash})
        return doc["embedding"] if doc else None

    def save_resume_embedding(self, resume_hash: str, embedding: list):
        self.resume_embeddings.update_one(
            {"resume_hash": resume_hash},
            {"$set": {"resume_hash": resume_hash, "embedding": embedding,
                      "updated_at": datetime.utcnow()}},
            upsert=True,
        )

    def count_resumes_by_hash(self, resume_hash: str) -> int:
        """Guard: how many resumes share this hash before deleting embedding."""
        return self.resumes.count_documents({"resume_hash": resume_hash})

    def delete_resume_embedding(self, resume_hash: str):
        self.resume_embeddings.delete_one({"resume_hash": resume_hash})

    def find_orphan_resume_embeddings(self) -> list:
        """
        Return resume_hash values that exist in resume_embeddings but are NOT
        referenced by any resume document. These are leftovers from abandoned
        uploads (e.g. a cancelled filter modal) and are safe to delete.
        """
        referenced = set(self.resumes.distinct("resume_hash"))
        all_hashes = set(self.resume_embeddings.distinct("resume_hash"))
        return list(all_hashes - referenced)

    def delete_orphan_resume_embeddings(self) -> int:
        """
        Delete every resume embedding not referenced by any resume document.
        Returns the number of embeddings removed. Safe to run repeatedly.
        """
        orphans = self.find_orphan_resume_embeddings()
        if not orphans:
            return 0
        result = self.resume_embeddings.delete_many({"resume_hash": {"$in": orphans}})
        return result.deleted_count

    # ── Job embedding cache ───────────────────────────────────────────────────

    def get_job_embedding(self, job_id: str) -> list | None:
        doc = self.job_embeddings.find_one({"job_id": job_id})
        return doc["embedding"] if doc else None

    def get_job_inline_embedding(self, job_id: str) -> list | None:
        """
        Fetch the precomputed embedding stored inline on the job document in the
        `jobs` collection (field: embedding_chunks). This is the canonical job
        vector (text-embedding-3-large, 3072-dim) and is free to read — no OpenAI
        call. Returns the raw value (caller normalizes shape) or None.
        """
        doc = self.jobs.find_one(
            {"job_id": job_id},
            {"_id": 0, "embedding_chunks": 1},
        )
        return doc.get("embedding_chunks") if doc else None

    def save_job_embedding(self, job_id: str, embedding: list):
        self.job_embeddings.update_one(
            {"job_id": job_id},
            {"$set": {"job_id": job_id, "embedding": embedding,
                      "updated_at": datetime.utcnow()}},
            upsert=True,
        )

    # ── Job matches ───────────────────────────────────────────────────────────

    def get_job_matches(self, resume_id: str) -> dict | None:
        return self.job_matches.find_one({"resume_id": resume_id}, {"_id": 0})

    def save_job_matches(self, resume_id: str, user_id: str, results: list):
        self.job_matches.update_one(
            {"resume_id": resume_id},
            {
                "$set": {
                    "resume_id":  resume_id,
                    "user_id":    user_id,
                    "results":    results,
                    "updated_at": datetime.utcnow(),
                },
                "$inc":         {"refresh_count": 1},
                "$setOnInsert": {"created_at": datetime.utcnow()},
            },
            upsert=True,
        )

    def delete_job_matches(self, resume_id: str):
        self.job_matches.delete_one({"resume_id": resume_id})

    # ------------- Save refresh History ---------------------------

    def push_refresh_history(self, resume_id: str, entry: dict):
        """
        Append a refresh event to the resume document's refresh_history array.
        Keeps only the last 50 entries to avoid unbounded growth.
        """
        from datetime import datetime
        entry["refreshed_at"] = entry.get("refreshed_at", datetime.utcnow())
        self.db.resumes.update_one(
            {"resume_id": resume_id},
            {
                "$push": {
                    "refresh_history": {
                        "$each":     [entry],
                        "$sort":     {"refreshed_at": -1},   # newest first
                        "$slice":    50,                       # keep last 50
                    }
                }
            }
        )


    def get_refresh_history(self, resume_id: str) -> list:
        """Return the refresh_history array for a resume, newest first."""
        doc = self.db.resumes.find_one(
            {"resume_id": resume_id},
            {"refresh_history": 1, "_id": 0}
        )
        if not doc:
            return []
        history = doc.get("refresh_history", [])
        # Serialize datetime objects to ISO strings for JSON response
        for entry in history:
            if isinstance(entry.get("refreshed_at"), __import__("datetime").datetime):
                entry["refreshed_at"] = entry["refreshed_at"].isoformat()
        return history