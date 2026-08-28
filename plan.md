# Guaraní — AI Video Engine for Real Estate Listings

Phase table (fill in as phases complete):

| Phase | Model | Prompt file | Plan sections |
|---|---|---|---|
| opus-1 | Opus | prompts/opus-1-foundation.md | §2, §5.1 |
| opus-2 | Opus | prompts/opus-2-script-voice.md | §5.2 |
| opus-3 | Opus | prompts/opus-3-assembly.md | §5.3 |
| opus-4 | Opus | prompts/opus-4-visuals.md | §5.4 |
| sonnet-1 | Sonnet | prompts/sonnet-1-admin-dashboard.md | §6.1 |
| sonnet-2 | Sonnet | prompts/sonnet-2-review-delivery.md | §6.2 |
| sonnet-3 | Sonnet | prompts/sonnet-3-deploy.md | §6.3 |

Plan locked 2026-08-28 after the advisor review pass (see `plan-review.md` for the
reasoning behind every non-obvious choice below). Build phases may start once the PR
containing this plan is merged to main.

## 1. Decisions already made (locked — do not re-litigate without explicit new instruction)

- **Shape**: internal ops tool Anton operates himself for now, not multi-tenant SaaS and not a propia.com.py feature yet. Reuses propia's listing shape as input where convenient but ships as its own app in its own repo (`antonmarklundcom/guarani`).
- **Vertical scope**: real estate listing videos only, Paraguay market, Spanish + Guaraní bilingual. Not a general-purpose video editor.
- **Guaraní voice**: first-class deliverable, not a bolt-on. Both (a) full listing videos with Guaraní narration and (b) a standalone "type text, get Guaraní speech" capability are in scope for the same build — the standalone TTS route is a thin exposure of the same script/voice pipeline the video feature needs, not a second product.
- **Provider strategy**: Higgsfield MCP is the first AI provider (video, TTS, image), but it is explicitly NOT the permanent choice. The system is built against a provider-abstraction interface from day one (see §2 — Promise-based, normalized result types, no job/poll leakage) so Runway, ElevenLabs, or anything else can be swapped in as a second adapter later without touching schema, script logic, or the assembly layer. Hard architectural requirement. The real lock-in risks are assets, not code, and each has a standing mitigation: every provider-hosted output is downloaded to our own object storage the moment its job completes (provider URLs are assumed expiring); prompt text is adapter-owned (a `SceneSpec` is declarative — shot type, subject, mood, duration, aspect — and each adapter renders it into its own models' prompt idiom); costs are normalized to USD (§2 `generation_jobs`).
- **Voice cloning**: kept OUT of the automated pipeline as a deliberate scope decision (the Higgsfield MCP does expose cloning via `create_voice` / audio-reference cloning, so this is a choice, not a provider limitation). Cloning is a documented runbook step — which may be a scripted MCP call — run manually per voice; the pipeline only ever consumes an existing `voice_id`. The **portable asset is the original studio recordings** of the voice talent: they are versioned in our own storage, and a provider swap means re-cloning from the same recordings, never re-recording. **Voice rights**: before any recording session, written consent from the voice talent covering commercial use, cloning, resale to third parties, and territory, with agreed compensation. If the voice is Anton's own, record that decision and the concentration risk (one voice = the product's identity) in the build log.
- **Render environment**: the web app (Hostinger managed Node) stores metadata, serves the dashboard, and enqueues jobs. **ffmpeg compositing runs in a separate worker process** — on Anton's machine (default) or a cheap VPS later — polling the jobs queue via the same DB and writing outputs to object storage. Hostinger's managed Node hosting is not assumed capable of running ffmpeg render jobs. The orchestrator is designed around this split from opus-1.
- **Delivery spec**: default output is **9:16 vertical**, captions legible on muted autoplay, file size targeted for WhatsApp forwarding; 16:9 is a secondary render option. Paraguayan agents distribute via WhatsApp/Instagram, not embedded players. (Higgsfield defaults to 16:9 — adapters must pass aspect explicitly.)
- **Monetization**: parked (see §8), but cost tracking is not: every provider call records raw provider cost AND normalized `cost_usd` from day one, so unit economics are known facts before any pricing decision.

## 2. Roles & object model

**Roles**: single `admin` role for MVP (Anton only). No client/agent login, no auth complexity beyond a basic login gate on the dashboard. Role enum still modeled in the DB (`admin`) so adding `agent`/`client` later is additive, not a migration rewrite.

