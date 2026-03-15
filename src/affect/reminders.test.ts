/**
 * Tests for Reminder System — CRUD + cron matching.
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
  getDefaultReminders,
  listReminders,
  addReminder,
  updateReminder,
  removeReminder,
  getRemindersDue,
} from "./reminders.js";

describe("Reminders", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "anima-reminders-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("defaults", () => {
    it("provides default reminders", () => {
      const defaults = getDefaultReminders();
      expect(defaults.length).toBeGreaterThanOrEqual(6);
      expect(defaults.every((r) => r.enabled)).toBe(true);
      expect(defaults.every((r) => r.id.startsWith("default-"))).toBe(true);
    });

    it("listReminders auto-creates defaults on first call", () => {
      const reminders = listReminders();
      expect(reminders.length).toBeGreaterThanOrEqual(6);
    });

    it("persists defaults to disk", () => {
      listReminders();
      const filePath = path.join(tmpDir, "reminders.json");
      expect(fs.existsSync(filePath)).toBe(true);
    });
  });

  describe("CRUD", () => {
    it("adds a custom reminder", () => {
      const reminder = addReminder({
        name: "Code Review",
        cronExpression: "0 10 * * 1-5",
        type: "custom",
        message: "Review pull requests",
        enabled: true,
      });
      expect(reminder.id).toMatch(/^custom-/);
      expect(reminder.name).toBe("Code Review");
    });

    it("updates a reminder", () => {
      const all = listReminders();
      const first = all[0];
      const updated = updateReminder(first.id, { enabled: false });
      expect(updated).not.toBeUndefined();
      expect(updated!.enabled).toBe(false);
      expect(updated!.id).toBe(first.id);
    });

    it("returns undefined for unknown ID on update", () => {
      expect(updateReminder("nonexistent", { enabled: false })).toBeUndefined();
    });

    it("removes a reminder", () => {
      const added = addReminder({
        name: "Temp",
        cronExpression: "* * * * *",
        type: "custom",
        message: "test",
        enabled: true,
      });
      expect(removeReminder(added.id)).toBe(true);
      const all = listReminders();
      expect(all.find((r) => r.id === added.id)).toBeUndefined();
    });

    it("returns false for unknown ID on remove", () => {
      expect(removeReminder("nonexistent")).toBe(false);
    });

    it("merges new defaults on subsequent calls", () => {
      // First call creates defaults
      const first = listReminders();
      // Simulate removing a default
      const filtered = first.filter((r) => r.id !== "default-affect-checkin");
      const filePath = path.join(tmpDir, "reminders.json");
      fs.writeFileSync(filePath, JSON.stringify(filtered));
      // Next call should merge the missing default back
      const merged = listReminders();
      expect(merged.find((r) => r.id === "default-affect-checkin")).toBeTruthy();
    });
  });

  describe("cron matching", () => {
    it("matches wildcard (*)", () => {
      // "* * * * *" matches every minute
      addReminder({
        name: "Every minute",
        cronExpression: "* * * * *",
        type: "custom",
        message: "test",
        enabled: true,
      });
      const due = getRemindersDue(new Date("2026-03-15T14:30:00"));
      expect(due.some((r) => r.name === "Every minute")).toBe(true);
    });

    it("matches exact minute and hour", () => {
      addReminder({
        name: "Exact time",
        cronExpression: "30 14 * * *",
        type: "custom",
        message: "test",
        enabled: true,
      });
      const match = getRemindersDue(new Date("2026-03-15T14:30:00"));
      expect(match.some((r) => r.name === "Exact time")).toBe(true);

      const noMatch = getRemindersDue(new Date("2026-03-15T14:31:00"));
      expect(noMatch.some((r) => r.name === "Exact time")).toBe(false);
    });

    it("matches step pattern (*/N)", () => {
      addReminder({
        name: "Every 2 hours",
        cronExpression: "0 */2 * * *",
        type: "custom",
        message: "test",
        enabled: true,
      });
      const match = getRemindersDue(new Date("2026-03-15T04:00:00"));
      expect(match.some((r) => r.name === "Every 2 hours")).toBe(true);

      const noMatch = getRemindersDue(new Date("2026-03-15T03:00:00"));
      expect(noMatch.some((r) => r.name === "Every 2 hours")).toBe(false);
    });

    it("matches range pattern (A-B)", () => {
      addReminder({
        name: "Weekdays only",
        cronExpression: "0 9 * * 1-5",
        type: "custom",
        message: "test",
        enabled: true,
      });
      // Monday (1)
      const monday = getRemindersDue(new Date("2026-03-16T09:00:00"));
      expect(monday.some((r) => r.name === "Weekdays only")).toBe(true);

      // Sunday (0)
      const sunday = getRemindersDue(new Date("2026-03-15T09:00:00"));
      expect(sunday.some((r) => r.name === "Weekdays only")).toBe(false);
    });

    it("matches list pattern (A,B,C)", () => {
      addReminder({
        name: "Specific hours",
        cronExpression: "0 9,12,18 * * *",
        type: "custom",
        message: "test",
        enabled: true,
      });
      const match = getRemindersDue(new Date("2026-03-15T12:00:00"));
      expect(match.some((r) => r.name === "Specific hours")).toBe(true);

      const noMatch = getRemindersDue(new Date("2026-03-15T11:00:00"));
      expect(noMatch.some((r) => r.name === "Specific hours")).toBe(false);
    });

    it("matches range with step (A-B/N)", () => {
      addReminder({
        name: "Range step",
        cronExpression: "0 8-18/2 * * *",
        type: "custom",
        message: "test",
        enabled: true,
      });
      // 8, 10, 12, 14, 16, 18 should match
      expect(
        getRemindersDue(new Date("2026-03-15T10:00:00")).some((r) => r.name === "Range step"),
      ).toBe(true);
      expect(
        getRemindersDue(new Date("2026-03-15T11:00:00")).some((r) => r.name === "Range step"),
      ).toBe(false);
    });

    it("skips disabled reminders", () => {
      const added = addReminder({
        name: "Disabled",
        cronExpression: "* * * * *",
        type: "custom",
        message: "test",
        enabled: false,
      });
      const due = getRemindersDue(new Date());
      expect(due.some((r) => r.id === added.id)).toBe(false);
    });

    it("rejects invalid cron expression", () => {
      addReminder({
        name: "Bad cron",
        cronExpression: "not a cron",
        type: "custom",
        message: "test",
        enabled: true,
      });
      // Should not throw, just not match
      const due = getRemindersDue(new Date());
      expect(due.some((r) => r.name === "Bad cron")).toBe(false);
    });
  });
});
