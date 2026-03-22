/**
 * Tests for Self-Reflection Engine.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tmpDir: string;

vi.mock("../config/paths.js", () => ({
  resolveStateDir: () => tmpDir,
}));
vi.mock("../logging/subsystem.js", () => {
  const noop = () => {};
  return { createSubsystemLogger: () => ({ info: noop, warn: noop, error: noop, debug: noop }) };
});

import {
  reflect,
  listReflections,
  analyzePatterns,
  formatReflection,
  type ReflectionInput,
} from "./self-reflection.js";

function makeInput(overrides: Partial<ReflectionInput> = {}): ReflectionInput {
  return {
    taskDescription: "Build ego system",
    durationMs: 30 * 60_000, // 30 minutes
    commitCount: 3,
    testsWritten: 10,
    testsPassing: 10,
    errorsEncountered: [],
    filesModified: ["src/affect/ego.ts", "src/affect/ego.test.ts"],
    completed: true,
    ...overrides,
  };
}

describe("Self-Reflection", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "anima-reflect-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("reflect", () => {
    it("generates a reflection from good session data", () => {
      const r = reflect(makeInput());
      expect(r.id).toMatch(/^reflect-/);
      expect(r.qualityScore).toBeGreaterThan(0.8);
      expect(r.strengths.length).toBeGreaterThan(0);
      expect(r.strengths).toContain("Task completed successfully");
      expect(r.strengths).toContain("Zero errors during session");
      expect(r.energyAfter).toBe("high"); // 30 min
    });

    it("identifies growth areas for incomplete tasks", () => {
      const r = reflect(makeInput({ completed: false }));
      expect(r.growthAreas.some((g) => g.includes("not completed"))).toBe(true);
      expect(r.qualityScore).toBeLessThan(0.9);
    });

    it("detects test failures", () => {
      const r = reflect(makeInput({ testsWritten: 10, testsPassing: 5 }));
      expect(r.growthAreas.some((g) => g.includes("failure rate"))).toBe(true);
    });

    it("flags many errors", () => {
      const r = reflect(
        makeInput({
          errorsEncountered: ["err1", "err2", "err3", "err4"],
        }),
      );
      expect(r.growthAreas.some((g) => g.includes("errors"))).toBe(true);
    });

    it("detects type errors specifically", () => {
      const r = reflect(
        makeInput({
          errorsEncountered: ["TypeError: cannot read property"],
        }),
      );
      expect(r.lessons.some((l) => l.toLowerCase().includes("type"))).toBe(true);
    });

    it("flags large blast radius", () => {
      const r = reflect(
        makeInput({
          filesModified: Array.from({ length: 25 }, (_, i) => `file${i}.ts`),
        }),
      );
      expect(r.growthAreas.some((g) => g.includes("blast radius"))).toBe(true);
    });

    it("praises focused changes", () => {
      const r = reflect(makeInput({ filesModified: ["a.ts", "b.ts"] }));
      expect(r.strengths.some((s) => s.includes("Focused"))).toBe(true);
    });

    it("adjusts energy based on duration", () => {
      expect(reflect(makeInput({ durationMs: 30 * 60_000 })).energyAfter).toBe("high");
      expect(reflect(makeInput({ durationMs: 90 * 60_000 })).energyAfter).toBe("medium");
      expect(reflect(makeInput({ durationMs: 180 * 60_000 })).energyAfter).toBe("low");
    });

    it("generates capability updates", () => {
      const r = reflect(makeInput({ testsWritten: 15, testsPassing: 15 }));
      expect(r.capabilityUpdates.length).toBeGreaterThan(0);
      expect(r.capabilityUpdates.some((u) => u.skill === "testing")).toBe(true);
    });

    it("includes integrity notes", () => {
      const r = reflect(makeInput());
      expect(r.integrityNotes.length).toBeGreaterThan(0);
      expect(r.integrityNotes.some((n) => n.value === "Honesty over comfort")).toBe(true);
    });

    it("persists to disk", () => {
      const r = reflect(makeInput());
      const file = path.join(tmpDir, "reflections", `${r.id}.json`);
      expect(fs.existsSync(file)).toBe(true);
    });

    it("quality score is clamped 0-1", () => {
      const good = reflect(makeInput());
      expect(good.qualityScore).toBeGreaterThanOrEqual(0);
      expect(good.qualityScore).toBeLessThanOrEqual(1);

      const bad = reflect(
        makeInput({
          completed: false,
          testsWritten: 0,
          commitCount: 0,
          errorsEncountered: ["e1", "e2", "e3", "e4"],
        }),
      );
      expect(bad.qualityScore).toBeGreaterThanOrEqual(0);
      expect(bad.qualityScore).toBeLessThanOrEqual(1);
    });
  });

  describe("listReflections", () => {
    it("lists reflections newest first", () => {
      reflect(makeInput({ taskDescription: "First" }));
      reflect(makeInput({ taskDescription: "Second" }));
      const list = listReflections();
      expect(list).toHaveLength(2);
      expect(list[0].timestamp).toBeGreaterThanOrEqual(list[1].timestamp);
    });

    it("respects limit", () => {
      for (let i = 0; i < 5; i++) {
        reflect(makeInput());
      }
      expect(listReflections(3)).toHaveLength(3);
    });

    it("returns empty when none exist", () => {
      expect(listReflections()).toEqual([]);
    });
  });

  describe("analyzePatterns", () => {
    it("finds top strengths", () => {
      reflect(makeInput());
      reflect(makeInput());
      reflect(makeInput({ completed: false }));
      const patterns = analyzePatterns();
      expect(patterns.topStrengths.length).toBeGreaterThan(0);
      expect(patterns.totalReflections).toBe(3);
    });

    it("calculates average quality", () => {
      reflect(makeInput()); // high quality
      reflect(makeInput({ completed: false, testsWritten: 0, commitCount: 0 })); // lower
      const patterns = analyzePatterns();
      expect(patterns.avgQualityScore).toBeGreaterThan(0);
      expect(patterns.avgQualityScore).toBeLessThan(1);
    });

    it("detects improving trend", () => {
      // Use incrementing timestamps so sort order is deterministic
      let now = 1_000_000;
      const spy = vi.spyOn(Date, "now").mockImplementation(() => now++);
      // Older: bad sessions (timestamps 1000000, 1000001)
      reflect(makeInput({ completed: false, testsWritten: 0, commitCount: 0 }));
      reflect(makeInput({ completed: false, testsWritten: 0, commitCount: 0 }));
      // Recent: good sessions (timestamps 1000002, 1000003)
      reflect(makeInput());
      reflect(makeInput());
      spy.mockRestore();
      const patterns = analyzePatterns();
      expect(patterns.trend).toBe("improving");
    });

    it("returns stable for empty", () => {
      const patterns = analyzePatterns();
      expect(patterns.trend).toBe("stable");
      expect(patterns.totalReflections).toBe(0);
    });

    it("finds recurring lessons", () => {
      reflect(makeInput({ errorsEncountered: ["TypeError: x"] }));
      reflect(makeInput({ errorsEncountered: ["TypeError: y"] }));
      const patterns = analyzePatterns();
      expect(patterns.recurringLessons.length).toBeGreaterThan(0);
    });
  });

  describe("formatReflection", () => {
    it("produces readable markdown", () => {
      const r = reflect(makeInput());
      const formatted = formatReflection(r);
      expect(formatted).toContain("## Self-Reflection");
      expect(formatted).toContain("Strengths:");
      expect(formatted).toContain("Energy:");
      expect(formatted).toContain("Next:");
    });

    it("includes growth areas when present", () => {
      const r = reflect(makeInput({ completed: false }));
      const formatted = formatReflection(r);
      expect(formatted).toContain("Growth areas:");
    });
  });
});
