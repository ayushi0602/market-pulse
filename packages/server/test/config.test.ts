import { describe, expect, it } from 'vitest';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { loadConfig } from '../src/config.js';

/**
 * Derived the same way config.ts derives it, rather than hardcoded: the clone
 * directory is not guaranteed to be named "market-pulse", and a test that
 * assumes it would fail on a reviewer's machine for the wrong reason.
 */
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

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

  it('leaves :memory: and absolute paths untouched', () => {
    expect(loadConfig({ DATABASE_URL: ':memory:' }).databaseUrl).toBe(':memory:');
    expect(loadConfig({ DATABASE_URL: '/tmp/mp.sqlite' }).databaseUrl).toBe('/tmp/mp.sqlite');
  });

  it('rejects an unusable PORT rather than silently defaulting', () => {
    expect(() => loadConfig({ PORT: 'not-a-port' })).toThrow(/Invalid PORT/);
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
