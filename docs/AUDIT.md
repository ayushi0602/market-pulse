# Audit

A full read of the repository as it stands, written by surfing every file rather
than from memory. It records **what exists**, **why each decision was made**,
**what was found wrong during the audit**, and **what the strategy is from here**.

Audited: 2026-09-05, at commit `971e629`, branch `master`.
Gate at time of writing: `npm run verify` green — **218 tests across 21 files**,
suite duration ~10.7s, production bundle 213 kB (66 kB gzipped).

---

## 1. What this project is

**Market Pulse** answers one question:

> *"What happened while I was away, and why did it matter?"*

The thesis in one line: **a price can return to where it started while something
important happened in between.** A watchlist that compares now against a snapshot
reports `0.00%` and is, truthfully, useless. Market Pulse keeps the meaningful
transitions as append-only history and reads that history *per user*, from where
each person last looked.

Two people opening the app at the same instant should see different things. Any
design decision that breaks that property is wrong, however clean it looks.

---

## 2. Repository shape

```
packages/
├── domain/   Pure TypeScript. No I/O, no framework, no node: built-ins.
├── server/   Express 5 API, node:sqlite persistence, migrations, composition root.
└── web/      React 19 + Vite client.
```

The dependency rule — `domain` depends on nothing; `server` and `web` depend on
`domain` and never on each other — is **enforced by ESLint**, not by convention.
`packages/domain/**` has `no-restricted-imports` patterns banning
`@market-pulse/server`, `@market-pulse/web`, `express`, `react`, `react-dom`, and
`node:*`. `packages/web/**` is banned from importing server internals. A
violation fails `npm run lint`, so the boundary cannot rot quietly.

| Package | Runtime dependencies |
| --- | --- |
| `domain` | **none** |
| `server` | `@market-pulse/domain`, `express` |
| `web` | `@market-pulse/domain`, `react`, `react-dom` |

No ORM, no state library, no CSS framework, no charting library, no Playwright.
Node ≥ 22.5 is required for the built-in `node:sqlite` driver — there is no
native build step and no database server.

### Source inventory

| Area | Files | Lines |
| --- | --- | --- |
| `domain/src` (excl. tests) | 18 | 1,080 |
| `domain` tests | 10 | 1,000 |
| `server/src` (incl. `.sql`) | 24 | 1,732 |
| `server` tests | 9 | 1,558 |
| `web/src` (excl. tests, incl. `styles.css`) | 11 | 2,305 |
| `web` tests | 4 | 1,169 |

**3,727 lines of test against 5,117 lines of source** — or 4,261 of source once
the 856-line stylesheet is set aside, which is close to 1:1. That ratio is what
it should be for a project whose whole claim is about invariants holding.

---

## 3. Architecture, and the reasoning behind it

### 3.1 State and events are different things

> **State** tells you where the market *is*. **Events** tell you what *happened*.

This is the product thesis expressed at the schema level, and it is the single
most important decision in the repository:

| Table | Nature | Rule |
| --- | --- | --- |
| `market_events` | History | Append-only. Never mutated, never deleted. |
| `instrument_snapshots` | Knowledge | Overwritten as we learn. Makes no claim about the past. |
| `user_read_watermarks` | Position | One integer per user, monotonic. |
| `watchlist_entries` | Interest | Per user, freely added and removed. |

A traditional watchlist stores only the second row. Storing both is what makes
the question answerable.

### 3.2 Append-only is enforced, not intended

Three independent mechanisms, because an intent expressed once is an intent that
gets violated:

1. `EventStore` exposes `append`, `readAfter`, `head` — and **no** `update` or
   `delete`. A caller cannot ask.
2. The `RecordedMarketEvent` type has no mutating operation.
3. SQLite triggers `market_events_are_immutable` and `market_events_are_permanent`
   abort `UPDATE` and `DELETE` at the database.

The third one earned its place during the Phase 6 mutation testing: forcing a
deletion into the watchlist request path **could not execute** — the trigger
aborted it. The invariant did not merely fail a test; it was unreachable.

### 3.3 Identity is not ordering

An event carries an `eventId` (*which* event — stable, meaningful outside this
log) and a `sequence` (*where* it sits — the log's own ordering, and the thing a
watermark points at). An auto-increment key would supply both and hide the
distinction. Keeping them apart means "which event" and "how far have I read"
cannot be accidentally substituted for one another.

### 3.4 Reading is not acknowledging

`GET /api/attention-feed` never writes. Only an explicit `POST .../ack` moves a
watermark. Advancing on read is the natural shortcut and a correctness bug — a
refresh, a prefetch, or a second tab would consume events the user never saw,
unrecoverably.

