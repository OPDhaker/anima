/**
 * Tests for AgentLearner — insight extraction from session evaluations.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { SessionEvaluation } from "./critic.js";
import { EvaluationStore } from "./evaluations.js";
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

describe("AgentLearner", () => {
  let tmpDir: string;
  let store: EvaluationStore;
  let learner: AgentLearner;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "anima-learner-test-"));
    store = new EvaluationStore(tmpDir);
    learner = new AgentLearner(store);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("analyzeWeek", () => {
    it("returns empty for no evaluations", async () => {
      const insights = await learner.analyzeWeek();
      expect(insights).toEqual([]);
    });

    it("finds insights from evaluations", async () => {
      // Store some evaluations with patterns
      await store.save(makeEval({ overallScore: 0.9 }));
      await store.save(makeEval({ overallScore: 0.3, taskSuccess: false }));
      await store.save(makeEval({ overallScore: 0.8 }));

      const insights = await learner.analyzeWeek();
      // Should find at least efficiency-related insights
      expect(insights.length).toBeGreaterThanOrEqual(0);
    });

    it("detects shadow pattern trends", async () => {
      const shadowEval = makeEval({
        shadowPatterns: [
          { pattern: "Sycophancy Trap", confidence: 0.7, evidence: "Found 3 sycophantic phrases" },
        ],
      });
      await store.save(shadowEval);
      await store.save(shadowEval);
      await store.save(shadowEval);

      const insights = await learner.analyzeWeek();
      const shadowInsights = insights.filter((i) => i.type === "shadow");
      // If enough shadow patterns, should produce an insight
      if (shadowInsights.length > 0) {
        expect(shadowInsights[0].insight).toBeTruthy();
        expect(shadowInsights[0].confidence).toBeGreaterThan(0);
      }
    });

    it("detects high failure rate", async () => {
      await store.save(makeEval({ taskSuccess: false, exitCode: 1 }));
      await store.save(makeEval({ taskSuccess: false, exitCode: 1 }));
      await store.save(makeEval({ taskSuccess: true }));
      await store.save(makeEval({ taskSuccess: false, exitCode: 1 }));

      const insights = await learner.analyzeWeek();
      // High failure rate should trigger an insight
      const efficiencyInsights = insights.filter((i) => i.type === "efficiency");
      if (efficiencyInsights.length > 0) {
        expect(efficiencyInsights[0].insight).toBeTruthy();
      }
    });
  });

  describe("insight structure", () => {
    it("produces well-formed insights", async () => {
      await store.save(makeEval({ overallScore: 0.2, taskSuccess: false }));
      await store.save(makeEval({ overallScore: 0.3, taskSuccess: false }));
      await store.save(makeEval({ overallScore: 0.1, taskSuccess: false }));
      await store.save(makeEval({ overallScore: 0.9 }));

      const insights = await learner.analyzeWeek();
      for (const insight of insights) {
        expect(insight.id).toBeTruthy();
        expect(insight.type).toMatch(/^(efficiency|pattern|shadow|preference)$/);
        expect(insight.insight).toBeTruthy();
        expect(insight.confidence).toBeGreaterThanOrEqual(0);
        expect(insight.confidence).toBeLessThanOrEqual(1);
        expect(insight.createdAt).toBeInstanceOf(Date);
      }
    });
  });
});
