# Guaraní — AI Video Engine for Real Estate Listings

Phase table (fill in as phases complete):

| Phase | Model | Prompt file | Plan sections |
|---|---|---|---|
| opus-1 | Opus | prompts/opus-1-foundation.md | §2, §5.1 |
| opus-2 | Opus | prompts/opus-2-script-voice.md | §5.2 |
| opus-3 | Opus | prompts/opus-3-video-assembly.md | §5.3 |
| sonnet-1 | Sonnet | prompts/sonnet-1-admin-dashboard.md | §6.1 |
| sonnet-2 | Sonnet | prompts/sonnet-2-review-delivery.md | §6.2 |
| sonnet-3 | Sonnet | prompts/sonnet-3-deploy.md | §6.3 |

Prompt files are not written yet — plan is pending a second-opinion review pass before Stage 3 locks phase scope. Do not start build phases against this plan until this note is removed.

## 1. Decisions already made (locked — do not re-litigate without explicit new instruction)

- **Shape**: internal ops tool Anton operates himself for now, not multi-tenant SaaS and not a propia.com.py feature yet. Reuses propia's listing shape as input where convenient but ships as its own app in its own repo (`antonmarklundcom/guarani`).
- **Vertical scope**: real estate listing videos only, Paraguay market, Spanish + Guaraní bilingual. Not a general-purpose video editor.
- **Guaraní voice**: first-class deliverable, not a bolt-on. Both (a) full listing videos with Guaraní narration and (b) a standalone "type text, get Guaraní speech" capability are in scope for the same build — the standalone TTS route is a thin exposure of the same script/voice pipeline the video feature needs, not a second product.
- **Provider strategy**: Higgsfield MCP is the first AI provider (video, TTS, image), but it is explicitly NOT the permanent choice. The system is built against a provider-abstraction interface from day one so Runway, ElevenLabs, or anything else can be swapped in as a second adapter later without touching schema, script logic, or the assembly layer. This is a hard architectural requirement, not a nice-to-have.
- **Monetization**: parked. Track real Higgsfield credit cost per generation from day one (a `generation_jobs.cost_credits` column, no pricing UI) so unit economics are known before any pricing decision is made.
- **Voice cloning**: remains a one-time manual step done in the Higgsfield app/MCP per voice, outside the automated pipeline. The pipeline only ever consumes an existing `voice_id`.

## 2. Roles & object model

**Roles**: single `admin` role for MVP (Anton only). No client/agent login, no auth complexity beyond a basic login gate on the dashboard. Role enum still modeled in the DB (`admin`) so adding `agent`/`client` later is additive, not a migration rewrite.

**Core objects** (one shared table + typed detail tables where it matters):

- `listings` — address, price, currency, rooms, bathrooms, area_m2, features (JSON), status. Source of truth for facts a script may state; nothing else may.
- `scripts` — belongs to a listing + language (`es`/`gn`). Two fields per line: `display_text` (proper orthography, for captions/UI) and `speech_text` (phonetically respelled form fed to TTS). Never merge these into one field.
- `jopara_lexicon` — `term`, `language`, `speech_form`, `verified` (bool), `notes`. Every Guaraní (or jopara-mixed) word used in a script that isn't a trivial passthrough gets an entry here. This table is the single point of truth for "how do we say this word" — scripts reference it, never hardcode respellings inline.
- `unresolved_terms` — auto-populated when script generation hits a word not in `jopara_lexicon`; queue for Anton to review and promote into the lexicon. This is the operational safety valve for the biggest technical risk in the project.
- `voices` — `provider`, `provider_voice_id`, `engine` (elevenlabs/minimax/seed_speech/vibe_voice/cozy_voice/etc.), `language`, `label`, `sample_url`. One row per (voice, engine) combination tested, so A/B results are queryable, not just anecdotal.
- `generation_jobs` — polymorphic job log: `kind` (tts/video/image), `provider`, `provider_job_id`, `status`, `input_ref` (FK-ish pointer to what was requested), `output_url`, `cost_credits`, timestamps. Every provider call goes through this table — nothing calls Higgsfield (or any future provider) without a row here first.
- `videos` — `listing_id`, `language`, `voice_id`, `script_id`, `status`, `final_video_url`, cost rollup. The finished deliverable.

