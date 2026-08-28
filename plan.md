# Guaraní — AI Video Engine for Real Estate Listings

Incorporates the advisor review in `plan-review.md` (Fable pass, 2026-08-28) — that
file stays in the repo as the record of what changed and why; this file is the current
source of truth for building.

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

All seven prompt files exist. Start with `prompts/opus-1-foundation.md` in a fresh Opus
session; each phase hands off to the next automatically per §4/§9 once its PR is merged.

## 1. Decisions already made (locked — do not re-litigate without explicit new instruction)

- **Shape**: internal ops tool Anton operates himself for now, not multi-tenant SaaS and not a propia.com.py feature yet. Reuses propia's listing shape as input where convenient but ships as its own app in its own repo (`antonmarklundcom/guarani`).
- **Vertical scope**: real estate listing videos only, Paraguay market, Spanish + Guaraní bilingual. Not a general-purpose video editor.
- **Guaraní voice**: first-class deliverable, not a bolt-on. Both (a) full listing videos with Guaraní narration and (b) a standalone "type text, get Guaraní speech" capability are in scope for the same build — the standalone TTS route is a thin exposure of the same script/voice pipeline the video feature needs, not a second product.
- **Provider strategy**: Higgsfield MCP is the first AI provider (video, TTS, image), but it is explicitly NOT the permanent choice. The system is built against a provider-abstraction interface from day one so Runway, ElevenLabs, or anything else can be swapped in as a second adapter later without touching schema, script logic, or the assembly layer. This is a hard architectural requirement, not a nice-to-have. See §2 for the corrected interface shape — the first draft of this interface baked in Higgsfield's async-job model and would NOT have made a swap cheap; do not resurrect the `{jobId, poll()}` shape.
- **Monetization**: parked, but validation is not (see §8) — a real price commitment from real agents is required before opus-2 is considered complete, independent of the technical build.
- **Voice cloning**: kept out of the automated pipeline as a deliberate scope decision, not because it's technically unavailable — the Higgsfield MCP does expose `create_voice` and `create_voice_from_confirmed_audio`. The pipeline only ever consumes an existing `voice_id`; cloning happens as a scripted (MCP-callable) but manually-triggered runbook step, one voice at a time.
- **Render environment**: the web app (Hostinger) stores metadata, listings, scripts, and job records, and triggers generation — it does not run ffmpeg. Video compositing (opus-3) runs as a local worker process (Anton's machine, or a small always-on worker later) against the same database and object storage. This is locked now because it shapes the job-orchestrator design in opus-1, and Sonnet phases are forbidden from changing it.
- **Storage**: an S3-compatible bucket (e.g. Cloudflare R2) is provisioned from opus-1, not deferred to deploy. Every completed provider generation is downloaded into it immediately — Higgsfield-hosted output URLs are not treated as durable.
- **Voice ownership**: whichever human voice is cloned, written consent (commercial use, resale to third parties, cloning, territory, compensation) must exist before real narration is produced in opus-2. The original studio recordings of that voice are the actually-portable asset — they are kept in Anton's own storage, versioned, independent of Higgsfield. A provider swap means re-cloning from those recordings, not starting over.

## 2. Roles & object model

**Roles**: single `admin` role for MVP (Anton only). No client/agent login, no auth complexity beyond a basic login gate on the dashboard. Role enum still modeled in the DB (`admin`) so adding `agent`/`client` later is additive, not a migration rewrite.

**Core objects** — rooted on a generic `projects` table so the real-estate build doesn't have to be re-plumbed later for other content types (see §11 content-service opportunity):

- `projects` — `id`, `kind` (`listing`, more added later — never widened by a Sonnet phase), `title`, `status`. The thing everything else hangs off.
- `listings` — typed detail table, `project_id` FK. Address, price, currency, rooms, bathrooms, area_m2, features (JSON). Source of truth for facts a script may state; nothing else may.
- `scripts` — `project_id` FK + language (`es`/`gn`). Lines, each with `display_text` (proper orthography, for captions/UI) and `speech_text` (the respelled form actually sent to TTS). Never merge these into one field. Each line also carries a `synth_audio_url` and measured `duration_ms` once synthesized (see §3).
- `jopara_lexicon` — `term`, `language`, `ipa` (optional — cheap to capture now, makes speech-forms derivable later for any provider that supports SSML/phoneme input instead of hand-tuned respellings), stress/notes.
- `lexicon_pronunciations` — child table: `term_id`, `engine` (`default` as fallback, or a specific engine name), `speech_form`, `verified` (bool), `verified_by`, `sample_audio_url`. **Respellings are engine-specific** — a respelling tuned for one TTS engine will not necessarily be read correctly by another, so a single `speech_form` column on the lexicon itself would silently break the moment the A/B harness compares engines. `verified` means a named person listened to `sample_audio_url` and approved it, not a checkbox with no accountability.
- `unresolved_terms` — auto-populated when script generation hits a token that doesn't resolve (see §5.2 for the exact detection rule); queue for review/promotion into the lexicon. The pipeline uses the raw form with a `provisional` flag rather than blocking on it.
- `voices` — `provider`, `provider_voice_id`, `provider_params` (JSON — holds the full provider-specific addressing tuple, e.g. Higgsfield needs `model` + `variant` + `voice_type` + `voice_id` together, not just one string), `engine` enum including `seed_audio` (Higgsfield's default TTS model, distinct from the `text2speech_v2` variants), `language`, `label`, `sample_url`.
- `generation_jobs` — polymorphic job log: `kind` (tts/video/image), `provider`, `provider_job_id`, `status`, `input_ref`, `output_url` (your own storage, post-download — see §1), `cost_raw_amount`, `cost_raw_unit` (provider credits, whatever unit), `cost_usd` (via a small `provider_rates` lookup table — pricing decisions in §8 need USD, not provider credits, which vary by plan). Every provider call goes through this table before it happens.
- `provider_rates` — `provider`, `unit`, `usd_per_unit`, `effective_date`. Small table, keeps `cost_usd` a real derived number instead of a guess.
- `videos` — `project_id` FK, `language`, `voice_id`, `script_id`, `status`, `final_video_url`, `aspect_ratio` (`9:16` default, `16:9` secondary — see §3), cost rollup in USD.

**Provider abstraction** (the load-bearing piece of §1's provider-strategy decision — corrected shape, do not regress to the async-job draft):

```
interface TTSProvider   { synthesize(req: TTSRequest): Promise<TTSResult> }
interface VideoProvider { generateClip(spec: SceneSpec): Promise<ClipResult> }
interface ImageProvider { generate(spec: ImageSpec): Promise<ImageResult> }

TTSResult  { audioUrl, durationMs, timing: {granularity: 'none'|'total'|'word'|'char', marks?},
             rawCost: {provider, units, amount}, costUsd }
SceneSpec  { shotType, subject, mood, durationMs, aspectRatio }   // declarative, no raw
                                                                    // provider-idiom prompt text —
                                                                    // the adapter owns rendering
                                                                    // SceneSpec into its own prompt
                                                                    // template, not the caller
```

Interfaces return a normalized *result* — polling/waiting against the underlying provider (Higgsfield's tool-call + `jobs_wait`, or a synchronous API like ElevenLabs direct) is the adapter's private business and must never leak into the interface shape. `HiggsfieldAdapter` implements all three now, using the Higgsfield MCP tools directly. A `MockProvider` implementing all three interfaces (canned fixtures, fake durations, zero cost) ships alongside it in opus-1 — one real adapter can never validate that an abstraction is actually swappable; the mock is the cheap "second adapter" that keeps it honest and lets every later phase's tests run without burning credits.

All application code (script pipeline, job orchestrator, assembly layer) talks to the interfaces, never to `mcp__higgsfield_ai__*` tools directly outside the adapter file. Enforce this in code review during every phase, Opus and Sonnet alike.

## 3. Feature scope

**Core (must ship in this build)**:
1. Structured-data-driven script generation (listing fields → per-line `display_text`/`speech_text` pairs, ES + GN), with hard guardrails against inventing facts not present in `listings`. Numbers, prices, and units (`Gs. 850.000.000`, `120 m²`) always go through an explicit verbalization step per language — this is the single most common TTS failure mode in real-estate scripts and is not optional polish.
2. Jopara lexicon + per-engine pronunciations + unresolved-terms queue (§2) — ships in phase 1, used from phase 1 on, never retrofitted.
3. TTS pipeline: **one audio clip per script line**, not one clip for a whole script — this is what makes caption timing exact by construction instead of dependent on a provider returning word-level timestamps (most don't). Duration is measured locally (ffprobe) on the downloaded audio, never trusted from provider metadata. Cost logged in both raw provider units and USD.
4. Video assembly: combine per-line narration + property photos/clips into a finished listing video with burned-in captions, using `display_text` and the locally-measured per-line durations/offsets. No transcription anywhere in this pipeline.
5. **Delivery spec**: default output is 9:16 vertical (Higgsfield's default is 16:9 unless requested otherwise — this must be explicit), captions legible on mute autoplay, file size targeted for WhatsApp forwarding (roughly under 16MB for a typical listing-video length). 16:9 is a secondary render option, not the default. Paraguayan agents distribute on WhatsApp and Instagram, not embedded 16:9 players.
6. Standalone Guaraní TTS route: paste/select text → speech_text lookup or manual override → audio out. Same per-line pipeline as #3, exposed directly.
7. Admin dashboard: import/enter a listing, generate/edit a script, review/promote unresolved lexicon terms, pick voice+engine, trigger generation, review job status, preview/download the finished video.
8. Diagnostics run before any of the above is trusted: `voices list --json` and `generate cost` (or MCP equivalents) captured in the build log — and see §5.1 for the harder go/no-go test this alone doesn't cover.
9. No background music generation is available through Higgsfield's MCP (its music model is restricted to a different pipeline) — ship narration-only, or budget a licensed music library as a separate line item. Do not assume generated music is available.

**Deferred to Backlog (§10)**: multi-tenant accounts, self-serve client portal, billing/pricing UI, batch CSV import of many listings at once, propia.com.py auto-sync, additional languages beyond ES/GN, self-service voice cloning in-app (the MCP tools exist — see §1 — so this is genuinely closer than the earlier draft assumed, but still not in this build's scope).

## 4. Autonomy protocol

(Standard phased-autonomous-build protocol — see skill for full text. Key points every phase must follow: work to exit criteria without asking permission for in-plan work; one PR per phase, branch `phase/<id>` off latest main, merge when green; log minor issues to `KNOWN-ISSUES.md` and keep going; stop and ask ONLY for a missing credential with no fallback or a foundational schema/architecture decision that would force a rewrite if guessed wrong; missing env values degrade gracefully, never block; every phase prompt is re-runnable from the first unmet exit criterion; Sonnet phases never touch schema, auth, the provider-abstraction interfaces, or the render-environment decision in §1 — workaround + Backlog note instead; Fable is never used for build phases or spawned sessions, only for the human-driven planning conversation Anton runs himself; hand off between phases only after PR merged green + exit checklist passed + a pre-handoff adversarial re-read of the merged diff + a build-log entry committed, then spawn the next phase as a fresh session via `create_session` with the right model.)

## 5. Opus phases

### 5.1 opus-1-foundation
Full DB schema for every table in §2 (yes, all of them, even though later phases use most — including `projects` as the root, not `listings`). Provider-abstraction interfaces (the corrected, result-returning shape in §2 — not the async-job draft) + `HiggsfieldAdapter` + `MockProvider`. Provision the S3-compatible storage bucket and wire immediate download-on-completion for every `generation_jobs` row (§1) — this is foundational, not a deploy-time detail. Run and record the diagnostics (`voices list --json`, `generate cost`) into the build log.

**Go/no-go exit gate, before this phase is considered done**: synthesize 2–3 real Guaraní/jopara sentences across the candidate engines (a few credits) using hand-written test respellings, download and store the audio, and log listening notes in the build log — this is the actual bet the product rests on, and it must be tested before building the rest of the pipeline on top of it, not after. If nothing is acceptable even with lexicon hacking, stop and report to Anton before opus-2 starts; this is exactly the kind of foundational finding the autonomy protocol's stop-and-ask clause exists for.

Seed `jopara_lexicon` + `lexicon_pronunciations` with an initial hand-picked set of common real-estate terms (calle, avenida, dormitorio, baño, garaje, etc.) so phase 2 has something to test against.

### 5.2 opus-2-script-voice
Script generation service: `listings` row → `scripts` rows (ES and GN, per line), populating `display_text`/`speech_text` via the lexicon and flagging unknowns to `unresolved_terms`. **Unresolved-term detection rule** (write this into the tokenizer, don't leave it to be invented ad hoc): tokenize with longest-match against `lexicon_pronunciations` (multi-word terms like "Barrio San Vicente" must match as one unit before falling back to word-level); maintain an explicit Spanish-passthrough allowlist for words that don't need respelling; anything that doesn't longest-match the lexicon and isn't on the passthrough allowlist goes to `unresolved_terms` with a `provisional` flag, never blocks generation. Numerals, prices, and units always route through a numbers-to-words verbalizer per language before lexicon lookup.

Per-line TTS job orchestration through the provider abstraction (one clip per line, per §3; measure duration locally; store `generation_jobs` row; attach resulting audio to the script line). Standalone Guaraní TTS route (API-level; UI comes in sonnet-2). A/B harness: same line + voice_id across multiple `engine` values, writing/reading per-engine rows in `lexicon_pronunciations` — this only works because that table is per-engine already (§2 Edit D1), do not collapse it back to one column.

### 5.3 opus-3-assembly
Video compositing only — no generative visuals in this phase (that's opus-4; a phase needing two sessions was two phases). Given per-line narration audio + a listing's existing photos, produce a finished video: Ken Burns-style pans/zooms over the photos via ffmpeg, narration track assembled from the per-line clips at their measured offsets, burned-in captions from `display_text` timed to those exact offsets, output at 9:16 (default) with a 16:9 option, sized for WhatsApp delivery (§3). Runs as the local worker process decided in §1. This alone is a sellable MVP deliverable — photos-plus-Guaraní-narration — at near-zero marginal generative cost, before any generative video spend.

### 5.4 opus-4-visuals
Generative image/clip orchestration through the provider abstraction (`SceneSpec` → `ImageProvider`/`VideoProvider`), producing additional b-roll/visual assets that slot into the same opus-3 assembly pipeline as an alternative or supplement to plain listing photos. `SceneSpec` stays declarative (§2) — the Higgsfield-specific prompt phrasing lives entirely inside `HiggsfieldAdapter`, never in calling code.

## 6. Sonnet phases

**Hard limits for every Sonnet phase**: no schema changes, no changes to the provider-abstraction interfaces or adapters, no auth changes, no changes to the render-environment decision (§1 — the local-worker/ffmpeg split is fixed). All data access goes through the query/service layer Opus phases built. A UI need that seems to require a schema change goes to `KNOWN-ISSUES.md` and Backlog, not a direct migration.

### 6.1 sonnet-1-admin-dashboard
Listing entry/import form, script review/edit screen (edit `speech_text` per line, promote `unresolved_terms` into the lexicon), voice+engine picker wired to the A/B harness from opus-2.

### 6.2 sonnet-2-review-delivery
Job status monitoring view (`generation_jobs` across kinds), finished video preview/download, and a public-facing (or admin-gated, Anton's call at build time — default gated) page for the standalone Guaraní TTS route from opus-2.

### 6.3 sonnet-3-deploy
Deploy to Hostinger per `nextjs-deploy-hostinger`. Storage is already wired in opus-1 (§1/§5.1) — this phase does not touch it. Basic cost dashboard summing `generation_jobs.cost_usd` by day/project. Document how the Hostinger-hosted app and the local ffmpeg worker (§1) talk to each other (shared DB + storage, polling or a simple trigger) — this is documentation/wiring of an already-locked decision, not a new architecture choice.

## 7. Human-inputs checklist

- Higgsfield API/MCP credentials — needed from opus-1.
- S3-compatible storage bucket + credentials — needed from **opus-1** (moved up from a deploy-time detail; see §1).
- At least one voice cloned manually in the Higgsfield app/MCP, **with written consent on file** covering commercial use, resale, cloning, and territory — needed before opus-2 produces real (non-test) narration. Opus-2 can build and test against a stock/non-cloned voice_id in the meantime.
- A named fluent/native Guaraní speaker available for periodic review sessions (paid or partner) — needed from opus-2, to make `lexicon_pronunciations.verified` mean something rather than being a decorative checkbox.
- A machine/environment to run the ffmpeg worker (§1) — needed by opus-3.
- Hostinger Node app slot + domain — needed at sonnet-3.
- A handful of real listing records (from propia or manually entered), with confirmed rights to use the associated photos — needed from opus-1 onward.

## 8. Open business questions (parked, not build work)

- **Validation, on a deadline, running in parallel with the build** — this is not fully parked: make 2–3 listing videos semi-manually (Higgsfield web app + manual editing) and show them to 3 real Paraguay agents, asking for an actual price commitment, before opus-2 is considered complete. Three shrugs is a signal to stop the technical build and rethink, not push through; the plan otherwise has no non-technical kill-switch.
- Pricing anchor: not "credits vs. subscription" as a first question, but what a listing video is actually worth in Gs to an agent whose marketing budget is often near zero and whose commission depends on the sale — the honest starting hypothesis is that per-video pricing must undercut a local videographer by a lot, with margin coming from volume and speed rather than markup. `cost_usd` per finished video (from opus-3 onward) makes this decision-ready instead of a guess.
- Check Higgsfield's ToS on commercial resale of generated audio/video and on wrapping their API as a paid service — required before the first invoice is sent, not before the first line of code.
- Whether this becomes a propia.com.py feature, a standalone resold service for other Paraguay agencies, or both.
- Whether the standalone Guaraní TTS capability gets marketed separately, and to whom — see §11's reframing of what's actually licensable here.
- Provider swap timing — when (if ever) to add a second adapter (Runway, ElevenLabs direct, Meta MMS-TTS) and what would trigger that decision (cost, quality, Higgsfield reliability/ToS).

## 9. Build log & handoff

**2026-08-28 — plan.md v2, post-advisor-review.** Fable ran a technical + business advisor pass (verified against live Higgsfield MCP tool schemas, not assumed) and found the original provider-abstraction interface baked in Higgsfield's async-job model (would not have made a swap cheap), the caption-timing plan relied on provider metadata that doesn't exist, respellings needed to be per-engine not global, the object model needed a generic root for later content-service reuse, opus-3 was really two phases, storage/render-environment decisions needed to move earlier, and several business/legal items (voice-talent consent, native-speaker QA, Higgsfield ToS on resale, photo rights) were missing entirely. Full detail in `plan-review.md` (kept in repo as the record). All edits folded into this version: §1 render-environment + storage + voice-rights decisions added; §2 rewritten (interfaces, `projects` root, `lexicon_pronunciations`, `provider_params`, USD cost columns); §3 per-line TTS + delivery spec + number verbalization; §5 split into opus-1/2/3/4 with opus-1 gaining a go/no-go Guaraní-quality exit gate and opus-3 split from a combined "assembly+visuals" into opus-3-assembly and opus-4-visuals; §7/§8 gained the human items and the validation-with-a-deadline track. No build phases have started. Next: write `prompts/opus-1-foundation.md` (Stage 3) and start opus-1.

## 10. Backlog

- Multi-tenant accounts / client self-serve portal.
- Billing and pricing UI.
- Batch CSV import of many listings at once.
- Direct propia.com.py integration (auto-generate a video for every new listing).
- Additional languages/voices beyond ES/GN.
- Self-service voice cloning inside the app — technically closer than first assumed (the MCP exposes it), but still deferred until the manual runbook step is proven out.
- Second provider adapter (Runway/ElevenLabs direct/Meta MMS-TTS) — architecture supports it from day one, but do not build it until there's a concrete reason to swap.

## 11. Problems, solutions, and business opportunities (context for future planning — not build instructions)

**Problems and their solutions**:

1. *Guaraní orthography breaks Spanish-tuned TTS* → dual-string data model (`display_text`/`speech_text`) plus a persistent, **per-engine** `lexicon_pronunciations` table (a single global respelling doesn't survive A/B-testing multiple engines). The industry-standard fix, SSML `<phoneme>`/IPA input, isn't usable through Higgsfield's MCP today (no SSML support surfaced) though ElevenLabs partially supports pronunciation dictionaries — an optional `ipa` column is captured now so speech-forms are derivable later instead of hand-re-authored per provider. Meta's MMS-TTS has an actual Guaraní (`grn`) model, worth one A/B row as a true-Guaraní baseline/fallback even though quality likely trails a cloned commercial voice. Guaraní defaults to final-syllable stress where Spanish engines default to the penult — respelling/lexicon notes must encode stress, not just phonetic segments.
2. *Voice cloning* → not a provider limitation (the MCP exposes `create_voice`/`create_voice_from_confirmed_audio`); a deliberate scope decision to keep it a manual, scriptable runbook step outside the automated pipeline.
3. *Provider lock-in* → the corrected provider-abstraction interface (§2) handles the code-level swap, but the real lock-in is assets, not code: the cloned voice lives in the provider's account (mitigated by owning the original recordings), output URLs expire (mitigated by immediate download to owned storage from opus-1), prompts are model-tuned (mitigated by keeping `SceneSpec` declarative and prompt-rendering inside the adapter), and cost units are provider credits (mitigated by normalizing to `cost_usd`).
4. *Whisper mis-transcribes Guaraní* → never transcribe; captions and timing come from per-line synthesis with locally-measured (ffprobe) durations, which is also a more portable contract across providers than depending on any one provider's timestamp metadata (most don't return word-level timing at all).
5. *Script hallucination* → script generation is a template filled strictly from `listings` fields, never a free-text LLM prompt.
6. *Number/price/unit verbalization* ("Gs. 850.000.000", "120 m²") — the highest-frequency real-estate TTS failure mode, and easy to overlook — solved by an explicit verbalization step per language before lexicon lookup (§3, §5.2).
7. *Silent mispronunciation drift* → `unresolved_terms` queue with a defined detection rule (longest-match tokenization + passthrough allowlist, §5.2) makes gaps visible and fixable instead of shipping a bad video silently.
8. *Verification without a verifier* → `verified` on a pronunciation means a named, ideally native, Guaraní speaker listened to the stored sample and approved it — not an unaccountable checkbox. Confidently mispronounced Guaraní from a product whose entire pitch is Guaraní authenticity is worse than shipping no Guaraní at all; native QA is moat maintenance, not overhead.
9. *Voice-talent rights* — the whole product's differentiator rests on one cloned voice with no consent framework mentioned until this review. Written consent (commercial use, resale, cloning, territory, compensation) is required before real narration ships; if the voice is Anton's own, that's a concentration risk worth naming (one voice = the product's identity).
10. *Listing-photo rights* — agents frequently don't own the photos they hand over. Needs a client-facing warranty clause (they confirm rights to supplied media), not a code fix.
11. *Platform risk* — Higgsfield's ToS on resale, credit pricing changes, MCP API churn, output-URL expiry, or account suspension could all threaten the cloned voice or the service itself; mitigated by owning recordings and storage independently (§1) and by checking resale ToS before the first invoice (§8).
12. *No generated background music* — Higgsfield's music generation is restricted to a different pipeline; ship narration-only or budget a licensed library explicitly, don't assume it's available.
13. *Lexicon has no backup* — it's named as compounding IP in this very section; back it up (a nightly dump of `jopara_lexicon` + `lexicon_pronunciations` to storage is a one-line cron job, not a project).
14. *No outcome measurement* — from video #1, keep a manual log of "video → inquiries the agent reports" even before any analytics build; it's the actual sales collateral for the resell opportunity below.
15. *Cost blindness* → every provider call logs cost in both raw units and USD (§2) from day one, so §8's pricing questions are answered from real data.

**Business opportunities**:

- **propia.com.py**: once proven, every listing can ship with an autoplay bilingual video — a differentiator no other Paraguay listings site has. Deferred to Backlog on purpose so the pipeline is proven standalone first.
- **Resell to other agencies/agents**: the ops-tool shape in §1 means Anton can sell this as a manual service (do the work himself via the dashboard) long before any self-serve SaaS work is justified — but note the honest pricing anchor in §8: undercut a local videographer, margin from volume and speed, not markup.
- **Content-service delivery for existing local-business clients** (paraguay-local-site / gbp-optimizer clients): the same script + voice + assembly pipeline is not real-estate-specific at the schema level once rooted on `projects` (§2) rather than `listings`. A parallel project `kind` (Backlog-tier, not now) could reuse everything here for short vertical ads with Guaraní voiceover for the rural/interior-Paraguay-facing local businesses Anton already serves. One caveat: the *sales motion* differs — agents buy "sell this house faster," a dentista buys brand presence — so this is a reuse of the pipeline, not a transfer of the real-estate pricing model.
- **Guaraní speech pipeline as a licensable capability** — reframed from the original draft: what's actually ownable and licensable is not "a Guaraní TTS engine" (the synthesis runs on Higgsfield's or another vendor's service, under their ToS, and the cloned voice lives in their account) but the *pipeline*: the lexicon, the verbalization rules, the owned voice recordings, and the eval/QA data built on top of whichever engine. That framing survives a provider swap; "we have a Guaraní TTS" does not.
- **Defensibility**: the jopara-lexicon (and its per-engine pronunciation data, and the native-QA process behind it) is a compounding, backed-up asset — a competitor starting today has to rebuild all three from zero.
