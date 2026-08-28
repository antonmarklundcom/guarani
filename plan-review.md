# plan.md review — technical + business advisor pass (2026-08-28)

Concrete edits keyed to plan.md sections. Facts marked **[verified]** were checked
against the live Higgsfield MCP tool schemas in this session, not assumed.

---

## 1. Architecture: the provider abstraction as written will NOT make a swap cheap

The rule ("nothing outside the adapter calls `mcp__higgsfield__*`") is right and worth
keeping. The interfaces themselves have four problems.

### Edit A1 — §2: fix the interface shape (async-job model is a Higgsfield-ism)

`synthesize(text, voiceId, engine) -> {jobId, poll()}` bakes the async-job/poll model
into the interface. ElevenLabs' direct TTS API is synchronous (bytes back in one call);
Higgsfield MCP is tool-call + `jobs_wait`. If the interface exposes `jobId`/`poll()`,
every caller is coupled to the job model and a sync provider needs a fake job shim.

Replace with: interfaces return a normalized result; polling/waiting is the adapter's
private business.

```
interface TTSProvider  { synthesize(req: TTSRequest): Promise<TTSResult> }
interface VideoProvider { generateClip(spec: SceneSpec): Promise<ClipResult> }
interface ImageProvider { generate(spec: ImageSpec): Promise<ImageResult> }

TTSResult { audioUrl, durationMs, timing: {granularity:'none'|'total'|'word'|'char', marks?},
            rawCost: {provider, units, amount}, costUsd }
```

Define these result/request types in opus-1 alongside the interfaces — the result types
ARE the abstraction; the method signatures are trivia.

### Edit A2 — §2: `engine` as a top-level param leaks Higgsfield's model taxonomy

**[verified]** Higgsfield TTS actually needs up to four fields: `model`
(`seed_audio` — their default — or `text2speech_v2`), `variant`
(elevenlabs|minimax|seed_speech|vibe_voice|cozy_voice, only for text2speech_v2),
`voice_type` (`preset`|`element`), and `voice_id`. Your planned
`synthesize(text, voiceId, engine)` cannot express that, and your `voices.engine` enum
is missing `seed_audio` entirely.

Edit: the interface takes your internal `voices.id`; the adapter resolves everything
provider-specific. Add `voices.provider_params` (JSON) to hold the full addressing tuple
per provider, and add `seed_audio` to the engine enum.

### Edit A3 — §3.4 + §5.3: the caption-timing plan rests on metadata that doesn't exist

**[verified]** Nothing in Higgsfield's audio tool returns word- or character-level
timestamps — at best you get an audio file whose total duration you can measure. "Captions
driven by known script timing from the provider's duration metadata" therefore cannot
place per-line captions if you synthesize a whole script as one clip. (ElevenLabs direct
does offer char-level timestamps — which means timing granularity is exactly the kind of
capability asymmetry that silently breaks a provider swap.)

Edit — make timing true by construction instead of by provider feature:
- Synthesize **one audio file per script line** (Higgsfield's `generate_audio_batch`
  takes 2–12 lines per call **[verified]**).
- Measure each line's duration locally (ffprobe) — never trust provider metadata for this.
- Concatenate with known offsets at assembly; captions inherit exact timing.

This also shrinks what you need from any TTS provider to "text in → one audio file out",
which is the weakest (most portable) possible contract. Update §11.4 to match.

### Edit A4 — the real lock-in is assets, not code. Name it and mitigate in-plan.

A second adapter being "just a new file" is only true for code. What actually locks you in:

1. **The cloned voice lives in Higgsfield's account** and is not exportable. Mitigation
   (add to §1 voice-cloning decision + §7): the portable asset is the *original studio
   recordings* of the voice talent. Keep them versioned in your own storage; a swap to
   ElevenLabs means re-cloning from the same recordings, not starting over.
2. **Output URLs are Higgsfield-hosted** and must be assumed expiring. Mitigation: every
   `generation_jobs` completion downloads the artifact to your own S3/R2 *immediately*,
   from opus-1 on. This kills the §7 idea of deferring storage to sonnet-3 (see Edit S4).
3. **Prompts are tuned per model.** A `sceneSpec` full of Higgsfield-idiom prompt text is
   not portable. Edit §2: `SceneSpec` is declarative (shot type, subject, mood, duration,
   aspect); the *adapter* owns the prompt template that renders it for its models.
