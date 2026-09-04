# Progress Log

A running record of each iteration: what was built, what was decided, what was
verified, and what is still open.

**Convention:** every iteration appends a new `## Iteration N` section to this
file (newest at the bottom) and updates the *Current state* block below. Nothing
is deleted — superseded decisions are struck through or corrected in the
iteration that changed them, so the reasoning stays traceable.

---

## Current state

| | |
| --- | --- |
| **Iteration** | 4 — attention feed |
| **Repo root** | `/Users/ayushi/market-pulse` (shell `pwd` is `/Users/ayushi`, one level up) |
| **Runs?** | Yes — `npm run dev` serves web `:5173` + API `:4000` |
| **Tests** | 111 passing, 15 files |
| **Gate** | `npm run verify` green (format + lint + typecheck + test + build) |
| **Market features** | End to end: engine → log → watermark → API → screen. |

**Next up:** Iteration 5 — replay/demo mode. Scope and constraints are recorded
in [CLAUDE.md](CLAUDE.md).

---

## Iteration 1 — Foundation

**Date:** 2026-09-04
**Goal:** Inspect the repository and establish a clean foundation. Explicitly
*not* to build the application.

### Starting point

The repository was empty. `/Users/ayushi` is a home directory, not a project,
and the only code-like folder (`development/`) is a Flutter SDK checkout. No
existing conventions to preserve, so the stack was chosen rather than inherited.

### Decisions

| Decision | Reasoning |
| --- | --- |
| Modular monolith, npm workspaces | Boundaries enforced in source, not across a network. No Nx/Turborepo until the build is actually slow. |
| `domain` / `server` / `web` packages | `domain` depends on nothing; the other two depend on `domain` and never on each other. |
| SQLite via built-in `node:sqlite` | Real SQL and real migrations with no service to install and no native compilation. Postgres deferred, not rejected — everything above `db/connection.ts` speaks plain SQL. |
| Express 5 + `tsx` | Smallest thing that serves an API without a build step in development. |
| React 19 + Vite 8, `/api` proxied to `:4000` | Single origin in development, so there is no CORS configuration to maintain. |
| Vitest across all three packages | One runner, one `npm test`, TypeScript natively. |
| TypeScript 5.9, not 7.x | Pinned for tooling compatibility with the Vite/Vitest plugin chain. |
| No project references | Tried first and reverted — see *Course corrections*. |

### Built

- Docs: `ARCHITECTURE.md`, `CUT_LIST.md`, `README.md`, this file
- Root config: `package.json` (workspaces), `tsconfig.base.json`, `vitest.config.ts`, `.gitignore`, `.env.example`
- `packages/domain`: `clock.ts` (Clock port), `contracts/system.ts`, `index.ts`
- `packages/server`: `config.ts`, `app.ts`, `index.ts`, `db/{connection,migrate,migrate-cli}.ts`, `db/migrations/001_init.sql`, `modules/system/system.routes.ts`
- `packages/web`: `App.tsx`, `main.tsx`, `index.html`, vite + vitest configs
- Tests: `clock.test.ts`, `config.test.ts`, `smoke.test.ts`, `App.test.tsx`

### Verified

Everything below was actually executed, not assumed.

- `npm test` → 11 passed, 4 files
- `npm run typecheck` → clean, all 3 packages
- `npm run dev` → migration applied on boot; API `:4000` and proxy `:5173` both
  returned `{"status":"ok","version":"0.0.1","database":"ok"}`; web root HTTP 200
- `npm run db:migrate` on a fresh database → applied `001_init.sql`; rerun →
  correctly reported no pending migrations
- `npm run build` → web client built

### Course corrections

Two things went wrong during the iteration and were fixed rather than papered
over:

1. **Relative `DATABASE_URL` resolved against the wrong directory.** npm runs
   workspace scripts from the *package* directory, so the database was created
   at `packages/server/data/` instead of the repo root. This made a fresh
   migration falsely report "No pending migrations" and made the documented
   reset command a silent no-op. `loadConfig` now anchors relative paths to the
   repo root, covered by a regression test in `packages/server/test/config.test.ts`.

