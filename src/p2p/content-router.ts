/**
 * Content-Addressable Distributed Routing for ANIMA 6
 *
 * Provides a DHT-like content routing layer on top of the P2P mesh.
 * Nodes store content by SHA-256 hash and route requests through
 * the mesh to locate and retrieve content from peers.
 *
 * Large files are chunked into 1MB pieces with a manifest that
 * lists all chunk hashes in order.
 */

import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import type { PeerMesh } from "./mesh.js";
import type { PeerMessage } from "./protocol.js";
import { resolveStateDir } from "../config/paths.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { createMessage } from "./protocol.js";

const log = createSubsystemLogger("p2p-content-router");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_CHUNK_SIZE = 1024 * 1024; // 1MB
const ROUTING_TABLE_PRUNE_INTERVAL_MS = 60_000;
const ROUTING_ENTRY_TTL_MS = 300_000; // 5 minutes
const REQUEST_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single content chunk stored locally. */
export interface ContentChunk {
  hash: string; // SHA-256 hex
  data: Buffer;
  size: number;
}

/** Manifest for a multi-chunk file. */
export interface ContentManifest {
  type: "manifest";
  totalSize: number;
  chunkHashes: string[]; // ordered list of chunk SHA-256 hashes
  metadata?: Record<string, unknown>;
}

/** Entry in the routing table: which peer has which content. */
interface RoutingEntry {
  hash: string;
  peerId: string;
  advertisedAt: number; // unix ms
}

/** Payload for content.announce messages. */
export interface ContentAnnouncePayload {
  hashes: string[]; // SHA-256 hex hashes this peer has
}

/** Payload for content.request messages. */
export interface ContentRequestPayload {
  hash: string;
  requestId: string;
}

/** Payload for content.response messages. */
export interface ContentResponsePayload {
  hash: string;
  requestId: string;
  found: boolean;
  data?: string; // base64-encoded chunk data
  manifest?: ContentManifest;
}

/** Configuration for the content router. */
export interface ContentRouterConfig {
  mesh: PeerMesh;
  deviceId: string;
  orgId: string;
  storePath?: string; // defaults to ~/.anima/content-store/
}

// ---------------------------------------------------------------------------
// ContentRouter
// ---------------------------------------------------------------------------

export class ContentRouter extends EventEmitter {
  private readonly mesh: PeerMesh;
  private readonly deviceId: string;
  private readonly orgId: string;
  private readonly storePath: string;

  /** Routing table: hash -> peerId -> RoutingEntry */
  private routingTable: Map<string, Map<string, RoutingEntry>> = new Map();

  /** Pending content requests awaiting responses. */
  private pendingRequests: Map<
    string,
    {
      resolve: (data: Buffer | ContentManifest | null) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  > = new Map();

  private pruneInterval?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(config: ContentRouterConfig) {
    super();
    this.mesh = config.mesh;
    this.deviceId = config.deviceId;
    this.orgId = config.orgId;
    this.storePath = config.storePath ?? path.join(resolveStateDir(), "content-store");

    // Ensure store directory exists
    fs.mkdirSync(this.storePath, { recursive: true });
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;

    // Listen for content-related mesh messages
    this.mesh.on("message", this.handleMessage);

    // Periodically prune stale routing entries
    this.pruneInterval = setInterval(
      () => this.pruneRoutingTable(),
      ROUTING_TABLE_PRUNE_INTERVAL_MS,
    );

    // Announce our local content to new peers
    this.mesh.on("peer.connected", (peerId: string) => {
      this.announceLocalContent(peerId);
    });

    log.info("content router started");
  }

  stop(): void {
    this.running = false;
    this.mesh.off("message", this.handleMessage);

    if (this.pruneInterval) {
      clearInterval(this.pruneInterval);
      this.pruneInterval = undefined;
    }

    // Cancel pending requests
    for (const [reqId, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.resolve(null);
      this.pendingRequests.delete(reqId);
    }

    log.info("content router stopped");
  }

  // -----------------------------------------------------------------------
  // Content storage
  // -----------------------------------------------------------------------

  /**
   * Store a chunk of content locally and announce it to the mesh.
   * Returns the SHA-256 hash of the content.
   */
  store(data: Buffer): string {
    const hash = this.hashContent(data);
    const filePath = this.chunkPath(hash);

    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, data);
      log.info(`stored content: ${hash} (${data.length} bytes)`);
    }

    // Announce to all peers
    this.broadcastAnnounce([hash]);
    return hash;
  }

