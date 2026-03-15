/**
 * Relay Nodes for NAT Traversal — ANIMA 6
 *
 * When two peers cannot establish a direct connection, a third peer
 * acts as a relay, forwarding encrypted traffic between them.
 * The relay cannot read the content — it only forwards ciphertext.
 *
 * Relay selection prefers the lowest-latency peer connected to both
 * sides. Bandwidth is tracked for UCU compensation.
 */

import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import type { PeerMesh } from "./mesh.js";
import type { PeerMessage } from "./protocol.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("p2p-relay");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RELAY_REQUEST_TIMEOUT_MS = 15_000;
const RELAY_SESSION_TIMEOUT_MS = 300_000; // 5 minutes idle timeout
const BANDWIDTH_REPORT_INTERVAL_MS = 60_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A relay session bridging two peers through this node. */
export interface RelaySession {
  sessionId: string;
  initiator: string; // deviceId requesting the relay
  target: string; // deviceId being relayed to
  relayNode: string; // deviceId of the relay (us or a peer)
  createdAt: number;
  lastActivityAt: number;
  bytesForwarded: number;
}

/** Bandwidth tracking for UCU compensation. */
export interface BandwidthRecord {
  peerId: string;
  bytesRelayed: number;
  sessionsServed: number;
  since: number; // unix ms
}

/** Payload for relay.request messages. */
export interface RelayRequestPayload {
  sessionId: string;
  targetDeviceId: string; // who we want to reach
  requesterId: string; // who is requesting the relay
}

/** Payload for relay.bridge messages. */
export interface RelayBridgePayload {
  sessionId: string;
  accepted: boolean;
  relayDeviceId?: string;
  reason?: string;
}

/** Payload for relayed data frames. */
export interface RelayDataPayload {
  sessionId: string;
  fromDeviceId: string;
  toDeviceId: string;
  data: string; // base64-encoded ciphertext
}

/** Configuration for the relay subsystem. */
export interface RelayConfig {
  mesh: PeerMesh;
  deviceId: string;
  orgId: string;
  /** Whether this node is willing to serve as a relay for others. */
  canRelay?: boolean;
  /** Maximum concurrent relay sessions to serve. */
  maxRelaySessions?: number;
  /** Maximum bandwidth (bytes/sec) to allocate for relaying. */
  maxRelayBandwidth?: number;
}

// ---------------------------------------------------------------------------
// RelayManager
// ---------------------------------------------------------------------------

export class RelayManager extends EventEmitter {
  private readonly mesh: PeerMesh;
  private readonly deviceId: string;
  private readonly orgId: string;
  private readonly canRelay: boolean;
  private readonly maxRelaySessions: number;
  private readonly maxRelayBandwidth: number;

  /** Active relay sessions where we are the relay. */
  private servingSessions: Map<string, RelaySession> = new Map();

  /** Active relay sessions where we are the initiator. */
  private clientSessions: Map<string, RelaySession> = new Map();

  /** Bandwidth tracking per peer. */
  private bandwidthRecords: Map<string, BandwidthRecord> = new Map();

