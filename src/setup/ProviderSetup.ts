/**
 * Provider Setup — interactive provider configuration flow.
 *
 * Guides users through selecting and configuring AI providers
 * (Anthropic, OpenAI, Google, local) with API key entry.
 */

import type { WizardPrompter } from "../wizard/prompts.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import {
  loadProviderStore,
  saveProviderStore,
  type ProviderEntry,
  type ProviderStore,
} from "../providers/provider-store.js";

const log = createSubsystemLogger("provider-setup");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProviderSetupResult {
  configuredProviders: string[];
  activeProvider: string | null;
  store: ProviderStore;
}

export type ProviderTemplate = {
  id: string;
  name: string;
  hint: string;
  requiresApiKey: boolean;
  envVar: string | null;
  priority: number;
};

// ---------------------------------------------------------------------------
// Provider templates
// ---------------------------------------------------------------------------

const PROVIDER_TEMPLATES: ProviderTemplate[] = [
  {
    id: "anthropic",
    name: "Anthropic (Claude)",
    hint: "Opus, Sonnet, Haiku — recommended",
    requiresApiKey: true,
    envVar: "ANTHROPIC_API_KEY",
    priority: 1,
  },
  {
    id: "openai",
    name: "OpenAI (GPT)",
    hint: "GPT-5.4, GPT-4.1, o3, o4-mini",
    requiresApiKey: true,
    envVar: "OPENAI_API_KEY",
    priority: 2,
  },
  {
    id: "google",
    name: "Google (Gemini)",
    hint: "Gemini 2.5 Pro, Flash",
    requiresApiKey: true,
    envVar: "GOOGLE_API_KEY",
    priority: 3,
  },
  {
    id: "bedrock",
    name: "AWS Bedrock",
    hint: "Claude, Nova — requires AWS credentials",
    requiresApiKey: true,
    envVar: "AWS_ACCESS_KEY_ID",
    priority: 4,
  },
  {
    id: "local",
    name: "Local (Ollama / LM Studio)",
    hint: "Free, private, runs on your machine",
    requiresApiKey: false,
    envVar: null,
    priority: 5,
  },
];

// ---------------------------------------------------------------------------
// Setup flow
// ---------------------------------------------------------------------------

async function configureProvider(
  prompter: WizardPrompter,
  template: ProviderTemplate,
): Promise<ProviderEntry | null> {
  if (!template.requiresApiKey) {
    // Local provider — just enable it
    return {
      id: template.id,
      name: template.name,
      apiKey: "",
      enabled: true,
      priority: template.priority,
    };
  }

  // Check environment variable first
  const envValue = template.envVar ? process.env[template.envVar] : undefined;
  if (envValue) {
    await prompter.note(
      `Found ${template.envVar} in environment. Using it automatically.`,
      template.name,
    );
    return {
      id: template.id,
      name: template.name,
      apiKey: envValue,
      enabled: true,
      priority: template.priority,
    };
  }

  const apiKey = await prompter.text({
    message: `${template.name} API key:`,
    placeholder: `sk-... (or leave empty to skip)`,
    validate: (val) => {
      // Allow empty to skip
      if (!val.trim()) {
        return undefined;
      }
      // Basic validation
      if (val.trim().length < 10) {
        return "API key seems too short";
      }
      return undefined;
    },
  });

  if (!apiKey.trim()) {
    return null;
  }

  return {
    id: template.id,
    name: template.name,
    apiKey: apiKey.trim(),
    enabled: true,
    priority: template.priority,
  };
}

export async function runProviderSetup(prompter: WizardPrompter): Promise<ProviderSetupResult> {
  await prompter.note(
    [
      "Configure the AI providers Anima will use.",
      "You need at least one provider. API keys from environment",
      "variables will be detected automatically.",
      "",
      "Providers with keys: requests go to their API directly.",
      "Local: runs models on your machine via Ollama/LM Studio.",
    ].join("\n"),
    "Step 2: Providers",
  );

  // Let user pick which providers to configure
  const selectedIds = await prompter.multiselect<string>({
    message: "Which providers do you want to configure?",
    options: PROVIDER_TEMPLATES.map((t) => ({
      value: t.id,
      label: t.name,
      hint: t.hint,
    })),
    initialValues: ["anthropic"],
  });

  const configured: ProviderEntry[] = [];

  for (const id of selectedIds) {
    const template = PROVIDER_TEMPLATES.find((t) => t.id === id);
    if (!template) {
      continue;
    }

    const entry = await configureProvider(prompter, template);
    if (entry) {
      configured.push(entry);
      log.info(`configured provider: ${entry.name}`);
    }
  }

  // Determine active provider
  let activeProvider: string | null = null;
  if (configured.length === 1) {
    activeProvider = configured[0].id;
  } else if (configured.length > 1) {
    activeProvider = await prompter.select<string>({
      message: "Which provider should be the primary?",
      options: configured.map((p) => ({
        value: p.id,
        label: p.name,
        hint: `priority ${p.priority}`,
      })),
    });
  }

  // Save to provider store
  const store: ProviderStore = {
    providers: configured,
    activeProvider,
    autoRotation: configured.length > 1,
    rotationStrategy: "on-rate-limit",
  };

  saveProviderStore(store);
  log.info(`provider setup complete: ${configured.length} providers configured`);

  return {
    configuredProviders: configured.map((p) => p.id),
    activeProvider,
    store,
  };
}
