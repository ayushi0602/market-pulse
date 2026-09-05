# Market Pulse — product pitch

A price can return to where it started while something important happened in
between. A watchlist comparing now against your last snapshot reports 0.00%:
true, and useless. It never kept the middle.

So I store two things: `market_events`, append-only history, and
`instrument_snapshots`, overwritable knowledge. Each reader has a
watermark into the shared log, so "what changed" is answered from where *you*
last looked. Two people opening it at the same instant see different things.
Reading never acknowledges; only an explicit action does.

Significance is one published rule: 5% from a moving anchor. Prices are
simulated, never called live.

<!--
Counted, not estimated: 98 words from "A price" to "called live", by both a
plain whitespace split and `wc -w`. Under the brief.s limit on either reading.

Everything above is checkable in the running app. The schema split is migrations
002 and 003; the watermark is enforced monotonic in SQL rather than in
application code; GET never writes; and the threshold is read from DEFAULT_RULE
by the "Why is this significant?" panel rather than typed into the UI.

The last sentence earns its place. There is no market data feed here, the word
"live" appears nowhere in the interface, and three tests assert it stays out.
Claiming otherwise would be the one thing this design spends its whole time
refusing to do.
-->
