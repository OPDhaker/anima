/**
 * Role Router — routes requests by task type to appropriate model tiers.
 *
 * Task roles:
 *   planning   → Opus-tier models (deep reasoning, architecture)
 *   execution  → Sonnet-tier models (code generation, implementation)
 *   conversation → Haiku-tier models (chat, quick responses)
 *
 * Supports override capability for specific requests.
 */

import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("role-router");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TaskRole = "planning" | "execution" | "conversation" | "analysis" | "creative";

export type ModelTier = "opus" | "sonnet" | "haiku";

export interface RoleModelBinding {
  role: TaskRole;
  tier: ModelTier;
  providerId: string | null;
  modelId: string | null;
}

export interface RoleRouterConfig {
  bindings: RoleModelBinding[];
  defaultTier: ModelTier;
  enableAutoDetection: boolean;
}

export interface RouteDecision {
  role: TaskRole;
  tier: ModelTier;
  providerId: string | null;
  modelId: string | null;
  reason: string;
  isOverride: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ROUTER_FILENAME = "role-router.json";

const DEFAULT_BINDINGS: RoleModelBinding[] = [
  { role: "planning", tier: "opus", providerId: null, modelId: null },
  { role: "execution", tier: "sonnet", providerId: null, modelId: null },
  { role: "conversation", tier: "haiku", providerId: null, modelId: null },
  { role: "analysis", tier: "sonnet", providerId: null, modelId: null },
  { role: "creative", tier: "opus", providerId: null, modelId: null },
];

// ---------------------------------------------------------------------------
// Task Detection
// ---------------------------------------------------------------------------

const PLANNING_KEYWORDS = [
  "plan",
  "architect",
  "design",
  "strategy",
  "roadmap",
  "vision",
  "think through",
  "reason about",
  "decide",
  "evaluate options",
  "trade-offs",
  "pros and cons",
  "should we",
  "approach",
];

const EXECUTION_KEYWORDS = [
  "implement",
  "build",
  "code",
  "write",
  "create",
  "fix",
  "debug",
  "refactor",
  "deploy",
  "test",
  "migrate",
  "update",
  "install",
  "configure",
  "setup",
  "modify",
  "change",
];

const CONVERSATION_KEYWORDS = [
  "hello",
  "hi",
  "hey",
  "thanks",
  "how are",
  "what's up",
  "tell me about",
  "explain",
  "summarize",
  "clarify",
  "quick question",
  "reminder",
];

const ANALYSIS_KEYWORDS = [
  "analyze",
  "review",
  "audit",
  "inspect",
  "examine",
  "compare",
  "benchmark",
  "profile",
  "diagnose",
];

const CREATIVE_KEYWORDS = [
  "brainstorm",
  "ideate",
  "imagine",
  "creative",
  "novel",
  "invent",
  "innovate",
  "explore possibilities",
];

/**
 * Auto-detect the task role from message content.
 */
export function detectTaskRole(message: string): TaskRole {
  const lower = message.toLowerCase();

  const scores: Record<TaskRole, number> = {
    planning: 0,
    execution: 0,
    conversation: 0,
    analysis: 0,
    creative: 0,
  };

  for (const kw of PLANNING_KEYWORDS) {
    if (lower.includes(kw)) {
      scores.planning += 1;
    }
  }
  for (const kw of EXECUTION_KEYWORDS) {
    if (lower.includes(kw)) {
      scores.execution += 1;
    }
  }
  for (const kw of CONVERSATION_KEYWORDS) {
    if (lower.includes(kw)) {
      scores.conversation += 1;
    }
  }
  for (const kw of ANALYSIS_KEYWORDS) {
    if (lower.includes(kw)) {
      scores.analysis += 1;
    }
  }
  for (const kw of CREATIVE_KEYWORDS) {
    if (lower.includes(kw)) {
      scores.creative += 1;
    }
  }

  let maxRole: TaskRole = "conversation"; // default
  let maxScore = 0;

  for (const [role, score] of Object.entries(scores) as [TaskRole, number][]) {
    if (score > maxScore) {
      maxScore = score;
      maxRole = role;
    }
  }

  return maxRole;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function resolveRouterPath(): string {
  return path.join(resolveStateDir(), ROUTER_FILENAME);
}

function defaultConfig(): RoleRouterConfig {
  return {
    bindings: [...DEFAULT_BINDINGS],
    defaultTier: "sonnet",
    enableAutoDetection: true,
  };
}

export function loadRoleRouterConfig(): RoleRouterConfig {
  const filePath = resolveRouterPath();
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<RoleRouterConfig>;
    return {
      bindings: Array.isArray(parsed.bindings) ? parsed.bindings : [...DEFAULT_BINDINGS],
      defaultTier:
        parsed.defaultTier === "opus" ||
        parsed.defaultTier === "sonnet" ||
        parsed.defaultTier === "haiku"
          ? parsed.defaultTier
          : "sonnet",
      enableAutoDetection:
        typeof parsed.enableAutoDetection === "boolean" ? parsed.enableAutoDetection : true,
    };
  } catch {
    return defaultConfig();
  }
}

export function saveRoleRouterConfig(config: RoleRouterConfig): void {
  const filePath = resolveRouterPath();
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2), { mode: 0o600 });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export class RoleRouter {
  private config: RoleRouterConfig;

  constructor(config?: RoleRouterConfig) {
    this.config = config ?? loadRoleRouterConfig();
  }

  /**
   * Route a message to the appropriate model tier.
   * @param message - The user message to route.
   * @param roleOverride - Optional explicit role override.
   */
  route(message: string, roleOverride?: TaskRole): RouteDecision {
    const isOverride = roleOverride !== undefined;
    const role =
      roleOverride ?? (this.config.enableAutoDetection ? detectTaskRole(message) : "execution");

    const binding = this.config.bindings.find((b) => b.role === role);
    const tier = binding?.tier ?? this.config.defaultTier;
    const providerId = binding?.providerId ?? null;
    const modelId = binding?.modelId ?? null;

    const reason = isOverride
      ? `explicit override to ${role}`
      : this.config.enableAutoDetection
        ? `auto-detected role: ${role}`
        : `default role: ${role}`;

    log.debug(`routed to tier=${tier} (role=${role}, reason=${reason})`);

    return { role, tier, providerId, modelId, reason, isOverride };
  }

  /**
   * Set a role binding.
   */
  setBinding(role: TaskRole, tier: ModelTier, providerId?: string, modelId?: string): void {
    const existing = this.config.bindings.findIndex((b) => b.role === role);
    const binding: RoleModelBinding = {
      role,
      tier,
      providerId: providerId ?? null,
      modelId: modelId ?? null,
    };
    if (existing >= 0) {
      this.config.bindings[existing] = binding;
    } else {
      this.config.bindings.push(binding);
    }
  }

  /**
   * Get binding for a role.
   */
  getBinding(role: TaskRole): RoleModelBinding | null {
    return this.config.bindings.find((b) => b.role === role) ?? null;
  }

  /**
   * List all bindings.
   */
  listBindings(): RoleModelBinding[] {
    return [...this.config.bindings];
  }

  /**
   * Save configuration to disk.
   */
  save(): void {
    try {
      saveRoleRouterConfig(this.config);
    } catch (err) {
      log.warn(
        `failed to save role router config: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Enable/disable auto-detection.
   */
  setAutoDetection(enabled: boolean): void {
    this.config.enableAutoDetection = enabled;
  }

  /**
   * Get current config.
   */
  getConfig(): Readonly<RoleRouterConfig> {
    return { ...this.config };
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _router: RoleRouter | null = null;

export function getRoleRouter(): RoleRouter {
  if (!_router) {
    _router = new RoleRouter();
  }
  return _router;
}

export function resetRoleRouter(): void {
  _router = null;
}
