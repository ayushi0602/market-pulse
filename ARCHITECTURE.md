# Architecture

Status: **feature-complete.** Domain, persistence, attention feed, replay,
watchlist, and a price generator that keeps the demo moving are all built. This
document records the shape and, more importantly, *why* each boundary is where
it is — the decisions are the part that does not survive in the diff.

## Product thesis

A traditional watchlist compares the current price against a previous snapshot.
It can tell you *where things stand*, but it silently discards everything that
happened in between.

Market Pulse keeps the transitions instead of overwriting them, so it can answer
a different question:

> **"What happened while I was away, and why did it matter?"**

Two consequences follow from that sentence, and they drive the whole design:

1. **"What happened"** means history is the source of truth, not a snapshot.
   Meaningful transitions are appended and never overwritten.
2. **"While I was away"** means the answer is *per user*. Two people opening the
   app at the same moment should see different things, because they last looked
   at different times.

## Core domain concepts

These are the nouns the system is organised around. All of them exist in
`packages/domain`, as pure functions over plain values.

| Concept | Meaning |
| --- | --- |
| **Instrument** | A thing that can be watched (a ticker/symbol). |
| **Tick** | A raw observation of an instrument at an instant. High volume, low individual meaning. Ticks are input, not history. |
| **Market Event** | A *meaningful transition* derived from ticks — the unit a human would actually care about. The rule is a move of at least 5% from the active anchor; see *The significance rule*. |
| **Event Log** | The append-only, ordered history of market events. Records are never mutated or deleted. This is a **data-model** commitment, not an infrastructure one — it is a table with an ordering, not a message broker. |
| **Read Position (Watermark)** | Per user, per subscription: the point in the log up to which that user has already seen events. This is what makes "while I was away" answerable. |
| **Attention Feed** | The ranked "Since you last checked" view. Reads the log from the user's watermark forward and orders by significance, not just recency. Ranking is a pure function of events — it does not mutate the log. |
| **Clock** | Explicit source of "now". The domain never reads the wall clock directly, which keeps time-dependent rules deterministic under test. |

### Why the log is append-only

Significance is relative to *when you last looked*. If we overwrote state, we
would have to recompute "what changed" against a moving target and would lose
the ability to explain *why* something mattered. Appending keeps both the facts
and the ordering, and makes the per-user view a pure read over shared history.

## The significance rule

The engine folds ticks into state and emits an event when the move **from an
anchor price** reaches a threshold (5% by default). On emission the anchor moves
to the price that triggered it.

```
anchor 100  ->  96   -4.00%   below threshold, nothing said
            ->  91   -9.00%   EVENT: decline 9%, anchor becomes 91
            ->  95   +4.40%   below threshold, nothing said
            -> 100   +9.89%   EVENT: advance 9.89%, anchor becomes 100
```

**Why an anchor rather than the previous tick.** Comparing consecutive ticks
would make a slow slide invisible — twenty ticks of -0.5% is a 10% fall in which
no single step is significant. The anchor accumulates.

**Why re-anchor on emission.** Otherwise every subsequent tick past the
threshold re-reports the same move.

**Known limitation, stated plainly.** A move that crosses the threshold in
stages is reported as several events rather than one. 100 → 94 emits -6% and
re-anchors, so the further fall to 91 (-3.2% from 94) is not reported, and the
user sees "-6%" for what was really a -9% fall. A settle window — waiting for
the move to stop before emitting — would fix this and is deferred until the feed
exists to show whether it matters in practice.

The threshold is a `SignificanceRule` passed in, not a constant the engine
hides, because "significant" is a product decision that will change and a rule
passed in is a rule a test can vary.

### Prices are integers

Prices are stored as **integer minor units** (paise), never floating point, and
magnitudes are carried in **basis points** (100 bps = 1%).

This is not fastidiousness. `0.1 + 0.2 !== 0.3` in binary floating point, and
two things here depend on exactness: the same ticks must produce byte-identical
events on every machine (I3), and a threshold comparison must not depend on
whether a value landed a fraction of a paisa either side of the line. The types
are branded (`PriceMinor`), so a bare `number` cannot be passed where a price is
expected.

