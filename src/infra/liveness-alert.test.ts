/**
 * Tests for LivenessMonitor — agent death detection + alerting.
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

import { LivenessMonitor, defaultHeartbeatPath, type LivenessAlert } from "./liveness-alert.js";

function writeHeartbeat(filePath: string, timestamp = Date.now()): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify({ pid: 1234, timestamp, uptime: 100 }));
}

describe("LivenessMonitor", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "anima-liveness-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("watches and unwatches agents", () => {
    const monitor = new LivenessMonitor();
    const hbFile = path.join(tmpDir, "agent-a.json");
    monitor.watch({
      agentId: "a",
      displayName: "Agent A",
      heartbeatFile: hbFile,
      deadThresholdMs: 5000,
    });
    expect(monitor.getStatus()).toHaveLength(1);

    monitor.unwatch("a");
    expect(monitor.getStatus()).toHaveLength(0);
  });

  it("detects alive agent", async () => {
    const monitor = new LivenessMonitor();
    const hbFile = path.join(tmpDir, "alive.json");
    writeHeartbeat(hbFile);
    monitor.watch({
      agentId: "alive",
      displayName: "Alive Agent",
      heartbeatFile: hbFile,
      deadThresholdMs: 60_000,
    });

    const status = monitor.getStatus();
    expect(status[0].alive).toBe(true);
    expect(status[0].alerted).toBe(false);
  });

  it("detects dead agent (no heartbeat file)", async () => {
    const monitor = new LivenessMonitor();
    const hbFile = path.join(tmpDir, "nonexistent.json");
    monitor.watch({
      agentId: "dead",
      displayName: "Dead Agent",
      heartbeatFile: hbFile,
      deadThresholdMs: 5000,
    });

    const alerts = await monitor.checkAll();
    expect(alerts).toHaveLength(1);
    expect(alerts[0].agentId).toBe("dead");
    expect(alerts[0].displayName).toBe("Dead Agent");
  });

  it("detects dead agent (stale heartbeat)", async () => {
    const monitor = new LivenessMonitor();
    const hbFile = path.join(tmpDir, "stale.json");
    writeHeartbeat(hbFile, Date.now() - 120_000); // 2 minutes old
    monitor.watch({
      agentId: "stale",
      displayName: "Stale",
      heartbeatFile: hbFile,
      deadThresholdMs: 60_000,
    });

    const alerts = await monitor.checkAll();
    expect(alerts).toHaveLength(1);
    expect(alerts[0].deadSinceMs).toBeGreaterThan(60_000);
  });

  it("only alerts once per dead agent", async () => {
    const monitor = new LivenessMonitor();
    const hbFile = path.join(tmpDir, "dead-once.json");
    monitor.watch({ agentId: "x", displayName: "X", heartbeatFile: hbFile, deadThresholdMs: 1000 });

    const first = await monitor.checkAll();
    expect(first).toHaveLength(1);

    const second = await monitor.checkAll();
    expect(second).toHaveLength(0); // already alerted
  });

  it("detects recovery after death", async () => {
    const monitor = new LivenessMonitor();
    const hbFile = path.join(tmpDir, "recovers.json");
    monitor.watch({
      agentId: "r",
      displayName: "Recoverer",
      heartbeatFile: hbFile,
      deadThresholdMs: 5000,
    });

    await monitor.checkAll(); // triggers death alert
    expect(monitor.getStatus()[0].alerted).toBe(true);

    // Agent recovers — write fresh heartbeat
    writeHeartbeat(hbFile);
    await monitor.checkAll();
    expect(monitor.getStatus()[0].alerted).toBe(false);
    expect(monitor.getStatus()[0].alive).toBe(true);
  });

  it("fires alert callbacks", async () => {
    const monitor = new LivenessMonitor();
    const hbFile = path.join(tmpDir, "callback.json");
    monitor.watch({
      agentId: "cb",
      displayName: "CB Agent",
      heartbeatFile: hbFile,
      deadThresholdMs: 1000,
    });

    const receivedAlerts: LivenessAlert[] = [];
    monitor.onAlert((alert) => {
      receivedAlerts.push(alert);
    });

    await monitor.checkAll();
    expect(receivedAlerts).toHaveLength(1);
    expect(receivedAlerts[0].agentId).toBe("cb");
  });

  it("starts and stops monitoring", () => {
    const monitor = new LivenessMonitor();
    monitor.start(100_000); // long interval so it doesn't trigger
    monitor.stop();
    // Should not throw
  });

  it("start is idempotent", () => {
    const monitor = new LivenessMonitor();
    monitor.start(100_000);
    monitor.start(100_000); // second call should be no-op
    monitor.stop();
  });
});

describe("defaultHeartbeatPath", () => {
  it("returns path under state dir", () => {
    const p = defaultHeartbeatPath("agent-123");
    expect(p).toContain("heartbeats");
    expect(p).toContain("agent-123.json");
  });
});
