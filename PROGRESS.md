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
| **Iteration** | 8 — front-end pass |
| **Repo root** | `/Users/ayushi/market-pulse` (shell `pwd` is `/Users/ayushi`, one level up) |
| **Runs?** | Yes — `npm run dev` serves web `:5173` + API `:4000` |
| **Tests** | 184 passing, 19 files |
| **Gate** | `npm run verify` green (format + lint + typecheck + test + build) |
| **Market features** | End to end: engine → log → watermark → API → screen. |

**Next up:** nothing. The project is feature-complete against the brief. Any
further work is visual refinement or fixing what a real reviewer trips over.

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

---

## Iteration 5 — Replay

**Date:** 2026-09-04
**Goal:** Turn the golden scenario into something you watch rather than read,
without giving replay any power to change what it is replaying.

### Built

| File | Contents |
| --- | --- |
| `domain/replay/replay.ts` | `Replay`, `createReplay`, `advance`, `restart`, `revealed`, `isComplete`, `openingPrice`, `priceAtCursor`, `netChangeAtCursor` |
| `server/modules/replay/replay.routes.ts` | `GET /api/replay?instrumentId=…` |
| `web/src/Replay.tsx` | The Replay tab: Play, Next, Restart |

### Decisions

| Decision | Reasoning |
| --- | --- |
| The cursor lives in the client | A server-side replay cursor would be per-viewer session state — exactly the mutable, user-scoped thing replay is supposed not to have. |
| The replay route takes no `WatermarkStore` | R5 then holds structurally rather than by discipline. It also takes an `EventStore` with no update or delete, which is how R1 holds. |
| The request cannot name a user | A replay that cannot identify a viewer cannot advance one's read position. |
| Order by `sequence`, never `occurredAt` | Two events can share an instant. Replaying in a different order than recorded would show a story that never happened. |
| Three controls, no more | A seek bar, playback rates and a timeline widget were all plausible; none makes the point better than "the price came back and the events did not go away". |
| `netChangeAtCursor` in the domain | The number that makes the demo land is a pure function of the projection, so it is testable without a browser. |
| **No `Clock` in replay** | *Deviation from the sketched R4.* Replay is cursor-based: visible state is a pure function of `(timeline, cursor)`, so there is no wall-clock read to inject. Threading a `Clock` through would be ceremony — an abstraction with nothing on the other side. Real time appears only in the UI's auto-advance, which is a component parameter so tests drive the story in milliseconds. |

### Verified

| Invariant | Status |
| --- | --- |
| **R1** canonical history is immutable | Event rows byte-identical after replaying; the projection freezes its own timeline and rejects mutation at runtime |
| **R2** replay is deterministic | Identical visible state across 30 runs; independent of the order records arrive |
| **R3** order follows sequence | Proved with events sharing a timestamp, and with a record whose timestamp contradicts its position |
| **R4** time is injectable | Satisfied by absence — see the decision above |
| **R5** replay acknowledges nothing | No watermark row created across repeated replays; an existing watermark unmoved; the client issues no write while stepping |

- `npm run verify` → green: **142 tests in 18 files**.
- **Verified live:** with the server running, two replay requests left the
  `user_read_watermarks` table at 0 rows.
- **Mutation-tested.** Ordering by timestamp (1 failure), unfreezing the
  timeline (1), and leaking other instruments into the story (4) each broke the
  matching invariant.

  My first attempt at an R5 mutation was **a no-op** — it changed only
  whitespace, so the clean result meant nothing, and is reported here rather
  than presented as a pass. That failure was informative: R5 could not be broken
  by editing the route at all, because the module has no watermark access.
  Violating it required adding that access at the app-wiring level, which failed
  2 tests immediately. Structural guarantees are harder to mutation-test
  precisely because they are structural.

### Course correction

The gate caught `setState` called synchronously inside an effect for the second
time in this project — the auto-play loop corrected `playing` to `false` on
completion. Fixed by *deriving* rather than storing: "playing but finished" is
not a state the component can be in, so it is computed. Writing state inside an
effect to fix up other state is the pattern that causes cascading renders, and
it is now been the cause of both lint failures in the web package.

### Open items carried forward

- An instrument that never crosses the threshold appears nowhere. Correct for a
  feed; wrong for a watchlist. That distinction is the next phase.
- No tick ingestion; events still arrive via the seed script or tests.
- Still no CI, no auth.

