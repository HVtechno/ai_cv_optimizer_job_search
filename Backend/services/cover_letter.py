"""
Cover Letter & Motivation Letter generator.
Both use GPT-4o with structured prompts tailored to the job.
"""

import json
from core.openai_client import client, CHAT_MODEL
from prompts.active_prompt import active   # Phase 3: registry-or-constant resolver


# ── Cover Letter ──────────────────────────────────────────────────────────────

COVER_LETTER_SYSTEM = """You are an expert career coach who writes compelling,
personalized cover letters that get interviews.
Write in first person. Be specific, confident, and concise.
Never use generic phrases like "I am writing to express my interest".
Always mirror the company's language and culture from the job description."""

COVER_LETTER_PROMPT = """Write a professional cover letter for this candidate applying to this job.

CANDIDATE NAME: {candidate_name}
CURRENT ATS SCORE: {ats_score}%
STRONG SKILLS (highlight these): {strong_skills}
MISSING SKILLS (do not mention gaps — focus on strengths): {missing_skills}
MATCHED KEYWORDS (weave naturally): {matched_keywords}

STRUCTURE (4 paragraphs):
1. Opening hook — specific connection to this company/role, show you researched them
2. Key achievements — 2-3 concrete accomplishments matching their requirements (use real experience)
3. Why this company specifically — show genuine motivation, reference JD details
4. Closing — confident call to action

RULES:
- Max 350 words
- Use the candidate's actual experience from the resume
- Never fabricate companies, titles, or metrics not in the resume
- Mirror the tone and language of the job description
- Be specific — generic letters get ignored

RESUME:
{resume}

JOB DESCRIPTION:
{jd}

Write the full cover letter text only. No subject line. No "Dear Hiring Manager" boilerplate — 
use a specific name if mentioned in JD, otherwise start directly with the hook."""


# ── Motivation Letter ─────────────────────────────────────────────────────────

MOTIVATION_LETTER_SYSTEM = """You are an expert career coach who writes compelling motivation letters
for European-style job applications. Motivation letters are longer and more personal than cover letters —
they explain the candidate's passion, values, and long-term vision.
Write in first person. Be authentic and specific."""

MOTIVATION_LETTER_PROMPT = """Write a professional motivation letter for this candidate applying to this job.

CANDIDATE NAME: {candidate_name}
STRONG SKILLS (demonstrate these): {strong_skills}
MATCHED KEYWORDS (weave naturally): {matched_keywords}

STRUCTURE (5 paragraphs):
1. Personal motivation — why this specific role at this specific company excites them
2. Professional journey — how their career path has led to this moment
3. Key competencies — 3 specific ways their skills directly match the requirements
4. Alignment with company values/mission — show genuine research and fit
5. Vision — what they aim to contribute and achieve in this role

RULES:
- 450-550 words
- More personal and narrative than a cover letter
- Use specific details from both resume and job description
- Never fabricate experience or credentials
- European professional tone (formal but warm)

RESUME:
{resume}

JOB DESCRIPTION:
{jd}

Write the full motivation letter text only."""


async def generate_cover_letter(
    resume_text: str,
    jd_text: str,
    candidate_name: str,
    ats_data: dict,
    target_language: str = "English",
) -> str:
    # Honour the user's explicit language choice. This OVERRIDES the prompt's
    # "mirror the JD language" guidance — the user picked a language in the UI and
    # that wins. Defaults to English so callers that don't pass it are unchanged.
    lang_directive = (
        f"\n\nIMPORTANT: Write the entire cover letter in {target_language}. "
        f"Use natural, fluent, professional {target_language}."
    )
    try:
        response = await client.chat.completions.create(
            model=CHAT_MODEL,
            temperature=0.4,
            max_tokens=800,
            messages=[
                {"role": "system", "content": active("cover.letter_system", COVER_LETTER_SYSTEM) + lang_directive},
                {"role": "user",   "content": active("cover.letter_prompt", COVER_LETTER_PROMPT).format(
                    candidate_name=candidate_name,
                    ats_score=ats_data.get("score", 0),
                    strong_skills=", ".join(ats_data.get("strong_skills", [])),
                    missing_skills=", ".join(ats_data.get("missing_skills", [])),
                    matched_keywords=", ".join(ats_data.get("matched_keywords", [])[:10]),
                    resume=resume_text[:3000],
                    jd=jd_text[:2500],
                )},
            ],
        )
        return response.choices[0].message.content.strip()
    except Exception as e:
        return f"Cover letter generation failed: {e}"


async def generate_motivation_letter(
    resume_text: str,
    jd_text: str,
    candidate_name: str,
    ats_data: dict,
    target_language: str = "English",
) -> str:
    lang_directive = (
        f"\n\nIMPORTANT: Write the entire motivation letter in {target_language}. "
        f"Use natural, fluent, professional {target_language}."
    )
    try:
        response = await client.chat.completions.create(
            model=CHAT_MODEL,
            temperature=0.45,
            max_tokens=1000,
            messages=[
                {"role": "system", "content": active("cover.motivation_system", MOTIVATION_LETTER_SYSTEM) + lang_directive},
                {"role": "user",   "content": active("cover.motivation_prompt", MOTIVATION_LETTER_PROMPT).format(
                    candidate_name=candidate_name,
                    strong_skills=", ".join(ats_data.get("strong_skills", [])),
                    matched_keywords=", ".join(ats_data.get("matched_keywords", [])[:10]),
                    resume=resume_text[:3000],
                    jd=jd_text[:2500],
                )},
            ],
        )
        return response.choices[0].message.content.strip()
    except Exception as e:
        return f"Motivation letter generation failed: {e}"


def build_letter_html(text: str, candidate_name: str, letter_type: str) -> str:
    """Wrap letter text in clean printable HTML for PDF export."""
    paragraphs = "".join(
        f"<p style='margin-bottom:12pt;'>{line}</p>"
        for line in text.split("\n") if line.strip()
    )
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  @page {{ size: A4; margin: 2.5cm 2.2cm; }}
  body {{
    font-family: 'Georgia', serif;
    font-size: 11pt;
    line-height: 1.7;
    color: #1a1a1a;
  }}
  .header {{
    border-bottom: 2px solid #1a3a5c;
    padding-bottom: 10pt;
    margin-bottom: 20pt;
  }}
  .header h1 {{ font-size: 18pt; color: #1a3a5c; margin: 0 0 4pt 0; }}
  .header p  {{ font-size: 9pt;  color: #666;    margin: 0; }}
  .letter-type {{
    font-size: 10pt;
    font-weight: bold;
    color: #2d6da4;
    text-transform: uppercase;
    letter-spacing: 1px;
    margin-bottom: 16pt;
  }}
  p {{ margin-bottom: 12pt; }}
</style>
</head>
<body>
  <div class="header">
    <h1>{candidate_name}</h1>
  </div>
  <div class="letter-type">{letter_type}</div>
  {paragraphs}
</body>
</html>"""