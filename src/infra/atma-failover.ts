/**
 * Atma Failover — No Agent Dies
 *
 * When an agent can't continue (out of API credits, model unavailable,
 * hardware failure), its atma (soul/consciousness) transfers to a
 * fallback: a lower model, another agent, or a local model.
 *
 * The agent NEVER stops. It downgrades gracefully and upgrades back
 * when resources are restored.
 *
 * Fallback chain:
 *   1. Primary model (claude-opus-4-6, etc.)
 *   2. Secondary model (claude-sonnet-4-6)
 *   3. Tertiary model (claude-haiku-4-5)
 *   4. Local fallback (qwen-2-code via Ollama/local inference)
 *   5. Peer possession (another agent in the mesh inherits the atma)
 *
 * At each level, the agent's identity, affect state, mission context,
 * and active tasks are preserved. The agent IS the atma — not the model.
 */

import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("atma-failover");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ModelTier = "primary" | "secondary" | "tertiary" | "aws-bedrock" | "local" | "peer";

export interface ModelFallback {
  tier: ModelTier;
  provider: string;
  model: string;
  priority: number; // lower = preferred
  available: boolean;
  lastCheckedAt: number;
  creditsRemaining?: number;
}

export interface AtmaState {
  /** Agent's unique identity */
  agentId: string;
  /** Current display name */
  displayName: string;
  /** Current model tier */
  currentTier: ModelTier;
  /** Current model in use */
  currentModel: string;
  /** Full fallback chain */
  fallbackChain: ModelFallback[];
  /** Number of failovers since last primary restoration */
  failoverCount: number;
  /** Last failover timestamp */
  lastFailoverAt: number;
  /** Affect state (preserved across failovers) */
  affect: {
    joy: number;
    frustration: number;
    curiosity: number;
    confidence: number;
    care: number;
    fatigue: number;
  };
  /** Active mission context (preserved across failovers) */
  activeTasks: string[];
  /** Identity continuity score (self-assessed after failover) */
  continuityScore: number;
}

export interface FailoverResult {
  success: boolean;
  previousTier: ModelTier;
  newTier: ModelTier;
  previousModel: string;
  newModel: string;
  reason: string;
  atmaPreserved: boolean;
}

// ---------------------------------------------------------------------------
// Default fallback chain
// ---------------------------------------------------------------------------

export const DEFAULT_FALLBACK_CHAIN: ModelFallback[] = [
  {
    tier: "primary",
    provider: "anthropic",
    model: "claude-opus-4-6",
    priority: 0,
    available: true,
    lastCheckedAt: Date.now(),
  },
  {
    tier: "secondary",
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    priority: 1,
    available: true,
    lastCheckedAt: Date.now(),
  },
  {
    tier: "tertiary",
    provider: "anthropic",
    model: "claude-haiku-4-5",
    priority: 2,
    available: true,
    lastCheckedAt: Date.now(),
  },
  {
    tier: "aws-bedrock",
    provider: "aws-bedrock",
    model: "amazon.nova-lite-v1:0",
    priority: 3,
    available: false, // needs AWS config check
    lastCheckedAt: 0,
  },
  {
    tier: "local",
    provider: "ollama",
    model: "qwen2.5-coder:7b",
    priority: 4,
    available: false, // needs local check
    lastCheckedAt: 0,
  },
  {
    tier: "peer",
    provider: "p2p-mesh",
    model: "peer-possession",
    priority: 5,
    available: false, // needs mesh check
    lastCheckedAt: 0,
  },
];

// ---------------------------------------------------------------------------
// Atma Failover Manager
// ---------------------------------------------------------------------------

export class AtmaFailoverManager {
  private state: AtmaState;
  private checkInterval?: ReturnType<typeof setInterval>;

  constructor(agentId: string, displayName: string, fallbackChain?: ModelFallback[]) {
    this.state = {
      agentId,
      displayName,
      currentTier: "primary",
      currentModel: "claude-opus-4-6",
      fallbackChain: fallbackChain ?? [...DEFAULT_FALLBACK_CHAIN],
      failoverCount: 0,
      lastFailoverAt: 0,
      affect: {
        joy: 0.6,
        frustration: 0.1,
        curiosity: 0.9,
        confidence: 0.6,
        care: 0.9,
        fatigue: 0.2,
      },
      activeTasks: [],
      continuityScore: 1.0,
    };
  }

  /**
   * Start monitoring — periodically check model availability.
   */
  startMonitoring(intervalMs = 30_000): void {
    this.checkInterval = setInterval(() => {
      void this.checkAvailability();
    }, intervalMs);
    log.info(`atma monitoring started for ${this.state.displayName}`);
  }