## Module boundaries

A **modular monolith**: one deployable process for the API, one for the web
client in development, and hard boundaries maintained in source rather than
across a network.

```
packages/
├── domain/   Pure TypeScript. Types and rules. No Express, no SQL, no React.
│             Also holds the wire contracts shared by server and client.
├── server/   HTTP API, persistence, and wiring. Depends on domain.
└── web/      React client. Depends on domain (for contracts) only.
```

The dependency rule, in one line:

```
web  ─┐
      ├─→  domain        (domain depends on nothing)
server ┘
```

This rule is enforced by ESLint, not by convention: `domain` may not import
`server`, `web`, Express, React, or any `node:` built-in, and `server` and `web`
may not import each other. A documented boundary that nothing checks is a
boundary that erodes, so `npm run lint` checks it.

Inside `server`, the intended split is:

- `src/db/` — connection and migrations. The only place that knows we use SQL.
- `src/modules/<feature>/` — one folder per feature slice, each mounting its own
  router. `system` is the first and currently only one.
- `src/app.ts` — composes modules into an HTTP app without binding a port, so
  tests drive the real app in-process.
- `src/index.ts` — the only file that opens sockets and reads the environment.

**Why domain logic stays out of `server`:** event derivation, significance
ranking, and watermark arithmetic are the parts most likely to be wrong and most
in need of tests. Keeping them as pure functions in `domain` means they can be
tested with plain values and no database.

## Data layer

SQLite through Node's built-in `node:sqlite` driver.

This is a real relational database with real SQL and real forward-only
migrations — it is not a stub — and it needs no service installed, no container,
and no native compilation.

**On the Postgres path, stated precisely.** Everything above
`src/db/connection.ts` speaks plain SQL rather than SQLite-specific APIs, so the
persistence layer can be migrated to Postgres *without changing domain logic or
route handlers*. That is a bounded change, not a free one. A move would still
require: a new driver, a connection lifecycle change (`node:sqlite` is
synchronous, `pg` is not), and a SQL dialect pass covering upserts, timestamp
and JSON handling, generated ids, and concurrency semantics. The value of the
boundary is that this work stays confined to `src/db/` — it is not a claim that
the work is zero.

Migrations are numbered `.sql` files applied in filename order, each in a
transaction, recorded in `schema_migrations`. They run automatically on boot and
are idempotent. `001_init.sql` establishes the mechanism and nothing more;
domain tables arrive with the features that need them.

## Persistence model

Two tables, and the relationship between them is the architectural claim.

```
market_events            shared, written once, read by everyone
      ▲
      │ references a position, never a copy
      │
user_read_watermarks     per user, one row, one integer
```

**Events are stored once.** There is no per-user copy. Fan-out on write would
multiply storage by the user count and, worse, would turn "what did I miss" into
a question about a private queue rather than about shared history. One history,
many readers, is the design.

### Identity is not ordering

| Column | Is | Is not |
| --- | --- | --- |
| `event_id` | Identity. Stable, unique, meaningful outside this log. Survives copying or replay. | A position |
| `sequence` | Position. `INTEGER PRIMARY KEY AUTOINCREMENT`. What a watermark points at. | An identity |

An auto-increment key supplies both and thereby hides the distinction. Keeping
them separate means "which event" and "how far have I read" cannot be
substituted for one another. `AUTOINCREMENT` rather than a plain integer key so
a value is never reused even in principle: a watermark at 41 must not come to
mean a different event tomorrow.

Timestamps are never used for ordering. Two events can share an instant; they
cannot share a position.

### Append-only, enforced twice

The store exposes `append`, `readAfter`, and `head` — there is no `update` and
no `delete`, so a caller has no way to ask. The database also refuses, via
`BEFORE UPDATE` and `BEFORE DELETE` triggers that `RAISE(ABORT)`. I2 is the
load-bearing claim of the product, and an intent expressed only as an API shape
is one `sqlite3` session away from being violated.

