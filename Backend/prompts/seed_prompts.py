"""
prompts/seed_prompts.py — one-time, idempotent seed of the prompt registry.

WHAT IT DOES:
  For every prompt key that has no versions yet, it reads your CURRENT live
  constant (e.g. SKILL_PROMPT in services/ats_engine.py) and stores it as
  version 1, marked active. Keys that already have versions are skipped.

WHY IT'S SAFE:
  - Idempotent: re-running never duplicates or overwrites. Safe to run twice.
  - Read-only toward your code: it imports your service modules to READ the
    constants; it never modifies them.
  - Changes no behavior: until Phase 3 wires the shim, nothing reads these
    seeded versions.

HOW TO RUN (from the Backend/ directory, with your normal env vars loaded):
    python -m prompts.seed_prompts

It prints a per-key report so you can confirm all 16 prompts seeded.
"""

from prompts.prompt_store import PromptStore


def main():
    store = PromptStore()
    report = store.seed_from_constants(created_by="seed")

    print("── Prompt registry seed report ─────────────────────────────")
    print(f"  seeded ({len(report['seeded'])}):")
    for k in sorted(report["seeded"]):
        print(f"      + {k}")
    print(f"  skipped — already had versions ({len(report['skipped'])}):")
    for k in sorted(report["skipped"]):
        print(f"      = {k}")
    if report["failed"]:
        print(f"  FAILED ({len(report['failed'])}):")
        for item in report["failed"]:
            print(f"      ! {item['key']}: {item['reason']}")
    else:
        print("  failed (0): none")
    print("────────────────────────────────────────────────────────────")
    print("Done. This changed no runtime behavior — it only populated the")
    print("prompt_versions / prompt_active collections.")


if __name__ == "__main__":
    main()
