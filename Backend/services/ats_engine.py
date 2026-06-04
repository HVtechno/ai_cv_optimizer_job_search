"""
ATS Engine — embedding-based scoring, calibrated for real data.

CALIBRATION:
  text-embedding-3-large cosine sim range for resume-to-JD: 0.30 – 0.70
  Mapped to [0.30→0, 0.70→100] so full scale is used.
  Semantic weight: 75%  |  Keyword weight: 25%

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


def cosine_similarity(a: list, b: list) -> float:
    va   = np.array(a, dtype=np.float64)
    vb   = np.array(b, dtype=np.float64)
    dot  = np.dot(va, vb)
    norm = np.linalg.norm(va) * np.linalg.norm(vb)
    return float(dot / norm) if norm > 0 else 0.0


def normalise_similarity(sim: float) -> float:
    """Map cosine sim [0.30, 0.70] → [0, 100]."""
    sim = max(0.30, min(sim, 0.70))
    return round((sim - 0.30) / 0.40 * 100, 1)


def compute_ats_score(sem_norm: float, kw_score: float) -> float:
    """75% semantic + 25% keyword."""
    return round((sem_norm * 0.75) + (kw_score * 0.25), 1)


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
    try:
        raw  = await json_completion(SKILL_PROMPT.format(resume=resume_text[:3000], jd=jd_text[:2000]))
        data = json.loads(raw)
        return data.get("strong_skills",[]), data.get("weak_skills",[]), data.get("missing_skills",[])
    except Exception:
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
) -> dict:
    jd_text  = job.get("descriptionText", "")
    sim      = cosine_similarity(resume_embedding, job_embedding)
    sem_norm = normalise_similarity(sim)
    kw_val, matched_kw, missing_kw = keyword_score(resume_text, jd_text)
    ats      = compute_ats_score(sem_norm, kw_val)
    prob     = compute_interview_probability(ats)

    if include_summary:
        (strong, weak, missing), summary = await asyncio.gather(
            classify_skills(resume_text, jd_text),
            generate_summary(resume_text, jd_text),
        )
    else:
        strong, weak, missing = await classify_skills(resume_text, jd_text)
        summary = ""

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