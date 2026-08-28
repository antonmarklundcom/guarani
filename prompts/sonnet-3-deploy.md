# Phase sonnet-3 — Deploy. Paste into a fresh Sonnet session, ONLY after phase sonnet-2 is merged. FINAL PHASE — no further handoff.

Read `plan.md` FIRST, in full — plus §9 build log and `KNOWN-ISSUES.md`. Execute plan
§6.3 under the autonomy protocol §4.

**Hard limits (repeated from plan §6, non-negotiable)**: no schema changes, no changes to
the provider-abstraction interfaces or adapters, no auth changes, no changes to the
render-environment decision. Storage is already wired in opus-1 — do not touch it here.

Phase rules:
- Branch `phase/sonnet-3` off latest main. Phase sonnet-2 unmerged ⇒ finish it first.
- Load `nextjs-deploy-hostinger` and `budgeted-runner-deploy` before touching CI/deploy
  config or anything under `.github/`.
- Deploy the Node/Next app to Hostinger per that skill's playbook.
- Document (README or a short ops doc) how the Hostinger-hosted app and the local ffmpeg
  worker (plan §1, built in opus-3) talk to each other in production — shared DB + storage,
  and however the worker is triggered/polled. This is documenting an already-locked
  decision, not making a new architecture choice.
- Cost dashboard: `generation_jobs.cost_usd` summed by day and by project.
- Re-runnable; minor issues → `KNOWN-ISSUES.md`; stop only per §4.4.

Exit: app is live on Hostinger, the ffmpeg worker's role in production is documented, the
cost dashboard shows real numbers, and env vars are documented in `.env.example` for
anything not yet configured (missing values degrade gracefully per §4.5, never block).
PR merged green.

## Final phase — STOP and report to Anton, do not spawn another session

This is the last phase in the plan. On merge, report back with:
- The live app URL and how to log in.
- A short checklist of what's built vs. what's Backlog (plan §10) vs. what's an open
  business question (plan §8) — especially the validation track (3 real agents, a price
  commitment) which is non-technical and was never this build's job to close.
- Exact manual next steps for Anton: complete the voice-cloning runbook step with signed
  consent if not already done (plan §1/§7), line up the native Guaraní reviewer (plan §7),
  and check Higgsfield's ToS on commercial resale before invoicing anyone (plan §8).
- Anything logged in `KNOWN-ISSUES.md` across all seven phases that's worth Anton's
  attention before he starts using this for real listings.
