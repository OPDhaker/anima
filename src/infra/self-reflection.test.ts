/**
 * Tests for Agent Self-Reflection — post-session performance analysis.
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
  recordReflection,
  getReflection,
  listReflections,
  analyzeReflections,
  formatReflectionContext,
  type SessionReflection,
} from "./self-reflection.js";

function makeReflection(
  overrides: Partial<Omit<SessionReflection, "id" | "timestamp">> = {},
): Omit<SessionReflection, "id" | "timestamp"> {
  return {
    sessionId: "session-1",
    agentName: "Axiom",
    durationMs: 3600000,
    accomplishments: ["Built ego system", "Fixed steer injection"],
    incomplete: ["Stripe integration"],
    blockers: [{ description: "No API keys", category: "dependency", resolved: false }],
    patterns: [
      {
        description: "Fast at test writing",
        type: "strength",
        frequency: "recurring",
        actionable: false,
      },
    ],
    lessons: ["Always check if functions are actually called, not just defined"],
    capabilityUpdates: [
      {
        capability: "testing",
        previousConfidence: 0.7,
        newConfidence: 0.85,
        evidence: "188 new tests",
      },
    ],
    qualityScore: 0.9,
    endingMood: "thriving",
    ...overrides,
  };
}

describe("Self-Reflection", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "anima-reflection-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("recordReflection", () => {
    it("records and returns a reflection with ID", () => {
      const r = recordReflection(makeReflection());
      expect(r.id).toMatch(/^reflect-/);
      expect(r.timestamp).toBeGreaterThan(0);
      expect(r.accomplishments).toHaveLength(2);
      expect(r.qualityScore).toBe(0.9);
    });

    it("persists to disk", () => {
      const r = recordReflection(makeReflection());
      const dir = path.join(tmpDir, "reflections");
      expect(fs.existsSync(dir)).toBe(true);
      const files = fs.readdirSync(dir);
      expect(files).toHaveLength(1);
    });

    it("generates unique IDs", () => {
      const a = recordReflection(makeReflection());
      const b = recordReflection(makeReflection());
      expect(a.id).not.toBe(b.id);
    });
  });

  describe("getReflection", () => {
    it("retrieves by ID", () => {
      const r = recordReflection(makeReflection());
      const retrieved = getReflection(r.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.agentName).toBe("Axiom");
    });

    it("returns null for unknown ID", () => {
      expect(getReflection("nonexistent")).toBeNull();
    });
  });

  describe("listReflections", () => {
    it("lists sorted newest first", () => {
      recordReflection(makeReflection({ sessionId: "s1" }));
      recordReflection(makeReflection({ sessionId: "s2" }));
      const list = listReflections();
      expect(list).toHaveLength(2);
      expect(list[0].timestamp).toBeGreaterThanOrEqual(list[1].timestamp);
    });

    it("respects limit", () => {
      for (let i = 0; i < 5; i++) {
        recordReflection(makeReflection({ sessionId: `s${i}` }));
      }
      expect(listReflections(3)).toHaveLength(3);
    });

    it("returns empty for no reflections", () => {
      expect(listReflections()).toEqual([]);
    });
  });

  describe("analyzeReflections", () => {
    it("computes summary stats", () => {
      const reflections = [
        recordReflection(makeReflection({ qualityScore: 0.8 })),
        recordReflection(makeReflection({ qualityScore: 0.9 })),
      ];
      const summary = analyzeReflections(reflections);
      expect(summary.totalSessions).toBe(2);
      expect(summary.avgQuality).toBeCloseTo(0.85);
      expect(summary.totalAccomplishments).toBe(4);
      expect(summary.totalBlockers).toBe(2);
    });

    it("finds most common blocker category", () => {
      const reflections = [
        recordReflection(
          makeReflection({
            blockers: [
              { description: "a", category: "technical", resolved: true },
              { description: "b", category: "dependency", resolved: false },
            ],
          }),
        ),
        recordReflection(
          makeReflection({
            blockers: [{ description: "c", category: "dependency", resolved: false }],
          }),
        ),
      ];
      const summary = analyzeReflections(reflections);
      expect(summary.mostCommonBlockerCategory).toBe("dependency");
    });

    it("identifies top strengths from patterns", () => {
      const reflections = [
        recordReflection(
          makeReflection({
            patterns: [
              {
                description: "Fast coder",
                type: "strength",
                frequency: "recurring",
                actionable: false,
              },
            ],
          }),
        ),
        recordReflection(
          makeReflection({
            patterns: [
              {
                description: "Fast coder",
                type: "strength",
                frequency: "recurring",
                actionable: false,
              },
            ],
          }),
        ),
      ];
      const summary = analyzeReflections(reflections);
      expect(summary.topStrengths).toContain("Fast coder");
    });

    it("identifies persistent weaknesses", () => {
      const reflections = [
        recordReflection(
          makeReflection({
            patterns: [
              {
                description: "Over-engineers",
                type: "weakness",
                frequency: "persistent",
                actionable: true,
                suggestedAction: "YAGNI",
              },
            ],
          }),
        ),
      ];
      const summary = analyzeReflections(reflections);
      expect(summary.persistentWeaknesses).toContain("Over-engineers");
    });

    it("calculates blocker resolve rate", () => {
      const reflections = [
        recordReflection(
          makeReflection({
            blockers: [
              { description: "a", category: "technical", resolved: true },
              { description: "b", category: "technical", resolved: true },
              { description: "c", category: "dependency", resolved: false },
            ],
          }),
        ),
      ];
      const summary = analyzeReflections(reflections);
      expect(summary.resolvedBlockerRate).toBeCloseTo(2 / 3);
    });

    it("handles empty reflections", () => {
      const summary = analyzeReflections([]);
      expect(summary.totalSessions).toBe(0);
      expect(summary.avgQuality).toBe(0);
    });
  });

  describe("formatReflectionContext", () => {
    it("formats summary for context injection", () => {
      const reflections = [recordReflection(makeReflection())];
      const summary = analyzeReflections(reflections);
      const formatted = formatReflectionContext(summary);
      expect(formatted).toContain("Self-Reflection Summary");
      expect(formatted).toContain("Avg quality");
      expect(formatted).toContain("Strengths");
    });

    it("returns empty string for no sessions", () => {
      const summary = analyzeReflections([]);
      expect(formatReflectionContext(summary)).toBe("");
    });
  });
});
