import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The application version, read from the root package.json at startup.
 *
 * The health contract promises this comes from package.json, so it is read
 * rather than duplicated as a literal -- a hardcoded copy goes stale silently
 * and makes the endpoint report a version that was never deployed.
 */
export function readAppVersion(): string {
  const path = fileURLToPath(new URL('../../../package.json', import.meta.url));
  const pkg = JSON.parse(readFileSync(path, 'utf8')) as { version?: string };
  return pkg.version ?? '0.0.0';
}