4. **Cost units are provider credits.** Edit §2 `generation_jobs`: store
   `cost_raw_amount` + `cost_raw_unit` + `cost_usd` (via a small provider-rates table),
   not `cost_credits` alone. Credits-per-USD varies by plan and provider; §8 pricing
   decisions need USD.

### Edit A5 — §5.1: one adapter can never validate an abstraction

Add to opus-1: a `MockProvider` implementing all three interfaces (canned fixtures,
fake durations, zero cost), used by the test suite. It is the cheap "second adapter"
that keeps the interface honest from day one, and it lets every later phase run its
tests without burning credits.

### Edit A6 — §1 + §11.2: the "cloning isn't exposed via API" premise is factually wrong

**[verified]** The Higgsfield MCP exposes `create_voice`,
`create_voice_from_confirmed_audio`, and seed_audio voice-cloning from an uploaded
audio reference. Keeping cloning *out of the automated pipeline* is still the right
scope call, but rewrite the rationale: it's a deliberate scope decision, not a provider
limitation — and the manual runbook step can be a scripted MCP call, which also
unblocks the §10 "self-service cloning" backlog item earlier than the plan assumes.

---

## 2. Data model: dual-string + lexicon is sound, but incomplete in three specific ways

The `display_text`/`speech_text` split is a legitimate, well-known pattern (it is the
"verbalization + pronunciation dictionary" front-end every serious TTS system has).
Keep it. Three gaps:

### Edit D1 — §2 `jopara_lexicon`: respellings are ENGINE-specific, your schema says they aren't

Phonetic respelling works by exploiting how a specific engine reads Spanish-ish
orthography. A respelling that makes elevenlabs say *ykua* right will be read
differently by minimax or seed_speech. Yet the plan A/B-tests across 6 engines while
`speech_form` is a single column. This contradiction will surface in week one of opus-2.

Edit: child table `lexicon_pronunciations (term_id, engine, speech_form, verified,
verified_by, sample_audio_url)` with an engine value `'default'` as fallback. The A/B
harness then reads/writes per-engine rows naturally.

### Edit D2 — §2 + §7: `verified` is meaningless without a verifier

Who confirms a Guaraní pronunciation is right? If Anton is not a fluent Guaraní
speaker, the `verified` bool is decoration. Edits:
- §7 human-inputs: add "a named fluent/native Guaraní speaker available for periodic
  review sessions (paid or partner)" — needed from opus-2, not later.
