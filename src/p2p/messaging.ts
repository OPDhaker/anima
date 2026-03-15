/**
 * P2P Private Messaging — Anima v7 Private Internet
 *
 * Direct peer-to-peer messaging with no central server:
 * - E2E encrypted via the mesh transport
 * - Offline store-and-forward: peers queue messages for offline recipients
 * - Delivery confirmations and read receipts
 * - Typing indicators via presence
 * - Message history stored in content router (encrypted, pinned)
 *
 * Builds on protocol.ts message types: dm, channel, presence.
 */

import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import type { PeerMesh } from "./mesh.js";
import type { PeerMessage } from "./protocol.js";
import { resolveStateDir } from "../config/paths.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("p2p-messaging");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DirectMessage {
  /** Unique message ID */
  id: string;
  /** Sender deviceId */
  from: string;
  /** Recipient deviceId */
  to: string;
  /** Message content (plaintext — encryption handled by transport) */
  content: string;
  /** Timestamp (unix ms) */
  timestamp: number;
  /** Message type */
  type: "text" | "file" | "system";
  /** Optional file reference (content hash from file-share) */
  fileRef?: string;
  /** Delivery status */
  status: "sending" | "sent" | "delivered" | "read" | "failed";
  /** Reply-to message ID */
  replyTo?: string;
}

export interface Conversation {
  /** Peer deviceId */
  peerId: string;
  /** Display name (if known) */
  peerName?: string;
  /** Last message timestamp */
  lastMessageAt: number;
  /** Unread message count */
  unreadCount: number;
  /** Last message preview */
  lastMessagePreview?: string;
}

export interface OfflineQueueEntry {
  /** Target deviceId */
  targetId: string;
  /** The queued message */
  message: DirectMessage;
  /** When we queued it */
  queuedAt: number;
  /** Delivery attempts */
  attempts: number;
}

export interface PresenceUpdate {
  type: "typing" | "stopped_typing" | "online" | "offline";
  deviceId: string;
  conversationWith?: string;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

function resolveMessagingDir(): string {
  return path.join(resolveStateDir(), "messaging");
}

function resolveConversationDir(peerId: string): string {
  const sanitized = peerId.replace(/[^a-zA-Z0-9_-]/g, "");
  if (!sanitized) {
    throw new Error("Invalid peer ID");
  }
  return path.join(resolveMessagingDir(), "conversations", sanitized);
}

function resolveOfflineQueueDir(): string {
  return path.join(resolveMessagingDir(), "offline-queue");
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}

// ---------------------------------------------------------------------------
// MessagingManager
// ---------------------------------------------------------------------------

export class MessagingManager extends EventEmitter {
  private readonly mesh: PeerMesh;
  private readonly deviceId: string;
  private running = false;
  private deliveryCheckInterval?: ReturnType<typeof setInterval>;

  /** Messages queued for offline peers */
  private offlineQueue: Map<string, OfflineQueueEntry[]> = new Map();

  constructor(mesh: PeerMesh, deviceId: string) {
    super();
    this.mesh = mesh;
    this.deviceId = deviceId;
    ensureDir(resolveMessagingDir());
    ensureDir(resolveOfflineQueueDir());
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;

    this.mesh.on("message", this.handleMessage);

    // Periodically try to deliver queued messages
    this.deliveryCheckInterval = setInterval(() => {
      void this.processOfflineQueue();
    }, 30_000);

    this.loadOfflineQueue();
    log.info("messaging manager started");
  }

  stop(): void {
    this.running = false;
    this.mesh.off("message", this.handleMessage);

    if (this.deliveryCheckInterval) {
      clearInterval(this.deliveryCheckInterval);
      this.deliveryCheckInterval = undefined;
    }

    this.saveOfflineQueue();
    log.info("messaging manager stopped");
  }

  // -----------------------------------------------------------------------
  // Send
  // -----------------------------------------------------------------------

  /**
   * Send a direct message to a peer.
   * If the peer is offline, the message is queued for later delivery.
   */
  sendMessage(params: {
    to: string;
    content: string;
    type?: DirectMessage["type"];
    fileRef?: string;
    replyTo?: string;
  }): DirectMessage {
    const msg: DirectMessage = {
      id: crypto.randomUUID(),
      from: this.deviceId,
      to: params.to,
      content: params.content,
      timestamp: Date.now(),
      type: params.type ?? "text",
      fileRef: params.fileRef,
      status: "sending",
      replyTo: params.replyTo,
    };

    // Try direct delivery
    const sent = this.mesh.send(params.to, "dm" as Parameters<typeof this.mesh.send>[1], {
      messageId: msg.id,
      content: msg.content,
      type: msg.type,
      fileRef: msg.fileRef,
      replyTo: msg.replyTo,
      timestamp: msg.timestamp,
    });

    if (sent) {
      msg.status = "sent";
      log.info(`message sent to ${params.to}: ${msg.id}`);
    } else {
      // Peer is offline — queue for later
      msg.status = "sending";
      this.queueForOffline(msg);
      log.info(`message queued for offline peer ${params.to}: ${msg.id}`);
    }

    // Persist to conversation history
    this.persistMessage(msg);
    this.emit("message.sent", msg);

    return msg;
  }

