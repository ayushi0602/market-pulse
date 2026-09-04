# Progress Log

A running record of each iteration: what was built, what was decided, what was
verified, and what is still open.

**Convention:** every iteration appends a new `## Iteration N` section to this
file (newest at the bottom) and updates the *Current state* block below. Nothing
is deleted — superseded decisions are struck through or corrected in the
iteration that changed them, so the reasoning stays traceable.

---

## Current state

| | |
| --- | --- |
| **Iteration** | 1.5 — quality gate |
| **Repo root** | `/Users/ayushi/market-pulse` (shell `pwd` is `/Users/ayushi`, one level up) |
| **Runs?** | Yes — `npm run dev` serves web `:5173` + API `:4000` |
| **Tests** | 12 passing, 4 files |
| **Gate** | `npm run verify` green (format + lint + typecheck + test + build) |
| **Market features** | None yet — by design |

**Next up:** Iteration 2 — domain model and the golden scenario. Scope and
constraints are recorded in [CLAUDE.md](CLAUDE.md).

---

## Iteration 1 — Foundation

**Date:** 2026-09-04
**Goal:** Inspect the repository and establish a clean foundation. Explicitly
*not* to build the application.

### Starting point

The repository was empty. `/Users/ayushi` is a home directory, not a project,
and the only code-like folder (`development/`) is a Flutter SDK checkout. No
existing conventions to preserve, so the stack was chosen rather than inherited.

### Decisions

| Decision | Reasoning |
| --- | --- |
| Modular monolith, npm workspaces | Boundaries enforced in source, not across a network. No Nx/Turborepo until the build is actually slow. |
| `domain` / `server` / `web` packages | `domain` depends on nothing; the other two depend on `domain` and never on each other. |
| SQLite via built-in `node:sqlite` | Real SQL and real migrations with no service to install and no native compilation. Postgres deferred, not rejected — everything above `db/connection.ts` speaks plain SQL. |
| Express 5 + `tsx` | Smallest thing that serves an API without a build step in development. |
| React 19 + Vite 8, `/api` proxied to `:4000` | Single origin in development, so there is no CORS configuration to maintain. |
| Vitest across all three packages | One runner, one `npm test`, TypeScript natively. |
| TypeScript 5.9, not 7.x | Pinned for tooling compatibility with the Vite/Vitest plugin chain. |
| No project references | Tried first and reverted — see *Course corrections*. |

### Built

- Docs: `ARCHITECTURE.md`, `CUT_LIST.md`, `README.md`, this file
- Root config: `package.json` (workspaces), `tsconfig.base.json`, `vitest.config.ts`, `.gitignore`, `.env.example`
- `packages/domain`: `clock.ts` (Clock port), `contracts/system.ts`, `index.ts`
- `packages/server`: `config.ts`, `app.ts`, `index.ts`, `db/{connection,migrate,migrate-cli}.ts`, `db/migrations/001_init.sql`, `modules/system/system.routes.ts`
- `packages/web`: `App.tsx`, `main.tsx`, `index.html`, vite + vitest configs
- Tests: `clock.test.ts`, `config.test.ts`, `smoke.test.ts`, `App.test.tsx`

### Verified

Everything below was actually executed, not assumed.

- `npm test` → 11 passed, 4 files
- `npm run typecheck` → clean, all 3 packages
- `npm run dev` → migration applied on boot; API `:4000` and proxy `:5173` both
  returned `{"status":"ok","version":"0.0.1","database":"ok"}`; web root HTTP 200
- `npm run db:migrate` on a fresh database → applied `001_init.sql`; rerun →
  correctly reported no pending migrations
- `npm run build` → web client built

### Course corrections

Two things went wrong during the iteration and were fixed rather than papered
over:

1. **Relative `DATABASE_URL` resolved against the wrong directory.** npm runs
   workspace scripts from the *package* directory, so the database was created
   at `packages/server/data/` instead of the repo root. This made a fresh
   migration falsely report "No pending migrations" and made the documented
   reset command a silent no-op. `loadConfig` now anchors relative paths to the
   repo root, covered by a regression test in `packages/server/test/config.test.ts`.

2. **TypeScript project references were abandoned.** They require the referenced
   project to emit, which would force a build step before every run. Packages
   now consume `domain` as TypeScript source via the `exports` field, and
   typechecking is per-package `tsc --noEmit`. Revisit if `domain` ever needs to
   be published or consumed as compiled JS.

### Open items carried forward