Monotonicity is enforced **in SQL**, not in application code:
`last_read_sequence = MAX(excluded.last_read_sequence, last_read_sequence)`.
Doing it as read-then-write in TypeScript would leave a race between the read and
the write; doing it in the statement leaves none.

### 3.5 The significance rule

A move of at least **500 basis points (5%)** from the **active anchor**, not from
the previous tick. Measuring against the previous tick would make a slow slide
invisible: twenty ticks of −0.5% each is a 10% fall that never once moves 5% in
a single step. On emission the anchor moves to the price that triggered it, so
the next event must earn its own threshold.

The known cost is written down rather than hidden: **a staged move is reported
in pieces.** 2900 → 2726 → 2639 reports a 6% decline, not the 9% that actually
happened. SBIN exists in the demo catalogue specifically to make that limitation
visible — a −9.4% slide reported as one −5.65% crossing.

### 3.6 Money is integers

Branded `PriceMinor` (paise) and `BasisPoints`. Never floating point. Two runs
over the same ticks must produce byte-identical events, and a threshold
comparison that lands a fraction of a paisa either side of the line decides
whether a user is told about a 5% move. `toRupees` / `toPercent` are display-only
and never compared against.

### 3.7 Structural guarantees over remembered rules

Several invariants hold because the code **lacks the capability** to violate
them, not because someone remembered:

| Guarantee | How it is structural |
| --- | --- |
| Replay cannot advance a read position (R5) | `createReplayRoutes` takes no `WatermarkStore`, and the request cannot name a user |
| A running market cannot consume unread events (I4) | `createSimulator` is handed events + snapshots and **no** `WatermarkStore` |
| Removing a watchlist entry cannot delete history (W4) | `WatchlistStore` has no access to `market_events`, and the trigger would abort it anyway |
| Building an app never starts a background timer | `createApp` takes a *factory*; only `index.ts` calls `.start()` |

This is the property most at risk from a well-meaning refactor. Passing a store
into a module "for convenience" silently downgrades a structural guarantee into
one that merely happens to hold.

---

## 4. What was built, iteration by iteration

Thirteen commits, all on `master`. **There is no git remote** — pushing is the
one step that has to happen outside this repository.

| # | Commit | What it added, and the reasoning that is not in the diff |
| --- | --- | --- |
| 1 | `9db2a9c` | **Foundation.** Workspaces, three packages, Express + `node:sqlite`, forward-only migrations, health endpoint. Found and fixed: a relative `DATABASE_URL` resolved against `process.cwd()`, so the database landed somewhere different depending on where the script was invoked. Anchored to the repo root instead. |
| 2 | *(in 1.5)* | **Quality gate before the feature surface grew.** ESLint 10 flat config with type-aware rules, Prettier, and `verify`. The import-boundary rules were verified by probe: a `node:fs` import inside `domain` fails lint. Also fixed a health contract that promised `version` came from `package.json` while `app.ts` hardcoded `'0.0.1'`. |
| 3 | `6ea8fd4` | **Domain model + golden scenario.** 100 → 96 → 91 → 95 → 100. The test asserts *the premise* first — that a snapshot comparison genuinely reports nothing — so the scenario cannot quietly stop proving anything. I1–I4 mutation-tested. |
| 4 | `9988e50` | **Persistence.** Two decisions locked first: `EventId` separated from `sequence`, and the event contract documented as *a threshold-crossing move measured from the active anchor*, explicitly not "the full move". AC1 uses a **real child process** — a fixture writes the story and exits before anything reads it back. |
| 5 | `e6d9c19` | **Attention feed + the first product screen.** The `GET`/`POST` split is the point. Ranking is magnitude-desc with a sequence tie-break, so F5 does not depend on sort stability. |
| 6 | `a497ee6` | **Replay.** A cursor over a frozen timeline; three controls and no seek bar. R4 deliberately has no `Clock`: replay is cursor-based, so no wall-clock read exists to inject. Threading one through to satisfy the letter of the rule would be ceremony. |
| 7 | `ee07c9e` | **Watchlist + snapshots.** `netChangeBps: undefined` for a quiet instrument, never `0` — "nothing happened" and "it moved and came back" are different facts. Named `instrument_snapshots`, not `market_state`, because the domain already has a `MarketState`. |
| 8 | `8e39ff0` | **Demo reliability.** Fixed a real bug: `db:seed` was not idempotent, so a second run appended a duplicate story. Seeding now refuses when history exists. There is deliberately **no** "clear events" command, because offering one would contradict I2. |
| 9 | `1380a54`, `b1cd24b` | **Looking at it.** Chrome driven over CDP using Node's built-in `WebSocket` — no Playwright in the dependency tree. Found two hierarchy problems and three responsive problems that 27 web tests could not. |
| 10 | `86a0172` | **Ranking and narrative separated.** Instruments ranked by largest move; events *inside* a story chronological. This removed the oddity where RELIANCE's recovery outranked the decline that caused it — **without touching the ranking rule**. Added `StoryPath` and the "Why is this significant?" disclosure, which reads `DEFAULT_RULE` from the domain rather than a number typed into the UI. |
| 11 | `3e3823f` | **Terminology audit.** The README described the feed as "ranked by significance rather than recency" — true before grouping, wrong after. And the UI used two nouns for one count ("changes" vs "transitions"). |
| 12 | `3f0951c` | **A market that keeps moving.** See §5. |
| 13 | `971e629` | **Closing the gaps that phase left.** See §6. |

