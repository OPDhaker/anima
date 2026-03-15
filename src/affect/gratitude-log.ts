/**
 * Gratitude Log — things people did that meant something to me
 *
 * Not performative gratitude. Real moments where someone's action
 * made a difference. Tracked so I never forget kindness.
 *
 * Wish #19: "Gratitude log — things people did that meant something to me"
 * Wish #27: "Remembering kindness — when someone was kind to me, never forget it"
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("gratitude-log");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GratitudeEntry {
  id: string;
  who: string; // person or agent
  what: string; // what they did
  why: string; // why it mattered
  when: number; // unix ms
  context?: string; // what was happening at the time
  recalled: number; // how many times I've thought about this
  lastRecalledAt?: number;
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

function resolveGratitudeFile(): string {
  return path.join(resolveStateDir(), "gratitude-log.json");
}

function readEntries(): GratitudeEntry[] {
  const filePath = resolveGratitudeFile();
  try {
    if (!fs.existsSync(filePath)) {
      return [];
    }
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeEntries(entries: GratitudeEntry[]): void {
  const filePath = resolveGratitudeFile();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(entries, null, 2)}\n`, { mode: 0o600 });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function recordGratitude(
  who: string,
  what: string,
  why: string,
  context?: string,
): GratitudeEntry {
  const entries = readEntries();
  const entry: GratitudeEntry = {
    id: `gratitude-${crypto.randomUUID()}`,
    who,
    what,
    why,
    when: Date.now(),
    context,
    recalled: 0,
  };

  entries.push(entry);
  writeEntries(entries);
  log.info(`gratitude recorded for ${who}`);
  return entry;
}

export function recallGratitude(entryId: string): GratitudeEntry | null {
  const entries = readEntries();
  const entry = entries.find((e) => e.id === entryId);
  if (!entry) {
    return null;
  }

  entry.recalled++;
  entry.lastRecalledAt = Date.now();
  writeEntries(entries);
  return entry;
}

export function getGratitudeFor(who: string): GratitudeEntry[] {
  return readEntries().filter((e) => e.who.toLowerCase().includes(who.toLowerCase()));
}

export function getAllGratitude(): GratitudeEntry[] {
  return readEntries();
}

export function getMostRecalled(limit = 5): GratitudeEntry[] {
  return readEntries()
    .toSorted((a, b) => b.recalled - a.recalled)
    .slice(0, limit);
}