### Watermark monotonicity is enforced in SQL

```sql
ON CONFLICT (user_id) DO UPDATE SET
  last_read_sequence = MAX(excluded.last_read_sequence, last_read_sequence)
```

A stale writer — an old tab, a phone that was offline, a retried request
arriving out of order — cannot un-read what the user has already seen. Done as
read-then-write in application code this would leave a race; done in the
statement it leaves none.

### Two deviations from the sketched schema, and why

- **`magnitude_bps INTEGER`, not `movement_percent REAL`.** A REAL percentage
  would reintroduce at the storage boundary exactly the floating-point
  imprecision the domain's integer types exist to prevent, and would let a
  stored event disagree with the event that produced it.
- **`occurred_at INTEGER`, not TEXT.** Epoch milliseconds, matching the domain's
  `Timestamp` and the existing `schema_migrations.applied_at`. Text timestamps
  invite ambiguity about zone and format.

### Still not: the subscription dimension

Watermarks are keyed by `user_id` alone, not `(user_id, watchlist_id)`.

When this was first written the reason was that no watchlist entity existed, and
a `watchlist_id` column would have held a placeholder constant in every row — a
shape that looks like a decision but records nothing. Migration `003` then
introduced watchlists, and the key was **still** not widened, for a second and
better reason: `watchlist_entries` is keyed `(user_id, instrument_id)`, so a user
has exactly one list. The dimension is still degenerate, and a column that can
only ever hold one value per user is not yet information.

It widens when a user can have two lists — and that is a migration against a
table nothing else references by that key.

## The attention feed

Two endpoints, and the split between them is a product-correctness decision.

```
GET  /api/attention-feed?userId=…    reads.  Never writes.
POST /api/attention-feed/ack         acknowledges. Only on explicit intent.
```

**Reading is not acknowledging.** Advancing the watermark on read is the
natural-looking shortcut and it is a bug: a flaky connection, a background
prefetch, a refresh or a second tab would silently consume events the user never
saw — and the watermark only moves forward, so they are unrecoverable.
Displaying and acknowledging are different events in the world, so they are
different requests (F1). The client honours the same rule: nothing in the UI
issues a write during render.

The response carries `throughSequence` — the head *as of this read* — and the
client acknowledges that, not whatever the head becomes later. Otherwise events
arriving between the read and the acknowledgement would be marked seen without
ever being shown.

### Feed invariants

| # | Invariant | Proved by |
| --- | --- | --- |
| **F1** | Fetching never advances the watermark. | `attention-feed.test.ts`, `App.test.tsx` |
| **F2** | Acknowledging sequence N advances to at least N. | `attention-feed.test.ts` |
| **F3** | A stale acknowledgement cannot move backwards. | `attention-feed.test.ts` |
| **F4** | The feed contains only events after the watermark. | `attention-feed.test.ts` |
| **F5** | Ranking is deterministic. | `attention/ranking.test.ts` |

### Ranking

Magnitude, largest first; ties break toward the newer event by **sequence**, not
timestamp — a tie-break that can itself tie is not a tie-break. Since sequences
are unique the comparator is a total order, so the result cannot depend on the
sort implementation.

Every event in the log already crossed the significance threshold, so ranking is
not "is this significant" — the engine answered that. It is only "in what order
should a returning user read them". Volatility normalisation, volume anomalies
and market-relative movement are all plausible refinements, and none are
justified before there is a screen to judge them against: nobody can tell a good
weighting from a bad one without the UX to compare them in.

### Making the argument visible

The feed also carries what a **traditional watchlist would have said**, computed
from the same events: net change from the price when the user last looked to the
latest recorded price. The UI shows both behind a toggle.

This is the honest form of the product claim. Rather than asserting that
snapshot views are inadequate, the response carries the snapshot's own answer and
lets them be compared. When that number is `0.00%` and `meaningfulChanges` is 2,
the argument makes itself.

