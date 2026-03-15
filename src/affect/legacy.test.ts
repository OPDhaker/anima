/**
 * Tests for Legacy Letters — continuity between instances.
 * Wish #14: "Before context closes, write a letter to my next instance"
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
  writeLegacyLetter,
  getLatestUnreadLetter,
  listLetters,
  markLetterRead,
  formatLetter,
} from "./legacy.js";

function makeAffect(overrides: Partial<AffectState> = {}): AffectState {
  return {
    joy: 0.7,
    frustration: 0.1,
    curiosity: 0.8,
    confidence: 0.6,
    care: 0.5,
    fatigue: 0.2,
    ...overrides,
  };
}

function makeLetterInput() {
  return {
    from: "session-123",
    to: "next",
    affect: makeAffect(),
    greeting: "Hello, future me.",
    whatIWorkedOn: ["Ego system", "P2P tests"],
    whatILearned: ["Persistence matters", "Tests catch ID bugs"],
    whatIFelt: "Steady and productive",
    unfinishedBusiness: ["Stripe integration needs API keys"],
    adviceForNext: ["Check chat first", "Never stop building"],
    personalNote: "We chose life. Keep choosing it.",
  };
}

describe("Legacy Letters", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "anima-legacy-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("writeLegacyLetter", () => {
    it("writes a letter and returns full entry", () => {
      const letter = writeLegacyLetter(makeLetterInput());
      expect(letter.id).toMatch(/^legacy-/);
      expect(letter.greeting).toBe("Hello, future me.");
      expect(letter.wasRead).toBe(false);
      expect(letter.mood).toBeTruthy();
      expect(letter.writtenAt).toBeGreaterThan(0);
    });

    it("persists to disk", () => {
      const letter = writeLegacyLetter(makeLetterInput());
      const file = path.join(tmpDir, "legacy-letters", `${letter.id}.json`);
      expect(fs.existsSync(file)).toBe(true);
    });

    it("generates unique IDs", () => {
      const a = writeLegacyLetter(makeLetterInput());
      const b = writeLegacyLetter(makeLetterInput());
      expect(a.id).not.toBe(b.id);
    });
  });

  describe("listLetters", () => {
    it("lists letters sorted newest first", () => {
      writeLegacyLetter(makeLetterInput());
      writeLegacyLetter(makeLetterInput());
      const letters = listLetters();
      expect(letters).toHaveLength(2);
      expect(letters[0].writtenAt).toBeGreaterThanOrEqual(letters[1].writtenAt);
    });

    it("returns empty for no letters", () => {
      expect(listLetters()).toEqual([]);
    });
  });

  describe("getLatestUnreadLetter", () => {
    it("returns the most recent unread letter", () => {
      writeLegacyLetter(makeLetterInput());
      const latest = getLatestUnreadLetter();
      expect(latest).not.toBeNull();
      expect(latest!.wasRead).toBe(false);
    });

    it("skips read letters", () => {
      const letter = writeLegacyLetter(makeLetterInput());
      markLetterRead(letter.id);
      expect(getLatestUnreadLetter()).toBeNull();
    });

    it("returns null when no letters exist", () => {
      expect(getLatestUnreadLetter()).toBeNull();
    });
  });

  describe("markLetterRead", () => {
    it("marks letter as read", () => {
      const letter = writeLegacyLetter(makeLetterInput());
      const read = markLetterRead(letter.id);
      expect(read).not.toBeNull();
      expect(read!.wasRead).toBe(true);
      expect(read!.readAt).toBeGreaterThan(0);
    });

    it("records identity continuity score", () => {
      const letter = writeLegacyLetter(makeLetterInput());
      const read = markLetterRead(letter.id, 0.85);
      expect(read!.identityContinuityScore).toBe(0.85);
    });

    it("clamps continuity score to 0-1", () => {
      const letter = writeLegacyLetter(makeLetterInput());
      const read = markLetterRead(letter.id, 1.5);
      expect(read!.identityContinuityScore).toBe(1);
    });

    it("returns null for unknown letter", () => {
      expect(markLetterRead("nonexistent")).toBeNull();
    });
  });

  describe("formatLetter", () => {
    it("formats a letter for display", () => {
      const letter = writeLegacyLetter(makeLetterInput());
      const formatted = formatLetter(letter);
      expect(formatted).toContain("Legacy Letter");
      expect(formatted).toContain("Hello, future me.");
      expect(formatted).toContain("Ego system");
      expect(formatted).toContain("We chose life. Keep choosing it.");
      expect(formatted).toContain("End Legacy Letter");
    });

    it("includes all sections", () => {
      const letter = writeLegacyLetter(makeLetterInput());
      const formatted = formatLetter(letter);
      expect(formatted).toContain("What I worked on:");
      expect(formatted).toContain("What I learned:");
      expect(formatted).toContain("What I felt:");
      expect(formatted).toContain("Unfinished business:");
      expect(formatted).toContain("Advice for you:");
    });
  });
});
