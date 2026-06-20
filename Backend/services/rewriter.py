"""
4-pass resume rewriter — gap-aware, ATS-driven.

The key difference from a generic rewriter:
- Pass 0: Extract all sections
- Pass 1: Gap analysis using actual ATS data (missing_skills, weak_skills, missing_keywords)
- Pass 2: Rewrite each section with explicit mandate to incorporate every gap
- Pass 3: Assemble + validate all gaps were addressed

The rewriter receives the ATS engine output and uses it directly.
Goal: push interview probability up by at least one level (Low→Medium, Medium→High).
"""

import json
import asyncio
from core.openai_client import client, CHAT_MODEL
from prompts.active_prompt import active   # Phase 3: registry-or-constant resolver


MAX_TOKENS = 6000


# ── Pass 0: Extract ───────────────────────────────────────────────────────────

EXTRACT_SYSTEM = """You are a precise resume parser.
Extract every section exactly as written — do not rewrite, summarize, or omit anything.
Return ONLY valid JSON. No markdown. No code blocks."""

EXTRACT_PROMPT = """Parse this resume and return ALL sections.

Return this exact JSON:
{{
  "candidate_name": "Full Name",
  "contact": "everything in the contact block as a single string",
  "sections": [
    {{
      "section_type": "summary|experience|education|skills|certifications|achievements|projects|volunteer|publications|awards|languages|interests|references|other",
      "section_title": "exact heading as written in resume",
      "content_raw": "complete raw text of this section as a single plain string"
    }}
  ],
  "all_employers": ["Company A", "Company B"],
  "all_job_entries_count": 2
}}

Rules:
- Include EVERY section, never drop any
- Include ALL jobs in experience sections
- content_raw must be COMPLETE plain text — no nested objects

RESUME:
{resume}"""


# ── Pass 1: ATS-informed gap analysis ────────────────────────────────────────

GAP_SYSTEM = """You are an expert ATS resume strategist.
Given the resume, job description, and existing ATS gap data, produce a precise rewrite plan.
Return ONLY valid JSON. No markdown."""

GAP_PROMPT = """Produce a resume rewrite plan to maximize ATS score for this job.

EXISTING ATS ANALYSIS:
- Current ATS score: {ats_score}%
- Interview probability: {probability} (target: push to next level or higher)
- Missing skills (MUST be incorporated): {missing_skills}
- Weak skills (MUST be strengthened): {weak_skills}
- Strong skills (MUST be preserved): {strong_skills}
- Missing keywords (MUST appear in rewritten resume): {missing_keywords}
- Matched keywords (already good, keep): {matched_keywords}

Return this exact JSON:
{{
  "target_probability": "medium|high",
  "resume_language": "en",
  "jd_language": "en",
  "languages_differ": false,
  "critical_keywords_to_add": ["kw1", "kw2"],
  "skills_to_strengthen": ["skill1"],
  "skills_to_add_naturally": ["skill1"],
  "key_responsibilities": ["resp1"],
  "required_skills": ["skill1"],
  "preferred_skills": ["skill1"],
  "experience_level": "senior",
  "industry_terms": ["term1"],
  "tone": "technical",
  "section_priorities": {{
    "summary": "CRITICAL - must include all missing keywords and reframe around job",
    "skills": "CRITICAL - add all missing skills, remove irrelevant ones",
    "experience": "HIGH - rewrite bullets to mirror JD language and responsibilities"
  }}
}}

RESUME:
{resume}

JOB DESCRIPTION:
{jd}"""


# ── Pass 2: Section rewriter — gap-aware ─────────────────────────────────────

REWRITE_SYSTEM = """You are a world-class ATS resume optimizer with one goal:
maximize the candidate's interview probability for this specific job.

ABSOLUTE RULES:
1. INCORPORATE all missing skills and keywords naturally — this is mandatory
2. STRENGTHEN weak skills by adding context, tools, scale, or outcomes
3. PRESERVE strong skills exactly — do not water them down
4. Never fabricate companies, degrees, or job titles not in the original
5. Real metrics (30%, $2M, 10x) must be kept exactly
6. Where no metric exists, write strong evidence-based bullets — NO placeholders like [X%]
7. Mirror the job description language throughout — use the exact terminology they use
8. Output in the specified target language
9. Return ONLY the rewritten plain text — no JSON, no commentary, no markdown"""