---

## Iteration 6 — Watchlist and instrument snapshots

**Date:** 2026-09-04
**Goal:** Add the concept the product was missing — *what I care about*, as
distinct from *what changed enough to deserve attention*.

### Built

| File | Contents |
| --- | --- |
| `domain/watchlist/watchlist.ts` | `WatchlistEntry`, `InstrumentSnapshot`, `buildWatchlist` |
| `db/migrations/003_watchlist.sql` | `instrument_snapshots`, `watchlist_entries` |
| `modules/market/snapshot-store.ts` | `record`, `list` — mutable, monotonic in observation time |
| `modules/watchlist/watchlist-store.ts` | `list`, `add`, `remove` |
| `modules/watchlist/watchlist.routes.ts` | `GET`/`POST`/`DELETE /api/watchlist` |
| `web/src/Watchlist.tsx` | The "My watchlist" tab, now the entry point |

### Decisions

| Decision | Reasoning |
| --- | --- |
| Watchlist and attention feed are different lists | An instrument that never crosses the threshold belongs on one and not the other. Merging them would force one of the two to be wrong. |
| `instrument_snapshots`, not `market_state` | *Deviation from the sketched name.* The domain already has `MarketState` — the engine's fold state. Reusing the name for "latest recorded observation" would make two different things look like one. |
| Snapshots are mutable; events are not | The contrast is the product thesis at the schema level. A snapshot makes no claim about the past, so overwriting it does not weaken I2. |
| Attention derived per read, never stored | A `hasMeaningfulChange` flag would need invalidating on every append and every acknowledgement, and would be wrong in between (W3). |
| `netChangeBps: undefined` for quiet instruments, not `0` | "Nothing meaningful happened" and "it moved 9% and came back" are different facts. Reporting `0.00%` for both is the exact mistake this product exists to point out. |
| Snapshot upsert is monotonic in `observed_at` | A late-arriving reading of an older moment must not overwrite a newer one — the same argument as the watermark, enforced the same way. |
| Adding twice is a no-op, not an error | The entry is a fact about interest, and it was already true. `added_at` does not reset. |
| No `watchlist_id` | Consistent with 002. One watchlist per user until a second one exists. |
| No day-change percentage for quiet instruments | The sketched mockup showed TCS at "0.8%". There is no baseline in the data to compute that from, and inventing one would break the rule the project has held since Phase 3: never let the UI claim more than the data model knows. |

### Verified

| Invariant | Status |
| --- | --- |
| **W1** membership independent of events | Quiet instrument listed; instrument never observed listed; instruments not followed absent |
| **W2** quiet instruments have recorded state | Snapshot price and observation time both present |
| **W3** attention derived, not stored | Flips to quiet after acknowledgement with nothing written; two users differ over identical contents; reading the watchlist advances no watermark |
| **W4** removal preserves history | Event rows byte-identical; replay still complete; re-adding restores the full count |
| **W5** survives restart | Real child process writes entries and snapshots, exits; reopened database has both |

- `npm run verify` → green: **179 tests in 22 files**.
- **Verified live:** the watchlist returns RELIANCE, INFY *and* TCS; the
  attention feed returns only RELIANCE and INFY. The two lists differ, on
  purpose, in the running system.
- **Mutation-tested.** Dropping instruments with no events (16 failures),
  reporting `0` instead of `undefined` for quiet instruments (2), and letting a
  snapshot move backwards in observation time (1) each broke the matching
  invariant.

  The W4 mutation is worth recording precisely. The first attempt **failed to
  apply** — a quoting error in the mutation script, not a result, and reported
  as such rather than as a pass. Retried by forcing a deletion into the request
  path at the app-wiring level, it did not merely fail a test: it **could not
  execute**, because the append-only trigger from migration 002 aborted the
  statement. W4 is guarded three deep — the store has no access to
  `market_events`, `EventStore` exposes no delete, and the database refuses one.

### Course corrections

- Making the watchlist the entry point broke 8 App tests, which had rendered
  straight onto the attention screen. Fixed by navigating: the tests now click
  through the tab a real user lands on. A test asserting against a screen users
  do not first see is testing the wrong thing.
- A stray non-ASCII character (`需`) got into a template string while editing.
  Caught before commit; noted because it would have shipped silently in a string
  no test read.
- The `String(body)` lint error from Iteration 4 recurred verbatim in a new test
  file. Fixed the same way — assert the body is a string, then parse.

