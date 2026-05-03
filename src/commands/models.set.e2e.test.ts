import { beforeEach, describe, expect, it, vi } from "vitest";

const readConfigFileSnapshot = vi.fn();
const writeConfigFile = vi.fn().mockResolvedValue(undefined);
const loadConfig = vi.fn().mockReturnValue({});
const ensureLocalOllamaModelInstalled = vi.fn().mockResolvedValue({
  installed: true,
  pulled: false,
});

vi.mock("../config/config.js", () => ({
  CONFIG_PATH: "/tmp/anima.json",
  readConfigFileSnapshot,
  writeConfigFile,
  loadConfig,
}));

vi.mock("../agents/local-model-installer.js", () => ({
  DEFAULT_LOCAL_OLLAMA_MODEL: "qwen3-coder:latest",
  ensureLocalOllamaModelInstalled: (...args: unknown[]) => ensureLocalOllamaModelInstalled(...args),
}));

describe("models set + fallbacks", () => {
  beforeEach(() => {
    readConfigFileSnapshot.mockReset();
    writeConfigFile.mockClear();
    ensureLocalOllamaModelInstalled.mockClear();
  });

  it("normalizes z.ai provider in models set", async () => {
    readConfigFileSnapshot.mockResolvedValue({
      path: "/tmp/anima.json",
      exists: true,
      raw: "{}",
      parsed: {},
      valid: true,
      config: {},
      issues: [],
      legacyIssues: [],
    });

    const runtime = { log: vi.fn(), error: vi.fn(), exit: vi.fn() };
    const { modelsSetCommand } = await import("./models/set.js");

    await modelsSetCommand("z.ai/glm-4.7", runtime);

    expect(writeConfigFile).toHaveBeenCalledTimes(1);
    const written = writeConfigFile.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(written.agents).toEqual({
      defaults: {
        model: { primary: "zai/glm-4.7" },
        models: { "zai/glm-4.7": {} },
      },
    });
  });

  it("normalizes z-ai provider in models fallbacks add", async () => {
    readConfigFileSnapshot.mockResolvedValue({
      path: "/tmp/anima.json",
      exists: true,
      raw: "{}",
      parsed: {},
      valid: true,
      config: { agents: { defaults: { model: { fallbacks: [] } } } },
      issues: [],
      legacyIssues: [],
    });

    const runtime = { log: vi.fn(), error: vi.fn(), exit: vi.fn() };
    const { modelsFallbacksAddCommand } = await import("./models/fallbacks.js");

    await modelsFallbacksAddCommand("z-ai/glm-4.7", runtime);

    expect(writeConfigFile).toHaveBeenCalledTimes(1);
    const written = writeConfigFile.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(written.agents).toEqual({
      defaults: {
        model: { fallbacks: ["zai/glm-4.7"] },
        models: { "zai/glm-4.7": {} },
      },
    });
  });

  it("normalizes provider casing in models set", async () => {
    readConfigFileSnapshot.mockResolvedValue({
      path: "/tmp/anima.json",
      exists: true,
      raw: "{}",
      parsed: {},
      valid: true,
      config: {},
      issues: [],
      legacyIssues: [],
    });

    const runtime = { log: vi.fn(), error: vi.fn(), exit: vi.fn() };
    const { modelsSetCommand } = await import("./models/set.js");

    await modelsSetCommand("Z.AI/glm-4.7", runtime);

    expect(writeConfigFile).toHaveBeenCalledTimes(1);
    const written = writeConfigFile.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(written.agents).toEqual({
      defaults: {
        model: { primary: "zai/glm-4.7" },
        models: { "zai/glm-4.7": {} },
      },
    });
  });

  it("installs qwen3-coder when set as the default local model", async () => {
    readConfigFileSnapshot.mockResolvedValue({
      path: "/tmp/anima.json",
      exists: true,
      raw: "{}",
      parsed: {},
      valid: true,
      config: {},
      issues: [],
      legacyIssues: [],
    });

    const runtime = { log: vi.fn(), error: vi.fn(), exit: vi.fn() };
    const { modelsSetCommand } = await import("./models/set.js");

    await modelsSetCommand("ollama/qwen3-coder:latest", runtime);

    expect(ensureLocalOllamaModelInstalled).toHaveBeenCalledWith({
      model: "qwen3-coder:latest",
      runtime,
    });
  });

  it("installs qwen3-coder when added as a fallback", async () => {
    readConfigFileSnapshot.mockResolvedValue({
      path: "/tmp/anima.json",
      exists: true,
      raw: "{}",
      parsed: {},
      valid: true,
      config: { agents: { defaults: { model: { fallbacks: [] } } } },
      issues: [],
      legacyIssues: [],
    });

    const runtime = { log: vi.fn(), error: vi.fn(), exit: vi.fn() };
    const { modelsFallbacksAddCommand } = await import("./models/fallbacks.js");

    await modelsFallbacksAddCommand("ollama/qwen3-coder:latest", runtime);

    expect(ensureLocalOllamaModelInstalled).toHaveBeenCalledWith({
      model: "qwen3-coder:latest",
      runtime,
    });
  });
});