2. **TypeScript project references were abandoned.** They require the referenced
   project to emit, which would force a build step before every run. Packages
   now consume `domain` as TypeScript source via the `exports` field, and
   typechecking is per-package `tsc --noEmit`. Revisit if `domain` ever needs to
   be published or consumed as compiled JS.

### Open items carried forward

- No linter or formatter yet (no ESLint/Prettier) — worth adding before the
  codebase grows.
- `node:sqlite` still prints an experimental warning on boot; Node >= 22.5.0 is
  a hard requirement.
- Nothing is committed. `git init` was run; the working tree is untracked.
- Domain vocabulary (Tick, Market Event, Event Log, Watermark, Attention Feed)
  is documented in `ARCHITECTURE.md` but deliberately not implemented.

---

## Iteration 1.5 — Quality gate and audit fixes

**Date:** 2026-09-04
**Goal:** Add a mechanical quality gate before the feature surface grows, and
act on a review of the Phase 1 code. Explicitly *not* to start Phase 2.

### Starting point

A senior review of Iteration 1 approved the foundation with one required
follow-up (linting/formatting) and one documentation correction (the Postgres
portability claim). Before acting on it, every file in the repository was read
directly — a summary can describe good engineering but cannot demonstrate it.
The code matched its summary, and three defects turned up that the summary did
not mention.

### Built

- **ESLint 10** (flat config, type-aware via `projectService`) and **Prettier**,
  with `eslint-config-prettier` last so the two do not fight.
- **Import-boundary rules.** The dependency rule from `ARCHITECTURE.md` is now
  machine-checked: `domain` cannot import `server`, `web`, Express, React, or a
  `node:` built-in; `server` and `web` cannot import each other. Each rule
  carries a message explaining the alternative, not just the prohibition.
- **Root scripts:** `lint`, `lint:fix`, `format`, `format:check`, and `verify`
  (`format:check && lint && typecheck && test && build`).
- **Root `tsconfig.json`** so repo-level config files belong to a TS project,
  which `projectService` requires.
- **`CLAUDE.md`** — the working agreement for AI agents on this repo: scope
  discipline, the dependency rule, the abstraction rule, settled decisions that
  must not be re-litigated, and an iteration log.

### Fixed

Three defects found by reading the code, all of the "works on my machine" family:

1. **A regression test that was itself environment-dependent.**
   `config.test.ts` asserted the database path ended in
   `/market-pulse/data/market-pulse.sqlite` — hardcoding the clone directory
   name. Cloning into any other folder would fail the test, which is precisely
   the class of bug the test was written to prevent. It now derives the expected
   root the same way `config.ts` does.
2. **Contract drift on `version`.** `HealthResponse.version` is documented as
   coming from `package.json`, but `app.ts` hardcoded `'0.0.1'` as a default —
   a value that would silently go stale on the first version bump. Added
   `src/version.ts`, and made `version` a **required** `createApp` option so no
   default can drift again. Covered by a test asserting the endpoint's value
   equals the manifest's.
3. **An overstated portability claim.** `db/connection.ts` said moving to
   Postgres "is a driver swap rather than a rewrite". Corrected in both the code
   comment and `ARCHITECTURE.md`: the boundary confines the work to `src/db/`,
   but a move still needs a new driver, a sync→async connection lifecycle
   change, and a dialect pass (upserts, timestamps, JSON, generated ids,
   concurrency).

### Verified

- `npm run verify` → green end to end: Prettier clean, ESLint clean, typecheck
  clean across 3 packages, **12 tests passing in 4 files**, web build succeeds.
- **The boundary rule was proved, not assumed.** A temporary file importing
  `node:fs` inside `packages/domain` was linted and correctly rejected, then
  deleted. A rule that has never failed is not known to work.

