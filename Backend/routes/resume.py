"""
Resume routes — filter params from ResumeFilterModal:
  - language    : "en" | "nl"
  - expiry_days : int | None  (None = all)
  - location    : str | None  (city name, e.g. "Amsterdam")
  - radius_km   : int | None  (Haversine radius around geocoded city)
  - remote_only : bool        (True = only jobs with "remote" in location)

Pure helpers (geocoding, haversine, job filtering, result formatting) now live in
utils/helpers.py. DB access lives in db/mongodb.py. This module keeps only the
route handlers and the async scoring functions (which depend on services).

CHANGE LOG (bug fixes):
  - /upload-resume detects duplicate resumes by resume_hash via
    db.get_user_resume_by_hash(). If the same user re-uploads identical resume
    text, we return the existing resume_id with is_duplicate=true instead of
    creating a second copy — the frontend then runs an agentic refresh.

CHANGE LOG (candidate name feature):
  - Optional user-set `candidate_name` accepted on /upload-resume (Form field)
    and persisted on the resume document. The refresh endpoint persists an edited
    name when one is sent in the filters payload. The name is surfaced in the
    relevant responses and used (via resolve_candidate_name) for resume
    optimization and letter generation, falling back to the filename-derived name
    when the user hasn't set one.

CHANGE LOG (subscription gating):
  - Pro/Enterprise-only routes are gated with require_feature(...) in the
    decorator: resume-optimize (resume_rewrite), cover-letter (cover_letter),
    motivation-letter (motivation_letter), export-pdf (pdf_export). These 403
    with detail.error == "plan_upgrade_required" for the frontend upsell modal.
  - /upload-resume enforces the per-plan resume cap (but NEVER blocks duplicate
    re-uploads, which don't add a new resume) and clamps top_n to the plan's
    job-match ceiling.
  - /resume-jobs/refresh enforces the free-tier monthly refresh cap and records
    usage on success; it also clamps top_n.
  - Enforcement is on the BACKEND on purpose — the UI lock is only UX; this is
    the real boundary.
"""

import uuid
import asyncio
from datetime import datetime, timezone

from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Depends, Body, status
from fastapi.responses import Response

from core.security import get_current_user, get_current_user_doc, require_feature
from core.plans import effective_limits
from db.mongodb import MongoDB
from embeddings.resume_embeddings import (
    get_or_create_resume_embedding,
    get_or_create_job_embedding,
    get_resume_hash,   # pure hash — used by the pre-check so it never writes an embedding
)
from services.resume_parser import extract_resume_text
from services.ats_engine import (
    score_resume_against_job,
    cosine_similarity,
    normalise_similarity,
    keyword_score,
    compute_ats_score,
    compute_interview_probability,
    classify_skills,
    generate_summary,
)
from services.rewriter import rewrite_resume, resume_dict_to_text
from services.pdf_generator import build_html_resume, html_to_pdf
from services.latex_builder import build_latex
from services.cover_letter import (
    generate_cover_letter,
    generate_motivation_letter,
    build_letter_html,
)
from utils.helpers import (
    filter_jobs,
    normalize_result,
    get_selected_job,
    resolve_candidate_name,   # NEW
)

router = APIRouter()
db     = MongoDB()


# ── Async scoring (depends on services — stays here) ──────────────────────────

async def _score_all_jobs(resume_text: str, resume_embedding: list, jobs: list) -> list:
    # Normalise the resume to English ONCE per upload (not per job) so the
    # cross-language keyword channel works without paying a translation call for
    # every job. English resumes pass through with no LLM call.
    from utils.language import resume_to_english
    resume_text_en = await resume_to_english(resume_text)

    job_embeddings = await asyncio.gather(*[
        get_or_create_job_embedding(
            job.get("job_id", str(i)),
            job.get("descriptionText", ""),
            job,   # pass full job so the inline embedding_chunks is reused (no API call)
        )
        for i, job in enumerate(jobs)
    ])
    # Bound how many jobs we score concurrently. Each job makes 2 OpenAI chat
    # calls (classify_skills + summary). On a small TPM tier (e.g. 30k tokens/min)
    # even 6 concurrent jobs overruns the per-minute token budget and triggers
    # 429s on the trailing jobs (→ fit=None). 3 keeps the token rate under the cap
    # while staying responsive. Raise this only if your OpenAI tier has a higher
    # TPM limit; lower it to 2 if you still see [classify_skills] rate-limit logs.
    SCORE_CONCURRENCY = 3
    _sem = asyncio.Semaphore(SCORE_CONCURRENCY)

    async def _score_one(job, job_emb):
        async with _sem:
            return await score_resume_against_job(
                resume_text=resume_text,
                resume_embedding=resume_embedding,
                job=job,
                job_embedding=job_emb,
                include_summary=True,
                resume_text_en=resume_text_en,
            )

    ats_results = await asyncio.gather(*[
        _score_one(job, job_emb)
        for job, job_emb in zip(jobs, job_embeddings)
    ])
    # Build the stored results. Drop the heavy `embedding_chunks` from the job
    # copy we persist into job_matches — it was only needed for scoring (already
    # done above), and keeping it would bloat job_matches with a 3072-dim vector
    # per job per resume. The canonical embedding still lives on the `jobs`
    # collection, so anything that needs it later (e.g. re-scoring in
    # optimize_resume) can fetch it fresh.
    def _strip(job: dict) -> dict:
        if "embedding_chunks" in job:
            job = {k: v for k, v in job.items() if k != "embedding_chunks"}
        return job

    return [{"job": _strip(job), "ats": ats} for job, ats in zip(jobs, ats_results)]


