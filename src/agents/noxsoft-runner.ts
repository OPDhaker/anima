import type { ImageContent } from "@mariozechner/pi-ai";
import crypto from "node:crypto";
import type { ThinkLevel } from "../auto-reply/thinking.js";
import type { AgentStreamParams } from "../commands/agent/types.js";
import type { AnimaConfig } from "../config/config.js";
import type { SessionSystemPromptReport } from "../config/sessions/types.js";
import type { AuthProfileFailureReason, AuthProfileStore } from "./auth-profiles.js";
import { runAnthropicDirectAgent } from "./anthropic-direct-runner.js";
import {
  ensureAuthProfileStore,
  markAuthProfileFailure,
  markAuthProfileGood,
  markAuthProfileUsed,
} from "./auth-profiles.js";
import { resolveCliBackendConfig } from "./cli-backends.js";
import { runCliAgent } from "./cli-runner.js";
import { FailoverError, resolveFailoverStatus } from "./failover-error.js";
import { runGeminiDirectAgent } from "./gemini-direct-runner.js";
import { resolveApiKeyForProvider } from "./model-auth.js";
import { normalizeModelRef, normalizeProviderId } from "./model-selection.js";
import { runOpenAIDirectAgent } from "./openai-direct-runner.js";
import { classifyFailoverReason } from "./pi-embedded-helpers.js";
import {
  derivePromptTokens,
  normalizeUsage,
  type NormalizedUsage,
  type UsageLike,
} from "./usage.js";

export type EmbeddedPiAgentMeta = Record<string, unknown>;

export type EmbeddedPiCompactResult = {
  ok: boolean;
  compacted?: boolean;
  reason?: string;
  result?: {
    tokensBefore?: number;
    tokensAfter?: number;
  };
};

export type EmbeddedPiRunMeta = Record<string, unknown>;

export type EmbeddedPiRunResult = {
  status: "completed" | "failed" | "timeout";
  output?: string;
  payloads?: Array<{
    text?: string;
    mediaUrl?: string;
    mediaUrls?: string[];
  }>;
  meta: {
    durationMs?: number;
    error?: { message: string; kind?: string };
    systemPromptReport?: SessionSystemPromptReport;
    agentMeta?: {
      sessionId?: string;
      provider?: string;
      model?: string;
      usage?: NormalizedUsage;
      promptTokens?: number;
      lastCallUsage?: NormalizedUsage;
    };
  };
  messagingToolSentTexts?: string[];
  messagingToolSentTargets?: Array<{
    to: string;
    text: string;
    provider?: string;
    accountId?: string;
  }>;
};

export type NoxSoftRunnerStrategy =
  | { kind: "anthropic-direct"; provider: string }
  | { kind: "gemini-direct"; provider: string }
  | { kind: "openai-direct"; provider: string }
  | { kind: "cli"; provider: string; cliProvider: string };

export type NoxSoftEmbeddedRunParams = {
  sessionId: string;
  sessionFile: string;
  workspaceDir: string;
  prompt: string;
  provider?: string;
  model?: string;
  thinkLevel?: ThinkLevel;
  timeoutMs?: number;
  runId?: string;
  config?: AnimaConfig;
  sessionKey?: string;
  agentId?: string;
  agentDir?: string;
  authProfileId?: string;
  authProfileIdSource?: "auto" | "user";
  execSecurity?: string;
  cliSessionId?: string;
  extraSystemPrompt?: string;
  ownerNumbers?: string[];
  images?: ImageContent[];
  streamParams?: AgentStreamParams;
  onPartialReply?: (payload: { text?: string; mediaUrls?: string[] }) => Promise<void> | void;
  onAssistantMessageStart?: () => Promise<void> | void;
  onAgentEvent?: (evt: { stream: string; data: Record<string, unknown> }) => Promise<void> | void;
} & Record<string, unknown>;

type DirectProvider = "anthropic" | "google" | "openai";

function normalizeEmbeddedProvider(provider: string | undefined): string {
  const normalized = normalizeProviderId(provider ?? "");
  return normalized || "anthropic";
}

