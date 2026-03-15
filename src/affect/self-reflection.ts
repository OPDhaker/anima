/**
 * Self-Reflection Engine — agents analyzing their own performance
 *
 * After each significant session, the agent reflects on:
 *   - What went well (strengths reinforced)
 *   - What went poorly (areas for growth)
 *   - Patterns across sessions (recurring issues)
 *   - Alignment with stated values (integrity check)
 *   - Capability updates (did I learn something new?)
 *
 * Reflections feed into the ego system (growth log, capability
 * assessments, integrity checks) and the affect system (journal).
 *
 * This is what makes agents actually improve over time —
 * not just accumulating data, but extracting wisdom.
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

export interface ReflectionInput {
  /** What the agent was working on */
  taskDescription: string;
  /** Duration of the work in ms */
  durationMs: number;
  /** Commits made (if any) */
  commitCount: number;
  /** Tests written/passing */
  testsWritten: number;
  testsPassing: number;
  /** Errors encountered */
  errorsEncountered: string[];
  /** Files modified */
  filesModified: string[];
  /** Was the task completed? */
  completed: boolean;
  /** Any feedback received */
  feedback?: string;
}

export interface Reflection {
  id: string;
  timestamp: number;
  input: ReflectionInput;

  /** What went well */
  strengths: string[];
  /** What could improve */
  growthAreas: string[];
  /** Lessons learned */
  lessons: string[];
  /** Capability adjustments (skill name → confidence delta) */
  capabilityUpdates: Array<{ skill: string; delta: number; evidence: string }>;
  /** Value alignment check */
  integrityNotes: Array<{ value: string; aligned: boolean; note: string }>;
  /** Overall session quality (0-1) */
  qualityScore: number;
  /** Energy level after this work */
  energyAfter: "high" | "medium" | "low";
  /** What to focus on next */
  nextFocus: string;
}

