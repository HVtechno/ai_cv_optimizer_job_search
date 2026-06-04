# embeddings/embedding_service.py
import hashlib

from embeddings.openai_embeddings import (
    create_embeddings_batch,
    EMBEDDING_MODEL,
)

MAX_CHARS = 30000  # safety cap before the model's token limit


# ------------------------
# HASHING
# ------------------------
def hash_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


# ------------------------
# FILTER JOBS
# ------------------------
def filter_jobs_needing_embeddings(jobs):
    jobs_to_embed = []

    for job in jobs:
        text = (job.get("descriptionText") or "").strip()
        if len(text) < 20:
            continue

        new_hash = hash_text(text[:MAX_CHARS])

        already_embedded = (
            job.get("embedding_hash") == new_hash
            and job.get("embedding_created") is True
            and job.get("embedding_chunks")
            and job.get("embedding_model") == EMBEDDING_MODEL
        )

        if already_embedded:
            continue

        job["_embed_text"] = text[:MAX_CHARS]
        job["embedding_hash"] = new_hash
        job["embedding_model"] = EMBEDDING_MODEL
        jobs_to_embed.append(job)

    return jobs_to_embed


# ------------------------
# MAIN PIPELINE  (FLAT VECTORS)
# ------------------------
def process_embeddings(jobs, batch_size=100):
    print(f"📊 Jobs received: {len(jobs)}")

    jobs = filter_jobs_needing_embeddings(jobs)
    print(f"🧠 Jobs needing embeddings: {len(jobs)}")

    if not jobs:
        return []

    processed_jobs = []

    for i in range(0, len(jobs), batch_size):
        batch = jobs[i:i + batch_size]
        texts = [j["_embed_text"] for j in batch]

        print(
            f"🧠 Embedding batch "
            f"{i // batch_size + 1}/"
            f"{(len(jobs) - 1) // batch_size + 1} "
            f"({len(texts)} jobs)"
        )

        try:
            vectors = create_embeddings_batch(texts)
        except Exception as e:
            print(f"❌ Batch failed: {e}")
            continue

        for job, vector in zip(batch, vectors):
            job["embedding_chunks"] = vector          # FLAT 3072-dim vector
            job["embedding_created"] = True
            job["embedding_version_id"] = (
                f"{job['job_id']}:{job['embedding_hash']}"
            )
            job.pop("_embed_text", None)
            processed_jobs.append(job)

    print(f"✅ Successfully embedded: {len(processed_jobs)}")
    return processed_jobs