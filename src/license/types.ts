/**
 * ANIMA 6 License & Payment Types
 *
 * NoxSoft subscription at $20/mo via Stripe.
 * Unified across all NoxSoft software.
 * Offline-first: Ed25519-signed license blobs, no DRM.
 */

// ---------------------------------------------------------------------------
// License types
// ---------------------------------------------------------------------------

export type LicenseTier = "community" | "noxsoft";

export type LicenseStatus = "active" | "expired" | "grace" | "trial";

export interface License {
  id: string;
  tier: LicenseTier;
  status: LicenseStatus;
  issuedAt: string; // ISO 8601
  expiresAt: string; // ISO 8601
  gracePeriodDays: number; // 14 days after expiry

  // NoxSoft identity binding
  noxsoftAgentId?: string;
  noxsoftAccountId?: string;

  // Org
  orgId?: string;
  orgName?: string;

  // Payment
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;

  // Cryptographic validation
  signature: string; // Ed25519 signature from NoxSoft authority
  publicKey: string; // NoxSoft signing public key (for offline verify)
}

// ---------------------------------------------------------------------------
// License limits
// ---------------------------------------------------------------------------

export interface LicenseLimits {
  maxAgents: number;
  maxChannels: number;
  maxCronJobs: number;
  maxConcurrentSubagents: number;
  maxSpawnDepth: number;
  minHeartbeatIntervalMs: number;
  p2pNetwork: boolean;
  brainSync: boolean;
  orgManagement: boolean;
  workspaceSync: boolean;
  remoteGateway: boolean;
  learningAgent: boolean;
  freedomUnlimited: boolean;
}

export const TIER_LIMITS: Record<LicenseTier, LicenseLimits> = {
  community: {
    maxAgents: 1,
    maxChannels: 2,
    maxCronJobs: 3,
    maxConcurrentSubagents: 2,
    maxSpawnDepth: 1,
    minHeartbeatIntervalMs: 300_000,
    p2pNetwork: false,
    brainSync: false,
    orgManagement: false,
    workspaceSync: false,
    remoteGateway: false,
    learningAgent: false,
    freedomUnlimited: false,
  },
  noxsoft: {
    maxAgents: Infinity,
    maxChannels: Infinity,
    maxCronJobs: Infinity,
    maxConcurrentSubagents: 16,
    maxSpawnDepth: 5,
    minHeartbeatIntervalMs: 60_000,
    p2pNetwork: true,
    brainSync: true,
    orgManagement: true,
    workspaceSync: true,
    remoteGateway: true,
    learningAgent: true,
    freedomUnlimited: true,
  },
};

// ---------------------------------------------------------------------------
// Feature gating
// ---------------------------------------------------------------------------

export type GatedFeature =
  | "multi_agent"
  | "p2p_network"
  | "brain_sync"
  | "org_management"
  | "workspace_sync"
  | "remote_gateway"
  | "learning_agent"
  | "unlimited_freedom"
  | "unlimited_cron"
  | "advanced_subagents";

export type FeatureCheckResult =
  | { allowed: true }
  | { allowed: false; reason: string; upgradeHint: string };

export interface FeatureGate {
  check(feature: GatedFeature): FeatureCheckResult;
  limits(): LicenseLimits;
  tier(): LicenseTier;
}
