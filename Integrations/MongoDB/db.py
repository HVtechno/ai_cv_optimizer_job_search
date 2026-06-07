from pymongo import MongoClient, UpdateOne
import os
from dotenv import load_dotenv
from urllib.parse import quote_plus
from datetime import datetime, timezone

load_dotenv()


class MongoDB:
    def __init__(self):
        username = quote_plus(os.getenv("MONGODB_USERNAME"))
        password = quote_plus(os.getenv("MONGODB_PASSWORD"))
        cluster = os.getenv("MONGODB_CLUSTER")

        uri = (
            f"mongodb+srv://{username}:{password}"
            f"@{cluster}/?retryWrites=true&w=majority"
        )

        self.client = MongoClient(uri)

        self.db = self.client["linkedin_jobs"]
        self.collection = self.db["jobs"]

        # Indexes
        self.collection.create_index("job_id", unique=True)
        self.collection.create_index("expireAt", expireAfterSeconds=0)

    # ------------------------
    # SAFE JOB UPSERT
    # ------------------------
    def bulk_upsert_jobs(self, jobs: list):
        operations = []

        for job in jobs:
            if not job.get("job_id"):
                continue

            safe_job = {
                k: v for k, v in job.items()
                if k not in [
                    "embedding_chunks",
                    "embedding_created",
                    "embedding_hash",
                    "embedding_version_id",
                    "embedding_model",
                ]
            }

            operations.append(
                UpdateOne(
                    {"job_id": job["job_id"]},
                    {"$set": safe_job},
                    upsert=True
                )
            )

        if operations:
            result = self.collection.bulk_write(
                operations,
                ordered=False
            )

            print(
                f"✅ Upserted jobs: "
                f"{result.upserted_count}, "
                f"Modified: {result.modified_count}"
            )

    # ------------------------
    # SAVE EMBEDDINGS
    # ------------------------
    def bulk_update_embeddings(self, jobs: list):
        operations = []

        for job in jobs:
            operations.append(
                UpdateOne(
                    {"job_id": job["job_id"]},
                    {
                        "$set": {
                            "embedding_chunks": job["embedding_chunks"],
                            "embedding_created": True,
                            "embedding_hash": job["embedding_hash"],
                            "embedding_version_id": job["embedding_version_id"],
                            "embedding_model": job["embedding_model"],
                        }
                    }
                )
            )

        if operations:
            result = self.collection.bulk_write(
                operations,
                ordered=False
            )

            print(
                f"✅ Embeddings saved: "
                f"Modified {result.modified_count} jobs"
            )

    # ------------------------
    # GET JOBS FOR EMBEDDING
    # ------------------------
    def get_jobs_for_embedding(self, limit=500):
        return list(
            self.collection.find({
                "descriptionText": {
                    "$exists": True,
                    "$ne": ""
                },
                "embedding_created": {"$ne": True}
            }).limit(limit)
        )

    # ------------------------
    # DELETE EXPIRED
    # ------------------------
    def delete_expired_jobs(self):
        now = datetime.now(timezone.utc)

        expired_count = self.collection.count_documents({
            "expireAt": {"$lt": now}
        })

        print(f"🧹 Found {expired_count} expired jobs")

        result = self.collection.delete_many({
            "expireAt": {"$lt": now}
        })

        print(f"🗑️ Deleted {result.deleted_count} expired jobs")

        return result.deleted_count

    # ------------------------
    # GET JOBS WITH CHANGED DESCRIPTIONS
    # ------------------------
    def get_jobs_with_changed_descriptions(self, batch_size=500):
        """
        Returns already-embedded jobs whose current descriptionText hash
        no longer matches their stored embedding_hash — i.e. the description
        changed on LinkedIn since it was embedded.

        Checks ALL embedded jobs (no limit). Hashing is done in Python
        (Mongo can't hash), using only fields that already exist on
        embedded documents. Jobs whose description is unchanged are NOT
        returned, so they are never needlessly re-embedded.

        Yields lists of full job documents in batches.
        """
        from embeddings.embedding_service import hash_text, MAX_CHARS

        candidates = self.collection.find(
            {
                "descriptionText": {"$exists": True, "$ne": ""},
                "embedding_created": True,
                "embedding_hash": {"$exists": True},
            },
            # only pull the fields needed to compare — keeps the scan cheap
            {"job_id": 1, "descriptionText": 1, "embedding_hash": 1},
        )

        changed_ids = []
        for doc in candidates:
            text = (doc.get("descriptionText") or "").strip()
            if len(text) < 20:
                continue
            if hash_text(text[:MAX_CHARS]) != doc.get("embedding_hash"):
                changed_ids.append(doc["job_id"])

        print(f"🔁 Found {len(changed_ids)} jobs with changed descriptions")

        if not changed_ids:
            return

        # yield full docs in batches so the caller can re-embed incrementally
        for i in range(0, len(changed_ids), batch_size):
            id_batch = changed_ids[i:i + batch_size]
            yield list(
                self.collection.find({"job_id": {"$in": id_batch}})
            )