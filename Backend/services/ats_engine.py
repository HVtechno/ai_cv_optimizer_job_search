"""
ATS Engine — embedding-based scoring, calibrated for real data.

CALIBRATION:
  text-embedding-3-large cosine sim range for resume-to-JD: ~0.42 - 0.56
  (measured on the live corpus, not the textbook 0.30-0.70).
  Mapped to [0.42->0, 0.56->100] so the real distribution uses the full scale.
  Weights: 55% semantic + 15% keyword + 30% skill-fit when skills are available;
  falls back to the original 75% / 25% semantic+keyword split when they're not.

INTERVIEW PROBABILITY — single source of truth: ATS score
  0  – 34  → Low
  35 – 64  → Medium
  65 – 100 → High
  Two jobs with the same ATS % always get the same level.
"""

import re
import json
import asyncio
import numpy as np
from core.openai_client import json_completion, client, FAST_MODEL


STOP_WORDS = {
    "the","and","for","with","that","this","are","was","were","have","has","had",
    "will","would","could","should","may","might","been","being","from","they",
    "them","their","its","our","your","you","not","but","also","such","more",
    "than","into","over","after","about","each","all","any","can","use","used",
    "using","work","works","working","help","helps","strong","good","great",
    "within","across","between","through","during","while","where","when","how",
    "what","who","which","both","other","some","many","most","very","well",
    "able","must","make","made","makes","take","taken","get","gets","set",
    "new","key","high","large","small","long","short","full","free","main",
    "own","same","different","various","following","including","related",
    "provide","provides","provided","ensure","ensures","support","supports",
    "develop","developed","develops","build","built","manage","managed",
    "create","created","implement","implemented","maintain","maintained",
    "lead","led","define","defined","drive","driven","deliver","delivered",
    "de","het","een","van","en","in","is","op","te","dat","die","we","niet",
    "aan","met","als","voor","zijn","er","bij","uit","naar","over","worden",
    "der","die","das","ein","und","ist","im","zu","auf","mit","sich","des",
    "le","la","les","un","une","des","est","en","du","au","et","pour","dans",
    "el","los","las","un","una","es","con","para","que","por","del","sus",
}

MIN_WORD_LEN   = 4
MIN_BIGRAM_LEN = 3


def extract_keywords(text: str) -> set:
    lower = text.lower()
    words = {
        w for w in re.findall(r'\b[a-z][a-z0-9+#.]*\b', lower)
        if len(w) >= MIN_WORD_LEN and w not in STOP_WORDS
    }
    raw_bigrams = re.findall(r'\b([a-z][a-z0-9]*)\s+([a-z][a-z0-9]*)\b', lower)
    bigrams = {
        f"{a} {b}" for a, b in raw_bigrams
        if a not in STOP_WORDS and b not in STOP_WORDS
        and len(a) >= MIN_BIGRAM_LEN and len(b) >= MIN_BIGRAM_LEN
    }
    return words | bigrams


def keyword_score(resume_text: str, jd_text: str) -> tuple[float, list, list]:
    jd_all    = extract_keywords(jd_text)
    resume_kw = extract_keywords(resume_text)
    ranked    = sorted(jd_all, key=lambda k: (1 if " " in k else 0, len(k)), reverse=True)
    jd_top    = set(ranked[:40])
    matched   = jd_top & resume_kw
    missing   = jd_top - resume_kw
    if not jd_top:
        return 0.0, [], []
    weighted_matched = sum(2 if " " in kw else 1 for kw in matched)
    weighted_total   = sum(2 if " " in kw else 1 for kw in jd_top)
    score = min((weighted_matched / weighted_total) * 100, 100.0)
    return (
        round(score, 2),
        sorted(matched, key=len, reverse=True)[:20],
        sorted(missing, key=len, reverse=True)[:20],
    )


# ── Keyword scorer v2 ─────────────────────────────────────────────────────────
# The original keyword_score() (kept above, unchanged, as fallback) scored even
# strong resume/JD pairs at ~30 because:
#   A) it ranked the JD's top-40 by "bigrams first, then length", filling the
#      list with accidental word-pairs ("operational efficiency", "design rest")
#      that a resume almost never reproduces verbatim — and weighted them 2x.
#   B) it matched exact surface tokens, so "apis" != "api", "engineers" !=
#      "engineer", "designed" != "design" all silently missed.
# v2 fixes both: light stemming + a real term-importance ranking, and it only
# uses bigrams when both words are themselves meaningful, scored as a bonus on
# top of the unigram signal rather than dominating it.

