/**
 * Tests for EvaluationStore — session evaluation persistence.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { SessionEvaluation } from "./critic.js";
import { EvaluationStore } from "./evaluations.js";

function makeEvaluation(overrides: Partial<SessionEvaluation> = {}): SessionEvaluation {
  return {
    sessionId: `session-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date(),
    taskSuccess: true,
    exitCode: 0,
    durationMs: 30_000,
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

describe("EvaluationStore", () => {
  let tmpDir: string;
  let store: EvaluationStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "anima-evals-test-"));
    store = new EvaluationStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("save + getBySession", () => {
    it("saves and retrieves an evaluation", async () => {
      const evaluation = makeEvaluation({ sessionId: "test-session-1" });
      await store.save(evaluation);

      const retrieved = await store.getBySession("test-session-1");
      expect(retrieved).not.toBeNull();
      expect(retrieved!.sessionId).toBe("test-session-1");
      expect(retrieved!.overallScore).toBe(0.85);
      expect(retrieved!.taskSuccess).toBe(true);
    });

    it("returns null for unknown session", async () => {
      expect(await store.getBySession("nonexistent")).toBeNull();
    });

    it("persists to date-partitioned directory", async () => {
      const evaluation = makeEvaluation();
      await store.save(evaluation);

      const dateDir = evaluation.timestamp.toISOString().split("T")[0];
      const dir = path.join(tmpDir, dateDir);
      expect(fs.existsSync(dir)).toBe(true);
    });
  });

  describe("getRecent", () => {
    it("returns evaluations from recent days", async () => {
      await store.save(makeEvaluation());
      await store.save(makeEvaluation());

      const recent = await store.getRecent(7);
      expect(recent).toHaveLength(2);
    });

    it("returns empty for no evaluations", async () => {
      expect(await store.getRecent(7)).toEqual([]);
    });
  });

  describe("getAll", () => {
    it("returns all evaluations", async () => {
      await store.save(makeEvaluation({ sessionId: "a" }));
      await store.save(makeEvaluation({ sessionId: "b" }));
      await store.save(makeEvaluation({ sessionId: "c" }));

      const all = await store.getAll();
      expect(all).toHaveLength(3);
    });

    it("returns empty when directory doesn't exist", async () => {
      const emptyStore = new EvaluationStore("/nonexistent/path");
      expect(await emptyStore.getAll()).toEqual([]);
    });
  });

  describe("getAverageScore", () => {
    it("computes average overall score", async () => {
      await store.save(makeEvaluation({ overallScore: 0.8 }));
      await store.save(makeEvaluation({ overallScore: 0.6 }));

      const avg = await store.getAverageScore(7);
      expect(avg).toBeCloseTo(0.7);
    });

    it("returns 0 when no evaluations", async () => {
      expect(await store.getAverageScore(7)).toBe(0);
    });
  });

  describe("serialization", () => {
    it("preserves all fields through save/load cycle", async () => {
      const evaluation = makeEvaluation({
        sessionId: "serialize-test",
        taskSuccess: false,
        exitCode: 1,
        durationMs: 60_000,
        costUsd: 1.23,
        budgetUsd: 5,
        efficiencyScore: 0.45,
        shadowPatterns: [{ pattern: "rushing", severity: 0.7, evidence: "many errors" }],
        errorsEncountered: ["TypeError: x", "SyntaxError: y"],
        patternsDiscovered: ["prefers small commits"],
        overallScore: 0.55,
        notes: "Struggled with types",
      });

      await store.save(evaluation);
      const loaded = await store.getBySession("serialize-test");

      expect(loaded!.taskSuccess).toBe(false);
      expect(loaded!.exitCode).toBe(1);
      expect(loaded!.durationMs).toBe(60_000);
      expect(loaded!.costUsd).toBe(1.23);
      expect(loaded!.efficiencyScore).toBe(0.45);
      expect(loaded!.errorsEncountered).toEqual(["TypeError: x", "SyntaxError: y"]);
      expect(loaded!.overallScore).toBe(0.55);
      expect(loaded!.notes).toBe("Struggled with types");
    });

    it("deserializes timestamp back to Date", async () => {
      const evaluation = makeEvaluation();
      await store.save(evaluation);
      const loaded = await store.getBySession(evaluation.sessionId);
      expect(loaded!.timestamp).toBeInstanceOf(Date);
    });
  });
});
