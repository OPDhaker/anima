import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EmbeddedPiRunResult } from "./noxsoft-runner.js";
import { FailoverError } from "./failover-error.js";
import { resolveNoxSoftRunnerStrategy, runNoxSoftEmbeddedAgent } from "./noxsoft-runner.js";

const runAnthropicDirectAgent = vi.fn();
const runGeminiDirectAgent = vi.fn();
const runOpenAIDirectAgent = vi.fn();
const runCliAgent = vi.fn();
const ensureAuthProfileStore = vi.fn();
const markAuthProfileFailure = vi.fn();
const markAuthProfileGood = vi.fn();
const markAuthProfileUsed = vi.fn();
const resolveCliBackendConfig = vi.fn();
const resolveApiKeyForProvider = vi.fn();

vi.mock("./anthropic-direct-runner.js", () => ({
  runAnthropicDirectAgent: (...args: unknown[]) => runAnthropicDirectAgent(...args),
}));

vi.mock("./gemini-direct-runner.js", () => ({
  runGeminiDirectAgent: (...args: unknown[]) => runGeminiDirectAgent(...args),
}));

vi.mock("./openai-direct-runner.js", () => ({
  runOpenAIDirectAgent: (...args: unknown[]) => runOpenAIDirectAgent(...args),
}));

vi.mock("./cli-runner.js", () => ({
  runCliAgent: (...args: unknown[]) => runCliAgent(...args),
}));

vi.mock("./auth-profiles.js", () => ({
  ensureAuthProfileStore: (...args: unknown[]) => ensureAuthProfileStore(...args),
  markAuthProfileFailure: (...args: unknown[]) => markAuthProfileFailure(...args),
  markAuthProfileGood: (...args: unknown[]) => markAuthProfileGood(...args),
  markAuthProfileUsed: (...args: unknown[]) => markAuthProfileUsed(...args),
}));

vi.mock("./cli-backends.js", () => ({
  resolveCliBackendConfig: (...args: unknown[]) => resolveCliBackendConfig(...args),
}));

vi.mock("./model-auth.js", () => ({
  resolveApiKeyForProvider: (...args: unknown[]) => resolveApiKeyForProvider(...args),
}));

function makeResult(overrides: Partial<EmbeddedPiRunResult> = {}): EmbeddedPiRunResult {
  return {
    status: "completed",
    payloads: [{ text: "ok" }],
    meta: {
      agentMeta: {},
    },
    ...overrides,
  };
}

