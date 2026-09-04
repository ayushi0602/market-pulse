import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Process configuration, read once at startup.
 *
 * Kept deliberately small: every value has a working default so that a fresh
 * clone runs with no .env file at all.
 */
export interface AppConfig {
  port: number;
  /** Absolute SQLite file path, or ":memory:". */
  databaseUrl: string;
  nodeEnv: string;
  simulation: SimulationConfig;
}

/**
 * The price generator that keeps the demo moving.
 *
 * On by default, because a watchlist that never changes cannot demonstrate a
 * product about noticing change. Off is a supported mode, not a broken one: the
 * API reports `source: "static"` and the UI stops claiming anything is
 * updating.
 */
export interface SimulationConfig {
  enabled: boolean;
  intervalMs: number;
}

/** Repository root, from packages/server/src/config.ts. */
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/**
 * Resolves a relative database path against the repository root rather than
 * process.cwd(). npm runs workspace scripts from the package directory, so a
 * cwd-relative path would put the database somewhere different depending on
 * whether the script was invoked from the root or from packages/server.
 */
function resolveDatabaseUrl(value: string): string {
  if (value === ':memory:' || isAbsolute(value)) {
    return value;
  }
  return resolve(REPO_ROOT, value);
}

/** Anything but "off" leaves the simulation on, so a typo cannot silently disable the demo. */
function simulationEnabled(raw: string | undefined): boolean {
  return (raw ?? 'on').trim().toLowerCase() !== 'off';
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const rawPort = env['PORT'] ?? '4000';
  const port = Number.parseInt(rawPort, 10);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid PORT: ${rawPort}`);
  }

  const rawInterval = env['MARKET_SIMULATION_INTERVAL_MS'] ?? '3000';
  const intervalMs = Number.parseInt(rawInterval, 10);
  // A zero or negative interval would spin the event loop and fill the log in
  // seconds. Fail at startup rather than discovering it as a runaway process.
  if (!Number.isInteger(intervalMs) || intervalMs < 250) {
    throw new Error(`Invalid MARKET_SIMULATION_INTERVAL_MS: ${rawInterval} (minimum 250)`);
  }

  return {
    port,
    databaseUrl: resolveDatabaseUrl(env['DATABASE_URL'] ?? './data/market-pulse.sqlite'),
    nodeEnv: env['NODE_ENV'] ?? 'development',
    simulation: {
      enabled: simulationEnabled(env['MARKET_SIMULATION']),
      intervalMs,
    },
  };
}