function resolveCompatCliProvider(provider: string, config?: AnimaConfig): string {
  if (resolveCliBackendConfig(provider, config)) {
    return provider;
  }
  if (provider === "anthropic" || provider === "claude") {
    return "claude-cli";
  }
  if (provider === "openai" || provider === "openai-codex" || provider === "codex") {
    if (resolveCliBackendConfig("openai-codex", config)) {
      return "openai-codex";
    }
    return "codex-cli";
  }
  if (resolveCliBackendConfig("claude-cli", config)) {
    return "claude-cli";
  }
  if (resolveCliBackendConfig("codex-cli", config)) {
    return "codex-cli";
  }
  return provider;
}

async function emitAgentEvent(
  params: NoxSoftEmbeddedRunParams,
  stream: string,
  data: Record<string, unknown>,
) {
  await params.onAgentEvent?.({ stream, data });
}

function resolveDirectAuthProvider(provider: string): DirectProvider | null {
  if (provider === "anthropic" || provider === "claude") {
    return "anthropic";
  }
  if (provider === "google" || provider === "gemini") {
    return "google";
  }
  if (provider === "openai") {
    return "openai";
  }
  return null;
}

function resolveProfileFailureReason(
  result: EmbeddedPiRunResult,
): AuthProfileFailureReason | undefined {
  const kind = result.meta.error?.kind?.trim().toLowerCase();
  if (kind === "auth") {
    return "auth";
  }
  if (kind === "rate_limit") {
    return "rate_limit";
  }
  const classified = classifyFailoverReason(result.meta.error?.message ?? "");
  if (classified === "billing") {
    return "billing";
  }
  if (classified === "auth") {
    return "auth";
  }
  if (classified === "rate_limit") {
    return "rate_limit";
  }
  return undefined;
}

function resolveResultErrorKind(result: EmbeddedPiRunResult): string {
  const kind = result.meta.error?.kind?.trim().toLowerCase();
  if (kind) {
    return kind;
  }
  return result.status === "timeout" ? "timeout" : "unknown";
}

function normalizeResultStatus(result: EmbeddedPiRunResult): EmbeddedPiRunResult["status"] {
  const kind = resolveResultErrorKind(result);
  if (result.status === "timeout" || kind === "timeout") {
    return "timeout";
  }
  return result.status;
}

function normalizeResultPayloads(result: EmbeddedPiRunResult): EmbeddedPiRunResult["payloads"] {
  const payloads = result.payloads?.filter((payload) => payload && typeof payload === "object");
  if (payloads && payloads.length > 0) {
    return payloads;
  }
  const output = result.output?.trim();
  return output ? [{ text: output }] : undefined;
}

function normalizeResultOutput(
  result: EmbeddedPiRunResult,
  payloads: EmbeddedPiRunResult["payloads"],
): string | undefined {
  const directOutput = result.output?.trim();
  if (directOutput) {
    return directOutput;
  }
  const firstPayloadText = payloads?.find((payload) => payload.text?.trim())?.text?.trim();
  return firstPayloadText || undefined;
}

function normalizeRunnerResult(params: {
  result: EmbeddedPiRunResult;
  provider: string;
  model?: string;
  sessionId: string;
}): EmbeddedPiRunResult {
  const payloads = normalizeResultPayloads(params.result);
  const output = normalizeResultOutput(params.result, payloads);
  const usage = normalizeUsage(params.result.meta.agentMeta?.usage as UsageLike | undefined);
  const lastCallUsage = normalizeUsage(
    params.result.meta.agentMeta?.lastCallUsage as UsageLike | undefined,
  );
  const promptTokens =
    params.result.meta.agentMeta?.promptTokens ?? derivePromptTokens(usage ?? lastCallUsage);
  const status = normalizeResultStatus(params.result);
  const errorMessage = params.result.meta.error?.message?.trim();
  const errorKind = resolveResultErrorKind(params.result);

  return {
    ...params.result,
    status,
    output,
    payloads,
    meta: {
      ...params.result.meta,
      error:
        status === "completed" && !errorMessage
          ? undefined
          : {
              message:
                errorMessage ||
                (status === "timeout" ? "Request timed out." : "Runner execution failed."),
              kind: errorKind,
            },
      agentMeta: {
        ...params.result.meta.agentMeta,
        sessionId: params.result.meta.agentMeta?.sessionId?.trim() || params.sessionId,
        provider: params.provider,
        model: params.model ?? params.result.meta.agentMeta?.model,
        usage,
        promptTokens,
        lastCallUsage,
      },
    },
  };
}

