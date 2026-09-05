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
- [AUDIT.md](AUDIT.md) — full read of the repository: what exists, why, what the
  audit found, and the strategy from here. Start here if you are picking this up
  cold.

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

Four more sets were added as the product grew. Each has a named test block, and
ARCHITECTURE.md records how each one holds:

| Set | Covers |
| --- | --- |
| **F1–F5** | The feed: reading never acknowledges, acknowledging is monotonic, the feed is scoped to the watermark, ranking is deterministic |
| **F6** | Acknowledging cannot advance past events that exist — a `throughSequence` beyond the log head is **refused**, leaving the watermark untouched |
| **R1–R5** | Replay: it reads history and cannot rewrite it, is deterministic, follows sequence order, and acknowledges nothing |
| **W1–W5** | The watchlist: membership is independent of events, attention is derived not stored, removal preserves history, changes survive restart |
| **W6** | The benchmark cannot be added to a watchlist — refused at the route, before anything is written, case-insensitively |
| **SC1** | Signal context: a benchmark event after the one being classified cannot affect its verdict — enforced inside `classifySignal` itself, not by a caller convention |

The simulator has its own block in `packages/server/test/simulation.test.ts`. It
asserts the thing that actually matters about generated data: that it gets no
privilege real data would not have. Events only through the threshold, magnitudes
that recompute, a reproducible seed, quiet instruments that stay quiet over two
thousand steps, and read positions that do not move.

**Several are structural rather than behavioural** — the replay route holds no
`WatermarkStore` and the watchlist store cannot reach `market_events`, so those
invariants cannot be violated without changing application wiring. Preserve that
shape: passing a store into a module "for convenience" can silently downgrade a
structural guarantee into one that merely happens to hold.

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

**Freshness claims.** The UI never invents one. `GET /api/market-status` says
what the server is doing and the client repeats it. The word *live* is banned
from the interface — prices are *"as recorded"*, the source is *simulated*, and
three tests assert the word stays out. If a future change makes a price genuinely
live, the contract's `MarketSource` union is where that starts.

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

**React state.** Before adding state, ask whether it can be *derived* from what
you already have. Never call `setState` inside an effect to correct other state
— that is what causes cascading renders, and the lint rule that catches it has
now fired twice in this repo. "Playing but finished" was not a state the replay
component could be in; it is computed. Both failures were this one mistake.

**Refs may not be read during render.** `react-hooks/refs` enforces it. The
"what was this value last render" pattern therefore uses **state adjusted during
render**, not a ref — see `Watchlist.tsx`'s price flash and `App.tsx`'s arrival
counter. Two rules for that pattern, both learned the hard way:

- Guard on something that is *structurally* different after the write. A guard
  of `if (x === undefined) setX(response.field)` loops forever the moment
  `response.field` is itself undefined — which is exactly what a test stub that
  answers every URL with the same body will hand you. Wrap it: `setX({ field })`.
- Key it on the value from the *response*, not from the input that triggered the
  request. A poll keeps the previous answer on screen until the next lands, so
  the input has already changed while the data has not.

**Parsing in tests.** A `RequestInit` body is `BodyInit | null`, so
`String(body)` risks `[object Object]`. Assert `typeof body === 'string'` first,
then parse. This has been rediscovered twice; do not rediscover it a third time.

**Narrowing.** The project avoids both `!` and `as T` for removing `undefined`.
Use a `required(value, what)` helper or an explicit `if (x === undefined) throw`.
ESLint's `non-nullable-type-assertion-style` will suggest `!` over a cast — the
answer to that conflict is to need neither.

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
| `npm run db:reset` | Delete the database and reseed from scratch |
| **`npm run verify`** | **The gate. All of the above.** |

`MARKET_SIMULATION=off` runs on seeded data alone; `MARKET_SIMULATION_INTERVAL_MS`
changes the pace. Both are documented in `.env.example`.

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
| 5 | Watchlist + instrument snapshots | ✅ done |
| 6 | Replay / demo mode | ✅ done |
| 7 | Demo polish, reviewer journey, responsive pass | ✅ done |
| 8 | Front-end pass: grouped stories, story path, threshold disclosure | ✅ done |
| 9 | A market that keeps moving: simulator, polling, 12 instruments | ✅ done |

### The project is feature-complete

Every part of the brief is answered: create and manage a watchlist, see the
latest market information, return later and find out what changed. All phases
are done, including the responsive pass and the live pass.