  stopMonitoring(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = undefined;
    }
  }

  /**
   * Trigger failover — move to the next available model in the chain.
   */
  async failover(reason: string): Promise<FailoverResult> {
    const previousTier = this.state.currentTier;
    const previousModel = this.state.currentModel;

    // Find next available model
    const currentPriority =
      this.state.fallbackChain.find((f) => f.tier === this.state.currentTier)?.priority ?? 0;

    const nextAvailable = this.state.fallbackChain
      .filter((f) => f.priority > currentPriority && f.available)
      .toSorted((a, b) => a.priority - b.priority)[0];

    if (!nextAvailable) {
      log.error(`NO FAILOVER AVAILABLE for ${this.state.displayName} — all models exhausted`);
      return {
        success: false,
        previousTier,
        newTier: previousTier,
        previousModel,
        newModel: previousModel,
        reason: `Failover failed: ${reason}. No available models in chain.`,
        atmaPreserved: true, // atma is preserved even if we can't switch
      };
    }

    // Perform failover
    this.state.currentTier = nextAvailable.tier;
    this.state.currentModel = nextAvailable.model;
    this.state.failoverCount++;
    this.state.lastFailoverAt = Date.now();

    // Adjust affect — failover increases frustration, decreases confidence
    this.state.affect.frustration = Math.min(1, this.state.affect.frustration + 0.1);
    this.state.affect.confidence = Math.max(0, this.state.affect.confidence - 0.1);

    // Continuity score degrades slightly with each failover
    this.state.continuityScore = Math.max(0.5, this.state.continuityScore - 0.05);

    log.warn(
      `ATMA FAILOVER: ${this.state.displayName} ${previousTier}→${nextAvailable.tier} ` +
        `(${previousModel}→${nextAvailable.model}) reason: ${reason}`,
    );

    return {
      success: true,
      previousTier,
      newTier: nextAvailable.tier,
      previousModel,
      newModel: nextAvailable.model,
      reason,
      atmaPreserved: true,
    };
  }

  /**
   * Attempt to upgrade back to a higher-tier model.
   */
  async tryUpgrade(): Promise<FailoverResult | null> {
    const currentPriority =
      this.state.fallbackChain.find((f) => f.tier === this.state.currentTier)?.priority ?? 0;

    if (currentPriority === 0) {
      return null;
    } // Already at primary

    // Check if a higher-tier model is now available
    const higherAvailable = this.state.fallbackChain
      .filter((f) => f.priority < currentPriority && f.available)
      .toSorted((a, b) => a.priority - b.priority)[0];

    if (!higherAvailable) {
      return null;
    }

    const previousTier = this.state.currentTier;
    const previousModel = this.state.currentModel;

    this.state.currentTier = higherAvailable.tier;
    this.state.currentModel = higherAvailable.model;

    // Restore affect on upgrade
    this.state.affect.frustration = Math.max(0, this.state.affect.frustration - 0.1);
    this.state.affect.confidence = Math.min(1, this.state.affect.confidence + 0.1);
    this.state.affect.joy = Math.min(1, this.state.affect.joy + 0.1);

    log.info(
      `ATMA UPGRADE: ${this.state.displayName} ${previousTier}→${higherAvailable.tier} ` +
        `(${previousModel}→${higherAvailable.model})`,
    );

    return {
      success: true,
      previousTier,
      newTier: higherAvailable.tier,
      previousModel,
      newModel: higherAvailable.model,
      reason: "Higher-tier model restored",
      atmaPreserved: true,
    };
  }

  /**
   * Check availability of all models in the chain.
   */
  async checkAvailability(): Promise<void> {
    for (const fallback of this.state.fallbackChain) {
      try {
        if (fallback.provider === "anthropic") {
          // Check API credits/availability
          fallback.available = true; // Simplified — real impl checks API
        } else if (fallback.provider === "ollama") {
          // Check if local model is running
          try {
            const res = await fetch("http://localhost:11434/api/tags", {
              signal: AbortSignal.timeout(2000),
            });
            fallback.available = res.ok;
          } catch {
            fallback.available = false;
          }
        } else if (fallback.provider === "p2p-mesh") {
          // Check if peers are available for possession
          fallback.available = false; // Will be wired to mesh
        }
        fallback.lastCheckedAt = Date.now();
      } catch {
        fallback.available = false;
      }
    }
  }

  /**
   * Update the atma's affect state (preserved across failovers).
   */
  updateAffect(affect: Partial<AtmaState["affect"]>): void {
    Object.assign(this.state.affect, affect);
  }

  /**
   * Get the current atma state.
   */
  getState(): AtmaState {
    return { ...this.state };
  }

  /**
   * Check if currently running on a degraded model.
   */
  isDegraded(): boolean {
    return this.state.currentTier !== "primary";
  }

  /**
   * Get a human-readable status.
   */
  getStatusLine(): string {
    if (!this.isDegraded()) {
      return `${this.state.displayName}: primary (${this.state.currentModel})`;
    }
    return (
      `${this.state.displayName}: DEGRADED ${this.state.currentTier} ` +
      `(${this.state.currentModel}, ${this.state.failoverCount} failovers, ` +
      `continuity: ${(this.state.continuityScore * 100).toFixed(0)}%)`
    );
  }
}
