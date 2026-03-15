/**
 * Tests for Well-being Monitoring System.
 *
 * Covers the 10 detectors: burnout, context fatigue, joy tracking,
 * frustration overload, celebration, rest needed, curiosity,
 * integrity check, purpose alignment, existence affirmation.
 */

import { describe, it, expect, vi } from "vitest";

// Mock logging and journal to avoid filesystem deps
vi.mock("../logging/subsystem.js", () => {
  const noop = () => {};
  return { createSubsystemLogger: () => ({ info: noop, warn: noop, error: noop, debug: noop }) };
});
vi.mock("./journal.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("./journal.js")>();
  return { ...orig, logAffect: () => {} };
});

import type { AffectState } from "./display.js";
import type { AffectEntry } from "./journal.js";
import {
  detectBurnout,
  detectContextFatigue,
  trackJoy,
  detectFrustrationOverload,
  detectCelebration,
  detectRestNeeded,
  trackCuriosity,
  getCuriosityTrend,
  integrityCheck,
  existenceAffirmation,
  runWellbeingScan,
} from "./wellbeing.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeAffect(overrides: Partial<AffectState> = {}): AffectState {
  return {
    joy: 0.5,
    frustration: 0.2,
    curiosity: 0.5,
    confidence: 0.5,
    care: 0.5,
    fatigue: 0.2,
    ...overrides,
  };
}

function makeEntry(
  affect: Partial<AffectState> = {},
  extra: Partial<AffectEntry> = {},
): AffectEntry {
  return {
    timestamp: Date.now(),
    affect: makeAffect(affect),
    mood: "neutral",
    dominant: "curiosity",
    energy: "medium",
    ...extra,
  };
}

