"""
prompts/prompt_keys.py — the single source of truth for which prompts the
registry manages, and the EXACT mapping back to your existing constants.

WHY THIS FILE EXISTS (and why it changes nothing live):
  The registry never invents prompt text. Each KEY below points at a constant
  that ALREADY lives in your service files today. Phase 1 only records that this
  mapping exists; it does NOT import those modules and does NOT change any call
  site. Phase 3 is where call sites (optionally) start reading the registry —
  and even then they fall back to these same constants.

  Keeping the catalog here (not scattered) means:
    - The admin UI can list exactly the 16 manageable prompts, no more no less.
    - The Phase 3 shim can validate a key before trusting it.
    - You can see, in one place, that the registry surface == your real prompts.

NAMING:
  "<area>.<name>"  — area is the service file, name is the constant, lowercased.
  These strings are the stable public identity of a prompt across every version.
  NEVER rename a key once versions exist for it (that would orphan history).
"""

# Stable registry keys. Order is display order in the admin UI.
# The (module, attribute) pair is documentation of provenance only — Phase 1 does
# not import them. Phase 3 uses it to build the fallback default.
PROMPT_CATALOG = [
    # area key,                     human label,                       (module path,                  constant name)
    ("ats.skill_system",            "ATS · Skill classifier (system)", ("services.ats_engine",        "SKILL_SYSTEM")),
    ("ats.skill_prompt",            "ATS · Skill classifier (prompt)", ("services.ats_engine",        "SKILL_PROMPT")),
    ("ats.summary_system",          "ATS · Recruiter summary (system)",("services.ats_engine",        "SUMMARY_SYSTEM")),
    ("ats.summary_prompt",          "ATS · Recruiter summary (prompt)",("services.ats_engine",        "SUMMARY_PROMPT")),

    ("cover.letter_system",         "Cover letter (system)",           ("services.cover_letter",      "COVER_LETTER_SYSTEM")),
    ("cover.letter_prompt",         "Cover letter (prompt)",           ("services.cover_letter",      "COVER_LETTER_PROMPT")),
    ("cover.motivation_system",     "Motivation letter (system)",      ("services.cover_letter",      "MOTIVATION_LETTER_SYSTEM")),
    ("cover.motivation_prompt",     "Motivation letter (prompt)",      ("services.cover_letter",      "MOTIVATION_LETTER_PROMPT")),

    ("rewriter.extract_system",     "Rewriter · Extract (system)",     ("services.rewriter",          "EXTRACT_SYSTEM")),
    ("rewriter.extract_prompt",     "Rewriter · Extract (prompt)",     ("services.rewriter",          "EXTRACT_PROMPT")),
    ("rewriter.gap_system",         "Rewriter · Gap analysis (system)",("services.rewriter",          "GAP_SYSTEM")),
    ("rewriter.gap_prompt",         "Rewriter · Gap analysis (prompt)",("services.rewriter",          "GAP_PROMPT")),
    ("rewriter.rewrite_system",     "Rewriter · Section (system)",     ("services.rewriter",          "REWRITE_SYSTEM")),
    ("rewriter.rewrite_prompt",     "Rewriter · Section (prompt)",     ("services.rewriter",          "REWRITE_PROMPT")),
    ("rewriter.assemble_system",    "Rewriter · Assemble (system)",    ("services.rewriter",          "ASSEMBLE_SYSTEM")),
    ("rewriter.assemble_prompt",    "Rewriter · Assemble (prompt)",    ("services.rewriter",          "ASSEMBLE_PROMPT")),
]

# Fast membership / lookup helpers.
VALID_KEYS = {k for (k, _label, _src) in PROMPT_CATALOG}
KEY_LABEL  = {k: label for (k, label, _src) in PROMPT_CATALOG}
KEY_SOURCE = {k: src for (k, _label, src) in PROMPT_CATALOG}


def is_valid_key(key: str) -> bool:
    return key in VALID_KEYS


def resolve_default(key: str) -> str | None:
    """
    Import the live constant a key points at and return its current text.

    This is how the registry can be SEEDED from your real prompts without you
    pasting anything. It imports lazily (only when called) so this module has no
    import-time dependency on the service files — keeping Phase 1 fully isolated.

    Returns None (never raises) if the constant can't be resolved, so a seed of
    one key can never break a seed of the others.
    """
    src = KEY_SOURCE.get(key)
    if not src:
        return None
    module_path, attr = src
    try:
        import importlib
        mod = importlib.import_module(module_path)
        val = getattr(mod, attr, None)
        return val if isinstance(val, str) else None
    except Exception as e:  # pragma: no cover - defensive only
        print(f"[prompt_keys] resolve_default failed for {key}: {e}")
        return None