  /**
   * Store a large file by splitting it into 1MB chunks.
   * Returns the manifest hash.
   */
  storeFile(data: Buffer, metadata?: Record<string, unknown>): string {
    const chunkHashes: string[] = [];

    for (let offset = 0; offset < data.length; offset += MAX_CHUNK_SIZE) {
      const chunk = data.subarray(offset, offset + MAX_CHUNK_SIZE);
      const hash = this.store(Buffer.from(chunk));
      chunkHashes.push(hash);
    }

    // If single chunk, just return its hash
    if (chunkHashes.length === 1) {
      return chunkHashes[0];
    }

    // Create manifest
    const manifest: ContentManifest = {
      type: "manifest",
      totalSize: data.length,
      chunkHashes,
      metadata,
    };

    const manifestBuf = Buffer.from(JSON.stringify(manifest), "utf8");
    const manifestHash = this.store(manifestBuf);

    log.info(`stored file as ${chunkHashes.length} chunks, manifest: ${manifestHash}`);
    return manifestHash;
  }

  /**
   * Retrieve content from local store.
   */
  getLocal(hash: string): Buffer | null {
    const filePath = this.chunkPath(hash);
    try {
      return fs.readFileSync(filePath);
    } catch {
      return null;
    }
  }

  /**
   * Check if content exists locally.
   */
  hasLocal(hash: string): boolean {
    return fs.existsSync(this.chunkPath(hash));
  }

  /**
   * List all locally stored content hashes.
   */
  listLocal(): string[] {
    try {
      return fs.readdirSync(this.storePath).filter((f) => !f.startsWith("."));
    } catch {
      return [];
    }
  }

  /**
   * Delete local content.
   */
  deleteLocal(hash: string): boolean {
    const filePath = this.chunkPath(hash);
    try {
      fs.unlinkSync(filePath);
      log.info(`deleted local content: ${hash}`);
      return true;
    } catch {
      return false;
    }
  }

  // -----------------------------------------------------------------------
  // Content retrieval (network)
  // -----------------------------------------------------------------------

  /**
   * Request content by hash from the network.
   * Checks local store first, then queries peers.
   */
  async request(hash: string): Promise<Buffer | null> {
    // Check local first
    const local = this.getLocal(hash);
    if (local) {
      return local;
    }

    // Find peers that have this content
    const peers = this.findPeersForHash(hash);

    if (peers.length > 0) {
      // Try each peer
      for (const peerId of peers) {
        const result = await this.requestFromPeer(peerId, hash);
        if (result) {
          if (Buffer.isBuffer(result)) {
            // Verify hash
            if (this.hashContent(result) === hash) {
              // Cache locally
              this.store(result);
              return result;
            }
            log.warn(`hash mismatch for content from ${peerId}`);
          }
        }
      }
    }

    // Broadcast request to all peers
    return this.broadcastRequest(hash);
  }

  /**
   * Request and reassemble a multi-chunk file by manifest hash.
   */
  async requestFile(manifestHash: string): Promise<Buffer | null> {
    const manifestData = await this.request(manifestHash);
    if (!manifestData) {
      return null;
    }

    // Check if it's a manifest
    try {
      const manifest = JSON.parse(manifestData.toString()) as ContentManifest;
      if (manifest.type !== "manifest") {
        // Not a manifest, return as-is
        return manifestData;
      }

      // Fetch all chunks
      const chunks: Buffer[] = [];
      for (const chunkHash of manifest.chunkHashes) {
        const chunk = await this.request(chunkHash);
        if (!chunk) {
          log.warn(`missing chunk ${chunkHash} for manifest ${manifestHash}`);
          return null;
        }
        chunks.push(chunk);
      }

      return Buffer.concat(chunks);
    } catch {
      // Not JSON, return as raw content
      return manifestData;
    }
  }

  // -----------------------------------------------------------------------
  // Routing table
  // -----------------------------------------------------------------------

  /**
   * Find peers that advertise a given content hash.
   */
  findPeersForHash(hash: string): string[] {
    const entries = this.routingTable.get(hash);
    if (!entries) {
      return [];
    }

    const now = Date.now();
    const peers: string[] = [];
    for (const [peerId, entry] of entries) {
      if (now - entry.advertisedAt < ROUTING_ENTRY_TTL_MS) {
        peers.push(peerId);
      }
    }
    return peers;
  }

  // -----------------------------------------------------------------------
  // Private — message handling
  // -----------------------------------------------------------------------

  private handleMessage = (msg: PeerMessage): void => {
    if (msg.from === this.deviceId) {
      return;
    }

    switch (msg.type) {
      case "content.announce":
        this.handleAnnounce(msg);
        break;
      case "content.request":
        this.handleContentRequest(msg);
        break;
      case "content.response":
        this.handleContentResponse(msg);
        break;
    }
  };

