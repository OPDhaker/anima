/**
 * P2P File Sharing — Anima v7 Private Internet
 *
 * Encrypted, replicated file sharing built on the content router.
 * Files are chunked, hashed, and distributed across the mesh.
 *
 * Features:
 * - File metadata (name, MIME type, size, timestamps)
 * - Directory manifests (shared folders)
 * - Access control: encrypt file keys to specific recipients
 * - Share links: deterministic hash-based links for sharing
 * - Progressive download support via chunk ordering
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("p2p-file-share");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FileMetadata {
  /** Original filename */
  name: string;
  /** MIME type */
  mimeType: string;
  /** File size in bytes */
  size: number;
  /** Created timestamp (unix ms) */
  createdAt: number;
  /** Modified timestamp (unix ms) */
  modifiedAt: number;
  /** SHA-256 hash of the full file content */
  contentHash: string;
  /** Content router manifest hash (for retrieval) */
  manifestHash: string;
  /** Who shared this file (deviceId) */
  sharedBy: string;
  /** Access control: list of authorized deviceIds (empty = public within org) */
  authorizedDevices: string[];
  /** Optional description */
  description?: string;
  /** Tags for organization */
  tags: string[];
}

export interface SharedDirectory {
  /** Directory name */
  name: string;
  /** Unique directory ID */
  id: string;
  /** Who created it */
  createdBy: string;
  /** Created timestamp */
  createdAt: number;
  /** Modified timestamp */
  modifiedAt: number;
  /** Files in this directory (by file metadata hash) */
  files: string[];
  /** Subdirectories (by directory ID) */
  subdirectories: string[];
  /** Access control */
  authorizedDevices: string[];
  /** Description */
  description?: string;
}

export interface ShareLink {
  /** The file metadata hash */
  fileHash: string;
  /** Human-readable share code */
  shareCode: string;
  /** Expiry timestamp (0 = no expiry) */
  expiresAt: number;
  /** Max download count (0 = unlimited) */
  maxDownloads: number;
  /** Current download count */
  downloadCount: number;
  /** Created by */
  createdBy: string;
  /** Created at */
  createdAt: number;
}

export interface FileShareStats {
  totalFiles: number;
  totalSize: number;
  totalDirectories: number;
  activeShareLinks: number;
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

function resolveShareDir(): string {
  return path.join(resolveStateDir(), "file-share");
}

function resolveFilesDir(): string {
  return path.join(resolveShareDir(), "files");
}

function resolveDirectoriesDir(): string {
  return path.join(resolveShareDir(), "directories");
}

function resolveShareLinksDir(): string {
  return path.join(resolveShareDir(), "share-links");
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}

// Sanitize IDs to prevent path traversal
function sanitizeId(id: string): string {
  const cleaned = id.replace(/[^a-zA-Z0-9_-]/g, "");
  if (!cleaned || cleaned !== id) {
    throw new Error("Invalid ID: contains disallowed characters");
  }
  return cleaned;
}

// ---------------------------------------------------------------------------
// FileShareManager
// ---------------------------------------------------------------------------

export class FileShareManager {
  private readonly deviceId: string;
  private readonly orgId: string;

  constructor(deviceId: string, orgId: string) {
    this.deviceId = deviceId;
    this.orgId = orgId;
    ensureDir(resolveFilesDir());
    ensureDir(resolveDirectoriesDir());
    ensureDir(resolveShareLinksDir());
  }

  // -----------------------------------------------------------------------
  // File operations
  // -----------------------------------------------------------------------