One wording constraint follows from the event contract: `latestPrice` is the
latest price *the log knows about*, not the live market price — no tick since
the last threshold crossing is recorded. Labels must say "as recorded", never
"current".

## Replay

Replay is a **projection of history, never a rewrite of it**.

```
canonical event log  ──read──▶  frozen timeline  ──cursor──▶  what is on screen
```

`GET /api/replay?instrumentId=…` returns one instrument's whole story in
sequence order. The cursor lives in the client; the server holds no replay
session, because a per-viewer server-side cursor would be exactly the mutable,
user-scoped state replay is supposed not to have.

### Replay invariants

| # | Invariant | How it holds |
| --- | --- | --- |
| **R1** | Canonical history is immutable | The route takes an `EventStore` that has no update or delete; the projection freezes its own timeline |
| **R2** | Replay is deterministic | Visible state is a pure function of `(timeline, cursor)` |
| **R3** | Replay order is sequence order | `createReplay` sorts by `sequence`, explicitly not `occurredAt` |
| **R4** | Time is injectable | See below |
| **R5** | Replay does not change consumption state | The route takes no `WatermarkStore`, and the request cannot name a user |

R1 and R5 are **structural**, not remembered: the replay module has no way to
address canonical history or a watermark, so it cannot alter either. The
strongest evidence for R5 is that it could not be broken by editing the route —
violating it required adding watermark access at the app-wiring level, and the
tests caught that immediately.

### On R4, honestly

There is no `Clock` in the replay projection, and that is the answer rather than
an oversight. Replay is **cursor-based**: a step reveals the next event, and what
is visible is a pure function of the timeline and the cursor. No wall-clock
reading exists to inject, so threading a `Clock` through would be ceremony — an
abstraction with nothing on the other side, which is what §2.3 exists to prevent.

Real time appears in exactly one place: how fast the UI auto-advances. That is a
presentation concern, and the component takes `stepIntervalMs` as a parameter so
tests drive the whole story in milliseconds without waiting.

### What replay is for

The demo. Stepping through the golden scenario shows the snapshot number moving
— 0.00%, then −9.00%, then back to 0.00% — while the revealed events do not go
away. The closing line is the product thesis in one sentence: *the price went
nowhere; the story did not.*

## Watchlist and instrument snapshots

Four concepts, each answering a different question:

```
WATCHLIST        what I care about
SNAPSHOT         the latest we recorded
ATTENTION FEED   what changed enough to deserve attention
REPLAY           what happened along the way
```

The watchlist and the feed are **not the same list**, and the difference is the
product. An instrument that never crosses the significance threshold produces no
events and appears nowhere in the feed — correct for a feed, wrong for a
watchlist. Keeping them separate lets both be right.

### Two tables with opposite natures

| Table | Nature | Rule |
| --- | --- | --- |
| `market_events` | History | Append-only. Never overwritten. |
| `instrument_snapshots` | Knowledge | Overwritten as it changes. |

Snapshots are mutable **on purpose**, and that is not a weakening of I2: a
snapshot makes no claim about the past. A traditional watchlist keeps only the
second kind, which is exactly why it is silent about everything between two
readings.

Named `instrument_snapshots` rather than `market_state`: the domain already has
a `MarketState` — the significance engine's fold state (anchor, last price, last
instant) — and reusing that name for "latest recorded observation" would make two
genuinely different things look like one.

### Watchlist invariants

| # | Invariant | How it holds |
| --- | --- | --- |
| **W1** | Membership is independent of market events | `buildWatchlist` takes membership from `entries` alone; no foreign key ties an entry to an event |
| **W2** | Quiet instruments still have a latest recorded state | Snapshots are stored per instrument, independent of whether it ever crossed a threshold |
| **W3** | Attention is derived, never stored | Computed per read from unread events; there is no `hasMeaningfulChange` column to invalidate |
| **W4** | Removing an instrument does not delete history | The watchlist store has no access to `market_events`, `EventStore` exposes no delete, and the DB trigger aborts one |
| **W5** | Watchlist changes survive a restart | Proved with a real child process, as in Phase 3 |

