/**
 * Tests for P2P File Sharing — metadata, directories, share links, access control.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock logging
vi.mock("../logging/subsystem.js", () => {
  const noop = () => {};
  const logger = { info: noop, warn: noop, error: noop, debug: noop, trace: noop };
  return { createSubsystemLogger: () => logger };
});

// Mock state dir to use temp directory
let tmpDir: string;
vi.mock("../config/paths.js", () => ({
  resolveStateDir: () => tmpDir,
}));

import { FileShareManager, detectMimeType } from "./file-share.js";

describe("FileShareManager", () => {
  let manager: FileShareManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "anima-fileshare-test-"));
    manager = new FileShareManager("device-A", "org-1");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("file registration", () => {
    it("registers a file with metadata", () => {
      const file = manager.registerFile({
        name: "readme.md",
        mimeType: "text/markdown",
        size: 1024,
        contentHash: "abc123def456",
        manifestHash: "manifest-hash-1",
      });

      expect(file.name).toBe("readme.md");
      expect(file.mimeType).toBe("text/markdown");
      expect(file.size).toBe(1024);
      expect(file.sharedBy).toBe("device-A");
      expect(file.authorizedDevices).toEqual([]);
      expect(file.tags).toEqual([]);
    });

    it("retrieves a registered file by content hash", () => {
      manager.registerFile({
        name: "test.txt",
        mimeType: "text/plain",
        size: 100,
        contentHash: "hash-123",
        manifestHash: "mhash-123",
      });

      const retrieved = manager.getFile("hash-123");
      expect(retrieved).not.toBeNull();
      expect(retrieved!.name).toBe("test.txt");
    });

    it("returns null for unknown file", () => {
      expect(manager.getFile("nonexistent")).toBeNull();
    });

    it("registers file with tags and description", () => {
      const file = manager.registerFile({
        name: "report.pdf",
        mimeType: "application/pdf",
        size: 50000,
        contentHash: "pdf-hash",
        manifestHash: "pdf-manifest",
        tags: ["report", "q1"],
        description: "Q1 financial report",
      });

      expect(file.tags).toEqual(["report", "q1"]);
      expect(file.description).toBe("Q1 financial report");
    });

    it("registers file with access control", () => {
      const file = manager.registerFile({
        name: "secret.txt",
        mimeType: "text/plain",
        size: 50,
        contentHash: "secret-hash",
        manifestHash: "secret-manifest",
        authorizedDevices: ["device-A", "device-B"],
      });

      expect(file.authorizedDevices).toEqual(["device-A", "device-B"]);
    });
  });

  describe("access control", () => {
    it("public files (empty auth list) allow anyone", () => {
      const file = manager.registerFile({
        name: "public.txt",
        mimeType: "text/plain",
        size: 10,
        contentHash: "pub-hash",
        manifestHash: "pub-manifest",
      });

      expect(manager.isAuthorized(file, "device-X")).toBe(true);
      expect(manager.isAuthorized(file, "device-Y")).toBe(true);
    });

    it("restricted files only allow listed devices", () => {
      const file = manager.registerFile({
        name: "private.txt",
        mimeType: "text/plain",
        size: 10,
        contentHash: "priv-hash",
        manifestHash: "priv-manifest",
        authorizedDevices: ["device-A", "device-B"],
      });

      expect(manager.isAuthorized(file, "device-A")).toBe(true);
      expect(manager.isAuthorized(file, "device-B")).toBe(true);
      expect(manager.isAuthorized(file, "device-C")).toBe(false);
    });
  });

  describe("file listing", () => {
    it("lists all registered files", () => {
      manager.registerFile({
        name: "a.txt",
        mimeType: "text/plain",
        size: 1,
        contentHash: "h1",
        manifestHash: "m1",
      });
      manager.registerFile({
        name: "b.txt",
        mimeType: "text/plain",
        size: 2,
        contentHash: "h2",
        manifestHash: "m2",
      });

      const files = manager.listFiles();
      expect(files).toHaveLength(2);
      const hashes = files.map((f) => f.contentHash).toSorted();
      expect(hashes).toEqual(["h1", "h2"]);
    });

    it("filters by tag", () => {
      manager.registerFile({
        name: "a.txt",
        mimeType: "text/plain",
        size: 1,
        contentHash: "h1",
        manifestHash: "m1",
        tags: ["doc"],
      });
      manager.registerFile({
        name: "b.txt",
        mimeType: "text/plain",
        size: 2,
        contentHash: "h2",
        manifestHash: "m2",
        tags: ["code"],
      });

      const docs = manager.listFiles({ tag: "doc" });
      expect(docs).toHaveLength(1);
      expect(docs[0].name).toBe("a.txt");
    });

    it("filters by sharedBy", () => {
      manager.registerFile({
        name: "mine.txt",
        mimeType: "text/plain",
        size: 1,
        contentHash: "h1",
        manifestHash: "m1",
      });

      const myFiles = manager.listFiles({ sharedBy: "device-A" });
      expect(myFiles).toHaveLength(1);

      const otherFiles = manager.listFiles({ sharedBy: "device-Z" });
      expect(otherFiles).toHaveLength(0);
    });
  });

  describe("file deletion", () => {
    it("deletes a file's metadata", () => {
      manager.registerFile({
        name: "del.txt",
        mimeType: "text/plain",
        size: 1,
        contentHash: "del-hash",
        manifestHash: "del-m",
      });
      expect(manager.getFile("del-hash")).not.toBeNull();

      const result = manager.deleteFile("del-hash");
      expect(result).toBe(true);
      expect(manager.getFile("del-hash")).toBeNull();
    });

    it("returns false for non-existent file", () => {
      expect(manager.deleteFile("nonexistent")).toBe(false);
    });
  });

  describe("directories", () => {
    it("creates a directory", () => {
      const dir = manager.createDirectory({ name: "docs" });
      expect(dir.name).toBe("docs");
      expect(dir.createdBy).toBe("device-A");
      expect(dir.files).toEqual([]);
    });

    it("adds files to a directory", () => {
      const dir = manager.createDirectory({ name: "src" });
      manager.registerFile({
        name: "main.ts",
        mimeType: "text/typescript",
        size: 500,
        contentHash: "ts-hash",
        manifestHash: "ts-m",
      });

      const updated = manager.addFileToDirectory(dir.id, "ts-hash");
      expect(updated).not.toBeNull();
      expect(updated!.files).toContain("ts-hash");
    });

    it("does not duplicate files in directory", () => {
      const dir = manager.createDirectory({ name: "dup-test" });
      manager.addFileToDirectory(dir.id, "hash-1");
      manager.addFileToDirectory(dir.id, "hash-1");

      const retrieved = manager.getDirectory(dir.id);
      expect(retrieved!.files.filter((f) => f === "hash-1")).toHaveLength(1);
    });

    it("lists directories", () => {
      manager.createDirectory({ name: "dir-a" });
      manager.createDirectory({ name: "dir-b" });

      const dirs = manager.listDirectories();
      expect(dirs).toHaveLength(2);
    });
  });

  describe("share links", () => {
    it("creates a share link", () => {
      manager.registerFile({
        name: "shared.txt",
        mimeType: "text/plain",
        size: 10,
        contentHash: "share-hash",
        manifestHash: "share-m",
      });

      const link = manager.createShareLink({ contentHash: "share-hash" });
      expect(link.shareCode).toHaveLength(12);
      expect(link.downloadCount).toBe(0);
      expect(link.expiresAt).toBe(0); // no expiry
    });

    it("resolves a valid share link", () => {
      manager.registerFile({
        name: "shared.txt",
        mimeType: "text/plain",
        size: 10,
        contentHash: "share-hash",
        manifestHash: "share-m",
      });
      const link = manager.createShareLink({ contentHash: "share-hash" });

      const result = manager.resolveShareLink(link.shareCode);
      expect(result).not.toBeNull();
      expect(result!.file.name).toBe("shared.txt");
      expect(result!.link.downloadCount).toBe(1);
    });

    it("rejects expired share links", () => {
      manager.registerFile({
        name: "exp.txt",
        mimeType: "text/plain",
        size: 10,
        contentHash: "exp-hash",
        manifestHash: "exp-m",
      });
      const link = manager.createShareLink({ contentHash: "exp-hash", expiresInMs: -1000 }); // already expired

      const result = manager.resolveShareLink(link.shareCode);
      expect(result).toBeNull();
    });

    it("rejects share links at download limit", () => {
      manager.registerFile({
        name: "lim.txt",
        mimeType: "text/plain",
        size: 10,
        contentHash: "lim-hash",
        manifestHash: "lim-m",
      });
      const link = manager.createShareLink({ contentHash: "lim-hash", maxDownloads: 1 });

      // First download should work
      expect(manager.resolveShareLink(link.shareCode)).not.toBeNull();
      // Second should fail
      expect(manager.resolveShareLink(link.shareCode)).toBeNull();
    });

    it("returns null for invalid share code", () => {
      expect(manager.resolveShareLink("nonexistent")).toBeNull();
    });
  });

  describe("stats", () => {
    it("returns correct stats", () => {
      manager.registerFile({
        name: "a.txt",
        mimeType: "text/plain",
        size: 100,
        contentHash: "h1",
        manifestHash: "m1",
      });
      manager.registerFile({
        name: "b.txt",
        mimeType: "text/plain",
        size: 200,
        contentHash: "h2",
        manifestHash: "m2",
      });
      manager.createDirectory({ name: "d1" });
      manager.createShareLink({ contentHash: "h1" });

      const stats = manager.getStats();
      expect(stats.totalFiles).toBe(2);
      expect(stats.totalSize).toBe(300);
      expect(stats.totalDirectories).toBe(1);
      expect(stats.activeShareLinks).toBe(1);
    });
  });
});

describe("detectMimeType", () => {
  it("detects common file types", () => {
    expect(detectMimeType("file.html")).toBe("text/html");
    expect(detectMimeType("style.css")).toBe("text/css");
    expect(detectMimeType("app.js")).toBe("application/javascript");
    expect(detectMimeType("data.json")).toBe("application/json");
    expect(detectMimeType("photo.png")).toBe("image/png");
    expect(detectMimeType("doc.pdf")).toBe("application/pdf");
    expect(detectMimeType("code.ts")).toBe("text/typescript");
    expect(detectMimeType("readme.md")).toBe("text/markdown");
  });

  it("returns octet-stream for unknown types", () => {
    expect(detectMimeType("file.xyz")).toBe("application/octet-stream");
    expect(detectMimeType("noext")).toBe("application/octet-stream");
  });
});
