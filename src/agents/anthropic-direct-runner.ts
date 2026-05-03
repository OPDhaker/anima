/**
 * Anthropic Direct API Runner
 *
 * Makes calls directly to api.anthropic.com without needing the claude CLI
 * binary to be installed or logged in. Works with any valid token:
 *
 *   sk-ant-api01-...  (Console API key)
 *   sk-ant-oat01-...  (Claude Code OAuth access token)
 *
 * This runner is automatically used when an `anthropic:default` token credential
 * is present in the auth store and the claude CLI is unavailable or not logged in.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ThinkLevel } from "../auto-reply/thinking.js";
import type { AnimaConfig } from "../config/config.js";
import type { EmbeddedPiRunResult } from "./pi-embedded-runner.js";
import { resolveHeartbeatPrompt } from "../auto-reply/heartbeat.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { resolveSessionAgentIds } from "./agent-scope.js";
import { resolveBootstrapContextForRun, makeBootstrapWarn } from "./bootstrap-files.js";
import { buildSystemPrompt } from "./cli-runner/helpers.js";
import { resolveAnimaDocsPath } from "./docs-path.js";
import { appendRunnerCapabilityPrompt } from "./runner-capabilities.js";
import { resolveRunWorkspaceDir } from "./workspace-run.js";

const log = createSubsystemLogger("agent/anthropic-direct");

// Canonical model name mapping for direct API calls
const MODEL_MAP: Record<string, string> = {
  opus: "claude-opus-4-5",
  "opus-4": "claude-opus-4-5",
  "opus-4.5": "claude-opus-4-5",
  "opus-4.6": "claude-opus-4-5",
  "claude-opus-4-5": "claude-opus-4-5",
  sonnet: "claude-sonnet-4-5",
  "sonnet-4.5": "claude-sonnet-4-5",
  "sonnet-4.1": "claude-sonnet-4-1-20250219",
  "claude-sonnet-4-5": "claude-sonnet-4-5",
  haiku: "claude-haiku-3-5",
  "haiku-3.5": "claude-haiku-3-5",
  default: "claude-sonnet-4-5",
};

// Where we store per-session conversation history for multi-turn support
const HISTORY_FILE_SUFFIX = ".anima-history.json";

type AnthropicMessage = {
  role: "user" | "assistant";
  content: string;
};

type SessionHistory = {
  sessionId: string;
  messages: AnthropicMessage[];
  createdAt: number;
  updatedAt: number;
};

async function loadSessionHistory(sessionFile: string): Promise<SessionHistory | null> {
  const histPath = sessionFile + HISTORY_FILE_SUFFIX;
  try {
    const raw = await fs.readFile(histPath, "utf8");
    return JSON.parse(raw) as SessionHistory;
  } catch {
    return null;
  }
}

async function saveSessionHistory(sessionFile: string, history: SessionHistory): Promise<void> {
  const histPath = sessionFile + HISTORY_FILE_SUFFIX;
  try {
    await fs.mkdir(path.dirname(histPath), { recursive: true });
    await fs.writeFile(histPath, JSON.stringify(history, null, 2), "utf8");
  } catch (err) {
    log.warn("failed to save session history", { error: String(err) });
  }
}

function resolveModel(model: string | undefined): string {
  const key = (model ?? "default").trim().toLowerCase() || "default";
  return MODEL_MAP[key] ?? key;
}

/**
 * Run an agent turn directly against api.anthropic.com.
 *
 * Maintains multi-turn conversation history per session file.
 * Falls back to single-turn if history is unavailable.
 */