  private handleAnnounce(msg: PeerMessage): void {
    const payload = msg.payload as ContentAnnouncePayload;
    if (!payload?.hashes || !Array.isArray(payload.hashes)) {
      return;
    }

    const now = Date.now();
    for (const hash of payload.hashes) {
      let peers = this.routingTable.get(hash);
      if (!peers) {
        peers = new Map();
        this.routingTable.set(hash, peers);
      }
      peers.set(msg.from, { hash, peerId: msg.from, advertisedAt: now });
    }

    log.info(`received content announce from ${msg.from}: ${payload.hashes.length} hashes`);
  }

  private handleContentRequest(msg: PeerMessage): void {
    const payload = msg.payload as ContentRequestPayload;
    if (!payload?.hash || !payload.requestId) {
      return;
    }

    const data = this.getLocal(payload.hash);
    const response: ContentResponsePayload = {
      hash: payload.hash,
      requestId: payload.requestId,
      found: data !== null,
      data: data ? data.toString("base64") : undefined,
    };

    // Check if it's a manifest
    if (data) {
      try {
        const parsed = JSON.parse(data.toString()) as ContentManifest;
        if (parsed.type === "manifest") {
          response.manifest = parsed;
        }
      } catch {
        // Not a manifest, send raw data
      }
    }

    this.mesh.send(msg.from, "content.response", response);
  }

  private handleContentResponse(msg: PeerMessage): void {
    const payload = msg.payload as ContentResponsePayload;
    if (!payload?.requestId) {
      return;
    }

    const pending = this.pendingRequests.get(payload.requestId);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timer);
    this.pendingRequests.delete(payload.requestId);

    if (payload.found && payload.data) {
      const buf = Buffer.from(payload.data, "base64");
      pending.resolve(buf);
    } else if (payload.found && payload.manifest) {
      pending.resolve(payload.manifest);
    } else {
      pending.resolve(null);
    }
  }

  // -----------------------------------------------------------------------
  // Private — network operations
  // -----------------------------------------------------------------------

  private requestFromPeer(peerId: string, hash: string): Promise<Buffer | ContentManifest | null> {
    return new Promise((resolve) => {
      const requestId = crypto.randomUUID();

      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        resolve(null);
      }, REQUEST_TIMEOUT_MS);

      this.pendingRequests.set(requestId, { resolve, timer });

      const payload: ContentRequestPayload = { hash, requestId };
      const sent = this.mesh.send(peerId, "content.request", payload);
      if (!sent) {
        clearTimeout(timer);
        this.pendingRequests.delete(requestId);
        resolve(null);
      }
    });
  }

  private broadcastRequest(hash: string): Promise<Buffer | null> {
    return new Promise((resolve) => {
      const requestId = crypto.randomUUID();

      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        resolve(null);
      }, REQUEST_TIMEOUT_MS);

      this.pendingRequests.set(requestId, {
        resolve: resolve as (data: Buffer | ContentManifest | null) => void,
        timer,
      });

      const payload: ContentRequestPayload = { hash, requestId };
      const sent = this.mesh.broadcast("content.request", payload);
      if (sent === 0) {
        clearTimeout(timer);
        this.pendingRequests.delete(requestId);
        resolve(null);
      }
    });
  }

  private broadcastAnnounce(hashes: string[]): void {
    const payload: ContentAnnouncePayload = { hashes };
    this.mesh.broadcast("content.announce", payload);
  }

  private announceLocalContent(peerId: string): void {
    const hashes = this.listLocal();
    if (hashes.length === 0) {
      return;
    }

    const payload: ContentAnnouncePayload = { hashes };
    this.mesh.send(peerId, "content.announce", payload);
  }

  // -----------------------------------------------------------------------
  // Private — helpers
  // -----------------------------------------------------------------------

  private hashContent(data: Buffer): string {
    return crypto.createHash("sha256").update(data).digest("hex");
  }

  private chunkPath(hash: string): string {
    return path.join(this.storePath, hash);
  }

  private pruneRoutingTable(): void {
    const now = Date.now();
    let pruned = 0;

    for (const [hash, peers] of this.routingTable) {
      for (const [peerId, entry] of peers) {
        if (now - entry.advertisedAt > ROUTING_ENTRY_TTL_MS) {
          peers.delete(peerId);
          pruned++;
        }
      }
      if (peers.size === 0) {
        this.routingTable.delete(hash);
      }
    }

    if (pruned > 0) {
      log.info(`pruned ${pruned} stale routing entries`);
    }
  }
}
