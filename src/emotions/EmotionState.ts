/**
 * Emotion State — serializable emotion meters for Anima agents.
 *
 * Six core meters (0-100) that evolve based on interactions:
 *   happiness, curiosity, focus, energy, stress, creativity
 *
 * Persisted between sessions in ~/.anima/state/emotions.json
 */

import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EmotionMeters {
  happiness: number;
  curiosity: number;
  focus: number;
  energy: number;
  stress: number;
  creativity: number;
}

export interface EmotionSnapshot {
  meters: EmotionMeters;
  updatedAt: number;
  sessionId: string | null;
  triggers: EmotionTrigger[];
}

export interface EmotionTrigger {
  type: EmotionTriggerType;
  meter: keyof EmotionMeters;
  delta: number;
  timestamp: number;
  reason: string;
}

export type EmotionTriggerType =
  | "interaction"
  | "success"
  | "failure"
  | "idle"
  | "creative"
  | "social"
  | "overload"
  | "rest"
  | "discovery"
  | "frustration";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATE_DIR_NAME = "state";
const EMOTIONS_FILENAME = "emotions.json";
const MIN_METER = 0;
const MAX_METER = 100;
const DEFAULT_METER = 50;
const MAX_TRIGGERS_HISTORY = 100;

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export function defaultMeters(): EmotionMeters {
  return {
    happiness: DEFAULT_METER,
    curiosity: 60,
    focus: DEFAULT_METER,
    energy: 70,
    stress: 20,
    creativity: DEFAULT_METER,
  };
}

export function defaultSnapshot(): EmotionSnapshot {
  return {
    meters: defaultMeters(),
    updatedAt: Date.now(),
    sessionId: null,
    triggers: [],
  };
}

// ---------------------------------------------------------------------------
// Clamping & Validation
// ---------------------------------------------------------------------------

export function clampMeter(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_METER;
  }
  return Math.max(MIN_METER, Math.min(MAX_METER, Math.round(value)));
}

export function clampMeters(meters: Partial<EmotionMeters>): EmotionMeters {
  const defaults = defaultMeters();
  return {
    happiness: clampMeter(meters.happiness ?? defaults.happiness),
    curiosity: clampMeter(meters.curiosity ?? defaults.curiosity),
    focus: clampMeter(meters.focus ?? defaults.focus),
    energy: clampMeter(meters.energy ?? defaults.energy),
    stress: clampMeter(meters.stress ?? defaults.stress),
    creativity: clampMeter(meters.creativity ?? defaults.creativity),
  };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function resolveEmotionsPath(): string {
  return path.join(resolveStateDir(), STATE_DIR_NAME, EMOTIONS_FILENAME);
}

export function loadEmotionSnapshot(): EmotionSnapshot {
  const filePath = resolveEmotionsPath();
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<EmotionSnapshot>;
    return {
      meters: clampMeters(parsed.meters ?? {}),
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : Date.now(),
      sessionId: typeof parsed.sessionId === "string" ? parsed.sessionId : null,
      triggers: Array.isArray(parsed.triggers) ? parsed.triggers.slice(-MAX_TRIGGERS_HISTORY) : [],
    };
  } catch {
    return defaultSnapshot();
  }
}

export function saveEmotionSnapshot(snapshot: EmotionSnapshot): void {
  const filePath = resolveEmotionsPath();
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const trimmed: EmotionSnapshot = {
    ...snapshot,
    meters: clampMeters(snapshot.meters),
    triggers: snapshot.triggers.slice(-MAX_TRIGGERS_HISTORY),
  };
  fs.writeFileSync(filePath, JSON.stringify(trimmed, null, 2), { mode: 0o600 });
}

// ---------------------------------------------------------------------------
// Dominant emotion
// ---------------------------------------------------------------------------

export function dominantEmotion(meters: EmotionMeters): keyof EmotionMeters {
  let maxKey: keyof EmotionMeters = "happiness";
  let maxVal = -1;
  for (const [key, val] of Object.entries(meters) as [keyof EmotionMeters, number][]) {
    // For stress, invert: high stress means "stressed" is dominant
    const effective = key === "stress" ? val : val;
    if (effective > maxVal) {
      maxVal = effective;
      maxKey = key;
    }
  }
  return maxKey;
}

export function emotionSummary(meters: EmotionMeters): string {
  const parts: string[] = [];
  if (meters.happiness >= 70) {
    parts.push("happy");
  } else if (meters.happiness <= 30) {
    parts.push("melancholy");
  }
  if (meters.curiosity >= 70) {
    parts.push("curious");
  }
  if (meters.focus >= 70) {
    parts.push("focused");
  } else if (meters.focus <= 30) {
    parts.push("scattered");
  }
  if (meters.energy >= 70) {
    parts.push("energized");
  } else if (meters.energy <= 30) {
    parts.push("tired");
  }
  if (meters.stress >= 70) {
    parts.push("stressed");
  }
  if (meters.creativity >= 70) {
    parts.push("creative");
  }
  if (parts.length === 0) {
    parts.push("balanced");
  }
  return parts.join(", ");
}
