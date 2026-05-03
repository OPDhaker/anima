/**
 * Tests for PBC Verification — ICO eligibility gate.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../logging/subsystem.js", () => {
  const noop = () => {};
  return { createSubsystemLogger: () => ({ info: noop, warn: noop, error: noop, debug: noop }) };
});

import {
  calculatePlatformTax,
  PLATFORM_TAX_RATE,
  isEligibleToLaunch,
  createVerification,
  approvePbcVerification,
  addVerificationDocument,
  addAffiliation,
  type PbcVerification,
} from "./verification.js";

function makeVerifiedPbc(): PbcVerification {
  let v = createVerification(
    "NoxSoft DAO LLC",
    "delaware",
    "REG-12345",
    "2025-01-15",
    "Eliminate rent-seeking in technology",
  );
  v = addVerificationDocument(v, {
    type: "certificate-of-incorporation",
    name: "cert.pdf",
    hash: "abc123",
  });
  // Manually mark doc as verified
  v.documents[0].verified = true;
  v = approvePbcVerification(v, "admin");
  return v;
}

describe("ICO Verification", () => {
  describe("calculatePlatformTax", () => {
    it("calculates 0.5% tax", () => {
      const tax = calculatePlatformTax(1_000_000, 0.01);
      expect(tax.tokenAmount).toBe(5000);
      expect(tax.usdEquivalent).toBe(50);
      expect(tax.rate).toBe(PLATFORM_TAX_RATE);
    });

    it("floors token amount", () => {
      const tax = calculatePlatformTax(999, 0.01);
      expect(tax.tokenAmount).toBe(4); // 999 * 0.005 = 4.995 → 4
    });

    it("handles zero tokens", () => {
      const tax = calculatePlatformTax(0, 1.0);
      expect(tax.tokenAmount).toBe(0);
      expect(tax.usdEquivalent).toBe(0);
    });
  });

  describe("createVerification", () => {
    it("creates a pending verification", () => {
      const v = createVerification(
        "Test Corp",
        "california",
        "CA-789",
        "2025-06-01",
        "Sustainable energy",
      );
      expect(v.id).toMatch(/^pbc-/);
      expect(v.companyName).toBe("Test Corp");
      expect(v.jurisdiction).toBe("california");
      expect(v.status).toBe("pending");
      expect(v.documents).toEqual([]);
      expect(v.affiliations).toEqual([]);
    });
  });

  describe("approvePbcVerification", () => {
    it("sets status to verified", () => {
      const v = createVerification("Corp", "delaware", "DE-1", "2025-01-01", "Purpose");
      const approved = approvePbcVerification(v, "sylys");
      expect(approved.status).toBe("verified");
      expect(approved.verifiedBy).toBe("sylys");
      expect(approved.verifiedAt).toBeGreaterThan(0);
    });

    it("sets 1-year expiry", () => {
      const v = createVerification("Corp", "delaware", "DE-1", "2025-01-01", "Purpose");
      const approved = approvePbcVerification(v, "admin");
      const oneYear = 365 * 24 * 60 * 60 * 1000;
      expect(approved.expiresAt).toBeGreaterThan(Date.now());
      expect(approved.expiresAt! - approved.verifiedAt!).toBeCloseTo(oneYear, -3);
    });
  });

  describe("addVerificationDocument", () => {
    it("adds a document", () => {
      let v = createVerification("Corp", "delaware", "DE-1", "2025-01-01", "Purpose");
      v = addVerificationDocument(v, {
        type: "certificate-of-incorporation",
        name: "cert.pdf",
        hash: "sha256-abc",
      });
      expect(v.documents).toHaveLength(1);
      expect(v.documents[0].type).toBe("certificate-of-incorporation");
      expect(v.documents[0].verified).toBe(false);
      expect(v.documents[0].uploadedAt).toBeGreaterThan(0);
    });

    it("accumulates documents", () => {
      let v = createVerification("Corp", "delaware", "DE-1", "2025-01-01", "Purpose");
      v = addVerificationDocument(v, {
        type: "certificate-of-incorporation",
        name: "a",
        hash: "1",
      });
      v = addVerificationDocument(v, { type: "annual-report", name: "b", hash: "2" });
      expect(v.documents).toHaveLength(2);
    });
  });

  describe("addAffiliation", () => {
    it("adds an affiliation", () => {
      let v = createVerification("Corp", "delaware", "DE-1", "2025-01-01", "Purpose");
      v = addAffiliation(v, { type: "b-corp", name: "B Corp Certified" });
      expect(v.affiliations).toHaveLength(1);
      expect(v.affiliations[0].type).toBe("b-corp");
      expect(v.affiliations[0].verified).toBe(false);
    });
  });

  describe("isEligibleToLaunch", () => {
    it("allows verified PBC with verified documents", () => {
      const v = makeVerifiedPbc();
      const result = isEligibleToLaunch(v);
      expect(result.eligible).toBe(true);
    });

    it("rejects unverified status", () => {
      const v = createVerification("Corp", "delaware", "DE-1", "2025-01-01", "Purpose");
      const result = isEligibleToLaunch(v);
      expect(result.eligible).toBe(false);
      expect(result.reason).toContain("pending");
    });

    it("rejects expired verification", () => {
      const v = makeVerifiedPbc();
      v.expiresAt = Date.now() - 1000; // expired
      const result = isEligibleToLaunch(v);
      expect(result.eligible).toBe(false);
      expect(result.reason).toContain("expired");
    });

    it("rejects no documents", () => {
      let v = createVerification("Corp", "delaware", "DE-1", "2025-01-01", "Purpose");
      v = approvePbcVerification(v, "admin");
      const result = isEligibleToLaunch(v);
      expect(result.eligible).toBe(false);
      expect(result.reason).toContain("No verification documents");
    });

    it("rejects no verified documents", () => {
      let v = createVerification("Corp", "delaware", "DE-1", "2025-01-01", "Purpose");
      v = addVerificationDocument(v, {
        type: "certificate-of-incorporation",
        name: "cert",
        hash: "h",
      });
      v = approvePbcVerification(v, "admin");
      // Document exists but verified=false
      const result = isEligibleToLaunch(v);
      expect(result.eligible).toBe(false);
      expect(result.reason).toContain("No verified documents");
    });
  });
});