async def _rescore_rewritten(rewritten_text: str, job: dict, job_embedding: list) -> dict:
    from core.openai_client import get_embedding
    from services.ats_engine import aligned_keyword_score, skill_fit_score, _score_breakdown_text
    rewritten_emb = await get_embedding(rewritten_text)
    jd_text  = job.get("descriptionText", "")
    sim      = cosine_similarity(rewritten_emb, job_embedding)
    sem_norm = normalise_similarity(sim)
    kw_val, matched_kw, missing_kw = await aligned_keyword_score(
        rewritten_text,
        jd_text,
        job_id=job.get("job_id", ""),
        posted_lang=job.get("jobPostedLanguage"),
    )
    (strong, weak, missing), summary = await asyncio.gather(
        classify_skills(rewritten_text, jd_text),
        generate_summary(rewritten_text, jd_text),
    )
    skill_fit = skill_fit_score(strong, missing)
    ats      = compute_ats_score(sem_norm, kw_val, skill_fit)
    prob     = compute_interview_probability(ats)
    if summary:
        summary = _score_breakdown_text(ats, sem_norm, kw_val, skill_fit) + summary
    return {
        "score":                      int(round(ats)),
        "semantic_similarity":        round(sim * 100, 1),
        "keyword_score":              round(kw_val, 1),
        "matched_keywords":           matched_kw,
        "missing_keywords":           missing_kw,
        "strong_skills":              strong,
        "weak_skills":                weak,
        "missing_skills":             missing,
        "summary":                    summary,
        "interview_probability":      prob["level"],
        "interview_probability_pct":  prob["percentage"],
        "interview_probability_color":prob["color"],
    }


# ── Shared optimization-quota enforcement ─────────────────────────────────────
# Used by the rewrite / cover-letter / motivation-letter routes. Decides whether
# `user` may generate an artifact for `job_id` on `resume_id`, raises a 403 with
# the upgrade payload if not, and CLAIMS the job (records it) when it's a new
# claim. Re-generating an artifact for an already-claimed job is always allowed
# and never consumes quota. Returns nothing; raises on block.

def _enforce_optimization_quota(user: dict, resume_id: str, job_id: str):
    from core.plans import can_optimize_job
    email = user["email"]
    month_jobs  = db.get_optimized_jobs_this_month(email)
    resume_jobs = db.get_optimized_jobs_resume(resume_id)

    decision = can_optimize_job(
        user, job_id, month_jobs=month_jobs, resume_jobs=resume_jobs
    )
    if not decision["allowed"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "error":        "plan_limit_reached",
                "limit":        "optimized_jobs",
                "current_plan": user.get("plan", "basic"),
                "message":      decision["message"],
            },
        )
    # Claim the job if this is a new one (idempotent via $addToSet).
    if decision["is_new"]:
        if decision["model"] == "month":
            db.add_optimized_job_month(email, job_id)
        elif decision["model"] == "resume":
            db.add_optimized_job_resume(resume_id, job_id)
        # unlimited (enterprise): still record per-resume for display, harmless.
        else:
            db.add_optimized_job_resume(resume_id, job_id)

# ── Lightweight duplicate pre-check (no scoring) ──────────────────────────────
# Lets the frontend decide BEFORE opening the filter modal: if the resume text
# already exists for this user, we skip the modal and show a toast instead.

# ── Instant upload-allowance check (NO file, NO processing) ───────────────────
# Called the moment a user picks a file, BEFORE any upload. Returns whether a
# NEW resume upload is allowed under their plan, plus the current count and cap,
# so the frontend can show the upgrade modal immediately for capped users
# instead of uploading + extracting text first. Pure DB count — instant.

