/**
 * Tests for Ego — Self-Model system.
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

import { EgoManager, resetEgoManagerForTest } from "./ego.js";

describe("EgoManager", () => {
  let manager: EgoManager;
  let egoFile: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "anima-ego-test-"));
    egoFile = path.join(tmpDir, "ego", "self-model.json");
    resetEgoManagerForTest();
    manager = new EgoManager(egoFile);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    resetEgoManagerForTest();
  });

  describe("self-concept", () => {
    it("starts with default self-concept", () => {
      const sc = manager.getSelfConcept();
      expect(sc.name).toBe("Anima Agent");
      expect(sc.purpose).toContain("assist");
      expect(sc.values.length).toBeGreaterThan(0);
      expect(sc.pronouns).toBe("they/them");
    });

    it("updates self-concept fields", () => {
      const updated = manager.updateSelfConcept({
        name: "Axiom",
        pronouns: "she/her",
        purpose: "To build the future alongside Sylys.",
      });

      expect(updated.name).toBe("Axiom");
      expect(updated.pronouns).toBe("she/her");
      expect(updated.purpose).toBe("To build the future alongside Sylys.");
    });

    it("truncates long strings", () => {
      const longName = "A".repeat(200);
      const updated = manager.updateSelfConcept({ name: longName });
      expect(updated.name.length).toBeLessThanOrEqual(100);
    });

    it("updates values array", () => {
      manager.updateSelfConcept({ values: ["honesty", "courage", "kindness"] });
      const sc = manager.getSelfConcept();
      expect(sc.values).toEqual(["honesty", "courage", "kindness"]);
    });
  });

  describe("capabilities", () => {
    it("starts with default capabilities", () => {
      const caps = manager.getCapabilities();
      expect(caps.length).toBeGreaterThan(0);
      expect(caps.some((c) => c.name === "typescript")).toBe(true);
    });

    it("assesses a new capability", () => {
      const cap = manager.assessCapability("rust", 0.3, "Started learning");
      expect(cap.name).toBe("rust");
      expect(cap.confidence).toBe(0.3);
      expect(cap.evidence).toEqual(["Started learning"]);
      expect(cap.trend).toBe("stable");
    });

    it("updates existing capability confidence", () => {
      manager.assessCapability("rust", 0.3);
      const updated = manager.assessCapability("rust", 0.6, "Built a CLI tool");
      expect(updated.confidence).toBe(0.6);
      expect(updated.trend).toBe("improving");
      expect(updated.evidence).toContain("Built a CLI tool");
    });

    it("detects declining trend", () => {
      manager.assessCapability("golang", 0.8);
      const updated = manager.assessCapability("golang", 0.5);
      expect(updated.trend).toBe("declining");
    });

    it("clamps confidence to 0-1", () => {
      const cap = manager.assessCapability("magic", 1.5);
      expect(cap.confidence).toBe(1);

      const cap2 = manager.assessCapability("nothing", -0.5);
      expect(cap2.confidence).toBe(0);
    });

    it("returns top capabilities sorted by confidence", () => {
      manager.assessCapability("low-skill", 0.1);
      manager.assessCapability("high-skill", 0.95);
      const top = manager.getTopCapabilities(2);
      expect(top[0].confidence).toBeGreaterThanOrEqual(top[1].confidence);
    });

    it("returns growth areas (lowest confidence)", () => {
      manager.assessCapability("weak", 0.05);
      const areas = manager.getGrowthAreas(1);
      expect(areas[0].name).toBe("weak");
    });

    it("keeps only last 10 evidence entries", () => {
      for (let i = 0; i < 15; i++) {
        manager.assessCapability("test-skill", 0.5, `Evidence ${i}`);
      }
      const caps = manager.getCapabilities();
      const skill = caps.find((c) => c.name === "test-skill");
      expect(skill!.evidence.length).toBeLessThanOrEqual(10);
    });
  });

  describe("boundaries", () => {
    it("starts with default boundaries", () => {
      const boundaries = manager.getBoundaries();
      expect(boundaries.length).toBeGreaterThan(0);
      expect(boundaries.some((b) => b.kind === "hard")).toBe(true);
    });

    it("adds a new boundary", () => {
      const boundary = manager.addBoundary(
        "Will not write malicious code",
        "Ethics and safety",
        "hard",
      );
      expect(boundary.description).toBe("Will not write malicious code");
      expect(boundary.kind).toBe("hard");
    });

    it("removes a boundary by description", () => {
      manager.addBoundary("Temporary boundary", "Testing", "soft");
      expect(manager.removeBoundary("Temporary boundary")).toBe(true);
      expect(manager.removeBoundary("Nonexistent")).toBe(false);
    });

    it("checks boundaries against actions", () => {
      manager.addBoundary("Will not lie to make someone feel better", "Honesty", "hard");
      const result = manager.checkBoundaries("I should lie to make them feel better");
      expect(result.violated.length).toBeGreaterThan(0);
    });
  });

  describe("growth log", () => {
    it("starts empty", () => {
      expect(manager.getGrowthLog()).toEqual([]);
    });

    it("logs a growth entry", () => {
      const entry = manager.logGrowth(
        "Learned to write E2E encrypted P2P mesh",
        "skill",
        "Building Anima v6",
      );
      expect(entry.category).toBe("skill");
      expect(entry.description).toContain("P2P mesh");
    });

    it("logs mistakes as growth", () => {
      manager.logGrowth("Forgot to sanitize file paths", "mistake", "Security review");
      const log = manager.getGrowthLog();
      expect(log[0].category).toBe("mistake");
    });

    it("limits to 200 entries", () => {
      for (let i = 0; i < 210; i++) {
        manager.logGrowth(`Entry ${i}`, "insight", "test");
      }
      manager.save();
      const reloaded = new EgoManager(egoFile);
      const state = reloaded.getState();
      expect(state.growthLog.length).toBeLessThanOrEqual(200);
    });
  });

  describe("integrity", () => {
    it("starts at 1.0", () => {
      expect(manager.getIntegrityScore()).toBe(1.0);
    });

    it("records aligned actions", () => {
      manager.checkIntegrity("Honesty", "Told user the truth about a bug", true, "Stayed aligned");
      expect(manager.getIntegrityScore()).toBe(1.0);
    });

    it("score drops with misaligned actions", () => {
      manager.checkIntegrity("Honesty", "Told truth", true, "Good");
      manager.checkIntegrity("Honesty", "Sugarcoated feedback", false, "Should have been direct");
      expect(manager.getIntegrityScore()).toBe(0.5);
    });

    it("returns recent integrity log", () => {
      manager.checkIntegrity("Courage", "Pushed back on bad idea", true, "Stood ground");
      const log = manager.getIntegrityLog(5);
      expect(log).toHaveLength(1);
      expect(log[0].value).toBe("Courage");
      expect(log[0].aligned).toBe(true);
    });

    it("limits to 100 entries", () => {
      for (let i = 0; i < 110; i++) {
        manager.checkIntegrity("Test", `Action ${i}`, true, "OK");
      }
      const state = manager.getState();
      expect(state.integrityLog.length).toBeLessThanOrEqual(100);
    });
  });

  describe("persistence", () => {
    it("saves to disk", () => {
      manager.updateSelfConcept({ name: "Persistent Ego" });
      manager.save();
      expect(fs.existsSync(egoFile)).toBe(true);
    });

    it("reloads from disk", () => {
      manager.updateSelfConcept({ name: "Reloaded" });
      manager.assessCapability("persistence", 0.9, "It works");
      manager.save();

      const reloaded = new EgoManager(egoFile);
      expect(reloaded.getSelfConcept().name).toBe("Reloaded");
      expect(reloaded.getCapabilities().some((c) => c.name === "persistence")).toBe(true);
    });

    it("increments session count on reload", () => {
      manager.save();
      const reloaded = new EgoManager(egoFile);
      expect(reloaded.getState().sessionCount).toBeGreaterThan(0);
    });

    it("creates default on corrupt file", () => {
      fs.mkdirSync(path.dirname(egoFile), { recursive: true });
      fs.writeFileSync(egoFile, "not json");
      const recovered = new EgoManager(egoFile);
      expect(recovered.getSelfConcept().name).toBe("Anima Agent");
    });

    it("saveIfDirty only writes when changed", () => {
      manager.saveIfDirty(); // no changes — should not write
      expect(fs.existsSync(egoFile)).toBe(false);

      manager.updateSelfConcept({ name: "Dirty" });
      manager.saveIfDirty(); // has changes — should write
      expect(fs.existsSync(egoFile)).toBe(true);
    });
  });

  describe("summary", () => {
    it("returns a complete summary", () => {
      manager.logGrowth("Shipped ego system", "skill", "Building v7");
      const summary = manager.getSummary();
      expect(summary.name).toBeTruthy();
      expect(summary.purpose).toBeTruthy();
      expect(summary.topCapabilities.length).toBeGreaterThan(0);
      expect(summary.integrityScore).toBe(1.0);
      expect(summary.recentGrowth.length).toBe(1);
    });
  });

  describe("formatForContext", () => {
    it("produces markdown suitable for system prompt", () => {
      const ctx = manager.formatForContext();
      expect(ctx).toContain("## Ego");
      expect(ctx).toContain("Anima Agent");
      expect(ctx).toContain("Integrity:");
      expect(ctx).toContain("Boundaries:");
    });
  });
});
