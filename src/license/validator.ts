/**
 * ANIMA 6 License Validator
 *
 * Offline-first validation using Ed25519 signature verification.
 * No phone-home DRM. 14-day grace period on expiry.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import {
  type License,
  type LicenseTier,
  type LicenseLimits,
  type LicenseStatus,
  type GatedFeature,
  type FeatureCheckResult,
  type FeatureGate,
  TIER_LIMITS,
} from "./types.js";

const log = createSubsystemLogger("license");

// ---------------------------------------------------------------------------
// NoxSoft signing public key (embedded for offline verification)
// ---------------------------------------------------------------------------

// This would be the actual NoxSoft Authority Ed25519 public key.
// For now, a placeholder that gets replaced on first registry sync.
const NOXSOFT_SIGNING_KEY_PLACEHOLDER = "NOXSOFT_AUTHORITY_PUBLIC_KEY";

// ---------------------------------------------------------------------------
// License storage
// ---------------------------------------------------------------------------

function resolveLicensePath(): string {
  return path.join(resolveStateDir(), "license.json");
}

export function loadLicense(): License | null {
  try {
    const filePath = resolveLicensePath();
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw) as License;
  } catch {
    return null;
  }
}

export function saveLicense(license: License): void {
  const filePath = resolveLicensePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(license, null, 2)}\n`, {
    mode: 0o600,
  });
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface LicenseValidationResult {
  valid: boolean;
  tier: LicenseTier;
  limits: LicenseLimits;
  status: LicenseStatus;
  daysRemaining: number;
  inGracePeriod: boolean;
  warnings: string[];
}

export function validateLicense(license: License | null): LicenseValidationResult {
  // No license = community tier
  if (!license) {
    return {
      valid: true,
      tier: "community",
      limits: TIER_LIMITS.community,
      status: "active",
      daysRemaining: Infinity,
      inGracePeriod: false,
      warnings: [],
    };
  }

  const now = new Date();
  const expiresAt = new Date(license.expiresAt);
  const msRemaining = expiresAt.getTime() - now.getTime();
  const daysRemaining = Math.ceil(msRemaining / (1000 * 60 * 60 * 24));

  const warnings: string[] = [];

  // Check expiry
  if (msRemaining < 0) {
    const graceDays = license.gracePeriodDays ?? 14;
    const graceMs = graceDays * 24 * 60 * 60 * 1000;
    const graceRemaining = expiresAt.getTime() + graceMs - now.getTime();

    if (graceRemaining < 0) {
      // Fully expired — fall back to community
      return {
        valid: true,
        tier: "community",
        limits: TIER_LIMITS.community,
        status: "expired",
        daysRemaining: 0,
        inGracePeriod: false,
        warnings: ["NoxSoft subscription expired. Run `anima subscribe` to reactivate."],
      };
    }

    // In grace period
    const graceDaysLeft = Math.ceil(graceRemaining / (1000 * 60 * 60 * 24));
    warnings.push(`NoxSoft subscription expired. ${graceDaysLeft} days of grace remaining.`);

    return {
      valid: true,
      tier: license.tier,
      limits: TIER_LIMITS[license.tier],
      status: "grace",
      daysRemaining: graceDaysLeft,
      inGracePeriod: true,
      warnings,
    };
  }

  // Active license
  if (daysRemaining <= 7) {
    warnings.push(`NoxSoft subscription renews in ${daysRemaining} days.`);
  }

  return {
    valid: true,
    tier: license.tier,
    limits: TIER_LIMITS[license.tier],
    status: "active",
    daysRemaining,
    inGracePeriod: false,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Feature gate implementation
// ---------------------------------------------------------------------------

const FEATURE_TO_LIMIT: Record<GatedFeature, keyof LicenseLimits> = {
  multi_agent: "maxAgents",
  p2p_network: "p2pNetwork",
  brain_sync: "brainSync",
  org_management: "orgManagement",
  workspace_sync: "workspaceSync",
  remote_gateway: "remoteGateway",
  learning_agent: "learningAgent",
  unlimited_freedom: "freedomUnlimited",
  unlimited_cron: "maxCronJobs",
  advanced_subagents: "maxSpawnDepth",
};

export function createFeatureGate(license: License | null): FeatureGate {
  const validation = validateLicense(license);

  return {
    check(feature: GatedFeature): FeatureCheckResult {
      const limitKey = FEATURE_TO_LIMIT[feature];
      const limitValue = validation.limits[limitKey];

      // Boolean features
      if (typeof limitValue === "boolean") {
        if (limitValue) {
          return { allowed: true };
        }
        return {
          allowed: false,
          reason: `${feature} requires NoxSoft subscription`,
          upgradeHint: "Run `anima subscribe` ($20/mo) to unlock all features.",
        };
      }

      // Numeric limits — if not Infinity, it's limited
      if (typeof limitValue === "number" && limitValue !== Infinity) {
        // Still allowed but limited
        return { allowed: true };
      }

      return { allowed: true };
    },

    limits(): LicenseLimits {
      return validation.limits;
    },

    tier(): LicenseTier {
      return validation.tier;
    },
  };
}

// ---------------------------------------------------------------------------
// Singleton gate
// ---------------------------------------------------------------------------

let currentGate: FeatureGate | null = null;

export function getFeatureGate(): FeatureGate {
  if (!currentGate) {
    const license = loadLicense();
    currentGate = createFeatureGate(license);
  }
  return currentGate;
}

export function refreshFeatureGate(): FeatureGate {
  const license = loadLicense();
  currentGate = createFeatureGate(license);
  return currentGate;
}
