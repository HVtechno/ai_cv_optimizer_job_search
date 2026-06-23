from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routes.resume import router as resume_router
from routes.billing import router as billing_router   # NEW
from routes.ideal_billing import router as ideal_router  # NEW: manual iDEAL (no-KvK interim)
from routes.polar_billing import router as polar_router  # NEW: Polar (Merchant of Record)
from routes.admin_metrics import router as admin_metrics_router  # NEW: read-only admin analytics
from routes.presence import router as presence_router  # NEW: visitor tracking
from batch.batch_routes import router as batch_router  # NEW: enterprise batch jobs
from auth.auth import router as auth_router

app = FastAPI(
    title="AI Career Dashboard API",
    description="Resume matching, ATS scoring, and AI-powered resume optimization",
    version="3.1.0",   # bumped: subscriptions added
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",   # Vite dev
        "http://localhost:3000",   # CRA dev
        "https://resuviq-ai.nl",       # production frontend
        "https://www.resuviq-ai.nl",   # production frontend (www)
        "https://resuviq-frontend.onrender.com",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(resume_router)
app.include_router(auth_router,    prefix="/auth")
app.include_router(billing_router, prefix="/billing")   # NEW
app.include_router(ideal_router,   prefix="/ideal")     # NEW: manual iDEAL (no-KvK interim)
app.include_router(polar_router,   prefix="/polar")     # NEW: Polar (Merchant of Record) — primary checkout
app.include_router(admin_metrics_router, prefix="/ideal")  # NEW: GET /ideal/admin/metrics (read-only)
app.include_router(presence_router, prefix="/presence")  # NEW: visitor tracking
app.include_router(batch_router)  # NEW: enterprise batch jobs (prefix /batch in router)
from routes.usage_routes import router as usage_router  # NEW: admin token-o-meter
app.include_router(usage_router)
from routes.team_routes import router as team_router  # NEW: team / contributor mgmt
app.include_router(team_router)
from routes.prompt_admin import router as prompt_admin_router  # NEW: prompt registry (admin)
app.include_router(prompt_admin_router, prefix="/prompts")  # NEW: GET/POST /prompts/* (admin-gated)


# NEW: in-process batch scheduler (APScheduler). No extra paid service; relies on
# Render Starter staying always-on. Matches enterprise batch feature.
from batch.scheduler import start_scheduler, shutdown_scheduler


@app.on_event("startup")
async def _start_batch_scheduler():
    start_scheduler()


@app.on_event("shutdown")
async def _stop_batch_scheduler():
    shutdown_scheduler()
# Note: the Stripe webhook lives at POST /billing/webhook. Stripe calls it
# server-to-server (no browser), so CORS does not apply and it must stay
# unauthenticated — it is verified by the Stripe signature instead.


@app.get("/health")
async def health():
    return {
        "status":       "ok",
        "version":      "3.1.0",
        "ats_engine":   "embedding-based (cosine + keyword)",
        "pdf_engine":   "weasyprint",
        "rewriter":     "4-pass GPT-4o pipeline",
        "billing":      "stripe",
    }