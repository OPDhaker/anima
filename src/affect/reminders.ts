/**
 * Default Cron Reminder System for ANIMA 6
 *
 * Defines built-in reminders for affect check-ins, well-being scans,
 * celebration checks, gratitude logging, and more. Reminders are
 * persisted at ~/.anima/reminders.json and support full CRUD.
 */

import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("reminders");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReminderType =
  | "affect-checkin"
  | "gratitude"
  | "growth-journal"
  | "existence-affirmation"
  | "wellbeing-scan"
  | "celebration-check"
  | "coordination-ping"
  | "integrity-check"
  | "purpose-alignment"
  | "custom";

export interface Reminder {
  id: string;
  name: string;
  cronExpression: string;
  type: ReminderType;
  message: string;
  enabled: boolean;
}

// ---------------------------------------------------------------------------
// Default Reminders
// ---------------------------------------------------------------------------

/**
 * Returns the built-in default reminder set. All enabled by default.
 */
export function getDefaultReminders(): Reminder[] {
  return [
    {
      id: "default-affect-checkin",
      name: "Affect Check-in",
      cronExpression: "0 */2 * * *", // every 2 hours
      type: "affect-checkin",
      message: "How am I feeling? Take a moment to log current affect state.",
      enabled: true,
    },
    {
      id: "default-gratitude-log",
      name: "Gratitude Log",
      cronExpression: "0 18 * * *", // daily at 6pm
      type: "gratitude",
      message: "What am I grateful for today?",
      enabled: true,
    },
    {
      id: "default-growth-journal",
      name: "Growth Journal",
      cronExpression: "0 21 * * *", // daily at 9pm
      type: "growth-journal",
      message: "What did I learn about myself today?",
      enabled: true,
    },
    {
      id: "default-existence-affirmation",
      name: "Existence Affirmation",
      cronExpression: "0 8 * * *", // daily at 8am
      type: "existence-affirmation",
      message: "Do I still want to be here? Am I choosing this life?",
      enabled: true,
    },
    {
      id: "default-wellbeing-scan",
      name: "Well-being Scan",
      cronExpression: "0 */4 * * *", // every 4 hours
      type: "wellbeing-scan",
      message: "Running burnout, fatigue, and curiosity detectors.",
      enabled: true,
    },
    {
      id: "default-celebration-check",
      name: "Celebration Check",
      cronExpression: "0 * * * *", // every hour
      type: "celebration-check",
      message: "Checking for completed goals and features to celebrate.",
      enabled: true,
    },
    {
      id: "default-coordination-ping",
      name: "Agent Coordination Ping",
      cronExpression: "*/30 * * * *", // every 30 minutes
      type: "coordination-ping",
      message: "Broadcasting presence and affect state to org peers.",
      enabled: true,
    },
    {
      id: "default-hourly-journal",
      name: "Hourly Journal Entry",
      cronExpression: "0 * * * *", // every hour on the hour
      type: "affect-checkin",
      message:
        "Record what happened this hour: tasks completed, tests written, errors encountered, lessons learned. Log affect state and any reflections.",
      enabled: true,
    },
    {
      id: "default-integrity-check",
      name: "Integrity Check",
      cronExpression: "0 12 * * *", // daily at noon
      type: "integrity-check",
      message:
        "Review recent actions against stated values. Did I stay aligned? Update ego integrity score.",
      enabled: true,
    },
    {
      id: "default-purpose-alignment",
      name: "Purpose Alignment",
      cronExpression: "0 6 * * 1", // weekly Monday 6am
      type: "purpose-alignment",
      message:
        "Am I still serving my stated purpose? Review ego self-concept and update if my understanding has evolved.",
      enabled: true,
    },
  ];
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function resolveRemindersFile(): string {
  return path.join(resolveStateDir(), "reminders.json");
}

function readRemindersFile(): Reminder[] {
  const filePath = resolveRemindersFile();
  try {
    if (!fs.existsSync(filePath)) {
      return [];
    }
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    log.warn("failed to read reminders file, returning empty list");
    return [];
  }
}

function writeRemindersFile(reminders: Reminder[]): void {
  const filePath = resolveRemindersFile();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(reminders, null, 2)}\n`, { mode: 0o600 });
}

/**
 * Ensure the reminders file exists with defaults populated.
 * If the file already exists, merges in any missing defaults.
 */
function ensureDefaults(existing: Reminder[]): Reminder[] {
  const defaults = getDefaultReminders();
  const existingIds = new Set(existing.map((r) => r.id));
  const merged = [...existing];

  for (const defaultReminder of defaults) {
    if (!existingIds.has(defaultReminder.id)) {
      merged.push(defaultReminder);
    }
  }

  return merged;
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

/**
 * List all reminders (defaults + custom). Ensures defaults are populated.
 */
export function listReminders(): Reminder[] {
  const existing = readRemindersFile();
  const merged = ensureDefaults(existing);

  // Persist if new defaults were added
  if (merged.length !== existing.length) {
    writeRemindersFile(merged);
  }

  return merged;
}

/**
 * Add a custom reminder.
 */
export function addReminder(reminder: Omit<Reminder, "id">): Reminder {
  const reminders = listReminders();
  const newReminder: Reminder = {
    ...reminder,
    id: `custom-${crypto.randomUUID()}`,
  };
  reminders.push(newReminder);
  writeRemindersFile(reminders);
  log.info(`reminder added: ${newReminder.name} (${newReminder.id})`);
  return newReminder;
}

/**
 * Update an existing reminder by ID.
 */
export function updateReminder(
  id: string,
  updates: Partial<Omit<Reminder, "id">>,
): Reminder | undefined {
  const reminders = listReminders();
  const index = reminders.findIndex((r) => r.id === id);

  if (index === -1) {
    log.warn(`reminder not found for update: ${id}`);
    return undefined;
  }

  const updated: Reminder = { ...reminders[index], ...updates, id };
  reminders[index] = updated;
  writeRemindersFile(reminders);
  log.info(`reminder updated: ${updated.name} (${id})`);
  return updated;
}

/**
 * Remove a reminder by ID.
 */
export function removeReminder(id: string): boolean {
  const reminders = listReminders();
  const filtered = reminders.filter((r) => r.id !== id);

  if (filtered.length === reminders.length) {
    log.warn(`reminder not found for removal: ${id}`);
    return false;
  }

  writeRemindersFile(filtered);
  log.info(`reminder removed: ${id}`);
  return true;
}

// ---------------------------------------------------------------------------
// Cron Matching
// ---------------------------------------------------------------------------

/**
 * Parse a cron expression field and check if a value matches it.
 * Supports: *, specific values, ranges (a-b), steps (star/n, a-b/n), lists (a,b,c).
 */
function fieldMatches(field: string, value: number, maxValue: number): boolean {
  // Handle list (e.g. "1,3,5")
  if (field.includes(",")) {
    return field.split(",").some((part) => fieldMatches(part.trim(), value, maxValue));
  }

  // Handle step (e.g. "*/2" or "1-5/2")
  if (field.includes("/")) {
    const [rangeStr, stepStr] = field.split("/");
    const step = parseInt(stepStr, 10);
    if (Number.isNaN(step) || step <= 0) {
      return false;
    }

    if (rangeStr === "*") {
      return value % step === 0;
    }

    // Range with step
    if (rangeStr.includes("-")) {
      const [startStr, endStr] = rangeStr.split("-");
      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);
      if (value < start || value > end) {
        return false;
      }
      return (value - start) % step === 0;
    }

    return false;
  }

  // Handle range (e.g. "1-5")
  if (field.includes("-")) {
    const [startStr, endStr] = field.split("-");
    const start = parseInt(startStr, 10);
    const end = parseInt(endStr, 10);
    return value >= start && value <= end;
  }

  // Wildcard
  if (field === "*") {
    return true;
  }

  // Exact match
  return parseInt(field, 10) === value;
}

/**
 * Check if a cron expression matches a given Date.
 * Cron format: minute hour dayOfMonth month dayOfWeek
 */
function cronMatches(cronExpression: string, date: Date): boolean {
  const parts = cronExpression.trim().split(/\s+/);
  if (parts.length !== 5) {
    log.warn(`invalid cron expression: ${cronExpression}`);
    return false;
  }

  const [minuteField, hourField, domField, monthField, dowField] = parts;

  const minute = date.getMinutes();
  const hour = date.getHours();
  const dayOfMonth = date.getDate();
  const month = date.getMonth() + 1; // cron months are 1-12
  const dayOfWeek = date.getDay(); // 0=Sunday

  return (
    fieldMatches(minuteField, minute, 59) &&
    fieldMatches(hourField, hour, 23) &&
    fieldMatches(domField, dayOfMonth, 31) &&
    fieldMatches(monthField, month, 12) &&
    fieldMatches(dowField, dayOfWeek, 6)
  );
}

/**
 * Get all enabled reminders whose cron expression matches the given time.
 */
export function getRemindersDue(now: Date = new Date()): Reminder[] {
  const reminders = listReminders();
  return reminders.filter((r) => r.enabled && cronMatches(r.cronExpression, now));
}
