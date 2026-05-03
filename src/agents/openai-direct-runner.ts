/**
 * OpenAI Direct API Runner
 *
 * Makes calls directly to api.openai.com without needing the Codex CLI.
 * Works with OpenAI API keys (OPENAI_API_KEY).
 *
 * Supports GPT-5.4, GPT-5.2, GPT-4.1, o3, o4-mini and other OpenAI models.
 * Full tool-calling support using OpenAI's function calling format.
 *
 * This runner is automatically used when an OpenAI API key is available
 * and the provider is set to "openai".
 */

import type { AgentTool } from "@mariozechner/pi-agent-core";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import type { ThinkLevel } from "../auto-reply/thinking.js";
import type { AnimaConfig } from "../config/config.js";
import type { EmbeddedPiRunResult } from "./pi-embedded-runner.js";
import { resolveHeartbeatPrompt } from "../auto-reply/heartbeat.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { resolveSessionAgentIds } from "./agent-scope.js";
import { resolveBootstrapContextForRun, makeBootstrapWarn } from "./bootstrap-files.js";
import { buildSystemPrompt } from "./cli-runner/helpers.js";
import { resolveAnimaDocsPath } from "./docs-path.js";
import {
  DEFAULT_LOCAL_OLLAMA_MODEL,
  ensureLocalOllamaModelInstalled,
} from "./local-model-installer.js";
import { createAnimaCodingTools } from "./pi-tools.js";
import { appendRunnerCapabilityPrompt } from "./runner-capabilities.js";
import { resolveRunWorkspaceDir } from "./workspace-run.js";

const log = createSubsystemLogger("agent/openai-direct");

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_PROVIDER_BASE_URLS: Record<string, string> = {
  openai: DEFAULT_OPENAI_BASE_URL,
  minimax: "https://api.minimax.io/v1",
  ollama: "http://127.0.0.1:11434/v1",
  lmstudio: "http://127.0.0.1:1234/v1",
};
const PROVIDER_API_KEY_HINTS: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  minimax: "MINIMAX_API_KEY",
  ollama: "OLLAMA_API_KEY",
  lmstudio: "LMSTUDIO_API_KEY",
};

// Canonical model name mapping for direct API calls
const MODEL_MAP: Record<string, string> = {
  "gpt-5.4": "gpt-5.4",
  "gpt-5.2": "gpt-5.2",
  "gpt-5": "gpt-5.4",
  "gpt-4.1": "gpt-4.1",
  "gpt-4.1-mini": "gpt-4.1-mini",
  "gpt-4.1-nano": "gpt-4.1-nano",
  "gpt-4o": "gpt-4o",
  "gpt-4o-mini": "gpt-4o-mini",
  o3: "o3",
  "o3-mini": "o3-mini",
  "o4-mini": "o4-mini",
  default: "gpt-4.1",
};

// Where we store per-session conversation history for multi-turn support
const HISTORY_FILE_SUFFIX = ".openai-history.json";

type OpenAIMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
};

type OpenAIToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

type OpenAITool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

type SessionHistory = {
  sessionId: string;
  messages: OpenAIMessage[];
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

function isToolUnsupportedError(body: string): boolean {
  const normalized = body.toLowerCase();
  return (
    normalized.includes("does not support tools") || normalized.includes("tool is not supported")
  );
}

/**
 * Clean a JSON Schema for OpenAI's function calling.
 * OpenAI is stricter than most — no unsupported keywords.
 */
function cleanSchemaForOpenAI(schema: Record<string, unknown>): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    // OpenAI doesn't support these keywords in function parameters
    if (key === "$schema" || key === "additionalProperties" || key === "$id") {
      continue;
    }
    if (key === "properties" && typeof value === "object" && value !== null) {
      const props: Record<string, unknown> = {};
      for (const [propKey, propValue] of Object.entries(value as Record<string, unknown>)) {
        if (typeof propValue === "object" && propValue !== null) {
          props[propKey] = cleanSchemaForOpenAI(propValue as Record<string, unknown>);
        } else {
          props[propKey] = propValue;
        }
      }
      cleaned[key] = props;
    } else if (key === "items" && typeof value === "object" && value !== null) {
      cleaned[key] = cleanSchemaForOpenAI(value as Record<string, unknown>);
    } else {
      cleaned[key] = value;
    }
  }
  return cleaned;
}

/**
 * Run an agent turn directly against api.openai.com.
 *
 * Maintains multi-turn conversation history per session file.
 * Falls back to single-turn if history is unavailable.
 */
