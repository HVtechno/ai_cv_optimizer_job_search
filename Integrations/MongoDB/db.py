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