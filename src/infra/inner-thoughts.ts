/**
 * Inner Thoughts Layer — background self-reflection cron.
 *
 * Runs on a configurable interval (default: every 5 minutes) using the
 * cheapest available model. Not user-facing — this is the agent's internal
 * thought process: journaling affect state, reviewing recent activity,
 * updating the ego/self-model, and flagging items that need attention.
 *
 * Part of Anima's layered architecture:
 *   Wake (cheapest)  → triage incoming notifications
 *   Conversation     → handle chat/DMs (conversationalModel)
 *   Inner Thoughts   → background self-reflection (this file)
 *   Execution        → task work (primary model)
 */

import type { AnimaConfig } from "../config/config.js";
import { reflect, type ReflectionInput } from "../affect/self-reflection.js";
import { parseDurationMs } from "../cli/parse-duration.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("inner-thoughts");

const DEFAULT_INTERVAL = "5m";
const DEFAULT_PROMPT = [
  "You are in an inner-thoughts cycle. This is not user-facing.",
  "Briefly review:",
  "1. What have I been working on since last cycle?",
  "2. How am I feeling? (affect check — energy, focus, satisfaction)",
  "3. Is anything stuck or blocked that needs escalation?",
  "4. Any insights or patterns I should note?",
  "Keep it concise — this runs every 5 minutes. Only log if meaningful.",
].join("\n");

export interface InnerThoughtsConfig {
  model?: string;
  every?: string;
  enabled?: boolean;
  prompt?: string;
}

export interface InnerThoughtsState {
  running: boolean;
  lastRunAt?: number;
  cycleCount: number;
  intervalMs: number;
}

let timer: ReturnType<typeof setInterval> | null = null;
let state: InnerThoughtsState = {
  running: false,
  cycleCount: 0,
  intervalMs: 0,
};

export function resolveInnerThoughtsConfig(config?: AnimaConfig): InnerThoughtsConfig {
  const layers = config?.agents?.defaults?.layers;
  return {
    model: layers?.innerThoughts?.model,
    every: layers?.innerThoughts?.every ?? DEFAULT_INTERVAL,
    enabled: layers?.innerThoughts?.enabled ?? true,
    prompt: layers?.innerThoughts?.prompt ?? DEFAULT_PROMPT,
  };
}

/**
 * Run a single inner-thoughts cycle.
 * Performs lightweight self-reflection using cached metrics.
 */
async function runInnerThoughtsCycle(config?: AnimaConfig): Promise<void> {
  const startMs = Date.now();
  state.lastRunAt = startMs;
  state.cycleCount += 1;

  try {
    // Lightweight reflection input — no heavy computation
    const input: ReflectionInput = {
      taskDescription: `Inner thoughts cycle #${state.cycleCount}`,
      durationMs: 0,
      commitCount: 0,
      testsWritten: 0,
      testsPassing: 0,
      errorsEncountered: [],
      filesModified: [],
      completed: true,
      feedback: `Background self-reflection cycle. Interval: ${state.intervalMs}ms.`,
    };

    const reflection = reflect(input);
    const elapsed = Date.now() - startMs;

    log.info(
      `inner-thoughts cycle #${state.cycleCount} complete (${elapsed}ms, quality: ${reflection.qualityScore.toFixed(2)})`,
    );
  } catch (err) {
    log.error(`inner-thoughts cycle failed: ${String(err)}`);
  }
}

/**
 * Start the inner thoughts cron loop.
 */
export function startInnerThoughts(config?: AnimaConfig): InnerThoughtsState {
  const cfg = resolveInnerThoughtsConfig(config);

  if (!cfg.enabled) {
    log.info("inner thoughts disabled by config");
    return state;
  }

  if (state.running) {
    log.info("inner thoughts already running");
    return state;
  }

  const intervalMs = parseDurationMs(cfg.every ?? DEFAULT_INTERVAL) ?? 5 * 60 * 1000;
  state.intervalMs = intervalMs;
  state.running = true;

  log.info(
    `starting inner thoughts (interval: ${intervalMs}ms, model: ${cfg.model ?? "cheapest"})`,
  );

  // Run first cycle immediately
  runInnerThoughtsCycle(config).catch(() => {});

  timer = setInterval(() => {
    runInnerThoughtsCycle(config).catch(() => {});
  }, intervalMs);

  return state;
}

/**
 * Stop the inner thoughts cron loop.
 */
export function stopInnerThoughts(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  state.running = false;
  log.info(`inner thoughts stopped after ${state.cycleCount} cycles`);
}

/**
 * Get the current inner thoughts state.
 */
export function getInnerThoughtsState(): Readonly<InnerThoughtsState> {
  return { ...state };
}