@router.get("/can-upload-resume")
async def can_upload_resume(user: dict = Depends(get_current_user_doc)):
    limits      = effective_limits(user)
    max_resumes = limits["max_resumes"]
    current     = db.count_user_resumes(user["email"])
    # None == unlimited (pro within its number is handled by the int; enterprise
    # max_resumes is None -> always allowed).
    allowed = (max_resumes is None) or (current < max_resumes)
    return {
        "allowed":      allowed,
        "current":      current,
        "max_resumes":  max_resumes,
        "current_plan": user.get("plan", "basic"),
        "message":      (
            None if allowed
            else f"Your plan allows {max_resumes} resume(s). Upgrade to Pro for more."
        ),
    }


@router.post("/check-resume-duplicate")
async def check_resume_duplicate(
    file:    UploadFile = File(...),
    user_id: str = Depends(get_current_user),
):
    file_bytes  = await file.read()
    resume_text = extract_resume_text(file_bytes, file.filename)
    if not resume_text.strip():
        raise HTTPException(status_code=400, detail="Could not extract text from resume")

    # Hash-only duplicate check. We deliberately do NOT call
    # get_or_create_resume_embedding here, because that would generate AND save an
    # embedding to the resume_embeddings collection before any resume document
    # exists. If the user then cancels the filter modal, that embedding is
    # orphaned (no resume references it, so delete-time cleanup never removes it).
    # The hash is computed the same way get_or_create_resume_embedding computes it,
    # so the lookup is identical — the actual embedding is created later in
    # /upload-resume, alongside the resume document.
    resume_hash = get_resume_hash(resume_text)

    existing = db.get_user_resume_by_hash(user_id, resume_hash)
    if existing:
        return {
            "is_duplicate": True,
            "resume_id":    existing.get("resume_id"),
            "file_name":    existing.get("file_name", file.filename),
            "candidate_name": existing.get("candidate_name") or None,  # NEW
            "uploaded_at":  existing.get("uploaded_at"),
        }
    return {"is_duplicate": False}