**Provider abstraction** (the load-bearing piece of §1's provider-strategy decision):

```
interface TTSProvider { synthesize(text, voiceId, engine) -> {jobId, poll()} }
interface VideoProvider { generateClip(sceneSpec) -> {jobId, poll()} }
interface ImageProvider { generate(prompt, refs) -> {jobId, poll()} }
```

`HiggsfieldAdapter` implements all three now, using the Higgsfield MCP tools directly. All application code (script pipeline, job orchestrator, assembly layer) talks to the interface, never to `mcp__higgsfield_ai__*` tools directly outside the adapter file. This is the one rule that makes a future Runway/ElevenLabs swap a new adapter file instead of a rewrite — enforce it in code review during every phase, Opus and Sonnet alike.

## 3. Feature scope

**Core (must ship in this build)**:
1. Structured-data-driven script generation (listing fields → `display_text`/`speech_text` pairs, ES + GN), with hard guardrails against inventing facts not present in `listings`.
2. Jopara lexicon + unresolved-terms queue (§2) — ships in phase 1, used from phase 1 on, never retrofitted.
3. TTS pipeline: given a script + voice_id + engine, produce narration audio via the provider abstraction; log cost.
4. Video assembly: combine narration + property photos/clips into a finished listing video with burned-in captions (using `display_text`, driven by known script timing — no Whisper, no re-transcription).
5. Standalone Guaraní TTS route: paste/select text → speech_text lookup or manual override → audio out. Same pipeline as #3, exposed directly.
6. Admin dashboard: import/enter a listing, generate/edit a script, review/promote unresolved lexicon terms, pick voice+engine, trigger generation, review job status, preview/download the finished video.
7. Diagnostics run before any of the above is trusted: `voices list --json` and `generate cost` (or MCP equivalents) captured in the build log so voice inventory and real credit cost are known facts, not assumptions.

**Deferred to Backlog (§10)**: multi-tenant accounts, self-serve client portal, billing/pricing UI, batch CSV import of many listings at once, propia.com.py auto-sync, additional languages beyond ES/GN, self-service voice cloning in-app.

## 4. Autonomy protocol

(Standard phased-autonomous-build protocol — see skill for full text. Key points every phase must follow: work to exit criteria without asking permission for in-plan work; one PR per phase, branch `phase/<id>` off latest main, merge when green; log minor issues to `KNOWN-ISSUES.md` and keep going; stop and ask ONLY for a missing credential with no fallback or a foundational schema/architecture decision that would force a rewrite if guessed wrong; missing env values degrade gracefully, never block; every phase prompt is re-runnable from the first unmet exit criterion; Sonnet phases never touch schema, auth, or the provider-abstraction interface — workaround + Backlog note instead; Fable is never used for build phases or spawned sessions, only for the human-driven planning conversation Anton runs himself; hand off between phases only after PR merged green + exit checklist passed + a pre-handoff adversarial re-read of the merged diff + a build-log entry committed, then spawn the next phase as a fresh session via `create_session` with the right model.)

## 5. Opus phases

### 5.1 opus-1-foundation
Full DB schema for every table in §2 (yes, all of them, even though later phases use most). Provider-abstraction interfaces + `HiggsfieldAdapter` implementing TTS/video/image via the Higgsfield MCP tools. Run and record the two diagnostics (`voices list --json`, `generate cost`) into the build log before writing any generation logic — they determine what voices/engines actually exist to build against. Seed `jopara_lexicon` with an initial hand-picked set of common real-estate terms (calle, avenida, dormitorio, baño, garaje, etc. in their Guaraní/jopara forms) so phase 2 has something to test against.

### 5.2 opus-2-script-voice
Script generation service: `listings` row → `scripts` row(s), ES and GN, populating `display_text`/`speech_text` via the lexicon and flagging unknowns to `unresolved_terms`. TTS job orchestration through the provider abstraction (submit, poll, store `generation_jobs` row, attach resulting audio to the script/voice pair). Standalone Guaraní TTS route (API-level; UI comes in sonnet-2). A/B harness: same script + voice_id across multiple `engine` values, logged as separate `generation_jobs` rows for comparison.

### 5.3 opus-3-video-assembly
Video generation orchestration (image/clip generation calls through the provider abstraction) and the compositing step: assemble narration + visuals + burned-in captions into a finished video. Captions come from `display_text` and known TTS timing/duration metadata returned by the provider — never from re-transcription. Output lands in `videos` with `final_video_url` and a cost rollup summed from all `generation_jobs` involved.

## 6. Sonnet phases

**Hard limits for every Sonnet phase**: no schema changes, no changes to the provider-abstraction interface or adapters, no auth changes. All data access goes through the query/service layer Opus phases built. A UI need that seems to require a schema change goes to `KNOWN-ISSUES.md` and Backlog, not a direct migration.

### 6.1 sonnet-1-admin-dashboard
Listing entry/import form, script review/edit screen (edit `speech_text` per line, promote `unresolved_terms` into the lexicon), voice+engine picker wired to the A/B harness from opus-2.

### 6.2 sonnet-2-review-delivery
Job status monitoring view (`generation_jobs` across kinds), finished video preview/download, and a public-facing (or admin-gated, Anton's call at build time — default gated) page for the standalone Guaraní TTS route from opus-2.

### 6.3 sonnet-3-deploy
Deploy to Hostinger per `nextjs-deploy-hostinger`. Wire object storage (S3-compatible — e.g. Cloudflare R2) for source photos and rendered outputs so large media never lives on Hostinger's own disk; the app stores only metadata + URLs. Basic cost dashboard summing `generation_jobs.cost_credits` by day/listing.

## 7. Human-inputs checklist

- Higgsfield API/MCP credentials — needed from opus-1.
- At least one voice already cloned manually in the Higgsfield app (per §1) — needed before opus-2 can generate real narration; opus-2 can be built and tested against a stock/non-cloned voice_id in the meantime.
- S3-compatible storage bucket + credentials — needed by opus-3 (or can defer to sonnet-3 if opus-3 temporarily stores output URLs pointing at Higgsfield's own hosted results).
- Hostinger Node app slot + domain — needed at sonnet-3.
- A handful of real listing records (from propia or manually entered) to use as realistic test input from opus-1 onward.

## 8. Open business questions (parked, not build work)

- Pricing model if/when this becomes a paid service (per-video credits vs. subscription vs. bundled into an existing offering).
- Whether this becomes a propia.com.py feature, a standalone resold SaaS for other Paraguay agencies, or both.
- Whether the standalone Guaraní TTS capability gets marketed as its own product (see §11 opportunities) and to whom.
- Provider swap timing — when (if ever) to add a second adapter (Runway, ElevenLabs direct) and what would trigger that decision (cost, quality, Higgsfield reliability).

## 9. Build log & handoff

(empty — first entry gets appended by opus-1 before its PR merges)

## 10. Backlog

- Multi-tenant accounts / client self-serve portal.
- Billing and pricing UI.
- Batch CSV import of many listings at once.
- Direct propia.com.py integration (auto-generate a video for every new listing).
- Additional languages/voices beyond ES/GN.
- Self-service voice cloning inside the app (blocked on Higgsfield or another provider exposing cloning via API).
- Second provider adapter (Runway/ElevenLabs/etc.) — architecture supports it from day one, but do not build it until there's a concrete reason to swap.

## 11. Problems, solutions, and business opportunities (context for the review pass — not build instructions)

**Problems and their solutions** (also reflected in §2/§3 above):

1. *Guaraní orthography breaks Spanish-tuned TTS* (glottal stop, /ɨ/, nasal vowels) → dual-string data model (`display_text` vs `speech_text`) plus a persistent `jopara_lexicon`, in the schema from commit one.
2. *Voice cloning isn't exposed via API* → treat it as a manual runbook step (documented, not automated); the pipeline only ever needs a `voice_id` string. Revisit only if a future provider exposes cloning programmatically.
3. *Provider lock-in* → provider-abstraction interface (§2) is the direct answer to "I want to swap Higgsfield for Runway later" — enforced as a hard rule in every phase, not just a phase-1 nicety.
4. *Whisper mis-transcribes Guaraní* → never transcribe; captions and timing are derived from the script that was fed to TTS, using the provider's own duration metadata.
5. *Script hallucination* (AI inventing false property claims) → script generation is a template filled strictly from `listings` fields, never a free-text prompt to an LLM as sole source of truth.
6. *Silent mispronunciation drift* (a new street/neighborhood/brand name isn't in the lexicon yet) → `unresolved_terms` queue makes gaps visible and fixable in the dashboard instead of shipping a bad video silently.
7. *Cost blindness* → every provider call logs `cost_credits` from day one, so pricing decisions (§8) are made from real data, not guesses.

**Business opportunities** (why this is worth building beyond a one-off tool):

- **propia.com.py**: once proven, this becomes a differentiator no other Paraguay listings site has — every listing can ship with an autoplay bilingual video. Deferred to Backlog on purpose so the pipeline is proven standalone first.
- **Resell to other agencies/agents**: a Paraguay real estate agent using a competitor's site or none at all is a clean upsell target for "we make your listing videos, in Guaraní, for X per video" — the ops-tool shape in §1 means Anton can sell this as a service manually (do the work himself via the dashboard) long before any self-serve SaaS work is justified.
- **Content-service delivery for existing local-business clients** (paraguay-local-site / gbp-optimizer clients — plomero, dentista, abogado, etc.): the same script + voice + assembly pipeline is not real-estate-specific at the schema level beyond the `listings` table. A parallel `content_items` table (Backlog-tier, not now) could reuse everything in §2 for short vertical ads with Guaraní voiceover — a premium add-on for exactly the rural/interior-Paraguay-facing local businesses Anton already serves, where Guaraní-first messaging reads as authentic in a way Spanish-only ads don't.
- **Standalone Guaraní TTS as a licensable capability**: once the lexicon and voice pipeline are solid, "text in, correct Guaraní speech out" has a market beyond real estate — dubbing, accessibility, education content, call-center IVR, government communications. Not a build target now (§8), but the standalone route in §3.5 is deliberately built as a generically reusable API, not a real-estate-only feature, so this option stays open without extra work later.
- **Defensibility**: the jopara-lexicon itself, built and corrected over real usage, is a compounding asset — a competitor starting today has to rebuild it from zero. Worth treating internally as IP, not a throwaway config file.
