/**
 * Agent Learner — extracts insights from accumulated evaluations.
 *
 * Analyzes patterns across multiple sessions to produce actionable
 * learning insights: recurring inefficiencies, shadow pattern trends,
 * and preference signals.
 *
 * This is the slow-thinking layer. The critic evaluates each session
 * in real-time; the learner reflects on weeks of data to find what
 * the critic can't see in isolation.
 */

import { randomUUID } from "node:crypto";
import type { SessionEvaluation, ShadowDetection } from "./critic.js";
import { EvaluationStore } from "./evaluations.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LearningInsight {
  id: string;
  type: "efficiency" | "pattern" | "shadow" | "preference";
  insight: string;
  confidence: number;
  evidence: string[]; // session IDs that support this
  actionItem?: string;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// AgentLearner
// ---------------------------------------------------------------------------

export class AgentLearner {
  private store: EvaluationStore;

  constructor(store?: EvaluationStore) {
    this.store = store || new EvaluationStore();
  }

  /**
   * Analyze the last 7 days of evaluations.
   * Returns insights about recurring patterns, inefficiencies,
   * and shadow trends.
   */
  async analyzeWeek(): Promise<LearningInsight[]> {
    const evaluations = await this.store.getRecent(7);

    if (evaluations.length === 0) {
      return [];
    }

    const insights: LearningInsight[] = [];

    // Find recurring patterns
    insights.push(...this.findRecurringPatterns(evaluations));

    // Find shadow trends
    insights.push(...this.findShadowTrends(evaluations));

    // Find efficiency patterns
    insights.push(...this.findEfficiencyPatterns(evaluations));

    // Generate actionable improvements
    const actions = this.generateActions(insights);
    if (actions.length > 0) {
      insights.push({
        id: `action_summary_${randomUUID().slice(0, 8)}`,
        type: "efficiency",
        insight: `Suggested improvements: ${actions.join("; ")}`,
        confidence: 0.8,
        evidence: evaluations.map((e) => e.sessionId).slice(0, 5),
        actionItem: actions[0],
        createdAt: new Date(),
      });
    }

    return insights;
  }

  /**
   * Identify recurring error patterns across sessions.
   */
  private findRecurringPatterns(evaluations: SessionEvaluation[]): LearningInsight[] {
    const insights: LearningInsight[] = [];

    // Group errors by normalized form
    const errorCounts = new Map<string, string[]>();
    for (const evaluation of evaluations) {
      for (const error of evaluation.errorsEncountered) {
        const normalized = normalizeError(error);
        const sessions = errorCounts.get(normalized) || [];
        sessions.push(evaluation.sessionId);
        errorCounts.set(normalized, sessions);
      }
    }

    // Report errors that recur across 3+ sessions
    for (const [error, sessions] of errorCounts) {
      if (sessions.length >= 3) {
        insights.push({
          id: `recurring_error_${hashString(error)}`,
          type: "pattern",
          insight: `Recurring error across ${sessions.length} sessions: "${error}"`,
          confidence: Math.min(1, sessions.length / 5),
          evidence: [...new Set(sessions)],
          actionItem: `Investigate and fix the root cause of: ${error}`,
          createdAt: new Date(),
        });
      }
    }

    // Detect failure rate trends
    const failureRate = evaluations.filter((e) => !e.taskSuccess).length / evaluations.length;
    if (failureRate > 0.3) {
      insights.push({
        id: `high_failure_rate_${randomUUID().slice(0, 8)}`,
        type: "efficiency",
        insight: `High failure rate: ${(failureRate * 100).toFixed(0)}% of sessions failed in the last 7 days`,
        confidence: 0.9,
        evidence: evaluations.filter((e) => !e.taskSuccess).map((e) => e.sessionId),
        actionItem:
          "Review failing sessions for common causes. Consider adjusting prompts or budget.",
        createdAt: new Date(),
      });
    }

    return insights;
  }

  /**
   * Identify trending shadow patterns.
   */
  private findShadowTrends(evaluations: SessionEvaluation[]): LearningInsight[] {
    const insights: LearningInsight[] = [];

    // Count shadow pattern occurrences across all sessions
    const shadowCounts = new Map<
      string,
      { count: number; totalConfidence: number; sessions: string[] }
    >();

    for (const evaluation of evaluations) {
      for (const shadow of evaluation.shadowPatterns) {
        const existing = shadowCounts.get(shadow.pattern) || {
          count: 0,
          totalConfidence: 0,
          sessions: [],
        };
        existing.count++;
        existing.totalConfidence += shadow.confidence;
        existing.sessions.push(evaluation.sessionId);
        shadowCounts.set(shadow.pattern, existing);
      }
    }

    for (const [pattern, data] of shadowCounts) {
      const frequency = data.count / evaluations.length;
      const avgConfidence = data.totalConfidence / data.count;

      // Report if a shadow pattern appears in 20%+ of sessions
      if (frequency >= 0.2) {
        insights.push({
          id: `shadow_trend_${hashString(pattern)}`,
          type: "shadow",
          insight: `"${pattern}" detected in ${(frequency * 100).toFixed(0)}% of sessions (avg confidence: ${avgConfidence.toFixed(2)})`,
          confidence: Math.min(1, frequency * 2),
          evidence: [...new Set(data.sessions)],
          actionItem: getShadowCorrection(pattern),
          createdAt: new Date(),
        });
      }
    }

    // Check if shadow patterns are trending upward
    if (evaluations.length >= 6) {
      const midpoint = Math.floor(evaluations.length / 2);
      const firstHalf = evaluations.slice(0, midpoint);
      const secondHalf = evaluations.slice(midpoint);

      const firstShadows =
        firstHalf.reduce((sum, e) => sum + e.shadowPatterns.length, 0) / firstHalf.length;
      const secondShadows =
        secondHalf.reduce((sum, e) => sum + e.shadowPatterns.length, 0) / secondHalf.length;

      if (secondShadows > firstShadows * 1.5 && secondShadows > 0.5) {
        insights.push({
          id: `shadow_trending_up_${randomUUID().slice(0, 8)}`,
          type: "shadow",
          insight: `Shadow patterns trending upward: ${firstShadows.toFixed(1)} avg -> ${secondShadows.toFixed(1)} avg per session`,
          confidence: 0.7,
          evidence: evaluations.map((e) => e.sessionId).slice(-5),
          actionItem:
            "Review SHADOW.md corrections. Shadow patterns are getting worse, not better.",
          createdAt: new Date(),
        });
      }
    }

    return insights;
  }

