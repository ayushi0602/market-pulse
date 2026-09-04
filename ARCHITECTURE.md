# Architecture

Status: **Step 1 — foundation only.** No market features are implemented yet.
This document records the shape we are building into, so that later steps have
somewhere obvious to put things.

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

These are the nouns the system is organised around. All of them now exist in
`packages/domain` except the Attention Feed's ranking, which arrives with the
feed API.

| Concept | Meaning |
| --- | --- |
| **Instrument** | A thing that can be watched (a ticker/symbol). |
| **Tick** | A raw observation of an instrument at an instant. High volume, low individual meaning. Ticks are input, not history. |
| **Market Event** | A *meaningful transition* derived from ticks — the unit a human would actually care about. Derivation rules are deliberately not decided yet. |
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

### Not yet: the subscription dimension

Watermarks are keyed by `user_id` alone, not `(user_id, watchlist_id)`. There is
no watchlist entity yet, so a `watchlist_id` column would hold a placeholder
constant in every row — a shape that looks like a decision but records nothing.
The key widens in the migration that introduces watchlists, which is a small
change against a table nothing else references yet.

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
| **Real-time push (WebSocket/SSE)** | The product question is "what happened while I was away", which is inherently a pull-on-return interaction. Polling is sufficient until it isn't. |
| **Auth / multi-user identity** | Watermarks need a user id, but not yet a login. A stub identity is enough until the feed exists. |
| **Background job scheduler** | Nothing runs on a schedule yet. Revisit when tick ingestion is real. |
| **Docker / deployment pipeline** | Local development needs no containers today. |
| **ORM** | Hand-written SQL against a small schema is clearer and keeps the swap-to-Postgres path visible. Revisit if the schema grows awkward. |
| **Shared component library / design system** | There are no UI screens yet. |

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