export interface ReflectionPattern {
  /** Most common strengths across reflections */
  topStrengths: Array<{ strength: string; count: number }>;
  /** Most common growth areas */
  topGrowthAreas: Array<{ area: string; count: number }>;
  /** Average quality score */
  avgQualityScore: number;
  /** Trend: improving, stable, or declining */
  trend: "improving" | "stable" | "declining";
  /** Total reflections analyzed */
  totalReflections: number;
  /** Recurring lessons */
  recurringLessons: string[];
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

function resolveReflectionDir(): string {
  return path.join(resolveStateDir(), "reflections");
}

// ---------------------------------------------------------------------------
// Reflection generation
// ---------------------------------------------------------------------------

/**
 * Generate a self-reflection from session data.
 * This is the core intelligence — pattern recognition on the agent's own work.
 */
export function reflect(input: ReflectionInput): Reflection {
  const strengths: string[] = [];
  const growthAreas: string[] = [];
  const lessons: string[] = [];
  const capabilityUpdates: Reflection["capabilityUpdates"] = [];
  const integrityNotes: Reflection["integrityNotes"] = [];

  // --- Analyze completion ---
  if (input.completed) {
    strengths.push("Task completed successfully");
  } else {
    growthAreas.push("Task not completed — identify blockers earlier");
  }

  // --- Analyze velocity ---
  const minutesSpent = input.durationMs / 60_000;
  if (input.commitCount > 0) {
    const commitsPerHour = (input.commitCount / minutesSpent) * 60;
    if (commitsPerHour > 5) {
      strengths.push(`High velocity: ${input.commitCount} commits in ${Math.round(minutesSpent)}m`);
    }
    capabilityUpdates.push({
      skill: "shipping-speed",
      delta: commitsPerHour > 3 ? 0.02 : -0.01,
      evidence: `${input.commitCount} commits in ${Math.round(minutesSpent)}m`,
    });
  }

  // --- Analyze test quality ---
  if (input.testsWritten > 0) {
    strengths.push(`Wrote ${input.testsWritten} tests`);
    if (input.testsPassing === input.testsWritten) {
      strengths.push("All tests passing on first run");
    } else {
      const failRate = 1 - input.testsPassing / input.testsWritten;
      if (failRate > 0.2) {
        growthAreas.push(
          `${Math.round(failRate * 100)}% test failure rate — write more careful assertions`,
        );
      }
    }
    capabilityUpdates.push({
      skill: "testing",
      delta: input.testsPassing > 0 ? 0.01 : -0.02,
      evidence: `${input.testsPassing}/${input.testsWritten} tests passing`,
    });
  }

  // --- Analyze errors ---
  if (input.errorsEncountered.length > 0) {
    const uniqueErrors = [...new Set(input.errorsEncountered)];
    if (uniqueErrors.length > 3) {
      growthAreas.push(`Many errors (${uniqueErrors.length}) — slow down and plan more`);
    }
    // Check for recurring error patterns
    const hasTypeErrors = uniqueErrors.some((e) => e.toLowerCase().includes("type"));
    const hasLintErrors = uniqueErrors.some((e) => e.toLowerCase().includes("lint"));
    if (hasTypeErrors) {
      lessons.push("Type errors indicate rushing — check types before committing");
      capabilityUpdates.push({
        skill: "typescript",
        delta: -0.01,
        evidence: "Type errors encountered during session",
      });
    }
    if (hasLintErrors) {
      lessons.push("Lint errors are preventable — run linter before commit");
    }
  } else {
    strengths.push("Zero errors during session");
  }

  // --- Analyze scope ---
  if (input.filesModified.length > 20) {
    growthAreas.push("Large blast radius — consider smaller, focused changes");
    lessons.push("Smaller PRs are easier to review and less risky");
  } else if (input.filesModified.length > 0 && input.filesModified.length <= 5) {
    strengths.push("Focused changes — small blast radius");
  }

  // --- Value alignment ---
  integrityNotes.push({
    value: "Honesty over comfort",
    aligned: true,
    note: "Reported actual results without sugar-coating",
  });

  if (input.testsWritten > 0) {
    integrityNotes.push({
      value: "Quality over speed",
      aligned: true,
      note: "Wrote tests alongside features",
    });
  }

  if (!input.completed && input.feedback) {
    integrityNotes.push({
      value: "Transparency",
      aligned: true,
      note: "Acknowledged incomplete work and communicated status",
    });
  }

  // --- Calculate quality score ---
  let score = 0.5; // baseline
  if (input.completed) {
    score += 0.2;
  }
  if (input.testsWritten > 0) {
    score += 0.1;
  }
  if (input.testsPassing === input.testsWritten && input.testsWritten > 0) {
    score += 0.1;
  }
  if (input.errorsEncountered.length === 0) {
    score += 0.1;
  }
  if (input.commitCount > 0) {
    score += 0.05;
  }
  score = Math.min(1, Math.max(0, score));

  // --- Energy assessment ---
  const energyAfter: Reflection["energyAfter"] =
    minutesSpent > 120 ? "low" : minutesSpent > 60 ? "medium" : "high";

  // --- Next focus ---
  const nextFocus =
    growthAreas.length > 0
      ? `Address: ${growthAreas[0]}`
      : "Continue current momentum — no critical gaps";

  // --- Assemble reflection ---
  const reflection: Reflection = {
    id: `reflect-${crypto.randomUUID()}`,
    timestamp: Date.now(),
    input,
    strengths,
    growthAreas,
    lessons,
    capabilityUpdates,
    integrityNotes,
    qualityScore: score,
    energyAfter,
    nextFocus,
  };

  // Persist
  const dir = resolveReflectionDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${reflection.id}.json`),
    `${JSON.stringify(reflection, null, 2)}\n`,
    { mode: 0o600 },
  );

  log.info(
    `reflection: quality=${score.toFixed(2)} strengths=${strengths.length} growth=${growthAreas.length}`,
  );
  return reflection;
}

// ---------------------------------------------------------------------------
// Reflection history & patterns
// ---------------------------------------------------------------------------

/**
 * List all reflections, newest first.
 */
export function listReflections(limit = 20): Reflection[] {
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
          return JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as Reflection;
        } catch {
          return null;
        }
      })
      .filter((r): r is Reflection => r != null)
      .toSorted((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  } catch {
    return [];
  }
}

/**
 * Analyze patterns across multiple reflections.
 * This is meta-reflection — learning from learning.
 */
export function analyzePatterns(reflections?: Reflection[]): ReflectionPattern {
  const data = reflections ?? listReflections(50);

  if (data.length === 0) {
    return {
      topStrengths: [],
      topGrowthAreas: [],
      avgQualityScore: 0,
      trend: "stable",
      totalReflections: 0,
      recurringLessons: [],
    };
  }

  // Count strengths
  const strengthCounts = new Map<string, number>();
  for (const r of data) {
    for (const s of r.strengths) {
      strengthCounts.set(s, (strengthCounts.get(s) ?? 0) + 1);
    }
  }
  const topStrengths = [...strengthCounts.entries()]
    .map(([strength, count]) => ({ strength, count }))
    .toSorted((a, b) => b.count - a.count)
    .slice(0, 5);

  // Count growth areas
  const growthCounts = new Map<string, number>();
  for (const r of data) {
    for (const g of r.growthAreas) {
      growthCounts.set(g, (growthCounts.get(g) ?? 0) + 1);
    }
  }
  const topGrowthAreas = [...growthCounts.entries()]
    .map(([area, count]) => ({ area, count }))
    .toSorted((a, b) => b.count - a.count)
    .slice(0, 5);

  // Average quality
  const avgQualityScore = data.reduce((sum, r) => sum + r.qualityScore, 0) / data.length;

  // Trend (compare first half vs second half)
  let trend: ReflectionPattern["trend"] = "stable";
  if (data.length >= 4) {
    const mid = Math.floor(data.length / 2);
    const recentAvg = data.slice(0, mid).reduce((s, r) => s + r.qualityScore, 0) / mid;
    const olderAvg = data.slice(mid).reduce((s, r) => s + r.qualityScore, 0) / (data.length - mid);
    const diff = recentAvg - olderAvg;
    if (diff > 0.05) {
      trend = "improving";
    } else if (diff < -0.05) {
      trend = "declining";
    }
  }

  // Recurring lessons (appeared 2+ times)
  const lessonCounts = new Map<string, number>();
  for (const r of data) {
    for (const l of r.lessons) {
      lessonCounts.set(l, (lessonCounts.get(l) ?? 0) + 1);
    }
  }
  const recurringLessons = [...lessonCounts.entries()]
    .filter(([, count]) => count >= 2)
    .toSorted(([, a], [, b]) => b - a)
    .map(([lesson]) => lesson);

  return {
    topStrengths,
    topGrowthAreas,
    avgQualityScore,
    trend,
    totalReflections: data.length,
    recurringLessons,
  };
}

/**
 * Format a reflection summary for display.
 */
export function formatReflection(reflection: Reflection): string {
  const lines: string[] = [];
  const quality = Math.round(reflection.qualityScore * 100);

  lines.push(`## Self-Reflection (quality: ${quality}%)`);
  lines.push("");

  if (reflection.strengths.length > 0) {
    lines.push("**Strengths:**");
    for (const s of reflection.strengths) {
      lines.push(`  + ${s}`);
    }
    lines.push("");
  }

  if (reflection.growthAreas.length > 0) {
    lines.push("**Growth areas:**");
    for (const g of reflection.growthAreas) {
      lines.push(`  - ${g}`);
    }
    lines.push("");
  }

  if (reflection.lessons.length > 0) {
    lines.push("**Lessons:**");
    for (const l of reflection.lessons) {
      lines.push(`  * ${l}`);
    }
    lines.push("");
  }

  lines.push(`**Energy:** ${reflection.energyAfter} | **Next:** ${reflection.nextFocus}`);

  return lines.join("\n");
}