  /** Pending relay requests. */
  private pendingRequests: Map<
    string,
    {
      resolve: (session: RelaySession | null) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  > = new Map();

  /** Latency estimates to peers (deviceId -> latency ms). */
  private peerLatencies: Map<string, number> = new Map();

  private cleanupInterval?: ReturnType<typeof setInterval>;
  private bandwidthReportInterval?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(config: RelayConfig) {
    super();
    this.mesh = config.mesh;
    this.deviceId = config.deviceId;
    this.orgId = config.orgId;
    this.canRelay = config.canRelay ?? true;
    this.maxRelaySessions = config.maxRelaySessions ?? 20;
    this.maxRelayBandwidth = config.maxRelayBandwidth ?? 10 * 1024 * 1024; // 10MB/s
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

    // Cleanup idle sessions
    this.cleanupInterval = setInterval(() => this.cleanupIdleSessions(), 30_000);

    // Periodic bandwidth reporting
    this.bandwidthReportInterval = setInterval(
      () => this.reportBandwidth(),
      BANDWIDTH_REPORT_INTERVAL_MS,
    );

    log.info(
      `relay manager started (canRelay: ${this.canRelay}, maxSessions: ${this.maxRelaySessions})`,
    );
  }

  stop(): void {
    this.running = false;
    this.mesh.off("message", this.handleMessage);

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
    if (this.bandwidthReportInterval) {
      clearInterval(this.bandwidthReportInterval);
      this.bandwidthReportInterval = undefined;
    }

    // Cancel pending requests
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.resolve(null);
    }
    this.pendingRequests.clear();

    // Close all sessions
    this.servingSessions.clear();
    this.clientSessions.clear();

    log.info("relay manager stopped");
  }

  // -----------------------------------------------------------------------
  // Client API — requesting a relay
  // -----------------------------------------------------------------------

  /**
   * Request a relay to reach a target peer we can't connect to directly.
   * Automatically selects the best relay node.
   */
  async requestRelay(targetDeviceId: string): Promise<RelaySession | null> {
    // Find potential relay candidates: peers connected to us
    const candidates = this.findRelayCandidates(targetDeviceId);

    if (candidates.length === 0) {
      log.warn(`no relay candidates found for target ${targetDeviceId}`);
      return null;
    }

    // Try candidates in order of preference (lowest latency first)
    for (const candidateId of candidates) {
      const session = await this.requestRelayFromPeer(candidateId, targetDeviceId);
      if (session) {
        this.clientSessions.set(session.sessionId, session);
        log.info(`relay established: ${this.deviceId} -> ${candidateId} -> ${targetDeviceId}`);
        this.emit("relay.established", session);
        return session;
      }
    }

    log.warn(`failed to establish relay to ${targetDeviceId}`);
    return null;
  }

  /**
   * Send data through an established relay session.
   */
  sendViaRelay(sessionId: string, data: Buffer): boolean {
    const session = this.clientSessions.get(sessionId) ?? this.servingSessions.get(sessionId);
    if (!session) {
      return false;
    }

    const payload: RelayDataPayload = {
      sessionId,
      fromDeviceId: this.deviceId,
      toDeviceId: session.initiator === this.deviceId ? session.target : session.initiator,
      data: data.toString("base64"),
    };

    const sent = this.mesh.send(session.relayNode, "relay.data", payload);
    if (sent) {
      session.lastActivityAt = Date.now();
      session.bytesForwarded += data.length;
    }
    return sent;
  }

  /**
   * Close a relay session.
   */
  closeSession(sessionId: string): void {
    this.clientSessions.delete(sessionId);
    this.servingSessions.delete(sessionId);
    log.info(`relay session closed: ${sessionId}`);
    this.emit("relay.closed", sessionId);
  }

  // -----------------------------------------------------------------------
  // Status
  // -----------------------------------------------------------------------

  /**
   * Get all active relay sessions (both serving and client).
   */
  getActiveSessions(): RelaySession[] {
    return [...this.servingSessions.values(), ...this.clientSessions.values()];
  }

  /**
   * Get bandwidth records for all peers we've relayed for.
   */
  getBandwidthRecords(): BandwidthRecord[] {
    return Array.from(this.bandwidthRecords.values());
  }

  /**
   * Update latency estimate for a peer.
   */
  updateLatency(peerId: string, latencyMs: number): void {
    this.peerLatencies.set(peerId, latencyMs);
  }

  // -----------------------------------------------------------------------
  // Private — message handling
  // -----------------------------------------------------------------------

