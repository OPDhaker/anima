/**
 * Tests for Relay Nodes — NAT traversal via peer relay.
 *
 * Tests relay establishment, data forwarding, session cleanup,
 * bandwidth tracking, and edge cases (max sessions, disabled relay, etc.)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RelayManager, type RelayConfig } from "./relay.js";

// ---------------------------------------------------------------------------
// Mock PeerMesh
// ---------------------------------------------------------------------------

function createMockMesh(opts?: { connectedPeers?: string[]; sendReturns?: boolean }) {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();

  const mesh = {
    on(event: string, fn: (...args: unknown[]) => void) {
      if (!listeners.has(event)) {
        listeners.set(event, new Set());
      }
      listeners.get(event)!.add(fn);
    },
    off(event: string, fn: (...args: unknown[]) => void) {
      listeners.get(event)?.delete(fn);
    },
    send: vi.fn().mockReturnValue(opts?.sendReturns ?? true),
    isConnectedTo: vi.fn((deviceId: string) => (opts?.connectedPeers ?? []).includes(deviceId)),
    listPeers: vi.fn(() => (opts?.connectedPeers ?? []).map((id) => ({ deviceId: id }))),
    // Test helper — simulate incoming message
    _emitMessage(msg: Record<string, unknown>) {
      for (const fn of listeners.get("message") ?? []) {
        fn(msg);
      }
    },
  };
  return mesh;
}

function makeRelayConfig(
  mesh: ReturnType<typeof createMockMesh>,
  overrides?: Partial<RelayConfig>,
): RelayConfig {
  return {
    mesh: mesh as unknown as RelayConfig["mesh"],
    deviceId: "node-A",
    orgId: "org-1",
    canRelay: true,
    maxRelaySessions: 20,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RelayManager", () => {
  let mesh: ReturnType<typeof createMockMesh>;
  let relay: RelayManager;

  beforeEach(() => {
    vi.useFakeTimers();
    mesh = createMockMesh({ connectedPeers: ["node-B", "node-C"] });
    relay = new RelayManager(makeRelayConfig(mesh));
  });

  afterEach(() => {
    relay.stop();
    vi.useRealTimers();
  });

  describe("lifecycle", () => {
    it("starts and stops without errors", () => {
      relay.start();
      expect(relay.getActiveSessions()).toHaveLength(0);
      relay.stop();
    });

    it("calling start() twice is idempotent", () => {
      relay.start();
      relay.start();
      expect(relay.getActiveSessions()).toHaveLength(0);
    });

    it("calling stop() before start() is safe", () => {
      relay.stop(); // should not throw
    });
  });

  describe("relay request handling", () => {
    it("accepts relay request when canRelay is true and target is connected", () => {
      relay.start();
      const events: unknown[] = [];
      relay.on("relay.serving", (s) => events.push(s));

      mesh._emitMessage({
        type: "relay.request",
        from: "node-B",
        payload: {
          sessionId: "sess-1",
          targetDeviceId: "node-C",
          requesterId: "node-B",
        },
      });

      expect(events).toHaveLength(1);
      expect(relay.getActiveSessions()).toHaveLength(1);
      const session = relay.getActiveSessions()[0];
      expect(session.initiator).toBe("node-B");
      expect(session.target).toBe("node-C");
      expect(session.relayNode).toBe("node-A");
    });

    it("rejects relay request when canRelay is false", () => {
      relay.stop();
      relay = new RelayManager(makeRelayConfig(mesh, { canRelay: false }));
      relay.start();

      mesh._emitMessage({
        type: "relay.request",
        from: "node-B",
        payload: {
          sessionId: "sess-1",
          targetDeviceId: "node-C",
          requesterId: "node-B",
        },
      });

      expect(relay.getActiveSessions()).toHaveLength(0);
      // Should have sent a decline
      expect(mesh.send).toHaveBeenCalledWith(
        "node-B",
        "relay.bridge",
        expect.objectContaining({ accepted: false, reason: "relaying disabled" }),
      );
    });

    it("rejects relay request when max sessions reached", () => {
      relay.stop();
      relay = new RelayManager(makeRelayConfig(mesh, { maxRelaySessions: 1 }));
      relay.start();

      // Fill the one slot
      mesh._emitMessage({
        type: "relay.request",
        from: "node-B",
        payload: { sessionId: "sess-1", targetDeviceId: "node-C", requesterId: "node-B" },
      });
      expect(relay.getActiveSessions()).toHaveLength(1);

      // Second request should be rejected
      mesh._emitMessage({
        type: "relay.request",
        from: "node-B",
        payload: { sessionId: "sess-2", targetDeviceId: "node-C", requesterId: "node-B" },
      });
      expect(relay.getActiveSessions()).toHaveLength(1);
    });

    it("rejects relay request when not connected to target", () => {
      relay.start();
      mesh.isConnectedTo.mockReturnValue(false);

      mesh._emitMessage({
        type: "relay.request",
        from: "node-B",
        payload: { sessionId: "sess-1", targetDeviceId: "node-D", requesterId: "node-B" },
      });

      expect(relay.getActiveSessions()).toHaveLength(0);
      expect(mesh.send).toHaveBeenCalledWith(
        "node-B",
        "relay.bridge",
        expect.objectContaining({ accepted: false, reason: "not connected to target" }),
      );
    });

    it("ignores messages from self", () => {
      relay.start();

      mesh._emitMessage({
        type: "relay.request",
        from: "node-A", // self
        payload: { sessionId: "sess-1", targetDeviceId: "node-C", requesterId: "node-A" },
      });

      expect(relay.getActiveSessions()).toHaveLength(0);
    });

    it("ignores malformed relay requests", () => {
      relay.start();

      mesh._emitMessage({
        type: "relay.request",
        from: "node-B",
        payload: {}, // missing fields
      });

      expect(relay.getActiveSessions()).toHaveLength(0);
    });
  });

  describe("data forwarding", () => {
    it("forwards data from initiator to target", () => {
      relay.start();

      // Establish a session
      mesh._emitMessage({
        type: "relay.request",
        from: "node-B",
        payload: { sessionId: "sess-1", targetDeviceId: "node-C", requesterId: "node-B" },
      });

      // Forward data from initiator (node-B) to target (node-C)
      mesh._emitMessage({
        type: "relay.data",
        from: "node-B",
        payload: {
          sessionId: "sess-1",
          fromDeviceId: "node-B",
          toDeviceId: "node-C",
          data: Buffer.from("hello").toString("base64"),
        },
      });

      // Should forward to node-C
      expect(mesh.send).toHaveBeenCalledWith(
        "node-C",
        "relay.data",
        expect.objectContaining({
          sessionId: "sess-1",
          fromDeviceId: "node-B",
          toDeviceId: "node-C",
        }),
      );
    });

    it("forwards data from target back to initiator", () => {
      relay.start();

      mesh._emitMessage({
        type: "relay.request",
        from: "node-B",
        payload: { sessionId: "sess-1", targetDeviceId: "node-C", requesterId: "node-B" },
      });

      // Data from target (node-C) to initiator (node-B)
      mesh._emitMessage({
        type: "relay.data",
        from: "node-C",
        payload: {
          sessionId: "sess-1",
          fromDeviceId: "node-C",
          toDeviceId: "node-B",
          data: Buffer.from("world").toString("base64"),
        },
      });

      expect(mesh.send).toHaveBeenCalledWith(
        "node-B",
        "relay.data",
        expect.objectContaining({
          sessionId: "sess-1",
          fromDeviceId: "node-C",
          toDeviceId: "node-B",
        }),
      );
    });

    it("tracks bytes forwarded on the session", () => {
      relay.start();

      mesh._emitMessage({
        type: "relay.request",
        from: "node-B",
        payload: { sessionId: "sess-1", targetDeviceId: "node-C", requesterId: "node-B" },
      });

      const testData = Buffer.from("test-payload-16b");
      mesh._emitMessage({
        type: "relay.data",
        from: "node-B",
        payload: {
          sessionId: "sess-1",
          fromDeviceId: "node-B",
          toDeviceId: "node-C",
          data: testData.toString("base64"),
        },
      });

      const session = relay.getActiveSessions()[0];
      expect(session.bytesForwarded).toBe(testData.length);
    });
  });

  describe("sendViaRelay", () => {
    it("returns false for unknown session", () => {
      relay.start();
      expect(relay.sendViaRelay("nonexistent", Buffer.from("test"))).toBe(false);
    });
  });

  describe("closeSession", () => {
    it("removes session and emits event", () => {
      relay.start();
      const closed: string[] = [];
      relay.on("relay.closed", (id) => closed.push(id as string));

      mesh._emitMessage({
        type: "relay.request",
        from: "node-B",
        payload: { sessionId: "sess-1", targetDeviceId: "node-C", requesterId: "node-B" },
      });
      expect(relay.getActiveSessions()).toHaveLength(1);

      relay.closeSession("sess-1");
      expect(relay.getActiveSessions()).toHaveLength(0);
      expect(closed).toContain("sess-1");
    });
  });

  describe("session cleanup", () => {
    it("cleans up idle sessions after timeout", () => {
      relay.start();

      mesh._emitMessage({
        type: "relay.request",
        from: "node-B",
        payload: { sessionId: "sess-1", targetDeviceId: "node-C", requesterId: "node-B" },
      });
      expect(relay.getActiveSessions()).toHaveLength(1);

      // Advance time past 5-minute idle timeout + cleanup interval
      vi.advanceTimersByTime(330_000); // 5.5 minutes

      expect(relay.getActiveSessions()).toHaveLength(0);
    });

    it("does not clean up active sessions", () => {
      relay.start();

      mesh._emitMessage({
        type: "relay.request",
        from: "node-B",
        payload: { sessionId: "sess-1", targetDeviceId: "node-C", requesterId: "node-B" },
      });

      // Send some data to keep session alive
      vi.advanceTimersByTime(100_000);
      mesh._emitMessage({
        type: "relay.data",
        from: "node-B",
        payload: {
          sessionId: "sess-1",
          fromDeviceId: "node-B",
          toDeviceId: "node-C",
          data: Buffer.from("keepalive").toString("base64"),
        },
      });

      // Advance another 100s — session should still be alive (last activity was recent)
      vi.advanceTimersByTime(100_000);
      expect(relay.getActiveSessions()).toHaveLength(1);
    });
  });

  describe("bandwidth tracking", () => {
    it("tracks bandwidth per peer", () => {
      relay.start();

      mesh._emitMessage({
        type: "relay.request",
        from: "node-B",
        payload: { sessionId: "sess-1", targetDeviceId: "node-C", requesterId: "node-B" },
      });

      mesh._emitMessage({
        type: "relay.data",
        from: "node-B",
        payload: {
          sessionId: "sess-1",
          fromDeviceId: "node-B",
          toDeviceId: "node-C",
          data: Buffer.from("x".repeat(1000)).toString("base64"),
        },
      });

      const records = relay.getBandwidthRecords();
      expect(records.length).toBeGreaterThan(0);
      const bRecord = records.find((r) => r.peerId === "node-B");
      expect(bRecord).toBeDefined();
      expect(bRecord!.sessionsServed).toBe(1);
      expect(bRecord!.bytesRelayed).toBe(1000);
    });

    it("emits bandwidth report on interval", () => {
      relay.start();
      const reports: unknown[] = [];
      relay.on("relay.bandwidth", (r) => reports.push(r));

      // Create a session and send data
      mesh._emitMessage({
        type: "relay.request",
        from: "node-B",
        payload: { sessionId: "sess-1", targetDeviceId: "node-C", requesterId: "node-B" },
      });
      mesh._emitMessage({
        type: "relay.data",
        from: "node-B",
        payload: {
          sessionId: "sess-1",
          fromDeviceId: "node-B",
          toDeviceId: "node-C",
          data: Buffer.from("data").toString("base64"),
        },
      });

      // Advance to bandwidth report interval (60s)
      vi.advanceTimersByTime(60_000);
      expect(reports.length).toBeGreaterThan(0);
    });
  });

  describe("latency tracking", () => {
    it("prefers lowest-latency candidates for relay selection", () => {
      const mesh3 = createMockMesh({
        connectedPeers: ["node-B", "node-C", "node-D"],
      });
      const relay3 = new RelayManager(makeRelayConfig(mesh3));
      relay3.start();

      // Set latencies: node-C is fastest, node-B is slowest
      relay3.updateLatency("node-B", 200);
      relay3.updateLatency("node-C", 10);
      relay3.updateLatency("node-D", 50);

      // Kick off a relay request (don't await — it'll timeout)
      void relay3.requestRelay("node-E");

      // The first candidate tried should be node-C (lowest latency)
      expect(mesh3.send).toHaveBeenCalledWith(
        "node-C",
        "relay.request",
        expect.objectContaining({ targetDeviceId: "node-E" }),
      );

      relay3.stop();
    });
  });

  describe("requestRelay", () => {
    it("returns null when no peers are connected", async () => {
      vi.useRealTimers(); // requestRelay uses real async
      const emptyMesh = createMockMesh({ connectedPeers: [] });
      const emptyRelay = new RelayManager(makeRelayConfig(emptyMesh));
      emptyRelay.start();

      const result = await emptyRelay.requestRelay("node-X");
      expect(result).toBeNull();
      emptyRelay.stop();
      vi.useFakeTimers();
    });

    it("returns null when send fails", async () => {
      vi.useRealTimers();
      const failMesh = createMockMesh({
        connectedPeers: ["node-B"],
        sendReturns: false,
      });
      const failRelay = new RelayManager(makeRelayConfig(failMesh));
      failRelay.start();

      const result = await failRelay.requestRelay("node-X");
      expect(result).toBeNull();
      failRelay.stop();
      vi.useFakeTimers();
    });
  });

  describe("stop() cleans up pending requests", () => {
    it("resolves pending requests with null on stop", async () => {
      vi.useRealTimers();
      relay = new RelayManager(makeRelayConfig(mesh));
      relay.start();

      const promise = relay.requestRelay("node-X");
      relay.stop();

      const result = await promise;
      expect(result).toBeNull();
      vi.useFakeTimers();
    });
  });
});