- Verification = *listened to the rendered audio and approved it*: store
  `sample_audio_url` per verified (term, engine) pair (covered by D1's table).
- §11: add the brand-risk framing — confidently mispronounced Guaraní from a product
  whose whole pitch is Guaraní authenticity is worse than no Guaraní. Native QA is not
  overhead; it is the moat's maintenance cost.

### Edit D3 — §5.2: specify the unresolved-terms detection rule now, or opus-2 invents it

"A word not in the lexicon" needs: a tokenizer (multi-word terms — *Ñemby*, *Barrio
San Vicente* — need longest-match), casing rules, and a definition of "trivial
passthrough". Suggested rule to write into §5.2: any token in a GN/jopara script that
(a) doesn't longest-match a lexicon entry and (b) isn't on an explicit
Spanish-passthrough allowlist → `unresolved_terms`, and the pipeline uses the raw form
with a `provisional` flag rather than blocking. Also state that numerals, prices, and
areas ("120 m²") always go through a verbalization step (numbers-to-words per
language) — number reading is the most common TTS failure and the plan never mentions it.

### Edit D4 — §11.1: name the two better-known alternatives so future-you knows why they lost

- **SSML `<phoneme>` (IPA)**: the industry-standard fix. Not usable through Higgsfield's
  MCP (no SSML support surfaced), but ElevenLabs partially supports pronunciation
  dictionaries. Edit: store an optional `ipa` column on lexicon terms from day one —
  cheap now, and it makes speech_forms *derivable* for future SSML-capable providers
  instead of hand-re-authored.
- **Meta MMS-TTS has an actual Guaraní model** (`grn` family). Quality is likely below a
  cloned commercial voice, but it's the only true-Guaraní baseline that exists. Worth
  one A/B row as a benchmark, and a fallback if Spanish-engine hacking fails.
- Stress: Guaraní defaults to final-syllable stress; Spanish engines default penult.
  Respelling guidance must encode stress (accent marks), not just segments — put this
  in the lexicon-entry notes template.

### Edit D5 — §2: the model claims "shared table + typed detail tables" but is listings-rooted

§11 explicitly wants the same pipeline for non-real-estate `content_items` later, but
`scripts` and `videos` FK to `listings`. Cheap now, migration later. Edit: root on a
`projects` table (`id, kind ('listing'|...), title, status`); `listings` becomes the
typed detail table (`project_id` FK); `scripts`/`videos` FK to `projects`. One extra
table in opus-1, zero UI difference, and the §11 content-service reuse becomes additive.

---

## 3. Phase sequencing

### Edit S1 — §5.1: the project's kill-risk isn't tested until opus-2. Move it to opus-1's exit criteria.

The diagnostics in opus-1 (`voices list`, cost preflight) prove inventory and price —
not that any engine can say Guaraní acceptably. That's the bet the whole product rests
on. Edit opus-1 exit criteria: synthesize 2–3 real Guaraní/jopara sentences across the
candidate engines (a few credits), store the audio + a listening-notes table in the
build log. If nothing is acceptable-with-lexicon-hacking, you want to know before
building the pipeline, not after.

### Edit S2 — split opus-3; it's two phases wearing one id

Compositing (ffmpeg, caption burn-in, audio/visual sync) and generative-visual
orchestration are each a full session. Per the build method's own rule — a phase that
needs two sessions was two phases. Edit:
- **opus-3-assembly**: narration + *existing listing photos* (Ken Burns pans/zooms via
  ffmpeg) + burned captions → finished video. No generative visuals at all.
- **opus-4-visuals** (new): image/clip generation through the provider abstraction,
  slotting into the same assembly.

Bonus: after opus-3-assembly you already have a sellable deliverable at near-zero
marginal credit cost — photos-plus-Guaraní-narration is the MVP video; generative
b-roll is garnish.

### Edit S3 — §1/§2: decide the render environment now; it's foundational, not a sonnet-3 detail

Hostinger managed Node hosting will not reliably run ffmpeg compositing jobs
(CPU/time limits; see nextjs-deploy-hostinger constraints). For an ops tool this is
fine — renders can run on Anton's machine or a cheap worker — but the job orchestrator
design (queue polled by an external worker vs. in-process) depends on it, and Sonnet
phases are forbidden from touching that layer. Add to §1 as a locked decision:
"web app on Hostinger stores metadata and triggers; ffmpeg assembly runs as a local
worker process against the same DB/storage" (or whichever variant you pick — but pick
in §1, not in sonnet-3).

### Edit S4 — §7: object storage moves from sonnet-3 to opus-1

Follows from Edit A4.2: provider-hosted outputs are not durable, so downloading to R2
must exist the moment the first `generation_jobs` row completes. R2 bucket + creds are
an opus-1 human input. Sonnet-3 keeps only the cost dashboard and deploy.

### Edit S5 — §3/§5.3: the delivery spec (aspect ratio, WhatsApp) is missing and gates compositing

Paraguayan agents will distribute these on WhatsApp statuses/chats and Instagram, not
embed 16:9 players. **[verified]** Higgsfield's video default is 16:9 unless 9:16 is
passed explicitly. Edit §3.4: default output 9:16 vertical, captions legible on mute
autoplay, file size targeted for WhatsApp forwarding (~<16MB per video at typical
lengths); 16:9 as a secondary render option. Decide before opus-3 — it drives every
compositing choice.

Otherwise the ordering is right: schema+adapter → script/voice → assembly → UI →
delivery → deploy matches foundation-first, and the Sonnet hard limits are correct.

---

## 4. Business model — holes in the §8 parking

### Edit B1 — §8: "monetization parked" is fine; *validation* parked is not

As planned, first customer contact happens after ~6 merged phases. The ops-tool shape
means you can validate now with zero build: make 2–3 listing videos semi-manually
(Higgsfield web app + manual editing), show them to 3 real agents, ask for a price
commitment. Add to §8 as a **parallel non-build track with a date before opus-2
completes** — one enthusiastic agent changes nothing; three shrugs should stop the
build at opus-1. The plan currently has no kill-switch that isn't technical.

### Edit B2 — §8: add the pricing anchor question

Not "credits vs. subscription" — first: what is a listing video worth in Gs to a PY
agent whose marketing budget is often ~zero and whose commission arrives only on sale?
The likely honest answer is "per-video pricing must undercut what a local videographer
charges by a lot, and margin comes from volume + speed". `cost_usd` per finished video
(Edit A4.4) from opus-3 onward makes this a computed number, not a guess. Add that
sentence to §8 so the credits-vs-subscription debate happens against real margins.

