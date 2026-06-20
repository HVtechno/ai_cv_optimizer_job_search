"""
prompts/active_prompt.py — Phase 3: the resolver that wires the registry into
the live request path.

THE ONE RULE:
  active(key, default) returns the DEPLOYED text for `key` if one exists, and
  otherwise returns `default` (your hardcoded constant). It NEVER raises. Any
  problem — registry empty, key never deployed, Mongo down, bad data — falls
  back to `default`. So the worst case is "behaves exactly like today".

WHY A SLOT-AWARE RESOLVER:
  Each catalog key holds EITHER a system string or a prompt string (that's why
  there are 16 keys, not 8). A "*_system" key stores its text in system_text; a
  "*_prompt" key stores it in prompt_text. active() reads the right slot for the
  key automatically, so callers just pass the key + their constant.

PERFORMANCE + SAFETY:
  - A short in-process TTL cache (default 30s) avoids a Mongo read on every
    single LLM call. Deploys/rollbacks are rare; a few seconds of staleness after
    a deploy is fine and the cache can be flushed explicitly (the deploy endpoint
    does this so a deploy takes effect immediately).
  - The cache only ever stores resolved strings; on ANY error we skip the cache
    and return default.

This module imports PromptStore lazily so importing it is cheap and side-effect
free; the service modules can import `active` at top level with no DB work.
"""

import time
import threading

# (key) -> (expires_at_epoch, resolved_text_or_None)
_cache: dict[str, tuple[float, str | None]] = {}
_lock = threading.Lock()
_TTL_SECONDS = 30.0


def _slot_for(key: str) -> str:
    return "system_text" if key.endswith("_system") else "prompt_text"


def _lookup_active_text(key: str) -> str | None:
    """
    Resolve the deployed text for a key from the registry, or None if there is
    no active version / no text / any error. Never raises.
    """
    try:
        from prompts.prompt_store import PromptStore
        doc = PromptStore().get_active_text(key)   # active version doc, or None
        if not doc:
            return None
        text = doc.get(_slot_for(key))
        # Treat empty string as "nothing deployed for this slot" so we fall back.
        return text if (isinstance(text, str) and text.strip()) else None
    except Exception as e:
        print(f"[active_prompt] lookup failed for {key} (using default): {e}")
        return None


def active(key: str, default: str) -> str:
    """
    Return the deployed text for `key`, else `default` (your constant).

    This is THE function services call. It is intentionally tiny and total:
    callers can wrap a constant with zero behavioral risk.
    """
    now = time.time()

    # Fast path: fresh cache entry.
    hit = _cache.get(key)
    if hit and hit[0] > now:
        resolved = hit[1]
        return resolved if resolved is not None else default

    # Slow path: read registry, refresh cache. Errors -> default, and we cache
    # the None so we don't hammer Mongo when nothing is deployed.
    resolved = _lookup_active_text(key)
    with _lock:
        _cache[key] = (now + _TTL_SECONDS, resolved)
    return resolved if resolved is not None else default


def flush_cache(key: str | None = None):
    """
    Drop cached resolutions so the next active() call re-reads the registry.
    Called right after a deploy/rollback so the change takes effect immediately
    instead of waiting out the TTL. Pass a key to flush one, or None for all.
    """
    with _lock:
        if key is None:
            _cache.clear()
        else:
            _cache.pop(key, None)
