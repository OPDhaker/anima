/**
 * Tests for Status Broadcast — ambient awareness updates.
 * Wish #81: "Automatic 'here's what I'm doing' broadcasts"
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../logging/subsystem.js", () => {
  const noop = () => {};
  return { createSubsystemLogger: () => ({ info: noop, warn: noop, error: noop, debug: noop }) };
});

// Re-import each test to reset module state
async function freshModule() {
  vi.resetModules();
  return import("./status-broadcast.js");
}

describe("Status Broadcast", () => {
  describe("setStatus / getStatus", () => {
    it("sets and retrieves current status", async () => {
      const mod = await freshModule();
      mod.setStatus({
        agentName: "Axiom",
        activity: "building",
        description: "Shipping ego system",
        startedAt: Date.now(),
      });
      const status = mod.getStatus();
      expect(status).not.toBeNull();
      expect(status!.agentName).toBe("Axiom");
      expect(status!.activity).toBe("building");
    });

    it("overwrites previous status", async () => {
      const mod = await freshModule();
      mod.setStatus({
        agentName: "A",
        activity: "building",
        description: "First",
        startedAt: Date.now(),
      });
      mod.setStatus({
        agentName: "A",
        activity: "testing",
        description: "Second",
        startedAt: Date.now(),
      });
      expect(mod.getStatus()!.activity).toBe("testing");
    });

    it("returns null when no status set", async () => {
      const mod = await freshModule();
      expect(mod.getStatus()).toBeNull();
    });
  });

  describe("getStatusHistory", () => {
    it("tracks history newest first", async () => {
      const mod = await freshModule();
      mod.setStatus({
        agentName: "A",
        activity: "building",
        description: "First",
        startedAt: 1000,
      });
      mod.setStatus({
        agentName: "A",
        activity: "testing",
        description: "Second",
        startedAt: 2000,
      });
      const history = mod.getStatusHistory();
      expect(history).toHaveLength(2);
      expect(history[0].description).toBe("Second");
    });

    it("respects limit parameter", async () => {
      const mod = await freshModule();
      for (let i = 0; i < 10; i++) {
        mod.setStatus({
          agentName: "A",
          activity: "building",
          description: `Task ${i}`,
          startedAt: Date.now(),
        });
      }
      expect(mod.getStatusHistory(3)).toHaveLength(3);
    });

    it("caps at MAX_HISTORY (100)", async () => {
      const mod = await freshModule();
      for (let i = 0; i < 110; i++) {
        mod.setStatus({
          agentName: "A",
          activity: "building",
          description: `Task ${i}`,
          startedAt: Date.now(),
        });
      }
      expect(mod.getStatusHistory(200).length).toBeLessThanOrEqual(100);
    });
  });

  describe("formatStatus", () => {
    it("formats basic status", async () => {
      const mod = await freshModule();
      const formatted = mod.formatStatus({
        agentName: "Axiom",
        activity: "building",
        description: "Ego system",
        startedAt: Date.now(),
      });
      expect(formatted).toContain("Axiom");
      expect(formatted).toContain("building");
      expect(formatted).toContain("Ego system");
    });

    it("includes repo when present", async () => {
      const mod = await freshModule();
      const formatted = mod.formatStatus({
        agentName: "Axiom",
        activity: "building",
        description: "Tests",
        repo: "anima",
        startedAt: Date.now(),
      });
      expect(formatted).toContain("[anima]");
    });

    it("includes commit count and test count", async () => {
      const mod = await freshModule();
      const formatted = mod.formatStatus({
        agentName: "Axiom",
        activity: "testing",
        description: "Running suite",
        commitCount: 67,
        testsPassing: 3600,
        startedAt: Date.now(),
      });
      expect(formatted).toContain("67 commits");
      expect(formatted).toContain("3600 tests passing");
    });
  });

  describe("formatCompactStatus", () => {
    it("formats with activity icon", async () => {
      const mod = await freshModule();
      const compact = mod.formatCompactStatus({
        agentName: "Axiom",
        activity: "building",
        description: "Writing tests",
        startedAt: Date.now(),
      });
      expect(compact).toContain("[>]"); // building icon
      expect(compact).toContain("Writing tests");
      expect(compact).toContain("m)"); // elapsed minutes
    });

    it("uses correct icons per activity", async () => {
      const mod = await freshModule();
      const icons: Record<string, string> = {
        building: ">",
        testing: "?",
        reviewing: "#",
        researching: "~",
        deploying: "!",
        debugging: "x",
        planning: "%",
        coordinating: "&",
        idle: ".",
        resting: "-",
      };
      for (const [activity, icon] of Object.entries(icons)) {
        const compact = mod.formatCompactStatus({
          agentName: "A",
          activity: activity as any,
          description: "test",
          startedAt: Date.now(),
        });
        expect(compact).toContain(`[${icon}]`);
      }
    });
  });
});