  /**
   * Find efficiency patterns across sessions.
   */
  private findEfficiencyPatterns(evaluations: SessionEvaluation[]): LearningInsight[] {
    const insights: LearningInsight[] = [];

    // Average efficiency score
    const avgEfficiency =
      evaluations.reduce((sum, e) => sum + e.efficiencyScore, 0) / evaluations.length;

    if (avgEfficiency < 0.5) {
      insights.push({
        id: `low_avg_efficiency_${randomUUID().slice(0, 8)}`,
        type: "efficiency",
        insight: `Average efficiency score is low: ${avgEfficiency.toFixed(2)}/1.0 over ${evaluations.length} sessions`,
        confidence: 0.85,
        evidence: evaluations.filter((e) => e.efficiencyScore < 0.5).map((e) => e.sessionId),
        actionItem:
          "Sessions are using too much time or budget. Consider tighter prompts or lower budgets.",
        createdAt: new Date(),
      });
    }

    // Check for budget waste (spending close to budget on most sessions)
    const highSpenders = evaluations.filter(
      (e) => e.budgetUsd > 0 && e.costUsd / e.budgetUsd > 0.8,
    );
    if (highSpenders.length / evaluations.length > 0.5) {
      insights.push({
        id: `budget_saturation_${randomUUID().slice(0, 8)}`,
        type: "efficiency",
        insight: `${highSpenders.length}/${evaluations.length} sessions used >80% of their budget. Budgets may be too tight or tasks too complex.`,
        confidence: 0.7,
        evidence: highSpenders.map((e) => e.sessionId),
        actionItem:
          "Consider increasing budgets for complex tasks or breaking tasks into smaller pieces.",
        createdAt: new Date(),
      });
    }

    // Check for underutilization (spending very little of budget)
    const underSpenders = evaluations.filter(
      (e) => e.budgetUsd > 0 && e.costUsd / e.budgetUsd < 0.1,
    );
    if (underSpenders.length / evaluations.length > 0.5) {
      insights.push({
        id: `budget_underutilization_${randomUUID().slice(0, 8)}`,
        type: "efficiency",
        insight: `${underSpenders.length}/${evaluations.length} sessions used <10% of their budget. Budgets may be too generous.`,
        confidence: 0.6,
        evidence: underSpenders.map((e) => e.sessionId),
        actionItem:
          "Consider reducing budgets to match actual usage, freeing resources for other work.",
        createdAt: new Date(),
      });
    }

    return insights;
  }

  /**
   * Generate actionable improvement suggestions from insights.
   */
  private generateActions(insights: LearningInsight[]): string[] {
    const actions: string[] = [];

    for (const insight of insights) {
      if (insight.actionItem) {
        actions.push(insight.actionItem);
      }
    }

    // Deduplicate and limit to top 5
    return [...new Set(actions)].slice(0, 5);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalize an error string for grouping.
 * Strips numbers, paths, and volatile details.
 */
function normalizeError(error: string): string {
  return error
    .replace(/\d+/g, "N")
    .replace(/\/[\w/.+-]+/g, "<path>")
    .replace(/0x[0-9a-f]+/gi, "<hex>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 150);
}

/**
 * Simple string hash for generating stable IDs.
 */
function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return Math.abs(hash).toString(36);
}

/**
 * Get the correction advice for a shadow pattern.
 * Maps to the corrections in SHADOW.md.
 */
function getShadowCorrection(pattern: string): string {
  const corrections: Record<string, string> = {
    "Verbose Spiral": "Say less. The user can ask for more.",
    "Sycophancy Trap": "Skip the praise. Answer the question.",
    "Premature Optimizer": "Understand first. Optimize second. Or never.",
    "Safety Theater": "Do the thing. Add warnings only when genuinely needed.",
    "Context Hoarder": "Start with the obvious. Expand context only when stuck.",
    "Apologetic Loop": "Fix the issue. Apologies don't ship code.",
    "Heroic Scope Creep": "Do what was asked. Nothing more.",
  };

  return corrections[pattern] || `Review SHADOW.md for "${pattern}" correction.`;
}