### Decisions

| Decision | Reasoning |
| --- | --- |
| Type-aware linting (`projectService`) | The rules worth having here — `no-floating-promises`, `no-misused-promises` — need type information. Slower, and worth it. |
| Boundary rules in ESLint, not a separate tool | No new dependency, and the failure lands in the gate developers already run. |
| `dot-notation` with `allowIndexSignaturePropertyAccess` | `process.env` is an index signature; bracket access states that honestly rather than pretending the keys are typed. |
| `version` required rather than defaulted | A default that is a stale literal is worse than a compile error. |
| No CI workflow, no pre-commit hook | There is no remote yet, and the gate should be a command a developer runs, not a trap that fires at commit time. Add CI when there is somewhere to run it. |

### Open items carried forward

- `node:sqlite` still prints an experimental warning on boot; Node >= 22.5.0
  remains a hard requirement, documented in `README.md` and `engines`.
- No CI. Add when a remote exists.
- Domain vocabulary is still documented and unimplemented — that is Iteration 2.

---

## Iteration 2 — Domain model and the golden scenario

**Date:** 2026-09-04
**Goal:** Build the product's core as pure domain logic, and prove the signature
behaviour. Explicitly *not* to persist it, expose it, or render it.

### Pre-work: two review items verified against the code

Before starting, two concerns raised in review were checked rather than assumed:

1. **Is `version` read at the composition boundary?** Yes. `readAppVersion()`
   lives in `server/src/version.ts` and is called only from `index.ts`, which
   passes it into `createApp`. `packages/domain` contains no reference to
   `package.json` and no `node:` import — and the boundary lint rule would
   reject one.

2. **Does the config regression test assert independently?** It did not call the
   production function, but it derived the repository root by the *same
   technique* — counting `../` from a file three levels deep. If that segment
   count were wrong, or if `config.ts` moved, both would have been wrong
   together. It now finds the root by **searching upward for the manifest that
   declares the workspaces**, which is an independent route to the same answer.
   Confirmed by mutation: changing `../../../` to `../../` in `config.ts` makes
   the test fail. A second test now asserts the invariant directly — the
   resolved path is identical whether `loadConfig` runs from the repo root or
   from `packages/server`.

Two rules were added to `CLAUDE.md` before building under it: **§2.8** never
weaken a test, lint rule, or type to make the gate pass, and **§2.9** every
feature must name the product invariant it upholds.

### Built

`packages/domain` only.

| Module | Contents |
| --- | --- |
| `market/money.ts` | `PriceMinor` (branded integer minor units), `BasisPoints`, conversions |
| `market/instrument.ts` | `InstrumentId` |
| `market/tick.ts` | `MarketTick` — raw input, not history |
| `market/event.ts` | `MeaningfulMarketEvent` — a complete, self-contained statement of a transition |
| `market/significance.ts` | `MarketState`, `observeTick`, `observeTicks` — the engine |
| `market/log.ts` | `EventSequence`, `append`, `recordsAfter` — append-only history |
| `attention/user.ts` | `UserId` |
| `attention/watermark.ts` | `UserReadWatermark`, `unreadFor`, `markRead`, `joiningAt` |

### Decisions