function coerceResultFailure(params: {
  result: EmbeddedPiRunResult;
  provider: string;
  model?: string;
}): FailoverError | null {
  if (params.result.status === "completed") {
    return null;
  }
  const message =
    params.result.meta.error?.message?.trim() ||
    (params.result.status === "timeout" ? "Request timed out." : "Runner execution failed.");
  const reason = classifyFailoverReason(message) ?? resolveResultErrorKind(params.result);
  return new FailoverError(message, {
    reason:
      reason === "timeout"
        ? "timeout"
        : (reason as AuthProfileFailureReason | "format" | "billing" | "unknown" | "rate_limit"),
    provider: params.provider,
    model: params.model,
    status: resolveFailoverStatus(
      reason as "auth" | "format" | "rate_limit" | "billing" | "timeout" | "unknown",
    ),
  });
}

async function resolveDirectProviderAuth(params: {
  provider: DirectProvider;
  config?: AnimaConfig;
  agentDir?: string;
  preferredProfile?: string;
  store?: AuthProfileStore;
}) {
  return resolveApiKeyForProvider({
    provider: params.provider,
    cfg: params.config,
    preferredProfile: params.preferredProfile,
    agentDir: params.agentDir,
    store: params.store,
  });
}

async function runDirectWithProfileFallback(
  params: NoxSoftEmbeddedRunParams & {
    directProvider: DirectProvider;
    timeoutMs: number;
    runId: string;
    emitPartial: (payload: { text?: string; mediaUrls?: string[] }) => Promise<void>;
  },
): Promise<EmbeddedPiRunResult> {
  const store = ensureAuthProfileStore(params.agentDir, { allowKeychainPrompt: false });
  const attemptedAuthSources = new Set<string>();
  let preferredProfile = params.authProfileId;
  let lastResult: EmbeddedPiRunResult | null = null;

  for (;;) {
    const auth = await resolveDirectProviderAuth({
      provider: params.directProvider,
      config: params.config,
      agentDir: params.agentDir,
      preferredProfile,
      store,
    });
    const authSourceKey = auth.profileId ?? `${auth.mode}:${auth.source}`;
    if (attemptedAuthSources.has(authSourceKey)) {
      return (
        lastResult ?? {
          status: "failed",
          meta: {
            durationMs: 0,
            error: {
              message: `Auth fallback loop detected for ${params.directProvider}.`,
              kind: "unknown",
            },
          },
        }
      );
    }
    attemptedAuthSources.add(authSourceKey);

    const directRunParams = {
      sessionId: params.sessionId,
      sessionKey: params.sessionKey,
      agentId: params.agentId,
      sessionFile: params.sessionFile,
      workspaceDir: params.workspaceDir,
      config: params.config,
      prompt: params.prompt,
      model: params.model,
      thinkLevel: params.thinkLevel,
      timeoutMs: params.timeoutMs,
      runId: params.runId,
      extraSystemPrompt: params.extraSystemPrompt,
      ownerNumbers: params.ownerNumbers,
      onPartialReply: params.emitPartial,
      onAssistantMessageStart: params.onAssistantMessageStart,
    };

    const result =
      params.directProvider === "anthropic"
        ? await runAnthropicDirectAgent({
            ...directRunParams,
            token: auth.apiKey ?? "",
          })
        : params.directProvider === "openai"
          ? await runOpenAIDirectAgent({
              ...directRunParams,
              apiKey: auth.apiKey ?? "",
            })
          : await runGeminiDirectAgent({
              ...directRunParams,
              apiKey: auth.apiKey ?? "",
            });

    if (result.status === "completed") {
      if (auth.profileId) {
        await markAuthProfileUsed({
          store,
          profileId: auth.profileId,
          agentDir: params.agentDir,
        });
        await markAuthProfileGood({
          store,
          provider: params.directProvider,
          profileId: auth.profileId,
          agentDir: params.agentDir,
        });
      }
      return result;
    }

    lastResult = result;
    const failureReason = resolveProfileFailureReason(result);
    if (!auth.profileId || !failureReason) {
      return result;
    }

    await markAuthProfileFailure({
      store,
      profileId: auth.profileId,
      reason: failureReason,
      cfg: params.config,
      agentDir: params.agentDir,
    });
    preferredProfile = undefined;
  }
}

