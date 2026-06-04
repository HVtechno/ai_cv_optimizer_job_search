"""
PDF generator using WeasyPrint.
build_html_resume() → clean HTML string
html_to_pdf()       → PDF bytes
"""

from weasyprint import HTML, CSS
from weasyprint.text.fonts import FontConfiguration


RESUME_CSS = """
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap');

* { margin: 0; padding: 0; box-sizing: border-box; }

@page {
    size: A4;
    margin: 1.8cm 1.6cm 1.8cm 1.6cm;
}

body {
    font-family: 'Inter', 'Helvetica Neue', Arial, sans-serif;
    font-size: 9.5pt;
    line-height: 1.55;
    color: #1a1a1a;
}

.header {
    text-align: center;
    margin-bottom: 14pt;
    padding-bottom: 10pt;
    border-bottom: 2px solid #1a3a5c;
}

.header h1 {
    font-size: 22pt;
    font-weight: 600;
    color: #1a3a5c;
    letter-spacing: -0.3px;
    margin-bottom: 4pt;
}

.contact-line {
    font-size: 8.5pt;
    color: #555;
    line-height: 1.6;
}

.contact-line span { margin: 0 6px; color: #2d6da4; }

.section-title {
    font-size: 9pt;
    font-weight: 600;
    color: #1a3a5c;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    border-bottom: 1px solid #2d6da4;
    padding-bottom: 2pt;
    margin: 12pt 0 6pt 0;
}

.exp-entry { margin-bottom: 9pt; }

.exp-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 3pt;
}

.exp-title { font-weight: 600; font-size: 9.5pt; color: #1a1a1a; }
.exp-company { font-weight: 400; color: #444; font-size: 9pt; }
.exp-dates { font-size: 8.5pt; color: #666; white-space: nowrap; margin-left: 8pt; }

ul.bullets { margin-left: 13pt; margin-top: 2pt; }
ul.bullets li { margin-bottom: 2pt; font-size: 9pt; color: #222; line-height: 1.5; }

.skills-table { width: 100%; border-collapse: collapse; }
.skills-table td { font-size: 9pt; padding: 2pt 0; vertical-align: top; }
.skills-label { font-weight: 600; color: #1a3a5c; width: 110pt; white-space: nowrap; }
.skills-value { color: #333; }

.edu-entry {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 5pt;
}

.edu-degree { font-weight: 600; font-size: 9pt; }
.edu-institution { font-size: 9pt; color: #444; }
.edu-year { font-size: 8.5pt; color: #666; white-space: nowrap; margin-left: 8pt; }
.edu-details { font-size: 8.5pt; color: #666; margin-top: 1pt; }

ul.cert-list { margin-left: 13pt; }
ul.cert-list li { font-size: 9pt; margin-bottom: 2pt; color: #222; }

.project-entry { margin-bottom: 7pt; }
.project-name { font-weight: 600; font-size: 9pt; color: #1a3a5c; }
.project-desc { font-size: 9pt; color: #333; margin-top: 1pt; }
.project-tech { font-size: 8.5pt; color: #666; font-style: italic; margin-top: 1pt; }

.extra-content { font-size: 9pt; color: #222; line-height: 1.6; }
"""


def _safe(text: str) -> str:
    if not text:
        return ""
    return (
        text.replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace('"', "&quot;")
    )


def _clean_bullet(b: str) -> str:
    return b.lstrip("•·-– ").strip()


