# Phase opus-3 — Assembly (compositing only). Paste into a fresh OPUS session, ONLY after opus-2 is merged.

Read `plan.md` FIRST, in full — plus §9 build log and `KNOWN-ISSUES.md`.
Execute plan §5.3 under the autonomy protocol §4. Build nothing outside the plan.

Phase rules:
- Branch `phase/opus-3` off latest main. opus-2 unmerged ⇒ finish it first.
- NO generative visuals in this phase — that is opus-4. Inputs are existing listing
  photos + the per-line narration from opus-2.
- The compositor is a separate worker process per §1's render-environment decision:
  polls the jobs queue via the DB, runs ffmpeg locally, uploads to object storage. The
  web app never runs ffmpeg.
- Default 9:16 per §1's delivery spec; captions burned from `display_text` timed by the
  known per-line offsets; readable on muted autoplay. No transcription anywhere.
- `videos` row gets `final_video_url` (own storage) + USD cost rollup from all
  `generation_jobs` involved.
- ffmpeg missing on this machine ⇒ document setup in README + `.env.example`, build
  against a fixture path, note in KNOWN-ISSUES.md — don't block.
- Re-runnable; minor issues → KNOWN-ISSUES.md; stop only per §4.

Exit: from one real listing + its opus-2 narration, the worker produces a finished 9:16
video with synced burned captions, stored in own storage, `videos` row complete with USD
rollup; a second run on the same inputs is idempotent (no duplicate jobs); tests green;
PR merged green.

## After this phase — hand off to the next (fresh session)
Four gates (merged green, exit checklist, adversarial diff re-read, build-log entry).
Then `create_session`, `model`: **Opus** (never Fable), `prompt` exactly:
`Read prompts/opus-4-visuals.md in this repo and execute it.` Fallback: continue in
this window (same model) or stop and report.
