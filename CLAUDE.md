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

**Money and prices.** Never use floating point for currency in stored or
compared values. Decide the representation (minor units as integers) when the
first price field lands, and record it here.

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
| 2 | **Domain model + golden scenario** | ⏳ next |
| 3 | Persistence for the event log and watermarks | ⬜ |
| 4 | Attention feed API | ⬜ |
| 5 | UI: "Since you last checked" | ⬜ |
| 6 | Replay / demo mode | ⬜ |

### Phase 2 scope (next)

**Domain layer only.** No HTTP, no SQL, no React.

Model, as pure functions and types in `packages/domain`:

```
MarketTick  →  MarketState  →  MeaningfulMarketEvent  →  EventSequence  →  UserReadWatermark
```

And the signature test the whole submission rests on:

> A user last looked at ₹100.
> The stock falls to ₹91 — a meaningful event is generated.
> The stock recovers to ₹100.
> The user returns.
> **→ The event is still surfaced.**

A snapshot-diffing watchlist shows "no change". That test is the product.

Constraints for Phase 2: no database work, no endpoints, no components, and no
abstraction that a Phase 2 test does not exercise.

---

## Iteration log

Newest first. One entry per iteration: what changed, and what a future agent
needs to know that the diff does not say.

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
