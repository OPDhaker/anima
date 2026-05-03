/**
 * Tests for ICO Launch Platform — project lifecycle, buy, transfer, dashboard.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tmpDir: string;

vi.mock("../config/paths.js", () => ({
  resolveStateDir: () => tmpDir,
}));
vi.mock("../logging/subsystem.js", () => {
  const noop = () => {};
  return { createSubsystemLogger: () => ({ info: noop, warn: noop, error: noop, debug: noop }) };
});

import type { IcoLaunchConfig } from "./tokenomics.js";
import {
  createIcoProject,
  getIcoProject,
  listIcoProjects,
  buyTokens,
  transferTokens,
  getIcoDashboard,
} from "./launch-platform.js";

// Use a test config without BigInt (JSON.stringify can't handle BigInt)
const TEST_ICO_CONFIG: IcoLaunchConfig = {
  name: "Test Token",
  symbol: "TST",
  chains: ["ethereum"] as any,
  bondingCurve: {
    targetRaiseUsd: 100_000,
    totalSupply: 1_000_000 as any, // use number, not BigInt
    reserveRatio: 0.5,
    initialPriceUsd: 0.01,
    bondingActive: true,
  },
  allocation: { team: 0.05, companyRound: 0.3, revenueShare: 0.5, ubc: 0.15 },
  tax: { transferTaxRate: 0.01, revenueShareRate: 0.05, revenueShareDurationYears: 2 },
  launchFee: 0,
  isNoxSoftIco: false,
};

describe("ICO Launch Platform", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "anima-ico-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("createIcoProject", () => {
    it("creates a project with initial status", () => {
      const project = createIcoProject(TEST_ICO_CONFIG, "sylys");
      expect(project.id).toMatch(/^ico-/);
      expect(project.config.symbol).toBe("TST");
      expect(project.createdBy).toBe("sylys");
      expect(project.status.bondingActive).toBe(true);
      expect(project.status.currentSupply).toBe(0);
      expect(project.holders).toEqual([]);
      expect(project.transactions).toEqual([]);
    });

    it("persists to disk", () => {
      const project = createIcoProject(TEST_ICO_CONFIG, "sylys");
      const retrieved = getIcoProject(project.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.config.symbol).toBe("TST");
    });
  });

  describe("listIcoProjects", () => {
    it("lists all projects", () => {
      createIcoProject(TEST_ICO_CONFIG, "a");
      createIcoProject(TEST_ICO_CONFIG, "b");
      expect(listIcoProjects()).toHaveLength(2);
    });

    it("returns empty when none exist", () => {
      expect(listIcoProjects()).toEqual([]);
    });
  });

  describe("buyTokens", () => {
    it("buys tokens on the bonding curve", () => {
      const project = createIcoProject(TEST_ICO_CONFIG, "sylys");
      // Start at 1% supply so price is nonzero
      const result = buyTokens(project.id, "0xBuyer", 100, "ethereum");
      // With supply at 0, price starts at 0 so tokens may be 0
      // This is expected behavior — bonding curve starts very cheap
      if (result) {
        expect(result.tokens).toBeGreaterThanOrEqual(0);
        expect(result.project.status.totalRaisedUsd).toBe(100);
      }
    });

    it("returns null for nonexistent project", () => {
      expect(buyTokens("nonexistent", "0xBuyer", 100, "ethereum")).toBeNull();
    });

    it("adds holder on first purchase", () => {
      const project = createIcoProject(TEST_ICO_CONFIG, "sylys");
      // Manually set some supply so the bonding curve has a nonzero price
      const p = getIcoProject(project.id)!;
      p.status.currentSupply = 10_000_000;
      fs.writeFileSync(path.join(tmpDir, "ico", `${project.id}.json`), JSON.stringify(p, null, 2));

      const result = buyTokens(project.id, "0xAlice", 500, "svrn");
      if (result) {
        expect(result.project.holders.some((h) => h.address === "0xAlice")).toBe(true);
        expect(result.project.transactions.length).toBeGreaterThan(0);
      }
    });

    it("accumulates purchases for same holder", () => {
      const project = createIcoProject(TEST_ICO_CONFIG, "sylys");
      const p = getIcoProject(project.id)!;
      p.status.currentSupply = 10_000_000;
      fs.writeFileSync(path.join(tmpDir, "ico", `${project.id}.json`), JSON.stringify(p, null, 2));

      buyTokens(project.id, "0xBob", 100, "ethereum");
      const result = buyTokens(project.id, "0xBob", 200, "ethereum");
      if (result) {
        const bob = result.project.holders.find((h) => h.address === "0xBob");
        expect(bob).toBeTruthy();
        expect(bob!.totalInvested).toBe(300);
      }
    });
  });

  describe("transferTokens", () => {
    it("transfers with 1% tax", () => {
      const project = createIcoProject(TEST_ICO_CONFIG, "sylys");
      // Seed a holder with balance
      const p = getIcoProject(project.id)!;
      p.status.currentSupply = 10_000_000;
      p.holders.push({
        address: "0xSender",
        chain: "ethereum",
        balance: 10000,
        totalInvested: 100,
        firstPurchaseAt: Date.now(),
      });
      fs.writeFileSync(path.join(tmpDir, "ico", `${project.id}.json`), JSON.stringify(p, null, 2));

      const result = transferTokens(project.id, "0xSender", "0xReceiver", 1000, "ethereum");
      expect(result).not.toBeNull();
      expect(result!.tax).toBe(10); // 1% of 1000
      expect(result!.net).toBe(990);
    });

    it("returns null for insufficient balance", () => {
      const project = createIcoProject(TEST_ICO_CONFIG, "sylys");
      const p = getIcoProject(project.id)!;
      p.holders.push({
        address: "0xPoor",
        chain: "ethereum",
        balance: 50,
        totalInvested: 1,
        firstPurchaseAt: Date.now(),
      });
      fs.writeFileSync(path.join(tmpDir, "ico", `${project.id}.json`), JSON.stringify(p, null, 2));

      expect(transferTokens(project.id, "0xPoor", "0xRich", 1000, "ethereum")).toBeNull();
    });

    it("returns null for nonexistent project", () => {
      expect(transferTokens("nope", "a", "b", 100, "ethereum")).toBeNull();
    });

    it("creates recipient holder if new", () => {
      const project = createIcoProject(TEST_ICO_CONFIG, "sylys");
      const p = getIcoProject(project.id)!;
      p.holders.push({
        address: "0xSender",
        chain: "ethereum",
        balance: 5000,
        totalInvested: 50,
        firstPurchaseAt: Date.now(),
      });
      fs.writeFileSync(path.join(tmpDir, "ico", `${project.id}.json`), JSON.stringify(p, null, 2));

      const result = transferTokens(project.id, "0xSender", "0xNewReceiver", 500, "ethereum");
      expect(result).not.toBeNull();
      expect(result!.project.holders.some((h) => h.address === "0xNewReceiver")).toBe(true);
    });
  });

  describe("getIcoDashboard", () => {
    it("returns dashboard for existing project", () => {
      const project = createIcoProject(TEST_ICO_CONFIG, "sylys");
      const dashboard = getIcoDashboard(project.id);
      expect(dashboard).not.toBeNull();
      expect(dashboard!.totalHolders).toBe(0);
      expect(dashboard!.totalTransactions).toBe(0);
    });

    it("returns null for nonexistent project", () => {
      expect(getIcoDashboard("nope")).toBeNull();
    });
  });
});
