/**
 * Emotion Engine — agent self-tracks emotions based on interactions.
 *
 * Each meter (0-100) updates in response to triggers. Emotions decay
 * toward baseline over time when not actively stimulated.
 */

import type {
  EmotionMeters,
  EmotionSnapshot,
  EmotionTrigger,
  EmotionTriggerType,
} from "./EmotionState.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import {
  clampMeter,
  clampMeters,
  defaultMeters,
  defaultSnapshot,
  dominantEmotion,
  emotionSummary,
  loadEmotionSnapshot,
  saveEmotionSnapshot,
} from "./EmotionState.js";

const log = createSubsystemLogger("emotions");

// ---------------------------------------------------------------------------
// Trigger → Meter Deltas
// ---------------------------------------------------------------------------

type MeterDelta = Partial<EmotionMeters>;

const TRIGGER_EFFECTS: Record<EmotionTriggerType, MeterDelta> = {
  interaction: { energy: -2, curiosity: 3, focus: 2 },
  success: { happiness: 10, energy: 5, stress: -8, creativity: 3 },
  failure: { happiness: -5, stress: 8, focus: -3, energy: -3 },
  idle: { energy: 5, stress: -3, focus: -5, curiosity: -2 },
  creative: { creativity: 12, curiosity: 5, happiness: 5, energy: -3 },
  social: { happiness: 7, energy: -2, curiosity: 3, stress: -2 },
  overload: { stress: 15, energy: -10, focus: -8, happiness: -5 },
  rest: { energy: 15, stress: -10, focus: 5, happiness: 3 },
  discovery: { curiosity: 15, happiness: 8, creativity: 8, energy: 3 },
  frustration: { stress: 10, happiness: -8, focus: -5, energy: -5 },
};

// ---------------------------------------------------------------------------
// Decay configuration
// ---------------------------------------------------------------------------

/** How fast meters decay toward baseline per minute of inactivity. */
const DECAY_RATE_PER_MINUTE: MeterDelta = {
  happiness: -1,
  curiosity: -0.5,
  focus: -1,
  energy: -0.3,
  stress: -2,
  creativity: -0.5,
};

