"""
core/polar_client.py — Polar SDK client + env configuration (NEW, additive).

This is the Polar equivalent of the Stripe setup that lives at the top of
routes/billing.py. It centralizes the Polar access token, product id, webhook
secret, server (sandbox|production), and the success URL so the route file and
the webhook handler share one source of truth.

Nothing here touches Stripe or iDEAL. It only reads Polar env vars and builds a
Polar() client. Import it from routes/polar_billing.py.

Env vars (.env)
---------------
  POLAR_ACCESS_TOKEN=polar_...                 # Organization Access Token
  POLAR_WEBHOOK_SECRET=...                      # from the webhook endpoint setup
  POLAR_PRODUCT_ID=...                          # the "Resuviq Pro" product id
  POLAR_SERVER=sandbox                          # "sandbox" (testing) | "production"
  POLAR_SUCCESS_URL=https://resuviq-ai.nl/dashboard?checkout=success

Notes
-----
- Sandbox and production are fully separate in Polar: a sandbox token does NOT
  work against production and vice versa. Flip POLAR_SERVER (and swap the token,
  product id, and webhook secret for their production values) when you go live.
- We construct a fresh Polar() per call site via get_polar() rather than a single
  long-lived global, which keeps things simple for FastAPI's request lifecycle.
  The SDK is lightweight to construct.
"""

import os
from dotenv import load_dotenv

from polar_sdk import Polar

load_dotenv()

POLAR_ACCESS_TOKEN  = os.getenv("POLAR_ACCESS_TOKEN")
POLAR_WEBHOOK_SECRET = os.getenv("POLAR_WEBHOOK_SECRET")
POLAR_PRODUCT_ID    = os.getenv("POLAR_PRODUCT_ID")
# "sandbox" while testing, "production" when live. Anything other than
# "production" is treated as sandbox for safety.
POLAR_SERVER        = os.getenv("POLAR_SERVER", "sandbox").strip().lower()
POLAR_SUCCESS_URL   = os.getenv(
    "POLAR_SUCCESS_URL", "https://resuviq-ai.nl/dashboard?checkout=success"
)


def _server() -> str:
    """Normalize to the two values the SDK accepts."""
    return "production" if POLAR_SERVER == "production" else "sandbox"


def get_polar() -> Polar:
    """
    Build a Polar SDK client for the configured environment. Raises a clear
    error if the access token is missing so misconfiguration fails loudly at
    call time rather than producing confusing SDK errors.
    """
    if not POLAR_ACCESS_TOKEN:
        raise RuntimeError(
            "POLAR_ACCESS_TOKEN is not set. Add it to your environment before "
            "using Polar billing."
        )
    return Polar(access_token=POLAR_ACCESS_TOKEN, server=_server())


def polar_configured() -> bool:
    """True iff the minimum env vars needed to start a checkout are present.
    Lets the route return a clean 'not configured' error instead of crashing."""
    return bool(POLAR_ACCESS_TOKEN and POLAR_PRODUCT_ID)
