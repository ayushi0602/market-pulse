# Cut List

Features and technologies Market Pulse is **intentionally not building**.

This exists so that scope arguments happen once, here, instead of repeatedly
during implementation. A cut is not a permanent ban — it is a statement that the
item is out of scope until something specific changes. Where a cut could
plausibly be revisited, the trigger is written down.

## Product features we are not building

### Trading and order placement
No buying, selling, order entry, brokerage connections, or position management.
Market Pulse is a **read-only awareness tool**. Accepting orders would pull in
regulatory obligations, custody of funds, and an entirely different risk profile,
none of which serve the core question.

### Portfolio analytics
No holdings, cost basis, P&L, returns, allocation breakdowns, or tax reporting.
These describe *your position*; Market Pulse describes *what happened in the
market*. Different question, different product.

### Stock prediction / forecasting
No price targets, no directional forecasts, no "expected move" modelling.
The product explains what **already happened** and why it mattered. Prediction
is a fundamentally harder and less honest claim, and it would undermine trust in
the explanations we do give.

### Social features
No follows, comments, sharing, feeds-of-people, leaderboards, or chat.
The attention feed is ranked by *market significance relative to one user's
absence*, not by what other people are doing. Social signal would corrupt that
ranking.

### Complex charting
No candlesticks, drawing tools, technical indicator overlays, multi-timeframe
comparison, or interactive zoomable price charts.
If an event needs visual context, the bar is a small, static, purpose-built
sparkline — not a charting platform. Charting libraries are heavy and tend to
become the product.

### LLM-generated investment advice
No "should I buy", no AI-authored recommendations, no generated market
commentary presented as insight.
If natural language is ever used, it is to *describe an event that provably
occurred*, derived from data we hold, never to advise. This one is a hard line,
not a deferral: advice creates liability and misleads users regardless of how it
is caveated.

### Alerts, notifications, and email digests
Not in the near term. The core interaction is "you come back and we tell you what
you missed". Push channels are a distribution problem to solve *after* the
ranking is good enough to be worth pushing.

## Infrastructure we are not building

### Microservices
A modular monolith with enforced package boundaries gives the same separation of
concerns without network calls, distributed tracing, or independent deploys.
**Revisit when:** a single component has a genuinely different scaling or
availability profile — not before.

### Kafka / message brokers
The append-only event log is a **domain concept**: an ordered, immutable table.
It is not a requirement to run a broker. Kafka would add operational burden,
another failure mode, and eventual-consistency complexity for a workload that a
single indexed table handles.
**Revisit when:** ingestion throughput actually exceeds what direct writes
sustain, measured, not assumed.

### Redis / external caching
There is no measured latency problem. The feed is a bounded, indexed read.
Adding a cache now would introduce invalidation bugs to solve a problem we do
not have.
**Revisit when:** profiling shows read latency is the bottleneck and query
tuning has already been tried.

### Containers, orchestration, CI/CD pipelines
Local development runs with `npm install` and `npm run dev`. No Docker, no
Kubernetes, no deployment automation yet.
**Revisit when:** there is somewhere to deploy to.

### Heavyweight framework choices
No ORM, no GraphQL, no state-management library, no CSS framework, no
authentication provider, no monorepo build orchestrator (Nx/Turborepo).
Each of these solves a real problem that we do not yet have. They get added when
the pain is concrete, one at a time.

## The rule

> Add complexity in response to an observed problem, never in anticipation of
> an imagined one.

Anything on this list can be reopened. Reopening it requires naming the specific
problem it solves and what was tried first.
