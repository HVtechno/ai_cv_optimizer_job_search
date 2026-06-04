# Deploying Resuviq AI to Render

Your app has three parts that live in three different places:

| Part | Where it goes | Render type |
|------|---------------|-------------|
| Backend (FastAPI / Python) | Render | **Web Service** |
| Frontend (React / Vite) | Render | **Static Site** |
| Database (MongoDB Atlas) | Stays where it is | — (already cloud-hosted) |

You will create **two** services on Render, both pointing at the **same GitHub repo**.
Your domain and email stay at Hosting.nl — only DNS records change at the end.

---

## STEP 0 — Things to fix in your code FIRST (before pushing to GitHub)

These two changes are required, or the deploy will not work. Do them locally, test, then push.

### 0a. Create `requirements.txt` for the backend

Render needs this file to know which Python packages to install. From your **activated venv**, in the backend folder:

```powershell
cd D:\ai_cv_optimizer_job_search\backend
pip freeze > requirements.txt
```

Open the generated `requirements.txt` and confirm it lists things like `fastapi`, `uvicorn`,
`pymongo`, `python-dotenv`, `passlib`, `bcrypt`, `stripe`, `openai`, `python-jose`, etc.
Keep this file in the backend folder (same level as `main.py`).

> Tip: pin `bcrypt==4.0.1` in this file to silence the harmless bcrypt warning you saw.

### 0b. Make the frontend API URL configurable (CRITICAL)

Right now `http://localhost:8000` is hardcoded in 5 files. In production the browser cannot
reach `localhost`. Replace every occurrence with an environment variable that Vite injects at
build time. This keeps local development working too.

**The 5 files and lines to change:**

- `components/api.jsx` (line ~4)
- `components/AuthModal.jsx` (line ~37)
- `components/AIApplicationModel.jsx` (line ~24)
- `Pages/VerifyEmail.jsx` (line ~36)
- `Pages/ResetPassword.jsx` (line ~41)

**The pattern:** replace the literal `"http://localhost:8000"` with:

```js
import.meta.env.VITE_API_URL || "http://localhost:8000"
```

Concretely:

- `api.jsx`:
  ```js
  baseURL: import.meta.env.VITE_API_URL || "http://localhost:8000",
  ```
- `AIApplicationModel.jsx`:
  ```js
  const API = import.meta.env.VITE_API_URL || "http://localhost:8000";
  ```
- `AuthModal.jsx` (template string):
  ```js
  const API = import.meta.env.VITE_API_URL || "http://localhost:8000";
  const res = await fetch(`${API}/auth/${endpoint}`, {
  ```
- `VerifyEmail.jsx`:
  ```js
  const API = import.meta.env.VITE_API_URL || "http://localhost:8000";
  const res = await fetch(`${API}/auth/verify-email`, {
  ```
- `ResetPassword.jsx`:
  ```js
  const API = import.meta.env.VITE_API_URL || "http://localhost:8000";
  const res = await fetch(`${API}/auth/reset-password`, {
  ```

The `|| "http://localhost:8000"` fallback means your local dev still works with no env var set.
On Render you will set `VITE_API_URL` to your backend's real URL.

> If your app is Create React App instead of Vite, use `process.env.REACT_APP_API_URL` instead
> of `import.meta.env.VITE_API_URL`, and name the Render variable `REACT_APP_API_URL`.

### 0c. Test locally, then push to GitHub

Run frontend + backend locally one more time to confirm nothing broke. Then push **both**
folders to one GitHub repo. A common layout:

```
your-repo/
├── backend/      (contains main.py, requirements.txt, etc.)
└── frontend/     (contains package.json, src/, etc.)
```

```powershell
cd D:\ai_cv_optimizer_job_search
git add .
git commit -m "Prepare for Render deploy: requirements.txt + env-based API URL"
git push
```

> Make sure `.env` is in your `.gitignore` — NEVER push your real secrets to GitHub.
> You will re-enter those secrets safely in Render's dashboard instead.

---

## STEP 1 — Deploy the BACKEND (Web Service)

1. Go to https://render.com, sign up / log in, and connect your GitHub account.
2. Click **New +** → **Web Service**.
3. Select your repo.
4. Fill in:
   - **Name:** `resuviq-backend` (or anything)
   - **Root Directory:** `backend`  ← important, points Render at the backend folder
   - **Environment / Language:** `Python 3`
   - **Build Command:** `pip install -r requirements.txt`
   - **Start Command:** `uvicorn main:app --host 0.0.0.0 --port $PORT`
     (Render provides `$PORT` automatically — do not hardcode 8000.)
   - **Instance Type:** Free (fine to start; note free instances sleep when idle, see notes).
5. Scroll to **Environment Variables** and add every key from your `.env`, one by one:
   - `JWT_SECRET_KEY`
   - `MONGODB_USERNAME`, `MONGODB_PASSWORD`, `MONGODB_CLUSTER`
   - `OPENAI_API_KEY`
   - `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRO_MONTHLY_PRICE_ID`, `STRIPE_PRO_ANNUAL_PRICE_ID`
   - `SMTP_HOST` = `web118.shared.hosting-login.net`
   - `SMTP_PORT` = `465`
   - `SMTP_USER` = `support@resuviq-ai.nl`
   - `SMTP_PASSWORD` = (your mailbox password)
   - `SMTP_FROM` = `support@resuviq-ai.nl`
   - `SMTP_FROM_NAME` = `Resuviq AI`
   - `FRONTEND_URL` = leave blank for now; you'll set it after Step 2 to your frontend URL.