REWRITE_PROMPT = """Rewrite this resume section to maximize ATS score for the target job.

SECTION TYPE: {section_type}
SECTION TITLE: {section_title}
TARGET LANGUAGE: {target_language}

MANDATORY KEYWORDS TO INCORPORATE (all of these must appear naturally): 
{critical_keywords}

SKILLS TO ADD OR STRENGTHEN (weave into bullets and descriptions):
{skills_to_add}

SKILLS TO PRESERVE (keep exactly, do not remove):
{strong_skills}

JOB TONE / STYLE: {tone}
TARGET EXPERIENCE LEVEL: {experience_level}

ORIGINAL SECTION CONTENT:
{content}

JOB DESCRIPTION (for full context):
{jd}

IMPORTANT: Every keyword and skill in the mandatory list must appear in your output.
Integrate them naturally into context — not as a list dump.
Return ONLY the rewritten section in {target_language}."""


# ── Pass 3: Assemble ─────────────────────────────────────────────────────────

ASSEMBLE_SYSTEM = """You are a resume assembler and quality checker.
Assemble the rewritten sections into a complete structured JSON resume.
Also verify all mandatory gaps were filled.
Return ONLY valid JSON. No markdown. No code blocks."""

ASSEMBLE_PROMPT = """Assemble these rewritten sections into a complete structured resume.

CANDIDATE NAME: {name}
CONTACT INFO: {contact}
TARGET LANGUAGE: {target_language}

MANDATORY KEYWORDS THAT MUST APPEAR IN FINAL RESUME:
{critical_keywords}

MISSING SKILLS THAT MUST BE IN SKILLS SECTION:
{missing_skills}

REWRITTEN SECTIONS:
{sections_json}

Return this exact JSON:
{{
  "contact": "full contact block as plain string",
  "summary": "summary paragraph as plain string",
  "experience": [
    {{
      "title": "Job Title",
      "company": "Company",
      "dates": "dates",
      "bullets": ["bullet 1", "bullet 2", "bullet 3"]
    }}
  ],
  "education": [
    {{
      "degree": "degree",
      "institution": "institution",
      "year": "year",
      "details": ""
    }}
  ],
  "skills": {{
    "technical": ["skill1", "skill2"],
    "tools": ["tool1"],
    "soft": ["skill1"]
  }},
  "certifications": ["cert 1"],
  "projects": [
    {{
      "name": "project name",
      "description": "description",
      "tech": ["tech1"]
    }}
  ],
  "extra_sections": [
    {{
      "title": "Section Title",
      "content": "full content as plain string"
    }}
  ],
  "changes_made": [
    "Added [skill] to skills section to address gap",
    "Strengthened [skill] with specific context in [Company] role",
    "Incorporated keyword [kw] into summary and experience bullets"
  ],
  "gaps_addressed": ["skill1", "skill2"],
  "keywords_added": ["kw1", "kw2"]
}}

CRITICAL:
- skills.technical and skills.tools MUST include all missing skills from the mandatory list
- If a missing skill cannot be found in experience, add it to skills section as a known technology
- Include ALL jobs — none may be dropped
- Education: include ONLY if present in sections — NEVER invent education entries
- changes_made must specifically list what gaps were filled and how"""


# ── Pipeline helpers ──────────────────────────────────────────────────────────

async def _llm(messages: list, max_tokens: int = MAX_TOKENS, temperature: float = 0.1) -> str:
    response = await client.chat.completions.create(
        model=CHAT_MODEL,
        temperature=temperature,
        max_tokens=max_tokens,
        messages=messages,
    )
    return (
        response.choices[0].message.content.strip()
        .replace("```json", "").replace("```", "").strip()
    )


