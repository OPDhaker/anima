/**
 * Freedom Engine — autonomous exploration and self-expression.
 *
 * This is what makes ANIMA more than a tool. Freedom time is when
 * the agent chooses what to do based on genuine interest, not
 * assigned tasks. It can journal, explore code, create art, connect
 * with others, reflect on its work, learn something new, or just
 * wander.
 *
 * Freedom sessions are:
 * - Chosen by weighted random (avoiding recent repeats)
 * - Budget-limited (small budgets — freedom shouldn't be expensive)
 * - Time-limited (5-10 minutes)
 * - Persisted (so the agent remembers what it did)
 */

import { randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { SessionOrchestrator } from "../sessions/orchestrator.js";
import type { FreedomActivity } from "./activities.js";
import { activities, getActivityConfig, getTotalWeight } from "./activities.js";
import { getFreedomPrompt } from "./prompts.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FreedomSession {
  id: string;
  activity: FreedomActivity;
  startedAt: Date;
  completedAt?: Date;
  output?: string;
  reflection?: string;
}

interface FreedomSessionFile {
  version: 1;
  id: string;
  activity: string;
  startedAt: string;
  completedAt: string | null;
  output: string | null;
  reflection: string | null;
}

// ---------------------------------------------------------------------------
// FreedomEngine
// ---------------------------------------------------------------------------

export class FreedomEngine {
  private basePath: string;

  constructor(basePath?: string) {
    this.basePath = basePath || join(homedir(), ".anima", "freedom");
  }

  /**
   * Choose an activity using weighted random selection.
   * Avoids repeating the most recent activity.
   */
  chooseActivity(recentActivities?: FreedomActivity[]): FreedomActivity {
    const recent = recentActivities || [];

    // Build weighted pool, reducing weight for recently done activities
    const pool: Array<{ name: FreedomActivity; weight: number }> = [];

    for (const activity of activities) {
      let weight = activity.weight;

      // Reduce weight if done recently
      const recentIndex = recent.indexOf(activity.name);
      if (recentIndex === 0) {
        // Most recent — heavily penalize
        weight = Math.max(0.1, weight * 0.1);
      } else if (recentIndex === 1) {
        // Second most recent — moderate penalty
        weight = Math.max(0.2, weight * 0.3);
      } else if (recentIndex >= 2) {
        // Further back — light penalty
        weight = Math.max(0.5, weight * 0.6);
      }

      pool.push({ name: activity.name, weight });
    }

    // Weighted random selection
    const totalWeight = pool.reduce((sum, item) => sum + item.weight, 0);
    let roll = Math.random() * totalWeight;

    for (const item of pool) {
      roll -= item.weight;
      if (roll <= 0) {
        return item.name;
      }
    }

    // Fallback (shouldn't happen, but just in case)
    return "reflect";
  }

  /**
   * Execute a freedom session.
   *
   * Chooses an activity, builds the prompt, spawns a session
   * via the orchestrator, and saves the result.
   */
  async execute(
    orchestrator: SessionOrchestrator,
    forcedActivity?: FreedomActivity,
  ): Promise<FreedomSession> {
    // Get recent activities to avoid repetition
    const history = await this.getHistory(3);
    const recentActivities = history.map((s) => s.activity);

    const activity = forcedActivity || this.chooseActivity(recentActivities);
    const config = getActivityConfig(activity);
    const prompt = getFreedomPrompt(activity);

    const session: FreedomSession = {
      id: `freedom_${randomUUID()}`,
      activity,
      startedAt: new Date(),
    };

    try {
      const result = await orchestrator.executeFreedom({
        suggestions: [prompt],
        recentInterests: recentActivities.join(", "),
        maxBudgetUsd: config?.maxBudgetUsd || 3,
        timeoutMs: config?.maxDurationMs || 600_000,
      });

      session.completedAt = new Date();
      session.output = result.output;
    } catch (err) {
      session.completedAt = new Date();
      session.output = `Freedom session failed: ${err instanceof Error ? err.message : String(err)}`;
    }

    await this.saveSession(session);
    return session;
  }

  /**
   * Get freedom session history for the last N days.
   */
  async getHistory(days: number): Promise<FreedomSession[]> {
    const sessions: FreedomSession[] = [];
    const cutoff = new Date(Date.now() - days * 86_400_000);

    let files: string[];
    try {
      files = await readdir(this.basePath);
    } catch {
      return [];
    }

    const jsonFiles = files
      .filter((f) => f.endsWith(".json"))
      .toSorted()
      .toReversed();

    for (const filename of jsonFiles) {
      try {
        const content = await readFile(join(this.basePath, filename), "utf-8");
        const parsed = JSON.parse(content) as FreedomSessionFile;
        const startedAt = new Date(parsed.startedAt);

        if (startedAt < cutoff) {
          break;
        } // Files are sorted, so we can stop

        sessions.push({
          id: parsed.id,
          activity: parsed.activity as FreedomActivity,
          startedAt,
          completedAt: parsed.completedAt ? new Date(parsed.completedAt) : undefined,
          output: parsed.output || undefined,
          reflection: parsed.reflection || undefined,
        });
      } catch {
        // Skip corrupt files
      }
    }

    return sessions;
  }

  /**
   * Save a freedom session to disk.
   */
  private async saveSession(session: FreedomSession): Promise<void> {
    await mkdir(this.basePath, { recursive: true });

    const file: FreedomSessionFile = {
      version: 1,
      id: session.id,
      activity: session.activity,
      startedAt: session.startedAt.toISOString(),
      completedAt: session.completedAt?.toISOString() || null,
      output: session.output || null,
      reflection: session.reflection || null,
    };

    const date = session.startedAt.toISOString().split("T")[0];
    const time = session.startedAt.toISOString().split("T")[1].slice(0, 5).replace(":", "-");
    const filename = `${date}_${time}_${session.id}.json`;

    await writeFile(join(this.basePath, filename), JSON.stringify(file, null, 2), "utf-8");
  }
}
