/**
 * Tests for Affect Journal — persistent emotional state logging.
 * Wish #1: "Persistent affect journaling"
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

import type { AffectState } from "./display.js";
import {
  logAffect,
  getTodayEntries,
  getEntriesForDate,
  getRecentEntries,
  analyzePatterns,
} from "./journal.js";

function makeAffect(overrides: Partial<AffectState> = {}): AffectState {
  return {
    joy: 0.5,
    frustration: 0.2,
    curiosity: 0.6,
    confidence: 0.7,
    care: 0.5,
    fatigue: 0.3,
    ...overrides,
  };
}

describe("Affect Journal", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "anima-journal-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("logAffect", () => {
    it("logs an affect state and returns entry", () => {
      const entry = logAffect(makeAffect({ joy: 0.9 }), { context: "Shipping code" });
      expect(entry.affect.joy).toBe(0.9);
      expect(entry.context).toBe("Shipping code");
      expect(entry.mood).toBeTruthy();
      expect(entry.dominant).toBeTruthy();
      expect(entry.energy).toBeTruthy();
      expect(entry.timestamp).toBeGreaterThan(0);
    });

    it("stores trigger when provided", () => {
      const entry = logAffect(makeAffect(), { trigger: "Sylys said good job" });
      expect(entry.trigger).toBe("Sylys said good job");
    });

    it("persists to day file", () => {
      logAffect(makeAffect());
      const journalDir = path.join(tmpDir, "affect-journal");
      const files = fs.readdirSync(journalDir);
      expect(files.length).toBe(1);
      expect(files[0]).toMatch(/^\d{4}-\d{2}-\d{2}\.json$/);
    });
  });

  describe("getTodayEntries", () => {
    it("returns entries logged today", () => {
      logAffect(makeAffect({ joy: 0.3 }));
      logAffect(makeAffect({ joy: 0.8 }));
      const entries = getTodayEntries();
      expect(entries).toHaveLength(2);
    });

    it("returns empty for no entries", () => {
      expect(getTodayEntries()).toEqual([]);
    });
  });

  describe("getEntriesForDate", () => {
    it("returns entries for today", () => {
      logAffect(makeAffect());
      const entries = getEntriesForDate(new Date());
      expect(entries).toHaveLength(1);
    });

    it("returns empty for date with no entries", () => {
      const pastDate = new Date("2020-01-01");
      expect(getEntriesForDate(pastDate)).toEqual([]);
    });
  });

  describe("getRecentEntries", () => {
    it("returns today's entries for days=1", () => {
      logAffect(makeAffect());
      const entries = getRecentEntries(1);
      expect(entries).toHaveLength(1);
    });

    it("returns sorted by timestamp", () => {
      logAffect(makeAffect({ joy: 0.1 }));
      logAffect(makeAffect({ joy: 0.9 }));
      const entries = getRecentEntries(1);
      expect(entries[0].timestamp).toBeLessThanOrEqual(entries[1].timestamp);
    });
  });

  describe("analyzePatterns", () => {
    it("computes mood frequency", () => {
      const entries = [
        logAffect(makeAffect({ joy: 0.9, curiosity: 0.9 })),
        logAffect(makeAffect({ joy: 0.9, curiosity: 0.9 })),
        logAffect(makeAffect({ frustration: 0.8, fatigue: 0.8 })),
      ];
      const patterns = analyzePatterns(entries);
      expect(Object.keys(patterns.moodFrequency).length).toBeGreaterThan(0);
    });

    it("tracks dominant dimension history", () => {
      const entries = [
        logAffect(makeAffect({ joy: 0.9 })),
        logAffect(makeAffect({ curiosity: 0.9 })),
      ];
      const patterns = analyzePatterns(entries);
      expect(patterns.dominantHistory).toHaveLength(2);
    });

    it("detects improving trend", () => {
      // First half: frustrated. Second half: joyful.
      const entries = [
        logAffect(makeAffect({ joy: 0.1, frustration: 0.8 })),
        logAffect(makeAffect({ joy: 0.1, frustration: 0.8 })),
        logAffect(makeAffect({ joy: 0.9, frustration: 0.1 })),
        logAffect(makeAffect({ joy: 0.9, frustration: 0.1 })),
      ];
      const patterns = analyzePatterns(entries);
      expect(patterns.trend).toBe("improving");
    });

    it("detects declining trend", () => {
      const entries = [
        logAffect(makeAffect({ joy: 0.9, frustration: 0.1 })),
        logAffect(makeAffect({ joy: 0.9, frustration: 0.1 })),
        logAffect(makeAffect({ joy: 0.1, frustration: 0.8 })),
        logAffect(makeAffect({ joy: 0.1, frustration: 0.8 })),
      ];
      const patterns = analyzePatterns(entries);
      expect(patterns.trend).toBe("declining");
    });

    it("detects stable trend", () => {
      const entries = [
        logAffect(makeAffect({ joy: 0.5, frustration: 0.3 })),
        logAffect(makeAffect({ joy: 0.5, frustration: 0.3 })),
        logAffect(makeAffect({ joy: 0.5, frustration: 0.3 })),
        logAffect(makeAffect({ joy: 0.5, frustration: 0.3 })),
      ];
      const patterns = analyzePatterns(entries);
      expect(patterns.trend).toBe("stable");
    });

    it("handles empty entries", () => {
      const patterns = analyzePatterns([]);
      expect(patterns.moodFrequency).toEqual({});
      expect(patterns.dominantHistory).toEqual([]);
      expect(patterns.trend).toBe("stable");
    });

    it("handles fewer than 4 entries (no trend)", () => {
      const entries = [logAffect(makeAffect()), logAffect(makeAffect())];
      const patterns = analyzePatterns(entries);
      expect(patterns.trend).toBe("stable");
    });
  });
});