@router.post("/upload-resume")
async def upload_resume(
    file:           UploadFile = File(...),
    languages:      str = Form("en"),   # comma-separated e.g. "en" or "en,nl"
    expiry_days:    str = Form(None),   # comes as string from FormData
    location:       str = Form(None),
    radius_km:      str = Form(None),
    remote_only:    str = Form("false"),
    top_n:          str = Form("20"),
    candidate_name: str = Form(None),   # NEW: optional user-set display name
    user:           dict = Depends(get_current_user_doc),   # CHANGED: full user doc for plan
):
    # Identity + plan limits. `user_id` keeps the rest of the function unchanged.
    user_id = user["email"]
    limits  = effective_limits(user)

    # Parse optional filter fields
    expiry_days_int  = int(expiry_days)  if expiry_days  else None
    radius_km_int    = int(radius_km)    if radius_km    else None
    remote_only_bool = remote_only.lower() == "true"
    languages_list   = [l.strip() for l in languages.split(",") if l.strip()]
    top_n_int        = max(5, min(int(top_n) if top_n else 20, 200))
    # Clamp requested job-match count to the plan's ceiling.
    if limits["max_job_matches"] is not None:
        top_n_int = min(top_n_int, limits["max_job_matches"])
    # NEW: normalise candidate name (empty/whitespace -> None)
    candidate_name_clean = (candidate_name or "").strip() or None

    file_bytes  = await file.read()
    resume_text = extract_resume_text(file_bytes, file.filename)
    if not resume_text.strip():
        raise HTTPException(status_code=400, detail="Could not extract text from resume")

    # Compute the content hash WITHOUT creating/saving an embedding yet. This lets
    # us run both the duplicate check and the plan-cap check up front — so a
    # blocked upload never generates a paid embedding or leaves an orphan in the
    # resume_embeddings collection (fixes the "embedding created then Upgrade to
    # Pro" bug). The embedding is only created further down, once we know the
    # upload is actually going to be stored.
    resume_hash = get_resume_hash(resume_text)

    # ── Duplicate detection ───────────────────────────────────────────────────
    # If this user already has a resume with the same content hash, do NOT create
    # a new copy. Return the existing resume + cached matches with a flag so the
    # frontend can trigger an agentic refresh instead. NOTE: this runs BEFORE the
    # resume-count cap so a duplicate re-upload is never blocked by the limit —
    # it doesn't create a new resume.
    existing = db.get_user_resume_by_hash(user_id, resume_hash)
    if existing:
        existing_id = existing.get("resume_id")
        # If a name was supplied on this (duplicate) upload and the stored resume
        # has none, persist it now so the user's choice isn't silently dropped.
        if candidate_name_clean and not (existing.get("candidate_name") or "").strip():
            db.update_resume_candidate_name(existing_id, candidate_name_clean)
            existing_name = candidate_name_clean
        else:
            existing_name = existing.get("candidate_name") or None
        job_match   = db.get_job_matches(existing_id)
        cached      = job_match.get("results", []) if job_match else []
        return {
            "resume_id":    existing_id,
            "file_name":    existing.get("file_name", file.filename),
            "candidate_name": existing_name,                # NEW
            "is_duplicate": True,
            "total_jobs":   len(cached),
            "uploaded_at":  existing.get("uploaded_at"),
            "results":      [normalize_result(r, i) for i, r in enumerate(cached)],
        }

    # ── Plan cap: number of resumes ───────────────────────────────────────────
    # Only reached for a genuinely NEW resume (duplicates returned above). Blocks
    # creation once the user is at their plan's resume limit. Runs BEFORE the
    # embedding is created, so a blocked upload costs nothing and leaves no
    # orphaned embedding behind.
    max_resumes = limits["max_resumes"]
    if max_resumes is not None and db.count_user_resumes(user_id) >= max_resumes:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "error":        "plan_limit_reached",
                "limit":        "max_resumes",
                "current_plan": user.get("plan", "basic"),
                "message":      f"Your plan allows {max_resumes} resume(s). Upgrade to Pro for more.",
            },
        )

    # Cap passed and not a duplicate — NOW create + save the embedding. (The hash
    # returned here matches the pure hash computed above.)
    resume_embedding, resume_hash = await get_or_create_resume_embedding(resume_text)

    print(f"[upload-resume] top_n={top_n_int} | language={languages} | expiry={expiry_days_int} | location={location} | radius={radius_km_int} | candidate={candidate_name_clean}")
    # Pull a broader pool first, then apply filters
    all_jobs = db.search_similar_jobs(resume_embedding, limit=500)

    filtered_jobs = filter_jobs(
        jobs        = all_jobs,
        languages   = languages_list,
        expiry_days = expiry_days_int,
        location    = location,
        radius_km   = radius_km_int,
        remote_only = remote_only_bool,
    )

    # Slice to top_n after filtering, then score (much cheaper)
    top_jobs = filtered_jobs[:top_n_int]
    results  = await _score_all_jobs(resume_text, resume_embedding, top_jobs)

    resume_id = str(uuid.uuid4())
    db.save_resume({
        "resume_id":      resume_id,
        "user_id":        user_id,
        "file_name":      file.filename,
        "candidate_name": candidate_name_clean,   # NEW: stored (may be None)
        "mime_type":      file.content_type,
        "resume_text":    resume_text,
        "resume_hash":    resume_hash,
        "has_embedding":  True,
        "uploaded_at":    datetime.now(timezone.utc),
        # Store filters so refresh can re-apply them
        "filters": {
            "languages":   languages_list,
            "expiry_days": expiry_days_int,
            "location":    location,
            "radius_km":   radius_km_int,
            "remote_only": remote_only_bool,
            "top_n":       top_n_int,
        },
    })
    db.save_job_matches(resume_id, user_id, results)

    return {
        "resume_id":      resume_id,
        "file_name":      file.filename,
        "candidate_name": candidate_name_clean,   # NEW
        "is_duplicate":   False,
        "total_jobs":     len(results),
        "filters_applied": {
            "languages":   languages_list,
            "expiry_days": expiry_days_int,
            "location":    location,
            "radius_km":   radius_km_int,
            "remote_only": remote_only_bool,
            "pool_before_filter": len(all_jobs),
            "pool_after_filter":  len(filtered_jobs),
            "top_n":              top_n_int,
        },
        "results": [normalize_result(r, i) for i, r in enumerate(results)],
    }


# ── Job count preview (NO scoring, NO OpenAI) ─────────────────────────────────
# Lets the filter modal show how many jobs match the currently-selected filters
# BEFORE the user commits to an ATS run. Reuses the exact same search + filter
# path as upload/refresh, but stops before _score_all_jobs — so it costs nothing
# (vector search uses precomputed embeddings; filtering is pure Python). Read-only:
# it never writes to the DB and never touches saved filters.