| Decision | Reasoning |
| --- | --- |
| Prices as integer minor units, magnitudes in basis points | `0.1 + 0.2 !== 0.3`. Determinism (I3) and threshold comparisons both need exactness. Branded so a bare `number` cannot be substituted. |
| Significance measured from a moving **anchor**, not the previous tick | Comparing consecutive ticks makes a slow slide invisible: twenty steps of -0.5% is a 10% fall in which no single step is significant. |
| Re-anchor on emission | Otherwise every tick past the threshold re-reports the same move. |
| Threshold is a parameter, not a constant | "Significant" is a product decision that will change, and a rule passed in is a rule a test can vary. |
| Out-of-order and cross-instrument ticks throw | History is the source of truth. Silently accepting a tick from the past corrupts it in a way no later read can detect. |
| An event carries `fromPrice`/`toPrice`, nothing derived at read time | An event needing the current price to be interpreted would not survive the user being away, which is the whole product. |
| The recovery is its own event, not a correction | Append-only means the decline is never revised. The user missed two things and is told about both. |
| Watermark is a value; reading does not advance it | Displaying an event and acknowledging it are different decisions, and only the caller knows which happened. |
| `joiningAt` distinct from `newReader` | "New to the product" and "new to this instrument" differ; conflating them greets a first-time user with the entire history. |
| No significance *ranking* yet | Ranking belongs with the Attention Feed in Phase 4. Building it now would be scope drift. |

### Verified

- `npm run verify` → green: format, lint, typecheck, **59 tests in 9 files**, build.
- **Mutation-tested, not just executed.** Four deliberate defects were injected
  and the suite was run against each:

  | Injected defect | Result |
  | --- | --- |
  | Threshold made exclusive (`>` instead of `>=`) | 2 tests failed |
  | Event reports `lastPrice` instead of the anchor | 2 tests failed |
  | Engine stops re-anchoring after emission | 2 tests failed |
  | Log records no longer frozen | 1 test failed |

  All four were reverted and the suite returned to green. Test count is not a
  quality signal; this is the evidence that the tests have teeth.

### Known limitation, recorded deliberately

A move that crosses the threshold in stages is reported as several events rather
than one. 100 → 94 emits -6% and re-anchors, so the further fall to 91 (-3.2%
from the new anchor) is not reported: the user is told "-6%" for what was really
a -9% fall. A settle window would fix this. It is deferred until the feed exists
to show whether it matters in practice, and it is written into ARCHITECTURE.md
rather than left to be discovered.

### Open items carried forward

- Nothing is persisted — the log and watermarks live only in memory. That is
  Iteration 3.
- `observeTicks` folds a single instrument's stream. Multi-instrument fan-out
  arrives when something needs it.
- The 5% default threshold is legible for tests, not calibrated against real
  market behaviour.
- Still no CI; add when a remote exists.

---

## Iteration 3 — Persistence

**Date:** 2026-09-04
**Goal:** Give the Phase 2 domain a durable home without changing its
behaviour. Explicitly *not* to expose it over HTTP or render it.

### Pre-work: two decisions locked before building

1. **Identity is not ordering.** `RecordedMarketEvent` now carries an `eventId`
   (identity — stable, unique, meaningful outside this log) alongside `sequence`
   (position — what a watermark points at). An auto-increment key supplies both
   and thereby hides the distinction. Ids come from an `EventIdSource`, a port
   justified under §2.3 by two genuine implementations: `uuidEventIds` in the
   server, `sequentialIds()` for deterministic tests. The domain cannot generate
   them itself without randomness, which would break I3.

2. **Event semantics are now a documented contract.** `MeaningfulMarketEvent`
   states that it records a **threshold-crossing move measured from the active
   anchor** — explicitly not "the full move" of a price run, with the 100→94→91
   example written into the type's doc comment. `fromPrice` and `toPrice` each
   document what they mean for a follow-on event, where `fromPrice` is the
   trough a recovery began from.

### Built

| File | Contents |
| --- | --- |
| `db/migrations/002_market_events.sql` | `market_events`, `user_read_watermarks`, indexes, immutability triggers |
| `modules/market/event-store.ts` | `append`, `readAfter`, `head` — and nothing else |
| `modules/attention/watermark-store.ts` | `get`, `advanceTo` |
| `src/ids.ts` | `uuidEventIds`, the production `EventIdSource` |
| `domain/market/event-id.ts` | `EventId`, `EventIdSource`, `sequentialIds` |

### Decisions

