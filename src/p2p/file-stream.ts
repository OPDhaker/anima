/**
 * P2P File Streaming — Anima v7 Private Internet
 *
 * Progressive download and upload of files through the P2P mesh.
 * Requests chunks in order from the content router, tracking progress
 * and providing a readable stream interface for consumers.
 *
 * Features:
 * - Progressive download: stream chunks in order as they arrive
 * - Parallel chunk fetching: request multiple chunks simultaneously
 * - Progress tracking with events
 * - Resumable downloads: skip already-fetched chunks
 * - Upload: chunk a file and distribute across the mesh
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { Readable, Writable } from "node:stream";
import { createSubsystemLogger } from "../logging/subsystem.js";
import type { ContentManifest } from "./content-router.js";

const log = createSubsystemLogger("p2p-file-stream");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DownloadProgress {
  /** Total chunks in the file */
  totalChunks: number;
  /** Chunks fetched so far */
  fetchedChunks: number;
  /** Total bytes */
  totalBytes: number;
  /** Bytes fetched so far */
  fetchedBytes: number;
  /** Progress percentage (0-100) */
  percent: number;
  /** Estimated time remaining in ms (0 if unknown) */
  estimatedRemainingMs: number;
  /** Download speed in bytes/sec */
  speedBytesPerSec: number;
}

export interface UploadResult {
  /** Content hash (SHA-256 of the full file) */
  contentHash: string;
  /** Manifest hash (for retrieval from the content router) */
  manifestHash: string;
  /** Total bytes uploaded */
  totalBytes: number;
  /** Number of chunks */
  totalChunks: number;
  /** Duration in ms */
  durationMs: number;
}

export interface ChunkFetcher {
  /** Fetch a chunk by its hash. Returns the data or null if not found. */
  fetch(hash: string): Promise<Buffer | null>;
  /** Check if a chunk exists locally. */
  hasLocal(hash: string): boolean;
  /** Get a local chunk. */
  getLocal(hash: string): Buffer | null;
}

export interface ChunkStorer {
  /** Store data and return its SHA-256 hash. */
  store(data: Buffer): string;
  /** Store a file (auto-chunks) and return the manifest hash. */
  storeFile(data: Buffer, metadata?: Record<string, unknown>): string;
  /** Get a chunk by hash. */
  getLocal(hash: string): Buffer | null;
}

// ---------------------------------------------------------------------------
// FileDownloadStream
// ---------------------------------------------------------------------------

export class FileDownloadStream extends EventEmitter {
  private readonly manifest: ContentManifest;
  private readonly fetcher: ChunkFetcher;
  private readonly concurrency: number;
  private fetchedChunks = 0;
  private fetchedBytes = 0;
  private startedAt = 0;
  private aborted = false;

  constructor(manifest: ContentManifest, fetcher: ChunkFetcher, concurrency = 3) {
    super();
    this.manifest = manifest;
    this.fetcher = fetcher;
    this.concurrency = concurrency;
  }

  /**
   * Download the file and write it to a writable stream.
   * Emits 'progress' events during download.
   */
  async downloadTo(output: Writable): Promise<void> {
    this.startedAt = Date.now();
    const { chunkHashes, totalSize } = this.manifest;

    log.info(`starting download: ${chunkHashes.length} chunks, ${totalSize} bytes`);

    // Process chunks in order, but fetch ahead in parallel
    let nextToWrite = 0;
    const fetched = new Map<number, Buffer>();
    const inFlight = new Set<number>();

    const fetchChunk = async (index: number): Promise<void> => {
      if (this.aborted || index >= chunkHashes.length) return;

      const hash = chunkHashes[index];
      inFlight.add(index);

      try {
        // Check local first
        let data = this.fetcher.hasLocal(hash) ? this.fetcher.getLocal(hash) : null;

        // Fetch from peers if not local
        if (!data) {
          data = await this.fetcher.fetch(hash);
        }

        if (!data) {
          throw new Error(`chunk not found: ${hash}`);
        }

        // Verify integrity
        const actualHash = crypto.createHash("sha256").update(data).digest("hex");
        if (actualHash !== hash) {
          throw new Error(`chunk integrity check failed: expected ${hash}, got ${actualHash}`);
        }

        fetched.set(index, data);
      } catch (err) {
        if (!this.aborted) {
          this.emit("error", err);
        }
      } finally {
        inFlight.delete(index);
      }
    };

    // Write chunks in order as they become available
    const writeReady = (): boolean => {
      while (fetched.has(nextToWrite)) {
        const data = fetched.get(nextToWrite)!;
        fetched.delete(nextToWrite);

        output.write(data);
        this.fetchedChunks++;
        this.fetchedBytes += data.length;
        nextToWrite++;

        this.emitProgress();
      }
      return nextToWrite >= chunkHashes.length;
    };

    // Fetch chunks with concurrency control
    let fetchIndex = 0;
    while (nextToWrite < chunkHashes.length && !this.aborted) {
      // Launch fetches up to concurrency limit
      while (inFlight.size < this.concurrency && fetchIndex < chunkHashes.length) {
        void fetchChunk(fetchIndex);
        fetchIndex++;
      }

      // Write any ready chunks
      if (writeReady()) break;

      // Wait for any in-flight fetch to complete
      if (inFlight.size > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
      }
    }

    // Final write pass
    writeReady();

    output.end();
    log.info(`download complete: ${this.fetchedBytes} bytes in ${Date.now() - this.startedAt}ms`);
    this.emit("complete", this.getProgress());
  }

