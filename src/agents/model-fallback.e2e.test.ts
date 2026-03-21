import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { AnimaConfig } from "../config/config.js";
import type { AuthProfileStore } from "./auth-profiles.js";
import { saveAuthProfileStore } from "./auth-profiles.js";
import { AUTH_STORE_VERSION } from "./auth-profiles/constants.js";
import { FailoverError } from "./failover-error.js";
import { runWithModelFallback } from "./model-fallback.js";

function makeCfg(overrides: Partial<AnimaConfig> = {}): AnimaConfig {
  return {
    agents: {
      defaults: {
        model: {
          primary: "openai/gpt-4.1-mini",
          fallbacks: ["anthropic/claude-haiku-3-5"],
        },
      },
    },
    ...overrides,
  } as AnimaConfig;
}

describe("runWithModelFallback", () => {
  it("normalizes openai gpt-5.3 codex to openai-codex before running", async () => {
    const cfg = makeCfg();
    const run = vi.fn().mockResolvedValueOnce("ok");

    const result = await runWithModelFallback({
      cfg,
      provider: "openai",
      model: "gpt-5.3-codex",
      run,
    });

    expect(result.result).toBe("ok");
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith("openai-codex", "gpt-5.3-codex");
  });

  it("does not fall back on non-auth errors", async () => {
    const cfg = makeCfg();
    const run = vi.fn().mockRejectedValueOnce(new Error("bad request")).mockResolvedValueOnce("ok");

    await expect(
      runWithModelFallback({
        cfg,
        provider: "openai",
        model: "gpt-4.1-mini",
        run,
      }),
    ).rejects.toThrow("bad request");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("falls back on auth errors", async () => {
    const cfg = makeCfg();
    const run = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("nope"), { status: 401 }))
      .mockResolvedValueOnce("ok");

    const result = await runWithModelFallback({
      cfg,
      provider: "openai",
      model: "gpt-4.1-mini",
      run,
    });

    expect(result.result).toBe("ok");
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1]?.[0]).toBe("anthropic");
    expect(run.mock.calls[1]?.[1]).toBe("claude-haiku-3-5");
  });

  it("falls back on transient HTTP 5xx errors", async () => {
    const cfg = makeCfg();
    const run = vi
      .fn()
      .mockRejectedValueOnce(
        new Error(
          "521 <!DOCTYPE html><html><head><title>Web server is down</title></head><body>Cloudflare</body></html>",
        ),
      )
      .mockResolvedValueOnce("ok");

    const result = await runWithModelFallback({
      cfg,
      provider: "openai",
      model: "gpt-4.1-mini",
      run,
    });

    expect(result.result).toBe("ok");
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1]?.[0]).toBe("anthropic");
    expect(run.mock.calls[1]?.[1]).toBe("claude-haiku-3-5");
  });

  it("falls back on 402 payment required", async () => {
    const cfg = makeCfg();
    const run = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("payment required"), { status: 402 }))
      .mockResolvedValueOnce("ok");

    const result = await runWithModelFallback({
      cfg,
      provider: "openai",
      model: "gpt-4.1-mini",
      run,
    });

    expect(result.result).toBe("ok");
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1]?.[0]).toBe("anthropic");
    expect(run.mock.calls[1]?.[1]).toBe("claude-haiku-3-5");
  });

  it("falls back on billing errors", async () => {
    const cfg = makeCfg();
    const run = vi
      .fn()
      .mockRejectedValueOnce(
        new Error(
          "LLM request rejected: Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.",
        ),
      )
      .mockResolvedValueOnce("ok");

    const result = await runWithModelFallback({
      cfg,
      provider: "openai",
      model: "gpt-4.1-mini",
      run,
    });

    expect(result.result).toBe("ok");
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1]?.[0]).toBe("anthropic");
    expect(run.mock.calls[1]?.[1]).toBe("claude-haiku-3-5");
  });

  it("falls back on credential validation errors", async () => {
    const cfg = makeCfg();
    const run = vi
      .fn()
      .mockRejectedValueOnce(new Error('No credentials found for profile "anthropic:default".'))
      .mockResolvedValueOnce("ok");

    const result = await runWithModelFallback({
      cfg,
      provider: "anthropic",
      model: "claude-opus-4",
      run,
    });

    expect(result.result).toBe("ok");
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1]?.[0]).toBe("anthropic");
    expect(run.mock.calls[1]?.[1]).toBe("claude-haiku-3-5");
  });

  it("skips providers when all profiles are in cooldown", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "anima-auth-"));
    const provider = `cooldown-test-${crypto.randomUUID()}`;
    const profileId = `${provider}:default`;

    const store: AuthProfileStore = {
      version: AUTH_STORE_VERSION,
      profiles: {
        [profileId]: {
          type: "api_key",
          provider,
          key: "test-key",
        },
      },
      usageStats: {
        [profileId]: {
          cooldownUntil: Date.now() + 60_000,
        },
      },
    };

    saveAuthProfileStore(store, tempDir);

    const cfg = makeCfg({
      agents: {
        defaults: {
          model: {
            primary: `${provider}/m1`,
            fallbacks: ["fallback/ok-model"],
          },
        },
      },
    });
    const run = vi.fn().mockImplementation(async (providerId, modelId) => {
      if (providerId === "fallback") {
        return "ok";
      }
      throw new Error(`unexpected provider: ${providerId}/${modelId}`);
    });

    try {
      const result = await runWithModelFallback({
        cfg,
        provider,
        model: "m1",
        agentDir: tempDir,
        run,
      });

      expect(result.result).toBe("ok");
      expect(run.mock.calls).toEqual([["fallback", "ok-model"]]);
      expect(result.attempts[0]?.reason).toBe("rate_limit");
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("does not skip when any profile is available", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "anima-auth-"));
    const provider = `cooldown-mixed-${crypto.randomUUID()}`;
    const profileA = `${provider}:a`;
    const profileB = `${provider}:b`;

    const store: AuthProfileStore = {
      version: AUTH_STORE_VERSION,
      profiles: {
        [profileA]: {
          type: "api_key",
          provider,
          key: "key-a",
        },
        [profileB]: {
          type: "api_key",
          provider,
          key: "key-b",
        },
      },
      usageStats: {
        [profileA]: {
          cooldownUntil: Date.now() + 60_000,
        },
      },
    };

    saveAuthProfileStore(store, tempDir);

    const cfg = makeCfg({
      agents: {
        defaults: {
          model: {
            primary: `${provider}/m1`,
            fallbacks: ["fallback/ok-model"],
          },
        },
      },
    });
    const run = vi.fn().mockImplementation(async (providerId) => {
      if (providerId === provider) {
        return "ok";
      }
      return "unexpected";
    });

    try {
      const result = await runWithModelFallback({
        cfg,
        provider,
        model: "m1",
        agentDir: tempDir,
        run,
      });

      expect(result.result).toBe("ok");
      expect(run.mock.calls).toEqual([[provider, "m1"]]);
      expect(result.attempts).toEqual([]);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("does not append configured primary when fallbacksOverride is set", async () => {
    const cfg = makeCfg({
      agents: {
        defaults: {
          model: {
            primary: "openai/gpt-4.1-mini",
          },
        },
      },
    });
    const run = vi
      .fn()
      .mockImplementation(() => Promise.reject(Object.assign(new Error("nope"), { status: 401 })));

    await expect(
      runWithModelFallback({
        cfg,
        provider: "anthropic",
        model: "claude-opus-4-5",
        fallbacksOverride: ["anthropic/claude-haiku-3-5"],
        run,
      }),
    ).rejects.toThrow("All models failed");

    expect(run.mock.calls).toEqual([
      ["anthropic", "claude-opus-4-5"],
      ["anthropic", "claude-haiku-3-5"],
    ]);
  });

  it("uses fallbacksOverride instead of agents.defaults.model.fallbacks", async () => {
    const cfg = {
      agents: {
        defaults: {
          model: {
            fallbacks: ["openai/gpt-5.2"],
          },
        },
      },
    } as AnimaConfig;

    const calls: Array<{ provider: string; model: string }> = [];

    const res = await runWithModelFallback({
      cfg,
      provider: "anthropic",
      model: "claude-opus-4-5",
      fallbacksOverride: ["openai/gpt-4.1"],
      run: async (provider, model) => {
        calls.push({ provider, model });
        if (provider === "anthropic") {
          throw Object.assign(new Error("nope"), { status: 401 });
        }
        if (provider === "openai" && model === "gpt-4.1") {
          return "ok";
        }
        throw new Error(`unexpected candidate: ${provider}/${model}`);
      },
    });

    expect(res.result).toBe("ok");
    expect(calls).toEqual([
      { provider: "anthropic", model: "claude-opus-4-5" },
      { provider: "openai", model: "gpt-4.1" },
    ]);
  });

  it("treats an empty fallbacksOverride as disabling global fallbacks", async () => {
    const cfg = {
      agents: {
        defaults: {
          model: {
            fallbacks: ["openai/gpt-5.2"],
          },
        },
      },
    } as AnimaConfig;

    const calls: Array<{ provider: string; model: string }> = [];

    await expect(
      runWithModelFallback({
        cfg,
        provider: "anthropic",
        model: "claude-opus-4-5",
        fallbacksOverride: [],
        run: async (provider, model) => {
          calls.push({ provider, model });
          throw new Error("primary failed");
        },
      }),
    ).rejects.toThrow("primary failed");

    expect(calls).toEqual([{ provider: "anthropic", model: "claude-opus-4-5" }]);
  });

  it("defaults provider/model when missing (regression #946)", async () => {
    const cfg = makeCfg({
      agents: {
        defaults: {
          model: {
            primary: "openai/gpt-4.1-mini",
            fallbacks: [],
          },
        },
      },
    });

    const calls: Array<{ provider: string; model: string }> = [];

    const result = await runWithModelFallback({
      cfg,
      provider: undefined as unknown as string,
      model: undefined as unknown as string,
      run: async (provider, model) => {
        calls.push({ provider, model });
        return "ok";
      },
    });

    expect(result.result).toBe("ok");
    expect(calls).toEqual([{ provider: "openai", model: "gpt-4.1-mini" }]);
  });

  it("falls back on missing API key errors", async () => {
    const cfg = makeCfg();
    const run = vi
      .fn()
      .mockRejectedValueOnce(new Error("No API key found for profile openai."))
      .mockResolvedValueOnce("ok");

    const result = await runWithModelFallback({
      cfg,
      provider: "openai",
      model: "gpt-4.1-mini",
      run,
    });

    expect(result.result).toBe("ok");
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1]?.[0]).toBe("anthropic");
    expect(run.mock.calls[1]?.[1]).toBe("claude-haiku-3-5");
  });

  it("falls back on lowercase credential errors", async () => {
    const cfg = makeCfg();
    const run = vi
      .fn()
      .mockRejectedValueOnce(new Error("no api key found for profile openai"))
      .mockResolvedValueOnce("ok");

    const result = await runWithModelFallback({
      cfg,
      provider: "openai",
      model: "gpt-4.1-mini",
      run,
    });

    expect(result.result).toBe("ok");
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1]?.[0]).toBe("anthropic");
    expect(run.mock.calls[1]?.[1]).toBe("claude-haiku-3-5");
  });

  it("falls back on timeout abort errors", async () => {
    const cfg = makeCfg();
    const timeoutCause = Object.assign(new Error("request timed out"), { name: "TimeoutError" });
    const run = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error("aborted"), { name: "AbortError", cause: timeoutCause }),
      )
      .mockResolvedValueOnce("ok");

    const result = await runWithModelFallback({
      cfg,
      provider: "openai",
      model: "gpt-4.1-mini",
      run,
    });

    expect(result.result).toBe("ok");
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1]?.[0]).toBe("anthropic");
    expect(run.mock.calls[1]?.[1]).toBe("claude-haiku-3-5");
  });

  it("falls back on abort errors with timeout reasons", async () => {
    const cfg = makeCfg();
    const run = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error("aborted"), { name: "AbortError", reason: "deadline exceeded" }),
      )
      .mockResolvedValueOnce("ok");

    const result = await runWithModelFallback({
      cfg,
      provider: "openai",
      model: "gpt-4.1-mini",
      run,
    });

    expect(result.result).toBe("ok");
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1]?.[0]).toBe("anthropic");
    expect(run.mock.calls[1]?.[1]).toBe("claude-haiku-3-5");
  });

  it("falls back when message says aborted but error is a timeout", async () => {
    const cfg = makeCfg();
    const run = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("request aborted"), { code: "ETIMEDOUT" }))
      .mockResolvedValueOnce("ok");

    const result = await runWithModelFallback({
      cfg,
      provider: "openai",
      model: "gpt-4.1-mini",
      run,
    });

    expect(result.result).toBe("ok");
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1]?.[0]).toBe("anthropic");
    expect(run.mock.calls[1]?.[1]).toBe("claude-haiku-3-5");
  });

  it("falls back on provider abort errors with request-aborted messages", async () => {
    const cfg = makeCfg();
    const run = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error("Request was aborted"), { name: "AbortError" }),
      )
      .mockResolvedValueOnce("ok");

    const result = await runWithModelFallback({
      cfg,
      provider: "openai",
      model: "gpt-4.1-mini",
      run,
    });

    expect(result.result).toBe("ok");
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1]?.[0]).toBe("anthropic");
    expect(run.mock.calls[1]?.[1]).toBe("claude-haiku-3-5");
  });

  it("does not fall back on user aborts", async () => {
    const cfg = makeCfg();
    const run = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("aborted"), { name: "AbortError" }))
      .mockResolvedValueOnce("ok");

    await expect(
      runWithModelFallback({
        cfg,
        provider: "openai",
        model: "gpt-4.1-mini",
        run,
      }),
    ).rejects.toThrow("aborted");

    expect(run).toHaveBeenCalledTimes(1);
  });

  it("appends the configured primary as a last fallback", async () => {
    const cfg = makeCfg({
      agents: {
        defaults: {
          model: {
            primary: "openai/gpt-4.1-mini",
            fallbacks: [],
          },
        },
      },
    });
    const run = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }))
      .mockResolvedValueOnce("ok");

    const result = await runWithModelFallback({
      cfg,
      provider: "openrouter",
      model: "meta-llama/llama-3.3-70b:free",
      run,
    });

    expect(result.result).toBe("ok");
    expect(run).toHaveBeenCalledTimes(2);
    expect(result.provider).toBe("openai");
    expect(result.model).toBe("gpt-4.1-mini");
  });

  it("adds codex then minimax as implicit backups for anthropic runs", async () => {
    const cfg = makeCfg({
      agents: {
        defaults: {
          model: {
            primary: "anthropic/claude-opus-4-6",
            fallbacks: [],
          },
        },
      },
    });
    const calls: Array<{ provider: string; model: string }> = [];
    const run = vi
      .fn()
      .mockImplementationOnce(async (provider: string, model: string) => {
        calls.push({ provider, model });
        throw new FailoverError("anthropic unavailable", {
          reason: "auth",
          provider,
          model,
          status: 401,
        });
      })
      .mockImplementationOnce(async (provider: string, model: string) => {
        calls.push({ provider, model });
        throw new FailoverError("codex unavailable", {
          reason: "auth",
          provider,
          model,
          status: 401,
        });
      })
      .mockImplementationOnce(async (provider: string, model: string) => {
        calls.push({ provider, model });
        return "ok";
      });

    const result = await runWithModelFallback({
      cfg,
      provider: "anthropic",
      model: "claude-opus-4-6",
      run,
    });

    expect(result.result).toBe("ok");
    expect(calls).toEqual([
      { provider: "anthropic", model: "claude-opus-4-6" },
      { provider: "openai-codex", model: "gpt-5.2-codex" },
      { provider: "ollama", model: "qwen3-coder:latest" },
    ]);
    expect(result.provider).toBe("ollama");
    expect(result.model).toBe("qwen3-coder:latest");
  });

  it("prefers configured local qwen3-coder fallbacks before custom local wrappers", async () => {
    const cfg = makeCfg({
      agents: {
        defaults: {
          model: {
            primary: "anthropic/claude-opus-4-6",
            fallbacks: [],
          },
        },
      },
      models: {
        providers: {
          ollama: {
            baseUrl: "http://127.0.0.1:11434/v1",
            api: "openai-completions",
            apiKey: "ollama-local",
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
    });
    const calls: Array<{ provider: string; model: string }> = [];
    const run = vi
      .fn()
      .mockImplementationOnce(async (provider: string, model: string) => {
        calls.push({ provider, model });
        throw new FailoverError("anthropic unavailable", {
          reason: "auth",
          provider,
          model,
          status: 401,
        });
      })
      .mockImplementationOnce(async (provider: string, model: string) => {
        calls.push({ provider, model });
        throw new FailoverError("codex unavailable", {
          reason: "auth",
          provider,
          model,
          status: 401,
        });
      })
      .mockImplementationOnce(async (provider: string, model: string) => {
        calls.push({ provider, model });
        return "ok";
      });

    const result = await runWithModelFallback({
      cfg,
      provider: "anthropic",
      model: "claude-opus-4-6",
      run,
    });

    expect(result.result).toBe("ok");
    expect(calls).toEqual([
      { provider: "anthropic", model: "claude-opus-4-6" },
      { provider: "openai-codex", model: "gpt-5.2-codex" },
      { provider: "ollama", model: "qwen3-coder:latest" },
    ]);
    expect(result.provider).toBe("ollama");
    expect(result.model).toBe("qwen3-coder:latest");
  });

  it("prefers the working-mode model when the session is in write mode", async () => {
    const cfg = makeCfg({
      agents: {
        defaults: {
          model: {
            primary: "anthropic/claude-opus-4-6",
            auto: {
              enabled: true,
              byWorkingMode: {
                write: ["openai-codex/gpt-5.3-codex"],
              },
            },
          },
        },
      },
    });
    const calls: Array<{ provider: string; model: string }> = [];

    const result = await runWithModelFallback({
      cfg,
      provider: "anthropic",
      model: "claude-opus-4-6",
      sessionEntry: {
        execSecurity: "full",
      },
      run: async (provider, model) => {
        calls.push({ provider, model });
        return "ok";
      },
    });

    expect(result.result).toBe("ok");
    expect(calls).toEqual([{ provider: "openai-codex", model: "gpt-5.3-codex" }]);
  });

  it("preserves explicit session overrides ahead of working-mode defaults", async () => {
    const cfg = makeCfg({
      agents: {
        defaults: {
          model: {
            primary: "anthropic/claude-opus-4-6",
            auto: {
              enabled: true,
              byWorkingMode: {
                write: ["openai-codex/gpt-5.3-codex"],
              },
            },
            fallbacks: ["openai/gpt-4.1-mini"],
          },
        },
      },
    });
    const calls: Array<{ provider: string; model: string }> = [];

    const result = await runWithModelFallback({
      cfg,
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      sessionEntry: {
        execSecurity: "full",
        providerOverride: "anthropic",
        modelOverride: "claude-sonnet-4-5",
      },
      run: async (provider, model) => {
        calls.push({ provider, model });
        return "ok";
      },
    });

    expect(result.result).toBe("ok");
    expect(calls).toEqual([{ provider: "anthropic", model: "claude-sonnet-4-5" }]);
  });

  it("prefers cheaper configured candidates for heavy sessions", async () => {
    const cfg = {
      agents: {
        defaults: {
          model: {
            primary: "openai/expensive",
            fallbacks: ["openai/cheap"],
          },
        },
      },
      models: {
        providers: {
          openai: {
            baseUrl: "https://api.openai.com/v1",
            models: [
              {
                id: "cheap",
                name: "Cheap",
                reasoning: true,
                input: ["text"],
                cost: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0 },
                contextWindow: 128_000,
                maxTokens: 8_192,
              },
              {
                id: "expensive",
                name: "Expensive",
                reasoning: true,
                input: ["text"],
                cost: { input: 5, output: 15, cacheRead: 0, cacheWrite: 0 },
                contextWindow: 128_000,
                maxTokens: 8_192,
              },
            ],
          },
        },
      },
    } as unknown as AnimaConfig;
    const calls: Array<{ provider: string; model: string }> = [];

    const result = await runWithModelFallback({
      cfg,
      provider: "openai",
      model: "expensive",
      thinkLevel: "low",
      sessionEntry: {
        sessionEstimatedCostUsdTotal: 0.75,
      },
      run: async (provider, model) => {
        calls.push({ provider, model });
        return "ok";
      },
    });

    expect(result.result).toBe("ok");
    expect(calls).toEqual([{ provider: "openai", model: "cheap" }]);
  });
});