  /**
   * Send a typing indicator.
   */
  sendTyping(to: string): void {
    this.mesh.send(to, "presence" as Parameters<typeof this.mesh.send>[1], {
      type: "typing",
      deviceId: this.deviceId,
      conversationWith: to,
      timestamp: Date.now(),
    });
  }

  /**
   * Mark messages as read.
   */
  markAsRead(peerId: string, messageIds: string[]): void {
    this.mesh.send(peerId, "dm" as Parameters<typeof this.mesh.send>[1], {
      type: "read_receipt",
      messageIds,
      readBy: this.deviceId,
      timestamp: Date.now(),
    });

    // Update local status
    for (const id of messageIds) {
      this.updateMessageStatus(peerId, id, "read");
    }
  }

  // -----------------------------------------------------------------------
  // Query
  // -----------------------------------------------------------------------

  /**
   * Get conversation history with a peer.
   */
  getHistory(peerId: string, limit = 50, before?: number): DirectMessage[] {
    const dir = resolveConversationDir(peerId);
    try {
      if (!fs.existsSync(dir)) {
        return [];
      }

      const files = fs
        .readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .toSorted()
        .toReversed(); // newest first

      const messages: DirectMessage[] = [];
      for (const f of files) {
        if (messages.length >= limit) {
          break;
        }
        try {
          const msg = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as DirectMessage;
          if (before && msg.timestamp >= before) {
            continue;
          }
          messages.push(msg);
        } catch {
          // skip corrupt
        }
      }
      return messages;
    } catch {
      return [];
    }
  }

  /**
   * List all conversations.
   */
  listConversations(): Conversation[] {
    const baseDir = path.join(resolveMessagingDir(), "conversations");
    try {
      if (!fs.existsSync(baseDir)) {
        return [];
      }

      return fs
        .readdirSync(baseDir)
        .filter((d) => {
          const stat = fs.statSync(path.join(baseDir, d));
          return stat.isDirectory();
        })
        .map((peerId) => {
          const messages = this.getHistory(peerId, 1);
          const last = messages[0];
          return {
            peerId,
            lastMessageAt: last?.timestamp ?? 0,
            unreadCount: this.countUnread(peerId),
            lastMessagePreview: last?.content?.slice(0, 100),
          };
        })
        .filter((c) => c.lastMessageAt > 0)
        .toSorted((a, b) => b.lastMessageAt - a.lastMessageAt);
    } catch {
      return [];
    }
  }

  /**
   * Get the offline queue size for a peer.
   */
  getOfflineQueueSize(peerId?: string): number {
    if (peerId) {
      return this.offlineQueue.get(peerId)?.length ?? 0;
    }
    let total = 0;
    for (const entries of this.offlineQueue.values()) {
      total += entries.length;
    }
    return total;
  }

  // -----------------------------------------------------------------------
  // Private — message handling
  // -----------------------------------------------------------------------

  private handleMessage = (msg: PeerMessage): void => {
    if (msg.from === this.deviceId) {
      return;
    }

    const payload = msg.payload as Record<string, unknown>;

    if (msg.type === "dm") {
      if (payload.type === "read_receipt") {
        this.handleReadReceipt(msg.from, payload);
      } else {
        this.handleIncomingMessage(msg.from, payload);
      }
    } else if (msg.type === "presence") {
      this.handlePresence(payload);
    }
  };

  private handleIncomingMessage(from: string, payload: Record<string, unknown>): void {
    const msg: DirectMessage = {
      id: String(payload.messageId ?? crypto.randomUUID()),
      from,
      to: this.deviceId,
      content: String(payload.content ?? ""),
      timestamp: typeof payload.timestamp === "number" ? payload.timestamp : Date.now(),
      type: (payload.type as DirectMessage["type"]) ?? "text",
      fileRef: typeof payload.fileRef === "string" ? payload.fileRef : undefined,
      status: "delivered",
      replyTo: typeof payload.replyTo === "string" ? payload.replyTo : undefined,
    };

    this.persistMessage(msg);

    // Send delivery confirmation
    this.mesh.send(from, "dm" as Parameters<typeof this.mesh.send>[1], {
      type: "delivery_receipt",
      messageId: msg.id,
      deliveredAt: Date.now(),
    });

    log.info(`message received from ${from}: ${msg.id}`);
    this.emit("message.received", msg);
  }

  private handleReadReceipt(from: string, payload: Record<string, unknown>): void {
    const messageIds = Array.isArray(payload.messageIds) ? payload.messageIds : [];
    for (const id of messageIds) {
      if (typeof id === "string") {
        this.updateMessageStatus(from, id, "read");
      }
    }
    this.emit("message.read", { from, messageIds });
  }