export async function runOpenAIDirectAgent(params: {
  apiKey?: string;
  provider?: string;
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
  const provider = (params.provider ?? "openai").trim() || "openai";
  const resolvedModel = resolveModel(params.model);

  if (provider === "ollama" && resolvedModel === DEFAULT_LOCAL_OLLAMA_MODEL) {
    await ensureLocalOllamaModelInstalled({ model: resolvedModel });
  }

  log.info(
    `direct api exec: provider=${provider} model=${resolvedModel} promptChars=${params.prompt.length}`,
  );

  // Build system prompt (reuses the same soul file loading as the CLI runner)
  const workspaceResolution = resolveRunWorkspaceDir({
    workspaceDir: params.workspaceDir,
    sessionKey: params.sessionKey,
    agentId: params.agentId,
    config: params.config,
  });
  const workspaceDir = workspaceResolution.workspaceDir;

  // --- Natively hook into Anima's Tool Sandbox & Gateway Policies ---
  const executableTools = createAnimaCodingTools({
    config: params.config,
    workspaceDir,
    sessionKey: params.sessionKey,
    modelProvider: provider,
    modelId: resolvedModel,
  });

  // Convert tools to OpenAI function calling format
  const openaiTools: OpenAITool[] = executableTools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: cleanSchemaForOpenAI(
        (t.parameters as Record<string, unknown>) ?? { type: "object", properties: {} },
      ),
    },
  }));

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

  const extraSystemPrompt = appendRunnerCapabilityPrompt(params.extraSystemPrompt, "local-tools");

  const systemPrompt = buildSystemPrompt({
    workspaceDir,
    config: params.config,
    defaultThinkLevel: params.thinkLevel,
    extraSystemPrompt,
    ownerNumbers: params.ownerNumbers,
    heartbeatPrompt,
    docsPath: docsPath ?? undefined,
    tools: executableTools as AgentTool[],
    contextFiles,
    modelDisplay: `${provider}/${resolvedModel}`,
    agentId: sessionAgentId,
  });

  // Load or create conversation history
  let history = await loadSessionHistory(params.sessionFile);
  if (!history) {
    history = {
      sessionId: params.sessionId,
      messages: [{ role: "system", content: systemPrompt }],
      createdAt: started,
      updatedAt: started,
    };
  } else {
    // Update system prompt on each turn
    if (history.messages.length > 0 && history.messages[0].role === "system") {
      history.messages[0].content = systemPrompt;
    }
  }

  // Append the new user message
  history.messages.push({
    role: "user",
    content: params.prompt,
  });

  let finalAssistantText = "";
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let isDone = false;
  let loopCount = 0;
  const maxLoops = 20;
  let toolUseEnabled = openaiTools.length > 0;

  // Resolve base URL (support custom endpoints)
  const baseUrl =
    params.config?.models?.providers?.[provider]?.baseUrl?.trim() ||
    params.config?.models?.providers?.openai?.baseUrl?.trim() ||
    DEFAULT_PROVIDER_BASE_URLS[provider] ||
    DEFAULT_OPENAI_BASE_URL;

  // --- Execution Loop for Tool Calling ---
  while (!isDone && loopCount < maxLoops) {
    loopCount++;

    const requestBody: Record<string, unknown> = {
      model: resolvedModel,
      messages: history.messages,
      max_tokens: 8192,
      temperature: 1.0,
      stream: true,
    };

    if (toolUseEnabled && openaiTools.length > 0) {
      requestBody.tools = openaiTools;
      requestBody.tool_choice = "auto";
    }

    try {
      const controller = new AbortController();
      const timeoutHandle = setTimeout(() => controller.abort(), params.timeoutMs);

      const url = `${baseUrl}/chat/completions`;

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": `anima/7.0.0 (openai-direct-runner; ${os.platform()})`,
          ...(params.apiKey?.trim() ? { Authorization: `Bearer ${params.apiKey}` } : {}),
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      clearTimeout(timeoutHandle);

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        if (response.status === 400 && toolUseEnabled && isToolUnsupportedError(body)) {
          log.warn("openai-compatible provider rejected tools; retrying without tools", {
            provider,
            model: resolvedModel,
          });
          toolUseEnabled = false;
          continue;
        }
        const isAuth = response.status === 401 || response.status === 403;
        const isRateLimit = response.status === 429;
        const rateHint = isRateLimit ? " — rate limit hit, will retry next heartbeat." : "";
        const apiKeyHint = PROVIDER_API_KEY_HINTS[provider] ?? "API key";
        const authHint = isAuth ? ` — API key may be invalid. Check ${apiKeyHint}.` : "";
        log.error(`${provider} api error: HTTP ${response.status}${authHint}${rateHint}`, {
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

      if (!response.body) {
        throw new Error("No response body received from OpenAI API");
      }

      const bodyStream = Readable.fromWeb(response.body as import("stream/web").ReadableStream);
      let buffer = "";
      let chunkAssistantText = "";
      const toolCalls: Map<number, { id: string; name: string; arguments: string }> = new Map();

      for await (const chunk of bodyStream) {
        buffer += chunk.toString("utf8");
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) {
            continue;
          }
          const dataStr = trimmed.slice(6);
          if (dataStr === "[DONE]") {
            continue;
          }

          try {
            const parsed = JSON.parse(dataStr);
            const delta = parsed.choices?.[0]?.delta;

            if (delta) {
              // Accumulate text content
              if (typeof delta.content === "string") {
                chunkAssistantText += delta.content;
                finalAssistantText += delta.content;
                if (params.onPartialReply) {
                  await params.onPartialReply({ text: finalAssistantText });
                }
              }

              // Accumulate tool calls (they stream incrementally)
              if (delta.tool_calls) {
                for (const tc of delta.tool_calls) {
                  const idx = tc.index ?? 0;
                  const existing = toolCalls.get(idx);
                  if (tc.id) {
                    toolCalls.set(idx, {
                      id: tc.id,
                      name: tc.function?.name ?? existing?.name ?? "",
                      arguments: (existing?.arguments ?? "") + (tc.function?.arguments ?? ""),
                    });
                  } else if (existing) {
                    existing.name = existing.name || (tc.function?.name ?? "");
                    existing.arguments += tc.function?.arguments ?? "";
                  }
                }
              }
            }

            // Capture usage from the final chunk
            if (parsed.usage) {
              totalInputTokens = Math.max(totalInputTokens, parsed.usage.prompt_tokens ?? 0);
              totalOutputTokens += parsed.usage.completion_tokens ?? 0;
            }
          } catch {
            // ignore parsing errors on partial chunks
          }
        }
      }

      if (toolCalls.size > 0) {
        // Build assistant message with tool calls
        const assistantToolCalls: OpenAIToolCall[] = Array.from(toolCalls.values()).map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: {
            name: tc.name,
            arguments: tc.arguments,
          },
        }));

        const assistantMsg: OpenAIMessage = {
          role: "assistant",
          content: chunkAssistantText || null,
          tool_calls: assistantToolCalls,
        };
        history.messages.push(assistantMsg);

        // Execute tool calls and append results
        for (const tc of assistantToolCalls) {
          const tool = executableTools.find((t) => t.name === tc.function.name);
          let resultContent: string;

          if (!tool) {
            resultContent = JSON.stringify({ error: "Tool not found or unauthorized" });
          } else if (!tool.execute) {
            resultContent = JSON.stringify({ error: "Tool execution not implemented" });
          } else {
            try {
              const callId = crypto.randomUUID();
              let args: Record<string, unknown> = {};
              try {
                args = JSON.parse(tc.function.arguments);
              } catch {
                args = {};
              }
              const result = await tool.execute(callId, args);
              resultContent = typeof result === "string" ? result : JSON.stringify(result);
            } catch (err) {
              resultContent = JSON.stringify({ error: String(err) });
            }
          }

          history.messages.push({
            role: "tool",
            content: resultContent,
            tool_call_id: tc.id,
          });
        }

        // Loop continues to allow the model to see tool results
      } else {
        // No tool calls — we're done
        if (chunkAssistantText) {
          history.messages.push({
            role: "assistant",
            content: chunkAssistantText,
          });
        }
        isDone = true;
      }
    } catch (err) {
      const isAbort = err instanceof Error && err.name === "AbortError";
      const errorKind = isAbort ? "timeout" : "unknown";
      const errorMsg = isAbort ? `Request timed out after ${params.timeoutMs}ms` : String(err);

      log.error(`openai api error: ${errorMsg}`, { error: String(err) });

      return {
        status: isAbort ? "timeout" : "failed",
        meta: {
          durationMs: Date.now() - started,
          error: {
            message: errorMsg,
            kind: errorKind,
          },
        },
      };
    }
  }

  history.updatedAt = Date.now();
  await saveSessionHistory(params.sessionFile, history);

  const durationMs = Date.now() - started;

  log.info(`openai api complete: ${durationMs}ms`, {
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
    model: resolvedModel,
    provider,
  });

  return {
    status: "completed",
    output: finalAssistantText,
    payloads: finalAssistantText ? [{ text: finalAssistantText }] : [],
    meta: {
      durationMs,
      agentMeta: {
        model: resolvedModel,
        provider,
        usage: {
          input: totalInputTokens,
          output: totalOutputTokens,
        },
      },
    },
  };
}
