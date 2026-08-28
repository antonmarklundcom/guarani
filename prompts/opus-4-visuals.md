# Phase opus-4 — Generative visuals. Paste into a fresh Opus session, ONLY after phase opus-3 is merged. Last Opus phase — hands off to Sonnet next.

Read `plan.md` FIRST, in full — plus §9 build log and `KNOWN-ISSUES.md`. Execute plan
§5.4 under the autonomy protocol §4. Build nothing outside the plan.

Phase rules:
- Branch `phase/opus-4` off latest main. Phase opus-3 unmerged ⇒ finish it first.
- Generative image/clip orchestration through the provider abstraction only —
  `ImageProvider.generate(ImageSpec)` / `VideoProvider.generateClip(SceneSpec)`. `SceneSpec`
  stays declarative (shot type, subject, mood, duration, aspect ratio) — the
  Higgsfield-specific prompt phrasing lives entirely inside `HiggsfieldAdapter`. If you
  find yourself writing Higgsfield-idiom prompt text anywhere outside the adapter, stop
  and fix the abstraction instead of working around it.
- Generated assets slot into the SAME opus-3 assembly pipeline as an alternative or
  supplement to plain listing photos — do not build a second assembly path.
- This is the last Opus phase. Before handing off to Sonnet, do a final architecture
  self-check: confirm nothing in opus-1 through opus-4 leaked a Higgsfield-specific type,
  URL shape, or prompt string into code a Sonnet phase would touch — Sonnet phases are
  hard-forbidden from fixing that later.
- Re-runnable; minor issues → `KNOWN-ISSUES.md`; stop only per §4.4.

Exit: a project can get generated b-roll/visual assets via the provider abstraction, and
opus-3's assembly pipeline consumes them identically to plain listing photos. PR merged
green.

## After this phase — hand off to the next (fresh session, MODEL SWITCH: Opus → Sonnet)

Four gates before handoff: PR merged green; exit checklist passed; pre-handoff
adversarial re-read (specifically check for the Higgsfield-leakage self-check above —
this is the last chance to catch it before Sonnet phases are forbidden from touching it);
build-log entry committed summarizing the full Opus-phase foundation for Sonnet's benefit:
schema, provider abstraction, script/voice API surface, assembly worker, all in one place
so sonnet-1 doesn't have to reconstruct it from four separate diffs. Then spawn sonnet-1
as a NEW session via `create_session`: inherit environment and permission mode, model =
Sonnet (this is the model switch — Fable is never used for build phases, per the cost
guardrail), prompt exactly
`Read prompts/sonnet-1-admin-dashboard.md in this repo and execute it.` If `create_session`
is unavailable, STOP and report — do not continue in the same window across a model switch.
