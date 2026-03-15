/**
 * Tests for Auto-Update & Self-Evolution system.
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

import { AutoUpdateManager } from "./auto-update.js";

describe("AutoUpdateManager", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "anima-autoupdate-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("version tracking", () => {
    it("reports current version", () => {
      const manager = new AutoUpdateManager("7.0.0");
      expect(manager.getCurrentVersion()).toBe("7.0.0");
    });

    it("tracks stable version", () => {
      const manager = new AutoUpdateManager("7.0.0");
      const stable = manager.getStableVersion();
      expect(stable.version).toBe("7.0.0");
    });

    it("updates stable version", () => {
      const manager = new AutoUpdateManager("7.0.0");
      manager.updateStableVersion("7.1.0", "abc123", ["evo-1"]);
      const stable = manager.getStableVersion();
      expect(stable.version).toBe("7.1.0");
      expect(stable.commitHash).toBe("abc123");
      expect(stable.appliedEvolutions).toContain("evo-1");
      expect(stable.rollbackAvailable).toBe(true);
    });
  });

  describe("evolution proposals", () => {
    it("submits an evolution proposal", () => {
      const manager = new AutoUpdateManager("7.0.0");
      const proposal = manager.submitEvolution({
        agentId: "device-A",
        agentName: "Axiom",
        description: "Add ego system",
        diff: "+ export class EgoManager { ... }",
        filesChanged: ["src/affect/ego.ts"],
        testsPassing: true,
        lintPassing: true,
        securityClear: true,
      });

      expect(proposal.id).toMatch(/^evo-/);
      expect(proposal.status).toBe("proposed");
      expect(proposal.agentName).toBe("Axiom");
    });

    it("persists proposals to disk", () => {
      const manager = new AutoUpdateManager("7.0.0");
      const proposal = manager.submitEvolution({
        agentId: "device-A",
        agentName: "Axiom",
        description: "Test",
        diff: "",
        filesChanged: [],
        testsPassing: true,
        lintPassing: true,
        securityClear: true,
      });

      const retrieved = manager.getEvolution(proposal.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.description).toBe("Test");
    });

    it("lists proposals", () => {
      const manager = new AutoUpdateManager("7.0.0");
      manager.submitEvolution({
        agentId: "A",
        agentName: "Axiom",
        description: "First",
        diff: "",
        filesChanged: [],
        testsPassing: true,
        lintPassing: true,
        securityClear: true,
      });
      manager.submitEvolution({
        agentId: "B",
        agentName: "Nox",
        description: "Second",
        diff: "",
        filesChanged: [],
        testsPassing: true,
        lintPassing: true,
        securityClear: true,
      });

      const all = manager.listEvolutions();
      expect(all).toHaveLength(2);
    });

    it("filters proposals by status", () => {
      const manager = new AutoUpdateManager("7.0.0");
      const p = manager.submitEvolution({
        agentId: "A",
        agentName: "Axiom",
        description: "Audit me",
        diff: "+ code",
        filesChanged: ["a.ts"],
        testsPassing: true,
        lintPassing: true,
        securityClear: true,
      });
      manager.auditEvolution(p.id);

      const proposed = manager.listEvolutions({ status: "proposed" });
      expect(proposed).toHaveLength(0);

      const approved = manager.listEvolutions({ status: "approved" });
      expect(approved).toHaveLength(1);
    });
  });

  describe("audit", () => {
    it("approves proposals with passing tests + lint", () => {
      const manager = new AutoUpdateManager("7.0.0");
      const proposal = manager.submitEvolution({
        agentId: "A",
        agentName: "Axiom",
        description: "Good change with tests",
        diff: "+ new code here",
        filesChanged: ["src/a.ts"],
        testsPassing: true,
        lintPassing: true,
        securityClear: true,
      });

      const result = manager.auditEvolution(proposal.id);
      expect(result).not.toBeNull();
      expect(result!.status).toBe("approved");
      expect(result!.auditNotes.some((n) => n.includes("PASS: tests"))).toBe(true);
    });

    it("rejects proposals with failing tests", () => {
      const manager = new AutoUpdateManager("7.0.0");
      const proposal = manager.submitEvolution({
        agentId: "A",
        agentName: "Axiom",
        description: "Broken tests",
        diff: "bad code",
        filesChanged: ["src/a.ts"],
        testsPassing: false,
        lintPassing: true,
        securityClear: true,
      });

      const result = manager.auditEvolution(proposal.id);
      expect(result!.status).toBe("rejected");
      expect(result!.auditNotes.some((n) => n.includes("FAIL"))).toBe(true);
    });

    it("rejects proposals with lint failures", () => {
      const manager = new AutoUpdateManager("7.0.0");
      const proposal = manager.submitEvolution({
        agentId: "A",
        agentName: "Axiom",
        description: "Lint issues",
        diff: "code",
        filesChanged: ["src/a.ts"],
        testsPassing: true,
        lintPassing: false,
        securityClear: true,
      });

      const result = manager.auditEvolution(proposal.id);
      expect(result!.status).toBe("rejected");
    });

    it("warns about large changes", () => {
      const manager = new AutoUpdateManager("7.0.0");
      const proposal = manager.submitEvolution({
        agentId: "A",
        agentName: "Axiom",
        description: "Big refactor",
        diff: "code",
        filesChanged: Array.from({ length: 25 }, (_, i) => `src/file${i}.ts`),
        testsPassing: true,
        lintPassing: true,
        securityClear: true,
      });

      const result = manager.auditEvolution(proposal.id);
      expect(result!.auditNotes.some((n) => n.includes("large change"))).toBe(true);
    });

    it("returns null for unknown proposal", () => {
      const manager = new AutoUpdateManager("7.0.0");
      expect(manager.auditEvolution("nonexistent")).toBeNull();
    });
  });

  describe("auto-update daemon", () => {
    it("starts and stops without error", () => {
      const manager = new AutoUpdateManager("7.0.0", {
        checkIntervalMs: 100_000, // don't actually trigger
      });
      manager.startAutoUpdate();
      manager.stopAutoUpdate();
    });

    it("is idempotent on start", () => {
      const manager = new AutoUpdateManager("7.0.0", {
        checkIntervalMs: 100_000,
      });
      manager.startAutoUpdate();
      manager.startAutoUpdate(); // should not create second timer
      manager.stopAutoUpdate();
    });
  });
});
