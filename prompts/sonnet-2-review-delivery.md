# Phase sonnet-2 — Review & delivery UI. Paste into a fresh Sonnet session, ONLY after phase sonnet-1 is merged.

Read `plan.md` FIRST, in full — plus §9 build log and `KNOWN-ISSUES.md`. Execute plan
§6.2 under the autonomy protocol §4.

**Hard limits (repeated from plan §6, non-negotiable)**: no schema changes, no changes to
the provider-abstraction interfaces or adapters, no auth changes, no changes to the
render-environment decision. All data access through the existing query/service layer.

Phase rules:
- Branch `phase/sonnet-2` off latest main. Phase sonnet-1 unmerged ⇒ finish it first.
- Job status monitoring view across `generation_jobs` (tts/video/image kinds), with cost
  visible per job (raw units + USD, from plan §2).
- Finished video preview/download from `videos`.
- Standalone Guaraní TTS page consuming opus-2's TTS API route — default this admin-gated
  per plan §6.2 unless Anton says otherwise when this phase runs.
- Re-runnable; minor issues → `KNOWN-ISSUES.md`; stop only per §4.4.

Exit: Anton can watch a generation job's status live, see its cost, preview/download a
finished video, and use the standalone Guaraní TTS page to get audio for arbitrary text.
PR merged green.

## After this phase — hand off to the next (fresh session)

Four gates before handoff: PR merged green; exit checklist passed; pre-handoff adversarial
re-read (verify status updates actually reflect real job state, not a stale/cached view);
build-log entry committed (what's now visible/deliverable, where sonnet-3 should look
first — especially cost data it'll aggregate into a dashboard). Then spawn sonnet-3 as a
NEW session via `create_session`: inherit environment and permission mode, model = Sonnet,
prompt exactly `Read prompts/sonnet-3-deploy.md in this repo and execute it.` If
`create_session` is unavailable, continue in the same window (same model) and report.
