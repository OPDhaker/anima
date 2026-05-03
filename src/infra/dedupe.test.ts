/**
 * Tests for DedupeCache — event deduplication with TTL.
 */

import { describe, it, expect } from "vitest";
import { createDedupeCache } from "./dedupe.js";

describe("DedupeCache", () => {
  it("returns false for first occurrence", () => {
    const cache = createDedupeCache({ ttlMs: 60_000, maxSize: 100 });
    expect(cache.check("msg-1")).toBe(false);
  });

  it("returns true for duplicate within TTL", () => {
    const cache = createDedupeCache({ ttlMs: 60_000, maxSize: 100 });
    cache.check("msg-1", 1000);
    expect(cache.check("msg-1", 2000)).toBe(true);
  });

  it("returns false after TTL expires", () => {
    const cache = createDedupeCache({ ttlMs: 1000, maxSize: 100 });
    cache.check("msg-1", 1000);
    expect(cache.check("msg-1", 3000)).toBe(false); // 2s after, TTL 1s
  });

  it("returns false for null/undefined keys", () => {
    const cache = createDedupeCache({ ttlMs: 60_000, maxSize: 100 });
    expect(cache.check(null)).toBe(false);
    expect(cache.check(undefined)).toBe(false);
  });

  it("evicts oldest when maxSize exceeded", () => {
    const cache = createDedupeCache({ ttlMs: 60_000, maxSize: 3 });
    cache.check("a", 100);
    cache.check("b", 200);
    cache.check("c", 300);
    cache.check("d", 400); // should evict "a"
    expect(cache.size()).toBeLessThanOrEqual(3);
    // "a" should be evicted, so checking it returns false (new entry)
    expect(cache.check("a", 500)).toBe(false);
  });

  it("clears all entries", () => {
    const cache = createDedupeCache({ ttlMs: 60_000, maxSize: 100 });
    cache.check("a");
    cache.check("b");
    cache.clear();
    expect(cache.size()).toBe(0);
  });

  it("reports size correctly", () => {
    const cache = createDedupeCache({ ttlMs: 60_000, maxSize: 100 });
    expect(cache.size()).toBe(0);
    cache.check("a");
    expect(cache.size()).toBe(1);
    cache.check("b");
    expect(cache.size()).toBe(2);
  });

  it("handles maxSize 0 by clearing on every check", () => {
    const cache = createDedupeCache({ ttlMs: 60_000, maxSize: 0 });
    cache.check("a");
    expect(cache.size()).toBe(0);
  });

  it("handles different keys independently", () => {
    const cache = createDedupeCache({ ttlMs: 60_000, maxSize: 100 });
    cache.check("a");
    cache.check("b");
    expect(cache.check("a")).toBe(true);
    expect(cache.check("c")).toBe(false);
  });
});
