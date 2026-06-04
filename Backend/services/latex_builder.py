"""
Builds a LaTeX resume from structured resume dict.
Used for Overleaf export — pasted into main.tex → compile → PDF.
"""

import re


def escape_latex(text: str) -> str:
    if not text:
        return ""
    replacements = [
        ("\\", r"\textbackslash{}"),
        ("&",  r"\&"),
        ("%",  r"\%"),
        ("$",  r"\$"),
        ("#",  r"\#"),
        ("_",  r"\_"),
        ("{",  r"\{"),
        ("}",  r"\}"),
        ("~",  r"\textasciitilde{}"),
        ("^",  r"\textasciicircum{}"),
    ]
    for char, replacement in replacements:
        text = text.replace(char, replacement)
    return text


def clean_bullet(bullet: str) -> str:
    return bullet.lstrip("•·-– ").strip()


def build_latex(resume_data: dict, candidate_name: str = "Candidate") -> str:
    contact_raw = resume_data.get("contact", "")
    lines = [l.strip() for l in contact_raw.split("\n") if l.strip()]
    contact_details = lines[1:] if lines else []
    contact_line = " $|$ ".join(escape_latex(c) for c in contact_details[:4])

    skills_data      = resume_data.get("skills", {})
    technical_skills = skills_data.get("technical", [])
    tools_skills     = skills_data.get("tools", [])
    soft_skills      = skills_data.get("soft", [])

    def skill_row(label: str, items: list) -> str:
        if not items:
            return ""
        escaped = ", ".join(escape_latex(s) for s in items)
        return f"  \\skillrow{{{escape_latex(label)}}}{{{escaped}}}\n"

    skills_block = ""
    if technical_skills: skills_block += skill_row("Technical", technical_skills)
    if tools_skills:     skills_block += skill_row("Tools \\& Platforms", tools_skills)
    if soft_skills:      skills_block += skill_row("Core Skills", soft_skills)

    experience_block = ""
    for exp in resume_data.get("experience", []):
        title   = escape_latex(exp.get("title",   ""))
        company = escape_latex(exp.get("company", ""))
        dates   = escape_latex(exp.get("dates",   ""))
        bullets = exp.get("bullets", [])
        bullet_items = "\n".join(
            f"      \\item {escape_latex(clean_bullet(b))}"
            for b in bullets if b.strip()
        )
        experience_block += f"""
  \\expentry
    {{{title}}}
    {{{company}}}
    {{{dates}}}
    {{
      \\begin{{itemize}}[leftmargin=*, nosep, topsep=2pt]
{bullet_items}
      \\end{{itemize}}
    }}
"""

    raw_edu = [
        e for e in resume_data.get("education", [])
        if isinstance(e, dict) and (e.get("degree","").strip() or e.get("institution","").strip())
    ]
    education_block = ""
    for edu in raw_edu:
        education_block += (
            f"  \\eduentry"
            f"{{{escape_latex(edu.get('degree',''))}}}"
            f"{{{escape_latex(edu.get('institution',''))}}}"
            f"{{{escape_latex(str(edu.get('year','')))}}} "
            f"{{{escape_latex(edu.get('details',''))}}}\n"
        )

    certs = resume_data.get("certifications", [])
    certs_block = ""
    if certs:
        cert_items = "\n".join(f"  \\item {escape_latex(c)}" for c in certs if c.strip())
        certs_block = f"""\\sectiontitle{{Certifications}}
\\begin{{itemize}}[leftmargin=1.5em, nosep, topsep=2pt]
{cert_items}
\\end{{itemize}}
\\vspace{{6pt}}
"""

    projects = resume_data.get("projects", [])
    projects_block = ""
    if projects:
        proj_items = ""
        for proj in projects:
            pname = escape_latex(proj.get("name", ""))
            pdesc = escape_latex(proj.get("description", ""))
            ptech = ", ".join(escape_latex(t) for t in proj.get("tech", []))
            proj_items += f"  \\projectentry{{{pname}}}{{{pdesc}}}{{{ptech}}}\n"
        projects_block = f"""\\sectiontitle{{Projects}}
{proj_items}
\\vspace{{6pt}}
"""

    summary_text = escape_latex(resume_data.get("summary", ""))
    name_escaped = escape_latex(candidate_name)

    education_title = (
        r"\sectiontitle{Education}"
        if education_block.strip()
        else "% No education"
    )

    return rf"""% ─────────────────────────────────────────────────────────
%  ATS-Optimized Resume
% ─────────────────────────────────────────────────────────
\documentclass[10pt, letterpaper]{{article}}

\usepackage[margin=0.65in, top=0.55in, bottom=0.55in]{{geometry}}
\usepackage{{fontenc}}
\usepackage{{inputenc}}
\usepackage{{lmodern}}
\usepackage{{microtype}}
\usepackage{{titlesec}}
\usepackage{{enumitem}}
\usepackage{{xcolor}}
\usepackage{{tabularx}}
\usepackage{{array}}
\usepackage{{hyperref}}
\usepackage{{parskip}}
\usepackage{{setspace}}
\usepackage{{ifthen}}

\definecolor{{accent}}{{HTML}}{{1a3a5c}}
\definecolor{{rule}}{{HTML}}{{2d6da4}}
\definecolor{{lightgray}}{{HTML}}{{666666}}

\hypersetup{{colorlinks=true,urlcolor=rule,linkcolor=rule,hidelinks}}

\newcommand{{\sectiontitle}}[1]{{
  \vspace{{6pt}}
  {{\color{{accent}}\large\bfseries\MakeUppercase{{#1}}}}\par
  \vspace{{1pt}}
  {{\color{{rule}}\hrule height 0.8pt}}\par
  \vspace{{4pt}}
}}

\newcommand{{\expentry}}[4]{{
  \noindent
  \begin{{tabularx}}{{\textwidth}}{{Xr}}
    {{\bfseries #1}}, {{\color{{lightgray}}#2}} & {{\color{{lightgray}}\small #3}}
  \end{{tabularx}}
  \vspace{{1pt}}
  #4
  \vspace{{5pt}}
}}

\newcommand{{\eduentry}}[4]{{
  \noindent
  \begin{{tabularx}}{{\textwidth}}{{Xr}}
    {{\bfseries #1}} --- #2 & {{\color{{lightgray}}\small #3}}
  \end{{tabularx}}
  \ifthenelse{{\equal{{#4}}{{}}}}{{}}{{
    \par\vspace{{1pt}}{{\small\color{{lightgray}}#4}}
  }}
  \vspace{{4pt}}
}}

\newcommand{{\skillrow}}[2]{{
  \noindent
  \begin{{tabularx}}{{\textwidth}}{{>{{}}p{{2.8cm}}<{{}}X}}
    {{\bfseries\small #1:}} & {{\small #2}}
  \end{{tabularx}}
  \vspace{{2pt}}
}}

\newcommand{{\projectentry}}[3]{{
  \noindent
  {{\bfseries #1}} --- \small{{#2}}
  \ifthenelse{{\equal{{#3}}{{}}}}{{}}{{
    \par\vspace{{1pt}}{{\color{{lightgray}}\small\textit{{Tech: #3}}}}
  }}
  \vspace{{4pt}}
}}

\pagestyle{{empty}}
\setlength{{\parindent}}{{0pt}}

\begin{{document}}

\begin{{center}}
  {{\Huge\bfseries\color{{accent}} {name_escaped}}}\par
  \vspace{{4pt}}
  {{\small\color{{lightgray}} {contact_line}}}
\end{{center}}

\vspace{{4pt}}

\sectiontitle{{Professional Summary}}
\noindent {summary_text}

\vspace{{6pt}}

\sectiontitle{{Professional Experience}}
{experience_block}

\sectiontitle{{Skills}}
{skills_block}
\vspace{{4pt}}

{education_title}
{education_block}

{certs_block}

{projects_block}

\end{{document}}
"""