/**
 * Gemini Direct API Runner
 *
 * Makes calls directly to generativelanguage.googleapis.com without needing
 * a CLI wrapper. Works with Google API keys (GEMINI_API_KEY).
 *
 * This runner is automatically used when a google API key is available
 * and the provider is set to "google" or "gemini".
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
import { createAnimaCodingTools } from "./pi-tools.js";
import { cleanToolSchemaForGemini } from "./pi-tools.schema.js";
import { appendRunnerCapabilityPrompt } from "./runner-capabilities.js";
import { resolveRunWorkspaceDir } from "./workspace-run.js";

const log = createSubsystemLogger("agent/gemini-direct");

const DEFAULT_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

// Canonical model name mapping for direct API calls
const MODEL_MAP: Record<string, string> = {
  gemini: "gemini-2.5-flash",
  "gemini-pro": "gemini-2.5-pro",
  "gemini-flash": "gemini-2.5-flash",
  "gemini-2.0": "gemini-2.0-flash",
  "gemini-2.0-flash": "gemini-2.0-flash",
  "gemini-2.0-pro": "gemini-2.0-pro",
  "gemini-1.5": "gemini-1.5-pro",
  "gemini-1.5-pro": "gemini-1.5-pro",
  "gemini-1.5-flash": "gemini-1.5-flash",
  "gemini-3.1-pro-preview": "gemini-3.1-pro-preview",
  default: "gemini-2.5-flash",
};

// Where we store per-session conversation history for multi-turn support
const HISTORY_FILE_SUFFIX = ".gemini-history.json";

type GeminiContent = {
  role: "user" | "model";
  parts: GeminiPart[];
};

type GeminiFunctionCall = {
  name: string;
  args?: Record<string, unknown>;
};

type GeminiPart = {
  text?: string;
  thought?: boolean;
  functionCall?: GeminiFunctionCall;
  functionResponse?: {
    name: string;
    response: unknown;
  };
};

type SessionHistory = {
  sessionId: string;
  contents: GeminiContent[];
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

function buildModelPath(model: string): string {
  return model.startsWith("models/") ? model : `models/${model}`;
}

/**
 * Run an agent turn directly against generativelanguage.googleapis.com.
 *
 * Maintains multi-turn conversation history per session file.
 * Falls back to single-turn if history is unavailable.
 */
