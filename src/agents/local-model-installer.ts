import type { RuntimeEnv } from "../runtime.js";
import { runCommandWithTimeout, runExec } from "../process/exec.js";
import { createNonExitingRuntime } from "../runtime.js";

export const DEFAULT_LOCAL_OLLAMA_MODEL = "qwen3-coder:latest";

const installPromises = new Map<string, Promise<{ installed: boolean; pulled: boolean }>>();

function createInstallerError(message: string, cause?: unknown): Error {
  const err = new Error(message);
  if (cause !== undefined) {
    (err as Error & { cause?: unknown }).cause = cause;
  }
  return err;
}

export async function isOllamaModelInstalled(model = DEFAULT_LOCAL_OLLAMA_MODEL): Promise<boolean> {
  try {
    await runExec("ollama", ["show", model], 10_000);
    return true;
  } catch {
    return false;
  }
}

export async function ensureLocalOllamaModelInstalled(params?: {
  model?: string;
  runtime?: RuntimeEnv;
  timeoutMs?: number;
}): Promise<{ installed: boolean; pulled: boolean }> {
  const model = params?.model?.trim() || DEFAULT_LOCAL_OLLAMA_MODEL;
  const timeoutMs = params?.timeoutMs ?? 7_200_000;
  const runtime = params?.runtime ?? createNonExitingRuntime();

  const existing = installPromises.get(model);
  if (existing) {
    return await existing;
  }

  const promise = (async () => {
    try {
      await runExec("ollama", ["list"], 10_000);
    } catch (error) {
      throw createInstallerError(
        "Ollama is required but no local Ollama server is reachable. Start Ollama and retry.",
        error,
      );
    }

    if (await isOllamaModelInstalled(model)) {
      return { installed: true, pulled: false };
    }

    runtime.log(`Installing local model via Ollama: ${model}`);
    const result = await runCommandWithTimeout(["ollama", "pull", model], {
      timeoutMs,
    });
    if (result.code !== 0) {
      const detail = (result.stderr || result.stdout).trim();
      throw createInstallerError(
        `Failed to install local Ollama model "${model}".${detail ? ` ${detail}` : ""}`,
      );
    }

    if (!(await isOllamaModelInstalled(model))) {
      throw createInstallerError(`Ollama reported success, but model "${model}" is still missing.`);
    }

    runtime.log(`Local model ready: ${model}`);
    return { installed: true, pulled: true };
  })();

  installPromises.set(model, promise);
  try {
    return await promise;
  } finally {
    installPromises.delete(model);
  }
}