### Open items carried forward

- No ingestion. Snapshots and events both come from the seed script or tests;
  in a system with real ingestion the ingester would write both.
- Quiet instruments show a price and an observation time but no percentage,
  because there is no baseline to compute one from.
- Still no CI, no auth. `userId` remains a query parameter and a text box.

---

## Iteration 7 — Finalization

**Date:** 2026-09-04
**Goal:** Presentation, reliability and a reviewer journey. **No new features.**

### Fixed: the seed was not idempotent

The most valuable finding of this iteration, and it was a genuine demo bug
rather than a test failure. Running `npm run db:seed` twice appended a second
copy of the story:

```
Log head is now 3     # first run
Log head is now 6     # second run
Log head is now 9     # third run
```

A reviewer who ran it twice would have seen RELIANCE reporting six meaningful
changes, and the golden scenario would have looked like noise.

There is no correct "re-seed": history is append-only by design, so a second run
cannot replace the first. Seeding now refuses when events already exist and says
why, and `npm run db:reset` deletes the database file and rebuilds. Deliberately
**not** implemented: a "clear events" command, which would contradict the
product's central guarantee to make a script more convenient.

### Fixed: seeded watchlist order buried the demo

All three instruments were added within the same millisecond, so `ORDER BY
added_at, instrument_id` fell back to alphabetical — putting INFY first and
RELIANCE, the instrument the entire demo turns on, second. The seed now advances
its own clock by a millisecond per entry so the seeded order is the listed order.

### Built

- **"View what happened →"** on rows with unread changes, jumping straight to
  the attention feed. Absent on quiet rows, which is asserted.
- **README rewritten** to the structure a reviewer actually needs: the problem
  first (with the ₹2,900 → ₹2,639 → ₹2,900 diagram), then the idea, then the
  product model, then a 60-second walkthrough, then the engineering decisions
  that shaped the design, then trade-offs, then how to run it. The technology
  list is gone; it was never the interesting part.
- **Trade-offs section**, stated plainly: staged moves reported in pieces, no
  live data, no percentage for quiet instruments, one uncalibrated threshold, no
  auth, no ingestion pipeline.

### Verified

