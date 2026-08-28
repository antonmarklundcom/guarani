# Known issues

Minor issues logged rather than fixed in-phase, per the plan §4 autonomy
protocol. Each entry says which phase found it and where it should be handled.

## opus-1

### 1. Higgsfield transport shapes are unverified

**Found:** opus-1. **Still open after opus-2.** **Handle in:** any session whose
egress policy permits the docs host.

`HiggsfieldAdapter` talks to a `HiggsfieldTransport` seam. The production
implementation is meant to be Higgsfield's HTTP API, but the exact request and
response shapes could not be verified in opus-1 — the API docs host is not
reachable from the build environment's egress policy.

**opus-2 re-checked and the block is unchanged.** `higgsfield.ai` and
`docs.higgsfield.ai` both answer `403` to CONNECT at the egress proxy; this is
an organization policy denial, not a transient failure, and the proxy
documentation is explicit that it must be reported rather than worked around.

opus-2 therefore did **not** write an `HttpTransport`. Writing one from memory
would produce code that looks production-ready, passes its own tests, fails on
the first real call, and — worse — leaves a later phase believing the question
was settled. Instead `src/providers/factory.ts` fails loudly when no transport
is registered, naming this issue. Registering a verified one is a single call
(`registerHiggsfieldTransport`) and needs no change to adapter logic.

What opus-2 *could* confirm, from the live MCP tool schema, is the addressing
tuple the adapter builds: `model` (`seed_audio` or `text2speech_v2`), `variant`
(only for `text2speech_v2`), `voice_type` (`preset`/`element`), `voice_id`. The
adapter's shape is right; only the HTTP envelope is unknown.

### 2. Migration generated but never applied

**Found:** opus-1. **Resolved in opus-2 against MariaDB; still unproven on
MySQL 8.**

opus-2 installed MariaDB 10.11 in the build container, ran `npm run db:migrate`,
and the migration applied cleanly — all 13 tables, no errors. The lexicon seed,
voice seed, script generation, TTS orchestration and A/B harness then all ran
against that real database (see plan §9 opus-2 build log).

The remaining gap is engine, not correctness: Hostinger runs **MySQL 8**, and
the DDL has still never been executed there. Nothing in the migration is
MariaDB-specific, so this is a low risk — but sonnet-3 should treat the first
`db:migrate` on Hostinger as a step that can fail, not a formality. See issue 6
for a collation problem that MySQL 8 shares.

### 3. No ffmpeg/ffprobe in the build environment

**Found:** opus-1. **Resolved in opus-2.**

ffmpeg is installable in the build container (`apt-get install ffmpeg`), so
opus-2 verified `measureDurationMs` against real files rather than leaving it
unproven: `tests/tts-synthesize.test.ts` generates tones of known duration with
ffmpeg, serves them over a local HTTP server, and asserts the measured values
are exactly 1000/2000/500 ms — while the stub provider claims 99999 ms for every
line and is ignored.

The tests skip themselves cleanly where ffprobe is absent, so this does not
become a new way for CI to fail. Plan §7 still lists a render host with ffmpeg
as an opus-3 human input; that remains true for the worker.

### 4. Higgsfield CDN is blocked from the build environment

**Found:** opus-1. **Still open after opus-2.** **Handle in:** any environment
with wider egress; not a code issue.

Generated artifacts are served from `d8j0ntlcm91z4.cloudfront.net`, which this
session's egress policy still rejects (403 on CONNECT). So the audio from
opus-2's real-synthesis sanity run could not be downloaded, measured or
archived from here either; its URLs are recorded in the plan §9 build log.

What opus-2 *did* close is the code path. `tests/tts-synthesize.test.ts` runs a
full download → ffprobe → S3 `PutObject` round trip against a local endpoint,
with the real AWS SDK signing real requests, and asserts our storage URL — not
the provider's — is what lands on the job row. What remains unproven is only
that path against Cloudflare R2 and the real CDN, which needs an environment
with both credentials and egress.

### 5. `text2speech_v2` rate-limits under parallel submission

**Found:** opus-1. **Resolved in opus-2.**

`src/tts/retry.ts` adds retry-with-exponential-backoff-and-jitter around
submission, and `synthesizeLines` runs at bounded concurrency (default 3) rather
than submitting a whole script at once. `isRetryable` treats 429/408/5xx and
dropped sockets as transient and everything else — a bad voice id, a malformed
request — as final, so a permanent error does not burn the retry budget.

The A/B harness additionally runs engines sequentially, since an A/B run is the
burstiest thing in the system.

## opus-2

### 6. The lexicon's unique keys are accent-insensitive

**Found:** opus-2. **Handle in:** the next phase that has a migration window;
flagged for a human decision because it touches the compounding IP.