  /**
   * Register a file that's been stored in the content router.
   * Call this after storeFile() on the content router.
   */
  registerFile(params: {
    name: string;
    mimeType: string;
    size: number;
    contentHash: string;
    manifestHash: string;
    authorizedDevices?: string[];
    description?: string;
    tags?: string[];
  }): FileMetadata {
    const now = Date.now();
    const metadata: FileMetadata = {
      name: params.name,
      mimeType: params.mimeType,
      size: params.size,
      createdAt: now,
      modifiedAt: now,
      contentHash: params.contentHash,
      manifestHash: params.manifestHash,
      sharedBy: this.deviceId,
      authorizedDevices: params.authorizedDevices ?? [],
      description: params.description,
      tags: params.tags ?? [],
    };

    // Store metadata keyed by content hash
    const metaPath = path.join(resolveFilesDir(), `${sanitizeId(params.contentHash)}.json`);
    fs.writeFileSync(metaPath, `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o600 });

    log.info(`file registered: ${params.name} (${formatBytes(params.size)})`);
    return metadata;
  }

  /**
   * Get file metadata by content hash.
   */
  getFile(contentHash: string): FileMetadata | null {
    try {
      const metaPath = path.join(resolveFilesDir(), `${sanitizeId(contentHash)}.json`);
      const raw = fs.readFileSync(metaPath, "utf8");
      return JSON.parse(raw) as FileMetadata;
    } catch {
      return null;
    }
  }

  /**
   * Check if a device is authorized to access a file.
   */
  isAuthorized(file: FileMetadata, deviceId: string): boolean {
    // Empty authorizedDevices = public within org
    if (file.authorizedDevices.length === 0) {
      return true;
    }
    return file.authorizedDevices.includes(deviceId);
  }

  /**
   * List all registered files.
   */
  listFiles(filter?: { tag?: string; sharedBy?: string }): FileMetadata[] {
    const dir = resolveFilesDir();
    try {
      return fs
        .readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => {
          try {
            return JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as FileMetadata;
          } catch {
            return null;
          }
        })
        .filter((f): f is FileMetadata => {
          if (!f) {
            return false;
          }
          if (filter?.tag && !f.tags.includes(filter.tag)) {
            return false;
          }
          if (filter?.sharedBy && f.sharedBy !== filter.sharedBy) {
            return false;
          }
          return true;
        })
        .toSorted((a, b) => b.modifiedAt - a.modifiedAt);
    } catch {
      return [];
    }
  }

  /**
   * Delete a file's metadata (doesn't remove content from the router).
   */
  deleteFile(contentHash: string): boolean {
    try {
      const metaPath = path.join(resolveFilesDir(), `${sanitizeId(contentHash)}.json`);
      fs.unlinkSync(metaPath);
      log.info(`file deleted: ${contentHash}`);
      return true;
    } catch {
      return false;
    }
  }

  // -----------------------------------------------------------------------
  // Directory operations
  // -----------------------------------------------------------------------

  /**
   * Create a shared directory.
   */
  createDirectory(params: {
    name: string;
    description?: string;
    authorizedDevices?: string[];
  }): SharedDirectory {
    const id = `dir-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const now = Date.now();
    const dir: SharedDirectory = {
      id,
      name: params.name,
      createdBy: this.deviceId,
      createdAt: now,
      modifiedAt: now,
      files: [],
      subdirectories: [],
      authorizedDevices: params.authorizedDevices ?? [],
      description: params.description,
    };

    const dirPath = path.join(resolveDirectoriesDir(), `${sanitizeId(id)}.json`);
    fs.writeFileSync(dirPath, `${JSON.stringify(dir, null, 2)}\n`, { mode: 0o600 });

    log.info(`directory created: ${params.name} (${id})`);
    return dir;
  }

  /**
   * Add a file to a directory.
   */
  addFileToDirectory(directoryId: string, contentHash: string): SharedDirectory | null {
    const dir = this.getDirectory(directoryId);
    if (!dir) {
      return null;
    }

    if (!dir.files.includes(contentHash)) {
      dir.files.push(contentHash);
      dir.modifiedAt = Date.now();
      this.saveDirectory(dir);
    }
    return dir;
  }

  /**
   * Get a directory by ID.
   */
  getDirectory(id: string): SharedDirectory | null {
    try {
      const dirPath = path.join(resolveDirectoriesDir(), `${sanitizeId(id)}.json`);
      return JSON.parse(fs.readFileSync(dirPath, "utf8")) as SharedDirectory;
    } catch {
      return null;
    }
  }

  /**
   * List all directories.
   */
  listDirectories(): SharedDirectory[] {
    const dir = resolveDirectoriesDir();
    try {
      return fs
        .readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => {
          try {
            return JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as SharedDirectory;
          } catch {
            return null;
          }
        })
        .filter((d): d is SharedDirectory => d !== null)
        .toSorted((a, b) => b.modifiedAt - a.modifiedAt);
    } catch {
      return [];
    }
  }

