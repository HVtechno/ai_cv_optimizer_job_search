"""
usage_store.py — records every OpenAI API call (tokens in/out) and computes cost
from a CONFIGURABLE price table, so it works for both OpenAI and Azure customers
(who set their own rates via env).

Additive: new `api_usage` collection only. Touches nothing existing.

Price configuration (per 1,000,000 tokens), override any via environment:
    PRICE_GPT_4O_INPUT / PRICE_GPT_4O_OUTPUT
    PRICE_GPT_4O_MINI_INPUT / PRICE_GPT_4O_MINI_OUTPUT
    PRICE_EMBEDDING_INPUT
    ...and a generic fallback PRICE_DEFAULT_INPUT / PRICE_DEFAULT_OUTPUT
Azure users just set these env vars to their negotiated rates; the math is the same.
"""

import os
from datetime import datetime, timezone
from db.mongodb import MongoDB


def _price(env_key: str, default: float) -> float:
    try:
        return float(os.getenv(env_key, default))
    except (TypeError, ValueError):
        return default


# Per 1,000,000 tokens. Defaults reflect 2026 OpenAI list prices; override via env.
# These are DEFAULTS only — never hardcoded into the math, always read live so an
# admin/Azure user can change rates without touching code.
def price_table() -> dict:
    return {
        "gpt-4o": {
            "input":  _price("PRICE_GPT_4O_INPUT", 2.50),
            "output": _price("PRICE_GPT_4O_OUTPUT", 10.00),
        },
        "gpt-4o-mini": {
            "input":  _price("PRICE_GPT_4O_MINI_INPUT", 0.15),
            "output": _price("PRICE_GPT_4O_MINI_OUTPUT", 0.60),
        },
        "text-embedding-3-large": {
            "input":  _price("PRICE_EMBEDDING_INPUT", 0.13),
            "output": 0.0,   # embeddings have no output tokens
        },
        "text-embedding-3-small": {
            "input":  _price("PRICE_EMBEDDING_SMALL_INPUT", 0.02),
            "output": 0.0,
        },
    }


_DEFAULT_IN  = float(os.getenv("PRICE_DEFAULT_INPUT", 2.50))
_DEFAULT_OUT = float(os.getenv("PRICE_DEFAULT_OUTPUT", 10.00))


def compute_cost(model: str, prompt_tokens: int, completion_tokens: int) -> float:
    """Cost in USD for one call, from the live (env-overridable) price table."""
    table = price_table()
    rate = table.get(model)
    if rate is None:
        # Unknown model — match by family prefix, else generic default.
        for key, val in table.items():
            if model.startswith(key):
                rate = val
                break
        else:
            rate = {"input": _DEFAULT_IN, "output": _DEFAULT_OUT}
    return round(
        (prompt_tokens / 1_000_000) * rate["input"]
        + (completion_tokens / 1_000_000) * rate["output"],
        6,
    )


class UsageStore:
    def __init__(self):
        self.db = MongoDB().db
        self.col = self.db["api_usage"]
        self._ensure_indexes()

    def _ensure_indexes(self):
        try:
            self.col.create_index("ts")
            self.col.create_index("day")
            self.col.create_index("model")
            self.col.create_index("feature")
            self.col.create_index("org_id")
        except Exception as e:
            print(f"[usage] index setup skipped: {e}")

    def record(self, *, model: str, prompt_tokens: int, completion_tokens: int,
               feature: str = "unknown", org_id: str | None = None):
        """Log one OpenAI call. Called from the central openai_client wrappers,
        so every call in the app is captured without touching feature code."""
        now = datetime.now(timezone.utc)
        cost = compute_cost(model, prompt_tokens, completion_tokens)
        try:
            self.col.insert_one({
                "ts":               now,
                "day":              now.strftime("%Y-%m-%d"),
                "model":            model,
                "prompt_tokens":    int(prompt_tokens or 0),
                "completion_tokens":int(completion_tokens or 0),
                "total_tokens":     int((prompt_tokens or 0) + (completion_tokens or 0)),
                "cost_usd":         cost,
                "feature":          feature,
                "org_id":           org_id,
            })
        except Exception as e:
            # Never let usage logging break a real request.
            print(f"[usage] record failed (non-fatal): {e}")
        return cost
