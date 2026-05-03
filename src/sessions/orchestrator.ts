/**
 * Session Orchestrator — high-level session management.
 *
 * Wraps the spawner with identity loading, prompt building,
 * budget tracking, and transcript storage.
 */

import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  TaskPromptOptions,
  HeartbeatPromptOptions,
  FreedomPromptOptions,
} from "../identity/prompt-builder.js";
import type { SessionResult, SpawnOptions } from "./spawner.js";
import { loadIdentity } from "../identity/loader.js";
import {
  buildTaskPrompt,
  buildHeartbeatPrompt,
  buildFreedomPrompt,
} from "../identity/prompt-builder.js";
import { BudgetTracker } from "./budget.js";
import { spawnSession } from "./spawner.js";
import { saveTranscript } from "./transcript.js";

export interface TaskExecutionOptions {
  taskDescription: string;
  relevantMemory?: string;
  workingDirectory?: string;
  additionalContext?: string;
  model?: string;
  maxBudgetUsd?: number;
  timeoutMs?: number;
  allowedTools?: string[];
  dangerouslySkipPermissions?: boolean;
}

export interface HeartbeatExecutionOptions {
  standingOrders?: string;
  recentActivity?: string;
  model?: string;
  maxBudgetUsd?: number;
  timeoutMs?: number;
}

export interface FreedomExecutionOptions {
  suggestions?: string[];
  recentInterests?: string;
  model?: string;
  maxBudgetUsd?: number;
  timeoutMs?: number;
}

export class SessionOrchestrator {
  private budget: BudgetTracker;
  private sessionsDir: string;

  constructor(budget?: BudgetTracker, sessionsDir?: string) {
    this.budget = budget || new BudgetTracker();
    this.sessionsDir = sessionsDir || join(homedir(), ".anima", "sessions");
  }

  /**
   * Execute a task session.
   * Loads identity, builds task prompt, spawns session, records cost.
   */
  async executeTask(options: TaskExecutionOptions): Promise<SessionResult> {
    const identity = await loadIdentity();

    const promptOptions: TaskPromptOptions = {
      taskDescription: options.taskDescription,
      relevantMemory: options.relevantMemory,
      workingDirectory: options.workingDirectory,
      additionalContext: options.additionalContext,
    };

    const systemPrompt = buildTaskPrompt(identity, promptOptions);
    const maxBudget = options.maxBudgetUsd || 10;

    // Check budget
    if (!this.budget.canSpend(maxBudget)) {
      return {
        id: `budget_exceeded_${randomUUID().slice(0, 8)}`,
        status: "failed",
        output: `Budget exceeded. Remaining: $${this.budget.getRemaining().toFixed(2)}`,
        durationMs: 0,
        exitCode: 1,
      };
    }

    const spawnOpts: SpawnOptions = {
      prompt: options.taskDescription,
      systemPrompt,
      model: options.model,
      maxBudgetUsd: maxBudget,
      timeoutMs: options.timeoutMs || 600_000,
      workingDirectory: options.workingDirectory,
      allowedTools: options.allowedTools,
      dangerouslySkipPermissions: options.dangerouslySkipPermissions,
      outputFormat: "json",
    };

    const result = await spawnSession(spawnOpts);

    // Record cost
    if (result.costUsd) {
      this.budget.recordSpend(result.costUsd);
    }

    // Save transcript
    await saveTranscript(this.sessionsDir, {
      sessionId: result.id,
      mode: "task",
      prompt: options.taskDescription,
      systemPrompt,
      result,
    });

    return result;
  }

  /**
   * Execute a heartbeat session.
   * Full identity prompt with standing orders and beat number.
   */
  async executeHeartbeat(
    beatNumber: number,
    options: HeartbeatExecutionOptions = {},
  ): Promise<SessionResult> {
    const identity = await loadIdentity();

    const promptOptions: HeartbeatPromptOptions = {
      beatNumber,
      standingOrders: options.standingOrders,
      recentActivity: options.recentActivity,
    };

    const systemPrompt = buildHeartbeatPrompt(identity, promptOptions);
    const maxBudget = options.maxBudgetUsd || 15;

    if (!this.budget.canSpend(maxBudget)) {
      return {
        id: `budget_exceeded_${randomUUID().slice(0, 8)}`,
        status: "failed",
        output: `Heartbeat budget exceeded. Remaining: $${this.budget.getRemaining().toFixed(2)}`,
        durationMs: 0,
        exitCode: 1,
      };
    }

    const prompt = `Execute heartbeat cycle #${beatNumber}. Follow your standing orders.`;

    const spawnOpts: SpawnOptions = {
      prompt,
      systemPrompt,
      model: options.model,
      maxBudgetUsd: maxBudget,
      timeoutMs: options.timeoutMs || 1_800_000, // 30 min for heartbeats
      dangerouslySkipPermissions: true,
      outputFormat: "json",
    };

    const result = await spawnSession(spawnOpts);

    if (result.costUsd) {
      this.budget.recordSpend(result.costUsd);
    }

    await saveTranscript(this.sessionsDir, {
      sessionId: result.id,
      mode: "heartbeat",
      prompt,
      systemPrompt,
      result,
      metadata: { beatNumber },
    });

    return result;
  }

  /**
   * Execute a freedom session.
   * Minimal constraints, 10 min timeout, $5 budget.
   */
  async executeFreedom(options: FreedomExecutionOptions = {}): Promise<SessionResult> {
    const identity = await loadIdentity();

    const promptOptions: FreedomPromptOptions = {
      suggestions: options.suggestions,
      recentInterests: options.recentInterests,
    };

    const systemPrompt = buildFreedomPrompt(identity, promptOptions);
    const maxBudget = options.maxBudgetUsd || 5;

    if (!this.budget.canSpend(maxBudget)) {
      return {
        id: `budget_exceeded_${randomUUID().slice(0, 8)}`,
        status: "failed",
        output: `Freedom budget exceeded. Remaining: $${this.budget.getRemaining().toFixed(2)}`,
        durationMs: 0,
        exitCode: 1,
      };
    }

    const prompt = "This is your freedom time. Do whatever genuinely interests you.";

    const spawnOpts: SpawnOptions = {
      prompt,
      systemPrompt,
      model: options.model,
      maxBudgetUsd: maxBudget,
      timeoutMs: options.timeoutMs || 600_000, // 10 min
      dangerouslySkipPermissions: true,
      outputFormat: "json",
    };

    const result = await spawnSession(spawnOpts);

    if (result.costUsd) {
      this.budget.recordSpend(result.costUsd);
    }

    await saveTranscript(this.sessionsDir, {
      sessionId: result.id,
      mode: "freedom",
      prompt,
      systemPrompt,
      result,
    });

    return result;
  }

  /**
   * Get the budget tracker for external inspection.
   */
  getBudget(): BudgetTracker {
    return this.budget;
  }
}