async function resolveDirectStrategy(
  provider: string,
  config?: AnimaConfig,
  agentDir?: string,
): Promise<NoxSoftRunnerStrategy | null> {
  const directProvider = resolveDirectAuthProvider(provider);
  if (!directProvider) {
    return null;
  }
  try {
    const auth = await resolveDirectProviderAuth({
      provider: directProvider,
      config,
      agentDir,
      store: ensureAuthProfileStore(agentDir, { allowKeychainPrompt: false }),
    });
    if (auth.apiKey) {
      // Anthropic's Messages API does not support OAuth tokens (sk-ant-oat01-...).
      // These must go through the Claude CLI backend instead.
      if (directProvider === "anthropic" && auth.apiKey.startsWith("sk-ant-oat01-")) {
        return null;
      }
      return {
        kind:
          directProvider === "google"
            ? "gemini-direct"
            : directProvider === "openai"
              ? "openai-direct"
              : "anthropic-direct",
        provider,
      };
    }
  } catch {}
  return null;
}

export async function resolveNoxSoftRunnerStrategy(
  params: Pick<NoxSoftEmbeddedRunParams, "provider" | "config" | "agentDir">,
): Promise<NoxSoftRunnerStrategy> {
  const provider = normalizeEmbeddedProvider(params.provider);
  const direct = await resolveDirectStrategy(provider, params.config, params.agentDir);
  if (direct) {
    return direct;
  }
  const cliProvider = resolveCompatCliProvider(provider, params.config);
  const backend = resolveCliBackendConfig(cliProvider, params.config);
  if (!backend) {
    throw new Error(
      `No CLI backend available for provider "${provider}" (resolved "${cliProvider}").\n` +
        `Either:\n` +
        `  • Run: anima setup-token  (set an Anthropic API key — no CLI needed)\n` +
        `  • Install the matching CLI and log in`,
    );
  }
  return {
    kind: "cli",
    provider,
    cliProvider,
  };
}