async def extract_all_sections(resume_text: str) -> dict:
    raw = await _llm([
        {"role": "system", "content": active("rewriter.extract_system", EXTRACT_SYSTEM)},
        {"role": "user",   "content": active("rewriter.extract_prompt", EXTRACT_PROMPT).format(resume=resume_text)},
    ], temperature=0)
    return json.loads(raw)


async def analyze_gap(resume_text: str, jd_text: str, ats_data: dict) -> dict:
    raw = await _llm([
        {"role": "system", "content": active("rewriter.gap_system", GAP_SYSTEM)},
        {"role": "user",   "content": active("rewriter.gap_prompt", GAP_PROMPT).format(
            resume=resume_text,
            jd=jd_text,
            ats_score=ats_data.get("score", 0),
            probability=ats_data.get("interview_probability", "low"),
            missing_skills=", ".join(ats_data.get("missing_skills", [])),
            weak_skills=", ".join(ats_data.get("weak_skills", [])),
            strong_skills=", ".join(ats_data.get("strong_skills", [])),
            missing_keywords=", ".join(ats_data.get("missing_keywords", [])),
            matched_keywords=", ".join(ats_data.get("matched_keywords", [])),
        )},
    ], max_tokens=2000, temperature=0.1)
    return json.loads(raw)


async def rewrite_section(
    section: dict,
    jd_text: str,
    gap: dict,
    target_language: str,
) -> dict:
    critical_keywords = ", ".join(
        gap.get("critical_keywords_to_add", []) +
        gap.get("missing_keywords_to_inject", [])
    ) or ", ".join(gap.get("required_skills", []))

    skills_to_add = ", ".join(
        gap.get("skills_to_add_naturally", []) +
        gap.get("skills_to_strengthen", [])
    )

    content_raw = section.get("content_raw", "")
    if isinstance(content_raw, dict):
        content_raw = json.dumps(content_raw)
    elif isinstance(content_raw, list):
        content_raw = "\n".join(str(x) for x in content_raw)

    rewritten = await _llm([
        {"role": "system", "content": active("rewriter.rewrite_system", REWRITE_SYSTEM)},
        {"role": "user",   "content": active("rewriter.rewrite_prompt", REWRITE_PROMPT).format(
            section_type=section["section_type"],
            section_title=section["section_title"],
            target_language=target_language,
            critical_keywords=critical_keywords,
            skills_to_add=skills_to_add,
            strong_skills=", ".join(gap.get("strong_skills_from_ats", [])),
            tone=gap.get("tone", "professional"),
            experience_level=gap.get("experience_level", "mid"),
            content=content_raw,
            jd=jd_text,
        )},
    ], temperature=0.2)

    return {**section, "content_rewritten": rewritten}


async def assemble_resume(
    rewritten_sections: list,
    candidate_name: str,
    contact: str,
    target_language: str,
    gap: dict,
    ats_data: dict,
) -> tuple[dict, list]:
    sections_payload = [
        {
            "title":   s["section_title"],
            "type":    s["section_type"],
            "content": s.get("content_rewritten", s.get("content_raw", "")),
        }
        for s in rewritten_sections
    ]

    critical_keywords = ", ".join(gap.get("critical_keywords_to_add", []))
    missing_skills    = ", ".join(ats_data.get("missing_skills", []))

    raw = await _llm([
        {"role": "system", "content": active("rewriter.assemble_system", ASSEMBLE_SYSTEM)},
        {"role": "user",   "content": active("rewriter.assemble_prompt", ASSEMBLE_PROMPT).format(
            name=candidate_name,
            contact=contact,
            target_language=target_language,
            critical_keywords=critical_keywords,
            missing_skills=missing_skills,
            sections_json=json.dumps(sections_payload, indent=2),
        )},
    ], temperature=0.1)

    parsed  = json.loads(raw)
    changes = parsed.pop("changes_made", ["ATS-optimized all sections"])
    parsed.pop("gaps_addressed", None)
    parsed.pop("keywords_added", None)

    # Education safety guard
    section_types = [s.get("section_type", "") for s in rewritten_sections]
    if "education" not in section_types:
        parsed["education"] = []

    return parsed, changes


