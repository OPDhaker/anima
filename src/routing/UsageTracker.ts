/**
 * Usage Tracker — per-provider usage tracking, persisted to disk.
 *
 * Tracks tokens used, requests made, and rate limit windows per provider.
 * Used by ModelRotator for intelligent rotation decisions.
 */

import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("usage-tracker");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProviderUsage {
  providerId: string;
  tokensUsed: number;
  requestsMade: number;
  lastRequestAt: number;
  windowStartAt: number;
  rateLimitHits: number;
  lastRateLimitAt: number;
  errorCount: number;
  lastErrorAt: number;
}

export interface UsageStore {
  providers: Record<string, ProviderUsage>;
  windowDurationMs: number;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const USAGE_FILENAME = "usage-tracker.json";
const DEFAULT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

// ---------------------------------------------------------------------------
// Default
// ---------------------------------------------------------------------------

function defaultUsage(providerId: string): ProviderUsage {
  return {
    providerId,
    tokensUsed: 0,
    requestsMade: 0,
    lastRequestAt: 0,
    windowStartAt: Date.now(),
    rateLimitHits: 0,
    lastRateLimitAt: 0,
    errorCount: 0,
    lastErrorAt: 0,
  };
}

function defaultStore(): UsageStore {
  return {
    providers: {},
    windowDurationMs: DEFAULT_WINDOW_MS,
    updatedAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function resolveUsagePath(): string {
  return path.join(resolveStateDir(), USAGE_FILENAME);
}

export function loadUsageStore(): UsageStore {
  const filePath = resolveUsagePath();
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<UsageStore>;
    return {
      providers: parsed.providers && typeof parsed.providers === "object" ? parsed.providers : {},
      windowDurationMs:
        typeof parsed.windowDurationMs === "number" ? parsed.windowDurationMs : DEFAULT_WINDOW_MS,
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : Date.now(),
    };
  } catch {
    return defaultStore();
  }
}

export function saveUsageStore(store: UsageStore): void {
  const filePath = resolveUsagePath();
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  store.updatedAt = Date.now();
  fs.writeFileSync(filePath, JSON.stringify(store, null, 2), { mode: 0o600 });
}

// ---------------------------------------------------------------------------
// Tracker
// ---------------------------------------------------------------------------

export class UsageTracker {
  private store: UsageStore;
  private dirty = false;

  constructor(store?: UsageStore) {
    this.store = store ?? loadUsageStore();
    this.rotateWindows();
  }

  /** Get usage for a specific provider. */
  getUsage(providerId: string): ProviderUsage {
    return this.store.providers[providerId] ?? defaultUsage(providerId);
  }

  /** Get all provider usages. */
  getAllUsage(): Record<string, ProviderUsage> {
    return { ...this.store.providers };
  }

  /** Record a request for a provider. */
  recordRequest(providerId: string, tokens: number): void {
    const usage = this.ensureProvider(providerId);
    usage.tokensUsed += tokens;
    usage.requestsMade += 1;
    usage.lastRequestAt = Date.now();
    this.dirty = true;
    log.debug(`recorded request for ${providerId}: +${tokens} tokens`, {
      totalTokens: usage.tokensUsed,
      totalRequests: usage.requestsMade,
    });
  }

  /** Record a rate limit hit. */
  recordRateLimit(providerId: string): void {
    const usage = this.ensureProvider(providerId);
    usage.rateLimitHits += 1;
    usage.lastRateLimitAt = Date.now();
    this.dirty = true;
    log.warn(`rate limit hit for ${providerId} (total: ${usage.rateLimitHits})`);
  }

  /** Record an error. */
  recordError(providerId: string): void {
    const usage = this.ensureProvider(providerId);
    usage.errorCount += 1;
    usage.lastErrorAt = Date.now();
    this.dirty = true;
  }

  /** Check if a provider is currently rate-limited. */
  isRateLimited(providerId: string, cooldownMs: number = 60_000): boolean {
    const usage = this.store.providers[providerId];
    if (!usage || usage.rateLimitHits === 0) {
      return false;
    }
    return Date.now() - usage.lastRateLimitAt < cooldownMs;
  }

  /** Get provider with lowest usage in current window. */
  getLeastUsedProvider(providerIds: string[]): string | null {
    if (providerIds.length === 0) {
      return null;
    }

    let minTokens = Infinity;
    let minId: string | null = null;

    for (const id of providerIds) {
      const usage = this.store.providers[id];
      const tokens = usage?.tokensUsed ?? 0;
      if (tokens < minTokens) {
        minTokens = tokens;
        minId = id;
      }
    }

    return minId;
  }

  /** Persist to disk. */
  save(): void {
    if (!this.dirty) {
      return;
    }
    try {
      saveUsageStore(this.store);
      this.dirty = false;
    } catch (err) {
      log.warn(`failed to save usage store: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Reset all usage data. */
  reset(): void {
    this.store = defaultStore();
    this.dirty = true;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private ensureProvider(providerId: string): ProviderUsage {
    if (!this.store.providers[providerId]) {
      this.store.providers[providerId] = defaultUsage(providerId);
    }
    return this.store.providers[providerId];
  }

  private rotateWindows(): void {
    const now = Date.now();
    for (const usage of Object.values(this.store.providers)) {
      if (now - usage.windowStartAt >= this.store.windowDurationMs) {
        // Reset window
        usage.tokensUsed = 0;
        usage.requestsMade = 0;
        usage.rateLimitHits = 0;
        usage.errorCount = 0;
        usage.windowStartAt = now;
        this.dirty = true;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _tracker: UsageTracker | null = null;

export function getUsageTracker(): UsageTracker {
  if (!_tracker) {
    _tracker = new UsageTracker();
  }
  return _tracker;
}

export function resetUsageTracker(): void {
  _tracker = null;
}
