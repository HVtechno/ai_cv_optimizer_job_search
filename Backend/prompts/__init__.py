"""
prompts/ — Prompt registry (versioning, deploy, rollback) for ResuViQ AI.

Phase 1 scope: storage only. This package adds three Mongo collections and the
PromptStore that manages them. It does NOT modify any existing service, route,
or behavior. Nothing in your live request path imports this package yet.

Public surface:
    from prompts.prompt_store import PromptStore
    from prompts.prompt_keys  import PROMPT_CATALOG, VALID_KEYS
"""

from prompts.prompt_store import PromptStore  # noqa: F401
from prompts.prompt_keys import PROMPT_CATALOG, VALID_KEYS  # noqa: F401