**Do not add features.** Multiple watchlists, auth, notifications, WebSockets and
portfolio holdings are each defensible and none makes the submission better than
a clear demo of what already works. Each also adds a new way for the demo to
fail.

**On the simulator specifically.** Phase 9 added generated prices, at the user's
explicit request and against the earlier decision recorded in CUT_LIST.md. It is
a *generator*, not ingestion: it invents prices and hands them to the ordinary
significance engine. It must never grow into an ingestion pipeline (dedupe,
out-of-order handling, backpressure, provider health) without that being asked
for as its own phase.

If more work is wanted, it belongs in one of these:

- Visual refinement of the existing screens.
- Tightening the walkthrough in the README.
- Fixing anything a real reviewer trips over.

### How to inspect the UI without adding a dependency

Playwright and Puppeteer are **not** dependencies and should not become ones.
Chrome can be driven directly over CDP using Node's built-in `WebSocket` client:

```bash
npm run db:reset && npm run dev            # app on :5173, API on :4000
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu --remote-debugging-port=9222 \
  --user-data-dir=/tmp/mp-chrome about:blank &
```

Then connect to the target from `http://localhost:9222/json`, and use
`Emulation.setDeviceMetricsOverride` to set a width, `Runtime.evaluate` to click
by button text, and `Page.captureScreenshot` to capture. Roughly 60 lines. This
found two hierarchy problems and three responsive problems that the 27 web tests
could not — **look at the screens after changing them.**

A useful check to run alongside the screenshots, since a screenshot will not tell
you about horizontal overflow:

```js
document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
```

### Verified widths

390px (phone), 768px (tablet) and 900px (desktop), across all four screens: no
horizontal overflow at any of them. Below 480px the row layout stacks and the
tab strip scrolls rather than wrapping. If you change `.row`, `.tabs` or
`.row-end`, re-check those widths.

---

## Iteration log

Newest first. One entry per iteration: what changed, and what a future agent
needs to know that the diff does not say.

### 2026-09-05 — Phase 13: second audit, and eleven fixes

A break-it pass done by **running** the software rather than reading it, and the
remediation that followed. Full write-up in [CLAUDE2AUDIT.md](CLAUDE2AUDIT.md);
this entry records what a future agent needs that the diff does not say.

**The headline bug was in the newest feature.** `classifySignal` had no bound on
how old its benchmark reference could be, so a NIFTY move classified stock moves
as `market-wide` for as long as the index stayed still — measured live at 72.9
minutes. The general lesson is the one worth keeping: **SC1 proved a benchmark
from the future cannot leak in, and nobody asked the mirror question about the
past.** Every fixture in the file sat at `T0 - 1`, so the suite was structurally
incapable of seeing it. When a test block proves a bound in one direction, ask
what the other direction would look like.

**A regression that only existed because two screens were never compared.**
The watchlist showed the live snapshot and the feed showed the last event's
price; with the simulator on they diverged by up to 2.14%, and RELIANCE said
"but the price came back" beside a price it had not come back to. Both screens
had been reasoned about carefully — separately. The rule "never let the UI claim
more than the data model knows" had only ever been applied *within* a screen.
Phase 9 made two previously-identical quantities diverge and nothing re-checked
the pairs. **After adding a live data source, re-read every screen that displays
the thing it made move.**

**The feed cap has a trap in it.** Events are ranked by magnitude, so a page is
not a prefix of the log and no sequence describes "the 50 shown". A single
watermark cannot express a non-prefix acknowledgement, and acking only the page
would strand the rest forever. It works because the button already says "Mark
all as read" and the summary counts deliberately stay uncapped. Do not
"simplify" either of those.

**`throughSequence` now comes from the unfiltered read**, not from a second
`head()` call. The subtlety: derive it from the *benchmark-filtered* list and a
trailing run of NIFTY events becomes permanently unreachable. Test `F6b` pins it.

**Three tests changed expectations, all deliberate behaviour changes** (replay's
default story, the round-trip wording, the traditional-view copy). Two more were
*strengthened* rather than adjusted: `AC3` now asserts "no mutating operation"
directly instead of relying on an enumeration, and the round-trip block now
covers all three cases. CLAUDE2AUDIT.md §3 justifies each one individually,
because §2.8 requires that.

**A finding I got wrong, corrected.** I first reported "zero aria-live regions";
the arrival banner already used `role="status"`. What actually lacked
announcement was the market-status strip and the attention count. Live regions
were added to those two lines only — not to the prices or the ticking clock,
because a live region over everything that moves is unusable.

