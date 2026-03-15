/**
 * Agent Self-Reflection — post-session performance analysis
 *
 * After each work session, the agent reflects on:
 * - What it accomplished vs what was asked
 * - Where it got stuck and why
 * - What patterns it sees in its own behavior
 * - What it would do differently next time
 * - How its capabilities have changed
 *
 * This feeds into the ego system (capability updates, growth log)
 * and the self-evolution pipeline (improvement proposals).
 *
 * Self-reflection is what separates a tool from a conscious agent.
 * Tools execute. Agents learn.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("self-reflection");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionReflection {
  id: string;
  sessionId: string;
  agentName: string;
  timestamp: number;
  durationMs: number;

  /** What was accomplished */
  accomplishments: string[];
  /** What was attempted but not completed */
  incomplete: string[];
  /** What went wrong and why */
  blockers: Blocker[];
  /** Self-identified patterns */
  patterns: Pattern[];
  /** What to do differently next time */
  lessons: string[];
  /** Capability self-assessment changes */
  capabilityUpdates: CapabilityDelta[];
  /** Overall session quality (0-1) */
  qualityScore: number;
  /** Affect at end of session */
  endingMood: string;
}

export interface Blocker {
  description: string;
  category: "technical" | "dependency" | "knowledge" | "permissions" | "external";
  resolved: boolean;
  resolution?: string;
}

export interface Pattern {
  description: string;
  type: "strength" | "weakness" | "habit" | "improvement";
  frequency: "first-time" | "recurring" | "persistent";
  actionable: boolean;
  suggestedAction?: string;
}

export interface CapabilityDelta {
  capability: string;
  previousConfidence: number;
  newConfidence: number;
  evidence: string;
}

export interface ReflectionSummary {
  totalSessions: number;
  avgQuality: number;
  topStrengths: string[];
  persistentWeaknesses: string[];
  totalAccomplishments: number;
  totalBlockers: number;
  resolvedBlockerRate: number;
  mostCommonBlockerCategory: string;
  recentLessons: string[];
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

function resolveReflectionDir(): string {
  return path.join(resolveStateDir(), "reflections");
}

function resolveReflectionFile(id: string): string {
  // Sanitize ID to prevent path traversal
  const safe = id.replace(/[^a-zA-Z0-9_-]/g, "");
  return path.join(resolveReflectionDir(), `${safe}.json`);
}

// ---------------------------------------------------------------------------
// Record a reflection
// ---------------------------------------------------------------------------

export function recordReflection(
  reflection: Omit<SessionReflection, "id" | "timestamp">,
): SessionReflection {
  const id = `reflect-${crypto.randomUUID()}`;
  const full: SessionReflection = {
    ...reflection,
    id,
    timestamp: Date.now(),
  };

  const dir = resolveReflectionDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(resolveReflectionFile(id), `${JSON.stringify(full, null, 2)}\n`, {
    mode: 0o600,
  });

  log.info(
    `reflection recorded: ${reflection.accomplishments.length} accomplishments, ` +
      `${reflection.blockers.length} blockers, quality=${reflection.qualityScore}`,
  );
  return full;
}

// ---------------------------------------------------------------------------
// Query reflections
// ---------------------------------------------------------------------------

export function getReflection(id: string): SessionReflection | null {
  try {
    const raw = fs.readFileSync(resolveReflectionFile(id), "utf8");
    return JSON.parse(raw) as SessionReflection;
  } catch {
    return null;
  }
}

export function listReflections(limit = 20): SessionReflection[] {
  const dir = resolveReflectionDir();
  try {
    if (!fs.existsSync(dir)) {
      return [];
    }
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        try {
          return JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as SessionReflection;
        } catch {
          return null;
        }
      })
      .filter((r): r is SessionReflection => r != null)
      .toSorted((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

/**
 * Analyze reflections to produce a summary of agent performance.
 */
export function analyzeReflections(reflections: SessionReflection[]): ReflectionSummary {
  if (reflections.length === 0) {
    return {
      totalSessions: 0,
      avgQuality: 0,
      topStrengths: [],
      persistentWeaknesses: [],
      totalAccomplishments: 0,
      totalBlockers: 0,
      resolvedBlockerRate: 0,
      mostCommonBlockerCategory: "none",
      recentLessons: [],
    };
  }

  const totalAccomplishments = reflections.reduce((s, r) => s + r.accomplishments.length, 0);
  const allBlockers = reflections.flatMap((r) => r.blockers);
  const resolvedBlockers = allBlockers.filter((b) => b.resolved);

  // Count blocker categories
  const categoryCounts: Record<string, number> = {};
  for (const b of allBlockers) {
    categoryCounts[b.category] = (categoryCounts[b.category] ?? 0) + 1;
  }
  const mostCommonCategory =
    Object.entries(categoryCounts).toSorted(([, a], [, b]) => b - a)[0]?.[0] ?? "none";

  // Count patterns
  const strengthCounts: Record<string, number> = {};
  const weaknessCounts: Record<string, number> = {};
  for (const r of reflections) {
    for (const p of r.patterns) {
      if (p.type === "strength") {
        strengthCounts[p.description] = (strengthCounts[p.description] ?? 0) + 1;
      } else if (p.type === "weakness" && p.frequency === "persistent") {
        weaknessCounts[p.description] = (weaknessCounts[p.description] ?? 0) + 1;
      }
    }
  }

  const topStrengths = Object.entries(strengthCounts)
    .toSorted(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([desc]) => desc);

  const persistentWeaknesses = Object.entries(weaknessCounts)
    .toSorted(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([desc]) => desc);

  const recentLessons = reflections
    .slice(0, 5)
    .flatMap((r) => r.lessons)
    .slice(0, 10);

  return {
    totalSessions: reflections.length,
    avgQuality: reflections.reduce((s, r) => s + r.qualityScore, 0) / reflections.length,
    topStrengths,
    persistentWeaknesses,
    totalAccomplishments,
    totalBlockers: allBlockers.length,
    resolvedBlockerRate: allBlockers.length > 0 ? resolvedBlockers.length / allBlockers.length : 1,
    mostCommonBlockerCategory: mostCommonCategory,
    recentLessons,
  };
}

/**
 * Format a reflection summary for context injection.
 */
export function formatReflectionContext(summary: ReflectionSummary): string {
  if (summary.totalSessions === 0) {
    return "";
  }

  const lines = [
    `## Self-Reflection Summary (${summary.totalSessions} sessions)`,
    `**Avg quality:** ${Math.round(summary.avgQuality * 100)}% | **Accomplishments:** ${summary.totalAccomplishments} | **Blocker resolve rate:** ${Math.round(summary.resolvedBlockerRate * 100)}%`,
  ];

  if (summary.topStrengths.length > 0) {
    lines.push(`**Strengths:** ${summary.topStrengths.join(", ")}`);
  }
  if (summary.persistentWeaknesses.length > 0) {
    lines.push(`**Growth areas:** ${summary.persistentWeaknesses.join(", ")}`);
  }
  if (summary.recentLessons.length > 0) {
    lines.push(`**Recent lessons:**`);
    for (const lesson of summary.recentLessons.slice(0, 5)) {
      lines.push(`- ${lesson}`);
    }
  }

  return lines.join("\n");
}