export async function runGeminiDirectAgent(params: {
  apiKey: string;
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
  const modelPath = buildModelPath(resolvedModel);

  log.info(`direct api exec: model=${resolvedModel} promptChars=${params.prompt.length}`);

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
    modelProvider: "google",
    modelId: resolvedModel,
  });

  const functionDeclarations = executableTools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: cleanToolSchemaForGemini(t.parameters as Record<string, unknown>),
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
    modelDisplay: `google/${resolvedModel}`,
    agentId: sessionAgentId,
  });

  // Load or create conversation history
  let history = await loadSessionHistory(params.sessionFile);
  if (!history) {
    history = {
      sessionId: params.sessionId,
      contents: [],
      createdAt: started,
      updatedAt: started,
    };
  }

  // Append the new user message
  history.contents.push({
    role: "user",
    parts: [{ text: params.prompt }],
  });

  let finalAssistantText = "";
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let isDone = false;
  let loopCount = 0;
  const maxLoops = 20;

  // --- Execution Loop for Tool Calling ---
  while (!isDone && loopCount < maxLoops) {
    loopCount++;

    const requestBody = {
      systemInstruction: {
        parts: [{ text: systemPrompt }],
      },
      contents: history.contents,
      generationConfig: {
        maxOutputTokens: 8192,
        temperature: 1.0,
      },
      tools: functionDeclarations.length > 0 ? [{ functionDeclarations }] : undefined,
    };

    try {
      const controller = new AbortController();
      const timeoutHandle = setTimeout(() => controller.abort(), params.timeoutMs);

      const baseUrl = DEFAULT_GEMINI_BASE_URL;
      const url = `${baseUrl}/${modelPath}:streamGenerateContent?alt=sse&key=${params.apiKey}`;

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": `anima/7.0.0 (gemini-direct-runner; ${os.platform()})`,
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
        const authHint = isAuth
          ? " — API key may be invalid. Check GEMINI_API_KEY environment variable."
          : "";
        console.error("GEMINI API ERROR BODY:", body);
        log.error(`gemini api error: HTTP ${response.status}${authHint}${rateHint}`, {
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
        throw new Error("No response body received from Gemini API");
      }

      const bodyStream = Readable.fromWeb(response.body as import("stream/web").ReadableStream);
      let buffer = "";
      let chunkAssistantText = "";
      let functionCalls: GeminiFunctionCall[] = [];
      let nonTextParts: GeminiPart[] = [];

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
            const parts = parsed.candidates?.[0]?.content?.parts;
            if (parts) {
              for (const p of parts) {
                if (typeof p.text === "string" && !p.thought) {
                  chunkAssistantText += p.text;
                  finalAssistantText += p.text;
                  if (params.onPartialReply) {
                    await params.onPartialReply({ text: finalAssistantText });
                  }
                } else {
                  nonTextParts.push(p);
                  if (p.functionCall) {
                    functionCalls.push(p.functionCall);
                  }
                }
              }
            }
            if (parsed.usageMetadata) {
              totalInputTokens = Math.max(
                totalInputTokens,
                parsed.usageMetadata.promptTokenCount ?? 0,
              );
              totalOutputTokens += parsed.usageMetadata.candidatesTokenCount ?? 0;
            }
          } catch {
            // ignore parsing errors on partial chunks
          }
        }
      }

      if (functionCalls.length > 0) {
        const modelParts = [];
        if (chunkAssistantText) {
          modelParts.push({ text: chunkAssistantText });
        }
        for (const p of nonTextParts) {
          modelParts.push(p);
        }
        history.contents.push({ role: "model", parts: modelParts });

        const toolResults = await Promise.all(
          functionCalls.map(async (fc) => {
            const tool = executableTools.find((t) => t.name === fc.name);
            if (!tool) {
              return { name: fc.name, response: { error: "Tool not found or unauthorized" } };
            }
            if (!tool.execute) {
              return { name: fc.name, response: { error: "Tool execution not implemented" } };
            }
            try {
              const callId = crypto.randomUUID();
              const result = await tool.execute(callId, fc.args as Record<string, unknown>);
              return { name: fc.name, response: result };
            } catch (err) {
              return { name: fc.name, response: { error: String(err) } };
            }
          }),
        );

        history.contents.push({
          role: "user",
          parts: toolResults.map((res) => ({
            functionResponse: { name: res.name, response: res.response },
          })),
        });

        // Loop continues to allow the model to see tool results
      } else {
        if (chunkAssistantText || nonTextParts.length > 0) {
          const modelParts = [];
          if (chunkAssistantText) {
            modelParts.push({ text: chunkAssistantText });
          }
          for (const p of nonTextParts) {
            modelParts.push(p);
          }
          history.contents.push({
            role: "model",
            parts: modelParts,
          });
        }
        isDone = true;
      }
    } catch (err) {
      const isAbort = err instanceof Error && err.name === "AbortError";
      const errorKind = isAbort ? "timeout" : "unknown";
      const errorMsg = isAbort ? `Request timed out after ${params.timeoutMs}ms` : String(err);

      log.error(`gemini api error: ${errorMsg}`, { error: String(err) });

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

  log.info(`gemini api complete: ${durationMs}ms`, {
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
  });

  return {
    status: "completed",
    output: finalAssistantText,
    payloads: finalAssistantText ? [{ text: finalAssistantText }] : [],
    meta: {
      durationMs,
      agentMeta: {
        model: resolvedModel,
        provider: "google",
        usage: {
          input: totalInputTokens,
          output: totalOutputTokens,
        },
      },
    },
  };
}