- `npm run verify` → green: **180 tests in 19 files**.
- **Cold-clone audit.** Cloned the repository to a temporary directory under a
  different path, ran `npm install`, `npm run db:seed` and `npm test`: 179 passed
  (the clone predated this iteration's commits). This is the check the Phase 1.5
  config fix existed to make possible — nothing depends on the checkout being
  named `market-pulse` or living at a particular path.
- **Flake check.** One test failed once, immediately after an edit, and was not
  reproducible: 14 subsequent full-suite runs and 3 full `verify` runs were all
  green. Most likely a stale transform cache picking up a mid-write file rather
  than a product flake. Recorded rather than dismissed, because a demo that
  fails once in twenty is a demo that fails.

### Course correction

ESLint's `non-nullable-type-assertion-style` wanted a `!` assertion where a cast
had been used — directly against the project's own convention of avoiding both.
Resolved by narrowing explicitly instead, which satisfies the rule and the
convention. Neither was bent to accommodate the other.

### Final state

Feature-complete against the brief. The open items below are deliberate and
documented in the README, not oversights:

- No live market ingestion; every price is labelled "as recorded".
- Staged moves are reported in pieces (the re-anchoring trade-off).
- One user, one watchlist, no auth.
- No CI, because there is no remote to run it on.

### Visual inspection (added after the first finalization pass)

The UI was inspected rather than assumed. Chrome was driven headless over CDP
(no Playwright or Puppeteer in the dependency tree — Node's built-in WebSocket
client was enough) to capture the five-step reviewer journey and look at it.

What held up: the watchlist reads "3 instruments followed. 2 need your
attention." at a glance; TCS looks deliberately quiet rather than broken or
empty; the traditional view shows `₹2,900.00 / No change since your last check /
0.00%` directly above "3 meaningful transitions happened while you were away";
and the replay's closing line reads as a conclusion rather than marketing.

Two presentation problems were found and fixed:

1. **The ranking explanation sat below the event list.** Because events are
   ranked by significance, RELIANCE's *"Recovered 9.89%"* appears above the
   *"Fell 9.00%"* that caused it — correct per F5, and briefly baffling to a
   first-time reader who meets it with no framing. The note now precedes the
   list. The ranking itself was not touched.
2. **"Remove" carried the same weight as the primary action** and sat in the
   price column, drawing the eye toward the one control that throws work away.
   It is now quiet and secondary; "View what happened →" leads.

Both are presentation-only. No behaviour changed, and the 27 web tests were
green before and after.

### Responsive pass (390 / 768 / 900px)

The last open item from the review, now closed. Measured rather than assumed:
horizontal overflow was checked programmatically at each width
(`scrollWidth > clientWidth`) alongside the screenshots, because a screenshot
will not tell you an element sits past the viewport.

**Result: no horizontal overflow at any width, on any of the four screens.**

Three problems were found at 390px and fixed:

| Problem | Fix |
| --- | --- |
| The tab strip wrapped — "My watchlist" broke onto two lines and the nav read as a broken heading | Labels `nowrap`; the strip scrolls instead |
| "As recorded 1:00 pm" broke after "1:00", reading as two unrelated fragments | The timestamp is one unbreakable phrase |
| The first fix used `flex-wrap` on `.row`, so layout depended on how long each instrument's status text was — some rows two-column, others broken with the price floating oddly | Replaced with a consistent stack below 480px, and inline `textAlign: 'right'` replaced by a `.row-end` class so the media query can override it without `!important` |

The third is worth noting: the first attempt *looked* like a fix in isolation
and only revealed itself as wrong when the three rows were compared against each
other. TCS (short status text) stayed two-column while RELIANCE and INFY broke.
Checking one row would have missed it.

What held up unchanged at every width:

- The comparison screen. `₹2,900.00 / 0.00% / No change since your last check`
  still reads as one argument beside "3 meaningful transitions happened while
  you were away".
- Replay controls — Play, Next and Restart fit one line at 390px and stay
  tappable.
- The ranking explanation stays above the event list.
- "View what happened →" stays primary; "Remove" stays secondary.

### Final state

Feature-complete, audited, and submission-ready. `npm run verify` green at 180
tests across 19 files. Nine commits, clean tree.

---

## Iteration 8 — Front-end pass

**Date:** 2026-09-04
**Goal:** Make the model visible. UI only — no domain, API or schema changes.

### Built

| Change | Why |
| --- | --- |
| Feed grouped by instrument | Ranking and narrative are different questions. Instruments rank by largest move; events inside a story run chronologically. Fixes "recovery above the decline that caused it" **without touching the ranking rule** — F5 is unchanged. |
| `StoryPath` | The shape of what happened, drawn from the events, with a dashed baseline at the starting price. Not a price chart: there is no tick data, so the line has exactly as many vertices as the system actually knows about. Shared by the feed and replay. |
| "Why is this significant?" | Discloses anchor, crossing price, move and threshold, reading `DEFAULT_RULE` from the domain. The brief left the definition of "meaningful" to us; the rule should be checkable, not trusted. |

### Verified

- `npm run verify` → green: **184 tests in 19 files**.
- Inspected at 900px and 390px; no horizontal overflow at either.

Two rendering defects found by looking, not by testing:

1. **The arrow badge stretched** to the full height of an open disclosure,
   turning a small marker into a heavy coloured stripe. Fixed with
   `align-items: start`.
2. **`preserveAspectRatio="none"` rendered circular markers as ellipses** — x
   and y scale by different factors when the viewBox is stretched to fill a
   container. Replaced with vertical ticks using a non-scaling stroke, which are
   immune to it.

### Course corrections

Two test assertions were wrong, not the code, and both were corrected rather
than the behaviour changed:

- `getByText(/2 meaningful changes/)` became ambiguous once the story card also
  showed a count. Scoped to the page subtitle.
- A disclosure assertion expected `9.89%` in the first panel. The first panel is
  the *decline* (9.00%), because events inside a story now run chronologically —
  the assertion was written against the old flat ordering. This was evidence the
  grouping worked.

Also worth recording: `<details>` keeps its content in the DOM whether open or
not, so `getByText` finds collapsed content. The meaningful assertion is the
`open` property, not queryability.

### Deliberately not built

A component library (`InstrumentRow`, `StatusPill`, `PriceDisplay`,
`StoryTimeline`). Three screens do not need one, and it is exactly the
speculative abstraction §2.3 exists to refuse. Consistent tokens and type scale,
yes; a component layer, no.

### Terminology audit and submission walk

The UI copy changed in iteration 8, so the docs were checked against the strings
the app actually renders rather than against memory. Two real mismatches:

1. **The README's walkthrough step 3 was stale.** It described the feed as
   "ranked by significance rather than recency" — true before the grouping
   change, wrong after it. Rewritten to describe both axes, and to point at the
   "Why is this significant?" disclosure, which did not exist when it was
   written. Step 5 now mentions the shape filling in.
2. **The UI used two words for one count.** "2 meaningful changes" on the cards,
   "2 meaningful transitions happened" in the punchline copy — same number, two
   nouns, which invites a reader to wonder whether they are different things.
   Unified on *change* in the UI. *Transition* stays the precise word in
   ARCHITECTURE.md, where precision matters more than plainness.

The demo script artifact was updated to match: beat 3 now describes the grouping,
and a new optional beat covers the threshold disclosure.

Submission walk, both widths, against the running app:

| Step | Desktop (900px) | Phone (390px) |
| --- | --- | --- |
| Watchlist — "3 instruments followed. 2 need your attention." | ✅ | ✅ |
| TCS quiet — "✓ No meaningful changes / ₹3,805.00 / As recorded" | ✅ | ✅ |
| Feed grouped, INFY before RELIANCE | ✅ | ✅ |
| "Why is this significant?" opens | ✅ | ✅ |
| Comparison shows a flat `0.00%` | ✅ | ✅ |
| Replay closes on "The price went nowhere. The story did not." | ✅ | ✅ |

No horizontal overflow at either width on any screen. `db:reset` → `db:seed`
rebuilds the demo; a second `db:seed` refuses.

---

## Iteration 9 — a market that keeps moving

Requested directly, and it reopens a cut (see CUT_LIST.md → *Reopened*). The
honest reading of "make it real time" was built: a **simulator**, not a market
data feed.

### What was built

| | |
| --- | --- |
| `modules/market/catalogue.ts` | The fictional market in one file — 12 instruments, their opening stories, and their volatility. The seed and the simulator read the same file so they cannot drift. |
| `modules/market/simulator.ts` | A mean-reverting random walk per instrument, handed to the ordinary `observeTick`. Seeded PRNG, so a run is reproducible. |
| `modules/market/market.routes.ts` | `GET /api/market-status` (what is running) and `POST` (pause/resume). |
| `GET /api/replay/instruments` | What there is to replay. User-free, like replay itself. |
| `web/usePoll.ts` | Polling with abort, stale-on-error, and an `override` for a write's own response. |
| `web/MarketStatus.tsx` | The header strip: source, pace, log head, what arrived since the page opened, pause. |

Data: **12 instruments, 18 seeded events, 3 deliberately quiet**, plus a second
seeded reader (`priya`) whose watermark sits two thirds along — so "two people
see different things" is demonstrable in the running app, not only in a test.

UI: watchlist split into *Needs your attention* / *Quiet*, a flash on a price
that actually changed, a replay instrument picker, an "arrived while this page
was open" banner, and the threshold disclosure toned down to muted so twenty of
them do not shout.

### Bugs found by looking rather than by testing

1. **The volatility parameter did not mean what it said.** A uniform draw over
   [-w, w] has standard deviation w/√3, so every instrument was 42% calmer than
   its profile claimed and an hour of simulation produced almost nothing.
2. **Mean reversion pointed at the opening price**, which rallied INFY 25% in
   the first few minutes and undid the one story that is supposed to be a
   genuine fall. It now reverts to where each seeded story *ended*.
3. **"Recovered" was applied to every advance.** Correct while RELIANCE was the
   only instrument with one; wrong the moment the catalogue had a genuine rally.
   `moveLabel` now derives the word from the story.
4. **"— you were not watching" repeated twenty times** and had become filler.

### A bug found by a test

`observeTick` rejects an out-of-order tick, correctly. That rejection was inside
a `setInterval`, so a clock stepping backwards would have taken the whole
generator down. It now skips that instrument for that step rather than inventing
a timestamp to satisfy the check.

### Verification

`npm run verify` green — **218 tests, 21 files**. Measured rather than assumed:

| | |
| --- | --- |
| Event rate | ~1 per minute across the market; ~50/hour, stable across three seeds |
| Price drift | ≤4.6% from each story's ending price after 4 simulated hours |
| Quiet instruments | 0 events across 2000 steps, asserted by test |
| Overflow at 390 / 768 / 900px | none, on all four screens |

Live check over CDP: watchlist groups 9/3, feed shows 9 stories in largest-move
order, wording reads *Rose* for TATAMOTORS and *Recovered* for RELIANCE, replay
picker offers 9 stories and RELIANCE still closes on "The price went nowhere.
The story did not."

### Audit pass

The phase was audited against its own claims rather than against memory. Five
findings, all fixed:

| Finding | Resolution |
| --- | --- |
| `usePoll` exposed `loadedAt`, which nothing rendered | Removed. Its one consumer guarded on it with a condition that could never be false, because the no-data case returns earlier. |
| Stale-data-on-failed-poll was documented, never tested | Tests for both the header strip and the watchlist: last good reading stays, the page says it is reconnecting, and it does not fall back to the "never worked" error screen. |
| The replay instrument picker had no client-side test | Three: it opens on the biggest story, switching resets the cursor, and no request it makes carries a `userId` (R5 at the client boundary). |
| The arrival banner had no test | Two: it counts against where the feed stood when the page opened, and it re-baselines on a change of reader instead of counting one user's position against another's. |
| Two doc entries quoted a superseded test count | Corrected to 218. |

Checked and found clean: no `TODO`/`any`/`eslint-disable`/`@ts-ignore` anywhere
in `src` or `test`; no unused CSS classes; every new module exported and wired;
poll intervals in the code match the ones the README quotes (2s / 4s / 8s);
`data/` and `.env` are git-ignored.


---

## Iteration 10 — a Groww-derived visual theme

Requested directly: match Groww's UI/UX. Tokens were pulled from Groww's live
production CSS bundles (fetched and grepped directly, not recalled), applied to
Market Pulse's own screens with no Groww branding anywhere.

- **Color, radius, shadow, weight**: brand green `#04b488`, warm red-orange
  negative `#ed5533`, slate text `#44475b` (not black), gray50/100/200
  neutrals, 8/12/16/999px radius scale, `0 4px 12px rgb(0 0 0 / 8%)` shadow.
  Dark theme uses Groww's own dark tokens directly.
- **Typography**: Inter, the honest open substitute for the licensed
  GrowwSans/Soehne pair, loaded with Groww's own fallback chain behind it.
- **New component**: `.pill` — a tinted, rounded badge for a signed percentage,
  replacing two inline `style={{ color }}` blocks that computed the same
  three-way branch. This is Groww's actual reading pattern for a price change.
- **One bug found by looking**: Inter's wider metrics clipped the "Add a
  symbol" placeholder against a fixed-width input. Fixed with `min-width`.

No markup structure changed beyond the two pill sites; one test regex that
matched a now-split text node was rewritten against the existing
`data-testid="replay-net"` wrapper's `textContent`.

Gate: `npm run verify` green — 218 tests, 21 files, unchanged in count. No
overflow at 390 / 768 / 900px, verified live over CDP after the change.

---

## Iteration 10b — site chrome

Response to "there is nothing like the Groww website": correct, and the reason
was structural, not colour. `groww.in` is a marketing site with a persistent
header (logo, nav, account); this app went straight to the watchlist with no
header at all. Asked which reading of "look like the website" was wanted — a
header/nav bar, or a marketing landing page in front of the dashboard — since
those are very different amounts of scope. The user chose the header.

- **Added** `Header.tsx`: wordmark, the three tabs promoted from the page body
  into permanent nav, and an account chip carrying the existing "Viewing as"
  control. `tab` and `user` remain owned by `App`; nothing new was introduced
  as state.
- **Fixed in passing**: the user switcher was buried inside one tab's action
  row despite `user` being state the whole app reads. Promoting it to the
  header makes switching readers possible from every screen, which is what the
  state's scope already implied.
- **A regression caught by screenshot, not a test**: a single-row header at
  390px clipped "While you were away" to "While you w" — three items sharing a
  row with no width to spare. Fixed with a two-row header under 480px, giving
  the tabs their own full-width line back.

Gate: `npm run verify` green — 218 tests, 21 files, unchanged in count. No
overflow at 390 / 768 / 900px, including the two-row header, verified over CDP.

---

## Iteration 11 — signal context

The user proposed a large feature set ("Signal Context + Attention
Compression", plus ~40 edge cases) framed as coming from an existing research
document. The repository was searched for every distinctive term first
(`relative_strength`, `DISPUTED`, `STALE`, corporate actions, NIFTY) — none
existed anywhere. Asked directly, and the user confirmed: no document, it was
their own synthesis. Given three options (write it up only, build the core
classification, build everything as proposed), the user chose the middle one.

**Built:** `classifySignal(event, benchmarkEvents)` in a new
`domain/market/signal-context.ts` — a pure function, separate from the
significance engine, answering "was this specific to the instrument, or part
of a wider move?" against one benchmark instrument (NIFTY, added to the demo
catalogue). Three verdicts: `market-wide`, `outlier`, `stock-specific`
(the honest default when there's no comparable benchmark move to point to).

**SC1** — classification cannot see the future — is enforced inside the
function itself (it discards any benchmark event later than the one being
classified), not by caller discipline. Both `attention.routes.ts` and
`replay.routes.ts` pass the benchmark's whole history to every event and get
correct, timing-respecting verdicts with no per-event slicing.

**The benchmark is tracked like any instrument, followed by nobody:** it goes
through the ordinary simulator and significance engine (no special-casing),
but the seed doesn't add it to either demo user's watchlist, and the attention
feed excludes its own events from what counts as "unread" — without that
exclusion, a 13th unfollowed instrument would have inflated "N meaningful
changes across N instruments" for everyone.

**Demo data verified before being written down**, same discipline as Phase 9:
a throwaway script confirmed RELIANCE's decline lands `market-wide`, its own
recovery lands `outlier` (bounced back harder than the index), and INFY's -20%
lands `outlier` against NIFTY's -7% — a coherent story, not a forced example.

**UI:** a small tag, shown only for `market-wide`/`outlier` — `stock-specific`
is the majority case and tagging it would repeat the "twenty repeated lines"
mistake from Phase 8. It's still spelled out in full inside "Why is this
significant?", so absence of a tag is never the only way to learn the market
was calm. Replay shows the same tag via a sequence-keyed lookup against the
original response, since `signalContext` doesn't survive the round trip
through the domain's `RecordedMarketEvent` shape (correctly — it's wire-only).

Gate: `npm run verify` green — **240 tests, 22 files** (+22: 11 domain, 5
attention-feed integration, 3 replay integration, 3 web). No overflow at 390 or
1000px, verified live: NIFTY tracked and simulated, absent from every
watchlist, absent from the feed, and correctly classified against in both the
feed and replay.

---

## Iteration 12 — full-system regression audit

A break-it pass across every phase, requested explicitly as a regression test
rather than a feature pass: no new scope, no refactor, no test weakened.

**Found and fixed: F6.** `POST /attention-feed/ack` never checked
`throughSequence` against the actual log head. A client sending an inflated
number would have the watermark stored there anyway, silently pre-marking
every future event up to that number as read the instant it was appended — a
larger, silent version of the exact bug F1 exists to prevent. Fixed by
clamping to `events.head()`, the same validation category the route already
applied to negativity and integer-ness. Test written first, per §2.6.

**Found and reported, not fixed:** `POST /watchlist` has no restriction on
which instrument a user follows. A user can manually add `NIFTY` to their own
watchlist (confirmed live against the running API), where it behaves like any
other row. "NIFTY cannot appear in a watchlist" holds only because the seeded
users never add it, not because the system prevents it — whether it should be
rejected outright is a product decision outside this audit's scope to make
silently.

**Mutation-tested Signal Context specifically**, as the newest code: the SC1
future-filter, the outlier-factor comparison, the direction check, and the
benchmark-exclusion filter were each broken and confirmed to fail their tests.
Two pre-existing significance-engine invariants were spot-mutated too, to
confirm nothing regressed underneath the new feature.

**13 new domain tests** closed explicit checklist gaps: the outlier boundary
on both sides, the full direction/magnitude combination grid, a zero-magnitude
benchmark (no division exists in the function to produce NaN/Infinity), a
benchmark starting late, a benchmark with a gap, and an order-independent tie.

Gate: `npm run verify` green — **255 tests, 22 files**. Live E2E re-verified at
390/768/900/1000px — no overflow, StoryPath ticks confirmed vertical by
direct SVG attribute inspection, RELIANCE's Market-wide/Outlier tags
confirmed exactly as designed, NIFTY confirmed absent from every watchlist and
feed card while still a valid Replay target, the golden scenario's Play-through
re-verified end to end.