  private handlePresence(payload: Record<string, unknown>): void {
    const update: PresenceUpdate = {
      type: (payload.type as PresenceUpdate["type"]) ?? "online",
      deviceId: String(payload.deviceId ?? ""),
      conversationWith:
        typeof payload.conversationWith === "string" ? payload.conversationWith : undefined,
      timestamp: typeof payload.timestamp === "number" ? payload.timestamp : Date.now(),
    };
    this.emit("presence", update);
  }

  // -----------------------------------------------------------------------
  // Private — persistence
  // -----------------------------------------------------------------------

  private persistMessage(msg: DirectMessage): void {
    const peerId = msg.from === this.deviceId ? msg.to : msg.from;
    const dir = resolveConversationDir(peerId);
    ensureDir(dir);

    // Use timestamp + ID for ordering
    const filename = `${msg.timestamp}-${msg.id.slice(0, 8)}.json`;
    const filePath = path.join(dir, filename);
    fs.writeFileSync(filePath, `${JSON.stringify(msg, null, 2)}\n`, { mode: 0o600 });
  }

  private updateMessageStatus(
    peerId: string,
    messageId: string,
    status: DirectMessage["status"],
  ): void {
    const dir = resolveConversationDir(peerId);
    try {
      const files = fs.readdirSync(dir).filter((f) => f.includes(messageId.slice(0, 8)));
      for (const f of files) {
        try {
          const filePath = path.join(dir, f);
          const msg = JSON.parse(fs.readFileSync(filePath, "utf8")) as DirectMessage;
          msg.status = status;
          fs.writeFileSync(filePath, `${JSON.stringify(msg, null, 2)}\n`, { mode: 0o600 });
        } catch {
          // skip
        }
      }
    } catch {
      // dir doesn't exist
    }
  }

  private countUnread(peerId: string): number {
    const dir = resolveConversationDir(peerId);
    try {
      if (!fs.existsSync(dir)) {
        return 0;
      }
      let count = 0;
      for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
        try {
          const msg = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as DirectMessage;
          if (msg.from !== this.deviceId && msg.status !== "read") {
            count++;
          }
        } catch {
          // skip
        }
      }
      return count;
    } catch {
      return 0;
    }
  }

  // -----------------------------------------------------------------------
  // Private — offline queue
  // -----------------------------------------------------------------------

  private queueForOffline(msg: DirectMessage): void {
    const entries = this.offlineQueue.get(msg.to) ?? [];
    entries.push({
      targetId: msg.to,
      message: msg,
      queuedAt: Date.now(),
      attempts: 0,
    });
    this.offlineQueue.set(msg.to, entries);
    this.saveOfflineQueue();
  }

  private async processOfflineQueue(): Promise<void> {
    for (const [targetId, entries] of this.offlineQueue) {
      const remaining: OfflineQueueEntry[] = [];

      for (const entry of entries) {
        entry.attempts++;

        const sent = this.mesh.send(targetId, "dm" as Parameters<typeof this.mesh.send>[1], {
          messageId: entry.message.id,
          content: entry.message.content,
          type: entry.message.type,
          fileRef: entry.message.fileRef,
          replyTo: entry.message.replyTo,
          timestamp: entry.message.timestamp,
          queued: true,
        });

        if (sent) {
          entry.message.status = "sent";
          this.persistMessage(entry.message);
          log.info(`queued message delivered to ${targetId}: ${entry.message.id}`);
        } else if (entry.attempts < 100) {
          // Keep trying (100 attempts * 30s interval = ~50 minutes)
          remaining.push(entry);
        } else {
          // Give up
          entry.message.status = "failed";
          this.persistMessage(entry.message);
          log.warn(`message delivery failed after 100 attempts: ${entry.message.id}`);
          this.emit("message.failed", entry.message);
        }
      }

      if (remaining.length > 0) {
        this.offlineQueue.set(targetId, remaining);
      } else {
        this.offlineQueue.delete(targetId);
      }
    }
    this.saveOfflineQueue();
  }

  private saveOfflineQueue(): void {
    const dir = resolveOfflineQueueDir();
    ensureDir(dir);
    const data: OfflineQueueEntry[] = [];
    for (const entries of this.offlineQueue.values()) {
      data.push(...entries);
    }
    fs.writeFileSync(path.join(dir, "queue.json"), `${JSON.stringify(data, null, 2)}\n`, {
      mode: 0o600,
    });
  }

  private loadOfflineQueue(): void {
    try {
      const raw = fs.readFileSync(path.join(resolveOfflineQueueDir(), "queue.json"), "utf8");
      const entries = JSON.parse(raw) as OfflineQueueEntry[];
      this.offlineQueue.clear();
      for (const entry of entries) {
        const existing = this.offlineQueue.get(entry.targetId) ?? [];
        existing.push(entry);
        this.offlineQueue.set(entry.targetId, existing);
      }
      log.info(`loaded ${entries.length} queued messages`);
    } catch {
      // no queue
    }
  }
}