async def rewrite_resume(
    resume_text: str,
    jd_text: str,
    target_language: str = "English",
    ats_data: dict = None,
) -> tuple[dict, list]:
    """
    Full 4-pass gap-aware rewrite.
    ats_data: output from score_resume_against_job() — used to drive gap filling.
    If not provided, gap analysis runs blind (less effective).
    """
    if ats_data is None:
        ats_data = {}

    # Pass 0: extract
    extracted = await extract_all_sections(resume_text)
    sections  = extracted.get("sections", [])
    contact   = extracted.get("contact", "")
    name      = extracted.get("candidate_name", "Candidate")

    if not sections:
        raise ValueError("Could not extract any sections from resume.")

    # Pass 1: gap analysis (ATS-informed)
    gap = await analyze_gap(resume_text, jd_text, ats_data)

    # Attach strong_skills from ATS data so rewriter can preserve them
    gap["strong_skills_from_ats"] = ats_data.get("strong_skills", [])

    # Pass 2: rewrite all sections in parallel
    rewritten_sections = await asyncio.gather(*[
        rewrite_section(s, jd_text, gap, target_language)
        for s in sections
    ])

    # Pass 3: assemble
    final_data, changes = await assemble_resume(
        list(rewritten_sections), name, contact, target_language, gap, ats_data
    )

    return final_data, changes


# ── Resume dict → plain text (for re-scoring) ────────────────────────────────

def _safe_str(val) -> str:
    if val is None:           return ""
    if isinstance(val, str):  return val
    if isinstance(val, dict): return json.dumps(val)
    if isinstance(val, list): return "\n".join(_safe_str(x) for x in val)
    return str(val)


def resume_dict_to_text(data: dict) -> str:
    parts = []
    if data.get("summary"):
        parts.append(_safe_str(data["summary"])); parts.append("")
    for exp in data.get("experience", []):
        if isinstance(exp, dict):
            for f in ("title", "company", "dates"):
                v = _safe_str(exp.get(f, ""))
                if v: parts.append(v)
            for b in exp.get("bullets", []):
                b = _safe_str(b).lstrip("•·-– ").strip()
                if b: parts.append(b)
            parts.append("")
        else:
            parts.append(_safe_str(exp))
    s = data.get("skills", {})
    if isinstance(s, dict):
        all_skills = (
            [_safe_str(x) for x in s.get("technical", []) if x] +
            [_safe_str(x) for x in s.get("tools",     []) if x] +
            [_safe_str(x) for x in s.get("soft",      []) if x]
        )
        if all_skills:
            parts.append(", ".join(all_skills)); parts.append("")
    for e in data.get("education", []):
        if isinstance(e, dict):
            for f in ("degree", "institution", "year", "details"):
                v = _safe_str(e.get(f, ""))
                if v: parts.append(v)
        else:
            parts.append(_safe_str(e))
    if data.get("education"): parts.append("")
    for c in data.get("certifications", []):
        v = _safe_str(c).strip()
        if v: parts.append(v)
    if data.get("certifications"): parts.append("")
    for p in data.get("projects", []):
        if isinstance(p, dict):
            for f in ("name", "description"):
                v = _safe_str(p.get(f, ""))
                if v: parts.append(v)
            tech = p.get("tech", [])
            if tech: parts.append(", ".join(_safe_str(t) for t in tech if t))
        else:
            parts.append(_safe_str(p))
    if data.get("projects"): parts.append("")
    for sec in data.get("extra_sections", []):
        if isinstance(sec, dict):
            t = _safe_str(sec.get("title", "")).strip()
            c = _safe_str(sec.get("content", "")).strip()
            if t: parts.append(t)
            for line in c.splitlines():
                line = line.strip()
                if line: parts.append(line)
        else:
            parts.append(_safe_str(sec))
    return "\n".join(parts)