**Core objects** (one shared root table + typed detail tables):

- `projects` — the shared root: `id`, `kind` (enum, `listing` only for now), `title`, `status`, timestamps. Scripts and videos hang off projects, not listings, so the §11 content-service reuse (`kind='content_item'` later) is additive.
- `listings` — typed detail table, `project_id` FK: address, price, currency, rooms, bathrooms, area_m2, features (JSON), status. Source of truth for facts a script may state; nothing else may.
- `scripts` — belongs to a project + language (`es`/`gn`). Script lines each carry two fields: `display_text` (proper orthography, for captions/UI) and `speech_text` (form fed to TTS). Never merge these into one field.
- `jopara_lexicon` — `term`, `language`, `ipa` (nullable — filled when known, so future SSML-capable providers can derive pronunciations instead of hand-authoring), `notes` (must record stress placement — Guaraní defaults to final-syllable stress, Spanish engines to penultimate). Every Guaraní/jopara word used in a script that isn't a trivial passthrough gets an entry. Single point of truth for "how do we say this word" — scripts reference it, never hardcode respellings inline.
- `lexicon_pronunciations` — child of `jopara_lexicon`: `term_id`, `engine` (including the value `default` as fallback), `speech_form`, `verified` (bool), `verified_by`, `sample_audio_url`. **Respellings are engine-specific** — a respelling tuned for one engine mispronounces on another — so speech forms are stored per engine, never as a single column. `verified` means a competent Guaraní speaker listened to the rendered sample and approved it; the sample URL is the evidence.
- `unresolved_terms` — auto-populated when script generation hits a term not resolvable via the lexicon (detection rule in §5.2); queue for review and promotion into the lexicon. The operational safety valve for the biggest technical risk in the project.
- `voices` — `provider`, `provider_voice_id`, `engine` (seed_audio/elevenlabs/minimax/seed_speech/vibe_voice/cozy_voice/…), `provider_params` (JSON — the full provider addressing tuple, e.g. Higgsfield needs model + variant + voice_type + voice_id), `language`, `label`, `sample_url`. One row per (voice, engine) combination tested, so A/B results are queryable.
- `generation_jobs` — polymorphic job log: `kind` (tts/video/image), `provider`, `provider_job_id`, `status`, `input_ref`, `output_url` (OUR storage URL after download; `provider_output_url` kept for reference but never depended on), `cost_raw_amount`, `cost_raw_unit`, `cost_usd`, timestamps. Every provider call goes through this table. A small `provider_rates` table maps raw units → USD per provider/plan.
- `videos` — `project_id`, `language`, `voice_id`, `script_id`, `status`, `aspect` (default `9:16`), `final_video_url`, cost rollup in USD. The finished deliverable.