**Known and left open:** the feed's *payload* is bounded (19 KB at any log size)
but its server-side *read* is not — the summary counts must cover the whole
window, so latency still grows with the log. Fixing it means a SQL aggregate.
And there is still no auth; what changed is only that the README's framing of it
understates the exposure, which is cross-user *writes*, not just reads.

**Also added:** `PITCH.md` (a required submission deliverable that did not
exist), `.github/workflows/verify.yml` (the gate had never been run by anything
but a person), `GET /api/instruments` plus a datalist, a symbol shape check, an
Express error handler, and a complete ARIA tabs pattern.

Gate: `npm run verify` green — **315 tests, 25 files** (+49). Benchmarked before
and after: watchlist latency went from linear in log size (3.2 / 9.1 / 26.4 ms)
to flat (1.9 / 1.1 / 1.7 ms); feed payload from 4,405 KB to 19 KB at a
20,000-event log. Re-verified live, not only in tests.


### 2026-09-05 — Phase 12c: W6 made case-insensitive

A correction to my own call in 12b, on the user's reaffirmation.

12b left the benchmark guard case-**sensitive**, reasoning that nothing else in
the system folds case, that `nifty` is a genuinely different and inert
instrument, and that folding case in one place would be the system's only
normalization rule. That reasoning is still true as far as it goes. It was also
the wrong trade: live, `POST /watchlist {"instrumentId":"nifty"}` returned 201
and put a junk row on the list. **A boundary with a one-keystroke bypass is not
a boundary**, whatever is technically true about which data it reaches.

The guard now compares case-insensitively. The asymmetry with storage is
deliberate and tested from both sides: folding case in the *guard* only widens
what the boundary refuses (safe), while folding case in *storage* would be a
system-wide decision with real consequences (two spellings silently becoming
one row). A test asserts an ordinary lowercase symbol is still stored exactly
as given, and a mutation that uppercases on the way into the store fails it.

The general lesson, worth keeping: when a rule exists specifically to be
unbypassable, "the bypass doesn't reach anything important" is the wrong
question. The right one is whether the rule can be trivially sidestepped at
all.

Gate: 266 tests, 22 files. Four mutations on this guard, all caught: reverting
to case-sensitive, removing the guard, dropping the trim, and over-folding into
storage.

### 2026-09-05 — Phase 12b: two-invariant patch (W6, and F6 corrected)

Closing the two items Phase 12 left open. No features, no refactor.

**W6 — the benchmark cannot be followed.** `POST /watchlist` now refuses
`NIFTY` before anything is written. Enforced in the *route*, deliberately not
in `WatchlistStore`: the stores stay generic and key by exact string, and
route-level is where every other business rule about this endpoint already
lives. This mirrors `attention.routes.ts`, which likewise knows the benchmark
constant while `EventStore` does not. Adding benchmark-awareness to the store
would have been the "generic benchmark subsystem" this patch was told not to
build.

**On case: the check is case-sensitive, on purpose.** `instrumentId()` only
trims; nothing in this system folds case, and the event, snapshot and
watchlist stores all key by the exact string. So `"nifty"` is a genuinely
*different* instrument here — inert, never observed, no events, and with no
path to the real benchmark's history. A test asserts exactly that, rather than
asserting a rejection that would have required inventing the system's only
case-folding rule. The guard compares the *normalized* value
(`instrumentId(instrument)`), so `"  NIFTY  "` is still caught — a mutation
that compares the raw string instead fails that test.

**F6 was wrong and is now corrected: refuse, do not clamp.** Phase 12 clamped
`throughSequence > head` to the head. Re-reading the contract showed that was
the wrong half of a false symmetry:

- A *stale* ack (below the watermark) is clamped by `MAX()` and answered 200 —
  right, because it **consumes nothing**. That is F3's whole rationale: "a
  no-op rather than an error."
- An ack *above the head* is the opposite. Clamping it advances the watermark
  over events that were never shown — the exact failure F1 exists to prevent,
  made permanent because watermarks only move forward. F3's rationale does not
  transfer, because it stops being a no-op.

Two more things settled it, both pre-existing rather than preference: the route
already answers 400 for other invalid `throughSequence` values (non-integer,
negative), and a value beyond the head is the same category of "not a valid
position in this log". And the client already ships the copy *"Nothing was
marked as read. Your position is unchanged."* — true under refusal, a lie under
clamping. `head()` only grows, so a legitimately-obtained value can never
exceed a later head; reaching this branch means a buggy client, a forged
request, or a tab holding a feed from a database since reset — and in that last,
genuinely reachable case, refusing is what leaves the user's unread events
intact.