`jopara_lexicon` has a unique index on `(term, language)`, and the column
collation is accent- **and** case-insensitive (`utf8mb4_unicode_ci` locally;
MySQL 8's default `utf8mb4_0900_ai_ci` is also accent-insensitive). Verified:

```sql
SELECT COUNT(*) FROM jopara_lexicon WHERE term = 'tape';   -- 1, matching 'tapé'
```

In Guaraní a diacritic is not decoration — the tilde is nasality and the acute
is stress, both phonemic. So the lexicon **cannot currently hold two words that
differ only by a diacritic**: inserting one silently resolves to the other. That
is a correctness problem in the one asset the plan calls the moat (§11).

It has not bitten yet — the 40 seeded terms contain no such pair, and opus-2
avoided creating one (it dropped a planned `tape` entry and uses opus-1's
`tapé` spelling in the Guaraní template instead). Application-level matching in
`src/script/resolve.ts` is exact and diacritic-sensitive, so pronunciation
lookup is correct regardless; only the database's uniqueness is loose.

Not fixed in-phase for two reasons: plan §5.1 says later phases never migrate,
and the fix cannot be verified from here — the target is MySQL 8, whose
accent-sensitive collation (`utf8mb4_0900_as_ci`) does not exist on the MariaDB
server available in this container. The recommended DDL, for MySQL 8:

```sql
ALTER TABLE jopara_lexicon   MODIFY term VARCHAR(255) COLLATE utf8mb4_0900_as_ci NOT NULL;
ALTER TABLE unresolved_terms MODIFY term VARCHAR(255) COLLATE utf8mb4_0900_as_ci NOT NULL;
```

(`_as_ci` = accent-sensitive, case-insensitive — which is what a review queue
wants: `Vicente` and `vicente` should still be one entry.)

### 7. opus-1's default speech forms use IPA characters no engine has been heard to read

**Found:** opus-2. **Handle in:** the first A/B tuning pass with a listener.

The opus-1 lexicon seed writes `default`-engine speech forms containing IPA
symbols — `ɨvɨ` for *yvy*, `mbohapɨ` for *mbohapy*, `hepɨ` for *hepy*. These are
guesses; no engine has been observed interpreting them, and a text-to-speech
model handed `ɨ` is as likely to skip it, spell it, or mangle the surrounding
word as to produce a close vowel.

opus-2's own additions deliberately take the opposite approach — the speech form
is the orthographic form, with stress guidance in `notes` — on the grounds that
"say what is written" is the honest default and tuned respellings belong in
per-engine rows the A/B harness creates. The two conventions now sit side by
side in the seed, which is documented there but is not a stable end state.

opus-2's sanity run rendered *Orekóva mbohapɨ kotý ha mokõi baño.* and
*Orekóva mbohapy koty ha mokõi baño.* on two engines specifically so this can be
settled by listening; the URLs are in the plan §9 build log. Whichever wins,
both conventions should then be made consistent.

### 8. The Guaraní templates have not been reviewed by a Guaraní speaker

**Found:** opus-2. **Handle in:** the §7 native-speaker review, before anything
ships to a client.

`src/script/templates.ts` generates jopara sentences modelled clause-for-clause
on the three sentences the plan itself uses for the opus-1 go/no-go gate (§9),
rather than composed freely — a deliberate risk control, since confidently wrong
Guaraní is worse for this product than no Guaraní (plan §11.7).

Modelling on reviewed sentences is not the same as being reviewed. Nobody in the
build sessions speaks Guaraní. Specific things a speaker should rule on:

- `Ko propiedad oĩ …-pe` as a neutral opener (`listings` has no property-type
  column, so "óga"/house would be inventing a fact — but "propiedad" may read as
  stilted where a speaker would say something else).
- `Tapé: <address>` as a bare label line.
- The threshold in `verbalizeCount`: native numerals for 1–5, Spanish above.
  The boundary is the one judgement call in the verbalizer.
- Whether the locative `-pe` is right on a city name as well as a neighbourhood.

### 9. Balance deltas cannot attribute spend to this project

**Found:** opus-2. **Handle in:** sonnet-3's cost dashboard — as a caveat, not
as work.

The Higgsfield account is shared with other work. During opus-2's sanity run the
balance fell by 631 credits while this project's actual spend was **1.2**; the
rest was concurrent Seedance 2.5 video generation (45–72 credits per job) from
elsewhere on the same account.

So "credits before minus credits after" is not a measurement of anything here.
The per-job accounting in `generation_jobs` is, and the `transactions` endpoint
is the provider-side check. The cost dashboard sonnet-3 builds already sums
`generation_jobs.cost_usd` rather than reading balances, which is correct —
this note exists so nobody later "improves" it into a balance diff.