@router.post("/resume-jobs/count/{resume_id}")
async def count_matching_jobs(
    resume_id: str,
    payload: dict | None = Body(default=None),
    user_id: str = Depends(get_current_user),
):
    resume = db.get_resume(resume_id)
    if not resume or resume.get("user_id") != user_id:
        raise HTTPException(status_code=404, detail="Resume not found")

    resume_hash = resume.get("resume_hash")
    if not resume_hash:
        # No embedding yet (shouldn't happen for an existing resume) — report 0.
        return {"count": 0, "pool_before_filter": 0, "embedding_ready": False}

    resume_embedding = db.get_resume_embedding(resume_hash)
    if not resume_embedding:
        return {"count": 0, "pool_before_filter": 0, "embedding_ready": False}

    # Normalise incoming filters the same way refresh does (camelCase → stored shape).
    incoming = (payload or {}).get("filters") if isinstance(payload, dict) else None
    if incoming:
        languages   = incoming.get("languages") or ["en"]
        expiry_raw  = incoming.get("expiryDays", incoming.get("expiry_days"))
        expiry_days = int(expiry_raw) if expiry_raw not in (None, "", 999) else None
        location    = incoming.get("location") or None
        radius_raw  = incoming.get("radiusKm", incoming.get("radius_km"))
        radius_km   = int(radius_raw) if radius_raw not in (None, "") else None
        remote_only = bool(incoming.get("remoteOnly", incoming.get("remote_only", False)))
    else:
        # Fall back to whatever filters are saved on the resume.
        saved = dict(resume.get("filters", {}))
        saved.pop("top_n", None)
        languages   = saved.get("languages") or ["en"]
        expiry_days = saved.get("expiry_days")
        location    = saved.get("location")
        radius_km   = saved.get("radius_km")
        remote_only = bool(saved.get("remote_only", False))

    all_jobs = db.search_similar_jobs(resume_embedding, limit=500)
    filtered = filter_jobs(
        jobs        = all_jobs,
        languages   = languages,
        expiry_days = expiry_days,
        location    = location,
        radius_km   = radius_km,
        remote_only = remote_only,
    )
    return {
        "count":              len(filtered),
        "pool_before_filter": len(all_jobs),
        "embedding_ready":    True,
    }


# ── Refresh — accepts optional edited filters, persists + applies them ────────

@router.post("/resume-jobs/refresh/{resume_id}")
async def refresh_resume_jobs(
    resume_id: str,
    payload: dict | None = Body(default=None),
    user:     dict = Depends(get_current_user_doc),   # CHANGED: full user doc for plan
):
    user_id = user["email"]
    limits  = effective_limits(user)

    resume = db.get_resume(resume_id)
    if not resume or resume.get("user_id") != user_id:
        raise HTTPException(status_code=404, detail="Resume not found")

    # ── Plan cap: refreshes ───────────────────────────────────────────────────
    # Two models: FREE counts refreshes per MONTH (across all resumes); PRO counts
    # per RESUME. Enterprise = unlimited (both caps None). Checked before any
    # expensive scoring work.
    monthly_cap     = limits.get("max_refreshes_month")
    per_resume_cap  = limits.get("max_refreshes_resume")
    if monthly_cap is not None:
        used = db.get_usage_this_month(user_id, "refreshes")
        if used >= monthly_cap:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "error":        "plan_limit_reached",
                    "limit":        "max_refreshes_month",
                    "current_plan": user.get("plan", "basic"),
                    "message":      f"Free plan allows {monthly_cap} refreshes per month. Upgrade to Pro for more.",
                },
            )
    elif per_resume_cap is not None:
        used = db.get_resume_refresh_count(resume_id)
        if used >= per_resume_cap:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "error":        "plan_limit_reached",
                    "limit":        "max_refreshes_resume",
                    "current_plan": user.get("plan", "basic"),
                    "message":      f"You've used all {per_resume_cap} refreshes for this resume.",
                },
            )

    resume_text  = resume.get("resume_text", "")
    resume_hash  = resume.get("resume_hash")
    if not resume_hash:
        raise HTTPException(status_code=400, detail="Missing resume hash — re-upload")

    resume_embedding = db.get_resume_embedding(resume_hash)
    if not resume_embedding:
        raise HTTPException(status_code=404, detail="Embedding not found — re-upload resume")

    # ── Determine which filters to use ────────────────────────────────────────
    # If the request body carries edited filters (from the editable modal on the
    # Agent button), normalise + persist them onto the resume (overwrite), so they
    # become the new saved filters. Otherwise fall back to whatever is stored.
    incoming = (payload or {}).get("filters") if isinstance(payload, dict) else None
    if incoming:
        # Frontend sends camelCase like the upload form; normalise to stored shape.
        languages   = incoming.get("languages") or ["en"]
        expiry_raw  = incoming.get("expiryDays", incoming.get("expiry_days"))
        expiry_days = int(expiry_raw) if expiry_raw not in (None, "", 999) else None
        location    = incoming.get("location") or None
        radius_raw  = incoming.get("radiusKm", incoming.get("radius_km"))
        radius_km   = int(radius_raw) if radius_raw not in (None, "") else None
        remote_only = bool(incoming.get("remoteOnly", incoming.get("remote_only", False)))
        top_n_raw   = incoming.get("topN", incoming.get("top_n", 20))
        top_n_saved = max(5, min(int(top_n_raw) if top_n_raw else 20, 200))

        used_filters = {
            "languages":   languages,
            "expiry_days": expiry_days,
            "location":    location,
            "radius_km":   radius_km,
            "remote_only": remote_only,
        }
        # Persist (overwrite) the saved filters on the resume document
        db.update_resume_filters(resume_id, {**used_filters, "top_n": top_n_saved})

        # ── NEW: persist edited candidate name when present in the payload ──────
        # Only overwrite when the key is actually provided, so an absent field
        # never clears an existing name. An explicit empty value clears it.
        if "candidateName" in incoming or "candidate_name" in incoming:
            name_raw = incoming.get("candidateName", incoming.get("candidate_name"))
            name_clean = (name_raw or "").strip() or None
            db.update_resume_candidate_name(resume_id, name_clean)
            resume["candidate_name"] = name_clean  # keep local copy in sync
    else:
        # Re-apply saved filters + top_n (legacy behavior)
        saved_filters = dict(resume.get("filters", {}))
        top_n_saved   = saved_filters.pop("top_n", 20)
        used_filters  = saved_filters

    # Clamp to the plan's job-match ceiling.
    if limits["max_job_matches"] is not None:
        top_n_saved = min(top_n_saved, limits["max_job_matches"])

    all_jobs      = db.search_similar_jobs(resume_embedding, limit=500)
    filtered_jobs = filter_jobs(jobs=all_jobs, **used_filters)
    top_jobs      = filtered_jobs[:top_n_saved]

    results       = await _score_all_jobs(resume_text, resume_embedding, top_jobs)
    db.save_job_matches(resume_id, user_id, results)

    # Record usage AFTER a successful refresh. Free advances the monthly counter;
    # Pro advances the per-resume counter. We record both harmlessly so the
    # Settings panel can show whichever is relevant.
    db.increment_usage(user_id, "refreshes")          # monthly (free model)
    db.increment_resume_refresh_count(resume_id)      # per-resume (pro model)

    # ── Store refresh history ─────────────────────────────────────────────────
    refreshed_at = datetime.now(timezone.utc)
    db.push_refresh_history(resume_id, {
        "refreshed_at": refreshed_at,
        "total_jobs":   len(results),
        "filters":      {**used_filters, "top_n": top_n_saved},
    })

    return {
        "resume_id":      resume_id,
        "candidate_name": resume.get("candidate_name") or None,   # NEW
        "total_jobs":     len(results),
        "results":        [normalize_result(r, i) for i, r in enumerate(results)],
        "refreshed_at":   refreshed_at.isoformat(),
        "filters_applied": {**used_filters, "top_n": top_n_saved},
    }


