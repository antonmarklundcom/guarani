# Phase opus-2 — Script & Voice. Paste into a fresh OPUS session, ONLY after opus-1 is merged.

Read `plan.md` FIRST, in full — plus §9 build log and `KNOWN-ISSUES.md`.
Execute plan §5.2 under the autonomy protocol §4. Build nothing outside the plan.

Phase rules:
- Branch `phase/opus-2` off latest main. opus-1 unmerged ⇒ finish it first.
- Load skills: `paraguay-business-apps` (guaraní amounts / market conventions) when
  writing the number/price/unit verbalization step.
- Implement the unresolved-terms detection rule EXACTLY as §5.2 specifies (longest-match
  tokenizer, Spanish-passthrough allowlist, `provisional` flag) — do not invent another.
- TTS is per-line batch synthesis; each line's duration measured locally with ffprobe.
  Never depend on provider timing metadata. All calls through the abstraction; nothing
  outside adapters touches `mcp__higgsfield__*`.
- Script generation fills templates strictly from `listings` fields — no free-text LLM
  output as source of truth for facts.
- A stock voice_id is fine if no cloned voice exists yet (§7); note it in the build log.
- Keep credit spend minimal: MockProvider for tests; real synthesis only for the A/B
  harness sanity runs and they get logged with USD cost.
- Re-runnable; minor issues → KNOWN-ISSUES.md; stop only per §4.

Exit: ES+GN scripts generated from a real listing with verbalized numbers; unknown terms
land in `unresolved_terms` per the rule; per-line audio with measured durations stored in
own storage and logged with USD cost; standalone GN TTS route works API-level; A/B
harness produces queryable per-engine rows; tests green; PR merged green.

## After this phase — hand off to the next (fresh session)
Four gates (merged green, exit checklist, adversarial diff re-read, build-log entry).
Then `create_session`, `model`: **Opus** (never Fable), `prompt` exactly:
`Read prompts/opus-3-assembly.md in this repo and execute it.` Fallback: continue in
this window (same model) or stop and report.