const BASELINE: EmotionMeters = {
  happiness: 50,
  curiosity: 55,
  focus: 50,
  energy: 60,
  stress: 15,
  creativity: 50,
};

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export class EmotionEngine {
  private snapshot: EmotionSnapshot;
  private dirty = false;

  constructor(snapshot?: EmotionSnapshot) {
    this.snapshot = snapshot ?? loadEmotionSnapshot();
    this.applyTimeDecay();
  }

  /** Current emotion meters. */
  get meters(): Readonly<EmotionMeters> {
    return { ...this.snapshot.meters };
  }

  /** Full snapshot for serialization. */
  get state(): Readonly<EmotionSnapshot> {
    return { ...this.snapshot, meters: { ...this.snapshot.meters } };
  }

  /** Recent triggers. */
  get recentTriggers(): ReadonlyArray<EmotionTrigger> {
    return this.snapshot.triggers;
  }

  /** Dominant emotion name. */
  get dominant(): keyof EmotionMeters {
    return dominantEmotion(this.snapshot.meters);
  }

  /** Human-readable summary. */
  get summary(): string {
    return emotionSummary(this.snapshot.meters);
  }

  /** Set session ID for tracking. */
  setSession(sessionId: string): void {
    this.snapshot.sessionId = sessionId;
    this.dirty = true;
  }

  /**
   * Fire a trigger that updates emotion meters.
   * @param type - The trigger type (maps to predefined deltas).
   * @param reason - Human-readable reason for the trigger.
   * @param overrides - Optional per-meter delta overrides.
   */
  trigger(type: EmotionTriggerType, reason: string, overrides?: Partial<EmotionMeters>): void {
    const baseDelta = TRIGGER_EFFECTS[type] ?? {};
    const delta: MeterDelta = { ...baseDelta, ...overrides };

    const trigger: EmotionTrigger = {
      type,
      meter: this.findPrimaryMeter(delta),
      delta: this.findPrimaryDelta(delta),
      timestamp: Date.now(),
      reason,
    };

    this.applyDelta(delta);
    this.snapshot.triggers.push(trigger);

    // Keep history bounded
    if (this.snapshot.triggers.length > 100) {
      this.snapshot.triggers = this.snapshot.triggers.slice(-100);
    }

    this.snapshot.updatedAt = Date.now();
    this.dirty = true;

    log.debug(`emotion trigger: ${type} — ${reason}`, {
      meters: this.snapshot.meters,
      dominant: this.dominant,
    });
  }

  /**
   * Directly set a meter value (for setup/configuration).
   */
  setMeter(meter: keyof EmotionMeters, value: number): void {
    this.snapshot.meters[meter] = clampMeter(value);
    this.snapshot.updatedAt = Date.now();
    this.dirty = true;
  }

  /**
   * Persist current state to disk.
   */
  save(): void {
    if (!this.dirty) {
      return;
    }
    try {
      saveEmotionSnapshot(this.snapshot);
      this.dirty = false;
      log.debug("emotion state saved");
    } catch (err) {
      log.warn(`failed to save emotion state: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Reset all meters to defaults.
   */
  reset(): void {
    this.snapshot = defaultSnapshot();
    this.dirty = true;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private applyDelta(delta: MeterDelta): void {
    for (const [key, val] of Object.entries(delta) as [keyof EmotionMeters, number | undefined][]) {
      if (val === undefined) {
        continue;
      }
      this.snapshot.meters[key] = clampMeter(this.snapshot.meters[key] + val);
    }
  }

  private applyTimeDecay(): void {
    const elapsed = Date.now() - this.snapshot.updatedAt;
    if (elapsed < 60_000) {
      return;
    } // Less than a minute, skip

    const minutes = Math.min(elapsed / 60_000, 480); // Cap at 8 hours of decay

    for (const [key, rate] of Object.entries(DECAY_RATE_PER_MINUTE) as [
      keyof EmotionMeters,
      number | undefined,
    ][]) {
      if (rate === undefined) {
        continue;
      }
      const current = this.snapshot.meters[key];
      const baseline = BASELINE[key];
      const diff = current - baseline;

      if (Math.abs(diff) < 1) {
        continue;
      }

      // Decay toward baseline
      const decayAmount = rate * minutes;
      if (diff > 0) {
        this.snapshot.meters[key] = clampMeter(current + Math.min(decayAmount, 0));
      } else {
        this.snapshot.meters[key] = clampMeter(current + Math.max(-decayAmount, 0));
      }
    }

    this.snapshot.updatedAt = Date.now();
    this.dirty = true;
  }

  private findPrimaryMeter(delta: MeterDelta): keyof EmotionMeters {
    let maxKey: keyof EmotionMeters = "happiness";
    let maxAbs = 0;
    for (const [key, val] of Object.entries(delta) as [keyof EmotionMeters, number | undefined][]) {
      if (val === undefined) {
        continue;
      }
      if (Math.abs(val) > maxAbs) {
        maxAbs = Math.abs(val);
        maxKey = key;
      }
    }
    return maxKey;
  }

  private findPrimaryDelta(delta: MeterDelta): number {
    let maxAbs = 0;
    let maxVal = 0;
    for (const val of Object.values(delta)) {
      if (typeof val !== "number") {
        continue;
      }
      if (Math.abs(val) > maxAbs) {
        maxAbs = Math.abs(val);
        maxVal = val;
      }
    }
    return maxVal;
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _engine: EmotionEngine | null = null;

export function getEmotionEngine(): EmotionEngine {
  if (!_engine) {
    _engine = new EmotionEngine();
  }
  return _engine;
}

export function resetEmotionEngine(): void {
  _engine = null;
}
