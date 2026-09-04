# CLAUDE.md

Working agreement for AI agents on this repository. Read this before making any
change. **Update it at the end of every iteration** (see [Iteration log](#iteration-log)).

---

## 1. What this project is

**Market Pulse** answers one question:

> *"What happened while I was away, and why did it matter?"*

A watchlist compares now against a snapshot and silently discards the middle.
Market Pulse keeps meaningful transitions as an append-only history and reads
that history **per user**, from where each user last looked.

Two people opening the app at the same instant should see different things.
Any design decision that breaks that property is wrong, however clean it looks.

- [ARCHITECTURE.md](ARCHITECTURE.md) — domain concepts, boundaries, deferred complexity
- [CUT_LIST.md](CUT_LIST.md) — what we are deliberately not building
- [PROGRESS.md](PROGRESS.md) — status by phase

---

## 2. Non-negotiable rules

### 2.1 Stay in scope

Build **exactly** the phase that was asked for. Do not add the next phase
because it seems obvious, and do not add UI, endpoints, or tables that nothing
asked for. Unrequested work is architectural drift, and it is expensive to
reverse.

If something outside the current scope looks necessary, **say so and stop** —
do not build it speculatively.

### 2.2 The dependency rule

```
web  ─┐
      ├─→  domain        (domain depends on nothing)
server ┘
```

`domain` imports no framework, no `node:` built-in, and neither sibling.
`server` and `web` never import each other. This is enforced by ESLint — a
violation fails `npm run lint`, so do not work around the rule, fix the design.

### 2.3 Abstract only on the second implementation

`Clock` is a port because replay and deterministic tests genuinely require one.
It is the exception, not the template.

**Introduce an abstraction when a real second implementation appears, not when
one is imaginable.** No `MarketTickRepositoryPort` before there is a
`MarketTick`. No factories, no provider registries, no base classes added "for
later". Premature indirection is the most likely way this codebase degrades.

### 2.4 Every change passes the gate

```bash
npm run verify   # format:check + lint + typecheck + test + build
```

Run it before reporting a task complete. If it fails, fix it — do not report
completion with a red gate and do not weaken a rule to make it pass.

### 2.5 Do not refactor what is working

The following are settled decisions. Do **not** change them without being asked:

| Settled | Do not propose |
| --- | --- |
| Express | Fastify, Nest, Hono |
| SQLite (`node:sqlite`) | Postgres, an ORM, a native driver |
| npm workspaces | Turborepo, Nx, pnpm |
| Source-consumed packages | TS project references, build-then-import |
| Modular monolith | Microservices, a broker, Redis |

Each is recorded with reasoning in [ARCHITECTURE.md](ARCHITECTURE.md).

### 2.6 Bugs get regression tests

Fixing a defect means: understand the root cause → fix → **add a test that fails
without the fix**. A fix with no test is half a fix.

### 2.7 Honest claims only

Do not overstate portability, coverage, or completeness — in code comments, in
docs, or in a summary to the user. "Postgres is a driver swap" was wrong;
"confined to `src/db/`, still needs a dialect pass" is right. Test *count* is
not a quality signal and should never be quoted as one.

### 2.8 Never weaken the gate to make it pass

When `npm run verify` fails, fix the code. Do **not**:

- change a test's expectation to match what the code currently does
- delete or skip a failing test
- add `// eslint-disable` or loosen a lint rule
- widen a type, add `any`, add a non-null `!`, or relax a `tsconfig` flag

A failing check is information. Silencing it destroys the information and leaves
the defect. If a rule genuinely is wrong, say so explicitly, explain why, and
get agreement — never change it silently as part of unrelated work.

### 2.9 Every feature names the invariant it serves

Before building anything, state which product invariant it exists to uphold:

```
Feature:  Read watermark
Upholds:  Each user's "what I missed" is independent of every other user's.
```

```
Feature:  Append-only event log
Upholds:  A meaningful transition stays visible even after the price
          returns to where it started.
```

If a feature cannot be traced to an invariant, it is not part of this product.
This is the check against feature accumulation — the failure mode where each
addition is individually defensible and the whole becomes unfocused.

### Product invariants

The four the system exists to guarantee:

| # | Invariant |
| --- | --- |
| **I1** | A meaningful event is independent of the final price. Recovery does not erase history. |
| **I2** | Events are append-only. Once generated, a record is never mutated or deleted. |
| **I3** | The significance engine is deterministic and pure. Same ticks in, same events out, always. |
| **I4** | Each user consumes events independently. One user reading changes nothing for another. |

---

## 3. How the code is organised

```
packages/
├── domain/   Pure TypeScript: types, rules, wire contracts. No I/O.
├── server/   Express API, SQLite persistence, migrations, composition root.
└── web/      React + Vite client.
```

Inside `server`:

| Path | Responsibility |
| --- | --- |
| `src/config.ts` | Environment, read once. Every value has a working default. |
| `src/db/` | The only place that knows we use SQL. Connection + migrations. |
| `src/db/migrations/` | Numbered `.sql`, forward-only, applied in filename order. |
| `src/modules/<feature>/` | One folder per feature slice, mounting its own router. |
| `src/app.ts` | Composes modules into an app **without binding a port**. |
| `src/index.ts` | The only file that opens sockets or reads the environment. |

New feature work goes in a new `src/modules/<feature>/` folder plus a new
numbered migration. Do not add tables to `001_init.sql`.

---

## 4. Conventions

**Language.** TypeScript, ESM, `strict` plus `noUncheckedIndexedAccess` and
`exactOptionalPropertyTypes`. Relative imports carry the `.js` extension.

**Comments.** Comment *why*, not *what*. A comment that restates the code is
noise; one that records a decision or a non-obvious constraint earns its place.
Match the density of the surrounding file.

**Time.** Epoch milliseconds (`Timestamp`). Domain code never calls `Date.now()`
— take a `Clock`. This is what makes replay and "since you last checked"
testable.

**Money and prices.** Integer minor units (paise) via the branded `PriceMinor`
type — never floating point. Magnitudes are basis points (100 bps = 1%). Build
prices with `paise()` or `rupees()`; `toRupees()` / `toPercent()` are for
display only and must never be compared against. Decided in Iteration 2; see
ARCHITECTURE.md → *Prices are integers*.

**SQL.** Hand-written, plain, parameterised. No SQLite-only syntax above
`src/db/`.

**Tests.** `domain` — pure unit tests, no mocks. `server` — the real Express app
against in-memory SQLite via `supertest`. `web` — Testing Library in jsdom.
Prefer a real in-process dependency over a mock.

**Errors.** Fail loudly at startup on bad configuration. Never swallow an error
to keep a request alive.

---

## 5. Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | API + web client together |
| `npm run dev:server` / `dev:web` | One side only |
| `npm test` / `npm run test:watch` | All suites |
| `npm run lint` / `lint:fix` | Type-aware ESLint, incl. boundary rules |
| `npm run format` / `format:check` | Prettier |
| `npm run typecheck` | `tsc --noEmit`, all packages |
| `npm run build` | Production web build |
| `npm run db:migrate` | Apply migrations without starting the server |
| **`npm run verify`** | **The gate. All of the above.** |

Requires **Node >= 22.5** (`node:sqlite`). Ports: API 4000, web 5173, `/api`
proxied so there is no CORS to maintain.

---

## 6. Working agreement for each task

1. Read this file and the phase description. Confirm the scope.
2. Make the change. Keep the diff to the scope.
3. Add tests that would fail without the change.
4. Run `npm run verify`.
5. Update [PROGRESS.md](PROGRESS.md), and [ARCHITECTURE.md](ARCHITECTURE.md) if
   a boundary or decision moved.
6. **Append an entry to the iteration log below.**
7. Report honestly: what was built, what was skipped, what is uncertain.

---

## 7. Roadmap

| Phase | Content | State |
| --- | --- | --- |
| 1 | Foundation: workspaces, domain/server/web, SQLite + migrations, health endpoint, smoke tests | ✅ done |
| 1.5 | Quality gate: ESLint, Prettier, enforced boundaries, `verify` | ✅ done |
| 2 | Domain model + golden scenario | ✅ done |
| 3 | Persistence for the event log and watermarks | ✅ done |
| 4 | Attention feed API + "Since you last checked" | ✅ done |
| 5 | **Watchlist context, or simulated ingestion** | ⏳ next |
| 6 | Replay / demo mode | ✅ done |

### Next phase scope

The engineering is done; what remains is making the product legible to someone
seeing it for the first time. Two candidates:

**Watchlist context.** The feed answers "what deserves attention". It cannot
answer "what am I watching" — an instrument that never crosses the threshold
(TCS in the seed) appears nowhere, which is *correct for a feed and wrong for a
watchlist*. That distinction is worth making explicit:

```
Watchlist       = what the user cares about
Attention feed  = what changed enough to deserve attention
```

Needs a price source for quiet instruments, which is the first thing the log
alone cannot supply.

**Simulated ingestion.** Feed ticks through `observeTick` on a timer and append
what it emits. This is a real phase, not a garnish: duplicate ticks,
out-of-order arrival, staleness, what survives restart, and where market state
lives between ticks are all undecided.

Constraint either way: stop adding backend cleverness. The remaining risk is
presentation, not correctness.

---

## Iteration log

Newest first. One entry per iteration: what changed, and what a future agent
needs to know that the diff does not say.

### 2026-09-04 — Phase 5: replay

Watch the story instead of reading it.

- **Added** `domain/replay/replay.ts` — a cursor over a frozen timeline.
  `createReplay`, `advance`, `restart`, `revealed`, plus `netChangeAtCursor`,
  which is what makes the demo land: the snapshot number moves and returns to
  0.00% while the revealed events stay.
- **Added** `GET /api/replay?instrumentId=…` and a Replay tab with three
  controls — Play, Next, Restart. No seek bar, no playback rates.
- **R1 and R5 are structural.** The replay route takes no `WatermarkStore` and
  the request cannot name a user, so it has no way to advance one.

Mutation-tested. Ordering by timestamp, unfreezing the timeline, and leaking
other instruments each failed. The first R5 mutation was a no-op on my part and
is reported as such; breaking R5 properly required adding watermark access at
the app-wiring level, which failed 2 tests immediately.

**On R4:** there is no `Clock` in replay, deliberately. Replay is cursor-based,
so no wall-clock read exists to inject; the only real time is the UI's
auto-advance interval, which is a component parameter. Threading a `Clock`
through to satisfy the letter of the rule would be the ceremony §2.3 forbids.

Gate: `npm run verify` green — 142 tests, 18 files. Verified live: replaying
twice leaves 0 watermark rows.

### 2026-09-04 — Phase 4: attention feed and the first product screen

The phase where the architecture becomes visible.

- **Added** `GET /api/attention-feed` and `POST /api/attention-feed/ack`. The
  split is the point: reading never writes (F1). Advancing on read would be the
  natural shortcut and a correctness bug — a refresh or a second tab would
  consume events the user never saw, unrecoverably.
- **Added** `attention/ranking.ts` (magnitude desc, tie-break by sequence — a
  total order, so F5 does not depend on sort stability) and `attention/feed.ts`
  (`summariseUnread`, which computes **what a traditional watchlist would have
  said** from the same events).
- **Added** the "While you were away" screen with a Traditional / Market Pulse
  toggle. Same data, two answers: `0.00%` and "2 meaningful changes".
- **Added** `npm run db:seed` so the screen has something to show.

F1–F5 all have named tests, mutation-checked: advancing on GET, ignoring the
watermark, ranking by recency, and flipping `MAX` to `MIN` each produced
failures.

Gate: `npm run verify` green — 111 tests, 15 files. Verified live, not only in
tests: the running API returns `netChangeBps: 0` alongside
`meaningfulChanges: 2` for RELIANCE.

Wording constraint carried from the event contract: `latestPrice` is the latest
price *the log knows about*, not the live price. UI labels say "as recorded".

### 2026-09-04 — Phase 3: persistence

The domain from Phase 2, given a durable home. Its behaviour did not change.

- **Locked two decisions first.** (1) `EventId` is now separate from `sequence`
  in the domain: identity vs. position. Ids come from an `EventIdSource` port —
  justified by two real implementations, `uuidEventIds` in server and
  `sequentialIds()` for tests — because the domain may not touch randomness.
  (2) `MeaningfulMarketEvent` now documents its contract: it is a
  **threshold-crossing move measured from the active anchor**, explicitly not
  "the full move" of a run. Any UI copy built on it must not promise more.
- **Added** migration `002`, `modules/market/event-store.ts`,
  `modules/attention/watermark-store.ts`, `src/ids.ts`.
- **Append-only is enforced twice**: the store has no update/delete, and the
  database refuses both via triggers.
- **Monotonicity is enforced in SQL** (`MAX(excluded, existing)` in the upsert),
  so a stale writer cannot un-read — no read-then-write race.
- **AC1 uses a real child process**, not a reopened handle: a fixture writes the
  golden scenario and exits, then the test opens the file and reads it back.

All five acceptance criteria have tests, mutation-checked: removing `MAX()`,
neutering the immutability trigger, dropping `AUTOINCREMENT`, and making the
child process write nothing each produced failures.

Gate: `npm run verify` green — 78 tests, 11 files.

Two deviations from the sketched schema, both to avoid re-introducing
imprecision at the storage boundary: `magnitude_bps INTEGER` rather than
`movement_percent REAL`, and `occurred_at INTEGER` rather than TEXT. Watermarks
are keyed by `user_id` alone — there is no watchlist entity yet, so the column
would be a placeholder constant. All three are written up in ARCHITECTURE.md.

### 2026-09-04 — Phase 2: domain model and the golden scenario

The product's core, as pure functions. No HTTP, no SQL, no React.

- **Added** `market/`: `money` (branded `PriceMinor`, basis points),
  `instrument`, `tick`, `event`, `significance` (the engine), `log` (the
  append-only sequence). **Added** `attention/`: `user`, `watermark`.
- **Added** `golden-scenario.test.ts` — 100 → 96 → 91 → 95 → 100, user away,
  user returns. It asserts the premise (a snapshot comparison genuinely reports
  nothing) before asserting the product answer, so the scenario cannot quietly
  stop proving anything.
- **Decided** the significance rule: threshold from a moving *anchor*, not from
  the previous tick, re-anchoring on emission. Its known limitation — a staged
  move is reported as several smaller events — is written down in
  ARCHITECTURE.md rather than left to be discovered.
- **Decided** money representation: integer minor units, basis points. Recorded
  in §4.

Each invariant has a test block named for it (I1–I4). Those tests were
**mutation-tested**: the threshold comparison, the anchor, the re-anchoring, and
the log's freezing were each broken in turn, and in every case the matching
tests failed. A test that has never failed is not known to work.

Gate: `npm run verify` green — 59 tests, 9 files.

Not done, deliberately: no persistence, no endpoints, no UI, and no significance
*ranking* (that belongs with the feed in Phase 4). `observeTicks` handles one
instrument; multi-instrument fan-out arrives when something needs it.

### 2026-09-04 — Phase 1.5: quality gate and audit fixes

Added the mechanical gate before the feature surface grows, and fixed three
defects found by reading the Phase 1 code rather than its summary.

- **Added** ESLint 10 (flat config, type-aware) + Prettier, and root scripts
  `lint`, `lint:fix`, `format`, `format:check`, `verify`.
- **Added** import-boundary rules encoding the dependency rule. Verified by
  probe: a `node:fs` import inside `domain` fails lint.
- **Added** root `tsconfig.json` so repo-level config files belong to a project
  (required by `projectService`).
- **Fixed** `config.test.ts` asserted the clone directory was literally named
  `market-pulse`. It would have failed on a reviewer's machine — the same class
  of environment-dependence the test existed to prevent.
- **Fixed** the health contract promised `version` came from `package.json`
  while `app.ts` hardcoded `'0.0.1'`. Added `src/version.ts`; `version` is now a
  **required** `createApp` option, so no stale default can drift.
- **Softened** the Postgres portability claim in `db/connection.ts` and
  ARCHITECTURE.md to name the work a migration would still require.
- **Documented** the abstraction rule (§2.3) and the quality gate.

Gate: `npm run verify` green — 12 tests, 4 files.

Not done, deliberately: no CI workflow (no remote yet), no pre-commit hook (the
gate is a command, not a trap), no product code.

### 2026-09-04 — Phase 1: foundation

npm workspaces monorepo; `domain` / `server` / `web`. Express 5 + `node:sqlite`
with forward-only SQL migrations that run on boot. `GET /api/health` reports
version, time, and database reachability. Vitest across all three packages, with
the server suite driving the real app against in-memory SQLite.

Bug found and fixed during the phase: a relative `DATABASE_URL` resolved against
`process.cwd()`, so the database landed in a different place depending on where
the script was invoked. `config.ts` now anchors relative paths to the repo root.