- No linter or formatter yet (no ESLint/Prettier) — worth adding before the
  codebase grows.
- `node:sqlite` still prints an experimental warning on boot; Node >= 22.5.0 is
  a hard requirement.
- Nothing is committed. `git init` was run; the working tree is untracked.
- Domain vocabulary (Tick, Market Event, Event Log, Watermark, Attention Feed)
  is documented in `ARCHITECTURE.md` but deliberately not implemented.

---

## Iteration 1.5 — Quality gate and audit fixes

**Date:** 2026-09-04
**Goal:** Add a mechanical quality gate before the feature surface grows, and
act on a review of the Phase 1 code. Explicitly *not* to start Phase 2.

### Starting point

A senior review of Iteration 1 approved the foundation with one required
follow-up (linting/formatting) and one documentation correction (the Postgres
portability claim). Before acting on it, every file in the repository was read
directly — a summary can describe good engineering but cannot demonstrate it.
The code matched its summary, and three defects turned up that the summary did
not mention.

### Built

- **ESLint 10** (flat config, type-aware via `projectService`) and **Prettier**,
  with `eslint-config-prettier` last so the two do not fight.
- **Import-boundary rules.** The dependency rule from `ARCHITECTURE.md` is now
  machine-checked: `domain` cannot import `server`, `web`, Express, React, or a
  `node:` built-in; `server` and `web` cannot import each other. Each rule
  carries a message explaining the alternative, not just the prohibition.
- **Root scripts:** `lint`, `lint:fix`, `format`, `format:check`, and `verify`
  (`format:check && lint && typecheck && test && build`).
- **Root `tsconfig.json`** so repo-level config files belong to a TS project,
  which `projectService` requires.
- **`CLAUDE.md`** — the working agreement for AI agents on this repo: scope
  discipline, the dependency rule, the abstraction rule, settled decisions that
  must not be re-litigated, and an iteration log.

### Fixed

Three defects found by reading the code, all of the "works on my machine" family:

1. **A regression test that was itself environment-dependent.**
   `config.test.ts` asserted the database path ended in
   `/market-pulse/data/market-pulse.sqlite` — hardcoding the clone directory
   name. Cloning into any other folder would fail the test, which is precisely
   the class of bug the test was written to prevent. It now derives the expected
   root the same way `config.ts` does.
2. **Contract drift on `version`.** `HealthResponse.version` is documented as
   coming from `package.json`, but `app.ts` hardcoded `'0.0.1'` as a default —
   a value that would silently go stale on the first version bump. Added
   `src/version.ts`, and made `version` a **required** `createApp` option so no
   default can drift again. Covered by a test asserting the endpoint's value
   equals the manifest's.
3. **An overstated portability claim.** `db/connection.ts` said moving to
   Postgres "is a driver swap rather than a rewrite". Corrected in both the code
   comment and `ARCHITECTURE.md`: the boundary confines the work to `src/db/`,
   but a move still needs a new driver, a sync→async connection lifecycle
   change, and a dialect pass (upserts, timestamps, JSON, generated ids,
   concurrency).

### Verified

- `npm run verify` → green end to end: Prettier clean, ESLint clean, typecheck
  clean across 3 packages, **12 tests passing in 4 files**, web build succeeds.
- **The boundary rule was proved, not assumed.** A temporary file importing
  `node:fs` inside `packages/domain` was linted and correctly rejected, then
  deleted. A rule that has never failed is not known to work.

### Decisions

| Decision | Reasoning |
| --- | --- |
| Type-aware linting (`projectService`) | The rules worth having here — `no-floating-promises`, `no-misused-promises` — need type information. Slower, and worth it. |
| Boundary rules in ESLint, not a separate tool | No new dependency, and the failure lands in the gate developers already run. |
| `dot-notation` with `allowIndexSignaturePropertyAccess` | `process.env` is an index signature; bracket access states that honestly rather than pretending the keys are typed. |
| `version` required rather than defaulted | A default that is a stale literal is worse than a compile error. |
| No CI workflow, no pre-commit hook | There is no remote yet, and the gate should be a command a developer runs, not a trap that fires at commit time. Add CI when there is somewhere to run it. |

### Open items carried forward

- `node:sqlite` still prints an experimental warning on boot; Node >= 22.5.0
  remains a hard requirement, documented in `README.md` and `engines`.
- No CI. Add when a remote exists.
- Domain vocabulary is still documented and unimplemented — that is Iteration 2.