  private handleMessage = (msg: PeerMessage): void => {
    if (msg.from === this.deviceId) {
      return;
    }

    switch (msg.type) {
      case "relay.request":
        this.handleRelayRequest(msg);
        break;
      case "relay.bridge":
        this.handleRelayBridge(msg);
        break;
      case "relay.data":
        this.handleRelayData(msg);
        break;
    }
  };

  private handleRelayRequest(msg: PeerMessage): void {
    const payload = msg.payload as RelayRequestPayload;
    if (!payload?.sessionId || !payload.targetDeviceId) {
      return;
    }

    // Can we relay?
    if (!this.canRelay) {
      this.sendBridgeResponse(msg.from, payload.sessionId, false, "relaying disabled");
      return;
    }

    if (this.servingSessions.size >= this.maxRelaySessions) {
      this.sendBridgeResponse(msg.from, payload.sessionId, false, "max sessions reached");
      return;
    }

    // Are we connected to the target?
    if (!this.mesh.isConnectedTo(payload.targetDeviceId)) {
      this.sendBridgeResponse(msg.from, payload.sessionId, false, "not connected to target");
      return;
    }

    // Accept the relay
    const session: RelaySession = {
      sessionId: payload.sessionId,
      initiator: payload.requesterId,
      target: payload.targetDeviceId,
      relayNode: this.deviceId,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      bytesForwarded: 0,
    };

    this.servingSessions.set(session.sessionId, session);

    // Track bandwidth
    this.trackBandwidth(payload.requesterId, 0, true);

    this.sendBridgeResponse(msg.from, payload.sessionId, true);

    log.info(
      `accepted relay request: ${payload.requesterId} -> ${this.deviceId} -> ${payload.targetDeviceId}`,
    );
    this.emit("relay.serving", session);
  }

  private handleRelayBridge(msg: PeerMessage): void {
    const payload = msg.payload as RelayBridgePayload;
    if (!payload?.sessionId) {
      return;
    }

    const pending = this.pendingRequests.get(payload.sessionId);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timer);
    this.pendingRequests.delete(payload.sessionId);

