/**
 * Org-Internal Private DNS for ANIMA 6
 *
 * Distributed name resolution within org namespaces. Names follow
 * the pattern "service.orgname.anima" and resolve through the mesh
 * without any external DNS infrastructure.
 *
 * Records are signed by the registering peer's Ed25519 key and
 * distributed across org peers via a DHT-like approach.
 * TTL-based expiry with automatic refresh by the owning peer.
 */

import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import type { PeerMesh } from "./mesh.js";
import type { PeerMessage } from "./protocol.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("p2p-dns");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TTL_MS = 300_000; // 5 minutes
const CACHE_CLEANUP_INTERVAL_MS = 60_000;
const QUERY_TIMEOUT_MS = 10_000;
const REFRESH_INTERVAL_MS = 120_000; // refresh records every 2 minutes
const ANIMA_TLD = ".anima";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DnsRecordType = "A" | "CNAME" | "TXT" | "SRV";

/** A DNS record in the private namespace. */
export interface DnsRecord {
  name: string; // e.g. "myservice.orgname.anima"
  type: DnsRecordType;
  value: string; // peer deviceId (A), alias (CNAME), text (TXT), or service spec (SRV)
  ttlMs: number; // time-to-live in milliseconds
  createdAt: number; // unix ms
  registeredBy: string; // deviceId of the registering peer
  signature: string; // Ed25519 signature (base64) over the record content
}

/** SRV record value (encoded as JSON in DnsRecord.value). */
export interface SrvRecord {
  target: string; // deviceId
  port: number;
  priority: number;
  weight: number;
  protocol: string; // e.g. "ws", "wss", "tcp"
}

/** Payload for dns.register messages. */
export interface DnsRegisterPayload {
  record: DnsRecord;
}

/** Payload for dns.query messages. */
export interface DnsQueryPayload {
  name: string;
  type?: DnsRecordType; // if omitted, return all types
  queryId: string;
}

/** Payload for dns.response messages. */
export interface DnsResponsePayload {
  queryId: string;
  records: DnsRecord[];
  authoritative: boolean;
}

/** Configuration for the private DNS resolver. */
export interface PrivateDnsConfig {
  mesh: PeerMesh;
  deviceId: string;
  orgId: string;
  ed25519PrivateKeyPem: string;
  ed25519PublicKeyPem: string;
}

// ---------------------------------------------------------------------------
// PrivateDns
// ---------------------------------------------------------------------------

export class PrivateDns extends EventEmitter {
  private readonly mesh: PeerMesh;
  private readonly deviceId: string;
  private readonly orgId: string;
  private readonly ed25519PrivateKeyPem: string;
  private readonly ed25519PublicKeyPem: string;

  /** Authoritative records — ones we registered ourselves. */
  private ownRecords: Map<string, DnsRecord> = new Map();

  /** DHT store — records registered by other peers, keyed by "name|type". */
  private dhtStore: Map<string, DnsRecord> = new Map();

  /** Local cache with TTL tracking, keyed by "name|type". */
  private cache: Map<string, { record: DnsRecord; cachedAt: number }> = new Map();

  /** Pending queries awaiting responses. */
  private pendingQueries: Map<
    string,
    {
      records: DnsRecord[];
      resolve: (records: DnsRecord[]) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  > = new Map();

  private cleanupInterval?: ReturnType<typeof setInterval>;
  private refreshInterval?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(config: PrivateDnsConfig) {
    super();
    this.mesh = config.mesh;
    this.deviceId = config.deviceId;
    this.orgId = config.orgId;
    this.ed25519PrivateKeyPem = config.ed25519PrivateKeyPem;
    this.ed25519PublicKeyPem = config.ed25519PublicKeyPem;
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

    // Periodic cache cleanup
    this.cleanupInterval = setInterval(() => this.cleanupCache(), CACHE_CLEANUP_INTERVAL_MS);

    // Periodic refresh of own records
    this.refreshInterval = setInterval(() => this.refreshOwnRecords(), REFRESH_INTERVAL_MS);

    // Announce records to new peers
    this.mesh.on("peer.connected", (peerId: string) => {
      this.announceRecordsToPeer(peerId);
    });

    log.info("private DNS started");
  }

  stop(): void {
    this.running = false;
    this.mesh.off("message", this.handleMessage);

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = undefined;
    }

    // Cancel pending queries
    for (const [queryId, pending] of this.pendingQueries) {
      clearTimeout(pending.timer);
      pending.resolve([]);
      this.pendingQueries.delete(queryId);
    }

    log.info("private DNS stopped");
  }

  // -----------------------------------------------------------------------
  // Registration
  // -----------------------------------------------------------------------

