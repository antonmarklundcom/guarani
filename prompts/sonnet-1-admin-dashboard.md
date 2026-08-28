# Phase sonnet-1 — Admin dashboard. Paste into a fresh SONNET session, ONLY after opus-4 is merged.

Read `plan.md` FIRST, in full — plus §9 build log and `KNOWN-ISSUES.md`.
Execute plan §6.1 under the autonomy protocol §4. Build nothing outside the plan.

HARD LIMITS (repeat of §6): no schema changes, no touching the provider-abstraction
interfaces/adapters, no auth changes, no render-worker changes. All data access through
the query/service layer the Opus phases built. A UI need that seems to require a schema
change → KNOWN-ISSUES.md + Backlog, never a migration.

Phase rules:
- Branch `phase/sonnet-1` off latest main. opus-4 unmerged ⇒ finish it first.
- Screens: listing entry form; script review/edit (per-line `speech_text` editing);
  unresolved-terms queue with promote-to-lexicon flow writing per-engine pronunciation
  rows; voice+engine picker playing A/B samples side by side.
- Simple admin login gate only (per §2 roles) — no user management UI.
- UI copy in Spanish; code identifiers in English.
- Zero credit spend: everything demos against MockProvider or data already in the DB.
- Re-runnable; minor issues → KNOWN-ISSUES.md; stop only per §4.

Exit: full flow clickable — enter listing → generate script → edit a line → promote an
unresolved term → pick voice/engine → trigger generation (mock) — with no console
errors; build green; PR merged green.

## After this phase — hand off to the next (fresh session)
Four gates (merged green, exit checklist, adversarial diff re-read, build-log entry).
Then `create_session`, `model`: **Sonnet** (never Fable), `prompt` exactly:
`Read prompts/sonnet-2-review-delivery.md in this repo and execute it.` Fallback:
continue in this window (same model) or stop and report.