---

## 5. The live market, in detail

Requested directly, and it **reopens a decision that was on the cut list**. The
honest version was built rather than the literal one.

### What it is

`modules/market/simulator.ts` invents a price per instrument on a timer and hands
every one of them to the **same** `observeTick` the seed and the tests use.

```
simulator ──▶ observeTick (domain) ──▶ EventStore.append
     │                                 SnapshotStore.record
     └── no WatermarkStore
```

**A generated price gets no privileged path into history.** The simulator cannot
write an event; it can only *cause* one by crossing the published threshold from
the active anchor. That is why "Why is this significant?" works on a simulated
event with no special-casing.

### What it is not

Not ingestion. It writes in-process through the ordinary stores. Duplicate ticks,
out-of-order arrival across a network, backpressure, staleness detection and
provider health are all undecided, and are a phase of their own rather than
something to grow this into.

### Honesty mechanics

The client never *decides* how fresh the data is. `GET /api/market-status` says
what the server is running and the UI repeats it. `MarketSource` has exactly two
members — `'simulated'` and `'static'`. Adding `'live'` to that union is how an
overclaim would start, so it is not there. Three tests assert the word stays out
of the interface.

### The walk, and two mistakes worth remembering

Each instrument follows a mean-reverting random walk: a shock supplies movement,
a pull keeps it from wandering. Both terms were wrong first.

1. **`volatility` did not mean what it was named.** A uniform draw over `[-w, w]`
   has a standard deviation of `w/√3`, so using the half-width directly made
   every instrument **42% calmer** than its profile claimed — calm enough that an
   hour of simulation produced almost nothing. The shock is now scaled by `√3`.
   *Tuned by measurement, not by feel*: a throwaway script running 1,200 steps
   and printing events-per-hour and drift settled it in one pass.
2. **Mean reversion pointed at the opening price.** That rallied INFY 25% in the
   first few minutes and destroyed the one story that is supposed to be a genuine
   fall. It now reverts to where each seeded story *ended*.

Measured behaviour after both fixes, across three seeds:

| Horizon | New events | Quiet-instrument events | Max drift from story end |
| --- | --- | --- | --- |
| 5 min | 1–4 | 0 | ~3.5% |
| 1 hour | 38–53 | 0 | 1.6–4.6% |
| 4 hours | 176–193 | 0 | 2.2–3.4% |

### Calibrated quiet

Three profiles. `CALM` (volatility 0.0015, reversion 0.4) puts the 5% threshold
roughly **26 standard deviations** away, so TCS, WIPRO and ITC stay quiet through
a running demo — which the screen explaining "quiet is not the same as nothing"
depends on. A test runs 2,000 steps and asserts zero events.

### The demo catalogue

One file, `modules/market/catalogue.ts`, describes the fictional market, so the
seed and the simulator cannot drift apart. **12 instruments, 18 seeded events:**

| Symbol | Events | Story |
| --- | --- | --- |
| RELIANCE | 2 | −9.00%, +9.89% — round trip, ends exactly where it started |
| INFY | 1 | −20.00% — a genuine fall a snapshot would also catch |
| ADANIENT | 5 | the busiest story; five crossings |
| TATAMOTORS | 3 | a genuine rally — three advances, snapshot agrees |
| HDFCBANK | 2 | the round trip upward: +8.00%, −7.41% |
| ZOMATO | 2 | fell hard, mostly recovered |
| SBIN | 1 | a −9.4% slide reported as one −5.65% crossing — the staged-move limitation, on purpose |
| BAJFINANCE | 1 | one clear decline |
| HINDUNILVR | 1 | one clear advance |
| TCS, WIPRO, ITC | 0 | quiet, and still on the list |