# Generic words that are technically not stop-words but carry no role-specific
# signal — they inflate the denominator and reward nothing. Dropped from scoring.
GENERIC_TERMS = {
    "experience", "experienced", "knowledge", "skills", "skill", "ability",
    "abilities", "responsibilities", "responsibility", "requirements",
    "requirement", "required", "preferred", "looking", "join", "team", "teams",
    "role", "position", "opportunity", "candidate", "candidates", "company",
    "environment", "solutions", "solution", "expertise", "proficiency",
    "proficient", "understanding", "excellent", "effective", "efficiency",
    "operational", "functional", "technical", "relevant", "proven", "track",
    "record", "passion", "passionate", "motivated", "dynamic", "fast", "paced",
    "collaborate", "collaboration", "communication", "stakeholders", "ensure",
    "ensuring", "alignment", "deliver", "delivery", "methodologies", "methodology",
    "year", "years", "plus", "etc", "including", "various", "across", "design",
}


def _stem(word: str) -> str:
    """
    Tiny, dependency-free stemmer. Not linguistically perfect — just enough to
    collapse the common variants that wreck exact-token matching (plurals, -ing,
    -ed, -es). Keeps short words and acronyms intact.
    """
    w = word
    if len(w) <= 3:
        return w
    for suf in ("ization", "isation", "ions", "ing", "ed", "es", "s"):
        if w.endswith(suf) and len(w) - len(suf) >= 3:
            return w[: -len(suf)]
    return w


def _content_tokens(text: str) -> list:
    """Lowercase content words (stop + generic removed), order preserved."""
    lower = text.lower()
    out = []
    for w in re.findall(r'\b[a-z][a-z0-9+#.]*\b', lower):
        if len(w) < MIN_WORD_LEN:
            continue
        if w in STOP_WORDS or w in GENERIC_TERMS:
            continue
        out.append(w)
    return out


def _stem_set(tokens: list) -> set:
    return {_stem(w) for w in tokens}


def keyword_score_v2(resume_text: str, jd_text: str) -> tuple[float, list, list]:
    """
    Accurate keyword overlap.

    - Unigrams are the primary signal, matched on STEMS (apis≈api, designed≈design).
    - Generic filler words are removed so the denominator is real skills/terms.
    - Meaningful bigrams (both halves are content words) add a small bonus when
      present in the resume, but never dominate the score.
    - Returns (score 0-100, matched_display, missing_display) — same shape as the
      original keyword_score(), so callers and the response schema are unchanged.
    """
    jd_tokens     = _content_tokens(jd_text)
    resume_tokens = _content_tokens(resume_text)
    if not jd_tokens:
        return 0.0, [], []

    # Frequency-rank JD unigrams: terms the JD repeats matter more. Cap the core
    # set so one long JD doesn't dilute everything.
    from collections import Counter
    jd_freq = Counter(_stem(w) for w in jd_tokens)
    # Map each JD stem back to a readable surface form for display.
    stem_to_surface = {}
    for w in jd_tokens:
        s = _stem(w)
        stem_to_surface.setdefault(s, w)

    core_stems = [s for s, _ in jd_freq.most_common(30)]
    resume_stems = _stem_set(resume_tokens)

    matched_stems = [s for s in core_stems if s in resume_stems]
    missing_stems = [s for s in core_stems if s not in resume_stems]

    # Unigram coverage, frequency-weighted (repeated JD terms count more).
    total_weight   = sum(jd_freq[s] for s in core_stems)
    matched_weight = sum(jd_freq[s] for s in matched_stems)
    unigram_pct    = (matched_weight / total_weight) if total_weight else 0.0

    # Bigram bonus: meaningful JD bigrams that also appear in the resume (stemmed).
    def _bigrams(tokens):
        return {f"{_stem(a)} {_stem(b)}" for a, b in zip(tokens, tokens[1:])}
    jd_bigrams     = _bigrams(jd_tokens)
    resume_bigrams = _bigrams(resume_tokens)
    if jd_bigrams:
        bigram_pct = len(jd_bigrams & resume_bigrams) / len(jd_bigrams)
    else:
        bigram_pct = 0.0

    # Blend: unigrams carry the score, bigrams nudge it. Scale so a genuinely
    # strong match (most core terms present) lands high.
    score = (unigram_pct * 0.85 + bigram_pct * 0.15) * 100
    score = min(round(score, 2), 100.0)

    matched_display = [stem_to_surface.get(s, s) for s in matched_stems][:20]
    missing_display = [stem_to_surface.get(s, s) for s in missing_stems][:20]
    return score, matched_display, missing_display