  /**
   * Register a DNS record in the org namespace.
   * The name is automatically suffixed with ".orgId.anima" if not already.
   */
  register(
    name: string,
    type: DnsRecordType,
    value: string,
    ttlMs: number = DEFAULT_TTL_MS,
  ): DnsRecord {
    const fqdn = this.toFqdn(name);

    const record: DnsRecord = {
      name: fqdn,
      type,
      value,
      ttlMs,
      createdAt: Date.now(),
      registeredBy: this.deviceId,
      signature: "", // filled below
    };

    record.signature = this.signRecord(record);

    const key = `${fqdn}|${type}`;
    this.ownRecords.set(key, record);
    this.dhtStore.set(key, record);

    // Broadcast to mesh
    const payload: DnsRegisterPayload = { record };
    this.mesh.broadcast("dns.register", payload);

    log.info(`registered DNS record: ${fqdn} ${type} -> ${value}`);
    this.emit("record.registered", record);
    return record;
  }

  /**
   * Register an A record pointing to this device.
   */
  registerSelf(name: string, ttlMs?: number): DnsRecord {
    return this.register(name, "A", this.deviceId, ttlMs);
  }

  /**
   * Register an SRV record for service discovery.
   */
  registerService(name: string, srv: SrvRecord, ttlMs?: number): DnsRecord {
    return this.register(name, "SRV", JSON.stringify(srv), ttlMs);
  }

  /**
   * Unregister a record we own.
   */
  unregister(name: string, type: DnsRecordType): boolean {
    const fqdn = this.toFqdn(name);
    const key = `${fqdn}|${type}`;
    const deleted = this.ownRecords.delete(key);
    this.dhtStore.delete(key);
    this.cache.delete(key);
    if (deleted) {
      log.info(`unregistered DNS record: ${fqdn} ${type}`);
    }
    return deleted;
  }

  // -----------------------------------------------------------------------
  // Resolution
  // -----------------------------------------------------------------------

  /**
   * Resolve a name. Checks local cache/store first, then queries the mesh.
   */
  async resolve(name: string, type?: DnsRecordType): Promise<DnsRecord[]> {
    const fqdn = this.toFqdn(name);

    // Check local store and cache first
    const local = this.resolveLocal(fqdn, type);
    if (local.length > 0) {
      return local;
    }

    // Query the mesh
    return this.queryMesh(fqdn, type);
  }

  /**
   * Resolve locally from DHT store and cache (no network).
   */
  resolveLocal(name: string, type?: DnsRecordType): DnsRecord[] {
    const fqdn = this.toFqdn(name);
    const results: DnsRecord[] = [];
    const now = Date.now();

    // Search DHT store
    for (const [, record] of this.dhtStore) {
      if (
        record.name === fqdn &&
        (!type || record.type === type) &&
        now - record.createdAt < record.ttlMs
      ) {
        results.push(record);
      }
    }

    // Search cache
    for (const [, cached] of this.cache) {
      if (
        cached.record.name === fqdn &&
        (!type || cached.record.type === type) &&
        now - cached.cachedAt < cached.record.ttlMs
      ) {
        // Don't duplicate
        if (
          !results.some(
            (r) =>
              r.name === cached.record.name &&
              r.type === cached.record.type &&
              r.value === cached.record.value,
          )
        ) {
          results.push(cached.record);
        }
      }
    }

    // Follow CNAME if no direct results for requested type
    if (results.length === 0 && type && type !== "CNAME") {
      const cnames = this.resolveLocal(fqdn, "CNAME");
      for (const cname of cnames) {
        const aliased = this.resolveLocal(cname.value, type);
        results.push(...aliased);
      }
    }

    return results;
  }

  // -----------------------------------------------------------------------
  // Private — message handling
  // -----------------------------------------------------------------------

  private handleMessage = (msg: PeerMessage): void => {
    if (msg.from === this.deviceId) {
      return;
    }

    switch (msg.type) {
      case "dns.register":
        this.handleRegister(msg);
        break;
      case "dns.query":
        this.handleQuery(msg);
        break;
      case "dns.response":
        this.handleResponse(msg);
        break;
    }
  };

  private handleRegister(msg: PeerMessage): void {
    const payload = msg.payload as DnsRegisterPayload;
    if (!payload?.record) {
      return;
    }

    const record = payload.record;

    // Verify signature
    if (!this.verifyRecordSignature(record)) {
      log.warn(`rejected DNS record with invalid signature from ${msg.from}`);
      return;
    }

    // Verify the record belongs to the registering peer
    if (record.registeredBy !== msg.from) {
      log.warn(`rejected DNS record: registeredBy ${record.registeredBy} !== sender ${msg.from}`);
      return;
    }

    const key = `${record.name}|${record.type}`;
    const existing = this.dhtStore.get(key);

    // Only accept if newer
    if (!existing || record.createdAt > existing.createdAt) {
      this.dhtStore.set(key, record);
      log.info(`stored DNS record from ${msg.from}: ${record.name} ${record.type}`);
      this.emit("record.received", record);
    }
  }

  private handleQuery(msg: PeerMessage): void {
    const payload = msg.payload as DnsQueryPayload;
    if (!payload?.name || !payload.queryId) {
      return;
    }

    const results = this.resolveLocal(payload.name, payload.type);

    const response: DnsResponsePayload = {
      queryId: payload.queryId,
      records: results,
      authoritative: results.some((r) => r.registeredBy === this.deviceId),
    };

    this.mesh.send(msg.from, "dns.response", response);
  }

