import hashlib
from core.openai_client import get_embedding
from db.mongodb import MongoDB

db = MongoDB()


def get_resume_hash(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


async def get_or_create_resume_embedding(resume_text: str) -> tuple[list, str]:
    """
    Returns (embedding, resume_hash).
    Checks MongoDB cache first — only calls OpenAI if not cached.
    """
    resume_hash = get_resume_hash(resume_text)
    cached = db.get_resume_embedding(resume_hash)

    if cached:
        print(f"✅ Resume embedding cache hit: {resume_hash[:12]}")
        return cached, resume_hash

    print(f"⚡ Creating new resume embedding: {resume_hash[:12]}")
    embedding = await get_embedding(resume_text)
    db.save_resume_embedding(resume_hash, embedding)
    return embedding, resume_hash


# ── Job embedding resolution ──────────────────────────────────────────────────
# Jobs in the `jobs` collection already carry their embedding inline as
# `embedding_chunks` (text-embedding-3-large, 3072-dim) — the SAME model and
# vector space as the resume embedding. So the scoring path can reuse that vector
# directly instead of paying OpenAI to re-embed the description. This eliminates a
# redundant API call per job per upload/refresh and removes the need to maintain a
# second `job_embeddings` collection.
#
# Resolution order:
#   1. Use the inline `embedding_chunks` carried on the job document (free).
#   2. Fall back to the legacy `job_embeddings` cache by job_id (free, transitional).
#   3. As a last resort only, embed the description text via OpenAI (paid) and
#      cache it — this should now be rare/never for real jobs.


def _normalize_embedding_chunks(raw) -> list | None:
    """
    `embedding_chunks` is expected to be a flat list[float] (a single 3072-dim
    vector). Defensively handle the case where it's stored as a nested list
    (e.g. [[...]] or multiple chunk vectors) by taking the first vector.
    Returns a flat list[float], or None if it doesn't look like an embedding.
    """
    if not raw:
        return None
    # Flat vector: list of numbers
    if isinstance(raw, list) and raw and isinstance(raw[0], (int, float)):
        return raw
    # Nested: list of vectors — use the first one
    if isinstance(raw, list) and raw and isinstance(raw[0], list):
        first = raw[0]
        if first and isinstance(first[0], (int, float)):
            return first
    return None


async def get_or_create_job_embedding(job_id: str, job_text: str, job: dict | None = None) -> list:
    """
    Return a job's embedding in the resume's vector space.

    `job` (the full job document/result) is optional but preferred: when provided,
    its inline `embedding_chunks` is reused directly — no API call, no cache write.
    `job_text` is kept for backwards compatibility and used only if no inline
    embedding and no cached embedding exist.
    """
    # 1. Reuse the precomputed inline embedding when available (free).
    if job is not None:
        inline = _normalize_embedding_chunks(job.get("embedding_chunks"))
        if inline is not None:
            return inline

    # 2. Fetch the canonical inline embedding straight from the jobs collection
    #    by job_id (free). Covers cases where the job dict in hand was stripped of
    #    embedding_chunks (e.g. jobs read back from job_matches).
    from_jobs = _normalize_embedding_chunks(db.get_job_inline_embedding(job_id))
    if from_jobs is not None:
        return from_jobs

    # 3. Transitional fallback: legacy per-job cache.
    cached = db.get_job_embedding(job_id)
    if cached:
        return cached

    # 4. Last resort: embed the text (paid). Should be rare now.
    print(f"⚡ Embedding job {job_id} via OpenAI (no inline/cached embedding found)")
    embedding = await get_embedding(job_text)
    db.save_job_embedding(job_id, embedding)
    return embedding