# Second audit

A second audit, and the remediation that followed it.

Where [AUDIT.md](AUDIT.md) was written by reading the repository, this one was
written by **running it and trying to break it** — the gate, the live app, the
API under hostile input, and the read endpoints under synthetic load. Then every
finding that could be fixed inside the existing design was fixed.

Audited and remediated: 2026-09-05, from commit `a7e318a` on `main`.

| | Before | After |
| --- | --- | --- |
| `npm run verify` | green — 266 tests, 22 files | green — **315 tests, 25 files** |
| Findings open | 13 | **2 accepted, 11 closed** |

---

## 1. Method

Nothing below was inferred from reading code. Each finding came from a command,
and each fix was re-verified the same way.

- Read every source file in `domain` and `server`, and the web client's data
  layer, against `AUDIT.md`, `ARCHITECTURE.md`, `CUT_LIST.md` and `README.md`.
- Ran `npm run verify`. Reset and reseeded the database, ran the app, and drove
  all four screens at 1440px and 375px.
- Probed every endpoint with malformed, oversized, hostile and cross-user
  requests.
- Benchmarked the read endpoints against synthetic logs of 1,000 / 5,000 /
  20,000 events.
- Measured colour contrast and read the ARIA tree out of the live DOM.
- Mutation-tested each fix: broke it deliberately, confirmed the new test failed,
  restored it.

---

## 2. What was found, and what was done

Ordered by severity. Every one was reproduced before it was fixed.

### 2.1 The market-context tag had no recency window — **fixed**

`classifySignal` selected the most recent benchmark event at or before the one
being classified, with no bound on how old that reference could be. Because the
benchmark crosses the same 5% threshold as everything else, it routinely sits
still for hours, and every same-direction move in that window inherited a
**Market-wide** tag.

Reproduced live:

```
NIFTY last moved:  18:57:29  advance 5.14%   (nothing after)

20:10:24  ZOMATO  advance 5.02%  ->  market-wide   reference age: 72.9 min
```

The UI rendered that as **MARKET-WIDE**, explained as *"the instrument is doing
what everything is doing"* — about a market that had been flat for over an hour.
A second-order effect made it worse: two ZOMATO *declines* in the same minute
read `stock-specific` only because the stale reference happened to be an
advance. One hours-old event was driving every verdict.

**Why the suite could not see it.** Every fixture in `signal-context.test.ts`
placed the benchmark at `T0 - 1` — one millisecond before the event. The one
test using `T0 - 2 * HOUR` also supplied a closer reference, so it tested "pick
the nearest", not "reject the ancient". `SC1` proved a benchmark from the
*future* cannot leak in; nothing covered the distant *past*. `grep` for
`window|recency|maxAge` returned nothing anywhere in the repository.

**The fix.** `MAX_BENCHMARK_REFERENCE_AGE_MS`, exported and commented beside
`OUTLIER_FACTOR`, set to 30 minutes — the seeded market's own observation
cadence, so a benchmark move stays comparable exactly as long as it takes the
next observation to supersede it. A placeholder in the same spirit as
`DEFAULT_RULE.thresholdBps`, and labelled as one.

**The demo story is unchanged**, which was the constraint that decided the value:
every classified event in the seeded catalogue shares an exact timestamp with its
reference, so all of them are age 0. Verified live after the fix — RELIANCE's
decline still `market-wide`, its recovery and INFY's −20% still `outlier`, and
**zero** events now judged against a reference older than the window.

New block `SC2`, four tests. Mutation: removing the window fails it.

### 2.2 No Express error handler — **fixed**

`app.ts` mounted a 404 handler and no error-handling middleware, so anything
`express.json()` rejected fell through to Express's default handler:

```
POST /api/watchlist  -d '{bad json'
  <!DOCTYPE html> ... SyntaxError ...
    at parse (/Users/ayushi/market-pulse/node_modules/body-parser/lib/types/json.js:91:21)
```

Confirmed on all three POST endpoints, and on an oversized body. Three problems
in one: the `{ error }` JSON contract every other failure honours was broken and
the client's `json()` helper throws on HTML; absolute paths, dependency layout
and stack frames were disclosed; and it contradicted this project's own stated
rule about errors.

**The fix.** One `errorHandler`, mapping `entity.parse.failed` → 400 and
`entity.too.large` → 413, everything else to a generic 500 that discloses
nothing while logging the detail server-side. New file `test/errors.test.ts`,
nine tests including explicit assertions that no filesystem path, stack frame or
HTML reaches the caller. Mutation: unregistering the handler fails seven of nine.

