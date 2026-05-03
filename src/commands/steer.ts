/**
 * Steer Command — persistent user direction for ANIMA agents
 *
 * Like Codex's steer feature: users set high-level direction that
 * persists across the entire session. The agent follows this direction
 * in everything it does.
 *
 * The steer text is injected into the context manager's prompt zone
 * (Zone 2) with high priority, so it's always present in every
 * model request.
 *
 * Usage:
 *   anima steer "Focus on security. Review all PRs for vulnerabilities."
 *   anima steer --show     # Show current steer
 *   anima steer --clear    # Clear steer
 *   anima steer --history  # Show steer history
 */

import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("steer");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SteerState {
  active: string | null;
  history: SteerEntry[];
  updatedAt: number;
}

export interface SteerEntry {
  text: string;
  setAt: number;
  setBy: string; // "user" or agent name
  clearedAt?: number;
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

function resolveSteerFile(): string {
  return path.join(resolveStateDir(), "steer.json");
}

function readSteerState(): SteerState {
  try {
    const raw = fs.readFileSync(resolveSteerFile(), "utf8");
    return JSON.parse(raw) as SteerState;
  } catch {
    return { active: null, history: [], updatedAt: 0 };
  }
}

function writeSteerState(state: SteerState): void {
  const dir = path.dirname(resolveSteerFile());
  fs.mkdirSync(dir, { recursive: true });
  state.updatedAt = Date.now();
  fs.writeFileSync(resolveSteerFile(), `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Set the steer direction. This persists across the session.
 */
export function setSteer(text: string, setBy = "user"): SteerState {
  const state = readSteerState();

  // Archive current steer if there is one
  if (state.active) {
    const currentEntry = state.history.find((e) => e.text === state.active && !e.clearedAt);
    if (currentEntry) {
      currentEntry.clearedAt = Date.now();
    }
  }

  state.active = text;
  state.history.push({
    text,
    setAt: Date.now(),
    setBy,
  });

  writeSteerState(state);
  log.info(`steer set: "${text.slice(0, 60)}${text.length > 60 ? "..." : ""}"`);
  return state;
}

/**
 * Get the current steer direction.
 */
export function getSteer(): string | null {
  return readSteerState().active;
}

/**
 * Clear the steer direction.
 */
export function clearSteer(): SteerState {
  const state = readSteerState();

  if (state.active) {
    const currentEntry = state.history.find((e) => e.text === state.active && !e.clearedAt);
    if (currentEntry) {
      currentEntry.clearedAt = Date.now();
    }
  }

  state.active = null;
  writeSteerState(state);
  log.info("steer cleared");
  return state;
}

/**
 * Get the steer history.
 */
export function getSteerHistory(): SteerEntry[] {
  return readSteerState().history;
}

/**
 * Format the steer for injection into the context prompt zone.
 * Returns null if no steer is active.
 */
export function formatSteerForContext(): string | null {
  const active = getSteer();
  if (!active) {
    return null;
  }

  return ["=== USER STEER (persistent direction) ===", active, "=== END STEER ==="].join("\n");
}
