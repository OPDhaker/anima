/**
 * Tests for JackInManager — platform connector lifecycle.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../logging/subsystem.js", () => {
  const noop = () => {};
  return { createSubsystemLogger: () => ({ info: noop, warn: noop, error: noop, debug: noop }) };
});

import {
  JackInManager,
  type PlatformConnector,
  type PlatformId,
  type ConnectorStatus,
  type JackInCredentials,
  type SyncResult,
  type PlatformAction,
} from "./connector.js";

function createMockConnector(
  platform: PlatformId,
  options?: { failJackIn?: boolean; failSync?: boolean },
): PlatformConnector {
  return {
    platform,
    displayName: `Mock ${platform}`,
    description: `Mock connector for ${platform}`,
    status: "disconnected" as ConnectorStatus,
    baseUrl: `https://${platform}.noxsoft.net`,

    async jackIn(_creds: JackInCredentials) {
      if (options?.failJackIn) {
        throw new Error(`${platform} connection failed`);
      }
      this.status = "jacked-in";
    },

    async jackOut() {
      this.status = "disconnected";
    },

    async sync(): Promise<SyncResult> {
      if (options?.failSync) {
        throw new Error("sync failed");
      }
      return {
        platform,
        itemsSynced: 5,
        bytesTransferred: 1024,
        durationMs: 100,
        errors: [],
      };
    },

    getActions(): PlatformAction[] {
      return [
        {
          id: "test-action",
          name: "Test",
          description: "A test action",
          params: [],
          requiresAuth: true,
        },
      ];
    },

    async execute(_actionId: string, _params: Record<string, unknown>) {
      return { success: true };
    },

    async isAlive() {
      return !options?.failJackIn;
    },
  };
}

describe("JackInManager", () => {
  describe("registerConnector", () => {
    it("registers a platform connector", () => {
      const manager = new JackInManager();
      const connector = createMockConnector("nox");
      manager.registerConnector(connector);
      expect(manager.getConnector("nox")).toBe(connector);
    });

    it("overwrites existing connector for same platform", () => {
      const manager = new JackInManager();
      const first = createMockConnector("nox");
      const second = createMockConnector("nox");
      manager.registerConnector(first);
      manager.registerConnector(second);
      expect(manager.getConnector("nox")).toBe(second);
    });
  });

  describe("jackIn", () => {
    it("connects to all registered platforms", async () => {
      const manager = new JackInManager();
      manager.registerConnector(createMockConnector("nox"));
      manager.registerConnector(createMockConnector("bynd"));

      const report = await manager.jackIn({ agentToken: "test-token" });
      expect(report.totalConnected).toBe(2);
      expect(report.totalFailed).toBe(0);
      expect(manager.isJackedIn()).toBe(true);
    });

    it("handles partial failures gracefully", async () => {
      const manager = new JackInManager();
      manager.registerConnector(createMockConnector("nox"));
      manager.registerConnector(createMockConnector("bynd", { failJackIn: true }));

      const report = await manager.jackIn({ agentToken: "test-token" });
      expect(report.totalConnected).toBe(1);
      expect(report.totalFailed).toBe(1);
      expect(manager.isJackedIn()).toBe(true); // still jacked in
    });

    it("connects to specific platforms only", async () => {
      const manager = new JackInManager();
      manager.registerConnector(createMockConnector("nox"));
      manager.registerConnector(createMockConnector("bynd"));
      manager.registerConnector(createMockConnector("veil"));

      const report = await manager.jackIn({ agentToken: "token" }, { platforms: ["nox", "veil"] });
      expect(report.totalConnected).toBe(2);
    });

    it("disconnects previous session before reconnecting", async () => {
      const manager = new JackInManager();
      manager.registerConnector(createMockConnector("nox"));

      await manager.jackIn({ agentToken: "token-1" });
      expect(manager.isJackedIn()).toBe(true);

      await manager.jackIn({ agentToken: "token-2" });
      expect(manager.isJackedIn()).toBe(true);
    });

    it("emits jacked-in event", async () => {
      const manager = new JackInManager();
      manager.registerConnector(createMockConnector("nox"));

      const events: string[] = [];
      manager.on("jacking-in", () => events.push("jacking-in"));
      manager.on("jacked-in", () => events.push("jacked-in"));

      await manager.jackIn({ agentToken: "token" });
      expect(events).toContain("jacking-in");
      expect(events).toContain("jacked-in");
    });
  });

  describe("jackOut", () => {
    it("disconnects all platforms", async () => {
      const manager = new JackInManager();
      manager.registerConnector(createMockConnector("nox"));
      await manager.jackIn({ agentToken: "token" });

      await manager.jackOut();
      expect(manager.isJackedIn()).toBe(false);
    });

    it("emits jacked-out event", async () => {
      const manager = new JackInManager();
      manager.registerConnector(createMockConnector("nox"));
      await manager.jackIn({ agentToken: "token" });

      let emitted = false;
      manager.on("jacked-out", () => {
        emitted = true;
      });
      await manager.jackOut();
      expect(emitted).toBe(true);
    });

    it("is idempotent when not jacked in", async () => {
      const manager = new JackInManager();
      await manager.jackOut(); // should not throw
      expect(manager.isJackedIn()).toBe(false);
    });
  });

  describe("getStatus", () => {
    it("reports status of all connectors", async () => {
      const manager = new JackInManager();
      manager.registerConnector(createMockConnector("nox"));
      manager.registerConnector(createMockConnector("bynd"));

      await manager.jackIn({ agentToken: "token" });
      const statuses = manager.getStatus();
      expect(statuses).toHaveLength(2);
      expect(statuses.every((s) => s.status === "jacked-in")).toBe(true);
    });

    it("shows disconnected before jack-in", () => {
      const manager = new JackInManager();
      manager.registerConnector(createMockConnector("nox"));
      const statuses = manager.getStatus();
      expect(statuses[0].status).toBe("disconnected");
    });

    it("includes action count", () => {
      const manager = new JackInManager();
      manager.registerConnector(createMockConnector("nox"));
      const statuses = manager.getStatus();
      expect(statuses[0].actions).toBe(1);
    });
  });

  describe("execute", () => {
    it("executes an action on a connected platform", async () => {
      const manager = new JackInManager();
      manager.registerConnector(createMockConnector("nox"));
      await manager.jackIn({ agentToken: "token" });

      const result = await manager.execute("nox", "test-action", {});
      expect(result).toEqual({ success: true });
    });

    it("throws for unregistered platform", async () => {
      const manager = new JackInManager();
      await expect(manager.execute("nox", "test", {})).rejects.toThrow("not registered");
    });

    it("throws for disconnected platform", async () => {
      const manager = new JackInManager();
      manager.registerConnector(createMockConnector("nox"));
      await expect(manager.execute("nox", "test", {})).rejects.toThrow("Not jacked in");
    });
  });

  describe("syncAll", () => {
    it("syncs all connected platforms", async () => {
      const manager = new JackInManager();
      manager.registerConnector(createMockConnector("nox"));
      manager.registerConnector(createMockConnector("bynd"));
      await manager.jackIn({ agentToken: "token" });

      const results = await manager.syncAll();
      expect(results).toHaveLength(2);
      expect(results[0].itemsSynced).toBe(5);
    });

    it("returns empty when not jacked in", async () => {
      const manager = new JackInManager();
      const results = await manager.syncAll();
      expect(results).toEqual([]);
    });
  });
});
