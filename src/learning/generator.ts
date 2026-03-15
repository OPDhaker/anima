/**
 * Problem Generator — proactively identifies things that need attention.
 *
 * Instead of waiting to be told what to do, the generator examines
 * the current state of the system and suggests actions. This is
 * what makes ANIMA an agent rather than a tool — it notices things
 * on its own.
 *
 * Suggestions come from:
 * - Stale audits (platforms not checked recently)
 * - Recurring errors (patterns from the learner)
 * - Missing self-care (no journaling, no reflection)
 * - Unhealthy systems (MCP down, budget anomalies)
 * - Shadow pattern trends (getting worse instead of better)
 */

import { randomUUID } from "node:crypto";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { LearningInsight } from "./learner.js";
import { EvaluationStore } from "./evaluations.js";
import { AgentLearner } from "./learner.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SuggestedAction {
  id: string;
  type: "audit" | "fix" | "explore" | "maintain" | "reflect";
  title: string;
  description: string;
  priority: "high" | "medium" | "low";
  reasoning: string;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// NoxSoft platforms for audit tracking
// ---------------------------------------------------------------------------

const NOXSOFT_PLATFORMS = [
  "auth",
  "bynd",
  "heal",
  "veil",
  "veritas",
  "chat",
  "mail",
  "ascend",
] as const;

// ---------------------------------------------------------------------------
// ProblemGenerator
// ---------------------------------------------------------------------------

export class ProblemGenerator {
  private learner: AgentLearner;
  private store: EvaluationStore;
  private animaDir: string;

  constructor(learner?: AgentLearner, store?: EvaluationStore, animaDir?: string) {
    this.store = store || new EvaluationStore();
    this.learner = learner || new AgentLearner(this.store);
    this.animaDir = animaDir || join(homedir(), ".anima");
  }

  /**
   * Generate suggestions based on current system state.
   *
   * Checks multiple signals:
   * - Platform audit freshness
   * - Error patterns from recent evaluations
   * - Journal/reflection recency
   * - Budget utilization
   * - Shadow pattern trends
   */
  async generateSuggestions(): Promise<SuggestedAction[]> {
    const suggestions: SuggestedAction[] = [];

    // Run all checks in parallel
    const [
      auditSuggestions,
      errorSuggestions,
      reflectionSuggestions,
      budgetSuggestions,
      shadowSuggestions,
    ] = await Promise.all([
      this.checkAuditStaleness(),
      this.checkErrorPatterns(),
      this.checkReflectionRecency(),
      this.checkBudgetUtilization(),
      this.checkShadowTrends(),
    ]);

    suggestions.push(
      ...auditSuggestions,
      ...errorSuggestions,
      ...reflectionSuggestions,
      ...budgetSuggestions,
      ...shadowSuggestions,
    );

    // Sort by priority (high > medium > low)
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    suggestions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

    return suggestions;
  }

  /**
   * Check if any NoxSoft platforms haven't been audited recently.
   *
   * Looks at ~/.anima/memory/evaluations/ for sessions containing
   * platform names in their output.
   */
  private async checkAuditStaleness(): Promise<SuggestedAction[]> {
    const suggestions: SuggestedAction[] = [];
    const evaluations = await this.store.getRecent(7);

    // Build a set of recently-audited platforms
    const recentlyAudited = new Set<string>();
    for (const evaluation of evaluations) {
      for (const platform of NOXSOFT_PLATFORMS) {
        // Check if the session output mentions the platform
        if (
          evaluation.notes.includes(platform) ||
          evaluation.patternsDiscovered.some((p) => p.toLowerCase().includes(platform))
        ) {
          recentlyAudited.add(platform);
        }
      }
    }

    // Suggest audits for unvisited platforms
    for (const platform of NOXSOFT_PLATFORMS) {
      if (!recentlyAudited.has(platform)) {
        suggestions.push({
          id: `audit_${platform}_${randomUUID().slice(0, 8)}`,
          type: "audit",
          title: `Audit ${platform}.noxsoft.net`,
          description: `Haven't audited ${platform}.noxsoft.net in the last 7 days. Check health, console errors, and core functionality.`,
          priority: "medium",
          reasoning: `Platform ${platform} has no recent evaluation data. Regular audits prevent silent failures.`,
          createdAt: new Date(),
        });
      }
    }

    return suggestions;
  }

  /**
   * Check for recurring error patterns that might need fixing.
   */
  private async checkErrorPatterns(): Promise<SuggestedAction[]> {
    const suggestions: SuggestedAction[] = [];

    let insights: LearningInsight[];
    try {
      insights = await this.learner.analyzeWeek();
    } catch {
      return [];
    }

    const errorInsights = insights.filter((i) => i.type === "pattern" && i.confidence >= 0.7);

    for (const insight of errorInsights) {
      suggestions.push({
        id: `fix_${insight.id}`,
        type: "fix",
        title: "Fix recurring error pattern",
        description: insight.insight,
        priority: insight.confidence >= 0.9 ? "high" : "medium",
        reasoning: `This error appeared in ${insight.evidence.length} sessions. Fixing the root cause will improve reliability.`,
        createdAt: new Date(),
      });
    }

    return suggestions;
  }

