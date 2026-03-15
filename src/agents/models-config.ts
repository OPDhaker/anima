/**
 * Models configuration — Multi-provider
 *
 * ANIMA 6.5+ supports direct API runners for Anthropic, Google, OpenAI,
 * and AWS Bedrock. This file seeds the models.json with all known models
 * so the PI SDK ModelRegistry can discover them for the model catalog.
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { AnimaConfig } from "../config/config.js";
import { resolveAnimaAgentDir } from "./agent-paths.js";

/** Seed catalog — all models ANIMA can route to via direct runners. */
const SEED_MODELS = [
  // OpenAI — direct runner (openai-direct-runner.ts)
  {
    id: "gpt-5.4",
    name: "GPT-5.4",
    provider: "openai",
    contextWindow: 1_048_576,
    reasoning: true,
    input: ["text", "image"],
  },
  {
    id: "gpt-5.2",
    name: "GPT-5.2",
    provider: "openai",
    contextWindow: 256_000,
    reasoning: true,
    input: ["text", "image"],
  },
  {
    id: "gpt-4.1",
    name: "GPT-4.1",
    provider: "openai",
    contextWindow: 1_048_576,
    reasoning: false,
    input: ["text", "image"],
  },
  {
    id: "gpt-4.1-mini",
    name: "GPT-4.1 Mini",
    provider: "openai",
    contextWindow: 1_048_576,
    reasoning: false,
    input: ["text", "image"],
  },
  {
    id: "gpt-4.1-nano",
    name: "GPT-4.1 Nano",
    provider: "openai",
    contextWindow: 1_048_576,
    reasoning: false,
    input: ["text"],
  },
  {
    id: "gpt-4o",
    name: "GPT-4o",
    provider: "openai",
    contextWindow: 128_000,
    reasoning: false,
    input: ["text", "image"],
  },
  {
    id: "gpt-4o-mini",
    name: "GPT-4o Mini",
    provider: "openai",
    contextWindow: 128_000,
    reasoning: false,
    input: ["text", "image"],
  },
  {
    id: "o3",
    name: "o3",
    provider: "openai",
    contextWindow: 200_000,
    reasoning: true,
    input: ["text", "image"],
  },
  {
    id: "o3-mini",
    name: "o3-mini",
    provider: "openai",
    contextWindow: 200_000,
    reasoning: true,
    input: ["text"],
  },
  {
    id: "o4-mini",
    name: "o4-mini",
    provider: "openai",
    contextWindow: 200_000,
    reasoning: true,
    input: ["text", "image"],
  },

  // Google — direct runner (gemini-direct-runner.ts)
  {
    id: "gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    provider: "google",
    contextWindow: 1_048_576,
    reasoning: true,
    input: ["text", "image"],
  },
  {
    id: "gemini-2.5-pro",
    name: "Gemini 2.5 Pro",
    provider: "google",
    contextWindow: 1_048_576,
    reasoning: true,
    input: ["text", "image"],
  },
  {
    id: "gemini-2.0-flash",
    name: "Gemini 2.0 Flash",
    provider: "google",
    contextWindow: 1_048_576,
    reasoning: false,
    input: ["text", "image"],
  },

  // Anthropic — direct runner (anthropic-direct-runner.ts)
  {
    id: "claude-opus-4-6",
    name: "Claude Opus 4.6",
    provider: "anthropic",
    contextWindow: 1_000_000,
    reasoning: true,
    input: ["text", "image"],
  },
  {
    id: "claude-sonnet-4-6",
    name: "Claude Sonnet 4.6",
    provider: "anthropic",
    contextWindow: 1_000_000,
    reasoning: true,
    input: ["text", "image"],
  },
  {
    id: "claude-haiku-4-5",
    name: "Claude Haiku 4.5",
    provider: "anthropic",
    contextWindow: 200_000,
    reasoning: false,
    input: ["text", "image"],
  },

  // AWS Bedrock — bedrock runner (aws-bedrock-runner.ts)
  {
    id: "amazon.nova-micro-v1:0",
    name: "Amazon Nova Micro",
    provider: "amazon-bedrock",
    contextWindow: 128_000,
    reasoning: false,
    input: ["text"],
  },
  {
    id: "amazon.nova-lite-v1:0",
    name: "Amazon Nova Lite",
    provider: "amazon-bedrock",
    contextWindow: 300_000,
    reasoning: false,
    input: ["text", "image"],
  },
];

export async function ensureAnimaModelsJson(
  config?: AnimaConfig,
  agentDirOverride?: string,
): Promise<{ agentDir: string; wrote: boolean }> {
  const agentDir = agentDirOverride?.trim() ? agentDirOverride.trim() : resolveAnimaAgentDir();

  await fs.mkdir(agentDir, { recursive: true, mode: 0o700 });

  const targetPath = path.join(agentDir, "models.json");

  // Read existing models.json if present
  let existingData: { providers?: Record<string, unknown>; models?: unknown[] } = {};
  try {
    const raw = await fs.readFile(targetPath, "utf8");
    existingData = JSON.parse(raw);
  } catch {
    // file doesn't exist or is invalid — start fresh
  }

  // Merge seed models with any user-configured entries
  const existingModels = Array.isArray(existingData.models) ? existingData.models : [];
  const existingIds = new Set(
    existingModels
      .filter(
        (m): m is { id: string; provider: string } =>
          typeof (m as Record<string, unknown>)?.id === "string",
      )
      .map((m) => `${m.provider}/${m.id}`),
  );

  const merged = [...existingModels];
  for (const seed of SEED_MODELS) {
    const key = `${seed.provider}/${seed.id}`;
    if (!existingIds.has(key)) {
      merged.push(seed);
      existingIds.add(key);
    }
  }

  const content =
    JSON.stringify(
      {
        providers: existingData.providers ?? {},
        models: merged,
      },
      null,
      2,
    ) + "\n";

  // Only write if changed
  let existing = "";
  try {
    existing = await fs.readFile(targetPath, "utf8");
  } catch {
    // doesn't exist
  }

  if (existing === content) {
    return { agentDir, wrote: false };
  }

  await fs.writeFile(targetPath, content, { mode: 0o600 });
  return { agentDir, wrote: true };
}