Five mutations run against the two invariants, all caught: removing the NIFTY
guard, comparing the raw string instead of the normalized one, removing the F6
guard, reverting F6 to clamping, and an off-by-one (`>=` instead of `>`) that
would have broken every ordinary acknowledgement.

Gate: `npm run verify` green — **261 tests, 22 files** (+6). Live E2E
re-verified.


### 2026-09-05 — Phase 12: full-system regression, and one real bug (F6)

A break-it audit across every phase, not just the newest one: boundary values,
mutation testing on the rules added in Phase 11, a static import-boundary
sweep, and a fresh live pass over the running app. Explicitly not a new
feature pass — no scope was added, nothing was refactored, no test was
weakened to pass.

**F6, a real gap, fixed.** `POST /attention-feed/ack` validated that
`throughSequence` was a non-negative integer, but never checked it against
`events.head()`. A client sending `throughSequence: 999999` against a
20-event log would have the watermark stored at 999999 — silently marking
every future event up to that number as already read the instant it was
appended, for as long as the log stayed under that number. This is a larger,
silent version of exactly what F1 exists to prevent, reachable by any client
that sends a bad number, not only a compromised one. Fixed by clamping to
`events.head()` before storing, using data the route already had in scope —
no new architecture, the same category of validation the route already did
for negativity and integer-ness. A failing test was written first
(`F6: acknowledging cannot advance past events that exist`), then the fix,
per §2.6.

**One finding reported, not silently fixed.** `POST /watchlist` places no
restriction on which instrument a user follows, so a user can manually add
`NIFTY` to their own watchlist via the API — confirmed live, not theoretical.
It then behaves like any other row (its own price, its own meaningful-change
count), because `buildWatchlist` receives the unfiltered event log. This means
"NIFTY cannot appear in a user's watchlist" is true only because the two
seeded demo users never add it, not because the system prevents it. Whether
the API should reject this outright is a product decision (should someone be
allowed to deliberately follow the index?) that touches a route Phase 11 did
not build for this purpose — reported rather than silently patched, per this
audit's own instruction to stop at anything requiring a new decision.

**Signal Context (Phase 11) mutation-tested specifically**, since it was the
newest and least battle-tested code: the SC1 future-filter, the outlier-factor
comparison operator, the direction-equality check, and the benchmark-exclusion
filter in `attention.routes.ts` were each broken in turn and confirmed to fail
the matching tests. Two pre-existing significance-engine invariants (threshold
`>=`, re-anchoring) were also spot-mutated to confirm Phase 11 changed nothing
about them.

**Test additions**, all closing checklist items the existing suite didn't yet
name explicitly: the outlier boundary on both sides (not just the exact
value), the full stock/benchmark direction-and-magnitude combination grid, a
zero-magnitude benchmark (confirms no division exists in `classifySignal` to
produce `NaN`/`Infinity` from), a benchmark that starts after the stock event,
a benchmark with a gap, and a same-timestamp tie resolved order-independently.

Gate: `npm run verify` green — **255 tests, 22 files** (+15 over Phase 11: 13
domain boundary/combination tests, 2 F6 route tests). Live E2E re-verified at
390/768/900/1000px: no overflow, `StoryPath` ticks confirmed vertical
(`x1 === x2`) via direct SVG attribute inspection, RELIANCE's tags confirmed
`Market-wide`/`Outlier` exactly as designed, NIFTY confirmed absent from every
watchlist row and every feed story card while still selectable in Replay (by
design), the true caught-up empty state and the golden-scenario Play-through
both re-verified end to end.

### 2026-09-05 — Phase 11: signal context

### 2026-09-05 — Phase 11: signal context

The user proposed a much larger feature set framed as coming from "the actual
research document." Before writing anything, the repository was searched for
every term in the proposal (`relative_strength`, `DISPUTED`, `STALE`/`CLOSED`,
corporate actions, NIFTY, market-wide, attention compression) — none existed
anywhere, and the user confirmed there was no document: it was their own
synthesis, presented with more authority than it had. **Verify before building
on a claimed source, even when the claim comes from the user** — asking "where
does this live" cost one exchange and avoided building roughly fifteen
unscoped subsystems on a premise that did not exist. Offered three concrete
options rather than picking one; the user chose the smallest: one benchmark
instrument, one classification, no data-quality states, no attention
compression.

