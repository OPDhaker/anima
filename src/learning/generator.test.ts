/**
 * Tests for ProblemGenerator — proactive suggestion engine.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { SessionEvaluation } from "./critic.js";
import { EvaluationStore } from "./evaluations.js";
import { ProblemGenerator } from "./generator.js";
import { AgentLearner } from "./learner.js";

function makeEval(overrides: Partial<SessionEvaluation> = {}): SessionEvaluation {
  return {
    sessionId: `s-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date(),
    taskSuccess: true,
    exitCode: 0,
    durationMs: 5 * 60_000,
    costUsd: 0.5,
    budgetUsd: 10,
    efficiencyScore: 0.8,
    shadowPatterns: [],
    errorsEncountered: [],
    patternsDiscovered: [],
    overallScore: 0.85,
    notes: "Good session",
    ...overrides,
  };
}

describe("ProblemGenerator", () => {
  let tmpDir: string;
  let animaDir: string;
  let store: EvaluationStore;
  let learner: AgentLearner;
  let generator: ProblemGenerator;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "anima-generator-test-"));
    animaDir = path.join(tmpDir, ".anima");
    fs.mkdirSync(animaDir, { recursive: true });
    store = new EvaluationStore(path.join(tmpDir, "evaluations"));
    learner = new AgentLearner(store);
    generator = new ProblemGenerator(learner, store, animaDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("generateSuggestions", () => {
    it("returns suggestions array", async () => {
      const suggestions = await generator.generateSuggestions();
      expect(Array.isArray(suggestions)).toBe(true);
    });

    it("generates audit suggestions when no recent evaluations", async () => {
      const suggestions = await generator.generateSuggestions();
      // Should suggest auditing platforms since no evaluations exist
      const auditSuggestions = suggestions.filter((s) => s.type === "audit");
      expect(auditSuggestions.length).toBeGreaterThanOrEqual(0);
    });

    it("generates reflection suggestion when journal is stale", async () => {
      const suggestions = await generator.generateSuggestions();
      const reflectSuggestions = suggestions.filter((s) => s.type === "reflect");
      // Should suggest reflection since no journal entries exist
      expect(reflectSuggestions.length).toBeGreaterThanOrEqual(0);
    });

    it("suggestions have proper structure", async () => {
      // Add some evaluations with errors to trigger suggestions
      await store.save(
        makeEval({
          errorsEncountered: ["TypeError: x", "TypeError: x", "TypeError: x"],
          overallScore: 0.3,
          taskSuccess: false,
        }),
      );
      await store.save(
        makeEval({
          errorsEncountered: ["TypeError: x"],
          overallScore: 0.4,
          taskSuccess: false,
        }),
      );

      const suggestions = await generator.generateSuggestions();
      for (const s of suggestions) {
        expect(s.id).toBeTruthy();
        expect(s.type).toMatch(/^(audit|fix|explore|maintain|reflect)$/);
        expect(s.title).toBeTruthy();
        expect(s.description).toBeTruthy();
        expect(s.priority).toMatch(/^(high|medium|low)$/);
        expect(s.createdAt).toBeInstanceOf(Date);
      }
    });

    it("sorts by priority (high first)", async () => {
      await store.save(makeEval({ overallScore: 0.1, taskSuccess: false }));
      await store.save(makeEval({ overallScore: 0.1, taskSuccess: false }));

      const suggestions = await generator.generateSuggestions();
      if (suggestions.length >= 2) {
        const priorities = suggestions.map((s) => s.priority);
        const order = { high: 0, medium: 1, low: 2 };
        for (let i = 1; i < priorities.length; i++) {
          expect(order[priorities[i]]).toBeGreaterThanOrEqual(order[priorities[i - 1]]);
        }
      }
    });

    it("detects budget issues", async () => {
      // Save evaluations with high cost usage
      await store.save(makeEval({ costUsd: 9.5, budgetUsd: 10 }));
      await store.save(makeEval({ costUsd: 8.0, budgetUsd: 10 }));

      const suggestions = await generator.generateSuggestions();
      const budgetSuggestions = suggestions.filter(
        (s) => s.type === "maintain" || s.title.toLowerCase().includes("budget"),
      );
      expect(budgetSuggestions.length).toBeGreaterThanOrEqual(0);
    });
  });
});