6. Click **Create Web Service**. Render builds and starts it.
7. When it's live, copy the URL it gives you, e.g. `https://resuviq-backend.onrender.com`.
   **This is your backend URL — you need it in the next step.**

### Whitelist Render in MongoDB Atlas
Atlas blocks unknown IPs. In Atlas → **Network Access**, add `0.0.0.0/0` (allow from anywhere)
so Render can connect. (More restrictive options exist, but this gets you live; tighten later.)

---

## STEP 2 — Deploy the FRONTEND (Static Site)

1. In Render: **New +** → **Static Site**.
2. Select the **same repo**.
3. Fill in:
   - **Name:** `resuviq-frontend`
   - **Root Directory:** `frontend`
   - **Build Command:** `npm install && npm run build`
   - **Publish Directory:** `dist`   (Vite outputs to `dist`. If Create React App, use `build`.)
4. Under **Environment Variables**, add:
   - `VITE_API_URL` = your backend URL from Step 1, e.g. `https://resuviq-backend.onrender.com`
     (no trailing slash)
5. Click **Create Static Site**. Render builds the React app and serves the static files.
6. Copy the frontend URL it gives you, e.g. `https://resuviq-frontend.onrender.com`.

### SPA routing fix (important for your /verify-email and /reset-password links)
Because you use client-side routes, a direct visit to `/verify-email` must serve `index.html`.
In your Static Site → **Redirects/Rewrites**, add a rule:
- **Source:** `/*`
- **Destination:** `/index.html`
- **Action:** `Rewrite`

Without this, clicking the email verification link could show a 404.

---

## STEP 3 — Wire the two services together

1. Go back to the **backend** service → Environment.
2. Set `FRONTEND_URL` = your frontend URL from Step 2 (e.g. `https://resuviq-frontend.onrender.com`).
   This makes the verification/reset email links point to the right place.
3. In your backend code, `main.py` CORS currently allows `https://resuviq-ai.nl`. Add your Render
   frontend URL to the `allow_origins` list too (temporarily, until your custom domain is attached),
   then commit + push so it redeploys. Example list:
   ```python
   allow_origins=[
       "http://localhost:5173",
       "https://resuviq-ai.nl",
       "https://www.resuviq-ai.nl",
       "https://resuviq-frontend.onrender.com",
   ],
   ```
4. Save — Render auto-redeploys the backend.

At this point your app should be fully working on the two `.onrender.com` URLs. Test signup →
verify email → login → delete account before attaching your domain.

---

## STEP 4 — Point your domain (resuviq-ai.nl) at the frontend

Your domain is registered at Hosting.nl. You only change DNS records there; the site runs on Render.

1. In Render → frontend Static Site → **Settings** → **Custom Domains** → add `resuviq-ai.nl`
   and `www.resuviq-ai.nl`. Render shows you the DNS records to create.
2. In **Hosting.nl Plesk** → your domain → **Hosting & DNS / DNS settings**, add the records Render
   gives you (usually a CNAME for `www` and either an A record or ALIAS/ANAME for the root domain).
3. Wait for DNS to propagate (minutes to a few hours).
4. Render auto-issues a free SSL certificate once DNS resolves — that fixes your earlier
   "No SSL Detected" problem. Your site becomes `https://resuviq-ai.nl`.
5. Once the custom domain works, update:
   - backend `FRONTEND_URL` → `https://resuviq-ai.nl`
   - backend CORS `allow_origins` → keep `https://resuviq-ai.nl` (already there)
   - frontend `VITE_API_URL` stays your backend URL (or attach a custom domain like
     `api.resuviq-ai.nl` to the backend the same way, if you prefer a branded API URL).

> Note: your EMAIL stays at Hosting.nl. Do NOT remove the MX records at Hosting.nl when editing DNS,
> or email to support@resuviq-ai.nl will stop working. Only add/adjust the records Render asks for.

---

## STEP 5 — Stripe webhook (if you use Stripe in production)

Your billing webhook endpoint is `/billing/webhook`. In the Stripe dashboard, update the webhook
URL to `https://<your-backend-domain>/billing/webhook`, and copy the new signing secret into the
backend's `STRIPE_WEBHOOK_SECRET` env var on Render.

---

## Things to know about Render's free tier

- **Free Web Services sleep after ~15 min of inactivity** and take ~30–60s to wake on the next
  request. For a backend, that means the first request after idle is slow. Upgrading to a paid
  instance (a few dollars/month) keeps it always-on. Static sites do NOT sleep.
- **Build minutes / bandwidth** have limits on free tiers; fine for launch and light traffic.

---

## Quick recap of the moving pieces

- Backend = Render **Web Service**, root `backend`, start `uvicorn main:app --host 0.0.0.0 --port $PORT`
- Frontend = Render **Static Site**, root `frontend`, build `npm install && npm run build`, publish `dist`
- `VITE_API_URL` (frontend) → backend URL
- `FRONTEND_URL` (backend) → frontend URL
- MongoDB Atlas → allow `0.0.0.0/0` in Network Access
- Domain DNS at Hosting.nl → points to Render; MX records stay for email
- All secrets live in Render env vars, never in GitHub