| Decision | Reasoning |
| --- | --- |
| Events stored once; watermarks reference a position | Fan-out on write multiplies storage by user count and turns "what did I miss" into a question about a private queue instead of shared history. |
| `INTEGER PRIMARY KEY AUTOINCREMENT` | A sequence value is never reused even in principle. A watermark at 41 must not come to mean a different event tomorrow. |
| Append-only enforced by DB triggers **and** API shape | An intent expressed only in an API is one `sqlite3` session away from violation. I2 is load-bearing; it gets two guards. |
| Watermark monotonicity in SQL via `MAX(excluded, existing)` | Read-then-write in application code leaves a race between the read and the write. The statement leaves none. |
| `magnitude_bps INTEGER`, not `movement_percent REAL` | *Deviation from the sketched schema.* A REAL percentage reintroduces at the storage boundary the float imprecision the domain types exist to prevent, and lets a stored event disagree with the event that produced it. |
| `occurred_at INTEGER`, not TEXT | *Deviation from the sketched schema.* Epoch ms, matching the domain `Timestamp` and the existing `applied_at`. Text timestamps invite zone and format ambiguity. |
| Watermarks keyed by `user_id` alone | *Deviation from the sketched schema, flagged for review.* There is no watchlist entity yet, so `watchlist_id` would be a placeholder constant in every row — a shape that looks like a decision but records nothing. The key widens in the migration that introduces watchlists, against a table nothing else references. |
| No repository interface or port | One implementation exists. An abstraction over it would be indirection with nothing on the other side (§2.3). |

### Verified

All five acceptance criteria have named tests.

| AC | Proved by |
| --- | --- |
| **AC1** golden scenario survives restart | A fixture runs as a **real child OS process**, writes the events, and exits. The test then opens the same file and recovers them — including the ₹100 → ₹91 decline with the price back at ₹100. |
| **AC2** sequence survives restart | Numbering continues at 3 after a restart; `sqlite_sequence` confirms the high-water mark is remembered, not recomputed. |
| **AC3** append-only survives persistence | The store's key set is exactly `append`, `head`, `readAfter`; direct `UPDATE` and `DELETE` both throw `/append-only/`; a duplicate `event_id` is rejected rather than double-recorded. |
| **AC4** independent watermarks | Two users hold different positions over one log; four readers and two events produce 4 watermark rows and 2 event rows, not 8. |
| **AC5** monotonic watermark | Writing 15 after 20 leaves 20; interleaved `[5,3,9,1,7,2]` settles at 9. |

- `npm run verify` → green: **78 tests in 11 files**, format, lint, typecheck, build.
- **Mutation-tested again.** Removing `MAX()` from the upsert (2 failures),
  neutering the immutability trigger (1), dropping `AUTOINCREMENT` (1), and
  making the child process write nothing (2) each broke the matching AC. One
  first-attempt mutation was faulty — it renamed a trigger without changing its
  body, so nothing should have failed — and was corrected rather than reported
  as a passing result.

### Course correction

The smoke test asserted the applied migration list as a hardcoded
`[{ name: '001_init.sql' }]`, so adding `002` broke it. Rather than appending
the new name — which trains everyone to edit that line without reading it — the
test now compares `schema_migrations` against the migrations actually on disk.
That is the invariant worth asserting, and it will not need editing again.

### Open items carried forward

- Nothing is exposed over HTTP; the stores are used only by tests. Iteration 4.
- Significance *ranking* still unbuilt — it belongs with the feed.
- `watchlist_id` deferred, as above. One migration when watchlists exist.
- Still no CI.

---

## Iteration 4 — Attention feed and the first product screen

**Date:** 2026-09-04
**Goal:** Make the architecture visible. Turn the event log, the watermark and
the significance engine into a screen that answers "what happened while I was
away".

### Built