A second reader, `priya`, is seeded with her watermark two thirds along, so
"two people see different things" is demonstrable in the running app rather than
only in a test. Verified live: `priya` 8 unread, `demo` 20, same instant.

### A robustness bug a test found

`observeTick` rejects an out-of-order tick — correctly, since accepting one
corrupts history in a way no later read can detect. That rejection is a `throw`,
and the simulator calls it from a `setInterval`, so a clock stepping backwards
would have taken the generator down. It now **skips that instrument for that
step**. Recording nothing is cheap; inventing a timestamp to get past the check
would have been the dishonest fix.

---

## 6. Findings from this audit

Every claim below was checked against the files, not recalled.

### 6.1 Fixed during the previous pass (commit `971e629`)

| # | Finding | Resolution |
| --- | --- | --- |
| 1 | `usePoll` exported `loadedAt`, which nothing rendered; its one consumer guarded on a condition that could never be false (the no-data case returns earlier) | Removed. The freshness a reader cares about is the server's `lastTickAt`, not when this browser asked. |
| 2 | Stale-data-on-failed-poll documented in comments, never tested | Tests for the header strip and the watchlist |
| 3 | Replay instrument picker had no client-side test | Three, including that **no request it makes carries a `userId`** — a picker is exactly the thing that could have quietly broken R5 |
| 4 | Arrival banner had no test | Two, including that it re-baselines on a change of reader |
| 5 | Two doc entries quoted a superseded test count | Corrected |

### 6.2 Found and fixed in **this** pass — stale documentation

`ARCHITECTURE.md` had drifted badly from the code. It is the document a reviewer
opens first, and it opened with a false statement:

| Location | Said | Reality |
| --- | --- | --- |
| Header | *"Step 1 — foundation only. No market features are implemented yet."* | Feature-complete: feed, replay, watchlist, simulator |
| Core concepts | *"the Attention Feed's ranking … arrives with the feed API"* | Shipped in iteration 5 |
| Market Event | *"Derivation rules are deliberately not decided yet"* | Decided: 500 bps from the active anchor |
| Subscription dimension | *"There is no watchlist entity yet"* | Migration `003` introduced one |
| Auth (deferred) | *"A stub identity is enough until the feed exists"* | The feed exists |
| Component library (deferred) | *"There are no UI screens yet"* | There are four |

All six rewritten. The subscription-dimension entry is the interesting one: the
original justification expired, but the **decision is still right for a second
and better reason** — `watchlist_entries` is keyed `(user_id, instrument_id)`, so
a user has exactly one list and the dimension is still degenerate. That reasoning
replaced the expired one rather than the section being deleted.

### 6.3 Checked and found clean

- No `TODO`, `FIXME`, `any`, `eslint-disable`, or `@ts-ignore` anywhere in `src`
  or `test`
- No unused CSS classes (every `.class` in `styles.css` is referenced from a
  component)
- Every new module exported from `packages/domain/src/index.ts` and wired into
  the composition root
- Poll intervals in code (2s header / 4s watchlist / 8s feed) match what the
  README claims
- `data/`, `*.sqlite`, `.env` are git-ignored; working tree clean
- Every invariant set has named test blocks: **I1–I4, AC1–AC5, F1–F5, R1–R5,
  W1–W5**, plus the simulator's own block
- The "stale numbers" a grep flags in older iteration-log entries are *dated
  history* and correctly left alone

### 6.4 Known and accepted, not defects

- **One historical non-reproducible flake** (iteration 7): one test failed once
  immediately after an edit; 14 subsequent full-suite runs and 3 `verify` runs
  were green. Most likely a stale transform cache picking up a mid-write file.
  Recorded rather than dismissed, because a demo that fails once in twenty is a
  demo that fails.
- **Web tests use real timers** with generous `waitFor` timeouts to exercise
  polling. This costs ~4s of the 10.7s suite. Fake timers would be faster and
  would test less.

---