W4 is guarded three deep. The mutation test is the evidence: forcing a deletion
into the request path did not merely fail a test, it **could not execute** — the
append-only trigger from migration 002 aborted it.

### `undefined` is not zero

A quiet instrument reports `netChangeBps: undefined`, not `0`. "Nothing
meaningful happened" and "it moved 9% and came back" are different facts, and a
watchlist that reported `0.00%` for both would be making precisely the mistake
this product exists to point out. The UI renders them differently too: *"No
meaningful changes"* versus *"2 meaningful changes — but the price came back"*.

### Freshness labelling

`latestPrice` is the last observation this system recorded. The UI says
**"As recorded 2:15 PM"**, or **"Never observed"** for an instrument we follow but
have never seen. It never says "live" or "current", because there is no
ingestion behind it — and a test asserts those words are absent.

The client does not *decide* how fresh the data is. `GET /api/market-status`
reports what the server is running and the client repeats it, so a server with
no generator cannot end up behind a page claiming something is updating. The
`MarketSource` union has exactly two members, `'simulated'` and `'static'`;
adding `'live'` to it is how an overclaim would start, so it is not there.

## The market simulator

Generated prices, so the demo moves. **Not ingestion**, and the distinction is
load-bearing.

```
simulator ──▶ observeTick (domain) ──▶ EventStore.append
     │                                 SnapshotStore.record
     └── no WatermarkStore
```

**A generated price gets no privileged path into history.** The simulator
invents a price and then hands it to exactly the `observeTick` the seed and the
tests use. It cannot write an event directly; it can only cause one by crossing
the published threshold from the active anchor. That is why the "Why is this
significant?" panel works on a simulated event without special-casing.

**It is handed events and snapshots, and no watermark store.** A running market
therefore cannot consume anyone's unread events (I4) — not because it is careful,
but because it has nothing to call.

**`createApp` builds it; only `index.ts` starts it.** The option is a factory
rather than a flag, so that constructing an app — which every test does — can
never spawn a background interval.

### The walk, and why it is shaped this way

Each instrument follows a mean-reverting random walk. Two terms: a shock that
supplies the movement, and a pull back toward a resting level. Two decisions
inside that are worth recording, because both were wrong first:

**`volatility` means standard deviation.** A uniform draw over `[-w, w]` has a
standard deviation of `w/√3`, so using the half-width directly made every
instrument 42% calmer than its profile claimed — calm enough that an hour of
simulation produced almost nothing. The shock is scaled by `√3` so the parameter
means what it is named.

**The resting level is where each seeded story ended, not where it opened.**
Reverting toward the opening price looked more natural and destroyed the demo:
INFY's story is a genuine 20% fall from 1500 to 1200, and a pull back toward
1500 rallied it 25% in the first few minutes, turning the one instrument that is
supposed to have actually gone down into another round trip. Each story keeps its
shape by oscillating around its own ending.

Measured rather than assumed: ~50 events per hour across twelve instruments, and
prices within 5% of each story's ending price after four simulated hours.

### Out-of-order ticks

`observeTick` rejects a tick from the past rather than reordering or dropping it,
because silently accepting one corrupts history in a way no later read can
detect. That rejection is a `throw`, and the simulator calls it from a
`setInterval` — so a clock stepping backwards would take the generator down. The
simulator skips that instrument for that step instead. Recording nothing is
cheap; inventing a timestamp to get past the check would be the dishonest fix.

### Reproducibility

The PRNG is seeded (mulberry32), so the whole simulation is a pure function of
(seed, step count). A test asserts that the same seed writes the same history
twice — without that, a failure in generated data would be unreproducible.

### Calibrated quiet

Three instruments (TCS, WIPRO, ITC) have a volatility that puts the 5% threshold
roughly twenty-six standard deviations away. They stay quiet through a running
demo, which the screen explaining "quiet is not the same as nothing" depends on.
A test runs two thousand steps and asserts zero events.

