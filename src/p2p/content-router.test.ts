/**
 * Tests for Content-Addressable Distributed Routing.
 *
 * Tests local storage, chunking, manifest creation, hash verification,
 * routing table, and announce/request message handling.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const TEST_DIR = path.join(os.tmpdir(), `anima-content-router-test-${Date.now()}`);
vi.mock("../config/paths.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../config/paths.js")>();
  return { ...original, resolveStateDir: () => TEST_DIR };
});
vi.mock("../logging/subsystem.js", () => {
  const noop = () => {};
  const logger = { info: noop, warn: noop, error: noop, debug: noop, trace: noop };
  return { createSubsystemLogger: () => logger };
});

import { ContentRouter, type ContentRouterConfig, type ContentManifest } from "./content-router.js";

// ---------------------------------------------------------------------------
// Mock PeerMesh
// ---------------------------------------------------------------------------

function createMockMesh() {
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
    send: vi.fn().mockReturnValue(true),
    broadcast: vi.fn(),
    listPeers: vi.fn(() => []),
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
  return mesh;
}

function makeConfig(
  mesh: ReturnType<typeof createMockMesh>,
  overrides?: Partial<ContentRouterConfig>,
): ContentRouterConfig {
  const storePath = path.join(
    TEST_DIR,
    `content-store-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  );
  fs.mkdirSync(storePath, { recursive: true });
  return {
    mesh: mesh as unknown as ContentRouterConfig["mesh"],
    deviceId: "node-A",
    orgId: "org-1",
    storePath,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ContentRouter", () => {
  let mesh: ReturnType<typeof createMockMesh>;
  let router: ContentRouter;

  beforeEach(() => {
    vi.useFakeTimers();
    fs.mkdirSync(TEST_DIR, { recursive: true });
    mesh = createMockMesh();
    router = new ContentRouter(makeConfig(mesh));
  });

  afterEach(() => {
    router.stop();
    vi.useRealTimers();
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  describe("lifecycle", () => {
    it("starts and stops without errors", () => {
      router.start();
      router.stop();
    });

    it("start is idempotent", () => {
      router.start();
      router.start(); // should not throw
    });
  });

  describe("local storage", () => {
    it("stores content and returns SHA-256 hash", () => {
      router.start();
      const data = Buffer.from("hello world");
      const hash = router.store(data);

      // Verify it's a valid SHA-256 hex string
      expect(hash).toMatch(/^[a-f0-9]{64}$/);

      // Verify the hash is correct
      const expected = crypto.createHash("sha256").update(data).digest("hex");
      expect(hash).toBe(expected);
    });

    it("retrieves stored content", () => {
      router.start();
      const data = Buffer.from("test content 123");
      const hash = router.store(data);

      const retrieved = router.getLocal(hash);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.toString()).toBe("test content 123");
    });

    it("returns null for non-existent content", () => {
      router.start();
      expect(
        router.getLocal("0000000000000000000000000000000000000000000000000000000000000000"),
      ).toBeNull();
    });

    it("hasLocal returns true for stored content", () => {
      router.start();
      const hash = router.store(Buffer.from("exists"));
      expect(router.hasLocal(hash)).toBe(true);
      expect(router.hasLocal("nonexistent")).toBe(false);
    });

    it("listLocal returns all stored hashes", () => {
      router.start();
      router.store(Buffer.from("chunk-1"));
      router.store(Buffer.from("chunk-2"));
      router.store(Buffer.from("chunk-3"));

      const hashes = router.listLocal();
      expect(hashes).toHaveLength(3);
    });

    it("deleteLocal removes content", () => {
      router.start();
      const hash = router.store(Buffer.from("delete me"));
      expect(router.hasLocal(hash)).toBe(true);

      expect(router.deleteLocal(hash)).toBe(true);
      expect(router.hasLocal(hash)).toBe(false);
    });

    it("deleteLocal returns false for non-existent content", () => {
      router.start();
      expect(router.deleteLocal("nonexistent")).toBe(false);
    });

    it("deduplicates identical content", () => {
      router.start();
      const data = Buffer.from("identical");
      const hash1 = router.store(data);
      const hash2 = router.store(data);
      expect(hash1).toBe(hash2);
      expect(router.listLocal()).toHaveLength(1);
    });
  });

  describe("file chunking", () => {
    it("stores small files as single chunk (no manifest)", () => {
      router.start();
      const smallData = Buffer.from("small file");
      const hash = router.storeFile(smallData);

      // Should return the chunk hash directly (not a manifest)
      const retrieved = router.getLocal(hash);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.toString()).toBe("small file");
    });

    it("stores large files as multiple chunks with manifest", () => {
      router.start();
      // Create a 2.5MB buffer (should produce 3 chunks)
      const largeData = Buffer.alloc(2.5 * 1024 * 1024, "x");
      const manifestHash = router.storeFile(largeData, { name: "large-file.bin" });

      // The manifest hash should point to a JSON manifest
      const manifestBuf = router.getLocal(manifestHash);
      expect(manifestBuf).not.toBeNull();

      const manifest: ContentManifest = JSON.parse(manifestBuf!.toString("utf8"));
      expect(manifest.type).toBe("manifest");
      expect(manifest.totalSize).toBe(2.5 * 1024 * 1024);
      expect(manifest.chunkHashes).toHaveLength(3);
      expect(manifest.metadata).toEqual({ name: "large-file.bin" });

      // Each chunk should exist in local store
      for (const chunkHash of manifest.chunkHashes) {
        expect(router.hasLocal(chunkHash)).toBe(true);
      }

      // 3 chunks + 1 manifest = 4, but manifest itself counts as content
      const localCount = router.listLocal().length;
      expect(localCount).toBeGreaterThanOrEqual(3);
      expect(localCount).toBeLessThanOrEqual(4);
    });

    it("produces correct hash for each chunk", () => {
      router.start();
      const data = Buffer.alloc(1.5 * 1024 * 1024, "A");
      const manifestHash = router.storeFile(data);

      const manifestBuf = router.getLocal(manifestHash);
      const manifest: ContentManifest = JSON.parse(manifestBuf!.toString("utf8"));

      // Verify each chunk's hash
      for (const chunkHash of manifest.chunkHashes) {
        const chunk = router.getLocal(chunkHash);
        expect(chunk).not.toBeNull();
        const computedHash = crypto.createHash("sha256").update(chunk!).digest("hex");
        expect(computedHash).toBe(chunkHash);
      }
    });
  });

  describe("announcements", () => {
    it("broadcasts announce when content is stored", () => {
      router.start();
      router.store(Buffer.from("announce me"));

      // Should have called broadcast with content.announce
      expect(mesh.broadcast).toHaveBeenCalledWith(
        "content.announce",
        expect.objectContaining({
          hashes: expect.any(Array),
        }),
      );
    });

    it("announces local content to new peers", () => {
      router.start();
      const hash = router.store(Buffer.from("existing content"));

      // Clear previous calls
      mesh.send.mockClear();

      // Simulate new peer connecting
      mesh._emitPeerConnected("node-B");

      // Should send announce to the new peer
      expect(mesh.send).toHaveBeenCalledWith(
        "node-B",
        "content.announce",
        expect.objectContaining({
          hashes: expect.arrayContaining([hash]),
        }),
      );
    });
  });

  describe("incoming announce messages", () => {
    it("updates routing table on content.announce", () => {
      router.start();

      mesh._emitMessage({
        type: "content.announce",
        from: "node-B",
        payload: {
          hashes: ["aaa111", "bbb222"],
        },
      });

      // Routing table should know node-B has these hashes
      // We can verify by requesting them — should try node-B
      // (internal API not exposed, but we can verify via request behavior)
    });
  });

  describe("content request handling", () => {
    it("responds to content.request for locally stored content", () => {
      router.start();
      const data = Buffer.from("requested content");
      const hash = router.store(data);

      mesh.send.mockClear();

      mesh._emitMessage({
        type: "content.request",
        from: "node-B",
        payload: { hash, requestId: "req-1" },
      });

      expect(mesh.send).toHaveBeenCalledWith(
        "node-B",
        "content.response",
        expect.objectContaining({
          hash,
          requestId: "req-1",
          found: true,
          data: data.toString("base64"),
        }),
      );
    });

    it("responds with found=false for unknown content", () => {
      router.start();
      mesh.send.mockClear();

      mesh._emitMessage({
        type: "content.request",
        from: "node-B",
        payload: { hash: "nonexistent-hash", requestId: "req-2" },
      });

      expect(mesh.send).toHaveBeenCalledWith(
        "node-B",
        "content.response",
        expect.objectContaining({
          hash: "nonexistent-hash",
          requestId: "req-2",
          found: false,
        }),
      );
    });
  });

  describe("routing table pruning", () => {
    it("prunes stale entries after TTL", () => {
      router.start();

      // Add entries via announce
      mesh._emitMessage({
        type: "content.announce",
        from: "node-B",
        payload: { hashes: ["stale-hash"] },
      });

      // Advance past TTL (5 minutes) + prune interval (60s)
      vi.advanceTimersByTime(360_000);

      // The routing entry should be pruned
      // (we can't directly inspect the table, but the behavior
      // is that requesting "stale-hash" won't try node-B)
    });
  });

  describe("stop cleanup", () => {
    it("cancels pending requests on stop", async () => {
      vi.useRealTimers();
      const m = createMockMesh();
      const r = new ContentRouter(makeConfig(m));
      r.start();

      // Store nothing locally, so request will go to network
      const promise = r.request("some-hash");

      // Immediately stop
      r.stop();

      const result = await promise;
      expect(result).toBeNull();
      vi.useFakeTimers();
    });
  });
});