    if (payload.accepted) {
      const session: RelaySession = {
        sessionId: payload.sessionId,
        initiator: this.deviceId,
        target: "", // filled by the relay node info
        relayNode: msg.from,
        createdAt: Date.now(),
        lastActivityAt: Date.now(),
        bytesForwarded: 0,
      };
      pending.resolve(session);
    } else {
      log.info(`relay request declined by ${msg.from}: ${payload.reason ?? "unknown"}`);
      pending.resolve(null);
    }
  }

  private handleRelayData(msg: PeerMessage): void {
    const payload = msg.payload as RelayDataPayload;
    if (!payload?.sessionId || !payload.data) {
      return;
    }

    const session = this.servingSessions.get(payload.sessionId);

    if (session) {
      // We are the relay — forward the data to the other side
      const dataBytes = Buffer.from(payload.data, "base64");
      const forwardTo =
        payload.fromDeviceId === session.initiator ? session.target : session.initiator;

      const forwardPayload: RelayDataPayload = {
        sessionId: payload.sessionId,
        fromDeviceId: payload.fromDeviceId,
        toDeviceId: forwardTo,
        data: payload.data,
      };

      this.mesh.send(forwardTo, "relay.data", forwardPayload);

      session.bytesForwarded += dataBytes.length;
      session.lastActivityAt = Date.now();
      this.trackBandwidth(payload.fromDeviceId, dataBytes.length, false);
    } else {
      // We are an endpoint — deliver the data
      const clientSession = this.clientSessions.get(payload.sessionId);
      if (clientSession) {
        clientSession.lastActivityAt = Date.now();
        const dataBytes = Buffer.from(payload.data, "base64");
        this.emit("relay.data", {
          sessionId: payload.sessionId,
          from: payload.fromDeviceId,
          data: dataBytes,
        });
      }
    }
  }

  // -----------------------------------------------------------------------
  // Private — relay selection
  // -----------------------------------------------------------------------

  /**
   * Find peers that could relay to the target, sorted by latency.
   */
  private findRelayCandidates(targetDeviceId: string): string[] {
    const connectedPeers = this.mesh.listPeers();
    const candidates: Array<{ deviceId: string; latency: number }> = [];

    for (const peer of connectedPeers) {
      // Skip the target itself
      if (peer.deviceId === targetDeviceId) {
        continue;
      }
      // Skip ourselves
      if (peer.deviceId === this.deviceId) {
        continue;
      }

      const latency = this.peerLatencies.get(peer.deviceId) ?? 100; // default 100ms
      candidates.push({ deviceId: peer.deviceId, latency });
    }

    // Sort by latency (lowest first)
    candidates.sort((a, b) => a.latency - b.latency);
    return candidates.map((c) => c.deviceId);
  }

  private requestRelayFromPeer(
    relayPeerId: string,
    targetDeviceId: string,
  ): Promise<RelaySession | null> {
    return new Promise((resolve) => {
      const sessionId = crypto.randomUUID();

      const timer = setTimeout(() => {
        this.pendingRequests.delete(sessionId);
        resolve(null);
      }, RELAY_REQUEST_TIMEOUT_MS);

      this.pendingRequests.set(sessionId, { resolve, timer });

      const payload: RelayRequestPayload = {
        sessionId,
        targetDeviceId,
        requesterId: this.deviceId,
      };

      const sent = this.mesh.send(relayPeerId, "relay.request", payload);
      if (!sent) {
        clearTimeout(timer);
        this.pendingRequests.delete(sessionId);
        resolve(null);
      }
    });
  }

  private sendBridgeResponse(
    peerId: string,
    sessionId: string,
    accepted: boolean,
    reason?: string,
  ): void {
    const payload: RelayBridgePayload = {
      sessionId,
      accepted,
      relayDeviceId: accepted ? this.deviceId : undefined,
      reason,
    };
    this.mesh.send(peerId, "relay.bridge", payload);
  }

  // -----------------------------------------------------------------------
  // Private — bandwidth tracking
  // -----------------------------------------------------------------------

  private trackBandwidth(peerId: string, bytes: number, newSession: boolean): void {
    let record = this.bandwidthRecords.get(peerId);
    if (!record) {
      record = {
        peerId,
        bytesRelayed: 0,
        sessionsServed: 0,
        since: Date.now(),
      };
      this.bandwidthRecords.set(peerId, record);
    }
    record.bytesRelayed += bytes;
    if (newSession) {
      record.sessionsServed++;
    }
  }

  private reportBandwidth(): void {
    let totalBytes = 0;
    let totalSessions = 0;
    for (const record of this.bandwidthRecords.values()) {
      totalBytes += record.bytesRelayed;
      totalSessions += record.sessionsServed;
    }
    if (totalSessions > 0) {
      log.info(
        `relay bandwidth: ${totalSessions} sessions, ${(totalBytes / 1024 / 1024).toFixed(2)} MB forwarded`,
      );
      this.emit("relay.bandwidth", {
        totalBytes,
        totalSessions,
        records: Array.from(this.bandwidthRecords.values()),
      });
    }
  }

  // -----------------------------------------------------------------------
  // Private — cleanup
  // -----------------------------------------------------------------------

  private cleanupIdleSessions(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [id, session] of this.servingSessions) {
      if (now - session.lastActivityAt > RELAY_SESSION_TIMEOUT_MS) {
        this.servingSessions.delete(id);
        cleaned++;
        this.emit("relay.closed", id);
      }
    }

    for (const [id, session] of this.clientSessions) {
      if (now - session.lastActivityAt > RELAY_SESSION_TIMEOUT_MS) {
        this.clientSessions.delete(id);
        cleaned++;
        this.emit("relay.closed", id);
      }
    }

    if (cleaned > 0) {
      log.info(`cleaned ${cleaned} idle relay sessions`);
    }
  }
}