def build_html_resume(
    resume_data: dict,
    candidate_name: str = "Candidate",
) -> str:
    # Contact
    contact_raw   = resume_data.get("contact", "")
    contact_lines = [l.strip() for l in contact_raw.split("\n") if l.strip()]
    contact_details = contact_lines[1:] if len(contact_lines) > 1 else contact_lines
    contact_html  = " <span>|</span> ".join(_safe(c) for c in contact_details[:5])

    # Summary
    summary_html = ""
    if resume_data.get("summary"):
        summary_html = f"""
        <div class="section-title">Professional Summary</div>
        <p style="font-size:9pt;color:#222;line-height:1.6;">{_safe(resume_data["summary"])}</p>
        """

    # Experience
    exp_html = ""
    for exp in resume_data.get("experience", []):
        bullets = "".join(
            f"<li>{_safe(_clean_bullet(b))}</li>"
            for b in exp.get("bullets", []) if b.strip()
        )
        exp_html += f"""
        <div class="exp-entry">
          <div class="exp-header">
            <div>
              <span class="exp-title">{_safe(exp.get("title",""))}</span>
              <span class="exp-company"> &mdash; {_safe(exp.get("company",""))}</span>
            </div>
            <span class="exp-dates">{_safe(exp.get("dates",""))}</span>
          </div>
          <ul class="bullets">{bullets}</ul>
        </div>"""

    # Skills
    skills_data = resume_data.get("skills", {})
    skills_rows = ""
    if skills_data.get("technical"):
        skills_rows += f'<tr><td class="skills-label">Technical</td><td class="skills-value">{_safe(", ".join(skills_data["technical"]))}</td></tr>'
    if skills_data.get("tools"):
        skills_rows += f'<tr><td class="skills-label">Tools &amp; Platforms</td><td class="skills-value">{_safe(", ".join(skills_data["tools"]))}</td></tr>'
    if skills_data.get("soft"):
        skills_rows += f'<tr><td class="skills-label">Core Skills</td><td class="skills-value">{_safe(", ".join(skills_data["soft"]))}</td></tr>'
    skills_html = ""
    if skills_rows:
        skills_html = f"""
        <div class="section-title">Skills</div>
        <table class="skills-table"><tbody>{skills_rows}</tbody></table>
        """

    # Education
    raw_edu = [
        e for e in resume_data.get("education", [])
        if isinstance(e, dict) and (e.get("degree","").strip() or e.get("institution","").strip())
    ]
    edu_html = ""
    for edu in raw_edu:
        details = f'<div class="edu-details">{_safe(edu.get("details",""))}</div>' if edu.get("details") else ""
        edu_html += f"""
        <div class="edu-entry" style="flex-direction:column;align-items:flex-start;">
          <div style="display:flex;justify-content:space-between;width:100%;">
            <div>
              <span class="edu-degree">{_safe(edu.get("degree",""))}</span>
              <span class="edu-institution"> &mdash; {_safe(edu.get("institution",""))}</span>
            </div>
            <span class="edu-year">{_safe(str(edu.get("year","")))}</span>
          </div>
          {details}
        </div>"""

    # Certifications
    certs_html = ""
    certs = resume_data.get("certifications", [])
    if certs:
        cert_items = "".join(f"<li>{_safe(c)}</li>" for c in certs if c.strip())
        certs_html = f"""
        <div class="section-title">Certifications</div>
        <ul class="cert-list">{cert_items}</ul>"""

    # Projects
    projects_html = ""
    for p in resume_data.get("projects", []):
        tech = f'<div class="project-tech">Tech: {_safe(", ".join(p.get("tech",[])))}</div>' if p.get("tech") else ""
        projects_html += f"""
        <div class="project-entry">
          <div class="project-name">{_safe(p.get("name",""))}</div>
          <div class="project-desc">{_safe(p.get("description",""))}</div>
          {tech}
        </div>"""
    if projects_html:
        projects_html = f'<div class="section-title">Projects</div>{projects_html}'

    # Extra sections
    extra_html = ""
    for sec in resume_data.get("extra_sections", []):
        title   = _safe(sec.get("title", ""))
        content = _safe(sec.get("content", "")).replace("\n", "<br>")
        extra_html += f"""
        <div class="section-title">{title}</div>
        <p class="extra-content">{content}</p>"""

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>{RESUME_CSS}</style>
</head>
<body>

<div class="header">
  <h1>{_safe(candidate_name)}</h1>
  <div class="contact-line">{contact_html}</div>
</div>

{summary_html}

{'<div class="section-title">Professional Experience</div>' if exp_html else ''}
{exp_html}

{skills_html}

{'<div class="section-title">Education</div>' if edu_html else ''}
{edu_html}

{certs_html}
{projects_html}
{extra_html}

</body>
</html>"""


def html_to_pdf(html: str) -> bytes:
    font_config = FontConfiguration()
    return HTML(string=html).write_pdf(
        stylesheets=[CSS(string="", font_config=font_config)],
        font_config=font_config,
    )