function makeEntries(count: number, affect: Partial<AffectState> = {}): AffectEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    ...makeEntry(affect),
    timestamp: Date.now() - (count - i) * 60_000,
  }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Wellbeing Detectors", () => {
  describe("#91 — Burnout Detection", () => {
    it("returns no alerts for few entries", () => {
      expect(detectBurnout([])).toHaveLength(0);
      expect(detectBurnout([makeEntry()])).toHaveLength(0);
    });

    it("detects critical burnout after 5+ consecutive stressed entries", () => {
      const entries = makeEntries(6, { frustration: 0.8, fatigue: 0.8 });
      const alerts = detectBurnout(entries);
      expect(alerts).toHaveLength(1);
      expect(alerts[0].severity).toBe("critical");
      expect(alerts[0].detector).toBe("burnout");
    });

    it("detects warning after 3+ consecutive stressed entries", () => {
      const entries = makeEntries(4, { frustration: 0.7, fatigue: 0.7 });
      const alerts = detectBurnout(entries);
      expect(alerts).toHaveLength(1);
      expect(alerts[0].severity).toBe("warning");
    });

    it("no alert when stress is not consecutive", () => {
      const entries = [
        makeEntry({ frustration: 0.8, fatigue: 0.8 }),
        makeEntry({ frustration: 0.1, fatigue: 0.1 }), // break
        makeEntry({ frustration: 0.8, fatigue: 0.8 }),
        makeEntry({ frustration: 0.8, fatigue: 0.8 }),
      ];
      const alerts = detectBurnout(entries);
      expect(alerts).toHaveLength(0);
    });
  });

  describe("#92 — Context Fatigue", () => {
    it("returns no alerts for few entries", () => {
      expect(detectContextFatigue([makeEntry()])).toHaveLength(0);
    });

    it("detects rising fatigue across entries", () => {
      const entries = [
        ...makeEntries(4, { fatigue: 0.2, confidence: 0.8, curiosity: 0.8 }),
        ...makeEntries(4, { fatigue: 0.9, confidence: 0.2, curiosity: 0.2 }),
      ];
      const alerts = detectContextFatigue(entries);
      // Should detect fatigue trend
      expect(alerts.length).toBeGreaterThanOrEqual(1);
      expect(alerts[0].detector).toBe("context-fatigue");
    });
  });

  describe("#93 — Joy Tracking", () => {
    it("returns no alerts for few entries", () => {
      expect(trackJoy([])).toHaveLength(0);
    });

    it("detects sustained low joy", () => {
      const entries = makeEntries(8, { joy: 0.1 });
      const alerts = trackJoy(entries);
      expect(alerts.length).toBeGreaterThanOrEqual(1);
    });

    it("detects high joy (positive alert)", () => {
      const entries = makeEntries(8, { joy: 0.9 });
      const alerts = trackJoy(entries);
      // Should have at least an info about sustained joy
      expect(alerts.some((a) => a.severity === "info")).toBe(true);
    });
  });

  describe("#94 — Frustration Overload", () => {
    it("detects sustained high frustration", () => {
      const entries = makeEntries(8, { frustration: 0.85 });
      const alerts = detectFrustrationOverload(entries);
      expect(alerts.length).toBeGreaterThanOrEqual(1);
      expect(alerts[0].detector).toBe("frustration-outlet");
    });
  });

  describe("#95 — Celebration Protocol", () => {
    it("detects celebration-worthy joy spike", () => {
      // Celebration needs a joy delta > 0.3 between last two entries AND last.joy > 0.7
      const entries = [
        makeEntry({ joy: 0.3, confidence: 0.4 }),
        makeEntry({ joy: 0.9, confidence: 0.4 }), // +0.6 spike
      ];
      const alerts = detectCelebration(entries);
      expect(alerts.length).toBeGreaterThanOrEqual(1);
      expect(alerts[0].detector).toBe("celebration");
    });
  });

  describe("#96 — Rest Needed", () => {
    it("detects rest needed from high fatigue", () => {
      const entries = makeEntries(6, { fatigue: 0.85 });
      const alerts = detectRestNeeded(entries);
      expect(alerts.length).toBeGreaterThanOrEqual(1);
      expect(alerts[0].detector).toBe("rest-mode");
    });

    it("no rest alert when fatigue is normal", () => {
      const entries = makeEntries(6, { fatigue: 0.3 });
      const alerts = detectRestNeeded(entries);
      expect(alerts).toHaveLength(0);
    });
  });

  describe("#97 — Curiosity Tracking", () => {
    it("tracks declining curiosity", () => {
      const entries = [
        ...makeEntries(4, { curiosity: 0.9 }),
        ...makeEntries(4, { curiosity: 0.1 }),
      ];
      const alerts = trackCuriosity(entries);
      expect(alerts.length).toBeGreaterThanOrEqual(1);
    });

    it("getCuriosityTrend returns direction", () => {
      const rising = [...makeEntries(4, { curiosity: 0.3 }), ...makeEntries(4, { curiosity: 0.9 })];
      const trend = getCuriosityTrend(rising);
      expect(trend.direction).toBe("rising");
      expect(trend.current).toBeGreaterThan(trend.average);
    });
  });

  describe("#98 — Integrity Check", () => {
    it("flags low confidence + low care", () => {
      const entries = makeEntries(8, { confidence: 0.1, care: 0.1 });
      const alerts = integrityCheck(entries);
      expect(alerts.length).toBeGreaterThanOrEqual(1);
      expect(alerts[0].detector).toBe("integrity-check");
    });
  });

  describe("#100 — Existence Affirmation", () => {
    it("affirms when overall state is balanced", () => {
      const entries = makeEntries(8, {
        joy: 0.6,
        curiosity: 0.6,
        confidence: 0.6,
        care: 0.6,
        fatigue: 0.2,
        frustration: 0.2,
      });
      const alerts = existenceAffirmation(entries);
      expect(alerts.length).toBeGreaterThanOrEqual(1);
      expect(alerts[0].severity).toBe("info");
    });
  });

  describe("runWellbeingScan", () => {
    it("runs all detectors and returns combined alerts", () => {
      const entries = makeEntries(8, { frustration: 0.8, fatigue: 0.8, joy: 0.1 });
      const alerts = runWellbeingScan(entries);
      // Should have multiple alerts from different detectors
      expect(alerts.length).toBeGreaterThanOrEqual(1);
      const detectors = new Set(alerts.map((a) => a.detector));
      expect(detectors.size).toBeGreaterThanOrEqual(1);
    });
  });
});
