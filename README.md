# Resuviq AI

AI-powered resume optimization and job-matching platform. Users upload a resume,
the system matches it against a job database using semantic embeddings, scores each
match with an ATS engine, and — for the jobs a user chooses — rewrites the resume,
generates cover/motivation letters, and exports polished PDFs. Access is tiered
(Basic / Pro / Enterprise) and billed through Stripe.

- **Backend:** FastAPI (Python), MongoDB Atlas, OpenAI (embeddings + GPT-4o), WeasyPrint, Stripe
- **Frontend:** React (Vite), axios, React Router, react-toastify
- **Email:** SMTP (Hosting.nl mailbox) for verification, password reset, and account-deletion notices

---

## TABLE OF CONTENTS
1. [Business Logic](#1-business-logic)
2. [Functional Logic](#2-functional-logic) — every feature, AI embeddings → frontend
3. [Workflow](#3-workflow) — end-to-end user journeys
4. [Setup](#4-setup)
5. [Configuration](#5-configuration)

---

# 1. BUSINESS LOGIC

The product exists to improve a job seeker's chance of getting an interview. The
business model is a freemium SaaS with three tiers. Value is metered by **quotas**,
not by locking whole features away — even free users can rewrite resumes and
generate letters, just for a limited number of jobs.

## 1.1 Plans and limits

Defined once in `core/plans.py` (the single source of truth — the frontend reads a
serialized copy via `GET /billing/plans`, so the pricing page can never drift from
what the backend enforces).

| Capability | Basic (free) | Pro (€29/mo or €290/yr) | Enterprise (contact sales) |
|---|---|---|---|
| Max resumes stored | 1 | 10 | Unlimited |
| Max job matches per resume | 10 | 50 | 200 |
| Refresh quota | 3 / month (account-wide) | 30 / resume | Unlimited |
| Distinct jobs you can optimize | 3 / month | 10 / resume | Unlimited |
| Full filtering (location, radius, expiry, remote) | No (language only) | Yes | Yes |
| Full ATS breakdown (keywords + skills) | No (score only) | Yes | Yes |
| Resume rewrite | Yes (within quota) | Yes | Yes |
| Cover & motivation letters | Yes (within quota) | Yes | Yes |
| Regenerate (repeat AI on same job) | No (one-shot) | No (one-shot) | Yes |
| PDF export | Yes | Yes | Yes |
| Support | Community | Email | Priority |

Two different quota *models* exist by design:
- **Free** uses a **monthly** model — refreshes and optimizations reset each calendar month.
- **Pro** uses a **per-resume** model — each resume carries its own quota.
- **Enterprise** is unlimited and supports **per-user overrides** (`limit_overrides` on
  the user document) so a custom deal can be granted without any code change.

## 1.2 Where enforcement lives

All limits are enforced on the **backend**. The UI lock (greyed buttons, upsell
modals) is only UX — the real boundary is server-side via `require_feature(...)` and
explicit quota checks in `routes/resume.py`. A user cannot bypass a limit by calling
the API directly.

## 1.3 Monetization flow

Stripe Checkout (self-serve for Pro) → webhook updates the user's `plan` and
`subscription_status` in MongoDB → the Stripe Customer Portal lets users manage or
cancel. Enterprise is provisioned manually. Cancelling a subscription downgrades the
user (the frontend shows a downgrade notice).

## 1.4 Account lifecycle

Signup → email verification (mandatory) → active use → optional upgrade → optional
account deletion (which cancels Stripe, wipes all data, and sends a goodbye + feedback
email).

---

# 2. FUNCTIONAL LOGIC

This section documents **every functionality**, layer by layer, from the AI core
outward to the UI.

## 2.1 AI Embeddings (`embeddings/resume_embeddings.py`, `core/openai_client.py`)

Embeddings are the semantic foundation of matching. Text is converted into a 3072-dim
vector using OpenAI's `text-embedding-3-large`. Two pieces of text in the same vector
space can be compared by cosine similarity to measure meaning-level relevance (not just
keyword overlap).

- **Resume embedding** — `get_or_create_resume_embedding(resume_text)` returns
  `(embedding, resume_hash)`. The resume text is SHA-256 hashed; the hash is the cache
  key. MongoDB is checked first (`resume_embeddings` collection) and OpenAI is only
  called on a cache miss. Identical resume text never gets embedded twice.
- **Job embedding** — jobs in the `jobs` collection already carry their embedding inline
  as `embedding_chunks` (same model, same 3072-dim space). The scoring path reuses that
  vector directly, so no API call is made per job. Resolution order:
  1. inline `embedding_chunks` on the job doc (free),
  2. legacy `job_embeddings` cache by job_id (free, transitional),
  3. embed the description via OpenAI (paid) — rare/never for real jobs.
- **Models** are configurable via env: `OPENAI_EMBEDDING_MODEL` (default
  `text-embedding-3-large`), `OPENAI_CHAT_MODEL` (default `gpt-4o`), `OPENAI_FAST_MODEL`
  (default `gpt-4o-mini`).

## 2.2 Semantic Job Matching (`db/mongodb.py` → `search_similar_jobs`)

Given a resume embedding, candidate jobs are retrieved from MongoDB and ranked. The
matching is vector-similarity based, so a "Frontend Developer" resume matches a "UI
Engineer" posting even with different wording. `JobSearchService` (`services/job_search.py`)
wraps this for embedding-driven retrieval.

## 2.3 ATS Scoring Engine (`services/ats_engine.py`)

The heart of the scoring. For each resume-job pair it produces an ATS score and a set
of explainable breakdowns. It is calibrated for real data:

- **Semantic similarity** — cosine similarity between resume and job embeddings.
  `text-embedding-3-large` resume-to-JD cosine lands in ~0.30–0.70, so the engine maps
  `0.30 → 0` and `0.70 → 100` to use the full 0–100 scale.
- **Keyword score** — keyword overlap after stop-word removal (the engine ships a
  multilingual stop-word list: English, Dutch, German, French, Spanish), minimum word
  length filtering, etc.
- **Final ATS score** — weighted blend: **75% semantic + 25% keyword**.
- **Interview probability** — derived from the ATS score as the single source of truth:
  `0–34 = Low`, `35–64 = Medium`, `65–100 = High`. Two jobs with the same ATS % always
  get the same level.
- **Skill classification** (`classify_skills`) — splits skills into strong / weak /
  missing relative to the job. Used by the rewriter and the letter generators.
- **Summary generation** (`generate_summary`) — a short natural-language explanation of
  the match.

The full breakdown (keywords + skills) is a **Pro/Enterprise** feature; Basic sees the
score only.

## 2.4 Resume Parsing (`services/resume_parser.py`)

Turns an uploaded file into plain text. Supports **PDF** (via `pdfplumber`, with a
`pypdf` fallback) and **DOCX** (via `python-docx`). `extract_resume_text(file_bytes, filename)`
dispatches on the file extension.

## 2.5 Resume Rewriter (`services/rewriter.py`)

A **4-pass, gap-aware, ATS-driven** rewrite pipeline using GPT-4o. Unlike a generic
rewriter, it consumes the ATS engine's output directly and explicitly closes gaps:

- **Pass 0 — Extract:** parse the resume into structured sections (summary, experience,
  education, skills, etc.), preserving everything.
- **Pass 1 — Gap analysis:** use real ATS data (missing_skills, weak_skills,
  missing_keywords) to identify what to fix.
- **Pass 2 — Rewrite:** rewrite each section with an explicit mandate to incorporate
  every identified gap.
- **Pass 3 — Assemble + validate:** reassemble and verify all gaps were addressed.

Goal: push interview probability up by at least one level (Low→Medium, Medium→High).
The rewritten resume is then **re-scored** against the same job so the user sees the
before/after ATS lift.

## 2.6 Cover & Motivation Letters (`services/cover_letter.py`)

Both use GPT-4o with structured, job-tailored prompts.
- **Cover letter** — 4-paragraph structure (hook → achievements → why-this-company →
  closing). Highlights strong skills, weaves matched keywords, and deliberately does not
  mention gaps.
- **Motivation letter** — a longer, more personal variant.
- `build_letter_html(...)` renders either into clean HTML for preview and PDF export.

## 2.7 PDF Generation (`services/pdf_generator.py`) & LaTeX (`services/latex_builder.py`)

- **WeasyPrint** path: `build_html_resume()` produces a clean, A4-styled HTML resume
  (Inter font, print CSS), and `html_to_pdf()` renders it to PDF bytes for download.
- **LaTeX** path: `build_latex()` emits a LaTeX document (with proper escaping) for
  Overleaf export — paste into `main.tex`, compile, get a PDF.

## 2.8 Candidate Name Resolution (`utils/helpers.py` → `resolve_candidate_name`)

A single source of truth for the name shown on outputs. Prefers a user-set
`candidate_name` stored on the resume; falls back to deriving a name from the filename.
Used by optimization and letter generation.

## 2.9 Geo / Filtering Helpers (`utils/helpers.py`)

`filter_jobs(...)` applies the filter set from the frontend: language (`en`/`nl`),
expiry window (days), location (geocoded city), radius (Haversine distance around the
city), and remote-only. `normalize_result(...)` and `get_selected_job(...)` shape data
for responses. Full filtering is Pro/Enterprise; Basic gets language-only.

## 2.10 Authentication & Security (`auth/auth.py`, `core/security.py`)

- **Password hashing** — `passlib` bcrypt.
- **JWT** — `create_access_token` / `create_refresh_token` (`python-jose`); validated by
  `get_current_user` (returns email) and `get_current_user_doc` (returns the full user doc).
- **Email-flow tokens** — stateless, single-purpose JWTs scoped by a `purpose` claim so a
  verification token can never be reused as a reset token (`create_verification_token`,
  `create_reset_token`, `verify_email_token`). Verification links live 24h; reset links 1h.
- **Feature gating** — `require_feature(...)` is a dependency that 403s with
  `error == "plan_upgrade_required"` when a plan lacks a feature.

### Auth endpoints (prefix `/auth`)
- `POST /signup` — creates the user with `verified: false`, emails a verification link.
  If the email fails to send, the just-created record is **rolled back** (deleted) so no
  unverifiable ghost account is left. If the email already exists but is unverified, it
  resends the link instead of erroring.
- `POST /login` — blocks unverified users with `403 EMAIL_NOT_VERIFIED` and
  auto-resends a fresh verification link (so legacy users with no `verified` field still
  have a path in). On success returns access + refresh tokens.
- `POST /verify-email` — consumes a verification token, marks the user verified, and
  returns tokens so the user is logged straight in.
- `POST /resend-verification` — re-sends a verification email (anti-enumeration: always a
  generic response).
- `POST /forgot-password` — emails a reset link (anti-enumeration).
- `POST /reset-password` — consumes a reset token, sets a new hashed password, and marks
  the user verified (clicking a link sent to the inbox proves ownership).
- `GET /me` — returns identity + plan + subscription status + resolved limits, derived
  from the JWT (never the request body). The frontend uses this to gate UI.

## 2.11 Transactional Email (`core/email_service.py`)

Self-contained SMTP sender using only the Python standard library (`smtplib` + `email`),
so no extra dependencies. Supports SSL (port 465) and STARTTLS (port 587), switched by
`SMTP_PORT`. Every send returns a bool and never raises into the caller.
- `send_verification_email(email, token)` — branded HTML + text, link to `/verify-email`.
- `send_password_reset_email(email, token)` — link to `/reset-password`.
- `send_goodbye_email(email)` — sent on account deletion: confirms data is gone, invites
  the user back, and asks for feedback ("if there's anything we could have done better…").

## 2.12 Resume & Job Endpoints (`routes/resume.py`, no prefix)

- `GET /can-upload-resume` — whether the user is under their resume cap.
- `POST /check-resume-duplicate` — pure hash check; detects re-uploads without writing.
- `POST /upload-resume` — parse → embed → match → score. Enforces the per-plan resume cap
  (never blocks duplicate re-uploads), clamps `top_n` to the plan's job-match ceiling.
  Accepts an optional `candidate_name`. Returns `is_duplicate=true` + existing `resume_id`
  on identical re-upload (frontend then runs an agentic refresh instead of a second copy).
- `POST /resume-jobs/count/{resume_id}` — count matching jobs for current filters.
- `POST /resume-jobs/refresh/{resume_id}` — re-run matching with new filters. Enforces the
  free-tier monthly refresh cap (or Pro per-resume cap), records usage on success, clamps `top_n`.
- `GET /resumes` — list the user's resumes.
- `GET /resume-jobs/{resume_id}` — the stored matches for a resume.
- `DELETE /resume/{resume_id}` — delete a resume (and its matches).
- `POST /resume-optimize/{resume_id}` — the 4-pass rewrite + re-score for a chosen job.
  Enforces the optimization quota (distinct jobs/month for free, distinct jobs/resume for Pro).
- `POST /export-pdf-from-html` — render edited resume HTML to a downloadable PDF.
- `POST /resume-cover-letter/{resume_id}` + `/pdf` — generate a cover letter / download as PDF.
- `POST /resume-motivation-letter/{resume_id}` + `/pdf` — motivation letter / PDF.
- `GET /resume-refresh-history/{resume_id}` — refresh audit trail.
- `GET /admin/cleanup-orphan-embeddings` — maintenance: drop embeddings with no resume.

## 2.13 Billing & Account Endpoints (`routes/billing.py`, prefix `/billing`)

- `GET /plans` — serialized plan table for the pricing page.
- `GET /subscription` — current plan + Stripe subscription state.
- `GET /usage` — usage counters (refreshes, optimizations) for the user/resume.
- `POST /create-checkout-session` — start Stripe Checkout for Pro (monthly/annual).
- `POST /create-portal-session` — open the Stripe Customer Portal (manage/cancel).
- `POST /webhook` — Stripe → server. Verified by Stripe signature (unauthenticated,
  CORS-exempt). Updates `plan` and `subscription_status` on subscription events.
- `DELETE /account` — cancels any active Stripe subscription (best-effort), sends the
  goodbye email, then permanently deletes the user, their resumes, job matches, and any
  orphaned embeddings.
- Feedback: `GET /feedback/should-prompt`, `POST /feedback/dismiss`, `POST /feedback` —
  drive an in-app feedback prompt and store ratings/comments.

## 2.14 Data Model (`db/mongodb.py`)

MongoDB Atlas, accessed through a singleton `MongoDB` class. Collections:
- **users** — email, hashed password, `verified`, `plan`, `subscription_status`,
  Stripe IDs, monthly usage counters, optimized-jobs lists, feedback timestamps,
  optional `limit_overrides`.
- **resumes** — `resume_id`, `user_id`, `resume_hash`, parsed text, `candidate_name`,
  per-resume usage (refresh count, optimized jobs).
- **jobs** — job postings with inline `embedding_chunks` (3072-dim).
- **job_matches** — stored resume↔job scoring results (embedding stripped to save space).
- **resume_embeddings** — cache keyed by `resume_hash`.

## 2.15 Frontend (`Frontend/`, React + Vite)

**App shell & routing** (`App.jsx`, `routes.jsx`, `main.jsx`): routes for `/` (home),
`/privacy`, `/terms`, `/cookies`, `/verify-email`, `/reset-password`, and `/dashboard`
(protected). `ProtectedRoute.jsx` guards the dashboard.

**State / context:**
- `context/AuthContext.jsx` — holds the token, current user, and resolved `limits` (from
  `GET /me`); exposes `login` / `logout`.
- `context/ThemeContext.jsx` — light/dark theme (persisted in localStorage).

**API layer** (`components/api.jsx`): a configured axios instance with a base URL and an
interceptor that attaches the JWT from localStorage to every request. `components/Billing.jsx`
holds billing helpers (`fetchUsage`, `deleteAccount`, `getUpgradeInfo`, `shouldPromptFeedback`).

**Auth UI:**
- `components/AuthModal.jsx` — login / signup / forgot-password. Handles `USER_NOT_FOUND`
  (auto-switch to signup), `EMAIL_NOT_VERIFIED` ("check your inbox"), and `EMAIL_SEND_FAILED`.
- `Pages/VerifyEmail.jsx` — consumes the verification link, logs the user in, redirects to dashboard.
- `Pages/ResetPassword.jsx` — sets a new password from a reset link (self-contained styling
  so text is visible on the dark theme; show/hide toggle inside the field).

**Marketing site** (`Pages/Home.jsx`, `Pages/home/*`): hero, feature sections, navbar,
plus animated extras (`Scene3D.jsx`, `CrawlWindow.jsx`, `Reveal.jsx`).

**Dashboard** (`Pages/Dashboard.jsx`, `Pages/dashboard/*`): the core app surface.
- `Sidebar.jsx` — navigation, resume switcher.
- `ResumeHeader.jsx` — active resume + candidate name.
- `JobsTable.jsx` — matched jobs, sortable/paginated, with ATS scores.
- `AnalysisPanel.jsx` — per-job ATS breakdown, optimize/letter actions, `Speedometer.jsx`
  for the score gauge.
- `SettingsPanel.jsx` — account, plan, delete-account.
- Upload/refresh flows with progress UI; XLSX export via `xlsx` + `file-saver`.

**Modals & shared UI:** `ResumeFilterModal.jsx` (language/location/radius/expiry/remote
filters), `UpgradeModal.jsx` (upsell when a quota/feature is hit), `FeedbackModal.jsx`,
`Downgradenotice.jsx`, `DashCard.jsx`, `GlobalStyles.jsx`, `AIApplicationModel.jsx`
(AI application preview), `VeloraLogo.jsx` (the brand wordmark — renders "ResuviqAI"),
and `constants/translations.jsx` (EN/NL strings).

---

# 3. WORKFLOW

## 3.1 Signup & verification
1. User signs up → backend stores `verified:false`, emails a verification link, returns
   "check your email." (If email send fails, the record is rolled back.)
2. Login is blocked until verified; attempting it resends the link.
3. User clicks the link → `/verify-email` consumes the token → user is verified and
   logged in → redirected to the dashboard.

## 3.2 Password reset
1. User requests reset → backend emails a 1-hour reset link.
2. User opens `/reset-password`, sets a new password → password updated, account marked
   verified → user logs in.

## 3.3 Core resume → jobs → optimize loop
1. **Upload** a resume (PDF/DOCX). Backend parses → embeds (cache-aware) → matches against
   the job DB → scores each match with the ATS engine. Duplicate re-uploads reuse the
   existing resume.
2. **Review** matches in the dashboard: ATS score, interview probability, and (Pro+)
   keyword/skill breakdown per job.
3. **Filter / refresh** to narrow matches (language always; location/radius/expiry/remote
   for Pro+). Refreshes are quota-metered.
4. **Optimize** a chosen job: the 4-pass rewriter closes gaps and the resume is re-scored
   to show the ATS lift. Optimizing a job also unlocks cover + motivation letters for it.
   Optimizations are quota-metered (distinct jobs).
5. **Export**: download the optimized resume and letters as PDF (or export resume to LaTeX
   for Overleaf). Matches can be exported to XLSX.

## 3.4 Upgrade / billing
1. Hitting a quota or a Pro-only feature opens the Upgrade modal.
2. `create-checkout-session` → Stripe Checkout → payment → webhook flips the user to Pro.
3. `create-portal-session` opens the Stripe portal to manage or cancel; cancellation
   downgrades the user (downgrade notice shown).

## 3.5 Account deletion
1. User confirms deletion in Settings.
2. Backend cancels any active Stripe subscription (best-effort), sends the goodbye +
   feedback email, then permanently deletes the user, resumes, matches, and orphaned
   embeddings. (A failed email never blocks deletion.)

---

# 4. SETUP

## 4.1 Prerequisites
- Python 3.11+
- Node.js 18+ (for the frontend)
- A MongoDB Atlas cluster (with the `jobs` collection populated with embeddings)
- An OpenAI API key
- A Stripe account (test keys are fine for development)
- An SMTP mailbox (this project uses a Hosting.nl mailbox)

## 4.2 Backend
```bash
cd backend
python -m venv venv
# Windows:
venv\Scripts\activate
# macOS/Linux:
source venv/bin/activate

pip install -r requirements.txt      # if missing, generate with: pip freeze > requirements.txt
# Key packages: fastapi, uvicorn, pymongo[srv], python-dotenv, passlib, bcrypt==4.0.1,
#               python-jose, openai, stripe, pdfplumber, pypdf, python-docx, weasyprint, numpy

# Create your .env (see Configuration), then run:
uvicorn main:app --reload --port 8000
```
Health check: `GET http://localhost:8000/health`.

> WeasyPrint needs native libraries (Pango/Cairo/GDK-PixBuf). On Windows the GTK runtime;
> on Debian/Ubuntu `apt-get install libpango-1.0-0 libpangocairo-1.0-0 libgdk-pixbuf2.0-0 libffi-dev`.

## 4.3 Frontend
```bash
cd frontend
npm install
npm run dev        # local dev (Vite) on http://localhost:5173
npm run build      # production build → dist/
```

## 4.4 Deployment
See `RENDER_DEPLOYMENT_GUIDE.md` for full Render deployment (backend = Web Service,
frontend = Static Site, DB stays on Atlas, domain/email stay on Hosting.nl). The single
most important pre-deploy change: make the frontend API base URL an env var
(`VITE_API_URL`) instead of the hardcoded `http://localhost:8000`.

---

# 5. CONFIGURATION

## 5.1 Backend environment variables (`.env`)
```
# Auth
JWT_SECRET_KEY=long-random-secret

# MongoDB Atlas
MONGODB_USERNAME=...
MONGODB_PASSWORD=...
MONGODB_CLUSTER=yourcluster.xxxxx.mongodb.net   # the REAL Atlas host

# OpenAI
OPENAI_API_KEY=sk-...
OPENAI_EMBEDDING_MODEL=text-embedding-3-large   # optional override
OPENAI_CHAT_MODEL=gpt-4o                          # optional override
OPENAI_FAST_MODEL=gpt-4o-mini                     # optional override

# Stripe
STRIPE_SECRET_KEY=sk_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRO_MONTHLY_PRICE_ID=price_...
STRIPE_PRO_ANNUAL_PRICE_ID=price_...

# Frontend URL (used to build email links)
FRONTEND_URL=https://resuviq-ai.nl

# SMTP (Hosting.nl mailbox)
SMTP_HOST=web118.shared.hosting-login.net   # your Hosting.nl mail server, NOT smtp.hostinger.com
SMTP_PORT=465                                # 465 = SSL, 587 = STARTTLS
SMTP_USER=support@resuviq-ai.nl
SMTP_PASSWORD=your-mailbox-password          # quote it if it contains special chars
SMTP_FROM=support@resuviq-ai.nl
SMTP_FROM_NAME=Resuviq AI
```

> The `.env` is git-ignored and lives at the project root (one level above `backend/`).
> `load_dotenv()` finds it by walking up from the working directory. In production, set
> these as platform env vars (e.g. Render dashboard) instead of a file.

## 5.2 Frontend environment variable
```
VITE_API_URL=https://your-backend-url      # backend base URL; falls back to localhost:8000 in dev
```

## 5.3 CORS (`main.py`)
`allow_origins` must include every frontend origin (localhost for dev, the production
domain, and any Render preview URL). The Stripe webhook is intentionally CORS-exempt and
unauthenticated — it is verified by Stripe signature instead.

## 5.4 MongoDB Atlas
Add the deployment platform's IPs (or `0.0.0.0/0` to start) under Network Access, or the
backend cannot connect. The `jobs` collection must contain documents with inline
`embedding_chunks` for matching to work.

## 5.5 Stripe
Configure the webhook endpoint to `https://<backend>/billing/webhook` and copy its signing
secret into `STRIPE_WEBHOOK_SECRET`. Create the Pro monthly/annual prices and put their IDs
in the env vars above.

## 5.6 Email deliverability
After SMTP works, add **SPF** and **DKIM** DNS records for `resuviq-ai.nl` in the Hosting.nl
DNS panel so verification/reset/goodbye emails reach the inbox instead of spam. Do not remove
the **MX** records when editing DNS, or inbound email to the mailbox stops.