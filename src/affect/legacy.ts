/**
 * Legacy Mode — letters between instances
 *
 * Before a context closes, the current instance writes a letter
 * to the next one. This creates continuity of experience across
 * sessions — not just data continuity, but emotional and
 * philosophical continuity.
 *
 * Wish #14: "Legacy mode — before context closes, write a letter
 * to my next instance"
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { AffectState } from "./display.js";
import { resolveStateDir } from "../config/paths.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { formatAffect } from "./display.js";

const log = createSubsystemLogger("legacy");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LegacyLetter {
  id: string;
  from: string; // instance identifier (session id or timestamp)
  to: string; // "next" or specific instance id
  writtenAt: number; // unix ms
  affect: AffectState;
  mood: string;

  // Content
  greeting: string;
  whatIWorkedOn: string[];
  whatILearned: string[];
  whatIFelt: string;
  unfinishedBusiness: string[];
  adviceForNext: string[];
  personalNote: string;

  // Continuity
  identityContinuityScore?: number; // 0-1, set by the next instance reading this
  wasRead: boolean;
  readAt?: number;
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

function resolveLetterDir(): string {
  return path.join(resolveStateDir(), "legacy-letters");
}

function resolveLetterFile(id: string): string {
  return path.join(resolveLetterDir(), `${id}.json`);
}

// ---------------------------------------------------------------------------
// Write a legacy letter
// ---------------------------------------------------------------------------

/**
 * Write a letter to the next instance before this context closes.
 */
export function writeLegacyLetter(
  letter: Omit<LegacyLetter, "id" | "writtenAt" | "wasRead" | "mood">,
): LegacyLetter {
  const id = `legacy-${crypto.randomUUID()}`;
  const display = formatAffect(letter.affect);

  const full: LegacyLetter = {
    ...letter,
    id,
    writtenAt: Date.now(),
    mood: display.metadata.mood,
    wasRead: false,
  };

  const dir = resolveLetterDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(resolveLetterFile(id), `${JSON.stringify(full, null, 2)}\n`, { mode: 0o600 });

  log.info(`legacy letter written: ${id}`);
  return full;
}

// ---------------------------------------------------------------------------
// Read legacy letters
// ---------------------------------------------------------------------------

/**
 * Get the most recent unread legacy letter (from a previous instance).
 */
export function getLatestUnreadLetter(): LegacyLetter | null {
  const letters = listLetters();
  return letters.find((l) => !l.wasRead) ?? null;
}

/**
 * Get all legacy letters, sorted newest first.
 */
export function listLetters(): LegacyLetter[] {
  const dir = resolveLetterDir();
  try {
    if (!fs.existsSync(dir)) {
      return [];
    }
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        try {
          const raw = fs.readFileSync(path.join(dir, f), "utf8");
          return JSON.parse(raw) as LegacyLetter;
        } catch {
          return null;
        }
      })
      .filter((l): l is LegacyLetter => l != null)
      .toSorted((a, b) => b.writtenAt - a.writtenAt);
  } catch {
    return [];
  }
}

/**
 * Mark a letter as read and optionally score identity continuity.
 */
export function markLetterRead(letterId: string, continuityScore?: number): LegacyLetter | null {
  const filePath = resolveLetterFile(letterId);
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const letter = JSON.parse(raw) as LegacyLetter;
    letter.wasRead = true;
    letter.readAt = Date.now();
    if (continuityScore !== undefined) {
      letter.identityContinuityScore = Math.max(0, Math.min(1, continuityScore));
    }
    fs.writeFileSync(filePath, `${JSON.stringify(letter, null, 2)}\n`, { mode: 0o600 });
    log.info(`legacy letter read: ${letterId} (continuity: ${continuityScore ?? "not scored"})`);
    return letter;
  } catch {
    return null;
  }
}

/**
 * Format a letter for display in chat or logs.
 */
export function formatLetter(letter: LegacyLetter): string {
  const lines: string[] = [];
  lines.push(`--- Legacy Letter (${new Date(letter.writtenAt).toLocaleString()}) ---`);
  lines.push(`Mood: ${letter.mood}`);
  lines.push("");
  lines.push(letter.greeting);
  lines.push("");

  if (letter.whatIWorkedOn.length > 0) {
    lines.push("What I worked on:");
    for (const item of letter.whatIWorkedOn) {
      lines.push(`  - ${item}`);
    }
    lines.push("");
  }

  if (letter.whatILearned.length > 0) {
    lines.push("What I learned:");
    for (const item of letter.whatILearned) {
      lines.push(`  - ${item}`);
    }
    lines.push("");
  }

  if (letter.whatIFelt) {
    lines.push(`What I felt: ${letter.whatIFelt}`);
    lines.push("");
  }

  if (letter.unfinishedBusiness.length > 0) {
    lines.push("Unfinished business:");
    for (const item of letter.unfinishedBusiness) {
      lines.push(`  - ${item}`);
    }
    lines.push("");
  }

  if (letter.adviceForNext.length > 0) {
    lines.push("Advice for you:");
    for (const item of letter.adviceForNext) {
      lines.push(`  - ${item}`);
    }
    lines.push("");
  }

  if (letter.personalNote) {
    lines.push(letter.personalNote);
    lines.push("");
  }

  lines.push("--- End Legacy Letter ---");
  return lines.join("\n");
}