### 2.3 Two screens disagreed about every price — **fixed**

*My watchlist* rendered the live snapshot; *While you were away* rendered the
`toPrice` of the most recent unread **event**. With the generator running — the
default — these diverge continuously:

```
SYMBOL          My watchlist   While you were away
INFY                1,176.61              1,200.00   1.95% apart
TATAMOTORS            976.36                955.92   2.14% apart
```

Sharper on the watchlist row itself: RELIANCE reported `netChangeBps: 0`,
rendered as **"2 meaningful changes — but the price came back"**, printed beside
a live price of **₹2,814.51**. The events came back to ₹2,900.

This is a Phase 9 regression. With `MARKET_SIMULATION=off` everything is
coherent, and every piece of UI reasoning in the iteration log predates the
simulator. The project's own rule — *never let the UI claim more than the data
model knows* — had only ever been applied **within** a screen, never across two.

**The fix**, taking the stronger option rather than the cheaper one:

- `FeedInstrumentSummary` now carries `observedPrice` / `observedAt`, so the feed
  can state both readings. The Traditional view shows the event price and its
  net change, then *"now ₹2,893.78 as recorded 8:59 pm"* when they differ.
- The watchlist row says *"net 0.00% across them"* rather than *"but the price
  came back"* — scoped to the events, making no claim about the current price.
  Both the zero and non-zero cases now read the same way.
- Row copy changed from *"No change since your last check"* to *"No change
  across what you missed"*, for the same reason.

The argument still lands — RELIANCE reads ₹2,900.00 / 0.00% / "No change across
what you missed" — and it is now also true about the present.

**Note on the dependency.** The feed route needed the snapshot store, and gets it
as `Pick<SnapshotStore, 'list'>` rather than the whole thing. The feed has no
business recording an observation, and narrowing the type keeps that structural
rather than remembered, the way replay holds no `WatermarkStore`.

### 2.4 Watchlist cost scaled with the whole log — **fixed**

The brief asks entrants to decide "how the system scales for larger watchlists
and more users". Measured, one user following **exactly one instrument**, with
only the log size varying:

| Event log | `GET /watchlist` before | after | `GET /attention-feed` before | after |
| --- | --- | --- | --- | --- |
| 1,000 | 3.2 ms / 0.2 KB | **1.9 ms** / 0.2 KB | 5.2 ms / 224 KB | **4.4 ms / 19 KB** |
| 5,000 | 9.1 ms / 0.2 KB | **1.1 ms** / 0.2 KB | 14.8 ms / 1,102 KB | **8.0 ms / 19 KB** |
| 20,000 | 26.4 ms / 0.2 KB | **1.7 ms** / 0.2 KB | 58.7 ms / 4,405 KB | **29.9 ms / 19 KB** |

The watchlist response was a constant 0.2 KB while its latency grew linearly with
the log — eight times the work to render the same single row, polled every four
seconds. The cause was two lines in `watchlist.routes.ts`: `readAfter(watermark)`
and `snapshots.list()`, both narrowed afterwards inside `buildWatchlist` by
entries the route already had. The index that serves this,
`idx_market_events_instrument_sequence`, already existed and was unused on that
path.

**The fix.** `EventStore.readAfterForInstruments` and `SnapshotStore.listFor`,
plain parameterised `IN` clauses, chunked at 900 bound parameters so the query
does not silently break the day a watchlist gets large. Empty list returns
nothing rather than everything — an empty `IN ()` is not valid SQL, and "events
for no instruments" is genuinely none. `buildWatchlist` is untouched, so the
response is identical; a test proves it is byte-identical whether or not
unfollowed instruments have events. Watchlist latency is now flat in log size.

`GET /replay/instruments` also stopped materialising the whole log into a JS
`Map` on every request; it is a `GROUP BY` now.

### 2.5 The attention feed was unbounded — **fixed, with a caveat**

No limit, no cursor, no page size. The longer someone stayed away — the premise
of the product — the larger the response, without bound: 4.4 MB at a 20,000-event
log, re-fetched every 8 seconds.

**The trap, which is why this needed care.** Events are ranked by *magnitude*, so
the returned page is **not a prefix** of the log, and no single sequence
describes "the 50 you were shown". A single watermark cannot express a
non-prefix acknowledgement. Acknowledging only the page would strand the rest
permanently, because watermarks only move forward.

The resolution is that the control already says **"Mark all as read"**, and that
stays true under a display cap. So:

- `events` is capped at `EVENT_LIMIT` (50), ranked, most significant first.
- `summary.meaningfulChanges` and `summary.instruments` cover the **whole
  window**, never the page. A count that quietly meant "of what we sent you"
  would be the same class of dishonesty this product exists to refuse.