**Provider abstraction** (the load-bearing piece of §1's provider-strategy decision):

```
interface TTSProvider   { synthesize(req: TTSRequest): Promise<TTSResult> }
interface VideoProvider { generateClip(spec: SceneSpec): Promise<ClipResult> }
interface ImageProvider { generate(spec: ImageSpec): Promise<ImageResult> }

TTSRequest { text, voiceRef /* our voices.id — adapter resolves provider params */ }
TTSResult  { audioUrl, durationMs,
             timing: { granularity: 'none'|'total'|'word'|'char', marks? },
             rawCost: { provider, unit, amount }, costUsd }
// ClipResult / ImageResult analogous. SceneSpec is declarative (shot type, subject,
// mood, duration, aspect) — prompt text is rendered inside the adapter, never stored
// in specs.
```

Polling/waiting is each adapter's private business — no `jobId`/`poll()` in the interface (that shape is a Higgsfield-ism; ElevenLabs direct TTS is synchronous). `HiggsfieldAdapter` implements all three interfaces via the MCP tools. A `MockProvider` implements all three with canned fixtures, fake durations, and zero cost — it is the second implementation that keeps the interface honest, and the test suite runs against it so no phase burns credits to test. All application code talks to the interfaces; nothing outside the adapter files touches `mcp__higgsfield__*`. Enforce in code review during every phase, Opus and Sonnet alike.

## 3. Feature scope

**Core (must ship in this build)**:
1. Structured-data-driven script generation (listing fields → `display_text`/`speech_text` line pairs, ES + GN), with hard guardrails against inventing facts not present in `listings`, and a **verbalization step for numbers, prices, and units** ("Gs. 850.000.000", "120 m²") in both languages — number reading is the most common TTS failure in real-estate scripts.
2. Jopara lexicon + per-engine pronunciations + unresolved-terms queue (§2) — ships in phase 1, used from phase 1 on, never retrofitted.
3. TTS pipeline: given a script + voice, produce narration audio via the provider abstraction, **one audio file per script line** (batch call), each line's duration measured locally with ffprobe — timing is true by construction, never dependent on provider timestamp metadata (Higgsfield returns none). Log cost per job.
4. Video assembly: concatenate per-line narration + property photos/clips into a finished 9:16 listing video with burned-in captions from `display_text`, timed by the known per-line offsets. No Whisper, no re-transcription, ever.
5. Standalone Guaraní TTS route: paste/select text → lexicon resolution or manual override → audio out. Same pipeline as #3, exposed directly.
6. Admin dashboard: enter a listing, generate/edit a script, review/promote unresolved terms, pick voice+engine, trigger generation, monitor jobs, preview/download the finished video.
7. Diagnostics before any of the above is trusted (§5.1): voice inventory, cost preflight, and — the go/no-go gate — **real Guaraní sentences synthesized across candidate engines** with listening notes in the build log.

**Deferred to Backlog (§10)**: multi-tenant accounts, self-serve client portal, billing/pricing UI, batch CSV import, propia.com.py auto-sync, additional languages beyond ES/GN, self-service voice cloning in-app.

## 4. Autonomy protocol

(Standard phased-autonomous-build protocol — see skill for full text. Key points every phase must follow: work to exit criteria without asking permission for in-plan work; one PR per phase, branch `phase/<id>` off latest main, merge when green; log minor issues to `KNOWN-ISSUES.md` and keep going; stop and ask ONLY for a missing credential with no fallback or a foundational schema/architecture decision that would force a rewrite if guessed wrong; missing env values degrade gracefully (document in `.env.example`), never block; every phase prompt is re-runnable from the first unmet exit criterion; Sonnet phases never touch schema, auth, or the provider-abstraction interface — workaround + Backlog note instead; **Fable/Mythos-class models are NEVER used for build phases, subagents, or spawned sessions — phase tables and prompts only ever name Opus and Sonnet; needing Fable means stop and ask Anton**; hand off between phases only after PR merged green + exit checklist passed + a pre-handoff adversarial re-read of the merged diff + a build-log entry committed, then spawn the next phase as a fresh session via `create_session` with the model from the phase table.)

## 5. Opus phases

### 5.1 opus-1-foundation
Full DB schema for every table in §2 (all of them, including `projects` as root and `lexicon_pronunciations`). Provider-abstraction interfaces + result types + `HiggsfieldAdapter` + `MockProvider`; test suite runs against the mock. Object-storage module (S3-compatible/R2): every completed generation job downloads its artifact to our bucket immediately; if the bucket env vars are missing, degrade gracefully (keep provider URL, log a WARN, document in `.env.example`) but the code path ships now. Diagnostics recorded in the build log before any generation logic: voice inventory (`list_voices`), cost preflight (`get_cost`), and the **go/no-go gate** — synthesize 2–3 real Guaraní/jopara sentences across candidate engines (a few credits), store the audio + a listening-notes table. Seed `jopara_lexicon` with an initial hand-picked set of common real-estate terms (calle, avenida, dormitorio, baño, garaje, etc. in Guaraní/jopara forms) with `default`-engine pronunciation rows, so phase 2 has something to test against.

### 5.2 opus-2-script-voice
Script generation service: `listings` row → `scripts` row(s), ES and GN, populating `display_text`/`speech_text` via the lexicon, with the number/price/unit verbalization step. **Unresolved-terms detection rule** (implement exactly this, don't invent another): any token in a GN/jopara script that (a) does not longest-match a lexicon entry (tokenizer must handle multi-word terms — "Barrio San Vicente" — and casing) and (b) is not on an explicit Spanish-passthrough allowlist → row in `unresolved_terms`; the pipeline uses the raw form flagged `provisional` rather than blocking. TTS job orchestration through the provider abstraction: per-line batch synthesis, local ffprobe duration per line, `generation_jobs` rows with USD cost, artifacts downloaded to storage. Standalone Guaraní TTS route (API-level; UI in sonnet-2). A/B harness: same script + voice across multiple `engine` values, logged as separate jobs, writing per-engine `lexicon_pronunciations` rows as respellings get tuned.

### 5.3 opus-3-assembly
Compositing only — no generative visuals. Worker process (per §1 render-environment decision) that assembles per-line narration + **existing listing photos** (Ken Burns pan/zoom via ffmpeg) + burned-in captions (from `display_text`, timed by per-line offsets) into a finished 9:16 video. Output uploaded to storage, `videos` row with `final_video_url` and USD cost rollup summed from all `generation_jobs` involved. This is the sellable MVP deliverable: photos + Guaraní narration + captions, at near-zero marginal credit cost beyond TTS.

### 5.4 opus-4-visuals
Generative visuals slotting into the same assembly: image/clip generation through the provider abstraction (`SceneSpec` → adapter-rendered prompts, aspect passed explicitly), jobs logged and downloaded like everything else. Generated clips become optional b-roll segments in the opus-3 assembly pipeline; a video must still be producible with photos only.

## 6. Sonnet phases

**Hard limits for every Sonnet phase**: no schema changes, no changes to the provider-abstraction interface or adapters, no auth changes, no changes to the render worker. All data access goes through the query/service layer Opus phases built. A UI need that seems to require a schema change goes to `KNOWN-ISSUES.md` and Backlog, not a direct migration.

### 6.1 sonnet-1-admin-dashboard
Listing entry/import form, script review/edit screen (edit `speech_text` per line, promote `unresolved_terms` into the lexicon with per-engine pronunciation rows), voice+engine picker wired to the A/B harness from opus-2 (play sample audio per engine side by side).

### 6.2 sonnet-2-review-delivery
Job status monitoring view (`generation_jobs` across kinds), finished video preview/download, and a page for the standalone Guaraní TTS route from opus-2 (admin-gated by default; public is Anton's call at build time).

### 6.3 sonnet-3-deploy
Deploy the web app to Hostinger per `nextjs-deploy-hostinger` (worker stays local per §1). Cost dashboard summing `generation_jobs.cost_usd` by day/project. Nightly lexicon backup: dump `jopara_lexicon` + `lexicon_pronunciations` to object storage (one cron line — the lexicon is the compounding IP and must never exist only in one DB).

## 7. Human-inputs checklist

- Higgsfield API/MCP credentials available to build sessions — needed from opus-1.
- S3-compatible bucket (e.g. Cloudflare R2) + credentials — needed at opus-1 (graceful degradation if late, but outputs are at risk of provider-URL expiry until wired).
- Voice talent decision + **written commercial-use/cloning consent**, then studio recordings (kept in our storage) and one manual clone in Higgsfield — needed before opus-2 can generate real narration; opus-2 builds and tests against a stock voice_id in the meantime.
- A named fluent/native Guaraní speaker for periodic pronunciation review sessions — needed from opus-2 on; without them `verified` is decoration.
- A handful of real listing records (from propia or manually entered) as realistic test input from opus-1 onward.
- Hostinger Node app slot + domain — needed at sonnet-3.
- Machine that runs the render worker (Anton's machine by default) with ffmpeg installed — needed at opus-3.

## 8. Open business questions (parked, not build work — except the first, which has a date)

- **Validation track (parallel, non-build, deadline: before opus-2 merges)**: make 2–3 listing videos semi-manually (Higgsfield web app + manual edit), show them to 3 real agents, ask for a price commitment. One enthusiastic agent changes nothing; three shrugs stop the build after opus-1. This is the project's only non-technical kill-switch — do not let it slip.
- Pricing model if/when this becomes a paid service — anchored first on: what is a listing video worth in Gs to a PY agent (vs. what a local videographer charges), against the known `cost_usd` per finished video.
- **Higgsfield ToS check** (before the first invoice, not the first line of code): commercial resale of generated audio/video, and wrapping their API as a paid service.
- Whether this becomes a propia.com.py feature, a standalone resold service for other Paraguay agencies, or both.
- Whether the standalone Guaraní speech **pipeline** (lexicon + verbalization + voice assets — not "a TTS engine"; the synthesis itself is always some provider's service under their ToS) gets licensed separately, and to whom.
- Provider swap timing — what would trigger adding a second adapter (cost, quality, Higgsfield reliability).

## 9. Build log & handoff

(empty — first entry gets appended by opus-1 before its PR merges)

## 10. Backlog

- Multi-tenant accounts / client self-serve portal.
- Billing and pricing UI.
- Batch CSV import of many listings at once.
- Direct propia.com.py integration (auto-generate a video for every new listing).
- Additional languages/voices beyond ES/GN.
- Self-service voice cloning inside the app (the Higgsfield MCP exposes `create_voice`, so this is UI work, not blocked on providers).
- Second provider adapter (Runway/ElevenLabs direct) — architecture supports it from day one; ElevenLabs' char-level timestamps could later replace per-line synthesis where beneficial.
- Per-video shareable link with view metrics (the outcome-measurement story for renewals).
- 16:9 secondary renders per video.

## 11. Problems, solutions, and business opportunities (context — not build instructions)

**Problems and their solutions** (also reflected in §1–§3 above):

1. *Guaraní orthography breaks Spanish-tuned TTS* (glottal stop, /ɨ/, nasal vowels, final-syllable stress) → dual-string model (`display_text` vs `speech_text`) + persistent lexicon with **per-engine** pronunciations, in the schema from commit one. Known alternatives, recorded so future-us knows why they lost: SSML `<phoneme>`/IPA is the industry-standard fix but isn't exposed through the Higgsfield MCP (the optional `ipa` column keeps that door open for SSML-capable providers); Meta MMS-TTS has an actual Guaraní model — likely below a cloned commercial voice in quality, but the only true-Guaraní baseline, worth one A/B row as benchmark/fallback.
2. *Voice cloning kept manual* → deliberate scope choice (cloning IS exposed via MCP); runbook step; original recordings are the portable asset; written talent consent before recording.
3. *Provider lock-in* → abstraction interfaces (§2) for code; immediate download-to-own-storage, adapter-owned prompts, USD cost normalization, and owned voice recordings for the assets — because the assets, not the code, are the real lock-in.
4. *Whisper mis-transcribes Guaraní / no provider timestamps* → never transcribe; per-line synthesis + local ffprobe measurement makes caption timing true by construction.
5. *Script hallucination* → script generation is a template filled strictly from `listings` fields; numbers/prices/units go through an explicit verbalization step.
6. *Silent mispronunciation drift* → `unresolved_terms` queue with a specified detection rule (§5.2) makes gaps visible instead of shipping a bad video silently.
7. *Confidently wrong Guaraní is a brand risk* — worse than no Guaraní, for a product whose whole pitch is authenticity → native-speaker verification loop (§7) with audio evidence per verified (term, engine); this is the moat's maintenance cost, not overhead.
8. *Cost blindness* → raw + USD cost per provider call from day one; margin per finished video is a computed number before any pricing talk.
9. *Platform risk (Higgsfield)* — ToS on resale, credit repricing, MCP API churn, account loss = losing the cloned voice → §8 ToS check; own storage; own recordings; USD normalization; abstraction layer.
10. *Listing-photo rights* — agents often don't own the photos they post → service agreement template must include a client warranty that they hold rights to supplied media (legal boilerplate, not code).
11. *Background music* — the Higgsfield MCP cannot generate standalone music (its music model is game-pipeline-only) → ship narration-only first; if music is wanted, it comes from a licensed library (pick + budget then).
12. *Lexicon loss* — the compounding IP backed up nightly to object storage (sonnet-3).

**Business opportunities** (why this is worth building beyond a one-off tool):

- **propia.com.py**: once proven, every listing can ship with an autoplay bilingual video — a differentiator no other Paraguay listings site has. Deferred on purpose so the pipeline is proven standalone first.
- **Resell to other agencies/agents**: "we make your listing videos, in Guaraní, for X per video" — the ops-tool shape means Anton sells this as a manual service long before self-serve SaaS is justified. From video #1, keep a manual log of "video → inquiries the agent reports": that log is the sales collateral for this motion.
- **Content-service delivery for existing local-business clients** (paraguay-local-site / gbp-optimizer clients): the `projects` root (§2) means a `content_item` kind reuses everything without migration. Honest caveat: the sales motion differs — agents buy "sell this house faster", a dentista buys brand presence — so pricing and pitch do NOT transfer automatically.
- **Standalone Guaraní speech pipeline as a licensable capability**: dubbing, accessibility, education, IVR, government communications. What we own and could license is the lexicon + verbalization + voice assets + eval data — not the underlying synthesis engine. Not a build target now (§8), but §3.5 is deliberately generic so this stays open.
- **Defensibility**: the jopara lexicon with per-engine, human-verified pronunciations, built over real usage, is a compounding asset a competitor must rebuild from zero. Treated as IP: backed up, exportable, never provider-hosted.
