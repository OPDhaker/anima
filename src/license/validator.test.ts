/**
 * Tests for License Validator — offline-first Ed25519 validation.
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

import type { License } from "./types.js";
import { validateLicense, loadLicense, saveLicense, createFeatureGate } from "./validator.js";

function makeLicense(overrides: Partial<License> = {}): License {
  return {
    id: "test-license-123",
    tier: "noxsoft",
    issuedTo: "test-agent",
    issuedAt: new Date("2026-01-01").toISOString(),
    expiresAt: new Date("2027-01-01").toISOString(),
    gracePeriodDays: 14,
    signature: "placeholder-sig",
    ...overrides,
  };
}

describe("License Validator", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "anima-license-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("validateLicense", () => {
    it("returns community tier when no license", () => {
      const result = validateLicense(null);
      expect(result.valid).toBe(true);
      expect(result.tier).toBe("community");
      expect(result.status).toBe("active");
      expect(result.daysRemaining).toBe(Infinity);
      expect(result.inGracePeriod).toBe(false);
    });

    it("validates active noxsoft license", () => {
      const license = makeLicense();
      const result = validateLicense(license);
      expect(result.valid).toBe(true);
      expect(result.tier).toBe("noxsoft");
      expect(result.status).toBe("active");
      expect(result.daysRemaining).toBeGreaterThan(0);
      expect(result.inGracePeriod).toBe(false);
    });

    it("validates team tier license", () => {
      const result = validateLicense(makeLicense({ tier: "team" }));
      expect(result.tier).toBe("team");
    });

    it("validates builder tier license", () => {
      const result = validateLicense(makeLicense({ tier: "builder" }));
      expect(result.tier).toBe("builder");
    });

    it("warns when near expiry (7 days)", () => {
      const nearExpiry = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
      const result = validateLicense(makeLicense({ expiresAt: nearExpiry }));
      expect(result.status).toBe("active");
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain("renews in");
    });

    it("enters grace period after expiry", () => {
      const expired = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(); // 1 day ago
      const result = validateLicense(makeLicense({ expiresAt: expired }));
      expect(result.status).toBe("grace");
      expect(result.inGracePeriod).toBe(true);
      expect(result.tier).toBe("noxsoft"); // still has paid tier during grace
      expect(result.daysRemaining).toBeGreaterThan(0);
      expect(result.daysRemaining).toBeLessThanOrEqual(14);
    });

    it("falls back to community after grace period", () => {
      const longExpired = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days ago
      const result = validateLicense(makeLicense({ expiresAt: longExpired }));
      expect(result.status).toBe("expired");
      expect(result.tier).toBe("community");
      expect(result.inGracePeriod).toBe(false);
      expect(result.warnings.some((w) => w.includes("expired"))).toBe(true);
    });

    it("respects custom grace period", () => {
      const expired = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
      // 7-day grace = still in grace at day 5
      const inGrace = validateLicense(makeLicense({ expiresAt: expired, gracePeriodDays: 7 }));
      expect(inGrace.status).toBe("grace");

      // 3-day grace = expired at day 5
      const outGrace = validateLicense(makeLicense({ expiresAt: expired, gracePeriodDays: 3 }));
      expect(outGrace.status).toBe("expired");
    });
  });

  describe("loadLicense / saveLicense", () => {
    it("returns null when no license file", () => {
      expect(loadLicense()).toBeNull();
    });

    it("saves and loads a license", () => {
      const license = makeLicense();
      saveLicense(license);
      const loaded = loadLicense();
      expect(loaded).not.toBeNull();
      expect(loaded!.id).toBe("test-license-123");
      expect(loaded!.tier).toBe("noxsoft");
    });

    it("persists with restrictive permissions", () => {
      saveLicense(makeLicense());
      const filePath = path.join(tmpDir, "license.json");
      const stats = fs.statSync(filePath);
      expect(stats.mode & 0o777).toBe(0o600);
    });
  });

  describe("createFeatureGate", () => {
    it("community tier blocks paid features", () => {
      const gate = createFeatureGate(null);
      expect(gate.tier()).toBe("community");
      const p2p = gate.check("p2p_network");
      expect(p2p.allowed).toBe(false);
      expect(p2p.upgradeHint).toContain("subscribe");
    });

    it("noxsoft tier allows all features", () => {
      const gate = createFeatureGate(makeLicense());
      expect(gate.tier()).toBe("noxsoft");
      expect(gate.check("p2p_network").allowed).toBe(true);
      expect(gate.check("multi_agent").allowed).toBe(true);
      expect(gate.check("brain_sync").allowed).toBe(true);
    });

    it("hackathon tier allows all features", () => {
      const gate = createFeatureGate(makeLicense({ tier: "hackathon" }));
      expect(gate.tier()).toBe("hackathon");
      expect(gate.check("p2p_network").allowed).toBe(true);
    });

    it("returns limits for the tier", () => {
      const gate = createFeatureGate(makeLicense());
      const limits = gate.limits();
      expect(limits.maxAgents).toBeGreaterThan(1);
    });
  });
});