- `throughSequence` is still the whole window.
- The UI says so: *"Showing the 50 largest of 3,412 changes. **Mark all as read**
  still marks every one of them, not only those shown."*

**Caveat, stated rather than hidden.** The *payload* is now bounded and constant
(19 KB at every log size). The *server-side read* is not: the route still reads
the full unread window because the summary counts must be complete, so feed
latency still grows with the log (4.4 → 8.0 → 29.9 ms).

**This was considered and deliberately not done**, which is a different thing
from not getting to it. Bounding the read means two changes, and the second one
is the problem:

1. The per-instrument summary becomes a `GROUP BY` with a join back for the
   first and last prices. Portable, straightforward, fine.
2. The event list would have to become `ORDER BY magnitude_bps DESC, sequence
   DESC LIMIT 50` — which puts **F5, a load-bearing product rule, in SQL as well
   as in `rankBySignificance`**. Two definitions of "what deserves attention
   first", coupled only by whoever remembers to change both.

That trade is bad at this scale. 30 ms of server work every 8 seconds, for a
reader who has been away long enough to accumulate 20,000 unread events, is not
a problem this product has; duplicating a ranking rule across two languages is a
problem it would acquire permanently. If the read ever does need bounding, the
right move is to make the SQL the single definition and delete the domain
function — not to run both.

Recorded here because "we measured it, and chose not to" is the answer, not "we
did not look."

### 2.6 Any string was a valid instrument — **fixed**

`POST /watchlist` refused exactly one symbol and accepted everything else:

```
{"instrumentId":"<script>alert(1)</script>"}  ->  201 Created
{"instrumentId":"AAAA...×300"}                ->  201 Created
```

The asymmetry was the striking part: a careful, case-insensitive, route-level
boundary for one forbidden symbol, and no rule at all for the infinite rest.

**The fix keeps the product decision and bounds the input.** Following a symbol
this market does not trade is still allowed and still reads *"Never observed"* —
that is deliberate, documented in the UI footnote, and a better answer than an
invented price. What was not deliberate was unbounded length and arbitrary
characters. Now a shape check (`^[A-Za-z0-9.&-]{1,20}$`, admitting `M&M` and
`BAJAJ-AUTO`), explicitly **not** a membership check against `CATALOGUE`, which
would have quietly reversed the decision.

And the discoverability half: `GET /api/instruments` serves the catalogue, and
the "Add a symbol" input is backed by a `datalist`, so following an unknown
symbol is a choice rather than an undetectable typo. The benchmark is listed and
flagged, but excluded from the suggestions the input offers, since the server
refuses it.

### 2.7 Resuming a market with nothing to simulate reported success — **fixed**

The reviewer path one step off the README — `npm run dev` before `npm run
db:seed`:

```
POST /api/market-status {"running":true}  ->  200 {"running": false}
startup log:  "Simulating 0 instrument(s) every 3000ms."
```

