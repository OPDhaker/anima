import { describe, it, expect, afterEach, vi } from "vitest";
import { HttpRateLimiter } from "./http-rate-limit.js";

describe("HttpRateLimiter", () => {
  let limiter: HttpRateLimiter;

  afterEach(() => {
    limiter?.stop();
  });

  it("allows requests under the limit", () => {
    limiter = new HttpRateLimiter({ maxRequests: 5, windowMs: 60_000 });
    for (let i = 0; i < 5; i++) {
      const result = limiter.check("1.2.3.4");
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4 - i);
    }
  });

  it("blocks requests over the limit", () => {
    limiter = new HttpRateLimiter({ maxRequests: 3, windowMs: 60_000 });
    limiter.check("1.2.3.4");
    limiter.check("1.2.3.4");
    limiter.check("1.2.3.4");

    const result = limiter.check("1.2.3.4");
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  it("tracks IPs independently", () => {
    limiter = new HttpRateLimiter({ maxRequests: 2, windowMs: 60_000 });
    limiter.check("1.1.1.1");
    limiter.check("1.1.1.1");

    // IP 1 is at the limit
    expect(limiter.check("1.1.1.1").allowed).toBe(false);
    // IP 2 should still be allowed
    expect(limiter.check("2.2.2.2").allowed).toBe(true);
  });

  it("exempts loopback addresses by default", () => {
    limiter = new HttpRateLimiter({ maxRequests: 1, windowMs: 60_000 });
    limiter.check("127.0.0.1");
    limiter.check("127.0.0.1");
    // Should still be allowed
    expect(limiter.check("127.0.0.1").allowed).toBe(true);
  });

  it("does not exempt loopback when configured off", () => {
    limiter = new HttpRateLimiter({
      maxRequests: 1,
      windowMs: 60_000,
      exemptLoopback: false,
    });
    limiter.check("127.0.0.1");
    expect(limiter.check("127.0.0.1").allowed).toBe(false);
  });

  it("resets after the window expires", () => {
    vi.useFakeTimers();
    limiter = new HttpRateLimiter({ maxRequests: 2, windowMs: 10_000, pruneIntervalMs: 600_000 });

    limiter.check("1.2.3.4");
    limiter.check("1.2.3.4");
    expect(limiter.check("1.2.3.4").allowed).toBe(false);

    // Advance past the window
    vi.advanceTimersByTime(11_000);

    expect(limiter.check("1.2.3.4").allowed).toBe(true);
    vi.useRealTimers();
  });

  it("reports tracked IP count", () => {
    limiter = new HttpRateLimiter({ maxRequests: 10, windowMs: 60_000 });
    expect(limiter.getTrackedCount()).toBe(0);

    limiter.check("1.1.1.1");
    limiter.check("2.2.2.2");
    expect(limiter.getTrackedCount()).toBe(2);
  });

  it("provides correct retryAfterMs when blocked", () => {
    vi.useFakeTimers();
    limiter = new HttpRateLimiter({ maxRequests: 1, windowMs: 30_000, pruneIntervalMs: 600_000 });

    limiter.check("1.2.3.4");
    const blocked = limiter.check("1.2.3.4");

    expect(blocked.allowed).toBe(false);
    // retryAfterMs should be close to windowMs (30s)
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
    expect(blocked.retryAfterMs).toBeLessThanOrEqual(30_000);
    vi.useRealTimers();
  });
});
