from openai import AsyncOpenAI
import os
from dotenv import load_dotenv

load_dotenv()

client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))

EMBEDDING_MODEL = os.getenv("OPENAI_EMBEDDING_MODEL", "text-embedding-3-large")
CHAT_MODEL      = os.getenv("OPENAI_CHAT_MODEL",      "gpt-4o")
FAST_MODEL      = os.getenv("OPENAI_FAST_MODEL",      "gpt-4o-mini")


async def get_embedding(text: str) -> list[float]:
    response = await client.embeddings.create(
        model=EMBEDDING_MODEL,
        input=text[:32000],
    )
    return response.data[0].embedding


async def chat_completion(
    prompt: str,
    system: str = "You are a helpful assistant.",
    model: str = None,
    temperature: float = 0.2,
    max_tokens: int = 2000,
) -> str:
    response = await client.chat.completions.create(
        model=model or FAST_MODEL,
        temperature=temperature,
        max_tokens=max_tokens,
        messages=[
            {"role": "system", "content": system},
            {"role": "user",   "content": prompt},
        ],
    )
    return response.choices[0].message.content.strip()


async def json_completion(
    prompt: str,
    model: str = None,
    temperature: float = 0.1,
    max_tokens: int = 6000,
) -> str:
    """Returns raw string — caller must json.loads(). Strips markdown fences."""
    raw = await chat_completion(
        prompt=prompt,
        system="Return ONLY valid JSON. No markdown, no code blocks, no commentary.",
        model=model or CHAT_MODEL,
        temperature=temperature,
        max_tokens=max_tokens,
    )
    return raw.replace("```json", "").replace("```", "").strip()
