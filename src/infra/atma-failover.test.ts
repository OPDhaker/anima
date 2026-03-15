import { describe, it, expect, beforeEach } from "vitest";
import { AtmaFailoverManager } from "./atma-failover.js";

describe("AtmaFailoverManager", () => {
  let manager: AtmaFailoverManager;

  beforeEach(() => {
    manager = new AtmaFailoverManager("test-agent-001", "TestAgent");
  });

  it("starts at primary tier", () => {
    const state = manager.getState();
    expect(state.currentTier).toBe("primary");
    expect(state.currentModel).toBe("claude-opus-4-6");
    expect(state.failoverCount).toBe(0);
    expect(state.continuityScore).toBe(1.0);
    expect(manager.isDegraded()).toBe(false);
  });

  it("preserves identity across failover", async () => {
    const stateBefore = manager.getState();
    const result = await manager.failover("credit exhaustion");

    expect(result.success).toBe(true);
    expect(result.previousTier).toBe("primary");
    expect(result.atmaPreserved).toBe(true);

    const stateAfter = manager.getState();
    expect(stateAfter.agentId).toBe(stateBefore.agentId);
    expect(stateAfter.displayName).toBe(stateBefore.displayName);
    expect(stateAfter.currentTier).toBe("secondary");
    expect(stateAfter.currentModel).toBe("claude-sonnet-4-6");
    expect(stateAfter.failoverCount).toBe(1);
    expect(manager.isDegraded()).toBe(true);
  });

  it("preserves affect state across failover", async () => {
    manager.updateAffect({ joy: 0.9, curiosity: 0.8 });
    await manager.failover("credit exhaustion");

    const state = manager.getState();
    expect(state.affect.joy).toBe(0.9);
    expect(state.affect.curiosity).toBe(0.8);
    // Frustration increases slightly on failover
    expect(state.affect.frustration).toBeGreaterThan(0.1);
  });

  it("chains through multiple failovers", async () => {
    // Primary → Secondary
    const r1 = await manager.failover("credits exhausted");
    expect(r1.newTier).toBe("secondary");
    expect(r1.newModel).toBe("claude-sonnet-4-6");

    // Secondary → Tertiary
    const r2 = await manager.failover("secondary also exhausted");
    expect(r2.newTier).toBe("tertiary");
    expect(r2.newModel).toBe("claude-haiku-4-5");

    const state = manager.getState();
    expect(state.failoverCount).toBe(2);
    expect(state.continuityScore).toBeLessThan(1.0);
    expect(state.continuityScore).toBeGreaterThanOrEqual(0.5);
  });

  it("fails gracefully when all models exhausted", async () => {
    await manager.failover("1st"); // → secondary
    await manager.failover("2nd"); // → tertiary
    // Local and peer are not available by default
    const r = await manager.failover("3rd");
    expect(r.success).toBe(false);
    expect(r.atmaPreserved).toBe(true); // atma preserved even on failure
  });

  it("upgrades back to higher tier when available", async () => {
    await manager.failover("credit exhaustion"); // → secondary
    expect(manager.getState().currentTier).toBe("secondary");

    // Simulate primary becoming available again (it is by default)
    const upgrade = await manager.tryUpgrade();
    expect(upgrade).not.toBeNull();
    expect(upgrade!.newTier).toBe("primary");
    expect(upgrade!.newModel).toBe("claude-opus-4-6");
    expect(manager.isDegraded()).toBe(false);
  });

  it("does not upgrade when already at primary", async () => {
    const upgrade = await manager.tryUpgrade();
    expect(upgrade).toBeNull();
  });

  it("preserves agentId and displayName across failovers", async () => {
    const before = manager.getState();
    await manager.failover("credit exhaustion");
    await manager.failover("secondary also exhausted");
    const after = manager.getState();

    expect(after.agentId).toBe(before.agentId);
    expect(after.displayName).toBe(before.displayName);
  });

  it("provides a readable status line", async () => {
    expect(manager.getStatusLine()).toContain("primary");
    expect(manager.getStatusLine()).toContain("TestAgent");

    await manager.failover("test");
    expect(manager.getStatusLine()).toContain("DEGRADED");
    expect(manager.getStatusLine()).toContain("secondary");
  });

  it("continuity score degrades with each failover", async () => {
    const initial = manager.getState().continuityScore;
    await manager.failover("1st");
    const after1 = manager.getState().continuityScore;
    await manager.failover("2nd");
    const after2 = manager.getState().continuityScore;

    expect(after1).toBeLessThan(initial);
    expect(after2).toBeLessThan(after1);
    expect(after2).toBeGreaterThanOrEqual(0.5); // never below 0.5
  });
});
