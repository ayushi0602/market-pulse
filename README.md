# Market Pulse

> What happened while I was away, and why did it matter?

A market awareness tool that preserves meaningful market transitions instead of
overwriting them with the latest snapshot.

**Status: Step 1 — project foundation.** The stack is wired end to end and
tested. No market features are implemented yet.

- [ARCHITECTURE.md](ARCHITECTURE.md) — product thesis, domain concepts, module boundaries, deferred complexity
- [CUT_LIST.md](CUT_LIST.md) — what we are deliberately not building, and why

## Requirements

- **Node.js >= 22.5.0** (the built-in `node:sqlite` driver is required)
- npm 10+

No database server, container runtime, or native build toolchain is needed.

Check your version:

```bash
node --version
```

## Setup

```bash
git clone <repo> market-pulse
cd market-pulse
npm install
```

Configuration is optional — every value has a working default. To override:

```bash
cp .env.example .env
```

## Running locally

Start the API and the web client together:

```bash
npm run dev
```

| Service | URL |
| --- | --- |
| Web client | http://localhost:5173 |
| API | http://localhost:4000 |

The web dev server proxies `/api` to the backend, so the browser stays on a
single origin and there is no CORS configuration to maintain.

Seed the demo data — the golden scenario plus two contrasting instruments:

```bash
npm run db:seed
```

Then open http://localhost:5173 and toggle between **Traditional watchlist** and
**Market Pulse**. RELIANCE ends the day exactly where it started: the traditional
view reports 0.00%, and the feed reports the 9% fall and the 9.89% recovery that
happened in between.

The app opens on **My watchlist** — everything you follow, including
instruments that have done nothing. TCS is there with a recorded price and "No
meaningful changes"; RELIANCE is flagged with "2 meaningful changes — but the
price came back". That contrast is the product:

```
WATCHLIST        what I care about
ATTENTION FEED   what changed enough to deserve attention
```

They are deliberately different lists. Prices are labelled *as recorded*, never
*live*, because there is no market ingestion behind them.

The **Replay** tab steps through the same history one event at a time. The
snapshot number moves — 0.00%, then −9.00%, then back to 0.00% — while the
revealed events stay on screen. Watching it changes nothing: not the events, and
not your read position.

Verify it is up:

```bash
curl http://localhost:4000/api/health
# {"status":"ok","version":"0.0.1","time":1788514633213,"database":"ok"}
```

Run either side on its own:

```bash
npm run dev:server   # API only, with watch/reload
npm run dev:web      # Web client only
```

## Testing

```bash
npm test         # run every suite once
npm run test:watch
```

Tests for a single package:

```bash
npm test -w @market-pulse/domain
npm test -w @market-pulse/server
npm test -w @market-pulse/web
```

The server suite runs the real Express app against an in-memory SQLite database
in-process — no running server and no test database to provision.

## Quality gate

```bash
npm run verify   # format:check + lint + typecheck + test + build
```

`verify` is the single command that must pass before any change is committed.
Its parts can also be run alone:

```bash
npm run format:check   # prettier
npm run format         # prettier --write
npm run lint           # eslint (type-aware)
npm run lint:fix       # eslint --fix
npm run typecheck      # tsc --noEmit across all packages
npm run build          # production build of the web client
```

Linting is type-aware, and it also enforces the dependency rule from
[ARCHITECTURE.md](ARCHITECTURE.md) mechanically: `domain` cannot import
`server`, `web`, Express, React, or a `node:` built-in, and `server` and `web`
cannot import each other. A violation fails `npm run lint`, not code review.

## Database

SQLite, via Node's built-in driver. The database file defaults to
`./data/market-pulse.sqlite` and is created on first run.

Migrations are numbered `.sql` files in
[`packages/server/src/db/migrations/`](packages/server/src/db/migrations/),
applied in filename order inside a transaction and recorded in
`schema_migrations`. **They run automatically on server start**; the runner is
idempotent. To apply them without starting the server:

```bash
npm run db:migrate
```

To reset local data, delete the file and restart:

```bash
rm -rf data/ && npm run dev:server
```

## Layout

```
packages/
├── domain/   Pure TypeScript domain core + shared wire contracts.
│             No Express, no SQL, no React.
├── server/   Express API, SQLite persistence, migrations.
└── web/      React + Vite client (scaffold shell only).
```

`domain` depends on nothing. `server` and `web` both depend on `domain`, and
never on each other. See [ARCHITECTURE.md](ARCHITECTURE.md) for the reasoning.
