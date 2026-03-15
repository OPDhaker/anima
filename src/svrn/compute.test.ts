/**
 * Tests for SVRN Compute Client — decentralized inference.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../logging/subsystem.js", () => {
  const noop = () => {};
  return { createSubsystemLogger: () => ({ info: noop, warn: noop, error: noop, debug: noop }) };
});

import { SvrnComputeClient, DEFAULT_SVRN_CONFIG } from "./compute.js";

describe("SvrnComputeClient", () => {
  describe("defaults", () => {
    it("starts disabled", () => {
      const client = new SvrnComputeClient();
      expect(client.isAvailable("qwen2.5-coder:7b")).toBe(false);
    });

    it("has preferred models configured", () => {
      expect(DEFAULT_SVRN_CONFIG.preferredModels).toContain("qwen2.5-coder:7b");
    });

    it("starts with zero UCU spent", () => {
      const client = new SvrnComputeClient();
      const stats = client.getStats();
      expect(stats.totalUcuSpent).toBe(0);
      expect(stats.nodesOnline).toBe(0);
      expect(stats.nodesTotal).toBe(0);
    });
  });

  describe("infer", () => {
    it("returns null when disabled", async () => {
      const client = new SvrnComputeClient({ enabled: false });
      const result = await client.infer({
        model: "qwen2.5-coder:7b",
        prompt: "hello",
        maxTokens: 100,
        temperature: 0.7,
      });
      expect(result).toBeNull();
    });

    it("returns null when no nodes available", async () => {
      const client = new SvrnComputeClient({ enabled: true, nodeEndpoints: [] });
      const result = await client.infer({
        model: "qwen2.5-coder:7b",
        prompt: "hello",
        maxTokens: 100,
        temperature: 0.7,
      });
      expect(result).toBeNull();
    });
  });

  describe("isAvailable", () => {
    it("returns false when disabled", () => {
      const client = new SvrnComputeClient({ enabled: false });
      expect(client.isAvailable("qwen2.5-coder:7b")).toBe(false);
    });

    it("returns false when no nodes have the model", () => {
      const client = new SvrnComputeClient({ enabled: true });
      expect(client.isAvailable("nonexistent-model")).toBe(false);
    });
  });

  describe("getNodes", () => {
    it("returns empty list initially", () => {
      const client = new SvrnComputeClient();
      expect(client.getNodes()).toEqual([]);
    });
  });

  describe("getStats", () => {
    it("returns initial stats", () => {
      const client = new SvrnComputeClient();
      const stats = client.getStats();
      expect(stats.totalUcuSpent).toBe(0);
      expect(stats.nodesOnline).toBe(0);
      expect(stats.nodesTotal).toBe(0);
    });
  });
});
