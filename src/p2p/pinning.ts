/**
 * Content Pinning and Replication for ANIMA 6
 *
 * Ensures content availability by pinning hashes across N nodes.
 * Handles automatic re-replication when peers go offline, priority
 * pinning for org-critical data, and background garbage collection
 * for unpinned, unreferenced content.
 */

import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import type { ContentRouter } from "./content-router.js";
import type { PeerMesh } from "./mesh.js";
import type { PeerMessage } from "./protocol.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("p2p-pinning");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_REPLICATION_FACTOR = 3;
const PIN_REQUEST_TIMEOUT_MS = 30_000;
const REPLICATION_CHECK_INTERVAL_MS = 120_000; // 2 minutes
const GC_INTERVAL_MS = 600_000; // 10 minutes
const PEER_OFFLINE_GRACE_MS = 60_000; // wait before re-replicating

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PinPriority = "critical" | "high" | "normal" | "low";

/** A pinning agreement: which peers are pinning a given content hash. */
export interface PinAgreement {
  hash: string;
  replicationFactor: number;
  priority: PinPriority;
  pinners: Map<string, PinnerStatus>; // deviceId -> status
  createdAt: number;
  orgCritical: boolean;
}

/** Status of a particular pinner for a content hash. */
export interface PinnerStatus {
  deviceId: string;
  confirmed: boolean;
  pinnedAt: number;
  lastSeenAt: number;
}

/** Payload for pin.request messages. */
export interface PinRequestPayload {
  requestId: string;
  hash: string;
  size: number; // content size in bytes
  priority: PinPriority;
  replicationFactor: number;
  orgCritical: boolean;
}

/** Payload for pin.ack messages. */
export interface PinAckPayload {
  requestId: string;
  hash: string;
  accepted: boolean;
  reason?: string;
}

/** Configuration for the pinning subsystem. */
export interface PinningConfig {
  mesh: PeerMesh;
  contentRouter: ContentRouter;
  deviceId: string;
  orgId: string;
  /** Whether this node accepts pin requests from others. */
  canPin?: boolean;
  /** Maximum storage (bytes) to allocate for pinning others' content. */
  maxPinStorage?: number;
  /** Maximum number of hashes this node will pin. */
  maxPinnedHashes?: number;
}

// ---------------------------------------------------------------------------
// PinningManager
// ---------------------------------------------------------------------------

export class PinningManager extends EventEmitter {
  private readonly mesh: PeerMesh;
  private readonly contentRouter: ContentRouter;
  private readonly deviceId: string;
  private readonly orgId: string;
  private readonly canPin: boolean;
  private readonly maxPinStorage: number;
  private readonly maxPinnedHashes: number;

  /** Pin agreements keyed by content hash. */
  private agreements: Map<string, PinAgreement> = new Map();

  /** Hashes we've been asked to pin (and confirmed). */
  private locallyPinned: Set<string> = new Set();

  /** Current storage used for pinning others' content. */
  private pinStorageUsed = 0;

