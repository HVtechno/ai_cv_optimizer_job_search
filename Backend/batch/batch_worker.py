"""
batch_worker.py — runs ONE batch run over its resume set.

It composes your EXISTING pipeline functions — nothing is reimplemented:
    get_or_create_resume_embedding  (embeddings.resume_embeddings)   [cached/free]
    search_similar_jobs             (db.mongodb)                     [free vector search]
    get_or_create_job_embedding     (embeddings.resume_embeddings)   [inline/free]
    score_resume_against_job        (services.ats_engine)            [paid LLM — capped]

COST CONTROL (the #1 risk in unattended batch):
    MAX_JOBS_PER_RESUME  caps how many jobs we LLM-score per resume.
    SCORE_CONCURRENCY    caps simultaneous OpenAI calls so a big batch can't
                         stampede your rate limit or your bill.
    include_summary=False on scoring skips the extra generate_summary LLM call
    for batch runs (the enterprise view wants ranked ATS, not prose per job).

IDEMPOTENCY:
    Before scoring a resume we check store.already_done(); a crashed run that is
    retried skips resumes already finished — no double spend.
"""

import asyncio
import uuid
from datetime import datetime, timezone

from embeddings.resume_embeddings import (
    get_or_create_resume_embedding,
    get_or_create_job_embedding,
)
from services.ats_engine import score_resume_against_job
from utils.helpers import filter_jobs   # reuse the EXACT site filter logic
from db.mongodb import MongoDB

# Tunable caps — conservative defaults. Raise deliberately, watch spend.
MAX_JOBS_PER_RESUME = 15
SCORE_CONCURRENCY   = 4
MATCH_POOL_LIMIT    = 50   # how many candidate jobs vector-search returns

# Vector-search pool size. This is a FREE Mongo operation (no OpenAI cost), and
# $vectorSearch always scans the entire collection and returns the most similar
# top-K — so these only control how many candidates the FILTER step sees, never
# the OpenAI bill (scoring is capped by the per-resume `cap`).
#   - DEFAULT: no filters -> the top 500 are already the most relevant.
#   - FILTERED: filters can thin the pool hard, so fetch a much wider set to
#     filter from. Capped at 1000 because your search_similar_jobs sets
#     numCandidates = limit * 10, and MongoDB Atlas caps numCandidates at 10000
#     (limit=1000 -> numCandidates=10000, the safe maximum). This keeps your
#     shared search function untouched while maximizing the filterable pool.
SEARCH_LIMIT_DEFAULT  = 500
SEARCH_LIMIT_FILTERED = 1000