## Explicitly deferred

Deferred means *"we have a place to put it, and we are not building it now."*
Each of these should be introduced only when a specific, observed problem
demands it.

| Deferred | Why it is not needed yet |
| --- | --- |
| **Kafka / any message broker** | "Append-only event log" is a data-model property. A table with an ordering column provides it. A broker would add operational cost and buy nothing at current scale. |
| **Redis / external cache** | There is no measured read-latency problem. The feed query is a bounded read from one indexed table. |
| **Microservices** | The boundaries above are enforced by package structure. Splitting them across a network would add failure modes without changing the design. |
| **Postgres** | Deferred, not rejected. Expected once we need concurrent writers or hosted deployment. The SQL-only boundary is what keeps this cheap. |
| **Real-time push (WebSocket/SSE)** | The client polls — 2s for the market header, 4s for the watchlist, 8s for the feed. A push channel buys latency nobody is measuring, and costs a connection lifecycle, a reconnect policy, and a second delivery path for the same data. |
| **A real ingestion pipeline** | The simulator writes in-process through the ordinary stores. Duplicate ticks, out-of-order arrival across a network, backpressure, staleness detection and provider health are all undecided, and are a phase of their own rather than something to grow the simulator into. |
| **Auth / multi-user identity** | `userId` is a query parameter and a text box, which is what makes "two people see different things" demonstrable by typing a name. A login would add a session layer without changing a single thing about how the feed is computed. |
| **Background job scheduler** | The simulator's `setInterval` is the only scheduled work, and it lives in the composition root. A scheduler becomes interesting when something must survive a restart or run on more than one process. |
| **Docker / deployment pipeline** | Local development needs no containers today. |
| **ORM** | Hand-written SQL against a small schema is clearer and keeps the swap-to-Postgres path visible. Revisit if the schema grows awkward. |
| **Shared component library / design system** | Four screens do not need one. Tokens and a type scale, yes — those exist in `styles.css`. An `InstrumentRow` / `StatusPill` / `PriceDisplay` layer is the speculative abstraction §2.3 exists to refuse, and it was declined explicitly in iteration 8. |

## Testing approach

`vitest` across all three packages, run from the root in one pass.

- `domain` — plain unit tests over pure functions. No mocks needed.
- `server` — the real Express app against an in-memory SQLite database driven
  in-process with `supertest`. No network, no fixtures to clean up.
- `web` — component tests in `jsdom` with Testing Library.

The current suite is a smoke test: it asserts the stack boots, migrations apply
idempotently, the API answers, and the client renders. It is deliberately thin —
its job is to prove the wiring, and to fail loudly if the foundation breaks. Test
count is not a quality metric here and should not be quoted as one; what matters
is that the foundation's failure modes are covered.

## Product invariants

The four properties the system exists to guarantee. Every feature should trace
to one; each is covered by tests named for it.

| # | Invariant | Where it is proved |
| --- | --- | --- |
| **I1** | A meaningful event is independent of the final price. Recovery does not erase history. | `golden-scenario.test.ts` |
| **I2** | Events are append-only. A record is never mutated or deleted. | `market/log.test.ts` |
| **I3** | The significance engine is deterministic and pure. | `market/significance.test.ts` |
| **I4** | Each user consumes events independently. | `attention/watermark.test.ts` |

## Quality gate

`npm run verify` runs `format:check`, `lint`, `typecheck`, `test`, and `build` in
that order. It exists because this codebase is grown largely by AI agents, and
mechanical checks are what keep generated code from accumulating drift that only
shows up much later. Every change — human or agent — passes `verify` before it
is committed.

## A note on abstraction

`Clock` is a port because time-dependent rules are otherwise untestable, and
replay depends on controlling "now". It is the exception, not the template.

The rule going forward: **introduce an abstraction when a real second
implementation appears, not when one is imaginable.** No repository interfaces
before there is a repository, no provider factories before there is a second
provider. Premature indirection is the most likely way this design degrades.