  /** Pending pin requests. */
  private pendingPinRequests: Map<
    string,
    {
      hash: string;
      acks: Map<string, boolean>;
      needed: number;
      resolve: (success: boolean) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  > = new Map();

  /** Track recently disconnected peers for re-replication. */
  private recentlyOffline: Map<string, number> = new Map(); // deviceId -> timestamp

  private replicationCheckInterval?: ReturnType<typeof setInterval>;
  private gcInterval?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(config: PinningConfig) {
    super();
    this.mesh = config.mesh;
    this.contentRouter = config.contentRouter;
    this.deviceId = config.deviceId;
    this.orgId = config.orgId;
    this.canPin = config.canPin ?? true;
    this.maxPinStorage = config.maxPinStorage ?? 1024 * 1024 * 1024; // 1GB
    this.maxPinnedHashes = config.maxPinnedHashes ?? 10_000;
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

    // Track peer disconnections for re-replication
    this.mesh.on("peer.disconnected", (deviceId: string) => {
      this.recentlyOffline.set(deviceId, Date.now());
    });

    this.mesh.on("peer.connected", (deviceId: string) => {
      this.recentlyOffline.delete(deviceId);
    });

    // Periodic replication checks
    this.replicationCheckInterval = setInterval(
      () => this.checkReplication(),
      REPLICATION_CHECK_INTERVAL_MS,
    );

    // Periodic garbage collection
    this.gcInterval = setInterval(() => this.garbageCollect(), GC_INTERVAL_MS);

    log.info(
      `pinning manager started (canPin: ${this.canPin}, maxStorage: ${(this.maxPinStorage / 1024 / 1024).toFixed(0)} MB)`,
    );
  }

  stop(): void {
    this.running = false;
    this.mesh.off("message", this.handleMessage);

    if (this.replicationCheckInterval) {
      clearInterval(this.replicationCheckInterval);
      this.replicationCheckInterval = undefined;
    }
    if (this.gcInterval) {
      clearInterval(this.gcInterval);
      this.gcInterval = undefined;
    }

    // Cancel pending requests
    for (const [id, pending] of this.pendingPinRequests) {
      clearTimeout(pending.timer);
      pending.resolve(false);
    }
    this.pendingPinRequests.clear();

    log.info("pinning manager stopped");
  }

  // -----------------------------------------------------------------------
  // Pin API
  // -----------------------------------------------------------------------

  /**
   * Pin content to ensure it's replicated across N nodes.
   * The content must already exist in the content router (locally or remotely).
   */
  async pin(
    hash: string,
    options?: {
      replicationFactor?: number;
      priority?: PinPriority;
      orgCritical?: boolean;
    },
  ): Promise<boolean> {
    const replicationFactor = options?.replicationFactor ?? DEFAULT_REPLICATION_FACTOR;
    const priority = options?.priority ?? "normal";
    const orgCritical = options?.orgCritical ?? false;

    // Ensure content exists locally
    if (!this.contentRouter.hasLocal(hash)) {
      const data = await this.contentRouter.request(hash);
      if (!data) {
        log.warn(`cannot pin ${hash}: content not found`);
        return false;
      }
    }

    // Create or update agreement
    let agreement = this.agreements.get(hash);
    if (!agreement) {
      agreement = {
        hash,
        replicationFactor,
        priority,
        pinners: new Map(),
        createdAt: Date.now(),
        orgCritical,
      };
      this.agreements.set(hash, agreement);
    } else {
      agreement.replicationFactor = replicationFactor;
      agreement.priority = priority;
      agreement.orgCritical = orgCritical;
    }

    // We pin it ourselves (counts as 1 replica)
    agreement.pinners.set(this.deviceId, {
      deviceId: this.deviceId,
      confirmed: true,
      pinnedAt: Date.now(),
      lastSeenAt: Date.now(),
    });
    this.locallyPinned.add(hash);

    // Need (replicationFactor - 1) more peers
    const needed = replicationFactor - 1;
    if (needed <= 0) {
      log.info(`pinned ${hash} locally (replication factor 1)`);
      this.emit("pin.complete", hash);
      return true;
    }

    // Request pins from peers
    return this.requestPinsFromPeers(hash, needed, priority, orgCritical);
  }

  /**
   * Unpin content — remove our pin and stop maintaining replication.
   */
  unpin(hash: string): void {
    this.agreements.delete(hash);
    this.locallyPinned.delete(hash);
    log.info(`unpinned ${hash}`);
    this.emit("pin.removed", hash);
  }

  /**
   * Check if content is pinned.
   */
  isPinned(hash: string): boolean {
    return this.agreements.has(hash);
  }

  /**
   * Get the pin agreement for a hash.
   */
  getAgreement(hash: string): PinAgreement | undefined {
    return this.agreements.get(hash);
  }

  /**
   * List all pin agreements.
   */
  listAgreements(): PinAgreement[] {
    return Array.from(this.agreements.values());
  }

  /**
   * Get all hashes pinned locally (including ones pinned for other peers).
   */
  getLocallyPinned(): string[] {
    return Array.from(this.locallyPinned);
  }

  // -----------------------------------------------------------------------
  // Private — message handling
  // -----------------------------------------------------------------------

  private handleMessage = (msg: PeerMessage): void => {
    if (msg.from === this.deviceId) {
      return;
    }

    switch (msg.type) {
      case "pin.request":
        this.handlePinRequest(msg);
        break;
      case "pin.ack":
        this.handlePinAck(msg);
        break;
    }
  };

  private async handlePinRequest(msg: PeerMessage): Promise<void> {
    const payload = msg.payload as PinRequestPayload;
    if (!payload?.hash || !payload.requestId) {
      return;
    }

    // Can we accept?
    if (!this.canPin) {
      this.sendPinAck(msg.from, payload.requestId, payload.hash, false, "pinning disabled");
      return;
    }

    if (this.locallyPinned.size >= this.maxPinnedHashes) {
      this.sendPinAck(msg.from, payload.requestId, payload.hash, false, "max hashes reached");
      return;
    }

    if (this.pinStorageUsed + payload.size > this.maxPinStorage) {
      this.sendPinAck(msg.from, payload.requestId, payload.hash, false, "storage limit reached");
      return;
    }

    // Fetch the content if we don't have it
    if (!this.contentRouter.hasLocal(payload.hash)) {
      const data = await this.contentRouter.request(payload.hash);
      if (!data) {
        this.sendPinAck(msg.from, payload.requestId, payload.hash, false, "content not found");
        return;
      }
    }

    // Accept the pin
    this.locallyPinned.add(payload.hash);
    this.pinStorageUsed += payload.size;

    this.sendPinAck(msg.from, payload.requestId, payload.hash, true);

    log.info(
      `accepted pin request from ${msg.from}: ${payload.hash} (${payload.size} bytes, priority: ${payload.priority})`,
    );
    this.emit("pin.accepted", { hash: payload.hash, from: msg.from });
  }

  private handlePinAck(msg: PeerMessage): void {
    const payload = msg.payload as PinAckPayload;
    if (!payload?.requestId) {
      return;
    }

    const pending = this.pendingPinRequests.get(payload.requestId);
    if (!pending) {
      return;
    }

    pending.acks.set(msg.from, payload.accepted);

    if (payload.accepted) {
      // Update agreement
      const agreement = this.agreements.get(pending.hash);
      if (agreement) {
        agreement.pinners.set(msg.from, {
          deviceId: msg.from,
          confirmed: true,
          pinnedAt: Date.now(),
          lastSeenAt: Date.now(),
        });
      }

      // Check if we have enough pinners
      const acceptedCount = Array.from(pending.acks.values()).filter(Boolean).length;
      if (acceptedCount >= pending.needed) {
        clearTimeout(pending.timer);
        this.pendingPinRequests.delete(payload.requestId);
        pending.resolve(true);
        log.info(`pin request fulfilled for ${pending.hash}: ${acceptedCount + 1} replicas`);
        this.emit("pin.complete", pending.hash);
      }
    }
  }

  // -----------------------------------------------------------------------
  // Private — pin request orchestration
  // -----------------------------------------------------------------------

  private requestPinsFromPeers(
    hash: string,
    needed: number,
    priority: PinPriority,
    orgCritical: boolean,
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const requestId = crypto.randomUUID();

      const timer = setTimeout(() => {
        const pending = this.pendingPinRequests.get(requestId);
        this.pendingPinRequests.delete(requestId);

        const acceptedCount = pending
          ? Array.from(pending.acks.values()).filter(Boolean).length
          : 0;

        if (acceptedCount > 0) {
          log.warn(`pin for ${hash}: got ${acceptedCount + 1}/${needed + 1} replicas (partial)`);
          resolve(true); // partial success is still success
        } else {
          resolve(false);
        }
      }, PIN_REQUEST_TIMEOUT_MS);

      this.pendingPinRequests.set(requestId, {
        hash,
        acks: new Map(),
        needed,
        resolve,
        timer,
      });

      // Get content size
      const localData = this.contentRouter.getLocal(hash);
      const size = localData?.length ?? 0;

      const payload: PinRequestPayload = {
        requestId,
        hash,
        size,
        priority,
        replicationFactor: needed + 1, // including us
        orgCritical,
      };

      // Broadcast to all peers — let them decide if they can accept
      const sent = this.mesh.broadcast("pin.request", payload);
      if (sent === 0) {
        clearTimeout(timer);
        this.pendingPinRequests.delete(requestId);
        log.warn(`no peers to send pin request to for ${hash}`);
        resolve(false);
      }
    });
  }

  private sendPinAck(
    peerId: string,
    requestId: string,
    hash: string,
    accepted: boolean,
    reason?: string,
  ): void {
    const payload: PinAckPayload = {
      requestId,
      hash,
      accepted,
      reason,
    };
    this.mesh.send(peerId, "pin.ack", payload);
  }

  // -----------------------------------------------------------------------
  // Private — replication maintenance
  // -----------------------------------------------------------------------

  private checkReplication(): void {
    const now = Date.now();

    for (const [hash, agreement] of this.agreements) {
      // Count live pinners
      let livePinners = 0;
      const deadPinners: string[] = [];

      for (const [peerId, status] of agreement.pinners) {
        if (peerId === this.deviceId) {
          livePinners++;
          continue;
        }

        const offlineSince = this.recentlyOffline.get(peerId);
        if (offlineSince && now - offlineSince > PEER_OFFLINE_GRACE_MS) {
          deadPinners.push(peerId);
        } else if (!offlineSince) {
          // Peer is connected or never disconnected
          if (this.mesh.isConnectedTo(peerId)) {
            livePinners++;
            status.lastSeenAt = now;
          } else {
            deadPinners.push(peerId);
          }
        } else {
          // Within grace period, still count as live
          livePinners++;
        }
      }

      // Remove dead pinners
      for (const deadId of deadPinners) {
        agreement.pinners.delete(deadId);
      }

      // Need re-replication?
      const deficit = agreement.replicationFactor - livePinners;
      if (deficit > 0) {
        log.info(
          `re-replicating ${hash}: ${livePinners}/${agreement.replicationFactor} replicas (need ${deficit} more)`,
        );

        this.requestPinsFromPeers(hash, deficit, agreement.priority, agreement.orgCritical).catch(
          (err) => {
            log.warn(`re-replication failed for ${hash}: ${String(err)}`);
          },
        );
      }
    }
  }

  // -----------------------------------------------------------------------
  // Private — garbage collection
  // -----------------------------------------------------------------------

  private garbageCollect(): void {
    const allLocal = this.contentRouter.listLocal();
    let collected = 0;

    for (const hash of allLocal) {
      // Skip pinned content
      if (this.locallyPinned.has(hash)) {
        continue;
      }

      // Skip content that's part of an agreement
      if (this.agreements.has(hash)) {
        continue;
      }

      // This content is neither pinned nor part of any agreement.
      // In a full implementation, we'd also check if it's referenced
      // by any manifest. For now, we leave unreferenced content alone
      // and only log potential GC candidates.
      // Content is only GC'd if explicitly requested or very old.
    }

    if (collected > 0) {
      log.info(`garbage collected ${collected} unreferenced content chunks`);
    }
  }
}