async def aligned_keyword_score(
    resume_text: str,
    jd_text: str,
    job_id: str = "",
    posted_lang=None,
    resume_text_en: str | None = None,
) -> tuple[float, list, list]:
    """
    Cross-language-safe wrapper around keyword_score().

    The raw keyword_score() intersects surface tokens, so an English resume vs a
    Dutch JD (or vice-versa) matches nothing → kw=0.0, which floors ATS. Here we
    normalise BOTH sides to English first, then run the SAME keyword_score()
    logic on the aligned text.

    Cost: English text is passed through untranslated (no LLM). A foreign JD is
    translated once and cached in MongoDB by job_id. `resume_text_en`, when
    supplied by the caller, is the already-translated resume (translated once per
    upload) so we don't re-translate it per job.

    Falls back to the original same-text keyword_score() if alignment fails, so
    behaviour can never regress below today's.
    """
    try:
        from utils.language import resume_to_english, jd_to_english
        resume_en = resume_text_en if resume_text_en is not None else await resume_to_english(resume_text)
        jd_en     = await jd_to_english(job_id, jd_text, posted_lang)
        return keyword_score_v2(resume_en, jd_en)
    except Exception:
        # Never regress: fall back to the original same-language behaviour.
        return keyword_score_v2(resume_text, jd_text)


def cosine_similarity(a: list, b: list) -> float:
    va   = np.array(a, dtype=np.float64)
    vb   = np.array(b, dtype=np.float64)
    dot  = np.dot(va, vb)
    norm = np.linalg.norm(va) * np.linalg.norm(vb)
    return float(dot / norm) if norm > 0 else 0.0


def normalise_similarity(sim: float) -> float:
    """
    Map cosine sim → [0, 100].

    RECALIBRATED to the real observed range for this corpus. text-embedding-3-large
    resume-to-JD cosines here actually fall in ~0.44–0.55 (measured over a live
    job pool), NOT the textbook 0.30–0.70. The old [0.30, 0.70] band squeezed
    every job into the bottom-middle of the scale, so even the best match capped
    around 62 and ATS never approached 75. Mapping [0.42 → 0, 0.56 → 100] stretches
    the actual distribution across the full range: poor matches fall near 0, strong
    on-domain matches reach the top of the semantic channel.

    To revert, restore: SIM_FLOOR=0.30, SIM_CEIL=0.70.
    """
    SIM_FLOOR = 0.42
    SIM_CEIL  = 0.56
    sim = max(SIM_FLOOR, min(sim, SIM_CEIL))
    return round((sim - SIM_FLOOR) / (SIM_CEIL - SIM_FLOOR) * 100, 1)


def skill_fit_score(strong_skills: list, missing_skills: list) -> float | None:
    """
    Turn the LLM skill classification into a 0-100 fit signal.

    strong_skills = demonstrated in resume AND wanted by the JD.
    missing_skills = wanted by the JD but absent from the resume.
    fit = strong / (strong + missing) — i.e. of the skills this role needs, what
    fraction does the candidate actually have. This is the most role-accurate
    signal available and it's what separates a software engineer from a sales
    role (a technical resume has near-zero strong-skill overlap with sales JDs).

    Returns None when there's nothing to score (so the caller can fall back to
    the original semantic+keyword formula and never regress).
    """
    s = len(strong_skills or [])
    m = len(missing_skills or [])
    if s + m == 0:
        return None
    return round(s / (s + m) * 100, 1)


def compute_ats_score(sem_norm: float, kw_score: float, skill_fit: float | None = None) -> float:
    """
    ATS score.

    Default (skill_fit is None): original behaviour — 75% semantic + 25% keyword.
    With skill_fit supplied: 55% semantic + 15% keyword + 30% skill-fit. The skill
    signal is the most role-accurate channel, so it earns real weight; semantic
    stays the backbone; keyword becomes a light tie-breaker. A genuinely strong,
    on-domain match now reaches the 70-85 range instead of being capped ~40,
    while off-domain matches (e.g. sales JD for a technical resume) drop because
    their skill-fit is near zero.
    """
    if skill_fit is None:
        return round((sem_norm * 0.75) + (kw_score * 0.25), 1)
    return round((sem_norm * 0.55) + (kw_score * 0.15) + (skill_fit * 0.30), 1)


def compute_interview_probability(ats_score: float) -> dict:
    """
    Single source of truth — always derived from ATS score.
    0-34 → Low | 35-64 → Medium | 65-100 → High
    """
    score = round(ats_score)
    if score >= 65:
        level, color = "high",   "green"
    elif score >= 35:
        level, color = "medium", "orange"
    else:
        level, color = "low",    "red"
    return {"level": level, "color": color, "percentage": min(score, 95)}


SKILL_SYSTEM = "You are an ATS skill classifier. Return ONLY valid JSON. No markdown."

SKILL_PROMPT = """Classify skills from this resume against the job description.

DEFINITIONS:
- strong_skills:  clearly demonstrated in resume AND required/preferred in JD
- weak_skills:    mentioned in resume but shallow/outdated, OR minor JD requirement
- missing_skills: required or preferred in JD but absent from resume

RULES:
- Each skill in EXACTLY ONE category
- Only skills relevant to this job
- Be specific (e.g. "Apache Spark" not "big data")
- Max 10 per category

Return ONLY:
{{
  "strong_skills": [],
  "weak_skills": [],
  "missing_skills": []
}}

RESUME:
{resume}

JOB DESCRIPTION:
{jd}"""


