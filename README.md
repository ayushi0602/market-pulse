# Market Pulse

> **A price can return to where it started while something important happened in between.**

## The problem

A watchlist compares the current price against the last snapshot it showed you.
That answers one question well — *where does this stand?* — and silently discards
everything that happened along the way.

Consider a stock you last looked at when it was ₹2,900.

```
        ₹2,900 ─────────────────────────────────── ₹2,900
              ╲                              ╱
               ╲        ₹2,639              ╱
                ╲──────────────────────────╱
                       you were away
```

You come back. A traditional watchlist tells you:

```
RELIANCE   ₹2,900   0.00%
```

That is **true**, and it is **useless**. It fell 9% and recovered 9.89% while you
were gone, and the interface has no way to say so — because it never kept the
middle.

## The idea

Two kinds of information, deliberately kept apart:

> **State** tells you where the market *is*.
> **Events** tell you what *happened*.

A traditional watchlist stores only the first. Market Pulse stores both, and
answers a question a snapshot cannot:

> *"What happened while I was away, and why did it matter?"*

Because the answer depends on when *you* last looked, two people opening the app
at the same moment see different things.

## The product model

Four concepts, each answering a different question. They are not the same list,
and that is the point.

| | Answers | Example |
| --- | --- | --- |
| **Watchlist** | What do I care about? | RELIANCE, INFY, TCS |
| **Snapshots** | What do we currently know? | RELIANCE, as recorded at 2:15 PM |
| **Event log** | What meaningfully happened? | RELIANCE fell 9%, then recovered |
| **Attention feed** | What changed since *I* last checked? | RELIANCE, INFY — not TCS |
| **Replay** | What happened along the way? | ₹2,900 → ₹2,639 → ₹2,900 |

TCS sits on the watchlist and appears nowhere in the feed. It never crossed the
significance threshold, so there is nothing to report — and it still belongs on
the list, because a watchlist is what you care about, not only what changed.

## Try it

```bash
npm install
npm run db:seed     # three instruments, three different stories
npm run dev
```

Open **http://localhost:5173**. Requires **Node.js ≥ 22.5** (for the built-in
`node:sqlite` driver). No database server, container, or native build step.

### A 60-second walkthrough

**1 — Start on *My watchlist*.** Three instruments. Note **TCS**: a recorded
price, and *"No meaningful changes"*. It is quiet, and it is still here.

**2 — Note RELIANCE:** *"2 meaningful changes — but the price came back."* Click
**View what happened →**.

**3 — *While you were away*** groups what crossed the threshold by instrument.
Instruments are ordered by their largest move — INFY's genuine 20% fall leads —
and each instrument's own events run in the order they happened. Open **Why is
this significant?** on any of them to see the anchor, the move and the threshold
that fired.

**4 — Toggle to *Traditional watchlist*.** Same data, same moment:

```
RELIANCE   ₹2,900.00   0.00%   No change since your last check
```

Toggle back. **The price went nowhere. The story did not.**

**5 — Open *Replay*.** Step through it. The shape fills in as you go and the
snapshot number moves — 0.00%, then −9.00%, then back to 0.00% — while the
revealed events stay on screen. Watching changes nothing: not the events, and not
your read position.

## Key engineering decisions

The ones that shaped the design, not a list of everything:

**History and knowledge are different, so they are different tables.**
`market_events` is append-only and never overwritten; `instrument_snapshots` is
overwritten as we learn. A snapshot makes no claim about the past. This contrast
is the product thesis at the schema level.

**Append-only is enforced, not intended.** The store exposes no update or delete,
and the database refuses both via triggers. Removing an instrument from a
watchlist cannot delete market history — a deletion forced into the request path
does not fail a test, it *cannot execute*.

**Identity is not ordering.** An event has an `event_id` (which event) and a
`sequence` (where it sits). An auto-increment key supplies both and hides the
distinction. A read position points at a sequence, never an id.

**Reading is not acknowledging.** `GET` never advances your read position; only
an explicit `POST` does. Advancing on read is the natural shortcut and a
correctness bug — a refresh, a prefetch, or a second tab would consume events you
never saw, unrecoverably.

**Read positions only move forward.** Enforced in SQL as
`MAX(incoming, existing)`, so a stale client cannot un-read what you have seen.

**`undefined` is not zero.** A quiet instrument reports *no* net change, not a
net change of zero. "Nothing happened" and "it moved 9% and came back" are
different facts, and collapsing them into `0.00%` is exactly the mistake this
product exists to point out.

**The domain is pure.** Significance, ranking, watermarks and replay are
functions over plain values — no clock, no database, no framework. `domain`
cannot import Express, React, or even a `node:` built-in, and ESLint enforces it.

More detail, including what was deliberately *not* built, is in
[ARCHITECTURE.md](ARCHITECTURE.md) and [CUT_LIST.md](CUT_LIST.md).

## Trade-offs and known limitations

Stated plainly, because they affect what the system can honestly claim.

- **A staged move is reported in pieces.** Emission re-anchors, so 2900 → 2726 →
  2639 reports a 6% decline and not the 9% that actually happened. A settle
  window would fix it; it is deferred until the feed shows whether it matters.
- **There is no live market data.** Prices come from a seed script. Every price
  is labelled *"as recorded"* and never *"live"*, and a test asserts those words
  stay out of the UI.
- **Quiet instruments show no percentage.** There is no baseline to compute a
  day-change from, so none is shown. The alternative was inventing a number.
- **Significance is one threshold (5%).** Not calibrated against real market
  behaviour; volatility-relative significance is a real refinement and is not
  built.
- **One user, one watchlist, no auth.** `userId` is a query parameter and a text
  box. Multiple watchlists would widen one primary key.
- **No ingestion pipeline.** Duplicate ticks, out-of-order arrival, staleness and
  provider disconnects are all undecided, and would be a phase of their own.

## Testing

The suite tests **product invariants**, not implementation details — each has a
named block:

- The **golden scenario**: a price that returns to where it started still
  surfaces what happened in between. It asserts the premise first — that a
  snapshot comparison genuinely reports nothing — so the scenario cannot quietly
  stop proving anything.
- **History is append-only**, at runtime and in the database.
- **Restart persistence**, proved with a real child process that writes the story
  and exits before anything reads it back.
- **Read positions are independent** between users and never move backwards.
- **Reading does not acknowledge**, verified on both the server and the client.
- **The engine is deterministic and pure** — same ticks in, same events out.

These are checked by mutation: the threshold comparison, the anchor,
re-anchoring, log freezing, `MAX` in the watermark upsert and more were each
broken deliberately to confirm the matching tests fail.

```bash
npm test
npm run verify   # format + lint + typecheck + test + build
```

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | API (:4000) and web client (:5173) together |
| `npm run db:seed` | Build the demo data |
| `npm run db:reset` | Delete the local database and reseed |
| `npm test` | Every suite |
| `npm run verify` | The full quality gate |

Seeding refuses to run twice against the same database: history is append-only,
so a second run would append a duplicate story rather than replacing it. Use
`db:reset` to start over.

## Layout

```
packages/
├── domain/   Pure TypeScript. Significance, log, watermarks, replay,
│             watchlist, and the wire contracts. No I/O of any kind.
├── server/   Express API, SQLite persistence, migrations.
└── web/      React + Vite client.
```

`domain` depends on nothing. `server` and `web` both depend on `domain` and never
on each other — enforced by lint, not convention.
