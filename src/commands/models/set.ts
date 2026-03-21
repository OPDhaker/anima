import type { RuntimeEnv } from "../../runtime.js";
import {
  DEFAULT_LOCAL_OLLAMA_MODEL,
  ensureLocalOllamaModelInstalled,
} from "../../agents/local-model-installer.js";
import { logConfigUpdated } from "../../config/logging.js";
import { resolveModelTarget, updateConfig } from "./shared.js";

export async function modelsSetCommand(modelRaw: string, runtime: RuntimeEnv) {
  const resolvedTarget = await (async () => {
    let resolved:
      | {
          provider: string;
          model: string;
        }
      | undefined;
    const updated = await updateConfig((cfg) => {
      resolved = resolveModelTarget({ raw: modelRaw, cfg });
      const key = `${resolved.provider}/${resolved.model}`;
      const nextModels = { ...cfg.agents?.defaults?.models };
      if (!nextModels[key]) {
        nextModels[key] = {};
      }
      const existingModel = cfg.agents?.defaults?.model as
        | { primary?: string; fallbacks?: string[] }
        | undefined;
      return {
        ...cfg,
        agents: {
          ...cfg.agents,
          defaults: {
            ...cfg.agents?.defaults,
            model: {
              ...(existingModel?.fallbacks ? { fallbacks: existingModel.fallbacks } : undefined),
              primary: key,
            },
            models: nextModels,
          },
        },
      };
    });
    return { updated, resolved: resolved! };
  })();

  if (
    resolvedTarget.resolved.provider === "ollama" &&
    resolvedTarget.resolved.model === DEFAULT_LOCAL_OLLAMA_MODEL
  ) {
    await ensureLocalOllamaModelInstalled({ model: resolvedTarget.resolved.model, runtime });
  }

  logConfigUpdated(runtime);
  runtime.log(
    `Default model: ${resolvedTarget.updated.agents?.defaults?.model?.primary ?? modelRaw}`,
  );
}
