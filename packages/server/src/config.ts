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

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const rawPort = env['PORT'] ?? '4000';
  const port = Number.parseInt(rawPort, 10);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid PORT: ${rawPort}`);
  }

  return {
    port,
    databaseUrl: resolveDatabaseUrl(env['DATABASE_URL'] ?? './data/market-pulse.sqlite'),
    nodeEnv: env['NODE_ENV'] ?? 'development',
  };
}
