"""
Language alignment for cross-language ATS keyword matching.

WHY THIS EXISTS
  The embedding (semantic) channel is multilingual, so cosine similarity works
  fine across English/Dutch. The KEYWORD channel is not — it intersects raw
  surface tokens, so an English resume vs a Dutch JD yields 0 matched keywords
  (e.g. "developer" never equals "ontwikkelaar"). That zeroes the 25% keyword
  weight on every cross-language pair and floors the ATS score.

  Fix: normalise BOTH sides to English before keyword extraction. EN text is
  passed through untouched (no cost); only non-English text is translated.

COST CONTROL
  - English text → returned as-is, zero LLM calls.
  - A resume is translated at most ONCE per upload (same text vs all jobs).
  - A job description is translated ONCE EVER, then cached in MongoDB
    (jd_translations) keyed by job_id — every later score reuses the cache.
  Steady-state extra cost is therefore ~0; only brand-new foreign jobs / new
  resume uploads pay a single FAST_MODEL call.

This module is purely additive — it does not change any existing scoring code
path. ats_engine calls into it; if anything here fails, callers fall back to the
original same-language behaviour.
"""

import re
from core.openai_client import client, FAST_MODEL
from db.mongodb import MongoDB

db = MongoDB()


# Common Dutch function words — used for a cheap, no-LLM language guess. We only
# need to distinguish "English" from "not English (treat as Dutch)", since those
# are the two languages in the job corpus.
_DUTCH_MARKERS = {
    "de", "het", "een", "en", "van", "op", "te", "dat", "die", "niet",
    "aan", "met", "als", "voor", "zijn", "er", "bij", "uit", "naar",
    "worden", "wij", "jij", "jouw", "onze", "ervaring", "werk", "functie",
    "vacature", "bedrijf", "binnen", "samen", "ook", "om", "of",
    "ontwikkelaar", "verkoop", "klant", "klanten", "klantrelaties",
    "omzet", "jaar", "kennis", "taken", "afdeling", "wij", "jouw",
}

_WORD_RE = re.compile(r"\b[a-zà-ÿ]+\b")


def detect_language(text: str) -> str:
    """
    Cheap heuristic language guess. Returns "en" or "nl".

    NOT a full language classifier — it only separates English from Dutch, which
    is all the corpus needs. No network / LLM call. If the text is too short or
    ambiguous, defaults to "en" (the safe no-op for alignment).
    """
    if not text:
        return "en"
    words = _WORD_RE.findall(text.lower())
    if not words:
        return "en"
    sample = words[:400]
    hits = sum(1 for w in sample if w in _DUTCH_MARKERS)
    # Dutch prose is dense with these markers; ~6%+ is a confident Dutch signal.
    ratio = hits / len(sample)
    return "nl" if ratio >= 0.06 else "en"


def _normalize_lang(raw) -> str | None:
    """Map a stored jobPostedLanguage value to 'en'/'nl', or None if unknown."""
    if not raw or not isinstance(raw, str):
        return None
    r = raw.strip().lower()
    if r in ("en", "eng", "english"):
        return "en"
    if r in ("nl", "nld", "dut", "dutch", "nederlands"):
        return "nl"
    return None


_TRANSLATE_SYSTEM = (
    "You are a professional translator. Translate the given text to natural, "
    "fluent English, preserving technical terms, job titles, tool names and "
    "skill names. Output ONLY the translation — no preamble, no notes."
)


async def _llm_translate_to_english(text: str) -> str:
    """Single FAST_MODEL translation call. Returns original text on any failure."""
    try:
        resp = await client.chat.completions.create(
            model=FAST_MODEL,
            temperature=0.0,
            max_tokens=2000,
            messages=[
                {"role": "system", "content": _TRANSLATE_SYSTEM},
                {"role": "user",   "content": text[:6000]},
            ],
        )
        out = (resp.choices[0].message.content or "").strip()
        return out or text
    except Exception:
        # Never let a translation hiccup break scoring — fall back to original.
        return text


async def resume_to_english(resume_text: str) -> str:
    """
    Return the resume text in English. English in → English out (no LLM call).
    Translated once per upload by the caller; result is reused across all jobs.
    """
    if not resume_text:
        return resume_text
    if detect_language(resume_text) == "en":
        return resume_text
    return await _llm_translate_to_english(resume_text)


async def jd_to_english(job_id: str, jd_text: str, posted_lang=None) -> str:
    """
    Return the job description in English, using the DB cache.

    `posted_lang` is the stored jobPostedLanguage (preferred, free signal). If it
    says English we skip everything. If it's missing/unknown we fall back to the
    heuristic detector. Translations are cached in jd_translations by job_id so a
    given foreign JD is translated at most once, ever.
    """
    if not jd_text:
        return jd_text

    lang = _normalize_lang(posted_lang)
    if lang is None:
        lang = detect_language(jd_text)
    if lang == "en":
        return jd_text

    # Cache hit → free.
    cached = db.get_jd_translation(job_id, "en") if job_id else None
    if cached:
        return cached

    translated = await _llm_translate_to_english(jd_text)
    if job_id and translated and translated != jd_text:
        db.save_jd_translation(job_id, translated, "en")
    return translated