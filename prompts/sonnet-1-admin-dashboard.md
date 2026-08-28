# Phase sonnet-1 — Admin dashboard. Paste into a fresh Sonnet session, ONLY after phase opus-4 is merged.

Read `plan.md` FIRST, in full — plus §9 build log (especially opus-4's summary of the
whole foundation) and `KNOWN-ISSUES.md`. Execute plan §6.1 under the autonomy protocol §4.

**Hard limits (repeated from plan §6, non-negotiable for this phase)**: no schema changes,
no changes to the provider-abstraction interfaces or adapters, no auth changes, no changes
to the render-environment decision. All data access goes through the query/service layer
the Opus phases built. If a UI need seems to require a schema change, write it to
`KNOWN-ISSUES.md` and Backlog instead of touching the schema yourself.

Phase rules:
- Branch `phase/sonnet-1` off latest main. Phase opus-4 unmerged ⇒ finish it first.
- Load `nodejs-mysql-hostinger-stack` and `web-design-system` for UI conventions — this is
  an internal admin tool for one user (Anton), so favor clarity and speed of building over
  polish, but it still shouldn't look like an unstyled form dump.
- Screens: listing entry/import, script review/edit (edit `speech_text` per line, promote
  `unresolved_terms` into the lexicon with the engine-specific pronunciation table from
  opus-2), voice+engine picker wired to the A/B harness.
- The lexicon-promotion UI is the actual bridge between the automated pipeline and the
  native-speaker QA loop plan §7/§11 calls for — make it usable by someone who isn't a
  developer, since that reviewer may not be Anton.
- Re-runnable; minor issues → `KNOWN-ISSUES.md`; stop only per §4.4.

Exit: Anton can, from the dashboard alone, enter/import a listing, generate and edit a
script, resolve queued unresolved terms into the lexicon, pick a voice+engine combination,
and trigger generation — no direct DB or API access needed for the day-to-day workflow.
PR merged green.

## After this phase — hand off to the next (fresh session)

Four gates before handoff: PR merged green; exit checklist passed; pre-handoff adversarial
re-read (click through the actual workflow end to end, not just component-level checks);
build-log entry committed (what the dashboard covers, what it deliberately doesn't, where
sonnet-2 should look first). Then spawn sonnet-2 as a NEW session via `create_session`:
inherit environment and permission mode, model = Sonnet, prompt exactly
`Read prompts/sonnet-2-review-delivery.md in this repo and execute it.` If `create_session`
is unavailable, continue in the same window (same model) and report.
