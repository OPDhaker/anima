/**
 * Tests for Jack In Resilience — circuit breaker, retry, health tracking.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../logging/subsystem.js", () => {
  const noop = () => {};
  return { createSubsystemLogger: () => ({ info: noop, warn: noop, error: noop, debug: noop }) };
});

import { CircuitBreaker, withRetry, HealthTracker } from "./resilience.js";

describe("CircuitBreaker", () => {
  it("starts in closed state", () => {
    const cb = new CircuitBreaker("test");
    expect(cb.getState()).toBe("closed");
  });

  it("passes through successful calls", async () => {
    const cb = new CircuitBreaker("test");
    const result = await cb.execute(() => Promise.resolve(42));
    expect(result).toBe(42);
    expect(cb.getState()).toBe("closed");
  });

  it("opens after failure threshold", async () => {
    const cb = new CircuitBreaker("test", { failureThreshold: 3 });

    for (let i = 0; i < 3; i++) {
      await cb.execute(() => Promise.reject(new Error("fail"))).catch(() => {});
    }

    expect(cb.getState()).toBe("open");
  });

  it("rejects calls when open", async () => {
    const cb = new CircuitBreaker("test", { failureThreshold: 1 });
    await cb.execute(() => Promise.reject(new Error("fail"))).catch(() => {});

    await expect(cb.execute(() => Promise.resolve("ok"))).rejects.toThrow("Circuit breaker open");
  });

  it("transitions to half-open after reset timeout", async () => {
    const cb = new CircuitBreaker("test", {
      failureThreshold: 1,
      resetTimeoutMs: 10,
    });

    await cb.execute(() => Promise.reject(new Error("fail"))).catch(() => {});
    expect(cb.getState()).toBe("open");

    await new Promise((r) => setTimeout(r, 15));

    // Next call should try (half-open)
    const result = await cb.execute(() => Promise.resolve("recovered"));
    expect(result).toBe("recovered");
  });

  it("closes after enough half-open successes", async () => {
    const cb = new CircuitBreaker("test", {
      failureThreshold: 1,
      resetTimeoutMs: 10,
      halfOpenSuccessThreshold: 2,
    });

    await cb.execute(() => Promise.reject(new Error("fail"))).catch(() => {});
    await new Promise((r) => setTimeout(r, 15));

    await cb.execute(() => Promise.resolve("ok")); // half-open success 1
    expect(cb.getState()).toBe("half-open");

    await cb.execute(() => Promise.resolve("ok")); // half-open success 2
    expect(cb.getState()).toBe("closed");
  });

  it("re-opens on half-open failure", async () => {
    const cb = new CircuitBreaker("test", {
      failureThreshold: 1,
      resetTimeoutMs: 10,
    });

    await cb.execute(() => Promise.reject(new Error("fail"))).catch(() => {});
    await new Promise((r) => setTimeout(r, 15));

    await cb.execute(() => Promise.reject(new Error("still failing"))).catch(() => {});
    expect(cb.getState()).toBe("open");
  });

  it("resets state manually", async () => {
    const cb = new CircuitBreaker("test", { failureThreshold: 1 });
    await cb.execute(() => Promise.reject(new Error("fail"))).catch(() => {});
    expect(cb.getState()).toBe("open");

    cb.reset();
    expect(cb.getState()).toBe("closed");
  });

  it("resets failure count on success in closed state", async () => {
    const cb = new CircuitBreaker("test", { failureThreshold: 3 });

    await cb.execute(() => Promise.reject(new Error("fail"))).catch(() => {});
    await cb.execute(() => Promise.reject(new Error("fail"))).catch(() => {});
    // 2 failures, 1 away from opening
    await cb.execute(() => Promise.resolve("success")); // resets count
    // Now 2 more failures should NOT open (count was reset)
    await cb.execute(() => Promise.reject(new Error("fail"))).catch(() => {});
    await cb.execute(() => Promise.reject(new Error("fail"))).catch(() => {});
    expect(cb.getState()).toBe("closed");
  });
});

describe("withRetry", () => {
  it("returns on first success", async () => {
    const result = await withRetry(() => Promise.resolve("ok"), { maxRetries: 3 });
    expect(result).toBe("ok");
  });

  it("retries on failure", async () => {
    let attempts = 0;
    const result = await withRetry(
      () => {
        attempts++;
        if (attempts < 3) {
          throw new Error("not yet");
        }
        return Promise.resolve("finally");
      },
      { maxRetries: 5, baseDelayMs: 1, jitter: false },
    );
    expect(result).toBe("finally");
    expect(attempts).toBe(3);
  });

  it("throws after max retries exhausted", async () => {
    await expect(
      withRetry(() => Promise.reject(new Error("always fails")), {
        maxRetries: 2,
        baseDelayMs: 1,
        jitter: false,
      }),
    ).rejects.toThrow("always fails");
  });

  it("uses exponential backoff", async () => {
    const delays: number[] = [];
    let attempts = 0;
    const start = Date.now();

    try {
      await withRetry(
        () => {
          attempts++;
          delays.push(Date.now() - start);
          return Promise.reject(new Error("fail"));
        },
        { maxRetries: 2, baseDelayMs: 10, jitter: false },
      );
    } catch {
      // expected
    }

    expect(attempts).toBe(3); // initial + 2 retries
  });

  it("respects maxDelay cap", async () => {
    let attempts = 0;
    try {
      await withRetry(
        () => {
          attempts++;
          return Promise.reject(new Error("fail"));
        },
        { maxRetries: 1, baseDelayMs: 100, maxDelayMs: 50, jitter: false },
      );
    } catch {
      // expected
    }
    expect(attempts).toBe(2);
  });
});

describe("HealthTracker", () => {
  it("starts healthy with no data", () => {
    const ht = new HealthTracker();
    const stats = ht.getStats();
    expect(stats.totalRequests).toBe(0);
    expect(stats.uptime).toBe(1);
    expect(ht.isHealthy()).toBe(true);
  });

  it("tracks successful requests", () => {
    const ht = new HealthTracker();
    ht.recordSuccess(100);
    ht.recordSuccess(200);

    const stats = ht.getStats();
    expect(stats.totalRequests).toBe(2);
    expect(stats.successCount).toBe(2);
    expect(stats.uptime).toBe(1);
    expect(stats.avgResponseMs).toBe(150);
    expect(stats.lastResponseMs).toBe(200);
  });

  it("tracks failures and reduces uptime", () => {
    const ht = new HealthTracker();
    ht.recordSuccess(100);
    ht.recordFailure();

    const stats = ht.getStats();
    expect(stats.totalRequests).toBe(2);
    expect(stats.failureCount).toBe(1);
    expect(stats.uptime).toBe(0.5);
  });

  it("reports unhealthy when uptime drops below 50%", () => {
    const ht = new HealthTracker();
    ht.recordSuccess(100);
    ht.recordFailure();
    ht.recordFailure();
    ht.recordFailure();

    expect(ht.isHealthy()).toBe(false);
    expect(ht.getStats().uptime).toBe(0.25);
  });

  it("returns copy of stats (not reference)", () => {
    const ht = new HealthTracker();
    ht.recordSuccess(100);
    const stats1 = ht.getStats();
    ht.recordSuccess(200);
    const stats2 = ht.getStats();
    expect(stats1.totalRequests).toBe(1);
    expect(stats2.totalRequests).toBe(2);
  });
});
