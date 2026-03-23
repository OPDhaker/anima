/**
 * Model Rotation Setup — visual assignment of models to task roles.
 *
 * Lets users map task roles (planning, execution, conversation, etc.)
 * to model tiers (opus, sonnet, haiku) and optionally to specific providers.
 */

import type { ModelRotator, RotatorConfig } from "../routing/ModelRotator.js";
import type { ModelTier, RotationStrategy, TaskRole } from "../routing/RoleRouter.js";
import type { WizardPrompter } from "../wizard/prompts.js";
import type { ProviderSetupResult } from "./ProviderSetup.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { RoleRouter, saveRoleRouterConfig, type RoleRouterConfig } from "../routing/RoleRouter.js";

const log = createSubsystemLogger("model-rotation-setup");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ModelRotationResult {
  strategy: RotationStrategy;
  bindings: RoleBinding[];
  autoDetection: boolean;
}

export interface RoleBinding {
  role: TaskRole;
  tier: ModelTier;
  providerId: string | null;
}

// ---------------------------------------------------------------------------
// Descriptions
// ---------------------------------------------------------------------------

const ROLE_DESCRIPTIONS: Record<TaskRole, string> = {
  planning: "Deep reasoning, architecture, strategic decisions",
  execution: "Code generation, implementation, building",
  conversation: "Chat, quick responses, casual interaction",
  analysis: "Code review, auditing, inspection",
  creative: "Brainstorming, ideation, exploring possibilities",
};

const TIER_DESCRIPTIONS: Record<ModelTier, string> = {
  opus: "Most capable — deep reasoning (expensive)",
  sonnet: "Balanced — great for coding (moderate cost)",
  haiku: "Fast and cheap — good for chat",
};

const DEFAULT_ROLE_TIERS: Record<TaskRole, ModelTier> = {
  planning: "opus",
  execution: "sonnet",
  conversation: "haiku",
  analysis: "sonnet",
  creative: "opus",
};

// ---------------------------------------------------------------------------
// Setup flow
// ---------------------------------------------------------------------------

async function configureRoleBinding(
  prompter: WizardPrompter,
  role: TaskRole,
  providers: ProviderSetupResult,
): Promise<RoleBinding> {
  const defaultTier = DEFAULT_ROLE_TIERS[role];

  const tier = await prompter.select<ModelTier>({
    message: `  ${role} (${ROLE_DESCRIPTIONS[role]}):`,
    options: [
      { value: "opus", label: "Opus-tier", hint: TIER_DESCRIPTIONS.opus },
      { value: "sonnet", label: "Sonnet-tier", hint: TIER_DESCRIPTIONS.sonnet },
      { value: "haiku", label: "Haiku-tier", hint: TIER_DESCRIPTIONS.haiku },
    ],
    initialValue: defaultTier,
  });

  let providerId: string | null = null;

  // If multiple providers are configured, let user pin this role to one
  if (providers.configuredProviders.length > 1) {
    const pinChoice = await prompter.select<string>({
      message: `  Pin ${role} to a specific provider?`,
      options: [
        { value: "auto", label: "Auto-select", hint: "Use rotation strategy" },
        ...providers.configuredProviders.map((id) => ({
          value: id,
          label: id,
          hint: `Always use ${id} for ${role}`,
        })),
      ],
      initialValue: "auto",
    });

    if (pinChoice !== "auto") {
      providerId = pinChoice;
    }
  }

  return { role, tier, providerId };
}

export async function runModelRotationSetup(
  prompter: WizardPrompter,
  providers: ProviderSetupResult,
): Promise<ModelRotationResult> {
  await prompter.note(
    [
      "Assign model tiers to task roles.",
      "Anima auto-detects what kind of task you're asking for",
      "and routes to the right model tier.",
      "",
      "  planning     → Opus (deep reasoning)",
      "  execution    → Sonnet (coding, building)",
      "  conversation → Haiku (chat, quick)",
      "",
      "You can customize these or keep the defaults.",
    ].join("\n"),
    "Step 3: Model Rotation",
  );

  // Quick vs custom setup
  const mode = await prompter.select<string>({
    message: "Model rotation setup:",
    options: [
      { value: "defaults", label: "Use recommended defaults", hint: "Opus/Sonnet/Haiku split" },
      { value: "custom", label: "Customize per role", hint: "Pick tier for each task type" },
    ],
    initialValue: "defaults",
  });

  let bindings: RoleBinding[];

  if (mode === "defaults") {
    bindings = (Object.entries(DEFAULT_ROLE_TIERS) as [TaskRole, ModelTier][]).map(
      ([role, tier]) => ({
        role,
        tier,
        providerId: null,
      }),
    );
  } else {
    const roles: TaskRole[] = ["planning", "execution", "conversation", "analysis", "creative"];
    bindings = [];
    for (const role of roles) {
      const binding = await configureRoleBinding(prompter, role, providers);
      bindings.push(binding);
    }
  }

  // Rotation strategy
  const strategy = await prompter.select<RotationStrategy>({
    message: "Rotation strategy (when multiple providers are available):",
    options: [
      { value: "round-robin", label: "Round-robin", hint: "Distribute evenly" },
      { value: "least-used", label: "Least-used", hint: "Pick the least-loaded provider" },
      { value: "priority-weighted", label: "Priority-weighted", hint: "Prefer higher-priority" },
      { value: "failover-only", label: "Failover-only", hint: "Stick to primary, switch on error" },
    ],
    initialValue: providers.configuredProviders.length > 1 ? "round-robin" : "failover-only",
  });

  const autoDetection = await prompter.confirm({
    message: "Enable auto-detection of task roles from messages?",
    initialValue: true,
  });

  // Save role router config
  const routerConfig: RoleRouterConfig = {
    bindings: bindings.map((b) => ({
      role: b.role,
      tier: b.tier,
      providerId: b.providerId,
      modelId: null,
    })),
    defaultTier: "sonnet",
    enableAutoDetection: autoDetection,
  };

  saveRoleRouterConfig(routerConfig);
  log.info(`model rotation setup complete: strategy=${strategy}, autoDetection=${autoDetection}`);

  return { strategy, bindings, autoDetection };
}
