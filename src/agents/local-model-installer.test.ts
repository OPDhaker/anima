import { beforeEach, describe, expect, it, vi } from "vitest";

const runExec = vi.fn();
const runCommandWithTimeout = vi.fn();

vi.mock("../process/exec.js", () => ({
  runExec: (...args: unknown[]) => runExec(...args),
  runCommandWithTimeout: (...args: unknown[]) => runCommandWithTimeout(...args),
}));

describe("local-model-installer", () => {
  beforeEach(() => {
    runExec.mockReset();
    runCommandWithTimeout.mockReset();
  });

  it("does nothing when qwen3-coder is already installed", async () => {
    runExec.mockResolvedValue({ stdout: "", stderr: "" });

    const { ensureLocalOllamaModelInstalled } = await import("./local-model-installer.js");
    const runtime = { log: vi.fn(), error: vi.fn(), exit: vi.fn() };

    const result = await ensureLocalOllamaModelInstalled({ runtime });

    expect(result).toEqual({ installed: true, pulled: false });
    expect(runExec).toHaveBeenCalledWith("ollama", ["list"], 10_000);
    expect(runExec).toHaveBeenCalledWith("ollama", ["show", "qwen3-coder:latest"], 10_000);
    expect(runCommandWithTimeout).not.toHaveBeenCalled();
  });

  it("pulls qwen3-coder when missing", async () => {
    runExec
      .mockResolvedValueOnce({ stdout: "", stderr: "" })
      .mockRejectedValueOnce(new Error("missing"))
      .mockResolvedValueOnce({ stdout: "", stderr: "" });
    runCommandWithTimeout.mockResolvedValue({
      stdout: "ok",
      stderr: "",
      code: 0,
      signal: null,
      killed: false,
    });

    const { ensureLocalOllamaModelInstalled } = await import("./local-model-installer.js");
    const runtime = { log: vi.fn(), error: vi.fn(), exit: vi.fn() };

    const result = await ensureLocalOllamaModelInstalled({ runtime });

    expect(result).toEqual({ installed: true, pulled: true });
    expect(runCommandWithTimeout).toHaveBeenCalledWith(["ollama", "pull", "qwen3-coder:latest"], {
      timeoutMs: 7_200_000,
    });
    expect(runtime.log).toHaveBeenCalledWith(
      "Installing local model via Ollama: qwen3-coder:latest",
    );
    expect(runtime.log).toHaveBeenCalledWith("Local model ready: qwen3-coder:latest");
  });
});
