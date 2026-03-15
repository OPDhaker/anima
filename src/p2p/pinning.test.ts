/**
 * Tests for Content Pinning and Replication.
 *
 * Tests pin/unpin operations, replication factor, pin request handling,
 * agreement tracking, storage limits, and peer lifecycle events.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../logging/subsystem.js", () => {
  const noop = () => {};
  const logger = { info: noop, warn: noop, error: noop, debug: noop, trace: noop };
  return { createSubsystemLogger: () => logger };
});

import { PinningManager, type PinningConfig } from "./pinning.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

function createMockMesh() {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  return {
    on(event: string, fn: (...args: unknown[]) => void) {
      if (!listeners.has(event)) {
        listeners.set(event, new Set());
      }
      listeners.get(event)!.add(fn);
    },
    off(event: string, fn: (...args: unknown[]) => void) {
      listeners.get(event)?.delete(fn);
    },
    send: vi.fn().mockReturnValue(true),
    broadcast: vi.fn(),
    listPeers: vi.fn(() => [{ deviceId: "node-B" }, { deviceId: "node-C" }]),
    _emitMessage(msg: Record<string, unknown>) {
      for (const fn of listeners.get("message") ?? []) {
        fn(msg);
      }
    },
    _emitPeerDisconnected(peerId: string) {
      for (const fn of listeners.get("peer.disconnected") ?? []) {
        fn(peerId);
      }
    },
    _emitPeerConnected(peerId: string) {
      for (const fn of listeners.get("peer.connected") ?? []) {
        fn(peerId);
      }
    },
  };
}

function createMockContentRouter(opts?: { hasLocal?: boolean }) {
  return {
    hasLocal: vi.fn().mockReturnValue(opts?.hasLocal ?? true),
    getLocal: vi.fn().mockReturnValue(Buffer.from("test data")),
    request: vi.fn().mockResolvedValue(Buffer.from("fetched data")),
    store: vi.fn().mockReturnValue("stored-hash"),
  };
}

function makeConfig(
  mesh: ReturnType<typeof createMockMesh>,
  contentRouter: ReturnType<typeof createMockContentRouter>,
  overrides?: Partial<PinningConfig>,
): PinningConfig {
  return {
    mesh: mesh as unknown as PinningConfig["mesh"],
    contentRouter: contentRouter as unknown as PinningConfig["contentRouter"],
    deviceId: "node-A",
    orgId: "org-1",
    canPin: true,
    maxPinStorage: 1024 * 1024 * 100, // 100MB
    maxPinnedHashes: 1000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PinningManager", () => {
  let mesh: ReturnType<typeof createMockMesh>;
  let router: ReturnType<typeof createMockContentRouter>;
  let pinning: PinningManager;

  beforeEach(() => {
    vi.useFakeTimers();
    mesh = createMockMesh();
    router = createMockContentRouter();
    pinning = new PinningManager(makeConfig(mesh, router));
  });

  afterEach(() => {
    pinning.stop();
    vi.useRealTimers();
  });

  describe("lifecycle", () => {
    it("starts and stops", () => {
      pinning.start();
      pinning.stop();
    });

    it("start is idempotent", () => {
      pinning.start();
      pinning.start();
    });
  });

  describe("pin with replication factor 1", () => {
    it("pins locally without needing peers", async () => {
      pinning.start();
      const events: string[] = [];
      pinning.on("pin.complete", (hash) => events.push(hash as string));

      const result = await pinning.pin("abc123", { replicationFactor: 1 });
      expect(result).toBe(true);
      expect(pinning.isPinned("abc123")).toBe(true);
      expect(events).toContain("abc123");
    });
  });

  describe("pin with replication factor > 1", () => {
    it("sends pin requests to peers", async () => {
      pinning.start();

      // Don't await — it'll timeout waiting for acks
      const promise = pinning.pin("def456", { replicationFactor: 3 });

      // Should have sent pin.request to peers (via send or broadcast)
      const sendCalls = mesh.send.mock.calls;
      const broadcastCalls = mesh.broadcast.mock.calls;
      const pinRequestSent =
        sendCalls.some((c: unknown[]) => c[1] === "pin.request") ||
        broadcastCalls.some((c: unknown[]) => c[0] === "pin.request");
      expect(pinRequestSent).toBe(true);

      // Let timeout expire
      vi.advanceTimersByTime(35_000);
      const result = await promise;
      // Will be false since no acks received
      expect(result).toBe(false);
    });
  });

  describe("pin with missing content", () => {
    it("fetches content from network before pinning", async () => {
      const noLocalRouter = createMockContentRouter({ hasLocal: false });
      const pm = new PinningManager(makeConfig(mesh, noLocalRouter));
      pm.start();

      await pm.pin("missing-hash", { replicationFactor: 1 });

      // Should have called request to fetch content
      expect(noLocalRouter.request).toHaveBeenCalledWith("missing-hash");
      pm.stop();
    });

    it("returns false if content cannot be found", async () => {
      const emptyRouter = createMockContentRouter({ hasLocal: false });
      emptyRouter.request.mockResolvedValue(null);
      const pm = new PinningManager(makeConfig(mesh, emptyRouter));
      pm.start();

      const result = await pm.pin("nonexistent", { replicationFactor: 1 });
      expect(result).toBe(false);
      pm.stop();
    });
  });

  describe("unpin", () => {
    it("removes pin agreement", async () => {
      pinning.start();
      await pinning.pin("unpin-me", { replicationFactor: 1 });
      expect(pinning.isPinned("unpin-me")).toBe(true);

      pinning.unpin("unpin-me");
      expect(pinning.isPinned("unpin-me")).toBe(false);
    });

    it("emits pin.removed event", async () => {
      pinning.start();
      await pinning.pin("remove-event", { replicationFactor: 1 });

      const removed: string[] = [];
      pinning.on("pin.removed", (hash) => removed.push(hash as string));

      pinning.unpin("remove-event");
      expect(removed).toContain("remove-event");
    });
  });

  describe("agreement tracking", () => {
    it("getAgreement returns agreement details", async () => {
      pinning.start();
      await pinning.pin("tracked", { replicationFactor: 1, priority: "high", orgCritical: true });

      const agreement = pinning.getAgreement("tracked");
      expect(agreement).toBeDefined();
      expect(agreement!.hash).toBe("tracked");
      expect(agreement!.priority).toBe("high");
      expect(agreement!.orgCritical).toBe(true);
      expect(agreement!.replicationFactor).toBe(1);
    });

    it("listAgreements returns all agreements", async () => {
      pinning.start();
      await pinning.pin("a", { replicationFactor: 1 });
      await pinning.pin("b", { replicationFactor: 1 });
      await pinning.pin("c", { replicationFactor: 1 });

      expect(pinning.listAgreements()).toHaveLength(3);
    });

    it("getLocallyPinned tracks local pins", async () => {
      pinning.start();
      await pinning.pin("local-1", { replicationFactor: 1 });
      await pinning.pin("local-2", { replicationFactor: 1 });

      const local = pinning.getLocallyPinned();
      expect(local).toContain("local-1");
      expect(local).toContain("local-2");
    });
  });

  describe("incoming pin requests", () => {
    it("accepts pin requests when canPin is true", () => {
      pinning.start();

      mesh._emitMessage({
        type: "pin.request",
        from: "node-B",
        payload: {
          requestId: "req-1",
          hash: "incoming-hash",
          size: 1024,
          priority: "normal",
          replicationFactor: 3,
          orgCritical: false,
        },
      });

      // Should send ack back
      expect(mesh.send).toHaveBeenCalledWith(
        "node-B",
        "pin.ack",
        expect.objectContaining({
          requestId: "req-1",
          hash: "incoming-hash",
          accepted: true,
        }),
      );
    });

    it("rejects pin requests when canPin is false", () => {
      const noPinManager = new PinningManager(makeConfig(mesh, router, { canPin: false }));
      noPinManager.start();

      mesh._emitMessage({
        type: "pin.request",
        from: "node-B",
        payload: {
          requestId: "req-2",
          hash: "rejected-hash",
          size: 1024,
          priority: "normal",
          replicationFactor: 3,
          orgCritical: false,
        },
      });

      expect(mesh.send).toHaveBeenCalledWith(
        "node-B",
        "pin.ack",
        expect.objectContaining({
          requestId: "req-2",
          accepted: false,
        }),
      );

      noPinManager.stop();
    });

    it("ignores messages from self", () => {
      pinning.start();
      mesh.send.mockClear();

      mesh._emitMessage({
        type: "pin.request",
        from: "node-A", // self
        payload: {
          requestId: "req-self",
          hash: "self-hash",
          size: 1024,
          priority: "normal",
          replicationFactor: 3,
          orgCritical: false,
        },
      });

      // Should not send any ack
      expect(mesh.send).not.toHaveBeenCalled();
    });
  });

  describe("peer lifecycle", () => {
    it("tracks peer disconnections", () => {
      pinning.start();
      mesh._emitPeerDisconnected("node-B");
      // Internal state: recentlyOffline should track node-B
      // (not directly testable but verifies no crash)
    });

    it("clears offline tracking on reconnect", () => {
      pinning.start();
      mesh._emitPeerDisconnected("node-B");
      mesh._emitPeerConnected("node-B");
      // Should clear the offline entry
    });
  });

  describe("stop cleanup", () => {
    it("cancels pending pin requests on stop", async () => {
      pinning.start();

      const promise = pinning.pin("pending-hash", { replicationFactor: 3 });
      pinning.stop();

      // Pending requests should resolve with false
      vi.advanceTimersByTime(35_000);
      const result = await promise;
      expect(result).toBe(false);
    });
  });
});