export async function runAnthropicDirectAgent(params: {
  token: string;
  sessionId: string;
  sessionKey?: string;
  agentId?: string;
  sessionFile: string;
  workspaceDir: string;
  config?: AnimaConfig;
  prompt: string;
  model?: string;
  thinkLevel?: ThinkLevel;
  timeoutMs: number;
  runId: string;
  extraSystemPrompt?: string;
  ownerNumbers?: string[];
  onPartialReply?: (payload: { text?: string }) => Promise<void> | void;
  onAssistantMessageStart?: () => Promise<void> | void;
}): Promise<EmbeddedPiRunResult> {
  const started = Date.now();
  const resolvedModel = resolveModel(params.model);

  log.info(`direct api exec: model=${resolvedModel} promptChars=${params.prompt.length}`);

  // Build system prompt (reuses the same soul file loading as the CLI runner)
  const workspaceResolution = resolveRunWorkspaceDir({
    workspaceDir: params.workspaceDir,
    sessionKey: params.sessionKey,
    agentId: params.agentId,
    config: params.config,
  });
  const workspaceDir = workspaceResolution.workspaceDir;

  const { contextFiles } = await resolveBootstrapContextForRun({
    workspaceDir,
    config: params.config,
    sessionKey: params.sessionKey,
    sessionId: params.sessionId,
    warn: makeBootstrapWarn({
      sessionLabel: params.sessionKey ?? params.sessionId,
      warn: (msg) => log.warn(msg),
    }),
  });

  const { defaultAgentId, sessionAgentId } = resolveSessionAgentIds({
    sessionKey: params.sessionKey,
    config: params.config,
  });

  const heartbeatPrompt =
    sessionAgentId === defaultAgentId
      ? resolveHeartbeatPrompt(params.config?.agents?.defaults?.heartbeat?.prompt)
      : undefined;

  const docsPath = await resolveAnimaDocsPath({
    workspaceDir,
    argv1: process.argv[1],
    cwd: process.cwd(),
    moduleUrl: import.meta.url,
  });

  const extraSystemPrompt = appendRunnerCapabilityPrompt(params.extraSystemPrompt, "disabled");

  const systemPrompt = buildSystemPrompt({
    workspaceDir,
    config: params.config,
    defaultThinkLevel: params.thinkLevel,
    extraSystemPrompt,
    ownerNumbers: params.ownerNumbers,
    heartbeatPrompt,
    docsPath: docsPath ?? undefined,
    tools: [],
    contextFiles,
    modelDisplay: `anthropic/${resolvedModel}`,
    agentId: sessionAgentId,
  });

  // Load or create conversation history
  let history = await loadSessionHistory(params.sessionFile);
  if (!history) {
    history = {
      sessionId: params.sessionId,
      messages: [],
      createdAt: started,
      updatedAt: started,
    };
  }

  // Append the new user message
  history.messages.push({ role: "user", content: params.prompt });

  // Build the API request body
  const requestBody = {
    model: resolvedModel,
    max_tokens: 8192,
    system: systemPrompt,
    messages: history.messages,
  };

  try {
    // Call api.anthropic.com directly using node fetch (available in Node 18+)
    // undici is also available as a dep but native fetch works fine here
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), params.timeoutMs);

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": params.token,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
        "user-agent": `anima/7.0.0 (direct-runner; ${os.platform()})`,
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    clearTimeout(timeoutHandle);

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const isAuth = response.status === 401 || response.status === 403;
      const isRateLimit = response.status === 429;
      const rateHint = isRateLimit ? " — rate limit hit, will retry next heartbeat." : "";
      const authHint = isAuth ? " — token may be invalid or expired. Run: anima setup-token" : "";
      log.error(`anthropic api error: HTTP ${response.status}${authHint}${rateHint}`, {
        status: response.status,
        body: body.slice(0, 500),
      });
      return {
        status: "failed",
        meta: {
          durationMs: Date.now() - started,
          error: {
            message: `HTTP ${response.status}: ${body.slice(0, 200)}${authHint}${rateHint}`,
            kind: isAuth ? "auth" : isRateLimit ? "rate_limit" : "unknown",
          },
        },
      };
    }

    const data = (await response.json()) as {
      content?: Array<{ type: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
      stop_reason?: string;
      id?: string;
    };

    const textBlocks = (data.content ?? [])
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text as string);

    const outputText = textBlocks.join("").trim();

    if (!outputText) {
      log.warn("anthropic direct: empty response", {
        stopReason: data.stop_reason,
        contentTypes: (data.content ?? []).map((b) => b.type),
      });
    }

    // Signal assistant started and stream the reply
    if (outputText && params.onPartialReply) {
      await params.onPartialReply({ text: outputText });
    }

    // Update conversation history
    history.messages.push({ role: "assistant", content: outputText });
    history.updatedAt = Date.now();
    await saveSessionHistory(params.sessionFile, history);

    const durationMs = Date.now() - started;
    const inputTokens = data.usage?.input_tokens ?? 0;
    const outputTokens = data.usage?.output_tokens ?? 0;

    log.info(
      `direct api done: model=${resolvedModel} in=${inputTokens} out=${outputTokens} ms=${durationMs}`,
    );

    return {
      status: "completed",
      output: outputText,
      payloads: outputText ? [{ text: outputText }] : [],
      meta: {
        durationMs,
        agentMeta: {
          provider: "anthropic",
          model: resolvedModel,
          usage: {
            input: inputTokens,
            output: outputTokens,
            cacheWrite: 0,
            cacheRead: 0,
          },
        },
      },
    };
  } catch (err) {
    const isAbort =
      err instanceof Error && (err.name === "AbortError" || err.message.includes("aborted"));
    log.error("anthropic direct runner error", { error: String(err) });
    return {
      status: isAbort ? "timeout" : "failed",
      meta: {
        durationMs: Date.now() - started,
        error: {
          message: isAbort
            ? `Request timed out after ${params.timeoutMs}ms`
            : String(err instanceof Error ? err.message : err),
          kind: isAbort ? "timeout" : "unknown",
        },
      },
    };
  }
}

/**
 * Check if the given token can reach the Anthropic API.
 * Returns true if the token is valid, false otherwise.
 */
export async function testAnthropicToken(token: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": token,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-3-5",
        max_tokens: 5,
        messages: [{ role: "user", content: "hi" }],
      }),
    });
    if (response.ok || response.status === 529) {
      // 529 = overloaded but auth is fine
      return { ok: true };
    }
    if (response.status === 401 || response.status === 403) {
      const body = await response.text().catch(() => "");
      return { ok: false, error: `Auth failed (${response.status}): ${body.slice(0, 100)}` };
    }
    return { ok: true }; // Other errors = token may be fine, network issue
  } catch (err) {
    return { ok: false, error: String(err instanceof Error ? err.message : err) };
  }
}