async def _score_resume(db, resume_doc: dict, filters: dict | None = None,
                        max_jobs: int | None = None) -> list:
    """Run the existing pipeline for one resume. Returns ranked matches.

    `max_jobs` caps how many jobs are LLM-scored for this resume (cost control).
    Falls back to MAX_JOBS_PER_RESUME, hard-ceilinged at 100.
    """
    cap = max(1, min(int(max_jobs or MAX_JOBS_PER_RESUME), 100))
    resume_id   = resume_doc["resume_id"]
    resume_text = resume_doc.get("resume_text") or resume_doc.get("text", "")
    if not resume_text:
        return []
    # 1. Embedding — cached by hash, usually free on re-runs.
    try:
        resume_embedding, _ = await get_or_create_resume_embedding(resume_text)
    except Exception as e:
        print(f"[batch] embedding error resume={resume_id[:8]}: {e}")
        return [{"error": f"embedding failed: {e}"}]

    # 2. Match against ALREADY-SCRAPED pool (Mongo $vectorSearch — FREE; this is
    #    a Mongo operation, no OpenAI cost). $vectorSearch scans the WHOLE jobs
    #    collection and returns the top-K most similar, so a larger pool here just
    #    gives the filter step more to work with — it does NOT increase OpenAI
    #    spend (scoring is capped separately by `cap`).
    #
    #    Adaptive limit: when filters are active they can thin the pool heavily
    #    (e.g. Dutch + city + recency intersect down to a handful), so we fetch a
    #    much wider pool to filter from. Without filters, the top 500 already are
    #    the most relevant, so no need to over-fetch.
    search_limit = SEARCH_LIMIT_FILTERED if filters else SEARCH_LIMIT_DEFAULT
    try:
        candidates = db.search_similar_jobs(resume_embedding, limit=search_limit)
    except Exception as e:
        print(f"[batch] vector search error resume={resume_id[:8]}: {e}")
        return [{"error": f"job search failed: {e}"}]
    n_found = len(candidates)

    # 2b. Apply the user's filters with the existing site logic (reused as-is).
    filter_wiped_all = False
    if filters:
        print(f"[batch] applying filters: {filters}")
        filtered = filter_jobs(
            jobs=candidates,
            languages=filters.get("languages"),
            expiry_days=filters.get("expiry_days"),
            location=filters.get("location"),
            radius_km=filters.get("radius_km"),
            remote_only=filters.get("remote_only", False),
        )
        if len(filtered) == 0 and len(candidates) > 0:
            # Filters excluded everything (commonly an unrecognized city, since
            # geocoding only covers known NL cities). Rather than return a blank,
            # keep the top vector matches and flag it so the user understands why.
            filter_wiped_all = True
            print(f"[batch] filters removed ALL {len(candidates)} jobs — "
                  f"falling back to unfiltered top matches")
        else:
            candidates = filtered
    n_after_filter = len(candidates)

    # 3. Cap how many we LLM-score (cost control), AFTER filtering.
    candidates = candidates[:cap]
    print(f"[batch] resume={resume_id[:8]} pool={search_limit} found={n_found} "
          f"after_filter={n_after_filter} scoring={len(candidates)} (cap={cap})")

    # 3. Score each candidate, bounded concurrency to protect rate limit + cost.
    sem = asyncio.Semaphore(SCORE_CONCURRENCY)

    async def _one(job):
        async with sem:
            try:
                job_emb = await get_or_create_job_embedding(
                    job.get("job_id", ""), job.get("descriptionText", ""), job=job
                )
                res = await score_resume_against_job(
                    resume_text, resume_embedding, job, job_emb,
                    include_summary=False,          # batch: ranked score, no prose
                )
                return {
                    "job_id":  job.get("job_id"),
                    "title":   job.get("title"),
                    "company": job.get("companyName"),
                    "link":    job.get("link"),
                    "score":   res["score"],
                    "interview_probability":   res["interview_probability"],
                    "missing_keywords":        res["missing_keywords"][:10],
                    "missing_skills":          res["missing_skills"][:10],
                    # NEW — surfaced in the batch "Analysis" popover (strong/weak/gaps).
                    # Purely additive: existing rows/CSV ignore these extra keys.
                    "matched_keywords":        res.get("matched_keywords", [])[:10],
                    "strong_skills":           res.get("strong_skills", [])[:10],
                    "weak_skills":             res.get("weak_skills", [])[:10],
                    # NEW — kept so the Align action can bridge this exact job into the
                    # resume's dashboard job_matches (the shape optimize_resume expects).
                    # Not shown in the table; stripped of the heavy embedding vector.
                    "_job":  {k: v for k, v in job.items() if k != "embedding_chunks"},
                    "_ats":  res,
                }
            except Exception as e:
                print(f"[batch] score error job={job.get('job_id')}: {e}")
                return None

    scored = await asyncio.gather(*[_one(j) for j in candidates])
    matches = [m for m in scored if m]   # drop any individual failures
    matches.sort(key=lambda m: m["score"], reverse=True)
    if filter_wiped_all and matches:
        # Mark the first row so the UI can note the filter matched nothing.
        matches[0] = {**matches[0], "_filter_note":
                      "Your filter matched no jobs in the pool — showing closest matches instead."}
    return matches


