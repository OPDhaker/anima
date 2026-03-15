/**
 * Tests for backoff — exponential delay computation + abortable sleep.
 */

import { describe, it, expect } from "vitest";
import type { BackoffPolicy } from "./backoff.js";
import { computeBackoff, sleepWithAbort } from "./backoff.js";

const policy: BackoffPolicy = {
  initialMs: 100,
  maxMs: 10_000,
  factor: 2,
  jitter: 0, // no jitter for deterministic tests
};

describe("computeBackoff", () => {
  it("returns initialMs on first attempt", () => {
    expect(computeBackoff(policy, 1)).toBe(100);
  });

  it("doubles on each attempt", () => {
    expect(computeBackoff(policy, 2)).toBe(200);
    expect(computeBackoff(policy, 3)).toBe(400);
    expect(computeBackoff(policy, 4)).toBe(800);
  });

  it("caps at maxMs", () => {
    expect(computeBackoff(policy, 20)).toBe(10_000);
  });

  it("handles attempt 0 same as 1", () => {
    expect(computeBackoff(policy, 0)).toBe(100);
  });

  it("adds jitter when configured", () => {
    const jitterPolicy: BackoffPolicy = { ...policy, jitter: 0.5 };
    const results = new Set<number>();
    for (let i = 0; i < 20; i++) {
      results.add(computeBackoff(jitterPolicy, 1));
    }
    // With jitter, we should get varying results
    expect(results.size).toBeGreaterThan(1);
  });
});

describe("sleepWithAbort", () => {
  it("resolves after delay", async () => {
    const start = Date.now();
    await sleepWithAbort(10);
    expect(Date.now() - start).toBeGreaterThanOrEqual(5);
  });

  it("returns immediately for 0ms", async () => {
    const start = Date.now();
    await sleepWithAbort(0);
    expect(Date.now() - start).toBeLessThan(10);
  });

  it("returns immediately for negative ms", async () => {
    await sleepWithAbort(-100); // should not throw
  });

  it("throws on abort", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 5);
    await expect(sleepWithAbort(10_000, controller.signal)).rejects.toThrow("aborted");
  });
});