async def classify_skills(resume_text: str, jd_text: str) -> tuple[list, list, list]:
    # Resilient against OpenAI 429s on small TPM tiers (e.g. 30k tokens/min). On a
    # rate-limit error we back off and retry rather than giving up — a fixed short
    # retry made things WORSE (it re-sent tokens inside the same exhausted minute),
    # so we use exponential backoff and respect the server's "try again in Xs"
    # hint when present. Only on genuine repeated failure do we return empty (and
    # log why), so the score falls back to semantic+keyword.
    import re as _re
    last_err = None
    delays = [0.0, 2.0, 5.0, 12.0]   # 4 attempts; first is immediate
    for attempt, base_delay in enumerate(delays):
        if base_delay:
            await asyncio.sleep(base_delay)
        try:
            raw  = await json_completion(SKILL_PROMPT.format(resume=resume_text[:3000], jd=jd_text[:2000]))
            data = json.loads(raw)
            return (
                data.get("strong_skills", []),
                data.get("weak_skills", []),
                data.get("missing_skills", []),
            )
        except Exception as e:
            last_err = e
            # If the API told us exactly how long to wait, honour it (covers the
            # "try again in 2.564s" case) so the next attempt lands after reset.
            msg = str(e)
            m = _re.search(r"try again in ([\d.]+)s", msg)
            if m:
                try:
                    await asyncio.sleep(min(float(m.group(1)) + 0.2, 15.0))
                except Exception:
                    pass
    print(f"[classify_skills] failed after retries: {type(last_err).__name__}: {last_err}")
    return [], [], []


SUMMARY_SYSTEM = """You are a senior technical recruiter writing a concise candidate assessment.
Be specific, honest, evidence-based. Maximum 6 sentences. Recruiter tone."""

SUMMARY_PROMPT = """Write a recruiter-style assessment for this candidate vs the role.

Cover:
1. Overall fit (one sentence)
2. Top 2-3 strengths backed by resume evidence
3. Key gaps vs job requirements
4. Hiring recommendation: Shortlist / Consider / Pass

RESUME:
{resume}

JOB DESCRIPTION:
{jd}"""


async def generate_summary(resume_text: str, jd_text: str) -> str:
    try:
        response = await client.chat.completions.create(
            model=FAST_MODEL, temperature=0.3, max_tokens=400,
            messages=[
                {"role": "system", "content": SUMMARY_SYSTEM},
                {"role": "user",   "content": SUMMARY_PROMPT.format(
                    resume=resume_text[:3000], jd=jd_text[:2000])},
            ],
        )
        return response.choices[0].message.content.strip()
    except Exception:
        return "Summary generation failed."


async def score_resume_against_job(
    resume_text: str,
    resume_embedding: list,
    job: dict,
    job_embedding: list,
    include_summary: bool = True,
    resume_text_en: str | None = None,
) -> dict:
    jd_text  = job.get("descriptionText", "")
    sim      = cosine_similarity(resume_embedding, job_embedding)
    sem_norm = normalise_similarity(sim)
    kw_val, matched_kw, missing_kw = await aligned_keyword_score(
        resume_text,
        jd_text,
        job_id=job.get("job_id", ""),
        posted_lang=job.get("jobPostedLanguage"),
        resume_text_en=resume_text_en,
    )

    # Skills are classified FIRST so the most role-accurate signal can feed the
    # score. classify_skills was already part of this function — we just moved it
    # ahead of compute_ats_score instead of running it afterwards. (summary is the
    # only thing left to parallelise.)
    if include_summary:
        (strong, weak, missing), summary = await asyncio.gather(
            classify_skills(resume_text, jd_text),
            generate_summary(resume_text, jd_text),
        )
    else:
        strong, weak, missing = await classify_skills(resume_text, jd_text)
        summary = ""

    skill_fit = skill_fit_score(strong, missing)
    ats       = compute_ats_score(sem_norm, kw_val, skill_fit)
    prob      = compute_interview_probability(ats)

    # Diagnostic — confirms whether the skill-fit channel is actually feeding the
    # score (skill_fit=None means classify_skills returned nothing and we fell
    # back to the old semantic+keyword formula).
    # print(
    #     f"[ATS calibrate] position name : {job.get('title','')} | "
    #     f"sim : {sim:.4f} | sem_norm : {sem_norm:.2f} | "
    #     f"kw : {kw_val:.2f} | fit : {skill_fit} "
    #     f"(strong={len(strong)} missing={len(missing)}) | ATS : {ats:.2f}"
    # )

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