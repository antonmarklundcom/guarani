# Phase opus-4 — Generative visuals. Paste into a fresh OPUS session, ONLY after opus-3 is merged.

Read `plan.md` FIRST, in full — plus §9 build log and `KNOWN-ISSUES.md`.
Execute plan §5.4 under the autonomy protocol §4. Build nothing outside the plan.

Phase rules:
- Branch `phase/opus-4` off latest main. opus-3 unmerged ⇒ finish it first.
- `SceneSpec` stays declarative (shot type, subject, mood, duration, aspect) — prompt
  text is rendered INSIDE the adapter, never stored in specs or DB. Pass aspect
  explicitly (Higgsfield defaults 16:9; we want 9:16).
- Generated clips are optional b-roll slotted into the opus-3 assembly; a video must
  still be producible with photos only. Do not touch the compositor's photo path.
- Every generation: `generation_jobs` row, USD cost, immediate download to own storage.
- Credit discipline: use `get_cost` preflight; generate the minimum needed to prove the
  path (one image, one short clip); MockProvider for all tests.
- Re-runnable; minor issues → KNOWN-ISSUES.md; stop only per §4.

Exit: one listing video assembled containing at least one generated visual segment
alongside photos; photos-only path still green; all jobs logged with USD cost and
storage URLs; tests green; PR merged green.

## After this phase — hand off to SONNET (model switch)
Four gates (merged green, exit checklist, adversarial diff re-read, build-log entry).
This is the last Opus phase: `create_session` with `model`: **Sonnet** (never Fable),
`prompt` exactly: `Read prompts/sonnet-1-admin-dashboard.md in this repo and execute it.`
If `create_session` is unavailable, STOP and report — do not continue Sonnet work in an
Opus window.
