# Phase sonnet-3 — Deploy. Paste into a fresh SONNET session, ONLY after sonnet-2 is merged. FINAL PHASE.

Read `plan.md` FIRST, in full — plus §9 build log and `KNOWN-ISSUES.md`.
Execute plan §6.3 under the autonomy protocol §4. Build nothing outside the plan.

HARD LIMITS (repeat of §6): no schema changes, no touching the provider-abstraction
interfaces/adapters, no auth changes, no render-worker changes.

Phase rules:
- Branch `phase/sonnet-3` off latest main. sonnet-2 unmerged ⇒ finish it first.
- Load skill `nextjs-deploy-hostinger` BEFORE touching any deploy config — follow its
  verified fixes (env vars, Remote MySQL, subdomain mapping).
- Web app only goes to Hostinger; the render worker stays local per §1 — document its
  run command + required env in the README instead.
- Cost dashboard: `generation_jobs.cost_usd` summed by day and by project.
- Nightly lexicon backup per §6.3 (lexicon + pronunciations → object storage).
- Missing Hostinger credentials/slot ⇒ prepare everything deployable, document the exact
  manual steps, note in KNOWN-ISSUES.md — don't block.
- Re-runnable; minor issues → KNOWN-ISSUES.md; stop only per §4.

Exit: app reachable on the Hostinger URL with login gate working against the production
DB (or fully-prepared deploy + documented manual steps if credentials were missing);
cost dashboard shows real numbers; backup job runs once successfully; PR merged green.

## After this phase — STOP (no further sessions)
Four gates as usual, then do NOT spawn anything. End with the closing report to Anton:
live URL(s), full exit-criteria checklist across all seven phases, every KNOWN-ISSUES
item, and exact numbered manual steps still owed by a human (from plan §7: voice
consent + recording + clone, Guaraní reviewer sessions, render-worker machine setup,
any deferred credentials). Suggest creating a `guarani-dev` project skill capturing
final schema, routes, and guardrails.