async def run_batch(store, batch: dict) -> str:
    """
    Execute one run of a batch. Returns the run_id.
    Resumes already finished in this run_id are skipped (idempotent restart).
    """
    db       = MongoDB()
    batch_id = batch["batch_id"]
    org_id   = batch["org_id"]
    run_id   = batch.get("_resume_run_id") or uuid.uuid4().hex

    # Resolve the resume set for this batch (ids stored on the definition).
    resume_ids = batch.get("resume_ids", [])
    filters    = batch.get("filters") or {}
    names      = batch.get("candidate_names") or {}
    max_jobs   = batch.get("max_jobs_per_resume")
    for resume_id in resume_ids:
        if store.already_done(batch_id, run_id, resume_id):
            continue  # crash-safe: don't redo (or re-pay for) finished work
        resume_doc = db.db["resumes"].find_one({"resume_id": resume_id}, {"_id": 0})
        if not resume_doc:
            continue
        # Human-friendly label: batch-supplied name -> resume candidate_name ->
        # file_name -> short id.
        candidate = (
            (names.get(resume_id) or "").strip()
            or (resume_doc.get("candidate_name") or "").strip()
            or (resume_doc.get("file_name") or "").strip()
            or resume_id[:8]
        )
        try:
            matches = await _score_resume(db, resume_doc, filters, max_jobs)
            # Bridge the scored jobs into the resume's dashboard job_matches so the
            # existing optimize/cover/motivation endpoints (which look the job up in
            # job_matches) accept an "Align" launched from a batch row. Purely
            # additive: only jobs NOT already in job_matches are appended; existing
            # dashboard matches are never removed or overwritten.
            _bridge_into_job_matches(db, resume_doc, matches)
            # The table/CSV only need the lightweight fields; drop the heavy private
            # bridge payload (_job/_ats) before persisting the batch result so
            # batch_results stays the same size/shape it always was.
            clean = [{k: v for k, v in m.items() if k not in ("_job", "_ats")}
                     for m in matches]
            store.save_result(batch_id, run_id, org_id, resume_id, clean,
                              candidate=candidate)
        except Exception as e:
            # One bad resume must not kill the whole run; record + continue.
            store.save_result(batch_id, run_id, org_id, resume_id,
                              [{"error": str(e)}], candidate=candidate)
    return run_id


def _bridge_into_job_matches(db, resume_doc: dict, matches: list) -> None:
    """
    Make batch-discovered jobs optimizable from the Batch panel's "Align" button.

    optimize_resume() resolves a job via db.get_job_matches(resume_id) ->
    get_selected_job(job_match, job_id). Batch results live in their own store, so
    without this a job found only by a batch run would 404 on Align. We merge each
    scored job into job_matches in the SAME shape the dashboard writes
    ({"job": <job>, "ats": <ats>}), appending only ids that aren't already present.

    Safety:
      - additive only: existing dashboard results are preserved as-is.
      - no-op on rows without the private _job/_ats payload (e.g. error rows).
      - failures are swallowed: bridging is a convenience, never break a batch run.
    """
    try:
        resume_id = resume_doc["resume_id"]
        user_id   = resume_doc.get("user_id")
        bridgeable = [m for m in matches if m.get("_job") and m.get("_ats")]
        if not bridgeable:
            return

        existing = db.get_job_matches(resume_id) or {}
        results  = list(existing.get("results", []))
        have_ids = {
            str((r.get("job") or {}).get("job_id")
                or (r.get("job") or {}).get("id")
                or (r.get("job") or {}).get("_id"))
            for r in results
        }

        added = 0
        for m in bridgeable:
            jid = str(m["_job"].get("job_id") or m["_job"].get("id") or "")
            if not jid or jid in have_ids:
                continue
            results.append({"job": m["_job"], "ats": m["_ats"], "_source": "batch"})
            have_ids.add(jid)
            added += 1

        if added:
            uid = user_id or existing.get("user_id") or ""
            db.save_job_matches(resume_id, uid, results)
            print(f"[batch] bridged {added} job(s) into job_matches "
                  f"resume={resume_id[:8]} (align-enabled)")
    except Exception as e:
        print(f"[batch] job_matches bridge skipped: {e}")