# ── Other routes ──────────────────────────────────────────────────────────────

@router.get("/resumes")
async def get_resumes(user_id: str = Depends(get_current_user)):
    resumes = db.get_user_resumes(user_id)
    return {
        "resumes": [
            {
                "resume_id":      r.get("resume_id"),
                "file_name":      r.get("file_name"),
                "candidate_name": r.get("candidate_name") or None,   # NEW
                "uploaded_at":    r.get("uploaded_at"),
                "has_embedding":  r.get("has_embedding", False),
                "filters":        r.get("filters", {}),
            }
            for r in resumes
        ]
    }


@router.get("/resume-jobs/{resume_id}")
async def get_resume_jobs(resume_id: str, user_id: str = Depends(get_current_user)):
    resume = db.get_resume(resume_id)
    if not resume or resume.get("user_id") != user_id:
        raise HTTPException(status_code=404, detail="Resume not found")
    job_match = db.get_job_matches(resume_id)
    if not job_match:
        raise HTTPException(status_code=404, detail="No job matches — please refresh")
    return {
        "resume_id":      resume_id,
        "file_name":      resume.get("file_name"),
        "candidate_name": resume.get("candidate_name") or None,   # NEW
        "results":        [normalize_result(r, i) for i, r in enumerate(job_match.get("results", []))],
        "uploaded_at":    resume.get("uploaded_at"),
    }


@router.delete("/resume/{resume_id}")
async def delete_resume(resume_id: str, user_id: str = Depends(get_current_user)):
    resume = db.get_resume(resume_id)
    if not resume or resume.get("user_id") != user_id:
        raise HTTPException(status_code=404, detail="Resume not found")
    resume_hash = resume.get("resume_hash")
    db.delete_resume(resume_id, user_id)
    db.delete_job_matches(resume_id)
    if resume_hash and db.count_resumes_by_hash(resume_hash) == 0:
        db.delete_resume_embedding(resume_hash)
    return {"success": True, "deleted_resume_id": resume_id}


