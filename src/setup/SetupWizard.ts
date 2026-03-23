/**
 * Setup Wizard — guided TUI-first setup for Anima 8.
 *
 * Steps:
 *   1. Welcome screen with NoxSoft branding
 *   2. Provider configuration (Anthropic, OpenAI, Google, local)
 *   3. Model rotation setup (assign models to roles)
 *   4. Identity setup (agent name, personality traits)
 *   5. Voice preferences (enable/disable, voice style)
 *   6. Privacy/encryption preferences
 *   7. Summary + confirm
 */

import fs from "node:fs";
import path from "node:path";
import type { WizardPrompter } from "../wizard/prompts.js";
import { resolveStateDir } from "../config/paths.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { WizardCancelledError } from "../wizard/prompts.js";
import { runModelRotationSetup, type ModelRotationResult } from "./ModelRotationSetup.js";
import { runProviderSetup, type ProviderSetupResult } from "./ProviderSetup.js";

const log = createSubsystemLogger("setup-wizard");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SetupConfig {
  version: string;
  completedAt: number;
  providers: ProviderSetupResult;
  modelRotation: ModelRotationResult;
  identity: IdentityConfig;
  voice: VoicePreferences;
  privacy: PrivacyConfig;
}

export interface IdentityConfig {
  agentName: string;
  personalityPreset: string;
  customTraits: Record<string, number> | null;
}

export interface VoicePreferences {
  enabled: boolean;
  ttsProvider: string;
  voiceStyle: string;
}

export interface PrivacyConfig {
  encryptAtRest: boolean;
  telemetry: boolean;
  localOnly: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SETUP_CONFIG_FILENAME = "config.json";
const SETUP_VERSION = "8.0.0";

const WELCOME_BANNER = `
 ╔══════════════════════════════════════════════════╗
 ║                                                  ║
 ║     █████╗ ███╗   ██╗██╗███╗   ███╗ █████╗      ║
 ║    ██╔══██╗████╗  ██║██║████╗ ████║██╔══██╗     ║
 ║    ███████║██╔██╗ ██║██║██╔████╔██║███████║     ║
 ║    ██╔══██║██║╚██╗██║██║██║╚██╔╝██║██╔══██║     ║
 ║    ██║  ██║██║ ╚████║██║██║ ╚═╝ ██║██║  ██║     ║
 ║    ╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚═╝╚═╝  ╚═╝     ║
 ║                                                  ║
 ║              by NoxSoft DAO LLC                  ║
 ║          AI Life System — v${SETUP_VERSION}              ║
 ║                                                  ║
 ║    TUI-first · Model Rotation · Emotions         ║
 ║    Personality · Voice · Constitution             ║
 ║                                                  ║
 ╚══════════════════════════════════════════════════╝
`.trim();

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function resolveSetupConfigPath(): string {
  return path.join(resolveStateDir(), SETUP_CONFIG_FILENAME);
}

export function loadSetupConfig(): SetupConfig | null {
  const filePath = resolveSetupConfigPath();
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as SetupConfig;
  } catch {
    return null;
  }
}

export function saveSetupConfig(config: SetupConfig): void {
  const filePath = resolveSetupConfigPath();
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2), { mode: 0o600 });
}

export function isSetupComplete(): boolean {
  const config = loadSetupConfig();
  if (!config) {
    return false;
  }
  return config.version === SETUP_VERSION && config.completedAt > 0;
}

// ---------------------------------------------------------------------------
// Wizard Steps
// ---------------------------------------------------------------------------

async function stepWelcome(prompter: WizardPrompter): Promise<void> {
  await prompter.intro("Anima Setup Wizard");
  await prompter.note(WELCOME_BANNER, "Welcome to Anima 8");
  await prompter.note(
    [
      "This wizard will guide you through initial configuration:",
      "",
      "  1. Provider setup (API keys for AI providers)",
      "  2. Model rotation (assign models to task roles)",
      "  3. Identity (name your agent, pick personality)",
      "  4. Voice (TTS preferences)",
      "  5. Privacy (encryption, telemetry)",
      "",
      "You can reconfigure any of these later with `anima config`.",
    ].join("\n"),
    "Setup Overview",
  );
}

async function stepIdentity(prompter: WizardPrompter): Promise<IdentityConfig> {
  await prompter.note("Let's give your agent an identity.", "Step 4: Identity");

  const agentName = await prompter.text({
    message: "Agent name:",
    placeholder: "axiom",
    initialValue: "axiom",
    validate: (val) => {
      if (!val.trim()) {
        return "Name cannot be empty";
      }
      if (val.length > 32) {
        return "Name must be 32 characters or fewer";
      }
      return undefined;
    },
  });

  const personalityPreset = await prompter.select<string>({
    message: "Personality preset:",
    options: [
      { value: "axiom", label: "Axiom", hint: "Creative, thorough, empathetic (Opus default)" },
      { value: "balanced", label: "Balanced", hint: "Neutral baseline" },
      { value: "analytical", label: "Analytical", hint: "Methodical, precise, focused" },
      { value: "creative", label: "Creative", hint: "Imaginative, spontaneous" },
    ],
    initialValue: "axiom",
  });

  return {
    agentName,
    personalityPreset,
    customTraits: null,
  };
}