### Edit B3 — §8 + §11: you cannot license "Guaraní TTS" — you don't own a TTS engine

The synthesis is Higgsfield's (or ElevenLabs') service under *their* ToS, and the
cloned voice lives in *their* account. What Anton owns is: the lexicon, the original
voice recordings, the eval data, and the pipeline. Edits:
- §11 "licensable capability": reframe as licensing *the Guaraní speech pipeline*
  (lexicon + verbalization + voice assets), delivered on top of whatever engine —
  not "a TTS".
- §8: add "check Higgsfield ToS for commercial resale of generated audio/video and for
  wrapping their API as a paid service" as a question that must be answered before the
  first invoice, not before the first line of code.

### Edit B4 — §7 + §11: voice talent rights are the whole moat and appear nowhere

Whose voice is being cloned? The core differentiator rests on it. Before any
recording: written consent covering commercial use, resale to third parties, cloning,
and territory — plus agreed compensation (flat vs. per-use). If the voice is Anton's
own, note that instead (and note the concentration risk: one voice = the product's
identity). Add to §7 human-inputs (needed before opus-2 real narration) and to §11
problems.

### Edit B5 — §11 content-service upsell: honest one-line caveat

The reuse story is good, but the *sales* motion differs: agents buy "sell this house
faster"; a dentista buys brand presence. Same pipeline, different pitch, different
willingness to pay. One sentence in §11 so future planning doesn't assume the
real-estate pricing transfers.

---

## 5. Missing from §11 entirely

Add these as problems (with the noted mitigations):

1. **Voice talent consent/rights** → Edit B4.
2. **Native-speaker QA loop and its cost** → Edit D2. Includes the brand-risk framing:
   bad Guaraní from a Guaraní-authenticity brand is negative marketing.
3. **Platform risk (Higgsfield)**: ToS on resale, credit price changes, MCP API churn,
   output-URL expiry, account suspension = losing the cloned voice → mitigations in
   A4 (own storage, own recordings, USD cost normalization).
4. **Listing-photo rights**: agents frequently don't own the photos they post. The
   service agreement needs the client to warrant they have rights to supplied media —
   template clause, not code.
5. **Render environment** → Edit S3.
6. **WhatsApp-first delivery** → Edit S5.
7. **Number/price/unit verbalization** ("Gs. 850.000.000", "120 m²") in both languages
   → Edit D3. Highest-frequency TTS failure mode in real estate scripts.
8. **Lexicon backup/export**: §11 calls the lexicon compounding IP, but nothing backs
   it up. Nightly dump of `jopara_lexicon` + pronunciations to storage; one cron line.
9. **Background music**: **[verified]** Higgsfield's MCP cannot generate standalone
   music (its music model is restricted to the game pipeline). If videos get music, it
   comes from a licensed library — pick one and budget it, or ship narration-only.
10. **Outcome measurement**: an agent renews because videos produced leads. Full
    analytics is Backlog, but from video #1 keep a manual log of "video → inquiries
    reported by agent" — it's the sales collateral for the resell opportunity.

---

## Summary of plan.md changes by section

- **§1**: rewrite voice-cloning rationale (A6); add render-environment decision (S3);
  add voice-rights + original-recordings-ownership note (A4.1, B4).
- **§2**: interface shapes + result types (A1); voices.provider_params + seed_audio
  (A2); generation_jobs cost columns → raw + USD (A4.4); lexicon_pronunciations
  per-engine child table + verified_by + sample audio (D1, D2); optional ipa column
  (D4); `projects` root table, listings as detail (D5); SceneSpec declarative,
  prompts adapter-owned (A4.3).
- **§3**: per-line TTS + local duration measurement for captions (A3); delivery spec
  9:16/WhatsApp (S5); number verbalization (D3).
- **§5.1**: MockProvider (A5); real Guaraní synthesis go/no-go in exit criteria (S1);
  immediate download-to-R2 of all outputs (A4.2).
- **§5.2**: unresolved-terms detection rule spelled out (D3).
- **§5.3**: split into opus-3-assembly + opus-4-visuals (S2); update phase table.
- **§7**: R2 moves to opus-1 (S4); Guaraní reviewer (D2); voice-talent consent (B4).
- **§8**: validation track with a date (B1); pricing-anchor question (B2);
  Higgsfield ToS check (B3).
- **§11**: MMS-TTS + SSML/IPA alternatives noted (D4); reframe TTS licensing as
  pipeline licensing (B3); add the ten missing items above.