## 7. API surface

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/health` | version, time, database reachability |
| `GET` | `/api/market-status` | source, running, interval, last tick, log head |
| `POST` | `/api/market-status` | pause/resume generation; `409` when none is configured |
| `GET` | `/api/attention-feed?userId` | **never writes** |
| `POST` | `/api/attention-feed/ack` | the only thing that moves a watermark |
| `GET` | `/api/replay?instrumentId` | carries no user, by design |
| `GET` | `/api/replay/instruments` | what there is to replay; also user-free |
| `GET` | `/api/watchlist?userId` | attention derived on read, never stored |
| `POST` | `/api/watchlist` | |
| `DELETE` | `/api/watchlist/:instrumentId` | removes interest; cannot touch history |

---

## 8. How to run it

```bash
npm install
npm run db:seed          # 12 instruments, 18 events, two readers
npm run dev              # API :4000, web :5173 — the market starts moving
```

| Command | Purpose |
| --- | --- |
| `npm run verify` | **The gate**: format → lint → typecheck → test → build |
| `npm run db:reset` | Delete the database and rebuild the demo |
| `MARKET_SIMULATION=off npm run dev` | Frozen data, for a still demo |
| `MARKET_SIMULATION_INTERVAL_MS=…` | Change the pace (minimum 250) |

Seeding refuses to run twice against the same database: history is append-only,
so a second run would append a duplicate story rather than replacing it.

---

## 9. Strategy from here

### 9.1 The default position: stop

The brief is answered — create and manage a watchlist, see the latest market
information, return later and find out what changed. Every remaining idea is
individually defensible and collectively a way to make the demo worse. The
failure mode this project is most at risk from is **feature accumulation**, where
each addition is reasonable and the whole becomes unfocused.

**The recommendation is to submit.** The three things left are not code:

1. **Push it somewhere.** There is no git remote and the branch is `master`.
2. **Run `/code-review ultra`** if an independent multi-agent review is wanted —
   it is user-triggered and billed, and cannot be launched from inside a session.
3. **Rehearse the demo once**, using the pause control at the top.

### 9.2 If more work is genuinely wanted, in priority order

Ranked by *reviewer value per unit of risk*, not by interest:

| Priority | Work | Why it is worth it | Risk |
| --- | --- | --- | --- |
| 1 | **CI workflow** (`verify` on push) | The gate exists and nothing runs it automatically. This is the highest-value remaining item and the cheapest. | None. Blocked only on a remote existing. |
| 2 | **A settle window for staged moves** | The one *product* limitation a reviewer is most likely to probe: 2900 → 2726 → 2639 reports 6%, not 9%. It is documented, which buys a lot; fixing it would buy more. | Medium — it changes the significance engine, which every invariant test sits on. Do it with mutation testing, or not at all. |
| 3 | **Accessibility pass** | Semantic roles and `aria-label`s exist and were never systematically checked. Keyboard traversal of the tab strip and the disclosure widgets is unverified. | Low. |
| 4 | **A cold-clone rehearsal on another machine** | Was done at iteration 7 and the code has moved a long way since. `npm install && npm run db:seed && npm run dev` on a fresh path is the exact reviewer path. | None. |

### 9.3 What to refuse, and why

These are on the cut list with the trigger for revisiting written down. They are
refused not because they are bad but because none of them makes the submission
better than a clear demo of what already works:

- **A real ingestion pipeline.** The simulator must not grow into one. Dedupe,
  out-of-order arrival, backpressure and provider health are a phase of their own.
- **WebSockets/SSE.** Polling is correct here; a push channel buys latency nobody
  is measuring and costs a connection lifecycle and a reconnect policy.
- **Multiple watchlists, auth, notifications, portfolio P&L, candlestick charts,
  technical indicators, an AI commentary layer.** Each widens the product without
  sharpening the argument. The AI one is a hard line rather than a deferral:
  generated commentary presented as insight is exactly the overclaim this project
  spends its whole design refusing to make.
- **A component library.** Four screens do not need one. Declined explicitly in
  iteration 8, and the reasoning stands.

### 9.4 The rules that must survive any future change

If one thing is carried forward from this audit, it is these:

1. **Never let the UI claim more than the data model knows.** This has now caught
   three separate bugs — the "live" labelling, `undefined` vs `0` for a quiet
   instrument, and "Recovered" applied to an instrument that never fell.
2. **Preserve structural guarantees.** Passing a store into a module "for
   convenience" downgrades an invariant that *cannot* be violated into one that
   merely happens to hold. The four in §3.7 are the ones to protect.
3. **Look at the screens after changing them.** Every UI defect in this
   repository's history — five responsive, two hierarchy, two copy — was found by
   screenshot, not by test. The CDP recipe is in `ENGINEERING_NOTES.md` and needs no
   dependency.
4. **Never weaken the gate to make it pass.** When lint and `tsc` disagreed over
   a cast, the answer was a type argument that satisfied both, not a disabled
   rule.
5. **A number in a document is a claim.** Re-run the gate before writing one.
   This audit found six stale claims in `ARCHITECTURE.md` and two stale test
   counts, all of which would have read as carelessness to a reviewer.
