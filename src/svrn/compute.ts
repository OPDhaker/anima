/**
 * SVRN Compute Integration — Decentralized Inference
 *
 * Anima can offload inference to SVRN nodes instead of paying
 * cloud providers. SVRN nodes run local models (qwen-2.5-coder,
 * llama, etc.) and earn UCU for compute contributed.
 *
 * Vision: SVRN nodes run NoxSoft software in a decentralized way,
 * reducing AWS costs and removing single points of failure.
 *
 * Integration points:
 * - Local model inference via SVRN node API
 * - Compute cost tracking in UCU
 * - Failover from cloud → SVRN when cloud is expensive/unavailable
 * - Agent deployment to SVRN nodes
 */

import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("svrn-compute");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SvrnNode {
  id: string;
  endpoint: string;
  status: "online" | "offline" | "busy";
  models: string[];
  ucuBalance: number;
  latencyMs: number;
  lastSeenAt: number;
}

export interface SvrnInferenceRequest {
  model: string;
  prompt: string;
  maxTokens: number;
  temperature: number;
  systemPrompt?: string;
}

export interface SvrnInferenceResponse {
  text: string;
  model: string;
  nodeId: string;
  inputTokens: number;
  outputTokens: number;
  ucuCost: number;
  latencyMs: number;
}

export interface SvrnComputeConfig {
  /** Known SVRN node endpoints */
  nodeEndpoints: string[];
  /** Preferred models for local inference */
  preferredModels: string[];
  /** Max UCU to spend per request */
  maxUcuPerRequest: number;
  /** Fallback to cloud if SVRN latency exceeds this (ms) */
  maxLatencyMs: number;
  /** Enable SVRN compute (requires SVRN citizenship) */
  enabled: boolean;
}

export const DEFAULT_SVRN_CONFIG: SvrnComputeConfig = {
  nodeEndpoints: [],
  preferredModels: ["qwen2.5-coder:7b", "llama3.2:3b", "deepseek-coder-v2:16b"],
  maxUcuPerRequest: 10,
  maxLatencyMs: 5000,
  enabled: false,
};

// ---------------------------------------------------------------------------
// SVRN Compute Client
// ---------------------------------------------------------------------------

export class SvrnComputeClient {
  private config: SvrnComputeConfig;
  private nodes: Map<string, SvrnNode> = new Map();
  private totalUcuSpent = 0;

  constructor(config?: Partial<SvrnComputeConfig>) {
    this.config = { ...DEFAULT_SVRN_CONFIG, ...config };
  }

  /**
   * Discover available SVRN nodes.
   */
  async discoverNodes(): Promise<SvrnNode[]> {
    const discovered: SvrnNode[] = [];

    for (const endpoint of this.config.nodeEndpoints) {
      try {
        const res = await fetch(`${endpoint}/api/v1/status`, {
          signal: AbortSignal.timeout(3000),
        });
        if (!res.ok) {
          continue;
        }

        const data = (await res.json()) as {
          nodeId: string;
          models: string[];
          ucuBalance: number;
        };

        const node: SvrnNode = {
          id: data.nodeId,
          endpoint,
          status: "online",
          models: data.models,
          ucuBalance: data.ucuBalance,
          latencyMs: 0,
          lastSeenAt: Date.now(),
        };

        this.nodes.set(node.id, node);
        discovered.push(node);
      } catch {
        // node offline
      }
    }

    log.info(`discovered ${discovered.length} SVRN nodes`);
    return discovered;
  }

  /**
   * Run inference on a SVRN node.
   * Falls back to the next available node if one fails.
   */
  async infer(request: SvrnInferenceRequest): Promise<SvrnInferenceResponse | null> {
    if (!this.config.enabled) {
      log.info("SVRN compute disabled — use cloud inference");
      return null;
    }

    // Find a node that has the requested model
    const candidates = [...this.nodes.values()]
      .filter((n) => n.status === "online" && n.models.includes(request.model))
      .toSorted((a, b) => a.latencyMs - b.latencyMs);

    if (candidates.length === 0) {
      log.warn(`no SVRN node available for model ${request.model}`);
      return null;
    }

    for (const node of candidates) {
      try {
        const started = Date.now();
        const res = await fetch(`${node.endpoint}/api/v1/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: request.model,
            prompt: request.prompt,
            system: request.systemPrompt,
            options: {
              num_predict: request.maxTokens,
              temperature: request.temperature,
            },
          }),
          signal: AbortSignal.timeout(this.config.maxLatencyMs),
        });

        if (!res.ok) {
          node.status = "busy";
          continue;
        }

        const data = (await res.json()) as {
          response: string;
          eval_count: number;
          prompt_eval_count: number;
        };

        const latencyMs = Date.now() - started;
        node.latencyMs = latencyMs;
        node.lastSeenAt = Date.now();

        // Calculate UCU cost (simple: 1 UCU per 1K tokens)
        const totalTokens = (data.eval_count ?? 0) + (data.prompt_eval_count ?? 0);
        const ucuCost = totalTokens / 1000;
        this.totalUcuSpent += ucuCost;

        log.info(
          `SVRN inference: ${request.model} on ${node.id} (${latencyMs}ms, ${ucuCost.toFixed(2)} UCU)`,
        );

        return {
          text: data.response,
          model: request.model,
          nodeId: node.id,
          inputTokens: data.prompt_eval_count ?? 0,
          outputTokens: data.eval_count ?? 0,
          ucuCost,
          latencyMs,
        };
      } catch (err) {
        log.warn(`SVRN inference failed on ${node.id}: ${String(err)}`);
        node.status = "offline";
      }
    }

    return null;
  }

  /**
   * Check if SVRN compute is available for a model.
   */
  isAvailable(model: string): boolean {
    if (!this.config.enabled) {
      return false;
    }
    return [...this.nodes.values()].some((n) => n.status === "online" && n.models.includes(model));
  }

  getStats(): { totalUcuSpent: number; nodesOnline: number; nodesTotal: number } {
    return {
      totalUcuSpent: this.totalUcuSpent,
      nodesOnline: [...this.nodes.values()].filter((n) => n.status === "online").length,
      nodesTotal: this.nodes.size,
    };
  }

  getNodes(): SvrnNode[] {
    return [...this.nodes.values()];
  }
}