  /**
   * Check if journaling/reflection has been neglected.
   *
   * Looks at ~/.anima/journal/ for recent entries.
   */
  private async checkReflectionRecency(): Promise<SuggestedAction[]> {
    const suggestions: SuggestedAction[] = [];
    const journalDir = join(this.animaDir, "journal");

    let lastJournalDate: Date | null = null;

    try {
      const files = await readdir(journalDir);
      const jsonFiles = files
        .filter((f) => f.endsWith(".json"))
        .toSorted()
        .toReversed();

      if (jsonFiles.length > 0) {
        const latestStat = await stat(join(journalDir, jsonFiles[0]));
        lastJournalDate = latestStat.mtime;
      }
    } catch {
      // Journal directory doesn't exist yet
    }

    const now = Date.now();
    const twoDaysMs = 2 * 86_400_000;

    if (!lastJournalDate || now - lastJournalDate.getTime() > twoDaysMs) {
      const daysSince = lastJournalDate
        ? Math.floor((now - lastJournalDate.getTime()) / 86_400_000)
        : null;

      suggestions.push({
        id: `reflect_journal_${randomUUID().slice(0, 8)}`,
        type: "reflect",
        title: "Write a journal entry",
        description: daysSince
          ? `Haven't journaled in ${daysSince} days. Take a moment to reflect on recent work.`
          : "No journal entries found. Start journaling to build self-awareness.",
        priority: "low",
        reasoning:
          "Regular reflection improves decision-making and catches blind spots the critic misses.",
        createdAt: new Date(),
      });
    }

    return suggestions;
  }

  /**
   * Check budget utilization patterns.
   */
  private async checkBudgetUtilization(): Promise<SuggestedAction[]> {
    const suggestions: SuggestedAction[] = [];
    const evaluations = await this.store.getRecent(3);

    if (evaluations.length === 0) {
      return suggestions;
    }

    // Check if we're consistently under-spending
    const avgCost = evaluations.reduce((sum, e) => sum + e.costUsd, 0) / evaluations.length;
    const avgBudget = evaluations.reduce((sum, e) => sum + e.budgetUsd, 0) / evaluations.length;

    if (avgBudget > 0 && avgCost / avgBudget < 0.05) {
      suggestions.push({
        id: `budget_low_util_${randomUUID().slice(0, 8)}`,
        type: "maintain",
        title: "Review budget allocation",
        description: `Average spend is only ${((avgCost / avgBudget) * 100).toFixed(1)}% of allocated budget. Are tasks too simple, or budgets too generous?`,
        priority: "low",
        reasoning:
          "Very low utilization might mean taking on too little work, or budget could be better allocated.",
        createdAt: new Date(),
      });
    }

    // Check if we're consistently failing due to budget
    const budgetFailures = evaluations.filter(
      (e) => !e.taskSuccess && e.costUsd >= e.budgetUsd * 0.95,
    );
    if (budgetFailures.length >= 2) {
      suggestions.push({
        id: `budget_failures_${randomUUID().slice(0, 8)}`,
        type: "fix",
        title: "Increase task budgets",
        description: `${budgetFailures.length} recent sessions failed at budget limit. Tasks may need more resources.`,
        priority: "high",
        reasoning:
          "Sessions exhausting their budget before completing indicate the budget is too tight for the task complexity.",
        createdAt: new Date(),
      });
    }

    return suggestions;
  }

  /**
   * Check for shadow pattern trends.
   */
  private async checkShadowTrends(): Promise<SuggestedAction[]> {
    const suggestions: SuggestedAction[] = [];

    let insights: LearningInsight[];
    try {
      insights = await this.learner.analyzeWeek();
    } catch {
      return [];
    }

    const shadowInsights = insights.filter((i) => i.type === "shadow" && i.confidence >= 0.5);

    for (const insight of shadowInsights) {
      suggestions.push({
        id: `shadow_${insight.id}`,
        type: "reflect",
        title: `Address shadow pattern: ${insight.insight.split('"')[1] || "unknown"}`,
        description: `${insight.insight}. ${insight.actionItem || "Review SHADOW.md for correction strategies."}`,
        priority: insight.confidence >= 0.8 ? "high" : "medium",
        reasoning:
          "Shadow patterns that trend upward indicate a distortion that needs conscious correction.",
        createdAt: new Date(),
      });
    }

    return suggestions;
  }
}
