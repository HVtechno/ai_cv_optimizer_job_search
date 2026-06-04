"""
core/plans.py — Single source of truth for subscription tiers and limits.

Everything that needs to know "what can this user do?" reads from here. Never
hardcode a limit anywhere else. If you change a number, you change it once.

Tiers:
  - basic       : free, default for every new signup
  - pro         : €29/mo (or €290/yr) self-serve via Stripe Checkout
  - enterprise  : no public price, manual setup. Supports PER-USER overrides
                  (see effective_limits) so you can flip one customer to
                  enterprise and grant them custom numbers without a code change.

Limit semantics:
  - An int means a hard cap.
  - None means unlimited.
  - A bool feature flag means the feature is on/off for that tier.
"""

from typing import Optional


# Canonical plan identifiers (stored on the user doc as `plan`)
PLAN_BASIC      = "basic"
PLAN_PRO        = "pro"
PLAN_ENTERPRISE = "enterprise"

VALID_PLANS = {PLAN_BASIC, PLAN_PRO, PLAN_ENTERPRISE}


# ── The master limit table ────────────────────────────────────────────────────
# Keep this aligned with what the pricing page advertises. The frontend reads a
# serialized version of this via GET /billing/plans so the two never drift.

PLAN_LIMITS = {
    PLAN_BASIC: {
        "label":               "Basic",
        "price_eur_month":     0,
        "max_resumes":         1,
        "max_job_matches":     10,      # per resume (top_n ceiling)
        # Refresh quota is MONTHLY for free (resets each calendar month).
        "max_refreshes_month": 3,
        "max_refreshes_resume": None,   # not used for free (monthly model applies)
        # Optimization quota: number of DISTINCT jobs a user may optimize. One
        # "optimized job" lets them generate rewrite + cover + motivation for
        # that single job, all free, re-downloadable. Free = 3 distinct jobs/MONTH.
        "max_optimized_jobs_month":  3,
        "max_optimized_jobs_resume": None,  # free uses the monthly model
        "full_filtering":      False,   # language-only filtering
        "full_ats_breakdown":  False,   # score only, no keyword/skill detail
        # Feature flags stay True — gating is now QUOTA-based, not all-or-nothing.
        # A free user CAN rewrite/cover/motivation, just for a limited # of jobs.
        "resume_rewrite":      True,
        "cover_letter":        True,
        "motivation_letter":   True,
        "allow_regenerate":    False,   # one-shot only; no repeat OpenAI calls
        "pdf_export":          True,
        "support":             "community",
    },
    PLAN_PRO: {
        "label":               "Pro",
        "price_eur_month":     29,
        "max_resumes":         10,
        "max_job_matches":     50,
        # Pro refreshes are PER-RESUME (each resume gets its own quota).
        "max_refreshes_month":  None,   # not used for pro (per-resume model)
        "max_refreshes_resume": 30,
        # Pro may optimize up to 10 DISTINCT jobs PER RESUME (of the 50 matched).
        "max_optimized_jobs_month":  None,  # pro uses the per-resume model
        "max_optimized_jobs_resume": 10,
        "full_filtering":      True,
        "full_ats_breakdown":  True,
        "resume_rewrite":      True,
        "cover_letter":        True,
        "motivation_letter":   True,
        "allow_regenerate":    False,   # one-shot only; no repeat OpenAI calls
        "pdf_export":          True,
        "support":             "email",
    },
    PLAN_ENTERPRISE: {
        "label":               "Enterprise",
        "price_eur_month":     None,    # contact sales
        "max_resumes":         None,
        "max_job_matches":     200,
        "max_refreshes_month":  None,
        "max_refreshes_resume": None,   # unlimited
        "max_optimized_jobs_month":  None,
        "max_optimized_jobs_resume": None,  # unlimited
        "full_filtering":      True,
        "full_ats_breakdown":  True,
        "resume_rewrite":      True,
        "cover_letter":        True,
        "motivation_letter":   True,
        "allow_regenerate":    True,    # enterprise may regenerate
        "pdf_export":          True,
        "support":             "priority",
    },
}


def normalize_plan(plan: Optional[str]) -> str:
    """Coerce any stored/legacy value to a valid plan. Unknown -> basic.
    Old users created before billing existed have no `plan` field; they read
    as basic, which is exactly what we want."""
    if plan in VALID_PLANS:
        return plan
    return PLAN_BASIC


def get_limits(plan: Optional[str]) -> dict:
    """Return the limit dict for a plan (defaults to basic)."""
    return PLAN_LIMITS[normalize_plan(plan)]


