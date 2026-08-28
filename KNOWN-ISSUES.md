# Known issues

Minor issues logged rather than fixed in-phase, per the plan §4 autonomy
protocol. Each entry says which phase found it and where it should be handled.

## opus-1

### 1. Higgsfield transport shapes are unverified

**Found:** opus-1. **Handle in:** opus-2, before any production traffic.

`HiggsfieldAdapter` talks to a `HiggsfieldTransport` seam. The production
implementation is meant to be Higgsfield's HTTP API, but the exact request and
response shapes could not be verified in this phase — the API docs host is not
reachable from the build environment's egress policy. The transport interface is
written against the shapes the MCP tools expose, which is a reasonable guess and
nothing more.

The adapter's *logic* is tested (against a stub transport) and the abstraction
is sound either way; only the wire format is unconfirmed. opus-2 must confirm it
against real docs before the first production call.

Related: MCP tools live in an agent's tool surface, not in the Node process. A
render worker running unattended cannot call `mcp__higgsfield_ai__*`, which is
why the transport seam exists at all. An agent-side transport can be supplied by
a session that does have those tools, with no change to adapter logic.

### 2. Migration generated but never applied

**Found:** opus-1. **Handle in:** whoever first has a database.

`drizzle/0000_opus1_foundation.sql` was generated from the schema (13 tables)
and reviewed by hand, but never executed: no `DATABASE_URL` exists in the build
environment and no MySQL server is available in it. The SQL is therefore
unproven against a real server.

Run `npm run db:migrate` then `npm run seed:lexicon` on first contact with a
real database, and fix anything that surfaces there.

### 3. No ffmpeg/ffprobe in the build environment

**Found:** opus-1. **Handle in:** opus-3 (render worker), or earlier if
convenient.

`src/providers/duration.ts` shells out to `ffprobe` to measure per-line audio
duration (plan §3.3). Neither ffmpeg nor ffprobe is installed in this container,
so `measureDurationMs` is untested against a real file. The pure offset
arithmetic around it (`lineOffsets`) is tested.

Plan §7 already lists "a machine with ffmpeg" as a human input for opus-3. This
just confirms it is not the build container.

### 4. Higgsfield CDN is blocked from the build environment

**Found:** opus-1. **Handle in:** any environment with wider egress; not a code
issue.

Generated artifacts are served from `d8j0ntlcm91z4.cloudfront.net`, which this
session's egress policy rejects (403 on CONNECT). So the go/no-go gate audio
could not be downloaded, measured, or archived into object storage from here —
the URLs are recorded in the plan §9 build log instead.

The storage code path itself ships and is tested for the degradation case. A
live download+upload round-trip remains unproven until it runs somewhere with
both R2 credentials and CDN access.

### 5. `text2speech_v2` rate-limits under parallel submission

**Found:** opus-1. **Handle in:** opus-2, when the A/B harness batches jobs.

One of twelve batched TTS submissions failed immediately with
`429 rate_limit_reached`; an identical retry seconds later succeeded. opus-2's
batch orchestration needs a retry-with-backoff around submission — a 429 on
submit is expected under parallelism, not an error worth failing a job over.
