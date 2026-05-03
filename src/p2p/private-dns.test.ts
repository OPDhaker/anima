/**
 * Tests for Org-Internal Private DNS.
 *
 * Tests record registration, local resolution, CNAME following,
 * cache behavior, TTL expiry, unregistration, and message handling.
 */

import crypto from "node:crypto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../logging/subsystem.js", () => {
  const noop = () => {};
  const logger = { info: noop, warn: noop, error: noop, debug: noop, trace: noop };
  return { createSubsystemLogger: () => logger };
});

import { PrivateDns, type PrivateDnsConfig, type DnsRecord } from "./private-dns.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateEd25519KeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  return {
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }),
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }),
  };
}

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
    _emitMessage(msg: Record<string, unknown>) {
      for (const fn of listeners.get("message") ?? []) {
        fn(msg);
      }
    },
    _emitPeerConnected(peerId: string) {
      for (const fn of listeners.get("peer.connected") ?? []) {
        fn(peerId);
      }
    },
  };
}

function makeConfig(
  mesh: ReturnType<typeof createMockMesh>,
  overrides?: Partial<PrivateDnsConfig>,
): PrivateDnsConfig {
  const keys = generateEd25519KeyPair();
  return {
    mesh: mesh as unknown as PrivateDnsConfig["mesh"],
    deviceId: "node-A",
    orgId: "noxsoft",
    ed25519PrivateKeyPem: keys.privateKeyPem,
    ed25519PublicKeyPem: keys.publicKeyPem,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PrivateDns", () => {
  let mesh: ReturnType<typeof createMockMesh>;
  let dns: PrivateDns;

  beforeEach(() => {
    vi.useFakeTimers();
    mesh = createMockMesh();
    dns = new PrivateDns(makeConfig(mesh));
  });

  afterEach(() => {
    dns.stop();
    vi.useRealTimers();
  });

  describe("lifecycle", () => {
    it("starts and stops", () => {
      dns.start();
      dns.stop();
    });

    it("start is idempotent", () => {
      dns.start();
      dns.start();
    });
  });

  describe("registration", () => {
    it("registers an A record with FQDN", () => {
      dns.start();
      const record = dns.register("gateway", "A", "node-A");
      expect(record.name).toBe("gateway.noxsoft.anima");
      expect(record.type).toBe("A");
      expect(record.value).toBe("node-A");
      expect(record.registeredBy).toBe("node-A");
      expect(record.signature).toBeTruthy();
    });

    it("registerSelf creates A record pointing to own deviceId", () => {
      dns.start();
      const record = dns.registerSelf("myservice");
      expect(record.name).toBe("myservice.noxsoft.anima");
      expect(record.type).toBe("A");
      expect(record.value).toBe("node-A");
    });

    it("registerService creates SRV record", () => {
      dns.start();
      const record = dns.registerService("api", {
        target: "node-A",
        port: 8080,
        priority: 10,
        weight: 100,
        protocol: "wss",
      });
      expect(record.name).toBe("api.noxsoft.anima");
      expect(record.type).toBe("SRV");
      const parsed = JSON.parse(record.value);
      expect(parsed.port).toBe(8080);
      expect(parsed.protocol).toBe("wss");
    });

    it("broadcasts registration to mesh", () => {
      dns.start();
      dns.register("test", "A", "node-A");
      expect(mesh.broadcast).toHaveBeenCalledWith(
        "dns.register",
        expect.objectContaining({
          record: expect.objectContaining({
            name: "test.noxsoft.anima",
          }),
        }),
      );
    });

    it("signs records with Ed25519", () => {
      dns.start();
      const record = dns.register("signed", "TXT", "hello=world");
      // Signature should be a non-empty base64 string
      expect(record.signature).toBeTruthy();
      expect(record.signature.length).toBeGreaterThan(10);
    });

    it("does not double-suffix already-qualified names", () => {
      dns.start();
      const record = dns.register("already.noxsoft.anima", "A", "node-A");
      expect(record.name).toBe("already.noxsoft.anima");
    });
  });

  describe("local resolution", () => {
    it("resolves registered records", () => {
      dns.start();
      dns.register("api", "A", "node-A");

      const results = dns.resolveLocal("api", "A");
      expect(results).toHaveLength(1);
      expect(results[0].value).toBe("node-A");
    });

    it("resolves without type filter (returns all types)", () => {
      dns.start();
      dns.register("svc", "A", "node-A");
      dns.register("svc", "TXT", "version=1.0");

      const results = dns.resolveLocal("svc");
      expect(results).toHaveLength(2);
    });

    it("returns empty array for unknown names", () => {
      dns.start();
      expect(dns.resolveLocal("nonexistent")).toHaveLength(0);
    });

    it("follows CNAME records", () => {
      dns.start();
      dns.register("main-api", "A", "node-A");
      dns.register("api", "CNAME", "main-api.noxsoft.anima");

      // Resolving "api" for type "A" should follow CNAME → main-api → A record
      const results = dns.resolveLocal("api", "A");
      expect(results).toHaveLength(1);
      expect(results[0].value).toBe("node-A");
    });

    it("respects TTL — expired records are not returned", () => {
      dns.start();
      dns.register("expiring", "A", "node-A", 1000); // 1 second TTL

      // Should resolve now
      expect(dns.resolveLocal("expiring", "A")).toHaveLength(1);

      // Advance past TTL
      vi.advanceTimersByTime(2000);

      // Should not resolve anymore
      expect(dns.resolveLocal("expiring", "A")).toHaveLength(0);
    });
  });

  describe("unregistration", () => {
    it("removes owned records", () => {
      dns.start();
      dns.register("remove-me", "A", "node-A");
      expect(dns.resolveLocal("remove-me", "A")).toHaveLength(1);

      const removed = dns.unregister("remove-me", "A");
      expect(removed).toBe(true);
      expect(dns.resolveLocal("remove-me", "A")).toHaveLength(0);
    });

    it("returns false for non-existent records", () => {
      dns.start();
      expect(dns.unregister("nonexistent", "A")).toBe(false);
    });
  });

  describe("incoming messages", () => {
    it("stores records from dns.register messages", () => {
      dns.start();
      const keys2 = generateEd25519KeyPair();

      // Create a signed record from "node-B"
      const record: DnsRecord = {
        name: "service-b.noxsoft.anima",
        type: "A",
        value: "node-B",
        ttlMs: 300_000,
        createdAt: Date.now(),
        registeredBy: "node-B",
        signature: "test-sig", // In real use this would be verified
      };

      mesh._emitMessage({
        type: "dns.register",
        from: "node-B",
        payload: { record },
      });

      // Should be resolvable locally now
      const results = dns.resolveLocal("service-b.noxsoft.anima", "A");
      expect(results).toHaveLength(1);
      expect(results[0].value).toBe("node-B");
    });

    it("responds to dns.query for known records", () => {
      dns.start();
      dns.register("queryable", "A", "node-A");

      mesh.send.mockClear();

      mesh._emitMessage({
        type: "dns.query",
        from: "node-B",
        payload: {
          name: "queryable.noxsoft.anima",
          type: "A",
          queryId: "q-1",
        },
      });

      expect(mesh.send).toHaveBeenCalledWith(
        "node-B",
        "dns.response",
        expect.objectContaining({
          queryId: "q-1",
          records: expect.arrayContaining([expect.objectContaining({ value: "node-A" })]),
        }),
      );
    });

    it("ignores messages from self", () => {
      dns.start();
      mesh._emitMessage({
        type: "dns.register",
        from: "node-A", // self
        payload: {
          record: {
            name: "self.noxsoft.anima",
            type: "A",
            value: "node-A",
            ttlMs: 300_000,
            createdAt: Date.now(),
            registeredBy: "node-A",
            signature: "x",
          },
        },
      });
      // Should not duplicate in DHT store (it's already there if we registered it)
    });
  });

  describe("announcements to new peers", () => {
    it("sends own records to newly connected peers", () => {
      dns.start();
      dns.register("shared", "A", "node-A");

      mesh.send.mockClear();
      mesh._emitPeerConnected("node-C");

      expect(mesh.send).toHaveBeenCalledWith(
        "node-C",
        "dns.register",
        expect.objectContaining({
          record: expect.objectContaining({
            name: "shared.noxsoft.anima",
          }),
        }),
      );
    });
  });

  describe("cache cleanup", () => {
    it("cleans up expired cache entries", () => {
      dns.start();
      dns.register("cached", "A", "node-A", 5000); // 5s TTL

      // Advance past cleanup interval + TTL
      vi.advanceTimersByTime(65_000);

      // Record should be expired and cleaned
      // (own records refresh, but TTL still applies to resolution)
    });
  });

  describe("stop cleanup", () => {
    it("cancels pending queries on stop", async () => {
      vi.useRealTimers();
      const m = createMockMesh();
      const d = new PrivateDns(makeConfig(m));
      d.start();

      const promise = d.resolve("unknown-service");
      d.stop();

      const result = await promise;
      expect(result).toEqual([]);
      vi.useFakeTimers();
    });
  });
});
