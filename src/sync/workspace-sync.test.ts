/**
 * Tests for Workspace Sync — content-addressable blob store + snapshots.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tmpDir: string;

vi.mock("../config/paths.js", () => ({
  resolveStateDir: () => tmpDir,
}));
vi.mock("../logging/subsystem.js", () => {
  const noop = () => {};
  return { createSubsystemLogger: () => ({ info: noop, warn: noop, error: noop, debug: noop }) };
});

import { BlobStore, WorkspaceSyncer } from "./workspace-sync.js";

describe("BlobStore", () => {
  let storeDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "anima-ws-test-"));
    storeDir = tmpDir;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("stores a blob and returns SHA-256 hash", () => {
    const store = new BlobStore(storeDir);
    const hash = store.put(Buffer.from("hello world"));
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("retrieves stored blob by hash", () => {
    const store = new BlobStore(storeDir);
    const content = Buffer.from("test content");
    const hash = store.put(content);
    const retrieved = store.get(hash);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.equals(content)).toBe(true);
  });

  it("returns null for unknown hash", () => {
    const store = new BlobStore(storeDir);
    expect(store.get("0".repeat(64))).toBeNull();
  });

  it("deduplicates identical content", () => {
    const store = new BlobStore(storeDir);
    const content = Buffer.from("duplicate me");
    const hash1 = store.put(content);
    const hash2 = store.put(content);
    expect(hash1).toBe(hash2);
  });

  it("reports existence with has()", () => {
    const store = new BlobStore(storeDir);
    const hash = store.put(Buffer.from("exists"));
    expect(store.has(hash)).toBe(true);
    expect(store.has("0".repeat(64))).toBe(false);
  });

  it("shards blobs by first 2 chars of hash", () => {
    const store = new BlobStore(storeDir);
    const hash = store.put(Buffer.from("shard test"));
    const shardDir = path.join(storeDir, "sync", "blobs", hash.slice(0, 2));
    expect(fs.existsSync(shardDir)).toBe(true);
  });
});

describe("WorkspaceSyncer", () => {
  let workspaceDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "anima-ws-test-"));
    workspaceDir = path.join(tmpDir, "workspace");
    fs.mkdirSync(workspaceDir, { recursive: true });
    fs.writeFileSync(path.join(workspaceDir, "hello.txt"), "Hello World");
    fs.writeFileSync(path.join(workspaceDir, "src.ts"), "export const x = 1;");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("createSnapshot", () => {
    it("creates a snapshot of workspace files", () => {
      const syncer = new WorkspaceSyncer({ stateDir: tmpDir });
      const snapshot = syncer.createSnapshot(workspaceDir, "device-A");

      expect(snapshot.id).toBeTruthy();
      expect(snapshot.deviceId).toBe("device-A");
      expect(snapshot.files.length).toBe(2);
      expect(snapshot.treeHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("includes file metadata", () => {
      const syncer = new WorkspaceSyncer({ stateDir: tmpDir });
      const snapshot = syncer.createSnapshot(workspaceDir, "device-A");

      const hello = snapshot.files.find((f) => f.relativePath === "hello.txt");
      expect(hello).toBeTruthy();
      expect(hello!.hash).toMatch(/^[a-f0-9]{64}$/);
      expect(hello!.size).toBeGreaterThan(0);
    });

    it("produces deterministic tree hash", () => {
      const syncer = new WorkspaceSyncer({ stateDir: tmpDir });
      const snap1 = syncer.createSnapshot(workspaceDir, "device-A");
      const snap2 = syncer.createSnapshot(workspaceDir, "device-A");
      expect(snap1.treeHash).toBe(snap2.treeHash);
    });

    it("tracks parent snapshot", () => {
      const syncer = new WorkspaceSyncer({ stateDir: tmpDir });
      const parent = syncer.createSnapshot(workspaceDir, "device-A");
      const child = syncer.createSnapshot(workspaceDir, "device-A", parent.id);
      expect(child.parentSnapshotId).toBe(parent.id);
    });

    it("ignores default patterns", () => {
      fs.mkdirSync(path.join(workspaceDir, "node_modules", "pkg"), { recursive: true });
      fs.writeFileSync(path.join(workspaceDir, "node_modules", "pkg", "index.js"), "module");
      fs.writeFileSync(path.join(workspaceDir, ".env"), "SECRET=x");
      fs.writeFileSync(path.join(workspaceDir, "debug.log"), "log data");

      const syncer = new WorkspaceSyncer({ stateDir: tmpDir });
      const snapshot = syncer.createSnapshot(workspaceDir, "device-A");

      const paths = snapshot.files.map((f) => f.relativePath);
      expect(paths).not.toContain("node_modules/pkg/index.js");
      expect(paths).not.toContain(".env");
      expect(paths).not.toContain("debug.log");
      // But should include our actual files
      expect(paths).toContain("hello.txt");
      expect(paths).toContain("src.ts");
    });
  });

  describe("restoreSnapshot", () => {
    it("restores files from a snapshot", () => {
      const syncer = new WorkspaceSyncer({ stateDir: tmpDir });
      const snapshot = syncer.createSnapshot(workspaceDir, "device-A");

      const restoreDir = path.join(tmpDir, "restored");
      syncer.restoreSnapshot(snapshot, restoreDir);

      expect(fs.readFileSync(path.join(restoreDir, "hello.txt"), "utf8")).toBe("Hello World");
      expect(fs.readFileSync(path.join(restoreDir, "src.ts"), "utf8")).toBe("export const x = 1;");
    });
  });

  describe("getMissingBlobs", () => {
    it("identifies blobs peer doesn't have", () => {
      const syncer = new WorkspaceSyncer({ stateDir: tmpDir });
      const snapshot = syncer.createSnapshot(workspaceDir, "device-A");

      // Peer has none
      const missing = syncer.getMissingBlobs(new Set(), snapshot);
      expect(missing.length).toBe(2);

      // Peer has one
      const peerHas = new Set([snapshot.files[0].hash]);
      const missing2 = syncer.getMissingBlobs(peerHas, snapshot);
      expect(missing2.length).toBe(1);
    });
  });

  describe("getManifest", () => {
    it("returns manifest for a repo", () => {
      const syncer = new WorkspaceSyncer({ stateDir: tmpDir });
      syncer.createSnapshot(workspaceDir, "device-A");

      const manifest = syncer.getManifest(workspaceDir, "device-A");
      expect(manifest).not.toBeNull();
      expect(manifest!.repoPath).toBe(workspaceDir);
      expect(manifest!.snapshotCount).toBe(1);
      expect(manifest!.totalSize).toBeGreaterThan(0);
    });

    it("returns null when no snapshots exist", () => {
      const syncer = new WorkspaceSyncer({ stateDir: tmpDir });
      expect(syncer.getManifest("/nonexistent", "device-A")).toBeNull();
    });
  });

  describe("immutable backup", () => {
    it("creates read-only backup copy", () => {
      const syncer = new WorkspaceSyncer({ stateDir: tmpDir });
      const backupPath = syncer.createImmutableBackup(workspaceDir, "device-A");

      expect(fs.existsSync(backupPath)).toBe(true);
      expect(fs.existsSync(path.join(backupPath, "hello.txt"))).toBe(true);
      expect(fs.existsSync(path.join(backupPath, ".snapshot.json"))).toBe(true);
    });
  });
});