**What was built.** `domain/market/signal-context.ts`: `classifySignal(event,
benchmarkEvents)` -> `'market-wide' | 'outlier' | 'stock-specific'`. A
*separate*, later function over recorded events, not a change to the
significance engine -- the engine stays a pure fold over one instrument's own
ticks (I3), and classification is the next question asked afterward, over two
instruments' histories. Absence of a comparable benchmark move is not evidence
of a market-wide move; it is evidence of nothing, and defaults to
`stock-specific` rather than an invented middle state.

**SC1 is structural, the same way R1/R5 are.** The function accepts the
benchmark's *entire* history, including events after the one being classified,
and filters to `occurredAt <=` internally. A caller cannot get this wrong by
handing it too much data -- there is no slice a route or a test could
mis-compute. Replay and the live feed call it identically, with no separate
"don't use future context" logic in either route, because the guarantee lives
in the one function both of them call.

**NIFTY is a `BENCHMARK_SYMBOL` constant in `catalogue.ts`, not a `role` field
on every entry** -- exactly one caller needs to know which instrument is
special. Tracked and simulated exactly like every other instrument (no engine
special-casing); excluded from the seed's watchlist adds (it is market context,
not something either reader chose to follow) and from the attention feed's
`unread` (a benchmark move is not, itself, something to read) -- both in
`attention.routes.ts`, both a few lines, both necessary for "12 instruments
followed, N need your attention" to stay honest with a 13th, unfollowed
instrument in the shared log.

**The demo catalogue's shape emerged, not fabricated:** RELIANCE's decline
lands `market-wide` (NIFTY fell too), RELIANCE's own recovery lands `outlier`
(it bounced back harder than the index did), INFY's -20% lands `outlier`
against NIFTY's -7%. This was verified by a throwaway script before committing
NIFTY's price path, the same way the original catalogue's event counts were
verified in Phase 9 -- **tune demo data by measuring the actual output, not by
assuming a hand-picked path produces the story you intended.**

**UI:** a small `ContextTag`, visible only for `market-wide`/`outlier` --
`stock-specific` is the base rate, and tagging the majority of events would
repeat the "you were not watching, twenty times" mistake from Phase 8.
`stock-specific` still gets spelled out in full, in plain language, inside
"Why is this significant?" — absence of a tag must never be the only way a
reader learns the market was calm. Replay shows the same tag, looked up by
`sequence` from the original response: `toRecord`/`toFeedEvent`'s round trip
through the domain shape has nowhere to carry `signalContext` (it is wire-only,
not part of `MeaningfulMarketEvent`), so the lookup reads the untouched
response rather than the reconstructed cursor state.

Gate: `npm run verify` green — 240 tests, 22 files (+22 from Phase 10b: 11
domain, 5 attention-feed integration, 3 replay integration, 3 web). No overflow
at 390 or 1000px, including the tag wrapping at phone width.

### 2026-09-05 — Phase 10b: site chrome

The user's response to Phase 10: "there is nothing like the Groww website."
Correct, and worth being precise about why. Phase 10 reskinned the dashboard's
colours, radius and one component (the pill) with Groww's real tokens -- but
`groww.in` is a marketing *website*: a persistent header with a logo, product
nav, and an account control. This app went straight to the watchlist with no
header at all, by an earlier, deliberate decision. Colour alone cannot make a
page read as a site when the page has no site-level chrome.

Asked before building, since "make it look like the website" had at least two
readings with materially different scope: a header/nav bar above the existing
dashboard, or a marketing landing page in front of it (hero, feature grid,
"Get started" CTA) with the dashboard behind a click-through. The user chose
the header. The landing-page reading would have added real scope beyond the
brief -- the watchlist is the entry point per §1, and marketing copy for a
product this is not is not something to invent.

**`Header.tsx`**: a wordmark where a logo goes, the three tabs promoted out of
the page body into permanent nav, and an account chip (avatar + the existing
"Viewing as" input) on the right. `tab` and `user` still live in `App` --
nothing here is a new source of truth, only a new place things are rendered
and clicked. The old `.tabs` CSS was reused rather than duplicated: it lived on
the page body before, it lives in the header now, and it needed its
border-bottom removed (the header owns that line now) rather than a parallel
`.header-nav` class next to it.

Removing the "Viewing as" control from the attention tab's `.actions` row and
promoting it to the header was a small correctness fix in passing: `user` was
already global state read by both `Watchlist` and the feed, so having its only
editor live inside one tab's conditional content was accidental, not intended
-- switching the reader should not require being on a specific screen.