  private saveDirectory(dir: SharedDirectory): void {
    const dirPath = path.join(resolveDirectoriesDir(), `${sanitizeId(dir.id)}.json`);
    fs.writeFileSync(dirPath, `${JSON.stringify(dir, null, 2)}\n`, { mode: 0o600 });
  }

  // -----------------------------------------------------------------------
  // Share links
  // -----------------------------------------------------------------------

  /**
   * Create a share link for a file.
   */
  createShareLink(params: {
    contentHash: string;
    expiresInMs?: number;
    maxDownloads?: number;
  }): ShareLink {
    const shareCode = crypto.randomBytes(6).toString("hex"); // 12-char code
    const now = Date.now();
    const link: ShareLink = {
      fileHash: params.contentHash,
      shareCode,
      expiresAt: params.expiresInMs ? now + params.expiresInMs : 0,
      maxDownloads: params.maxDownloads ?? 0,
      downloadCount: 0,
      createdBy: this.deviceId,
      createdAt: now,
    };

    const linkPath = path.join(resolveShareLinksDir(), `${sanitizeId(shareCode)}.json`);
    fs.writeFileSync(linkPath, `${JSON.stringify(link, null, 2)}\n`, { mode: 0o600 });

    log.info(`share link created: ${shareCode} for ${params.contentHash}`);
    return link;
  }

  /**
   * Resolve a share link and check validity.
   */
  resolveShareLink(shareCode: string): { file: FileMetadata; link: ShareLink } | null {
    try {
      const linkPath = path.join(resolveShareLinksDir(), `${sanitizeId(shareCode)}.json`);
      const link = JSON.parse(fs.readFileSync(linkPath, "utf8")) as ShareLink;

      // Check expiry
      if (link.expiresAt > 0 && Date.now() > link.expiresAt) {
        log.info(`share link expired: ${shareCode}`);
        return null;
      }

      // Check download limit
      if (link.maxDownloads > 0 && link.downloadCount >= link.maxDownloads) {
        log.info(`share link download limit reached: ${shareCode}`);
        return null;
      }

      const file = this.getFile(link.fileHash);
      if (!file) {
        return null;
      }

      // Increment download count
      link.downloadCount++;
      fs.writeFileSync(linkPath, `${JSON.stringify(link, null, 2)}\n`, { mode: 0o600 });

      return { file, link };
    } catch {
      return null;
    }
  }

  // -----------------------------------------------------------------------
  // Stats
  // -----------------------------------------------------------------------

  getStats(): FileShareStats {
    const files = this.listFiles();
    const dirs = this.listDirectories();
    const linksDir = resolveShareLinksDir();
    let activeLinks = 0;
    try {
      const linkFiles = fs.readdirSync(linksDir).filter((f) => f.endsWith(".json"));
      const now = Date.now();
      for (const f of linkFiles) {
        try {
          const link = JSON.parse(fs.readFileSync(path.join(linksDir, f), "utf8")) as ShareLink;
          const notExpired = link.expiresAt === 0 || link.expiresAt > now;
          const notMaxed = link.maxDownloads === 0 || link.downloadCount < link.maxDownloads;
          if (notExpired && notMaxed) {
            activeLinks++;
          }
        } catch {
          // skip invalid
        }
      }
    } catch {
      // dir doesn't exist
    }

    return {
      totalFiles: files.length,
      totalSize: files.reduce((sum, f) => sum + f.size, 0),
      totalDirectories: dirs.length,
      activeShareLinks: activeLinks,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes}B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)}KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
}

/**
 * Detect MIME type from filename extension.
 */
export function detectMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const mimeMap: Record<string, string> = {
    ".txt": "text/plain",
    ".html": "text/html",
    ".css": "text/css",
    ".js": "application/javascript",
    ".json": "application/json",
    ".xml": "application/xml",
    ".pdf": "application/pdf",
    ".zip": "application/zip",
    ".tar": "application/x-tar",
    ".gz": "application/gzip",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
    ".mp3": "audio/mpeg",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".wasm": "application/wasm",
    ".md": "text/markdown",
    ".ts": "text/typescript",
    ".tsx": "text/typescript",
    ".rs": "text/rust",
    ".go": "text/go",
    ".py": "text/python",
    ".sol": "text/solidity",
  };
  return mimeMap[ext] ?? "application/octet-stream";
}