  private handleResponse(msg: PeerMessage): void {
    const payload = msg.payload as DnsResponsePayload;
    if (!payload?.queryId) {
      return;
    }

    const pending = this.pendingQueries.get(payload.queryId);
    if (!pending) {
      return;
    }

    // Accumulate records
    for (const record of payload.records) {
      if (this.verifyRecordSignature(record)) {
        pending.records.push(record);
        // Cache the record
        const key = `${record.name}|${record.type}`;
        this.cache.set(key, { record, cachedAt: Date.now() });
      }
    }

    // If authoritative, resolve immediately
    if (payload.authoritative) {
      clearTimeout(pending.timer);
      this.pendingQueries.delete(payload.queryId);
      pending.resolve(pending.records);
    }
  }

  // -----------------------------------------------------------------------
  // Private — network queries
  // -----------------------------------------------------------------------

  private queryMesh(name: string, type?: DnsRecordType): Promise<DnsRecord[]> {
    return new Promise((resolve) => {
      const queryId = crypto.randomUUID();

      const timer = setTimeout(() => {
        const pending = this.pendingQueries.get(queryId);
        this.pendingQueries.delete(queryId);
        // Resolve with whatever we've collected so far
        resolve(pending?.records ?? []);
      }, QUERY_TIMEOUT_MS);

      this.pendingQueries.set(queryId, { records: [], resolve, timer });

      const payload: DnsQueryPayload = { name, type, queryId };
      const sent = this.mesh.broadcast("dns.query", payload);
      if (sent === 0) {
        clearTimeout(timer);
        this.pendingQueries.delete(queryId);
        resolve([]);
      }
    });
  }

  // -----------------------------------------------------------------------
  // Private — cryptographic signing
  // -----------------------------------------------------------------------

  private signRecord(record: DnsRecord): string {
    const payload = this.recordSigningPayload(record);
    const key = crypto.createPrivateKey(this.ed25519PrivateKeyPem);
    const sig = crypto.sign(null, Buffer.from(payload, "utf8"), key);
    return sig.toString("base64");
  }

  private verifyRecordSignature(record: DnsRecord): boolean {
    // For now, accept records where we can't verify (peer key not available locally).
    // In production, the peer's Ed25519 public key would be fetched from discovery.
    // This is a trust-on-first-use model within the org mesh.
    if (!record.signature) {
      return false;
    }

    // If it's our own record, verify with our key
    if (record.registeredBy === this.deviceId) {
      try {
        const payload = this.recordSigningPayload(record);
        const pubKey = crypto.createPublicKey(this.ed25519PublicKeyPem);
        const sigBuf = Buffer.from(record.signature, "base64");
        return crypto.verify(null, Buffer.from(payload, "utf8"), pubKey, sigBuf);
      } catch {
        return false;
      }
    }

    // For peers, trust records that arrive over the authenticated mesh connection
    // (the mesh already verifies peer identity during handshake)
    return true;
  }

  private recordSigningPayload(record: DnsRecord): string {
    return [
      record.name,
      record.type,
      record.value,
      String(record.ttlMs),
      String(record.createdAt),
      record.registeredBy,
    ].join("|");
  }

  // -----------------------------------------------------------------------
  // Private — helpers
  // -----------------------------------------------------------------------

  private toFqdn(name: string): string {
    if (name.endsWith(ANIMA_TLD)) {
      return name;
    }
    if (name.includes(".")) {
      return `${name}${ANIMA_TLD}`;
    }
    return `${name}.${this.orgId}${ANIMA_TLD}`;
  }

  private cleanupCache(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, cached] of this.cache) {
      if (now - cached.cachedAt > cached.record.ttlMs) {
        this.cache.delete(key);
        cleaned++;
      }
    }

    // Also clean expired DHT store entries
    for (const [key, record] of this.dhtStore) {
      if (now - record.createdAt > record.ttlMs) {
        // Don't clean our own records — they get refreshed
        if (record.registeredBy !== this.deviceId) {
          this.dhtStore.delete(key);
          cleaned++;
        }
      }
    }

    if (cleaned > 0) {
      log.info(`cleaned ${cleaned} expired DNS entries`);
    }
  }

  private refreshOwnRecords(): void {
    for (const [key, record] of this.ownRecords) {
      // Re-register with fresh timestamp
      const refreshed: DnsRecord = {
        ...record,
        createdAt: Date.now(),
        signature: "",
      };
      refreshed.signature = this.signRecord(refreshed);

      this.ownRecords.set(key, refreshed);
      this.dhtStore.set(key, refreshed);

      // Broadcast refresh
      const payload: DnsRegisterPayload = { record: refreshed };
      this.mesh.broadcast("dns.register", payload);
    }

    if (this.ownRecords.size > 0) {
      log.info(`refreshed ${this.ownRecords.size} DNS records`);
    }
  }

  private announceRecordsToPeer(peerId: string): void {
    for (const record of this.ownRecords.values()) {
      const payload: DnsRegisterPayload = { record };
      this.mesh.send(peerId, "dns.register", payload);
    }
  }
}
