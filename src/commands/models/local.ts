import type { RuntimeEnv } from "../../runtime.js";
import {
  DEFAULT_LOCAL_OLLAMA_MODEL,
  ensureLocalOllamaModelInstalled,
} from "../../agents/local-model-installer.js";

export async function modelsLocalInstallCommand(
  opts: { model?: string; json?: boolean } | undefined,
  runtime: RuntimeEnv,
) {
  const model = opts?.model?.trim() || DEFAULT_LOCAL_OLLAMA_MODEL;
  const result = await ensureLocalOllamaModelInstalled({ model, runtime });

  if (opts?.json) {
    runtime.log(
      JSON.stringify({ ok: true, model, installed: result.installed, pulled: result.pulled }),
    );
    return;
  }

  runtime.log(
    result.pulled
      ? `Installed local Ollama model: ${model}`
      : `Local Ollama model already installed: ${model}`,
  );
}
