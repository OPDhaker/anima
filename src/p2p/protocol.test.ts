/**
 * Tests for P2P Wire Protocol — serialization, deserialization, message factory.
 */

import { describe, it, expect } from "vitest";
import {
  serializeMessage,
  deserializeMessage,
  createMessage,
  type PeerMessage,
  type PeerMessageType,
} from "./protocol.js";

describe("P2P Protocol", () => {
  describe("serializeMessage / deserializeMessage", () => {
    it("round-trips a basic message", () => {
      const msg: PeerMessage = {
        type: "dm",
        id: "msg-001",
        from: "device-A",
        to: "device-B",
        orgId: "org-1",
        payload: { text: "hello" },
        ts: 1710000000000,
        seq: 0,
      };

      const bytes = serializeMessage(msg);
      expect(bytes).toBeInstanceOf(Uint8Array);
      expect(bytes.length).toBeGreaterThan(0);

      const decoded = deserializeMessage(bytes);
      expect(decoded.type).toBe("dm");
      expect(decoded.id).toBe("msg-001");
      expect(decoded.from).toBe("device-A");
      expect(decoded.to).toBe("device-B");
      expect(decoded.orgId).toBe("org-1");
      expect(decoded.ts).toBe(1710000000000);
      expect(decoded.seq).toBe(0);
      expect(decoded.payload).toEqual({ text: "hello" });
    });

    it("round-trips all message types", () => {
      const types: PeerMessageType[] = [
        "dm",
        "broadcast",
        "channel",
        "rpc.request",
        "rpc.response",
        "presence",
        "sync",
        "delegate",
        "escalate",
        "content.announce",
        "content.request",
        "content.response",
        "dns.query",
        "dns.response",
        "dns.register",
        "relay.request",
        "relay.bridge",
        "relay.data",
        "pin.request",
        "pin.ack",
      ];

      for (const type of types) {
        const msg: PeerMessage = {
          type,
          id: `msg-${type}`,
          from: "device-X",
          orgId: "org-1",
          payload: null,
          ts: Date.now(),
          seq: 0,
        };
        const decoded = deserializeMessage(serializeMessage(msg));
        expect(decoded.type).toBe(type);
      }
    });

    it("preserves optional fields", () => {
      const msg: PeerMessage = {
        type: "rpc.response",
        id: "rpc-1",
        from: "device-A",
        orgId: "org-1",
        payload: { result: 42 },
        ts: Date.now(),
        seq: 5,
        replyTo: "rpc-request-1",
      };

      const decoded = deserializeMessage(serializeMessage(msg));
      expect(decoded.replyTo).toBe("rpc-request-1");
    });

    it("handles complex payloads", () => {
      const msg: PeerMessage = {
        type: "sync",
        id: "sync-1",
        from: "device-A",
        orgId: "org-1",
        payload: {
          eventBatch: [
            { eventId: "e1", type: "node:upsert", clock: 1 },
            { eventId: "e2", type: "edge:upsert", clock: 2 },
          ],
          vectorClock: { "device-A": 2, "device-B": 1 },
        },
        ts: Date.now(),
        seq: 10,
      };

      const decoded = deserializeMessage(serializeMessage(msg));
      const payload = decoded.payload as Record<string, unknown>;
      expect(Array.isArray(payload.eventBatch)).toBe(true);
      expect((payload.eventBatch as unknown[]).length).toBe(2);
    });

    it("rejects messages with missing required fields", () => {
      const invalid = new TextEncoder().encode(JSON.stringify({ type: "dm" }));
      expect(() => deserializeMessage(invalid)).toThrow("missing required fields");
    });

    it("rejects non-JSON data", () => {
      const garbage = new TextEncoder().encode("not json at all");
      expect(() => deserializeMessage(garbage)).toThrow();
    });

    it("rejects empty data", () => {
      expect(() => deserializeMessage(new Uint8Array(0))).toThrow();
    });
  });

  describe("createMessage", () => {
    it("creates a message with auto-generated id and timestamp", () => {
      const msg = createMessage("dm", "device-A", "org-1", { text: "hi" }, { to: "device-B" });

      expect(msg.type).toBe("dm");
      expect(msg.from).toBe("device-A");
      expect(msg.orgId).toBe("org-1");
      expect(msg.to).toBe("device-B");
      expect(msg.id).toMatch(/^[0-9a-f-]{36}$/); // UUID format
      expect(msg.ts).toBeGreaterThan(0);
      expect(typeof msg.seq).toBe("number");
      expect(msg.payload).toEqual({ text: "hi" });
    });

    it("increments sequence numbers", () => {
      const msg1 = createMessage("broadcast", "device-A", "org-1", null);
      const msg2 = createMessage("broadcast", "device-A", "org-1", null);
      expect(msg2.seq).toBeGreaterThan(msg1.seq);
    });

    it("sets replyTo when provided", () => {
      const msg = createMessage(
        "rpc.response",
        "device-A",
        "org-1",
        { result: "ok" },
        {
          replyTo: "request-123",
        },
      );
      expect(msg.replyTo).toBe("request-123");
    });

    it("omits optional fields when not provided", () => {
      const msg = createMessage("presence", "device-A", "org-1", {});
      expect(msg.to).toBeUndefined();
      expect(msg.replyTo).toBeUndefined();
    });
  });
});
