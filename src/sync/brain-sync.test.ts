/**
 * Tests for Brain Sync — event-sourced replication with vector clocks.
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

import { BrainSyncEngine } from "./brain-sync.js";

describe("BrainSyncEngine", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "anima-brainsync-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("recordEvent", () => {
    it("records an event and advances clock", () => {
      const engine = new BrainSyncEngine("device-A", "org-1", { stateDir: tmpDir });
      const event = engine.recordEvent("node:upsert", { key: "test" });

      expect(event.type).toBe("node:upsert");
      expect(event.deviceId).toBe("device-A");
      expect(event.orgId).toBe("org-1");
      expect(event.clock).toBe(1);
      expect(event.hash).toBeTruthy();
    });

    it("increments clock on each event", () => {
      const engine = new BrainSyncEngine("device-A", "org-1", { stateDir: tmpDir });
      engine.recordEvent("node:upsert", { k: 1 });
      engine.recordEvent("node:upsert", { k: 2 });
      const third = engine.recordEvent("node:upsert", { k: 3 });

      expect(third.clock).toBe(3);
      expect(engine.getVectorClock()["device-A"]).toBe(3);
    });

    it("persists events to disk", () => {
      const engine = new BrainSyncEngine("device-A", "org-1", { stateDir: tmpDir });
      engine.recordEvent("task:create", { title: "Build ego" });

      const syncDir = path.join(tmpDir, "sync");
      expect(fs.existsSync(syncDir)).toBe(true);
    });

    it("generates SHA-256 hash for integrity", () => {
      const engine = new BrainSyncEngine("device-A", "org-1", { stateDir: tmpDir });
      const event = engine.recordEvent("node:upsert", { test: true });
      expect(event.hash).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe("computeDelta", () => {
    it("returns events peer hasn't seen", () => {
      const engine = new BrainSyncEngine("device-A", "org-1", { stateDir: tmpDir });
      engine.recordEvent("node:upsert", { k: 1 });
      engine.recordEvent("node:upsert", { k: 2 });

      const delta = engine.computeDelta({}, true);
      expect(delta.events).toHaveLength(2);
    });

    it("skips events peer already has", () => {
      const engine = new BrainSyncEngine("device-A", "org-1", { stateDir: tmpDir });
      engine.recordEvent("node:upsert", { k: 1 });
      engine.recordEvent("node:upsert", { k: 2 });

      const delta = engine.computeDelta({ "device-A": 1 }, true);
      expect(delta.events).toHaveLength(1);
      expect(delta.events[0].clock).toBe(2);
    });

    it("filters private events", () => {
      const engine = new BrainSyncEngine("device-A", "org-1", { stateDir: tmpDir });
      engine.recordEvent("node:upsert", { public: true }, "public");
      engine.recordEvent("node:upsert", { private: true }, "private");
      engine.recordEvent("node:upsert", { secret: true }, "secret");

      const delta = engine.computeDelta({}, true);
      expect(delta.events).toHaveLength(1);
      expect((delta.events[0].data as Record<string, boolean>).public).toBe(true);
    });

    it("filters internal events for peers without brain access", () => {
      const engine = new BrainSyncEngine("device-A", "org-1", { stateDir: tmpDir });
      engine.recordEvent("node:upsert", { public: true }, "public");
      engine.recordEvent("node:upsert", { internal: true }, "internal");

      const withAccess = engine.computeDelta({}, true);
      expect(withAccess.events).toHaveLength(2);

      const withoutAccess = engine.computeDelta({}, false);
      expect(withoutAccess.events).toHaveLength(1);
    });

    it("includes sender's vector clock", () => {
      const engine = new BrainSyncEngine("device-A", "org-1", { stateDir: tmpDir });
      engine.recordEvent("node:upsert", {});

      const delta = engine.computeDelta({}, true);
      expect(delta.senderClock["device-A"]).toBe(1);
    });
  });

  describe("applyDelta", () => {
    it("applies events from a peer", () => {
      const engineA = new BrainSyncEngine("device-A", "org-1", { stateDir: tmpDir });
      const engineB = new BrainSyncEngine("device-B", "org-1", {
        stateDir: fs.mkdtempSync(path.join(os.tmpdir(), "brainsync-b-")),
      });

      engineA.recordEvent("node:upsert", { fromA: true });
      const delta = engineA.computeDelta({}, true);

      const applied = engineB.applyDelta(delta);
      expect(applied).toHaveLength(1);
      expect(engineB.getVectorClock()["device-A"]).toBe(1);
    });

    it("skips duplicate events", () => {
      const engineA = new BrainSyncEngine("device-A", "org-1", { stateDir: tmpDir });
      const engineB = new BrainSyncEngine("device-B", "org-1", {
        stateDir: fs.mkdtempSync(path.join(os.tmpdir(), "brainsync-b-")),
      });

      engineA.recordEvent("node:upsert", { data: 1 });
      const delta = engineA.computeDelta({}, true);

      engineB.applyDelta(delta);
      const second = engineB.applyDelta(delta);
      expect(second).toHaveLength(0); // already applied
    });

    it("rejects events with invalid hash", () => {
      const engineA = new BrainSyncEngine("device-A", "org-1", { stateDir: tmpDir });
      const engineB = new BrainSyncEngine("device-B", "org-1", {
        stateDir: fs.mkdtempSync(path.join(os.tmpdir(), "brainsync-b-")),
      });

      engineA.recordEvent("node:upsert", { data: 1 });
      const delta = engineA.computeDelta({}, true);

      // Tamper with the event hash
      delta.events[0].hash = "tampered";

      const applied = engineB.applyDelta(delta);
      expect(applied).toHaveLength(0); // rejected
    });

    it("merges vector clocks (takes max)", () => {
      const engineA = new BrainSyncEngine("device-A", "org-1", { stateDir: tmpDir });
      const engineB = new BrainSyncEngine("device-B", "org-1", {
        stateDir: fs.mkdtempSync(path.join(os.tmpdir(), "brainsync-b-")),
      });

      engineA.recordEvent("node:upsert", {});
      engineA.recordEvent("node:upsert", {});
      engineB.recordEvent("node:upsert", {});

      const delta = engineA.computeDelta({}, true);
      engineB.applyDelta(delta);

      const clock = engineB.getVectorClock();
      expect(clock["device-A"]).toBe(2);
      expect(clock["device-B"]).toBe(1);
    });
  });

  describe("bidirectional sync", () => {
    it("two engines converge after exchanging deltas", () => {
      const dirA = fs.mkdtempSync(path.join(os.tmpdir(), "brainsync-a-"));
      const dirB = fs.mkdtempSync(path.join(os.tmpdir(), "brainsync-b-"));
      const engineA = new BrainSyncEngine("device-A", "org-1", { stateDir: dirA });
      const engineB = new BrainSyncEngine("device-B", "org-1", { stateDir: dirB });

      // A records events
      engineA.recordEvent("task:create", { title: "Task from A" });
      // B records events
      engineB.recordEvent("task:create", { title: "Task from B" });

      // Sync A → B
      const deltaAtoB = engineA.computeDelta(engineB.getVectorClock(), true);
      engineB.applyDelta(deltaAtoB);

      // Sync B → A
      const deltaBtoA = engineB.computeDelta(engineA.getVectorClock(), true);
      engineA.applyDelta(deltaBtoA);

      // Both should now have both events
      expect(engineA.getEventLog().length).toBe(2);
      expect(engineB.getEventLog().length).toBe(2);

      // Vector clocks should be consistent
      expect(engineA.getVectorClock()["device-A"]).toBe(1);
      expect(engineA.getVectorClock()["device-B"]).toBe(1);
      expect(engineB.getVectorClock()["device-A"]).toBe(1);
      expect(engineB.getVectorClock()["device-B"]).toBe(1);

      fs.rmSync(dirA, { recursive: true, force: true });
      fs.rmSync(dirB, { recursive: true, force: true });
    });
  });

  describe("log trimming", () => {
    it("trims log when exceeding maxLogSize", () => {
      const engine = new BrainSyncEngine("device-A", "org-1", {
        stateDir: tmpDir,
        maxLogSize: 5,
      });

      for (let i = 0; i < 10; i++) {
        engine.recordEvent("node:upsert", { i });
      }

      expect(engine.getEventLog().length).toBeLessThanOrEqual(5);
    });
  });

  describe("persistence", () => {
    it("reloads state from disk", () => {
      const engine1 = new BrainSyncEngine("device-A", "org-1", { stateDir: tmpDir });
      engine1.recordEvent("node:upsert", { persistent: true });
      engine1.recordEvent("node:upsert", { persistent: true });

      const engine2 = new BrainSyncEngine("device-A", "org-1", { stateDir: tmpDir });
      expect(engine2.getVectorClock()["device-A"]).toBe(2);
      expect(engine2.getEventLog().length).toBe(2);
    });
  });
});