**A real regression caught before committing.** The first version put the
brand mark, nav and account chip in one row at every width. At 390px that left
"While you were away" clipped to "While you w" -- the nav had almost no width
left once the logo and chip took their share, worse than the old below-header
tab strip that had the full viewport to itself. Fixed with a two-row header
under 480px: brand and chip share a compact top line, tabs get their own full
line beneath it, which is what let all three fit without scrolling in the
first place. Found by screenshot, not by a test -- `overflow=false` was true
in both versions, because clipping a label mid-word is not horizontal
overflow.

No test needed to change: the tabs kept their `role="tab"` / `aria-selected`
attributes regardless of container, and `getByLabelText('User id')` still
resolves from inside the account chip's `<label>`.

Gate: `npm run verify` green -- 218 tests, 21 files, no change in count. No
overflow at 390, 768 or 900px, including the two-row header case, checked over
CDP.

### 2026-09-05 — Phase 10: a Groww-derived visual theme

Requested explicitly: "design UI/UX like the Groww official theme." Two things
had to be true for this to be legitimate rather than a knock-off: the tokens had
to be *real*, not guessed from memory, and the result had to stay Market Pulse
-- no Groww name, logo, or claim of being Groww.

**Tokens came from Groww's own production CSS, not a description of it.**
`groww.in`'s HTML is a client-rendered shell; the actual design lives in two
`_next/static/css` bundles, fetched directly and grepped for `--variable:
#hex` declarations. That is where every number below comes from:

| Token | Value | Groww's name for it |
| --- | --- | --- |
| Brand green | `#04b488` | `--green9` |
| Green text (on tint) | `#04ad83` | `--positive-hover` |
| Green tint | `#e9faf3` | `--green2` |
| Negative | `#ed5533` | `--red9` -- a warm red-orange, not pure red |
| Negative tint | `#fae9e5` | `--red100` |
| Primary text | `#44475b` | `--gray900` -- a soft slate, not black |
| Background | `#f8f8f8` | `--gray50` |
| Card border | `#dddee1` / `#f0f0f2` | `--gray200` / `--gray100` |
| Dark bg / text / border | `#060809` / `#f2f5f7` / `#2e2e2e` | their dark theme, direct |

Radius scale (8/12/16px, 999px for pills), the `0 4px 12px rgb(0 0 0 / 8%)`
shadow, and font-weight 500 as the workhorse weight are the same provenance.
Typography is the one honest substitution: `GrowwSans`/`Soehne` are licensed
faces this project cannot load, so **Inter** stands in -- same neutral,
slightly-rounded grotesk character, loaded from Google Fonts with Groww's own
fallback chain (`Noto Sans`, `system-ui`) behind it, so a machine with neither
still lands in the right family of shape.

**The chip is the one new component.** Groww's watchlist rows show a price
change as a tinted, rounded pill -- colour carried by the fill *and* the text,
not text colour alone. `.pill` / `.pill-positive` / `.pill-negative` /
`.pill-flat` replaced two inline `style={{ color: ... }}` blocks (in
`TraditionalWatchlist` and the replay net-change badge) that were computing the
same three-way branch in JSX. No other markup changed: every existing class
name and DOM structure survived, so the only test casualty was one regex that
had matched "0.00% vs ₹2,900.00" as one text node -- splitting the percentage
into its own pill made that two nodes, and the assertion was rewritten against
`textContent` on the existing `data-testid="replay-net"` wrapper rather than
against node structure.

**One real bug, found by looking.** Inter runs a little wider per character
than the previous system-font stack, and the "Add a symbol" input had a fixed
`width: 8rem` -- just enough to clip the placeholder to "Add a symbo". Fixed
with `min-width` plus a wider default rather than a number tied to that one
string.

**What stayed Market Pulse.** No Groww name, logotype, or copy was used
anywhere. The circular direction icons, the segmented toggle, and the pill
pattern are Groww's *visual grammar* applied to this product's own screens and
its own words -- "Simulated market", "meaningful changes", "as recorded" all
read exactly as before. Adopting a palette and a component pattern from a
well-known app is ordinary design practice; presenting this as Groww, or
copying its brand identity, would not have been, and wasn't done.

Gate: `npm run verify` green -- 218 tests, 21 files, unchanged in count. No
overflow at 390, 768 or 900px, checked over CDP after the change.

### 2026-09-04 — Phase 9: a market that keeps moving

Requested explicitly, and it reverses a decision on the cut list. Live data was
cut in Phase 1 and the user asked for it back; the honest version of "real time"
was built rather than the literal one.

