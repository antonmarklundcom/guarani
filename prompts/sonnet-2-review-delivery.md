# Phase sonnet-2 — Review & delivery. Paste into a fresh SONNET session, ONLY after sonnet-1 is merged.

Read `plan.md` FIRST, in full — plus §9 build log and `KNOWN-ISSUES.md`.
Execute plan §6.2 under the autonomy protocol §4. Build nothing outside the plan.

HARD LIMITS (repeat of §6): no schema changes, no touching the provider-abstraction
interfaces/adapters, no auth changes, no render-worker changes. Data access only through
the existing query/service layer. Schema-needing UI ideas → KNOWN-ISSUES.md + Backlog.

Phase rules:
- Branch `phase/sonnet-2` off latest main. sonnet-1 unmerged ⇒ finish it first.
- Screens: `generation_jobs` monitoring across kinds (status, USD cost, retry surface);
  finished-video preview/download from `videos`; standalone Guaraní TTS page wired to
  the opus-2 route — admin-gated by default (public only if Anton has said so in the
  build log or KNOWN-ISSUES).
- Zero credit spend: mock/staged data for all UI states including failures.
- Re-runnable; minor issues → KNOWN-ISSUES.md; stop only per §4.

Exit: jobs view shows real rows with USD costs; a finished video previews and downloads
in-browser; TTS page produces audio through the existing route (mock acceptable);
build green; PR merged green.

## After this phase — hand off to the next (fresh session)
Four gates (merged green, exit checklist, adversarial diff re-read, build-log entry).
Then `create_session`, `model`: **Sonnet** (never Fable), `prompt` exactly:
`Read prompts/sonnet-3-deploy.md in this repo and execute it.` Fallback: continue in
this window (same model) or stop and report.