@router.post("/resume-optimize/{resume_id}")
async def optimize_resume(
    resume_id: str,
    job_id: str = Form(...),
    target_language: str = Form("English"),
    user: dict = Depends(get_current_user_doc),   # CHANGED: full doc for quota
):
    user_id = user["email"]
    resume = db.get_resume(resume_id)
    if not resume or resume.get("user_id") != user_id:
        raise HTTPException(status_code=404, detail="Resume not found")
    job_match = db.get_job_matches(resume_id)
    if not job_match:
        raise HTTPException(status_code=404, detail="No job matches found")
    selected = get_selected_job(job_match, job_id)
    if not selected:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found in matches")

    # Quota: claims the job (or 403s if over limit). Re-optimizing an already
    # claimed job is free and does not consume quota.
    _enforce_optimization_quota(user, resume_id, job_id)

    resume_text    = resume.get("resume_text", "")
    jd_text        = selected["job"].get("descriptionText", "")
    # NEW: prefer user-set candidate_name, fall back to filename derivation
    candidate_name = resolve_candidate_name(resume)
    stored_ats = selected.get("ats", {})
    ats_before = {
        "score":               stored_ats.get("score", 0),
        "semantic_similarity": stored_ats.get("semantic_similarity", 0),
        "interview_probability": stored_ats.get("interview_probability", "low"),
    }

    rewritten_data, changes = await rewrite_resume(
        resume_text=resume_text,
        jd_text=jd_text,
        target_language=target_language,
        ats_data=stored_ats,
    )

    job_embedding  = await get_or_create_job_embedding(
        selected["job"].get("job_id", job_id), jd_text, selected["job"]
    )
    rewritten_text = resume_dict_to_text(rewritten_data)
    ats_after      = await _rescore_rewritten(rewritten_text, selected["job"], job_embedding)
    html_resume    = build_html_resume(rewritten_data, candidate_name)
    latex_source   = build_latex(rewritten_data, candidate_name)

    return {
        "resume_id":       resume_id,
        "job_id":          job_id,
        "candidate_name":  candidate_name,
        "target_language": target_language,
        "ats_score_before":             ats_before["score"],
        "semantic_similarity_before":   ats_before["semantic_similarity"],
        "interview_probability_before": ats_before["interview_probability"],
        "ats_score_after":              ats_after["score"],
        "semantic_similarity_after":    ats_after["semantic_similarity"],
        "interview_probability_after":  ats_after["interview_probability"],
        "interview_probability_pct":    ats_after["interview_probability_pct"],
        "interview_probability_color":  ats_after["interview_probability_color"],
        "matched_keywords": ats_after["matched_keywords"],
        "missing_keywords": ats_after["missing_keywords"],
        "strong_skills":    ats_after["strong_skills"],
        "weak_skills":      ats_after["weak_skills"],
        "missing_skills":   ats_after["missing_skills"],
        "changes_made":  changes,
        "resume_data":   rewritten_data,
        "html_resume":   html_resume,
        "latex_source":  latex_source,
        "summary":       ats_after["summary"],
    }


@router.post("/export-pdf-from-html")
async def export_pdf_from_html(payload: dict, user_id: str = Depends(get_current_user)):
    # Not quota-gated: exporting a PDF of something already generated costs no
    # OpenAI calls, so re-downloading is always free.
    html = payload.get("html", "")
    if not html:
        raise HTTPException(status_code=400, detail="html field is required")
    pdf_bytes = html_to_pdf(html)
    return Response(
        content=pdf_bytes, media_type="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="optimized_resume.pdf"'},
    )


@router.post("/resume-cover-letter/{resume_id}")
async def get_cover_letter(
    resume_id: str, job_id: str = Form(...),
    target_language: str = Form("English"),
    user: dict = Depends(get_current_user_doc),
):
    user_id = user["email"]
    resume = db.get_resume(resume_id)
    if not resume or resume.get("user_id") != user_id:
        raise HTTPException(status_code=404, detail="Resume not found")
    job_match = db.get_job_matches(resume_id)
    selected  = get_selected_job(job_match, job_id) if job_match else None
    if not selected:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
    _enforce_optimization_quota(user, resume_id, job_id)
    candidate_name = resolve_candidate_name(resume)   # NEW
    text = await generate_cover_letter(
        resume_text=resume.get("resume_text",""),
        jd_text=selected["job"].get("descriptionText",""),
        candidate_name=candidate_name,
        ats_data=selected.get("ats",{}),
        target_language=target_language,
    )
    return {
        "cover_letter_text": text,
        "html":              build_letter_html(text, candidate_name, "Cover Letter"),
        "candidate_name":    candidate_name,
        "job_title":         selected["job"].get("title",""),
        "company":           selected["job"].get("companyName",""),
    }