- **`modules/market/simulator.ts`** invents a price per instrument on a timer
  and hands it to `observeTick`. That is the whole design argument: a generated
  price gets **no privileged path into history**. It produces an event only by
  crossing the published threshold, and the same "Why is this significant?"
  panel explains it.
- **What it is not given** is the point. Events and snapshots, no
  `WatermarkStore` — so a running market cannot consume anyone's unread events
  (I4), structurally rather than by policy.
- **`createApp` builds it; only `index.ts` starts it.** A factory, not a flag,
  so that constructing an app — which every test does — can never spawn a
  background interval.
- **`GET/POST /api/market-status`** reports the source and pauses/resumes. The
  pause is what makes a moving market safe to demo: stop it to narrate, start it
  to watch events land.
- **12 instruments, 18 seeded events**, from `modules/market/catalogue.ts` —
  one file describing the fictional market, so the seed and the simulator cannot
  drift apart. Two round trips, a genuine rally, a five-crossing volatile one, a
  staged slide that shows the anchor limitation, and three deliberately calm
  instruments.
- **A second seeded reader, `priya`**, with her watermark two thirds along, so
  "two people see different things" is demonstrable in the running app.
- **Polling, not sockets** (`usePoll`): 2s header, 4s watchlist, 8s feed. The
  feed is slowest on purpose — re-ordering stories under someone mid-sentence is
  worse than being a few seconds behind.

Four things were only found by looking at it, and three of them were real bugs:

1. **The volatility parameter was a lie.** A uniform draw over [-w, w] has a
   standard deviation of w/sqrt(3), so every instrument was 42% calmer than its
   profile claimed and the market produced almost nothing. Fixed by scaling, so
   `volatility` now means standard deviation. **Tune by measuring, not by feel** —
   a throwaway script that runs 1200 steps and prints events-per-hour and drift
   settled this in one pass.
2. **Mean reversion pointed at the wrong price.** Reverting toward each
   instrument's *opening* price rallied INFY 25% in the first minutes and quietly
   destroyed its one job — being the instrument that genuinely fell. It reverts
   to where each seeded story *ended*.
3. **"Recovered" became a lie.** Every advance said it. That was fine when
   RELIANCE was the only instrument with one and wrong the moment the catalogue
   had a genuine rally: TATAMOTORS never fell. `moveLabel` derives it from the
   story — an advance is a *recovery* only if a decline precedes it in the same
   instrument's events, otherwise it *rose*. This is the "never claim more than
   the data model knows" rule, caught by a screenshot rather than a test.
4. **"— you were not watching" twenty times** was filler at this volume. Gone.

A test also caught a genuine robustness bug: `observeTick` throws on an
out-of-order tick, and that throw was inside a `setInterval`, so a clock stepping
backwards would take the generator down. It now skips that instrument for that
step rather than inventing a timestamp to get past the check.

Gate: `npm run verify` green — 218 tests, 21 files. No overflow at 390, 768 or
900px. Verified live over CDP, not only in tests.

**Audit pass afterwards**, which found five things the phase had left loose and
is worth knowing the shape of:

- `usePoll` exported a `loadedAt` that nothing rendered, and its single consumer
  guarded on it with a condition that could never be false. Removed. The
  freshness a reader cares about is the server's `lastTickAt`, not when this
  browser happened to ask.
- Four behaviours were built and documented but never proved: the
  keep-the-last-good-reading path on a failed poll (twice — header and
  watchlist), the replay instrument picker, and the arrival banner. All now have
  tests, including that the picker never introduces a `userId` and that the
  arrival count re-baselines when the reader changes.
- Two iteration-log entries quoted a test count that a later commit had moved
  past. **A number in this file is a claim; re-run the gate before writing
  one.**

### 2026-09-04 — Phase 8: front-end pass (UI only)

Three changes to the front end. No domain, API or schema changes — the feed
endpoint returns exactly what it did before.

- **Ranking and narrative separated.** The feed groups events by instrument.
  Instruments are ranked by their largest move (the attention question);
  events *inside* a story run chronologically (the narrative question). This
  removes the oddity where RELIANCE's recovery outranked the decline that
  caused it, **without touching the ranking rule** — F5 is unchanged.
- **`StoryPath`** draws the shape of what happened from the events themselves,
  with a dashed baseline at the starting price. When the path returns to that
  line the picture makes the argument. Used by the feed and by replay, so the
  two screens share one visual language.