  /**
   * Download to a file path.
   */
  async downloadToFile(filePath: string): Promise<void> {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    const output = fs.createWriteStream(filePath);
    await this.downloadTo(output);
  }

  /**
   * Download and return the full buffer.
   */
  async downloadToBuffer(): Promise<Buffer> {
    const chunks: Buffer[] = [];
    const writable = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(chunk);
        callback();
      },
    });
    await this.downloadTo(writable);
    return Buffer.concat(chunks);
  }

  /**
   * Abort the download.
   */
  abort(): void {
    this.aborted = true;
    this.emit("aborted");
  }

  /**
   * Get current progress.
   */
  getProgress(): DownloadProgress {
    const elapsed = Date.now() - (this.startedAt || Date.now());
    const speed = elapsed > 0 ? (this.fetchedBytes / elapsed) * 1000 : 0;
    const remaining = this.manifest.totalSize - this.fetchedBytes;
    const estimatedRemainingMs = speed > 0 ? (remaining / speed) * 1000 : 0;

    return {
      totalChunks: this.manifest.chunkHashes.length,
      fetchedChunks: this.fetchedChunks,
      totalBytes: this.manifest.totalSize,
      fetchedBytes: this.fetchedBytes,
      percent:
        this.manifest.totalSize > 0
          ? Math.round((this.fetchedBytes / this.manifest.totalSize) * 100)
          : 0,
      estimatedRemainingMs: Math.round(estimatedRemainingMs),
      speedBytesPerSec: Math.round(speed),
    };
  }

  private emitProgress(): void {
    this.emit("progress", this.getProgress());
  }
}

// ---------------------------------------------------------------------------
// File Upload
// ---------------------------------------------------------------------------

/**
 * Upload a file to the mesh via the content router.
 * Chunks the file, stores each chunk, creates a manifest.
 */
export async function uploadFile(params: {
  data: Buffer;
  storer: ChunkStorer;
  metadata?: Record<string, unknown>;
}): Promise<UploadResult> {
  const startedAt = Date.now();
  const contentHash = crypto.createHash("sha256").update(params.data).digest("hex");

  const manifestHash = params.storer.storeFile(params.data, params.metadata);

  const durationMs = Date.now() - startedAt;
  const manifest = params.storer.getLocal(manifestHash);
  let totalChunks = 1;
  if (manifest) {
    try {
      const parsed = JSON.parse(manifest.toString("utf8")) as ContentManifest;
      totalChunks = parsed.chunkHashes?.length ?? 1;
    } catch {
      // single-chunk file
    }
  }

  log.info(
    `upload complete: ${params.data.length} bytes, ${totalChunks} chunks, ${durationMs}ms`,
  );

  return {
    contentHash,
    manifestHash,
    totalBytes: params.data.length,
    totalChunks,
    durationMs,
  };
}

/**
 * Upload a file from disk.
 */
export async function uploadFileFromDisk(params: {
  filePath: string;
  storer: ChunkStorer;
  metadata?: Record<string, unknown>;
}): Promise<UploadResult> {
  const data = fs.readFileSync(params.filePath);
  return uploadFile({
    data,
    storer: params.storer,
    metadata: {
      ...params.metadata,
      originalPath: path.basename(params.filePath),
    },
  });
}
