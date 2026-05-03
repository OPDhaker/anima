/**
 * Tests for ICO Tokenomics — bonding curve, revenue share, allocation.
 */

import { describe, it, expect } from "vitest";
import {
  NOXSOFT_TOKEN_ALLOCATION,
  NOXSOFT_TAX_CONFIG,
  NOXSOFT_ICO_CONFIG,
  DEFAULT_BONDING_CURVE,
  bondingCurvePrice,
  tokensForInvestment,
  totalRaisedAtSupply,
  isBondingCapReached,
  calculateTransferTax,
  calculateRevenueShare,
  createIcoStatus,
} from "./tokenomics.js";

describe("Tokenomics", () => {
  describe("allocation", () => {
    it("allocations sum to 100%", () => {
      const a = NOXSOFT_TOKEN_ALLOCATION;
      const total = a.team + a.companyRound + a.revenueShare + a.ubc;
      expect(total).toBeCloseTo(1.0);
    });

    it("has correct allocation percentages", () => {
      expect(NOXSOFT_TOKEN_ALLOCATION.team).toBe(0.05);
      expect(NOXSOFT_TOKEN_ALLOCATION.companyRound).toBe(0.3);
      expect(NOXSOFT_TOKEN_ALLOCATION.revenueShare).toBe(0.5);
      expect(NOXSOFT_TOKEN_ALLOCATION.ubc).toBe(0.15);
    });
  });

  describe("bondingCurvePrice", () => {
    it("returns low price at low supply", () => {
      const price = bondingCurvePrice(1_000_000); // 0.1% of supply
      expect(price).toBeGreaterThan(0);
      expect(price).toBeLessThan(0.01);
    });

    it("returns higher price at higher supply", () => {
      const lowPrice = bondingCurvePrice(10_000_000);
      const highPrice = bondingCurvePrice(500_000_000);
      expect(highPrice).toBeGreaterThan(lowPrice);
    });

    it("follows monotonically increasing curve", () => {
      let prev = 0;
      for (const supply of [1e6, 10e6, 100e6, 500e6, 900e6]) {
        const price = bondingCurvePrice(supply);
        expect(price).toBeGreaterThan(prev);
        prev = price;
      }
    });

    it("returns 0 when bonding is inactive", () => {
      const config = { ...DEFAULT_BONDING_CURVE, bondingActive: false };
      expect(bondingCurvePrice(100_000_000, config)).toBe(0);
    });

    it("uses initial price as base", () => {
      // At very low supply, price should be close to initial
      const price = bondingCurvePrice(1, DEFAULT_BONDING_CURVE);
      // Price at supply=1 out of 1B is extremely low
      expect(price).toBeLessThan(DEFAULT_BONDING_CURVE.initialPriceUsd);
    });
  });

  describe("tokensForInvestment", () => {
    it("returns tokens for a USD investment", () => {
      // Start at 1% supply so curve has nonzero price
      const tokens = tokensForInvestment(100, 10_000_000);
      expect(tokens).toBeGreaterThan(0);
    });

    it("returns more tokens at lower supply (cheaper)", () => {
      const earlyTokens = tokensForInvestment(1000, 10_000_000);
      const lateTokens = tokensForInvestment(1000, 500_000_000);
      expect(earlyTokens).toBeGreaterThan(lateTokens);
    });

    it("returns 0 for 0 investment", () => {
      expect(tokensForInvestment(0, 0)).toBe(0);
    });

    it("returns integer token count", () => {
      const tokens = tokensForInvestment(500, 10_000_000);
      expect(tokens).toBe(Math.floor(tokens));
    });
  });

  describe("totalRaisedAtSupply", () => {
    it("returns 0 at 0 supply", () => {
      expect(totalRaisedAtSupply(0)).toBe(0);
    });

    it("increases with supply", () => {
      const low = totalRaisedAtSupply(100_000_000);
      const high = totalRaisedAtSupply(500_000_000);
      expect(high).toBeGreaterThan(low);
    });
  });

  describe("isBondingCapReached", () => {
    it("returns false below target", () => {
      expect(isBondingCapReached(1_000_000)).toBe(false);
    });

    it("returns true at target", () => {
      expect(isBondingCapReached(2_000_000)).toBe(true);
    });

    it("returns true above target", () => {
      expect(isBondingCapReached(3_000_000)).toBe(true);
    });
  });

  describe("calculateTransferTax", () => {
    it("calculates 1% tax", () => {
      const { tax, net } = calculateTransferTax(10000);
      expect(tax).toBe(100);
      expect(net).toBe(9900);
    });

    it("tax + net = original amount", () => {
      const amount = 12345;
      const { tax, net } = calculateTransferTax(amount);
      expect(tax + net).toBe(amount);
    });

    it("returns floor for fractional tax", () => {
      const { tax } = calculateTransferTax(99); // 99 * 0.01 = 0.99 → 0
      expect(tax).toBe(0);
    });

    it("uses custom config", () => {
      const config = { ...NOXSOFT_TAX_CONFIG, transferTaxRate: 0.05 }; // 5%
      const { tax } = calculateTransferTax(1000, config);
      expect(tax).toBe(50);
    });
  });

  describe("calculateRevenueShare", () => {
    it("calculates 5% revenue share", () => {
      const share = calculateRevenueShare(100_000);
      expect(share).toBe(5000);
    });

    it("uses custom config", () => {
      const config = { ...NOXSOFT_TAX_CONFIG, revenueShareRate: 0.1 };
      expect(calculateRevenueShare(100_000, config)).toBe(10_000);
    });
  });

  describe("NOXSOFT_ICO_CONFIG", () => {
    it("has correct token metadata", () => {
      expect(NOXSOFT_ICO_CONFIG.name).toBe("NoxSoft Token");
      expect(NOXSOFT_ICO_CONFIG.symbol).toBe("NOX");
      expect(NOXSOFT_ICO_CONFIG.chains).toEqual(["svrn", "ethereum"]);
      expect(NOXSOFT_ICO_CONFIG.launchFee).toBe(0);
      expect(NOXSOFT_ICO_CONFIG.isNoxSoftIco).toBe(true);
    });
  });

  describe("createIcoStatus", () => {
    it("creates initial status", () => {
      const status = createIcoStatus(NOXSOFT_ICO_CONFIG);
      expect(status.currentSupply).toBe(0);
      expect(status.totalRaisedUsd).toBe(0);
      expect(status.bondingActive).toBe(true);
      expect(status.percentToTarget).toBe(0);
      expect(status.holders).toBe(0);
      expect(status.chainStatus.svrn.deployed).toBe(false);
      expect(status.chainStatus.ethereum.deployed).toBe(false);
    });

    it("uses initial price from config", () => {
      const status = createIcoStatus(NOXSOFT_ICO_CONFIG);
      expect(status.currentPriceUsd).toBe(0.001);
    });
  });
});