- **"Why is this significant?"** discloses the anchor, the crossing price, the
  move and the threshold, reading `DEFAULT_RULE` from the domain rather than a
  number typed into the UI. The brief left "what counts as meaningful" to us, so
  the rule should be legible rather than taken on trust.

Two rendering defects were found by looking and fixed: the arrow badge stretched
to the height of an open disclosure (turning a marker into a heavy stripe), and
`preserveAspectRatio="none"` rendered the path's circular markers as ellipses.
The markers are now vertical ticks with a non-scaling stroke, which are immune to
non-uniform scaling.

Deliberately **not** built, despite being on the review's list: a component
library (`InstrumentRow`, `StatusPill`, `PriceDisplay`). Three screens do not
need one, and it is the kind of abstraction §2.3 exists to refuse. Tokens and a
type scale, yes; a component layer, no.

Gate: `npm run verify` green — 184 tests, 19 files. No overflow at 390 or 900px.

### 2026-09-04 — Phase 7: finalization, no new features

Presentation and reliability only.

- **Fixed a real demo bug.** `npm run db:seed` was not idempotent: a second run
  appended a duplicate story, so a reviewer who ran it twice would see six
  meaningful changes instead of two. Seeding now refuses when history exists and
  explains why; `npm run db:reset` deletes the file and rebuilds. There is no
  "clear events" command, because offering one would contradict I2.
- **Fixed seeded watchlist order.** All three instruments were added within the
  same millisecond, so ordering fell back to alphabetical and buried RELIANCE —
  the instrument the demo turns on. The seed now advances its own clock.
- **Added** a "View what happened →" control on changed rows, so the argument is
  one click from the entry point.
- **Rewrote README** to lead with the problem and the thesis rather than the
  stack, with a 60-second walkthrough and an explicit trade-offs section.

**The UI was inspected, not assumed.** Chrome driven headless over CDP (no
Playwright in the dependency tree) captured the five-step journey. Two
presentation fixes followed: the ranking explanation now precedes the event list
(significance ranking can put a recovery above the decline that caused it, which
needs framing *before* the reader meets it), and "Remove" no longer competes
with the primary action.

**Responsive pass at 390 / 768 / 900px.** No horizontal overflow at any width,
measured rather than assumed. Three problems found and fixed at phone width:

1. The tab strip wrapped, turning "My watchlist" into two lines and the nav into
   a broken-looking block. Tabs now `nowrap` and the strip scrolls.
2. "As recorded 1:00 pm" broke after "1:00", reading as two unrelated fragments.
   The timestamp is now one unbreakable phrase.
3. The first fix attempt used `flex-wrap` on `.row`, which made the layout depend
   on how long each instrument's status text happened to be — some rows in two
   columns, others broken onto a second line with the price floating. Replaced
   with a consistent stack below 480px.

The comparison screen — the most important one — held up unchanged at every
width: `₹2,900.00 / 0.00% / No change since your last check` still reads as one
argument next to "3 meaningful transitions happened while you were away".

Gate: `npm run verify` green — 180 tests, 19 files, stable across repeated runs.

**A note for whoever picks this up:** the remaining risk is presentation, not
correctness. Resist adding features.

### 2026-09-04 — Phase 6: watchlist and instrument snapshots

The concept the product was missing: **what I care about**, as distinct from
what changed enough to deserve attention.

- **Added** `domain/watchlist/watchlist.ts` — `buildWatchlist` is a pure
  function of (entries, snapshots, unread events). Attention is computed there
  and never stored (W3).
- **Added** migration `003`: `instrument_snapshots` (mutable knowledge) and
  `watchlist_entries` (per user, one list). The contrast with the append-only
  `market_events` is the product thesis at the schema level.
- **Added** stores and `GET/POST/DELETE /api/watchlist`, plus the "My watchlist"
  tab, now the app's entry point.
- **`undefined` is not zero.** A quiet instrument reports `netChangeBps:
  undefined`, not `0` — "nothing happened" and "it moved and came back" are
  different facts.
- **Freshness labels** say "As recorded 2:15 PM" or "Never observed", never
  "live". A test asserts those words are absent.

W1–W5 mutation-tested. W4 is guarded three deep, and the mutation proved it:
forcing a deletion into the request path **could not execute** — the append-only
trigger from 002 aborted it.

Named `instrument_snapshots`, not `market_state`, because the domain already has
a `MarketState` (the engine's fold state) and the collision would be genuinely
confusing.

Gate: `npm run verify` green — 179 tests, 22 files. Verified live: the watchlist
returns RELIANCE, INFY and TCS; the feed returns only RELIANCE and INFY.

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
