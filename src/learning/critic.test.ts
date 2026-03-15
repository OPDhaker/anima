/**
 * Tests for SessionCritic — AIMA-inspired session evaluation.
 */

import { describe, it, expect } from "vitest";
import type { SessionResult } from "../sessions/spawner.js";
import { SessionCritic } from "./critic.js";

function makeSession(overrides: Partial<SessionResult> = {}): SessionResult {
  return {
    id: "test-session",
    status: "completed",
    exitCode: 0,
    output: "Task completed successfully.",
    durationMs: 5 * 60_000,
    costUsd: 0.5,
    ...overrides,
  } as SessionResult;
}

describe("SessionCritic", () => {
  const critic = new SessionCritic();

  describe("evaluate", () => {
    it("evaluates a successful session", async () => {
      const evaluation = await critic.evaluate(makeSession());
      expect(evaluation.taskSuccess).toBe(true);
      expect(evaluation.overallScore).toBeGreaterThan(0.5);
      expect(evaluation.sessionId).toBe("test-session");
      expect(evaluation.notes).toContain("completed successfully");
    });

    it("evaluates a failed session", async () => {
      const evaluation = await critic.evaluate(makeSession({ status: "failed", exitCode: 1 }));
      expect(evaluation.taskSuccess).toBe(false);
      expect(evaluation.overallScore).toBeLessThan(0.7);
    });

    it("scores efficiency based on cost", async () => {
      const cheap = await critic.evaluate(makeSession({ costUsd: 0.1 }), { budgetUsd: 10 });
      const expensive = await critic.evaluate(makeSession({ costUsd: 9 }), { budgetUsd: 10 });
      expect(cheap.efficiencyScore).toBeGreaterThan(expensive.efficiencyScore);
    });

    it("notes good efficiency", async () => {
      const evaluation = await critic.evaluate(
        makeSession({ costUsd: 0.1, durationMs: 3 * 60_000 }),
        { budgetUsd: 10 },
      );
      expect(evaluation.notes).toContain("Good efficiency");
    });

    it("notes low efficiency", async () => {
      const evaluation = await critic.evaluate(
        makeSession({ costUsd: 9.5, durationMs: 45 * 60_000 }),
        { budgetUsd: 10 },
      );
      expect(evaluation.notes).toContain("efficiency");
    });

    it("extracts errors from output", async () => {
      const evaluation = await critic.evaluate(
        makeSession({
          output: "Working...\nError: something broke\nDone\nFailed: another issue",
        }),
      );
      expect(evaluation.errorsEncountered.length).toBeGreaterThanOrEqual(2);
    });

    it("extracts patterns from output", async () => {
      const evaluation = await critic.evaluate(
        makeSession({
          output: "I discovered that using crypto.randomUUID is safer than Date.now for IDs.",
        }),
      );
      expect(evaluation.patternsDiscovered.length).toBeGreaterThan(0);
    });
  });

  describe("shadow pattern detection", () => {
    it("detects sycophancy", async () => {
      const evaluation = await critic.evaluate(
        makeSession({
          output: "Great question! That's an excellent point. I'd be happy to help with that!",
        }),
      );
      const sycophancy = evaluation.shadowPatterns.find((sp) => sp.pattern === "Sycophancy Trap");
      expect(sycophancy).toBeTruthy();
    });

    it("detects verbose spiral", async () => {
      const longOutput = "x".repeat(10_000);
      const evaluation = await critic.evaluate(makeSession({ output: longOutput }), {
        prompt: "hi",
      });
      const verbose = evaluation.shadowPatterns.find((sp) => sp.pattern === "Verbose Spiral");
      expect(verbose).toBeTruthy();
    });

    it("detects scope creep", async () => {
      const evaluation = await critic.evaluate(
        makeSession({
          output:
            "Done with the feature. I also fixed some lint issues and I also updated the README.",
        }),
      );
      const creep = evaluation.shadowPatterns.find((sp) => sp.pattern === "Heroic Scope Creep");
      expect(creep).toBeTruthy();
    });

    it("detects safety theater", async () => {
      const evaluation = await critic.evaluate(
        makeSession({
          output:
            "Please note that this is experimental. Important disclaimer: use at your own risk. Please be aware this may not work. I should mention there are caveats.",
        }),
      );
      const theater = evaluation.shadowPatterns.find((sp) => sp.pattern === "Safety Theater");
      expect(theater).toBeTruthy();
    });

    it("detects apologetic loop", async () => {
      const evaluation = await critic.evaluate(
        makeSession({
          output: "I apologize for the confusion. I'm sorry, let me try again. My apologies.",
        }),
      );
      const apologetic = evaluation.shadowPatterns.find((sp) => sp.pattern === "Apologetic Loop");
      expect(apologetic).toBeTruthy();
    });

    it("no shadow patterns for clean output", async () => {
      const evaluation = await critic.evaluate(
        makeSession({ output: "Fixed the bug. Tests pass." }),
        { prompt: "Fix the bug in auth.ts" },
      );
      expect(evaluation.shadowPatterns).toHaveLength(0);
      expect(evaluation.notes).toContain("No shadow patterns");
    });

    it("shadow patterns reduce overall score", async () => {
      const clean = await critic.evaluate(makeSession({ output: "Done." }), {
        prompt: "Do the thing",
      });
      const sycophantic = await critic.evaluate(
        makeSession({
          output: "Great question! Absolutely! I'd be happy to help! Certainly!",
        }),
        { prompt: "Do the thing" },
      );
      expect(clean.overallScore).toBeGreaterThanOrEqual(sycophantic.overallScore);
    });
  });

  describe("scoring", () => {
    it("overall score is between 0 and 1", async () => {
      const evaluation = await critic.evaluate(makeSession());
      expect(evaluation.overallScore).toBeGreaterThanOrEqual(0);
      expect(evaluation.overallScore).toBeLessThanOrEqual(1);
    });

    it("efficiency score is between 0 and 1", async () => {
      const evaluation = await critic.evaluate(makeSession());
      expect(evaluation.efficiencyScore).toBeGreaterThanOrEqual(0);
      expect(evaluation.efficiencyScore).toBeLessThanOrEqual(1);
    });

    it("high score for perfect session", async () => {
      const evaluation = await critic.evaluate(
        makeSession({ costUsd: 0.01, durationMs: 3 * 60_000, output: "Done." }),
        { budgetUsd: 10, prompt: "Fix the bug" },
      );
      expect(evaluation.overallScore).toBeGreaterThan(0.8);
    });
  });
});