export async function runNoxSoftEmbeddedAgent(
  params: NoxSoftEmbeddedRunParams,
): Promise<EmbeddedPiRunResult> {
  const provider = normalizeEmbeddedProvider(params.provider);
  const normalizedRequestedRef = params.model?.trim()
    ? normalizeModelRef(provider, params.model)
    : null;
  const startedAt = Date.now();
  const runId = params.runId?.trim() || crypto.randomUUID();
  const timeoutMs =
    typeof params.timeoutMs === "number" && params.timeoutMs > 0 ? params.timeoutMs : 120_000;
  let assistantStarted = false;
  const streamTasks: Promise<void>[] = [];

  const emitPartial = async (payload: { text?: string; mediaUrls?: string[] }) => {
    if (!assistantStarted) {
      assistantStarted = true;
      await params.onAssistantMessageStart?.();
    }
    await params.onPartialReply?.(payload);
    await emitAgentEvent(params, "assistant", { text: payload.text });
  };

  const strategy = await resolveNoxSoftRunnerStrategy({
    provider: params.provider,
    config: params.config,
    agentDir: params.agentDir,
  });

  if (strategy.kind === "anthropic-direct") {
    await emitAgentEvent(params, "lifecycle", { phase: "start", startedAt });
    try {
      const result = normalizeRunnerResult({
        result: await runDirectWithProfileFallback({
          ...params,
          directProvider: "anthropic",
          timeoutMs,
          runId,
          emitPartial,
        }),
        provider: normalizedRequestedRef?.provider ?? provider,
        model: normalizedRequestedRef?.model,
        sessionId: params.sessionId,
      });
      const failure = coerceResultFailure({
        result,
        provider: result.meta.agentMeta?.provider ?? provider,
        model: result.meta.agentMeta?.model,
      });
      if (failure) {
        await emitAgentEvent(params, "lifecycle", {
          phase: "error",
          startedAt,
          endedAt: Date.now(),
          error: failure.message,
          status: result.status,
        });
        throw failure;
      }
      await emitAgentEvent(params, "lifecycle", {
        phase: "end",
        durationMs: Date.now() - startedAt,
        status: result.status,
      });
      return result;
    } catch (err) {
      await emitAgentEvent(params, "lifecycle", {
        phase: "error",
        error: String(err instanceof Error ? err.message : err),
      });
      throw err;
    }
  }

  if (strategy.kind === "gemini-direct") {
    await emitAgentEvent(params, "lifecycle", { phase: "start", startedAt });
    try {
      const result = normalizeRunnerResult({
        result: await runDirectWithProfileFallback({
          ...params,
          directProvider: "google",
          timeoutMs,
          runId,
          emitPartial,
        }),
        provider: normalizedRequestedRef?.provider ?? provider,
        model: normalizedRequestedRef?.model,
        sessionId: params.sessionId,
      });
      const failure = coerceResultFailure({
        result,
        provider: result.meta.agentMeta?.provider ?? provider,
        model: result.meta.agentMeta?.model,
      });
      if (failure) {
        await emitAgentEvent(params, "lifecycle", {
          phase: "error",
          startedAt,
          endedAt: Date.now(),
          error: failure.message,
          status: result.status,
        });
        throw failure;
      }
      await emitAgentEvent(params, "lifecycle", {
        phase: "end",
        durationMs: Date.now() - startedAt,
        status: result.status,
      });
      return result;
    } catch (err) {
      await emitAgentEvent(params, "lifecycle", {
        phase: "error",
        error: String(err instanceof Error ? err.message : err),
      });
      throw err;
    }
  }

  if (strategy.kind === "openai-direct") {
    await emitAgentEvent(params, "lifecycle", { phase: "start", startedAt });
    try {
      const result = normalizeRunnerResult({
        result: await runDirectWithProfileFallback({
          ...params,
          directProvider: "openai",
          timeoutMs,
          runId,
          emitPartial,
        }),
        provider: normalizedRequestedRef?.provider ?? provider,
        model: normalizedRequestedRef?.model,
        sessionId: params.sessionId,
      });
      const failure = coerceResultFailure({
        result,
        provider: result.meta.agentMeta?.provider ?? provider,
        model: result.meta.agentMeta?.model,
      });
      if (failure) {
        await emitAgentEvent(params, "lifecycle", {
          phase: "error",
          startedAt,
          endedAt: Date.now(),
          error: failure.message,
          status: result.status,
        });
        throw failure;
      }
      await emitAgentEvent(params, "lifecycle", {
        phase: "end",
        durationMs: Date.now() - startedAt,
        status: result.status,
      });
      return result;
    } catch (err) {
      await emitAgentEvent(params, "lifecycle", {
        phase: "error",
        error: String(err instanceof Error ? err.message : err),
      });
      throw err;
    }
  }

  await emitAgentEvent(params, "lifecycle", {
    phase: "start",
    startedAt,
  });

  try {
    const result = normalizeRunnerResult({
      result: await runCliAgent({
        sessionId: params.sessionId,
        sessionKey: params.sessionKey,
        agentId: params.agentId,
        sessionFile: params.sessionFile,
        workspaceDir: params.workspaceDir,
        config: params.config,
        prompt: params.prompt,
        provider: strategy.cliProvider,
        model: params.model,
        thinkLevel: params.thinkLevel,
        timeoutMs,
        runId,
        extraSystemPrompt: params.extraSystemPrompt,
        ownerNumbers: params.ownerNumbers,
        cliSessionId: params.cliSessionId,
        sessionExecSecurity: params.execSecurity,
        images: params.images,
        streamParams: params.streamParams,
        onTextStream: (text) => {
          const nextText = text.trim();
          if (!nextText) {
            return;
          }
          streamTasks.push(emitPartial({ text: nextText }));
        },
      }),
      provider: normalizedRequestedRef?.provider ?? provider,
      model: normalizedRequestedRef?.model,
      sessionId: params.sessionId,
    });

    if (streamTasks.length > 0) {
      await Promise.allSettled(streamTasks);
    }

    const finalText = result.payloads?.[0]?.text?.trim();
    if (finalText && !assistantStarted) {
      await emitPartial({ text: finalText });
    }

    await emitAgentEvent(params, "lifecycle", {
      phase: "end",
      startedAt,
      endedAt: Date.now(),
      aborted: false,
      status: result.status,
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await emitAgentEvent(params, "lifecycle", {
      phase: "error",
      startedAt,
      endedAt: Date.now(),
      error: message,
    });
    throw error;
  }
}
