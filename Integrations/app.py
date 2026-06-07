from LinkedIn.ds import LinkedInScraper
from MongoDB.db import MongoDB
from embeddings.embedding_service import process_embeddings

import pandas as pd

from langdetect import detect, DetectorFactory
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta, timezone

DetectorFactory.seed = 0

ALLOWED_LANGUAGES = {"en", "nl"}


# ------------------------
# LANGUAGE DETECTION
# ------------------------
def detect_language(text: str) -> str:
    if not text or len(text.strip()) < 20:
        return "unknown"

    try:
        return detect(text[:1000])

    except Exception:
        return "unknown"


# ------------------------
# DATE PARSING
# ------------------------
def parse_datetime_fields(job: dict):

    # postedAt
    if job.get("postedAt"):

        dt = pd.to_datetime(
            job["postedAt"],
            errors="coerce",
            utc=True
        )

        job["postedAt"] = (
            dt.to_pydatetime()
            if pd.notnull(dt)
            else None
        )

    # timestamps
    for col in ["postedAtTimestamp", "expireAt"]:

        if job.get(col):

            try:
                dt = pd.to_datetime(
                    int(job[col]),
                    unit="ms",
                    errors="coerce",
                    utc=True
                )

                job[col] = (
                    dt.to_pydatetime()
                    if pd.notnull(dt)
                    else None
                )

            except Exception:
                job[col] = None

    return job


# ------------------------
# NORMALIZE JOB
# ------------------------
def normalize_job(job):

    description = job.get("descriptionText") or ""

    cleaned = {
        "job_id": job.get("id"),
        "link": job.get("link"),
        "applyUrl": job.get("applyUrl") or job.get("link"),
        "title": job.get("title"),
        "standardizedTitle": job.get("standardizedTitle"),
        "companyName": job.get("companyName"),
        "location": job.get("location"),
        "postedAt": job.get("postedAt"),
        "postedAtTimestamp": job.get("postedAtTimestamp"),
        "expireAt": job.get("expireAt"),
        "descriptionText": description,
        "jobPostedLanguage": detect_language(description),
        "scrapedAt": pd.Timestamp.now(
            tz="UTC"
        ).to_pydatetime(),
    }

    job = parse_datetime_fields(cleaned)

    # fallback: scraper gave no expireAt -> derive from postedAt + 30 days,
    # else scrapedAt + 30 days
    if not job.get("expireAt"):
        posted = job.get("postedAt")
        if posted:
            if posted.tzinfo is None:
                posted = posted.replace(tzinfo=timezone.utc)
            job["expireAt"] = posted + timedelta(days=30)
        else:
            job["expireAt"] = job["scrapedAt"] + timedelta(days=30)

    return job

# ------------------------
# MAIN PIPELINE
# ------------------------
def main():

    scraper = LinkedInScraper()
    db = MongoDB()

    print("🚀 Streaming jobs...")

    batch = []
    batch_size = 20
    total = 0

    futures = []

    # ------------------------
    # SCRAPE + UPSERT
    # ------------------------
    with ThreadPoolExecutor(max_workers=5) as executor:

        for raw_job in scraper.stream_jobs():

            job = normalize_job(raw_job)

            if job.get("jobPostedLanguage") not in ALLOWED_LANGUAGES:
                continue

            batch.append(job)

            total += 1

            if len(batch) >= batch_size:

                futures.append(
                    executor.submit(
                        db.bulk_upsert_jobs,
                        batch.copy()
                    )
                )

                batch = []

            if total % 50 == 0:
                print(f"📥 Processed {total} jobs...")

        # remaining batch
        if batch:
            futures.append(
                executor.submit(
                    db.bulk_upsert_jobs,
                    batch
                )
            )

        # wait all writes
        write_failed = False
        for f in futures:
            try:
                f.result()
            except Exception as e:
                write_failed = True
                print(f"⚠️ Write failed: {e}")

    print(f"✅ Total processed: {total}")

    # ------------------------
    # CLEANUP
    # ------------------------
    if write_failed:
        print("⚠️ Some writes failed — skipping delete step for safety")
    else:
        print("🧹 Cleaning expired jobs...")
        db.delete_expired_jobs()

    # ------------------------
    # EMBEDDINGS
    # ------------------------
    print("🧠 Generating embeddings...")

    total_embedded = 0

    while True:
        jobs = db.get_jobs_for_embedding(limit=500)

        print(f"📊 Jobs fetched for embedding: {len(jobs)}")

        if not jobs:
            break

        processed_jobs = process_embeddings(jobs)

        if not processed_jobs:
            break

        db.bulk_update_embeddings(processed_jobs)
        total_embedded += len(processed_jobs)

        print(f"✅ Embedded {len(processed_jobs)} jobs (running total: {total_embedded})")

    if total_embedded == 0:
        print("✅ No jobs needed embedding")
    else:
        print(f"✅ Total embedded this run: {total_embedded}")

    # ------------------------
    # RE-EMBED CHANGED DESCRIPTIONS
    # ------------------------
    print("🔁 Re-checking for changed descriptions...")

    total_reembedded = 0

    for changed_jobs in db.get_jobs_with_changed_descriptions(batch_size=500):

        if not changed_jobs:
            continue

        # reset the flag so the existing filter re-embeds them
        for j in changed_jobs:
            j["embedding_created"] = False

        processed_jobs = process_embeddings(changed_jobs)

        if not processed_jobs:
            continue

        db.bulk_update_embeddings(processed_jobs)
        total_reembedded += len(processed_jobs)

        print(f"♻️ Re-embedded {len(processed_jobs)} changed jobs (running total: {total_reembedded})")

    if total_reembedded == 0:
        print("✅ No changed descriptions to re-embed")
    else:
        print(f"✅ Total re-embedded this run: {total_reembedded}")

    # stop Mongo monitor threads cleanly
    db.client.close()


# ------------------------
if __name__ == "__main__":
    main()