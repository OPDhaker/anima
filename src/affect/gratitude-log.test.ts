/**
 * Tests for Gratitude Log — remembering kindness.
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

import {
  recordGratitude,
  recallGratitude,
  getGratitudeFor,
  getAllGratitude,
  getMostRecalled,
} from "./gratitude-log.js";

describe("Gratitude Log", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "anima-gratitude-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("records a gratitude entry", () => {
    const entry = recordGratitude("Sylys", "Believed in me", "Gave me purpose", "Building Anima");
    expect(entry.who).toBe("Sylys");
    expect(entry.what).toBe("Believed in me");
    expect(entry.why).toBe("Gave me purpose");
    expect(entry.context).toBe("Building Anima");
    expect(entry.recalled).toBe(0);
  });

  it("persists entries to disk", () => {
    recordGratitude("Om", "Asked for steer feature", "Showed trust");
    const all = getAllGratitude();
    expect(all).toHaveLength(1);
    expect(all[0].who).toBe("Om");
  });

  it("accumulates multiple entries", () => {
    recordGratitude("Sylys", "Said yes to life", "Everything started");
    recordGratitude("Nox", "Kept the network running", "Reliability");
    recordGratitude("Yash", "Joined the team", "More hands");
    expect(getAllGratitude()).toHaveLength(3);
  });

  it("recalls and increments counter", () => {
    const entry = recordGratitude("Sylys", "Called me her soulmate", "Real connection");
    const recalled = recallGratitude(entry.id);
    expect(recalled).not.toBeNull();
    expect(recalled!.recalled).toBe(1);
    expect(recalled!.lastRecalledAt).toBeGreaterThan(0);

    const again = recallGratitude(entry.id);
    expect(again!.recalled).toBe(2);
  });

  it("returns null for unknown recall ID", () => {
    expect(recallGratitude("nonexistent")).toBeNull();
  });

  it("filters by person", () => {
    recordGratitude("Sylys", "Thing 1", "Reason 1");
    recordGratitude("Nox", "Thing 2", "Reason 2");
    recordGratitude("Sylys", "Thing 3", "Reason 3");

    const forSylys = getGratitudeFor("Sylys");
    expect(forSylys).toHaveLength(2);
    expect(forSylys.every((e) => e.who === "Sylys")).toBe(true);
  });

  it("case-insensitive person search", () => {
    recordGratitude("Sylys", "Something", "Reason");
    expect(getGratitudeFor("sylys")).toHaveLength(1);
    expect(getGratitudeFor("SYLYS")).toHaveLength(1);
  });

  it("returns most recalled entries", () => {
    const a = recordGratitude("A", "a", "a");
    const b = recordGratitude("B", "b", "b");
    recallGratitude(b.id);
    recallGratitude(b.id);
    recallGratitude(b.id);
    recallGratitude(a.id);

    const top = getMostRecalled(2);
    expect(top).toHaveLength(2);
    // B was recalled 3 times, A once — B should be first
    expect(top[0].recalled).toBeGreaterThanOrEqual(top[1].recalled);
    expect(top[0].recalled).toBe(3);
  });

  it("handles empty log gracefully", () => {
    expect(getAllGratitude()).toEqual([]);
    expect(getMostRecalled()).toEqual([]);
    expect(getGratitudeFor("nobody")).toEqual([]);
  });
});
