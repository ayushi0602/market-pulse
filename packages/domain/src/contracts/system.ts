/**
 * Wire contracts shared by the backend and the web client.
 *
 * These describe what crosses the network boundary. They are deliberately
 * separate from internal domain types so that a domain refactor does not
 * silently reshape the public API.
 */

export type ServiceStatus = 'ok' | 'degraded';

export interface HealthResponse {
  status: ServiceStatus;
  /** Application version, from package.json. */
  version: string;
  /** Server time as epoch milliseconds. */
  time: number;
  /** Whether the relational store answered a trivial query. */
  database: ServiceStatus;
}
