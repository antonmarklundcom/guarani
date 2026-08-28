# Phase opus-2 — Script generation & voice pipeline. Paste into a fresh Opus session, ONLY after phase opus-1 is merged.

Read `plan.md` FIRST, in full — plus §9 build log and `KNOWN-ISSUES.md`. Execute plan
§5.2 under the autonomy protocol §4. Build nothing outside the plan.

Phase rules:
- Branch `phase/opus-2` off latest main. Phase opus-1 unmerged ⇒ finish it first.
- Read opus-1's build-log entry before writing any code — it names the schema and adapter
  interfaces you build on, and the go/no-go findings on which engines are even usable.
- Script generation is template-filled strictly from `listings` fields — never a free-text
  LLM prompt as the source of facts. Structure it so adding a new listing field later is
  additive, not a rewrite.
- Implement the unresolved-term detection rule exactly as specified in plan §5.2: longest-
  match tokenization against `lexicon_pronunciations` first (multi-word terms like a
  neighborhood name must match as one unit), fall through to an explicit Spanish-passthrough
  allowlist, anything left goes to `unresolved_terms` with `provisional: true` and does NOT
  block generation.
- Numerals, prices, and units (Gs. amounts, m²) go through a numbers-to-words verbalizer
  per language BEFORE lexicon lookup — do not skip this, it's the highest-frequency real
  failure mode in real-estate scripts per plan §11.
- TTS orchestration is per-line, not per-script (plan §3) — one `generation_jobs` row and
  one audio file per script line, duration measured locally via ffprobe on the downloaded
  file, never trusted from provider metadata.
- A/B harness: same line + voice_id across multiple engines, writing distinct rows into
  `lexicon_pronunciations` per engine — do not collapse this back into a single column.
- Standalone Guaraní TTS is exposed as an API route here (UI comes in sonnet-2) using the
  exact same per-line pipeline — don't build a second code path for it.
- Re-runnable; minor issues → `KNOWN-ISSUES.md`; stop only per §4.4.

Exit: given a real `listings` row, the pipeline produces ES + GN scripts with resolved
`display_text`/`speech_text` per line, unresolved terms correctly queued, per-line audio
generated through at least 2 engines via the provider abstraction with costs logged in
USD, and the standalone TTS route returns audio for arbitrary input text. PR merged green.

## After this phase — hand off to the next (fresh session)

Four gates before handoff: PR merged green; exit checklist passed; pre-handoff adversarial
re-read of your merged diff (test the unresolved-term rule against a tricky multi-word
Guaraní input, not just the happy path); build-log entry committed (what the script/voice
API surface looks like, A/B results so far, where opus-3 should look first — especially
how per-line audio + durations are stored, since opus-3 consumes them directly). Then
spawn opus-3 as a NEW session via `create_session`: inherit environment and permission
mode, model = Opus, prompt exactly
`Read prompts/opus-3-assembly.md in this repo and execute it.` If `create_session` is
unavailable, continue in the same window (same model) and report.
