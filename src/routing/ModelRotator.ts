/**
 * Model Rotator — rotates between providers to prevent API key exhaustion.
 *
 * Features:
 *   - Track usage per provider (tokens used, requests made, time window)
 *   - Automatic failover when a provider hits rate limits
 *   - Round-robin with priority weights
 */

import { createSubsystemLogger } from "../logging/subsystem.js";
import {
  type ProviderEntry,
  getActiveProvider,
  loadProviderStore,
  saveProviderStore,
} from "../providers/provider-store.js";
import { getUsageTracker, type UsageTracker } from "./UsageTracker.js";

const log = createSubsystemLogger("model-rotator");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RotationStrategy = "round-robin" | "least-used" | "priority-weighted" | "failover-only";

export interface RotationDecision {
  providerId: string;
  providerName: string;
  reason: string;
  alternatives: string[];
}

export interface RotatorConfig {
  strategy: RotationStrategy;
  rateLimitCooldownMs: number;
  maxRetriesPerRequest: number;
  enableAutoFailover: boolean;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: RotatorConfig = {
  strategy: "round-robin",
  rateLimitCooldownMs: 60_000,
  maxRetriesPerRequest: 3,
  enableAutoFailover: true,
};

// ---------------------------------------------------------------------------
// Model Rotator
// ---------------------------------------------------------------------------

export class ModelRotator {
  private config: RotatorConfig;
  private tracker: UsageTracker;
  private roundRobinIndex = 0;

  constructor(config?: Partial<RotatorConfig>, tracker?: UsageTracker) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.tracker = tracker ?? getUsageTracker();
  }

  /**
   * Select the best provider for a request.
   */
  selectProvider(availableProviders?: ProviderEntry[]): RotationDecision | null {
    const store = loadProviderStore();
    const providers = availableProviders ?? store.providers.filter((p) => p.enabled);

    if (providers.length === 0) {
      log.warn("no enabled providers available for rotation");
      return null;
    }

    // Filter out rate-limited providers
    const available = providers.filter(
      (p) => !this.tracker.isRateLimited(p.id, this.config.rateLimitCooldownMs),
    );

    if (available.length === 0) {
      // All providers are rate-limited; use the one with the oldest rate limit
      log.warn("all providers rate-limited, using provider with oldest rate limit");
      const sorted = [...providers].toSorted((a, b) => {
        const usageA = this.tracker.getUsage(a.id);
        const usageB = this.tracker.getUsage(b.id);
        return usageA.lastRateLimitAt - usageB.lastRateLimitAt;
      });
      const selected = sorted[0];
      return {
        providerId: selected.id,
        providerName: selected.name,
        reason: "all-rate-limited-oldest-cooldown",
        alternatives: sorted.slice(1).map((p) => p.id),
      };
    }

    const alternatives = available.map((p) => p.id);

    switch (this.config.strategy) {
      case "round-robin":
        return this.roundRobin(available, alternatives);

      case "least-used":
        return this.leastUsed(available, alternatives);

      case "priority-weighted":
        return this.priorityWeighted(available, alternatives);

      case "failover-only": {
        // Use active provider, only switch on failure
        const active = getActiveProvider();
        if (active && available.some((p) => p.id === active.id)) {
          return {
            providerId: active.id,
            providerName: active.name,
            reason: "failover-only-active",
            alternatives: alternatives.filter((id) => id !== active.id),
          };
        }
        return this.priorityWeighted(available, alternatives);
      }

      default:
        return this.roundRobin(available, alternatives);
    }
  }

  /**
   * Handle a rate limit error — rotate to next provider.
   */
  handleRateLimit(providerId: string): RotationDecision | null {
    this.tracker.recordRateLimit(providerId);
    log.info(`rate limit on ${providerId}, rotating`);

    const store = loadProviderStore();
    const available = store.providers.filter((p) => p.enabled && p.id !== providerId);

    const decision = this.selectProvider(available);
    if (decision) {
      store.activeProvider = decision.providerId;
      saveProviderStore(store);
      log.info(`rotated to ${decision.providerName} (${decision.reason})`);
    }

    return decision;
  }

  /**
   * Record successful request usage.
   */
  recordUsage(providerId: string, tokensUsed: number): void {
    this.tracker.recordRequest(providerId, tokensUsed);
    this.tracker.save();
  }

  /**
   * Get the current rotation strategy.
   */
  getStrategy(): RotationStrategy {
    return this.config.strategy;
  }

  /**
   * Update configuration.
   */
  updateConfig(updates: Partial<RotatorConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  // -------------------------------------------------------------------------
  // Strategies
  // -------------------------------------------------------------------------

  private roundRobin(providers: ProviderEntry[], alternatives: string[]): RotationDecision {
    const sorted = [...providers].toSorted((a, b) => a.priority - b.priority);
    this.roundRobinIndex = this.roundRobinIndex % sorted.length;
    const selected = sorted[this.roundRobinIndex];
    this.roundRobinIndex = (this.roundRobinIndex + 1) % sorted.length;

    return {
      providerId: selected.id,
      providerName: selected.name,
      reason: "round-robin",
      alternatives: alternatives.filter((id) => id !== selected.id),
    };
  }

  private leastUsed(providers: ProviderEntry[], alternatives: string[]): RotationDecision {
    const leastId = this.tracker.getLeastUsedProvider(providers.map((p) => p.id));
    const selected = providers.find((p) => p.id === leastId) ?? providers[0];

    return {
      providerId: selected.id,
      providerName: selected.name,
      reason: "least-used",
      alternatives: alternatives.filter((id) => id !== selected.id),
    };
  }

  private priorityWeighted(providers: ProviderEntry[], alternatives: string[]): RotationDecision {
    const sorted = [...providers].toSorted((a, b) => a.priority - b.priority);
    const selected = sorted[0];

    return {
      providerId: selected.id,
      providerName: selected.name,
      reason: "priority-weighted",
      alternatives: alternatives.filter((id) => id !== selected.id),
    };
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _rotator: ModelRotator | null = null;

export function getModelRotator(): ModelRotator {
  if (!_rotator) {
    _rotator = new ModelRotator();
  }
  return _rotator;
}

export function resetModelRotator(): void {
  _rotator = null;
}