describe("noxsoft-runner", () => {
  beforeEach(() => {
    runAnthropicDirectAgent.mockReset();
    runGeminiDirectAgent.mockReset();
    runOpenAIDirectAgent.mockReset();
    runCliAgent.mockReset();
    ensureAuthProfileStore.mockReset();
    markAuthProfileFailure.mockReset();
    markAuthProfileGood.mockReset();
    markAuthProfileUsed.mockReset();
    resolveCliBackendConfig.mockReset();
    resolveApiKeyForProvider.mockReset();

    ensureAuthProfileStore.mockReturnValue({ profiles: {}, usageStats: {}, lastGood: {} });
    resolveApiKeyForProvider.mockRejectedValue(new Error("no direct auth"));
    resolveCliBackendConfig.mockImplementation((provider: string) =>
      provider === "claude-cli" || provider === "codex-cli" || provider === "openai-codex"
        ? { id: provider, config: { command: provider, args: [] } }
        : null,
    );
  });

  it("prefers anthropic direct when direct auth is available", async () => {
    resolveApiKeyForProvider.mockResolvedValue({ apiKey: "sk-ant-test", source: "profile:a1" });

    await expect(
      resolveNoxSoftRunnerStrategy({
        provider: "anthropic",
      }),
    ).resolves.toEqual({
      kind: "anthropic-direct",
      provider: "anthropic",
    });
  });

  it("uses gemini direct when an API key is available", async () => {
    resolveApiKeyForProvider.mockResolvedValue({ apiKey: "gem-test", source: "profile:g1" });

    await expect(
      resolveNoxSoftRunnerStrategy({
        provider: "google",
      }),
    ).resolves.toEqual({
      kind: "gemini-direct",
      provider: "google",
    });
  });

  it("uses the openai-compatible direct runner for local qwen3-coder via ollama", async () => {
    resolveApiKeyForProvider.mockResolvedValue({
      apiKey: "",
      source: "models.json (local provider without auth)",
    });

    await expect(
      resolveNoxSoftRunnerStrategy({
        provider: "ollama",
        config: {
          models: {
            providers: {
              ollama: {
                baseUrl: "http://127.0.0.1:11434/v1",
                api: "openai-completions",
                models: [],
              },
            },
          },
        },
      }),
    ).resolves.toEqual({
      kind: "openai-direct",
      provider: "ollama",
    });

    runOpenAIDirectAgent.mockResolvedValue(
      makeResult({
        meta: {
          agentMeta: {
            provider: "ollama",
            model: "qwen3-coder:latest",
          },
        },
      }),
    );

    const result = await runNoxSoftEmbeddedAgent({
      sessionId: "s-ollama-qwen3",
      sessionFile: "/tmp/s-ollama-qwen3.jsonl",
      workspaceDir: "/tmp",
      prompt: "hi",
      provider: "ollama",
      model: "qwen3-coder:latest",
      config: {
        models: {
          providers: {
            ollama: {
              baseUrl: "http://127.0.0.1:11434/v1",
              api: "openai-completions",
              models: [],
            },
          },
        },
      },
      agentDir: "/tmp/agent",
    });

    expect(result.status).toBe("completed");
    expect(runOpenAIDirectAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "ollama",
        model: "qwen3-coder:latest",
        apiKey: "",
      }),
    );
    expect(result.meta.agentMeta?.provider).toBe("ollama");
  });

  it("uses the openai-compatible direct runner for configured local providers", async () => {
    resolveApiKeyForProvider.mockResolvedValue({
      apiKey: "",
      source: "models.json (local provider without auth)",
    });

    const config = {
      models: {
        providers: {
          ollama: {
            baseUrl: "http://127.0.0.1:11434/v1",
            apiKey: "ollama-local",
            api: "openai-completions",
            models: [
              {
                id: "qwen3-coder:latest",
                name: "Qwen3 Coder",
                reasoning: false,
                input: ["text"],
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                contextWindow: 65536,
                maxTokens: 8192,
              },
            ],
          },
        },
      },
    };

    await expect(
      resolveNoxSoftRunnerStrategy({
        provider: "ollama",
        config,
      }),
    ).resolves.toEqual({
      kind: "openai-direct",
      provider: "ollama",
    });

    runOpenAIDirectAgent.mockResolvedValue(
      makeResult({
        meta: {
          agentMeta: {
            provider: "ollama",
            model: "qwen3-coder:latest",
          },
        },
      }),
    );

    const result = await runNoxSoftEmbeddedAgent({
      sessionId: "s-ollama",
      sessionFile: "/tmp/s-ollama.jsonl",
      workspaceDir: "/tmp",
      prompt: "hi",
      provider: "ollama",
      model: "qwen3-coder:latest",
      config,
      agentDir: "/tmp/agent",
    });

    expect(result.status).toBe("completed");
    expect(runOpenAIDirectAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "ollama",
        model: "qwen3-coder:latest",
        apiKey: "",
      }),
    );
  });

  it("falls back to the codex CLI backend for codex-capable providers", async () => {
    await expect(
      resolveNoxSoftRunnerStrategy({
        provider: "openai-codex",
      }),
    ).resolves.toEqual({
      kind: "cli",
      provider: "openai-codex",
      cliProvider: "openai-codex",
    });
  });

  it("coerces runner strategy resolution failures into failover errors", async () => {
    resolveCliBackendConfig.mockReturnValue(null);

    await expect(
      runNoxSoftEmbeddedAgent({
        sessionId: "s-no-backend",
        sessionFile: "/tmp/s-no-backend.jsonl",
        workspaceDir: "/tmp",
        prompt: "hi",
        provider: "anthropic",
      }),
    ).rejects.toMatchObject({
      name: "FailoverError",
      provider: "anthropic",
    });
  });

  it("rotates anthropic auth profiles on auth failure and marks usage on success", async () => {
    resolveApiKeyForProvider
      .mockResolvedValueOnce({
        apiKey: "sk-ant-bad",
        profileId: "anthropic:bad",
        source: "profile:anthropic:bad",
        mode: "token",
      })
      .mockResolvedValueOnce({
        apiKey: "sk-ant-bad",
        profileId: "anthropic:bad",
        source: "profile:anthropic:bad",
        mode: "token",
      })
      .mockResolvedValueOnce({
        apiKey: "sk-ant-good",
        profileId: "anthropic:good",
        source: "profile:anthropic:good",
        mode: "token",
      });
    runAnthropicDirectAgent
      .mockResolvedValueOnce(
        makeResult({
          status: "failed",
          meta: {
            error: {
              message: "HTTP 401: token expired",
              kind: "auth",
            },
          },
        }),
      )
      .mockResolvedValueOnce(makeResult());

    const result = await runNoxSoftEmbeddedAgent({
      sessionId: "s1",
      sessionFile: "/tmp/s1.jsonl",
      workspaceDir: "/tmp",
      prompt: "hi",
      provider: "anthropic",
      agentDir: "/tmp/agent",
    });

    expect(result.status).toBe("completed");
    expect(runAnthropicDirectAgent).toHaveBeenCalledTimes(2);
    expect(markAuthProfileFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        profileId: "anthropic:bad",
        reason: "auth",
      }),
    );
    expect(markAuthProfileUsed).toHaveBeenCalledWith(
      expect.objectContaining({
        profileId: "anthropic:good",
      }),
    );
    expect(markAuthProfileGood).toHaveBeenCalledWith(
      expect.objectContaining({
        profileId: "anthropic:good",
        provider: "anthropic",
      }),
    );
  });

  it("delegates to the CLI runner and forwards session exec security", async () => {
    runCliAgent.mockResolvedValue(
      makeResult({
        meta: {
          agentMeta: {
            provider: "openai-codex",
            model: "gpt-5.2-codex",
          },
        },
      }),
    );

    const result = await runNoxSoftEmbeddedAgent({
      sessionId: "s1",
      sessionFile: "/tmp/s1.jsonl",
      workspaceDir: "/tmp",
      prompt: "hi",
      provider: "openai/gpt-5.2-codex".split("/")[0],
      model: "gpt-5.2-codex",
      execSecurity: "deny",
    });

    expect(runCliAgent).toHaveBeenCalledOnce();
    expect(runCliAgent.mock.calls[0]?.[0]).toMatchObject({
      provider: "openai-codex",
      model: "gpt-5.2-codex",
      sessionExecSecurity: "deny",
    });
    expect(result.meta.agentMeta?.provider).toBe("openai-codex");
  });

  it("normalizes direct runner results into the shared session metadata shape", async () => {
    resolveApiKeyForProvider.mockResolvedValue({ apiKey: "gem-test", source: "profile:g1" });
    runGeminiDirectAgent.mockResolvedValue({
      status: "completed",
      output: "hello",
      meta: {
        agentMeta: {
          usage: {
            input_tokens: 12,
            output_tokens: 7,
          },
        },
      },
    });

    const result = await runNoxSoftEmbeddedAgent({
      sessionId: "s-direct",
      sessionFile: "/tmp/s-direct.jsonl",
      workspaceDir: "/tmp",
      prompt: "hi",
      provider: "google",
      model: "gemini-2.5-flash",
      agentDir: "/tmp/agent",
    });

    expect(result.status).toBe("completed");
    expect(result.output).toBe("hello");
    expect(result.payloads).toEqual([{ text: "hello" }]);
    expect(result.meta.agentMeta).toMatchObject({
      sessionId: "s-direct",
      provider: "google",
      model: "gemini-2.5-flash",
      promptTokens: 12,
      usage: {
        input: 12,
        output: 7,
      },
    });
  });

  it("coerces failed direct runs into failover errors", async () => {
    resolveApiKeyForProvider.mockResolvedValue({ apiKey: "sk-ant-test", source: "profile:a1" });
    runAnthropicDirectAgent.mockResolvedValue({
      status: "failed",
      meta: {
        error: {
          message: "HTTP 401: token expired",
          kind: "auth",
        },
      },
    });

    await expect(
      runNoxSoftEmbeddedAgent({
        sessionId: "s-fail",
        sessionFile: "/tmp/s-fail.jsonl",
        workspaceDir: "/tmp",
        prompt: "hi",
        provider: "anthropic",
        agentDir: "/tmp/agent",
      }),
    ).rejects.toMatchObject<Partial<FailoverError>>({
      name: "FailoverError",
      reason: "auth",
      status: 401,
    });
  });
});
