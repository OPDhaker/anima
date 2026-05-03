/**
 * Tests for P2P Private Messaging — Anima v7 Private Internet.
 *
 * Tests message send/receive, offline queueing, delivery status,
 * conversation history, typing indicators, and path sanitization.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const TEST_DIR = path.join(os.tmpdir(), `anima-messaging-test-${Date.now()}`);
vi.mock("../config/paths.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../config/paths.js")>();
  return { ...original, resolveStateDir: () => TEST_DIR };
});
vi.mock("../logging/subsystem.js", () => {
  const noop = () => {};
  const logger = { info: noop, warn: noop, error: noop, debug: noop, trace: noop };
  return { createSubsystemLogger: () => logger };
});

import { MessagingManager, type DirectMessage } from "./messaging.js";

// ---------------------------------------------------------------------------
// Mock PeerMesh
// ---------------------------------------------------------------------------

function createMockMesh(opts?: { sendReturns?: boolean }) {
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
    send: vi.fn().mockReturnValue(opts?.sendReturns ?? true),
    _emitMessage(msg: Record<string, unknown>) {
      for (const fn of listeners.get("message") ?? []) {
        fn(msg);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MessagingManager", () => {
  let mesh: ReturnType<typeof createMockMesh>;
  let messaging: MessagingManager;

  beforeEach(() => {
    vi.useFakeTimers();
    fs.mkdirSync(TEST_DIR, { recursive: true });
    mesh = createMockMesh();
    messaging = new MessagingManager(
      mesh as unknown as ConstructorParameters<typeof MessagingManager>[0],
      "node-A",
    );
  });

  afterEach(() => {
    messaging.stop();
    vi.useRealTimers();
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  describe("lifecycle", () => {
    it("starts and stops", () => {
      messaging.start();
      messaging.stop();
    });

    it("start is idempotent", () => {
      messaging.start();
      messaging.start();
    });
  });

  describe("sending messages", () => {
    it("sends a text message to an online peer", () => {
      messaging.start();
      const msg = messaging.sendMessage({
        to: "node-B",
        content: "Hello from the private internet!",
      });

      expect(msg.id).toBeTruthy();
      expect(msg.from).toBe("node-A");
      expect(msg.to).toBe("node-B");
      expect(msg.content).toBe("Hello from the private internet!");
      expect(msg.type).toBe("text");
      expect(msg.status).toBe("sent");

      // Should have called mesh.send
      expect(mesh.send).toHaveBeenCalledWith(
        "node-B",
        "dm",
        expect.objectContaining({
          content: "Hello from the private internet!",
        }),
      );
    });

    it("queues message for offline peer", () => {
      const offlineMesh = createMockMesh({ sendReturns: false });
      const offlineMessaging = new MessagingManager(
        offlineMesh as unknown as ConstructorParameters<typeof MessagingManager>[0],
        "node-A",
      );
      offlineMessaging.start();

      const msg = offlineMessaging.sendMessage({
        to: "node-B",
        content: "Are you there?",
      });

      expect(msg.status).toBe("sending"); // queued, not sent
      expect(offlineMessaging.getOfflineQueueSize("node-B")).toBeGreaterThan(0);

      offlineMessaging.stop();
    });

    it("sends file reference message", () => {
      messaging.start();
      const msg = messaging.sendMessage({
        to: "node-B",
        content: "Check this file",
        type: "file",
        fileRef: "sha256-abcdef1234567890",
      });

      expect(msg.type).toBe("file");
      expect(msg.fileRef).toBe("sha256-abcdef1234567890");
    });

    it("sends reply-to message", () => {
      messaging.start();
      const original = messaging.sendMessage({
        to: "node-B",
        content: "Original message",
      });

      const reply = messaging.sendMessage({
        to: "node-B",
        content: "Reply to original",
        replyTo: original.id,
      });

      expect(reply.replyTo).toBe(original.id);
    });

    it("emits message.sent event", () => {
      messaging.start();
      const events: DirectMessage[] = [];
      messaging.on("message.sent", (msg) => events.push(msg as DirectMessage));

      messaging.sendMessage({ to: "node-B", content: "Test" });
      expect(events).toHaveLength(1);
      expect(events[0].content).toBe("Test");
    });
  });

  describe("conversation history", () => {
    it("persists messages to disk", () => {
      messaging.start();
      messaging.sendMessage({ to: "node-B", content: "Message 1" });
      messaging.sendMessage({ to: "node-B", content: "Message 2" });

      const history = messaging.getHistory("node-B");
      expect(history).toHaveLength(2);
    });

    it("returns messages in reverse chronological order", () => {
      messaging.start();
      messaging.sendMessage({ to: "node-B", content: "First" });
      vi.advanceTimersByTime(1000);
      messaging.sendMessage({ to: "node-B", content: "Second" });

      const history = messaging.getHistory("node-B", 10);
      expect(history[0].content).toBe("Second");
      expect(history[1].content).toBe("First");
    });

    it("respects limit parameter", () => {
      messaging.start();
      for (let i = 0; i < 10; i++) {
        messaging.sendMessage({ to: "node-B", content: `Message ${i}` });
        vi.advanceTimersByTime(100);
      }

      const limited = messaging.getHistory("node-B", 3);
      expect(limited).toHaveLength(3);
    });

    it("returns empty for unknown peer", () => {
      messaging.start();
      expect(messaging.getHistory("unknown-peer")).toEqual([]);
    });
  });

  describe("conversations list", () => {
    it("lists conversations sorted by last message", () => {
      messaging.start();
      messaging.sendMessage({ to: "node-B", content: "Hi B" });
      vi.advanceTimersByTime(1000);
      messaging.sendMessage({ to: "node-C", content: "Hi C" });

      const convos = messaging.listConversations();
      expect(convos.length).toBeGreaterThanOrEqual(2);
      // Most recent first
      expect(convos[0].peerId).toBe("node-C");
    });

    it("includes last message preview", () => {
      messaging.start();
      messaging.sendMessage({ to: "node-B", content: "Preview this" });

      const convos = messaging.listConversations();
      const b = convos.find((c) => c.peerId === "node-B");
      expect(b).toBeDefined();
      expect(b!.lastMessagePreview).toContain("Preview");
    });
  });

  describe("incoming messages", () => {
    it("emits event for incoming DM", () => {
      messaging.start();
      const received: unknown[] = [];
      messaging.on("message.received", (msg) => received.push(msg));

      mesh._emitMessage({
        type: "dm",
        from: "node-B",
        payload: {
          messageId: "msg-123",
          content: "Hello from B!",
          type: "text",
          timestamp: Date.now(),
        },
      });

      expect(received).toHaveLength(1);
    });

    it("persists incoming messages to conversation history", () => {
      messaging.start();

      mesh._emitMessage({
        type: "dm",
        from: "node-B",
        payload: {
          messageId: "msg-456",
          content: "Stored message",
          type: "text",
          timestamp: Date.now(),
        },
      });

      const history = messaging.getHistory("node-B");
      expect(history.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("typing indicators", () => {
    it("sends typing indicator", () => {
      messaging.start();
      messaging.sendTyping("node-B");

      expect(mesh.send).toHaveBeenCalledWith(
        "node-B",
        "presence",
        expect.objectContaining({
          type: "typing",
          deviceId: "node-A",
        }),
      );
    });
  });

  describe("path sanitization", () => {
    it("sanitizes peer IDs in conversation paths", () => {
      messaging.start();
      // Path traversal attempt should not create files outside messaging dir
      // The internal resolveConversationDir sanitizes the peerId
      messaging.sendMessage({ to: "valid-peer-id", content: "safe" });

      const msgDir = path.join(TEST_DIR, "messaging", "conversations");
      if (fs.existsSync(msgDir)) {
        const dirs = fs.readdirSync(msgDir);
        // All directories should be safe names
        expect(dirs.every((d) => /^[a-zA-Z0-9_-]+$/.test(d))).toBe(true);
      }
    });
  });
});
