import { beforeEach, describe, expect, it, vi } from "vitest";

const ensureLocalOllamaModelInstalled = vi.fn();

vi.mock("../../agents/local-model-installer.js", () => ({
  DEFAULT_LOCAL_OLLAMA_MODEL: "qwen3-coder:latest",
  ensureLocalOllamaModelInstalled: (...args: unknown[]) => ensureLocalOllamaModelInstalled(...args),
}));

describe("modelsLocalInstallCommand", () => {
  beforeEach(() => {
    ensureLocalOllamaModelInstalled.mockReset();
  });

  it("installs the default local qwen model", async () => {
    ensureLocalOllamaModelInstalled.mockResolvedValue({ installed: true, pulled: true });
    const runtime = { log: vi.fn(), error: vi.fn(), exit: vi.fn() };
    const { modelsLocalInstallCommand } = await import("./local.js");

    await modelsLocalInstallCommand({}, runtime);

    expect(ensureLocalOllamaModelInstalled).toHaveBeenCalledWith({
      model: "qwen3-coder:latest",
      runtime,
    });
    expect(runtime.log).toHaveBeenCalledWith("Installed local Ollama model: qwen3-coder:latest");
  });

  it("supports json output", async () => {
    ensureLocalOllamaModelInstalled.mockResolvedValue({ installed: true, pulled: false });
    const runtime = { log: vi.fn(), error: vi.fn(), exit: vi.fn() };
    const { modelsLocalInstallCommand } = await import("./local.js");

    await modelsLocalInstallCommand({ json: true }, runtime);

    expect(runtime.log).toHaveBeenCalledWith(
      JSON.stringify({
        ok: true,
        model: "qwen3-coder:latest",
        installed: true,
        pulled: false,
      }),
    );
  });
});
