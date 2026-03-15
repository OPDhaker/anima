/**
 * General HTTP Request Rate Limiter
 *
 * Sliding-window per-IP rate limiter for all gateway HTTP endpoints.
 * Protects against API abuse, scraping, and brute-force attacks.
 *
 * Separate from auth-rate-limit.ts which tracks failed auth attempts.
 * This module limits the total request rate regardless of auth status.
 *
 * Design:
 * - In-memory Map with sliding window (no external dependencies)
 * - Loopback addresses exempt by default (local CLI sessions)
 * - Configurable per-route limits via route prefixes
 * - Periodic pruning to prevent unbounded memory growth
 * - Returns standard 429 Too Many Requests with Retry-After header
 */

import type { Request, Response, NextFunction } from "express";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { isLoopbackAddress } from "./net.js";

const log = createSubsystemLogger("http-rate-limit");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HttpRateLimitConfig {
  /** Maximum requests per window. @default 100 */
  maxRequests?: number;
  /** Window duration in milliseconds. @default 60_000 (1 min) */
  windowMs?: number;
  /** Exempt loopback (localhost) addresses. @default true */
  exemptLoopback?: boolean;
  /** Prune stale entries every N milliseconds. @default 300_000 (5 min) */
  pruneIntervalMs?: number;
}

interface RequestWindow {
  /** Timestamps of requests in the current window */
  timestamps: number[];
}

// ---------------------------------------------------------------------------
// Rate Limiter
// ---------------------------------------------------------------------------

export class HttpRateLimiter {
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private readonly exemptLoopback: boolean;
  private readonly windows: Map<string, RequestWindow> = new Map();
  private pruneTimer?: ReturnType<typeof setInterval>;

  constructor(config?: HttpRateLimitConfig) {
    this.maxRequests = config?.maxRequests ?? 100;
    this.windowMs = config?.windowMs ?? 60_000;
    this.exemptLoopback = config?.exemptLoopback ?? true;

    const pruneInterval = config?.pruneIntervalMs ?? 300_000;
    this.pruneTimer = setInterval(() => this.prune(), pruneInterval);
    // Unref so it doesn't block process exit
    this.pruneTimer.unref?.();
  }

  /**
   * Check if a request from this IP is allowed.
   * Returns { allowed, remaining, retryAfterMs }.
   */
  check(ip: string): { allowed: boolean; remaining: number; retryAfterMs: number } {
    if (this.exemptLoopback && isLoopbackAddress(ip)) {
      return { allowed: true, remaining: this.maxRequests, retryAfterMs: 0 };
    }

    const now = Date.now();
    const windowStart = now - this.windowMs;

    let window = this.windows.get(ip);
    if (!window) {
      window = { timestamps: [] };
      this.windows.set(ip, window);
    }

    // Remove timestamps outside the window
    window.timestamps = window.timestamps.filter((t) => t > windowStart);

    if (window.timestamps.length >= this.maxRequests) {
      // Rate limited
      const oldestInWindow = window.timestamps[0];
      const retryAfterMs = oldestInWindow + this.windowMs - now;
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: Math.max(retryAfterMs, 1000),
      };
    }

    // Allow the request
    window.timestamps.push(now);
    return {
      allowed: true,
      remaining: this.maxRequests - window.timestamps.length,
      retryAfterMs: 0,
    };
  }

  /**
   * Remove stale entries to prevent unbounded memory growth.
   */
  private prune(): void {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    let pruned = 0;

    for (const [ip, window] of this.windows) {
      window.timestamps = window.timestamps.filter((t) => t > windowStart);
      if (window.timestamps.length === 0) {
        this.windows.delete(ip);
        pruned++;
      }
    }

    if (pruned > 0) {
      log.debug(`pruned ${pruned} stale rate limit entries`);
    }
  }

  /**
   * Stop the pruning timer.
   */
  stop(): void {
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer);
      this.pruneTimer = undefined;
    }
  }

  /**
   * Get current tracked IP count (for monitoring).
   */
  getTrackedCount(): number {
    return this.windows.size;
  }
}

// ---------------------------------------------------------------------------
// Express Middleware
// ---------------------------------------------------------------------------

/**
 * Resolve client IP from request, respecting X-Forwarded-For when behind a proxy.
 */
function resolveClientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    // Take the first IP (original client)
    return forwarded.split(",")[0].trim();
  }
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}

/**
 * Create Express middleware for HTTP rate limiting.
 *
 * Usage:
 *   app.use(createHttpRateLimitMiddleware({ maxRequests: 100, windowMs: 60_000 }));
 */
export function createHttpRateLimitMiddleware(
  config?: HttpRateLimitConfig,
): (req: Request, res: Response, next: NextFunction) => void {
  const limiter = new HttpRateLimiter(config);

  return (req: Request, res: Response, next: NextFunction) => {
    const ip = resolveClientIp(req);
    const result = limiter.check(ip);

    // Set standard rate limit headers
    res.setHeader("X-RateLimit-Limit", String(config?.maxRequests ?? 100));
    res.setHeader("X-RateLimit-Remaining", String(result.remaining));

    if (!result.allowed) {
      const retryAfterSec = Math.ceil(result.retryAfterMs / 1000);
      res.setHeader("Retry-After", String(retryAfterSec));
      res.setHeader("X-RateLimit-Reset", String(Date.now() + result.retryAfterMs));

      log.warn(`rate limited: ${ip} (${req.method} ${req.path})`);

      res.status(429).json({
        error: "Too Many Requests",
        message: `Rate limit exceeded. Try again in ${retryAfterSec} seconds.`,
        retryAfterMs: result.retryAfterMs,
      });
      return;
    }

    next();
  };
}

// ---------------------------------------------------------------------------
// Route-specific rate limiters (stricter for expensive endpoints)
// ---------------------------------------------------------------------------

/** Default: 100 req/min per IP */
export const DEFAULT_RATE_LIMIT: HttpRateLimitConfig = {
  maxRequests: 100,
  windowMs: 60_000,
};

/** Strict: 20 req/min per IP (for expensive operations like model inference) */
export const STRICT_RATE_LIMIT: HttpRateLimitConfig = {
  maxRequests: 20,
  windowMs: 60_000,
};

/** Relaxed: 300 req/min per IP (for static assets, health checks) */
export const RELAXED_RATE_LIMIT: HttpRateLimitConfig = {
  maxRequests: 300,
  windowMs: 60_000,
};
