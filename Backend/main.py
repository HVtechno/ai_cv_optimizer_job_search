from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routes.resume import router as resume_router
from routes.billing import router as billing_router   # NEW
from routes.presence import router as presence_router  # NEW: visitor tracking
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
app.include_router(presence_router, prefix="/presence")  # NEW: visitor tracking
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