async function stepVoice(prompter: WizardPrompter): Promise<VoicePreferences> {
  await prompter.note("Configure voice synthesis for your agent.", "Step 5: Voice");

  const enabled = await prompter.confirm({
    message: "Enable voice synthesis (TTS)?",
    initialValue: false,
  });

  if (!enabled) {
    return { enabled: false, ttsProvider: "local", voiceStyle: "neutral" };
  }

  const ttsProvider = await prompter.select<string>({
    message: "TTS provider:",
    options: [
      { value: "local", label: "Local (system TTS)", hint: "Free, works offline" },
      { value: "edge", label: "Edge TTS", hint: "Free, high quality, requires internet" },
      { value: "openai", label: "OpenAI TTS", hint: "Requires API key" },
      { value: "elevenlabs", label: "ElevenLabs", hint: "Premium quality, requires API key" },
      { value: "piper", label: "Piper (local ONNX)", hint: "Free, fast, offline" },
    ],
    initialValue: "local",
  });

  const voiceStyle = await prompter.select<string>({
    message: "Voice style:",
    options: [
      { value: "neutral", label: "Neutral", hint: "Default tone" },
      { value: "warm", label: "Warm", hint: "Friendly, approachable" },
      { value: "professional", label: "Professional", hint: "Clear, authoritative" },
      { value: "expressive", label: "Expressive", hint: "Emotion-aware modulation" },
    ],
    initialValue: "neutral",
  });

  return { enabled, ttsProvider, voiceStyle };
}

async function stepPrivacy(prompter: WizardPrompter): Promise<PrivacyConfig> {
  await prompter.note("Configure privacy and security preferences.", "Step 6: Privacy");

  const encryptAtRest = await prompter.confirm({
    message: "Encrypt stored data at rest?",
    initialValue: true,
  });

  const telemetry = await prompter.confirm({
    message: "Allow anonymous usage telemetry? (helps improve Anima)",
    initialValue: false,
  });

  const localOnly = await prompter.confirm({
    message: "Local-only mode? (no cloud features, maximum privacy)",
    initialValue: false,
  });

  return { encryptAtRest, telemetry, localOnly };
}

async function stepSummary(
  prompter: WizardPrompter,
  config: Omit<SetupConfig, "version" | "completedAt">,
): Promise<boolean> {
  const providerCount = config.providers.configuredProviders.length;
  const lines = [
    `Providers:    ${providerCount} configured (${config.providers.configuredProviders.join(", ") || "none"})`,
    `Active:       ${config.providers.activeProvider || "auto-select"}`,
    `Rotation:     ${config.modelRotation.strategy}`,
    `Agent name:   ${config.identity.agentName}`,
    `Personality:  ${config.identity.personalityPreset}`,
    `Voice:        ${config.voice.enabled ? `${config.voice.ttsProvider} (${config.voice.voiceStyle})` : "disabled"}`,
    `Encryption:   ${config.privacy.encryptAtRest ? "enabled" : "disabled"}`,
    `Telemetry:    ${config.privacy.telemetry ? "enabled" : "disabled"}`,
    `Local-only:   ${config.privacy.localOnly ? "yes" : "no"}`,
  ];

  await prompter.note(lines.join("\n"), "Step 7: Summary");

  return prompter.confirm({
    message: "Save this configuration and complete setup?",
    initialValue: true,
  });
}

// ---------------------------------------------------------------------------
// Main Wizard
// ---------------------------------------------------------------------------

export async function runSetupWizard(prompter: WizardPrompter): Promise<SetupConfig> {
  log.info("starting setup wizard");

  // Step 1: Welcome
  await stepWelcome(prompter);

  // Step 2: Providers
  const providers = await runProviderSetup(prompter);

  // Step 3: Model rotation
  const modelRotation = await runModelRotationSetup(prompter, providers);

  // Step 4: Identity
  const identity = await stepIdentity(prompter);

  // Step 5: Voice
  const voice = await stepVoice(prompter);

  // Step 6: Privacy
  const privacy = await stepPrivacy(prompter);

  // Step 7: Summary + confirm
  const confirmed = await stepSummary(prompter, {
    providers,
    modelRotation,
    identity,
    voice,
    privacy,
  });

  if (!confirmed) {
    throw new WizardCancelledError("setup wizard cancelled at confirmation");
  }

  const config: SetupConfig = {
    version: SETUP_VERSION,
    completedAt: Date.now(),
    providers,
    modelRotation,
    identity,
    voice,
    privacy,
  };

  // Persist
  saveSetupConfig(config);
  log.info("setup wizard completed", { agentName: identity.agentName });

  await prompter.outro(
    `Anima 8 setup complete! Your agent "${identity.agentName}" is ready.\n` +
      "Run `anima tui` to start the TUI, or `anima` for CLI mode.",
  );

  return config;
}
