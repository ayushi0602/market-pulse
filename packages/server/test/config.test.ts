import { describe, expect, it } from 'vitest';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { loadConfig } from '../src/config.js';

/**
 * The repository root, found by *searching* for the manifest that declares the
 * workspaces, rather than by counting `../` segments.
 *
 * This is deliberately a different derivation from the one in config.ts. Two
 * failure modes are being avoided. Hardcoding `/market-pulse/` would tie the
 * test to the clone directory name, which is not ours to choose. Copying
 * config.ts's `../../../` arithmetic would make the test agree with the
 * implementation by construction -- if that segment count were wrong, or if
 * config.ts later moved, both would be wrong together and the test would still
 * pass. Searching for a known landmark reaches the same answer by an
 * independent route, so the assertion can actually disagree.
 */
function findRepoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const manifest = join(dir, 'package.json');
    if (existsSync(manifest)) {
      const pkg = JSON.parse(readFileSync(manifest, 'utf8')) as { workspaces?: unknown };
      if (pkg.workspaces !== undefined) return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) throw new Error('No workspace root found above the test file');
    dir = parent;
  }
}

const REPO_ROOT = findRepoRoot();

describe('loadConfig', () => {
  it('runs with no environment at all', () => {
    const config = loadConfig({});
    expect(config.port).toBe(4000);
    expect(config.nodeEnv).toBe('development');
  });

  it('anchors a relative database path to the repo root, not the cwd', () => {
    const config = loadConfig({ DATABASE_URL: './data/market-pulse.sqlite' });
    expect(isAbsolute(config.databaseUrl)).toBe(true);
    expect(config.databaseUrl).toBe(resolve(REPO_ROOT, 'data/market-pulse.sqlite'));
  });

  it('resolves the same path regardless of the working directory', () => {
    // The original bug: npm runs workspace scripts from the package directory,
    // so a cwd-relative path put the database somewhere different depending on
    // where the script was invoked. This asserts the invariant directly.
    const original = process.cwd();
    try {
      process.chdir(join(REPO_ROOT, 'packages', 'server'));
      const fromPackageDir = loadConfig({ DATABASE_URL: './data/market-pulse.sqlite' });
      process.chdir(REPO_ROOT);
      const fromRepoRoot = loadConfig({ DATABASE_URL: './data/market-pulse.sqlite' });
      expect(fromPackageDir.databaseUrl).toBe(fromRepoRoot.databaseUrl);
    } finally {
      process.chdir(original);
    }
  });

  it('leaves :memory: and absolute paths untouched', () => {
    expect(loadConfig({ DATABASE_URL: ':memory:' }).databaseUrl).toBe(':memory:');
    expect(loadConfig({ DATABASE_URL: '/tmp/mp.sqlite' }).databaseUrl).toBe('/tmp/mp.sqlite');
  });

  it('rejects an unusable PORT rather than silently defaulting', () => {
    expect(() => loadConfig({ PORT: 'not-a-port' })).toThrow(/Invalid PORT/);
  });

  it('runs the market simulation by default', () => {
    // A demo about noticing change is a poor demo when nothing changes, so the
    // generator is opt-out rather than opt-in.
    expect(loadConfig({}).simulation).toEqual({ enabled: true, intervalMs: 3000 });
  });

  it('turns the simulation off only when asked plainly', () => {
    expect(loadConfig({ MARKET_SIMULATION: 'off' }).simulation.enabled).toBe(false);
    expect(loadConfig({ MARKET_SIMULATION: 'OFF' }).simulation.enabled).toBe(false);
    // A typo must not silently disable it: the failure would look like a broken
    // demo rather than a misconfiguration.
    expect(loadConfig({ MARKET_SIMULATION: 'offf' }).simulation.enabled).toBe(true);
  });

  it('refuses an interval that would fill the log faster than anyone can read it', () => {
    expect(() => loadConfig({ MARKET_SIMULATION_INTERVAL_MS: '0' })).toThrow(/Invalid MARKET/);
    expect(() => loadConfig({ MARKET_SIMULATION_INTERVAL_MS: '-1' })).toThrow(/Invalid MARKET/);
    expect(() => loadConfig({ MARKET_SIMULATION_INTERVAL_MS: 'soon' })).toThrow(/Invalid MARKET/);
    expect(loadConfig({ MARKET_SIMULATION_INTERVAL_MS: '5000' }).simulation.intervalMs).toBe(5000);
  });
});

describe('readAppVersion', () => {
  it('reads the version from the root package.json rather than a literal', async () => {
    const { readAppVersion } = await import('../src/version.js');
    const pkg = JSON.parse(readFileSync(resolve(REPO_ROOT, 'package.json'), 'utf8')) as {
      version: string;
    };
    expect(readAppVersion()).toBe(pkg.version);
  });
});