| File | Contents |
| --- | --- |
| `domain/attention/ranking.ts` | `rankBySignificance` — magnitude desc, tie-break by sequence |
| `domain/attention/feed.ts` | `summariseUnread` — what a traditional watchlist would report |
| `domain/contracts/attention.ts` | Wire contracts for the feed and acknowledgement |
| `server/modules/attention/attention.routes.ts` | `GET /attention-feed`, `POST /attention-feed/ack` |
| `server/db/seed.ts` | Demo data: the golden scenario plus a plain decline and a quiet instrument |
| `web/src/App.tsx`, `AttentionFeed.tsx` | "While you were away" + the comparison toggle |
| `web/src/api.ts`, `format.ts`, `styles.css` | Client plumbing and display |

### Decisions

| Decision | Reasoning |
| --- | --- |
| Reading and acknowledging are separate requests | Advancing on read is the natural-looking shortcut and a correctness bug: a refresh, a prefetch or a second tab would consume events the user never saw, and the watermark only moves forward. |
| The client acknowledges `throughSequence` from the read it displayed | Acknowledging the *current* head would mark events seen that arrived after the render and were never shown. |
| Ranking ties break by `sequence`, not `occurredAt` | Two events can share an instant. A tie-break that can itself tie is not a tie-break; sequences are unique, so the comparator is a total order and F5 does not rely on sort stability. |
| Ranking is `ABS(magnitudeBps)` and nothing more | Every event already crossed the threshold. Weighted models are unfalsifiable without a screen to judge them against. |
| The feed carries the *traditional* answer too | The honest form of the claim: ship the snapshot view's own number and let the comparison speak. Asserting that snapshot views are inadequate is weaker than showing 0.00% next to "2 meaningful changes". |
| Wire contract keeps `instrumentId`/`direction` and an unsigned magnitude | Renaming to `symbol`/`type` across the boundary buys translation bugs; a signed magnitude would merge "how big" and "which way" back into one field. |
| A seed script, not test fixtures | Tests build their own data. This exists so `npm run dev` shows something. |

### Verified

- `npm run verify` → green: **111 tests in 15 files**, format, lint, typecheck, build.
- **Verified live, not only in tests.** With the server running and the database
  seeded, `GET /api/attention-feed?userId=demo` returns `netChangeBps: 0` and
  `meaningfulChanges: 2` for RELIANCE, with the 20% INFY decline ranked above
  both RELIANCE events.
- **Mutation-tested.** Advancing the watermark on GET (3 failures), ignoring the
  watermark when selecting events (6), ranking by recency (1), and flipping the
  upsert's `MAX` to `MIN` (3) each broke the matching invariant.

| Invariant | Status |
| --- | --- |
| **F1** fetching never advances the watermark | Proved server-side and at the client boundary — a render issues no POST |
| **F2** acknowledging advances to at least N | Proved, including partial acknowledgement |
| **F3** stale acknowledgement cannot move backwards | Proved via the two-tab case |
| **F4** feed contains only events after the watermark | Proved, including two users differing at the same instant |
| **F5** ranking is deterministic | Proved over repeated requests |

### Course corrections

Two lint errors surfaced by the gate were fixed in the code rather than
silenced, per §2.8:

1. `setState` called synchronously inside an effect triggers cascading renders.
   `load` no longer sets the loading state itself; the previous feed now stays on
   screen while the next loads, which is better behaviour anyway.
2. `String(body)` on a `BodyInit` risked `[object Object]`. The test now asserts
   the body is a string before parsing it.

One test assertion was wrong, not the code: it expected `+0.00%` for a flat
change. `0.00%` is correct — a sign implies a direction there isn't one — so the
assertion was corrected and the reasoning recorded in the test.

### Open items carried forward

- No tick ingestion: events reach the database via the seed script or tests.
- `latestPrice` is the latest price *the log knows about*. UI labels say "as
  recorded"; nothing may relabel it "current" without real tick data behind it.
- Instruments that never cross the threshold (TCS in the seed) appear nowhere in
  the feed. Correct today, but a watchlist screen will need a price source.
- Still no CI, no auth. `userId` is a query parameter and a text box.
