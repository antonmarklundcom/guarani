# Phase opus-1 — Foundation. Paste into a fresh OPUS session.

Read `plan.md` FIRST, in full — plus §9 build log and `KNOWN-ISSUES.md` if present.
Execute plan §2 and §5.1 under the autonomy protocol §4. Build nothing outside the plan.

Phase rules:
- Branch `phase/opus-1` off latest main.
- Load skills at the matching step: `nodejs-mysql-hostinger-stack` (scaffold + Drizzle schema),
  `higgsfield-web-imagery` only if useful for MCP call patterns.
- Schema is COMPLETE in this phase: every table in §2 including `projects` (root),
  `lexicon_pronunciations` (per-engine), `provider_rates`. Later phases never migrate.
- Interfaces are Promise-based with the §2 result types. No `jobId`/`poll()` in any
  interface — polling is adapter-private. `MockProvider` ships alongside
  `HiggsfieldAdapter`; the test suite runs against the mock only.
- Storage: download-to-own-bucket on job completion ships now; missing bucket env vars
  degrade gracefully per §4 (WARN + provider URL kept + `.env.example`).
- Diagnostics BEFORE generation logic, recorded in the §9 build log: voice inventory,
  cost preflight, and the go/no-go gate — 2–3 real Guaraní sentences synthesized across
  candidate engines with a listening-notes table. Spend the few credits this needs;
  spend nothing else.
- Seed the lexicon per §5.1. Re-runnable; minor issues → KNOWN-ISSUES.md; stop only per §4.

Exit: schema migrated and seeded; all three interfaces + both adapters compile; tests
green against MockProvider; diagnostics + Guaraní listening notes committed in build log;
storage round-trip works or degradation documented; PR merged green.

## After this phase — hand off to the next (fresh session)
Four gates: PR merged green; exit checklist passed; adversarial re-read of the merged
diff with findings fixed; build-log entry committed. Then `create_session` (inherit env
and permission mode — never `plan`), `model`: **Opus** (never Fable), `prompt` exactly:
`Read prompts/opus-2-script-voice.md in this repo and execute it.` If `create_session`
is unavailable, continue in this window (same model) or stop and report.