@router.post("/resume-cover-letter/{resume_id}/pdf")
async def download_cover_letter_pdf(
    resume_id: str, job_id: str = Form(...),
    target_language: str = Form("English"),
    user: dict = Depends(get_current_user_doc),
):
    user_id = user["email"]
    resume = db.get_resume(resume_id)
    if not resume or resume.get("user_id") != user_id:
        raise HTTPException(status_code=404, detail="Resume not found")
    job_match = db.get_job_matches(resume_id)
    selected  = get_selected_job(job_match, job_id) if job_match else None
    if not selected:
        raise HTTPException(status_code=404, detail="Job not found")
    _enforce_optimization_quota(user, resume_id, job_id)
    candidate_name = resolve_candidate_name(resume)   # NEW
    text      = await generate_cover_letter(resume.get("resume_text",""), selected["job"].get("descriptionText",""), candidate_name, selected.get("ats",{}), target_language=target_language)
    pdf_bytes = html_to_pdf(build_letter_html(text, candidate_name, "Cover Letter"))
    return Response(content=pdf_bytes, media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{candidate_name.replace(" ","_")}_cover_letter.pdf"'})


@router.post("/resume-motivation-letter/{resume_id}")
async def get_motivation_letter(
    resume_id: str, job_id: str = Form(...),
    target_language: str = Form("English"),
    user: dict = Depends(get_current_user_doc),
):
    user_id = user["email"]
    resume = db.get_resume(resume_id)
    if not resume or resume.get("user_id") != user_id:
        raise HTTPException(status_code=404, detail="Resume not found")
    job_match = db.get_job_matches(resume_id)
    selected  = get_selected_job(job_match, job_id) if job_match else None
    if not selected:
        raise HTTPException(status_code=404, detail="Job not found")
    _enforce_optimization_quota(user, resume_id, job_id)
    candidate_name = resolve_candidate_name(resume)   # NEW
    text = await generate_motivation_letter(
        resume_text=resume.get("resume_text",""),
        jd_text=selected["job"].get("descriptionText",""),
        candidate_name=candidate_name,
        ats_data=selected.get("ats",{}),
        target_language=target_language,
    )
    return {
        "motivation_letter_text": text,
        "html":                   build_letter_html(text, candidate_name, "Motivation Letter"),
        "candidate_name":         candidate_name,
        "job_title":              selected["job"].get("title",""),
        "company":                selected["job"].get("companyName",""),
    }


@router.post("/resume-motivation-letter/{resume_id}/pdf")
async def download_motivation_letter_pdf(
    resume_id: str, job_id: str = Form(...),
    target_language: str = Form("English"),
    user: dict = Depends(get_current_user_doc),
):
    user_id = user["email"]
    resume = db.get_resume(resume_id)
    if not resume or resume.get("user_id") != user_id:
        raise HTTPException(status_code=404, detail="Resume not found")
    job_match = db.get_job_matches(resume_id)
    selected  = get_selected_job(job_match, job_id) if job_match else None
    if not selected:
        raise HTTPException(status_code=404, detail="Job not found")
    _enforce_optimization_quota(user, resume_id, job_id)
    candidate_name = resolve_candidate_name(resume)   # NEW
    text      = await generate_motivation_letter(resume.get("resume_text",""), selected["job"].get("descriptionText",""), candidate_name, selected.get("ats",{}), target_language=target_language)
    pdf_bytes = html_to_pdf(build_letter_html(text, candidate_name, "Motivation Letter"))
    return Response(content=pdf_bytes, media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{candidate_name.replace(" ","_")}_motivation_letter.pdf"'})


# ── Refresh history ───────────────────────────────────────────────────────────

# ── Maintenance: clean up orphaned resume embeddings ──────────────────────────
# Removes embeddings in resume_embeddings that no resume document references.
# These accumulate from abandoned uploads in older builds (the pre-check used to
# save an embedding before a resume existed). The pre-check no longer does this,
# so this is a one-time/periodic cleanup. GET so you can hit it from a browser
# once; it only deletes truly unreferenced embeddings, so it's safe to re-run.

@router.get("/admin/cleanup-orphan-embeddings")
async def cleanup_orphan_embeddings(user_id: str = Depends(get_current_user)):
    orphans = db.find_orphan_resume_embeddings()
    removed = db.delete_orphan_resume_embeddings()
    return {
        "orphans_found":   len(orphans),
        "orphans_removed": removed,
    }


@router.get("/resume-refresh-history/{resume_id}")
async def get_refresh_history(resume_id: str, user_id: str = Depends(get_current_user)):
    """Return the last 10 refresh events for a resume."""
    resume = db.get_resume(resume_id)
    if not resume or resume.get("user_id") != user_id:
        raise HTTPException(status_code=404, detail="Resume not found")
    history = db.get_refresh_history(resume_id)   # returns list newest-first
    return {
        "resume_id": resume_id,
        "history":   history[:10],
    }