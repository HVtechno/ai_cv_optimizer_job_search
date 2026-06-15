from openai import AsyncOpenAI
import os
from dotenv import load_dotenv

load_dotenv()

client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))

EMBEDDING_MODEL = os.getenv("OPENAI_EMBEDDING_MODEL", "text-embedding-3-large")
CHAT_MODEL      = os.getenv("OPENAI_CHAT_MODEL",      "gpt-4o")
FAST_MODEL      = os.getenv("OPENAI_FAST_MODEL",      "gpt-4o-mini")
# Model used specifically for skill classification. Defaults to the cheap/fast
# model because classify_skills runs once PER JOB on every upload/refresh and was
# the single largest recurring LLM cost (~94% of per-job spend on gpt-4o). Routing
# it to gpt-4o-mini cuts that ~6x. If skill-classification quality drops, set
# OPENAI_SKILL_MODEL=gpt-4o in the environment to revert — no code change needed.
SKILL_MODEL     = os.getenv("OPENAI_SKILL_MODEL",     "gpt-4o-mini")


def _track(model, usage, feature, org_id=None):
    """Record token usage for the admin token-o-meter. Fully isolated and
    fail-safe: any error here is swallowed so it can NEVER affect an API call."""
    try:
        from core.usage_store import UsageStore
        pt = getattr(usage, "prompt_tokens", 0) or 0
        ct = getattr(usage, "completion_tokens", 0) or 0
        UsageStore().record(model=model, prompt_tokens=pt, completion_tokens=ct,
                            feature=feature, org_id=org_id)
    except Exception as e:
        print(f"[usage] tracking skipped (non-fatal): {e}")


async def get_embedding(text: str, feature: str = "embedding", org_id: str = None) -> list[float]:
    response = await client.embeddings.create(
        model=EMBEDDING_MODEL,
        input=text[:32000],
    )
    _track(EMBEDDING_MODEL, getattr(response, "usage", None), feature, org_id)
    return response.data[0].embedding


async def chat_completion(
    prompt: str,
    system: str = "You are a helpful assistant.",
    model: str = None,
    temperature: float = 0.2,
    max_tokens: int = 2000,
    feature: str = "chat",
    org_id: str = None,
) -> str:
    used_model = model or FAST_MODEL
    response = await client.chat.completions.create(
        model=used_model,
        temperature=temperature,
        max_tokens=max_tokens,
        messages=[
            {"role": "system", "content": system},
            {"role": "user",   "content": prompt},
        ],
    )
    _track(used_model, getattr(response, "usage", None), feature, org_id)
    return response.choices[0].message.content.strip()


async def json_completion(
    prompt: str,
    model: str = None,
    temperature: float = 0.1,
    max_tokens: int = 6000,
    feature: str = "json",
    org_id: str = None,
) -> str:
    """Returns raw string — caller must json.loads(). Strips markdown fences."""
    raw = await chat_completion(
        prompt=prompt,
        system="Return ONLY valid JSON. No markdown, no code blocks, no commentary.",
        model=model or CHAT_MODEL,
        temperature=temperature,
        max_tokens=max_tokens,
        feature=feature,
        org_id=org_id,
    )
    return raw.replace("```json", "").replace("```", "").strip()