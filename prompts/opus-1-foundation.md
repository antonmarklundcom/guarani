# Phase opus-1 — Foundation. Paste into a fresh Opus session.

Read `plan.md` FIRST, in full — plus `plan-review.md`, §9 build log, and `KNOWN-ISSUES.md`
if it exists. Execute plan §2 and §5.1 under the autonomy protocol §4. Build nothing
outside the plan.

Phase rules:
- Branch `phase/opus-1` off latest main. Previous phase unmerged ⇒ there is none; this is first.
- Load `nodejs-mysql-hostinger-stack` for stack conventions (Node/MySQL/Drizzle).
- Build every table in §2, not just the ones an MVP screen would need — `projects` as the
  root (not `listings`), `lexicon_pronunciations` as a child of `jopara_lexicon` (per-engine,
  not one global column), `provider_params` (JSON) on `voices`, `cost_raw_amount` +
  `cost_raw_unit` + `cost_usd` on `generation_jobs`, plus `provider_rates`.
- Provider abstraction: implement the exact interface shape in plan §2 — `synthesize`/
  `generateClip`/`generate` each return a normalized `Promise<Result>`, never a
  `{jobId, poll()}` shape. Build `HiggsfieldAdapter` (using the Higgsfield MCP tools) AND
  a `MockProvider` implementing all three interfaces with canned fixtures — the mock is
  required, not optional, per plan §2/§5.1. No calling code may reference
  `mcp__higgsfield_ai__*` outside the adapter file.
- Provision the S3-compatible bucket now (ask for credentials if not present — this is a
  real stop-and-ask per §4.4, not a degrade-gracefully case) and wire immediate download
  of every completed `generation_jobs` output into it. Do not defer storage to a later phase.
- Run `voices list --json` and `generate cost` (or MCP equivalents) and record results in
  the build log.
- Re-runnable; minor issues → `KNOWN-ISSUES.md`; stop only per §4.4 (missing credential
  with no fallback, or a schema/architecture call risky enough to force a rewrite if wrong).

Exit: schema migrates clean; `HiggsfieldAdapter` and `MockProvider` both pass the same
interface-conformance test suite; a `generation_jobs` row round-trips through the adapter,
downloads its output to owned storage, and records `cost_usd`. **Go/no-go gate (required,
not optional)**: synthesize 2–3 real Guaraní/jopara test sentences across at least 3
candidate engines, store the resulting audio in owned storage, and write listening notes
into the build log. If nothing is acceptable even with hand-tuned respellings, STOP and
report to Anton before merging — this is the foundational bet the rest of the build rests
on, exactly the kind of finding §4.4 exists for. PR merged green with this gate passed.

## After this phase — hand off to the next (fresh session)

Four gates before handoff: PR merged green; exit checklist above fully passed including
the go/no-go gate; pre-handoff adversarial re-read of your own merged diff (re-run
migrations + adapter tests, look for what would break a future provider swap); build-log
entry committed (schema summary, adapter test results, go/no-go findings, where opus-2
should look first). Then spawn opus-2 as a NEW session via `create_session`: inherit
environment and permission mode (never `plan` mode), model = Opus, prompt exactly
`Read prompts/opus-2-script-voice.md in this repo and execute it.` If `create_session` is
unavailable, continue in the same window (same model, so no switch needed) and report.
Never hand off if the go/no-go gate failed — stop and report instead.