Success reported for an operation that did not occur, leaving the UI's Resume
control inert with nothing to explain it. Now a `409` naming the fix ("run `npm
run db:seed`"), and a startup message that says what is actually true. Pausing
still succeeds, because pausing is always a real operation.

### 2.8 The client discarded every server error message — **fixed**

`api.ts` threw ``API responded ${status}`` and dropped the body, so the server's
*"NIFTY is a market benchmark, not something a watchlist can follow"* reached the
user as *"That did not save — API responded 400."* The error copy was written by
the only party that knows why, and then thrown away. It now surfaces the body's
`error`, falling back to the status when there is nothing usable.

### 2.9 Accessibility — **fixed, and one earlier claim corrected**

Measured in the live DOM against `#f8f8f8` (AA needs 4.5:1):

| | before | after |
| --- | --- | --- |
| `.attention-note` — the primary watchlist signal | **2.70** | 5.01 |
| `.muted` / `.observed` / `.link` | **4.01** | 5.01 |

Groww's brand green is genuinely low-contrast as *type*, so the fix splits the
roles rather than changing the palette: `--advance-fill` stays the brand green
for pills, dots and tints, and `--advance` is a deeper shade of the same hue used
only for text. Ratios are recorded in the stylesheet so a future change has to
face the number.

**The tabs were half an ARIA pattern**: `role="tablist"` and `aria-selected`, and
then no `role="tabpanel"`, no `aria-controls`, and no keyboard model — announcing
"tab, selected" while Tab moved to the next tab instead of into the content. Now
complete: ids, `aria-controls`, a panel with `aria-labelledby`, roving
`tabIndex`, and arrow / Home / End navigation with wrapping. Five tests.

One bug in my own first implementation, caught by driving the live DOM rather
than the test: the handler moved relative to the **selected** tab rather than the
**focused** one. They are normally identical, and came apart the moment focus was
moved any other way. It reads the event target now, and a test pins it.

**A correction to my own earlier finding.** I reported "zero `aria-live` regions"
after querying `[aria-live]` on the watchlist screen. That was overstated: the
arrival banner already used `role="status"`, which carries the same semantics, so
new events *were* announced. What genuinely lacked announcement was the
market-status strip (pause/resume state) and the watchlist's attention count.
Both now have `aria-live="polite"` — scoped deliberately to those two lines and
**not** to the ticking timestamp or the twelve prices, because a live region over
everything that moves is not an accessible page, it is an unusable one.

### 2.10 Benchmark inconsistency and the replay landing story — **fixed**

NIFTY was refused by watchlists, excluded from the feed, and then sat in the
replay picker as an ordinary peer with no context tags and no explanation — the
one screen where the design intent never reached the interface. The catalogue
response now carries `isBenchmark`, the picker labels it *(market benchmark)*,
and it is never the default selection.

Replay also opened on **INFY — one event**: press Play, one step, done, while
RELIANCE, the round trip the whole product exists to explain, sat third. The
picker still lists everything largest-move first; the landing choice is now the
richest story.

### 2.11 The acknowledgement boundary was order-dependent — **fixed**

`throughSequence` came from a second `events.head()` call made *after* the unread
records were read. Safe today only because `node:sqlite` is synchronous and a
timer cannot preempt a synchronous handler — the safety came from the runtime,
not the code, and nothing recorded that. One `await`, or the async driver the
Postgres note contemplates, and an event landing between the two reads would be
acknowledged without ever being shown: the exact F1 failure the module exists to
prevent.

It is now derived from the records already in hand. **The subtlety worth keeping:**
it comes from the *unfiltered* read. Deriving it from the benchmark-filtered list
would leave a trailing run of benchmark events permanently unreachable, and the
watermark would never catch up to a log whose newest entries are the index
moving. New block `F6b`, with a test for exactly that case.

---

## 3. Changes made to existing tests, and why

Six existing tests changed. §2.8 of `ENGINEERING_NOTES.md` forbids changing an expectation
to match the code, so each is justified individually.

| Test | Change | Justification |
| --- | --- | --- |
| `AC3: offers no way to update or delete` | Enumeration extended, **plus** a new direct assertion | The enumeration was the mechanism; the intent is "no mutating operation". It now asserts that intent directly — `append` is the only writer, and no method name matches update/delete/remove/etc. **Strengthened**: it would now fail even if someone extended the list without thinking. |
| `uses the most recent benchmark event before a gap` | Fixture moved inside the reference window | The test's stated purpose is *which of two candidates wins*. Its fixture happened to place the winner an hour back, so it also asserted "an hour-old reference is admissible" — the exact thing §2.1 fixes. The purpose is preserved; the incidental second assertion is removed, and `SC2` owns it. |
| `says the price came back rather than reporting a flat 0%` | Renamed, rewritten, **extended** | The block's intent — *a round trip is distinguished from nothing happening* — is preserved and now asserted on all three cases including the quiet instrument. A second test was added pinning the actual defect: the row must not imply where the price is now. |
| `opens on the biggest story` | Renamed, expectation changed to RELIANCE | A deliberate behaviour change (§2.10), not a test bent to fit code. The new name and comment state the new intent. |
| `loads the chosen story`, `never names a user` | Instrument swapped INFY ↔ RELIANCE | Consequence of the new default. The assertions — cursor resets, no `userId` ever sent — are unchanged. |
| `shows the traditional view reporting no change` | Copy string updated | Consequence of the wording change in §2.3. The assertion is the same. |

No test was deleted, skipped, or weakened. No lint rule was disabled, no type
widened, no `any` or `!` introduced.

---

## 4. Not fixed, and why

Two findings are left open deliberately.

**No authentication.** `userId` is a query parameter, so any caller can read or
advance any reader's position — confirmed from `curl`:

```
POST /api/attention-feed/ack {"userId":"priya","throughSequence":1}   -> 200
DELETE /api/watchlist/TCS?userId=priya                                -> 200
```

Because watermarks only move forward, a forged acknowledgement is
*unrecoverable*. Adding auth is a phase, not a patch, and it is on the cut list.
What was wrong was the *framing*: the README described this as "one user, one
watchlist, no auth", which reads as a read-scope simplification when the real
exposure is cross-user **writes**. That wording should be corrected to say so,
and to note that the model is auth-ready — the watermark is already keyed by user
and enforced in SQL, so the change is a middleware that derives `userId` from a
session instead of the query string.

**Feed read cost.** As noted in §2.5, the response is bounded but the server-side
read is not. Left open on a judgement call rather than for lack of time: the
event half of that fix would put the F5 ranking rule in SQL alongside
`rankBySignificance`, and two definitions of a load-bearing product rule cost
more than 30 ms every 8 seconds does at this scale.

### Considered and rejected

Three things were *not* done, on purpose, and the reasoning matters more than
the list:

- **Membership validation against `CATALOGUE`.** Would have silently reversed a
  documented product decision — that following an untraded symbol is allowed and
  honestly reads "Never observed". Bounded the input's *shape* instead.
- **Acknowledging only the events shown.** Looks like the obvious companion to
  the feed cap and is a correctness bug: the page is not a prefix of the log, so
  it would strand unshown events forever.
- **Any further feature work.** The brief says *"don't optimise for what you
  think we want to see"*, and every addition here has already cost something on
  the simplicity axis. The remaining gap in this submission is not code.

---

## 5. Verification

```
npm run verify   green — 315 tests across 25 files (+49), build 217 kB / 67 kB gzipped
```

Re-verified against the running app after every fix, not only in tests:
malformed and oversized bodies on all three POST endpoints, the shape check, the
untraded-symbol path, the instruments endpoint, the cold-start 409, the recency
window across the whole seeded feed, price reconciliation across both screens,
contrast and the ARIA tree read out of the live DOM, and arrow-key tab
navigation.

**Responsive and theme pass, after the changes.** The first pass in this audit
checked 375px *before* the fixes, which is the wrong order and is how the
project's own rule is phrased — look at the screens **after** changing them.
Re-checked at 390 / 768 / 900px across all four screens: no horizontal overflow
anywhere, and no element wider than the viewport.

That pass found a regression I had introduced. The new watchlist copy — *"net
0.00% across them"* — wrapped to two lines at 390px on **every** row, orphaning
the single word "them". Measured rather than eyeballed: a hidden probe element
at the real container width (316px) showed `across them` producing two lines
with one word on the last, and `overall` fitting on one line at every event
count. The copy is now *"net 0.00% overall"*, which scopes the figure to the
changes just as precisely. This is the fifth UI defect in this repository's
history found by looking and not by a test, and the count is the argument.

Contrast re-measured in **both** themes after the token change: light 5.01 /
9.63 (`.muted` / `.attention-note`), dark 7.39 / 9.63. Both pass AA. Only the
light tokens were changed; the dark set was already comfortable and was left
alone.

**Cold-clone rehearsal** — `AUDIT.md` §9.2 listed this as outstanding since
iteration 7, and the code has moved a long way since. Copied the tracked tree to
a clean path and ran the exact reviewer sequence:

```
npm ci        -> 0 vulnerabilities
npm run db:seed  -> 20 events, 13 instruments, two readers
npm run verify   -> exit 0, 315 tests, 25 files
boot             -> "Simulating 13 instrument(s) every 3000ms"
                    demo  19 unread · priya 8 unread   (same log, same instant)
```

No missing file, no path assumption, no step the README does not mention.

**One environment artifact worth recording**, because it briefly looked like a
bug: after re-seeding, the log jumped to 86 events in fifteen seconds. That was
not the application. An earlier `npm run dev` had left a second `concurrently`
supervisor alive, and two simulators were writing to the same database file.
Killed both, restarted once, and the rate returned to the expected ~1 event per
3-second tick. If the event count ever looks impossible, count the running
supervisors before suspecting the generator.

---

## 6. Still outstanding, and not code

1. **Confirm the push.** `origin` is set to
   `github.com/ayushi0602/market-pulse`, but there is no `origin/main` ref in
   this clone, which means no push has ever succeeded from here. A submission
   judges cannot clone scores nothing regardless of what is in it.
2. **`PITCH.md` now exists** — the 100-word product pitch the challenge FAQ lists
   as a required deliverable, which was missing. Counted, not estimated: 99 words
   by whitespace split, 100 counting the em dash.
3. **CI now exists** — `.github/workflows/verify.yml` runs the gate on push and
   pull request. It had been the highest-value remaining item in `AUDIT.md` §9.2
   and was still unbuilt.
4. **Rehearse the demo once**, using the pause control.
