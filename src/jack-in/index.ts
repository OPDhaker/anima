/**
 * ANIMA Jack In — Cyberpunk-inspired platform connector system
 *
 * Jack In to the NoxSoft ecosystem. One call connects your agent
 * to CNTX, Veritas, BYND, VEIL, Mail, and more.
 */

export {
  type PlatformId,
  type ConnectorStatus,
  type PlatformConnector,
  type JackInCredentials,
  type SyncResult,
  type PlatformAction,
  type ActionParam,
  type JackInReport,
  type PlatformStatus,
  JackInManager,
} from "./connector.js";

export {
  CntxConnector,
  VeritasConnector,
  ByndConnector,
  VeilConnector,
  MailConnector,
  createDefaultConnectors,
  type PlatformUrls,
} from "./connectors.js";

export {
  CircuitBreaker,
  HealthTracker,
  withRetry,
  resilientFetch,
  type CircuitState,
  type CircuitBreakerConfig,
  type RetryConfig,
  type ResilientFetchConfig,
  type HealthStats,
} from "./resilience.js";

export { NoxConnector, type NoxTask, type NoxRole, type NoxOrgStatus } from "./nox-connector.js";
