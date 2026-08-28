# Phase opus-3 — Video assembly (no generative visuals). Paste into a fresh Opus session, ONLY after phase opus-2 is merged.

Read `plan.md` FIRST, in full — plus §9 build log and `KNOWN-ISSUES.md`. Execute plan
§5.3 under the autonomy protocol §4. Build nothing outside the plan.

Phase rules:
- Branch `phase/opus-3` off latest main. Phase opus-2 unmerged ⇒ finish it first.
- This phase is compositing ONLY — existing listing photos + the per-line narration audio
  opus-2 produced. No generative image/video calls here; that is opus-4's job on purpose
  (a phase needing two sessions was two phases). Do not scope-creep into it.
- Runs as the local worker process decided in plan §1 (ffmpeg on a machine that isn't
  Hostinger's managed hosting) — build it as a standalone worker against the shared DB/
  storage, not as a Next.js API route trying to run ffmpeg inline.
- Ken Burns-style pans/zooms over listing photos; narration assembled from per-line clips
  at their measured offsets (from opus-2's `duration_ms` data — do not re-measure or
  re-transcribe); captions burned in from `display_text`, timed to those exact offsets.
- Output default 9:16 vertical, sized for WhatsApp forwarding (roughly under 16MB for a
  typical listing video); 16:9 as a secondary render option, not the default.
- This phase's output is a legitimately sellable MVP on its own (photos + Guaraní
  narration, no generative spend) — don't gold-plate it waiting for opus-4.
- Re-runnable; minor issues → `KNOWN-ISSUES.md`; stop only per §4.4.

Exit: given a project with a script, per-line audio, and a set of listing photos, the
worker produces a finished 9:16 video with correctly-timed burned captions and audio,
under the WhatsApp size target, with a `videos` row recording `final_video_url` and cost
rollup. A 16:9 render also works. PR merged green.

## After this phase — hand off to the next (fresh session)

Four gates before handoff: PR merged green; exit checklist passed; pre-handoff adversarial
re-read (check caption timing against an actual multi-line script, not a one-liner test
case; confirm file size on a realistic-length video); build-log entry committed (worker
architecture, how it's invoked/deployed, where opus-4 should hook in generative assets).
Then spawn opus-4 as a NEW session via `create_session`: inherit environment and
permission mode, model = Opus, prompt exactly
`Read prompts/opus-4-visuals.md in this repo and execute it.` If `create_session` is
unavailable, continue in the same window (same model) and report.