def effective_limits(user: Optional[dict]) -> dict:
    """
    Resolve the real limits for a user, applying any per-user enterprise
    overrides. A user doc may carry a `limit_overrides` dict (only honored for
    enterprise) so you can sell a custom deal and just set:

        db.users.update_one({"email": ...},
            {"$set": {"plan": "enterprise",
                      "limit_overrides": {"max_resumes": 500}}})

    ...with no code change. Overrides are ignored for non-enterprise plans so a
    basic/pro user can never grant themselves more.
    """
    user = user or {}
    plan = normalize_plan(user.get("plan"))
    limits = dict(PLAN_LIMITS[plan])  # copy so we never mutate the master table

    if plan == PLAN_ENTERPRISE:
        overrides = user.get("limit_overrides") or {}
        for k, v in overrides.items():
            if k in limits:
                limits[k] = v
    return limits


def feature_enabled(user: Optional[dict], feature: str) -> bool:
    """Convenience boolean check for a feature flag (e.g. 'resume_rewrite')."""
    return bool(effective_limits(user).get(feature, False))


# ── Optimization-quota resolution ─────────────────────────────────────────────
# Centralizes the "can this user optimize this job?" decision so the rewrite,
# cover-letter, and motivation-letter routes all share identical logic.
#
# Returns a dict describing the model in play and the numbers, given the user
# and the resume's currently-claimed jobs + the user's monthly-claimed jobs.
# The caller passes both sets (cheap reads) and the job_id being requested.

def optimization_quota(user: Optional[dict]) -> dict:
    """Which metering model applies, and the cap. None cap == unlimited."""
    limits = effective_limits(user)
    monthly_cap     = limits.get("max_optimized_jobs_month")
    per_resume_cap  = limits.get("max_optimized_jobs_resume")
    if monthly_cap is not None:
        return {"model": "month", "cap": monthly_cap}
    if per_resume_cap is not None:
        return {"model": "resume", "cap": per_resume_cap}
    return {"model": "unlimited", "cap": None}


def can_optimize_job(
    user: Optional[dict],
    job_id: str,
    *,
    month_jobs: list,
    resume_jobs: list,
) -> dict:
    """
    Decide if `job_id` may be optimized.

    The cap is ABSOLUTE. Once the user has reached their optimized-job cap, they
    may not optimize ANYTHING further — not a new job, and not even a job they
    already optimized (re-running still costs an OpenAI call). The only path
    forward is to upgrade.

    Below the cap:
      - Re-optimizing an ALREADY-claimed job is allowed and does NOT consume a
        new slot (it's the same job — rewrite/cover/motivation for it are free).
      - A NEW job is allowed and consumes one slot.

    Returns {"allowed": bool, "is_new": bool, "model": str, "cap": int|None,
             "used": int, "message": str|None}.
    """
    q = optimization_quota(user)
    model, cap = q["model"], q["cap"]

    if model == "unlimited":
        return {"allowed": True, "is_new": job_id not in (resume_jobs or []),
                "model": model, "cap": None, "used": len(resume_jobs or []), "message": None}

    claimed = month_jobs if model == "month" else resume_jobs
    claimed = claimed or []
    already = job_id in claimed
    used    = len(claimed)

    # Below the cap: allow. Re-claiming an existing job doesn't consume a slot.
    if used < cap:
        return {"allowed": True, "is_new": not already, "model": model, "cap": cap,
                "used": used, "message": None}

    # At/over the cap: block EVERYTHING, including already-claimed jobs. This is
    # the absolute-ceiling behavior — once 3 of 3 (free) is hit, the user can do
    # nothing more without upgrading.
    scope = "this month" if model == "month" else "for this resume"
    return {
        "allowed": False, "is_new": not already, "model": model, "cap": cap, "used": used,
        "message": f"You've used all {cap} optimizations {scope}. Upgrade to Pro for more."
                   if model == "month"
                   else f"You've used all {cap} optimizations for this resume — that's the Pro limit.",
    }


def public_plans() -> list:
    """
    Serializable plan catalog for the frontend pricing page + settings UI.
    Returned by GET /billing/plans so the UI and backend share one definition.
    Enterprise price is intentionally null (contact sales).
    """
    order = [PLAN_BASIC, PLAN_PRO, PLAN_ENTERPRISE]
    out = []
    for pid in order:
        lim = PLAN_LIMITS[pid]
        out.append({
            "id":              pid,
            "label":           lim["label"],
            "price_eur_month": lim["price_eur_month"],
            "limits": {
                "max_resumes":          lim["max_resumes"],
                "max_job_matches":      lim["max_job_matches"],
                "max_refreshes_month":  lim["max_refreshes_month"],
                "max_refreshes_resume": lim["max_refreshes_resume"],
                "max_optimized_jobs_month":  lim["max_optimized_jobs_month"],
                "max_optimized_jobs_resume": lim["max_optimized_jobs_resume"],
            },
            "features": {
                "full_filtering":     lim["full_filtering"],
                "full_ats_breakdown": lim["full_ats_breakdown"],
                "resume_rewrite":     lim["resume_rewrite"],
                "cover_letter":       lim["cover_letter"],
                "motivation_letter":  lim["motivation_letter"],
                "pdf_export":         lim["pdf_export"],
            },
            "support": lim["support"],
        })
    return out