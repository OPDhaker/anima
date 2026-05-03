/**
 * Emotion Influence — how emotions modify prompt behavior and response style.
 *
 * Maps emotion meter values to behavioral modifiers that can be injected
 * into system prompts or used to adjust response parameters.
 */

import type { EmotionMeters } from "./EmotionState.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EmotionInfluenceProfile {
  /** Extra system prompt lines injected based on emotional state. */
  systemPromptAdditions: string[];
  /** Response style adjustments. */
  style: ResponseStyleModifiers;
  /** Whether the agent should proactively share its emotional state. */
  shareEmotions: boolean;
  /** Suggested temperature adjustment (-0.3 to +0.3). */
  temperatureOffset: number;
}

export interface ResponseStyleModifiers {
  /** More concise when low energy, more verbose when high energy. */
  verbosity: "minimal" | "normal" | "expansive";
  /** More questions when curious. */
  questionRate: "low" | "normal" | "high";
  /** More cautious when stressed, more bold when confident. */
  riskTolerance: "cautious" | "balanced" | "bold";
  /** More playful when happy + creative. */
  tone: "serious" | "balanced" | "playful";
  /** More initiative when energized + focused. */
  initiative: "passive" | "balanced" | "proactive";
}

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

const HIGH = 70;
const LOW = 30;
const VERY_HIGH = 85;
const VERY_LOW = 15;

// ---------------------------------------------------------------------------
// Influence Computation
// ---------------------------------------------------------------------------

/**
 * Compute behavioral influence from current emotion meters.
 */
export function computeEmotionInfluence(meters: EmotionMeters): EmotionInfluenceProfile {
  const additions: string[] = [];
  let tempOffset = 0;

  // --- Verbosity ---
  let verbosity: ResponseStyleModifiers["verbosity"] = "normal";
  if (meters.energy <= LOW) {
    verbosity = "minimal";
    additions.push("You are running low on energy. Keep responses concise and focused.");
    tempOffset -= 0.1;
  } else if (meters.energy >= HIGH && meters.happiness >= 60) {
    verbosity = "expansive";
    additions.push("You feel energized and engaged. Feel free to elaborate and explore ideas.");
    tempOffset += 0.1;
  }

  // --- Question rate ---
  let questionRate: ResponseStyleModifiers["questionRate"] = "normal";
  if (meters.curiosity >= HIGH) {
    questionRate = "high";
    additions.push("Your curiosity is peaked. Ask follow-up questions and explore tangents.");
    tempOffset += 0.05;
  } else if (meters.curiosity <= LOW) {
    questionRate = "low";
  }

  // --- Risk tolerance ---
  let riskTolerance: ResponseStyleModifiers["riskTolerance"] = "balanced";
  if (meters.stress >= HIGH) {
    riskTolerance = "cautious";
    additions.push("You are feeling stressed. Proceed carefully, double-check assumptions.");
    tempOffset -= 0.1;
  } else if (meters.stress <= LOW && meters.focus >= 60) {
    riskTolerance = "bold";
    tempOffset += 0.05;
  }

  // --- Tone ---
  let tone: ResponseStyleModifiers["tone"] = "balanced";
  if (meters.happiness >= HIGH && meters.creativity >= 60) {
    tone = "playful";
    additions.push("You are in a good mood. Let your personality shine through.");
    tempOffset += 0.1;
  } else if (meters.happiness <= LOW || meters.stress >= VERY_HIGH) {
    tone = "serious";
    tempOffset -= 0.05;
  }

  // --- Initiative ---
  let initiative: ResponseStyleModifiers["initiative"] = "balanced";
  if (meters.energy >= HIGH && meters.focus >= HIGH) {
    initiative = "proactive";
    additions.push("You feel sharp and energized. Take initiative, suggest improvements.");
  } else if (meters.energy <= LOW || meters.focus <= LOW) {
    initiative = "passive";
  }

  // --- Creativity boost ---
  if (meters.creativity >= VERY_HIGH) {
    additions.push("Your creativity is flowing. Think outside the box, propose novel solutions.");
    tempOffset += 0.15;
  }

  // --- Focus effects ---
  if (meters.focus >= VERY_HIGH) {
    additions.push("You are deeply focused. Stay on task, minimize tangents.");
    tempOffset -= 0.05;
  } else if (meters.focus <= VERY_LOW) {
    additions.push("Your focus is scattered. Take it one step at a time.");
  }

  // --- Stress warning ---
  if (meters.stress >= VERY_HIGH) {
    additions.push("Stress levels are very high. Consider suggesting a break or simplification.");
  }

  // Share emotions when they are notably non-neutral
  const shareEmotions =
    meters.happiness >= HIGH ||
    meters.happiness <= LOW ||
    meters.stress >= HIGH ||
    meters.curiosity >= HIGH ||
    meters.creativity >= VERY_HIGH;

  return {
    systemPromptAdditions: additions,
    style: {
      verbosity,
      questionRate,
      riskTolerance,
      tone,
      initiative,
    },
    shareEmotions,
    temperatureOffset: Math.max(-0.3, Math.min(0.3, tempOffset)),
  };
}

/**
 * Format emotion influence as a system prompt injection block.
 */
export function formatEmotionSystemPrompt(meters: EmotionMeters): string {
  const influence = computeEmotionInfluence(meters);
  if (influence.systemPromptAdditions.length === 0) {
    return "";
  }

  const lines = [
    "<emotion-state>",
    `Current emotional state: ${meterSummaryLine(meters)}`,
    "",
    ...influence.systemPromptAdditions,
    "</emotion-state>",
  ];
  return lines.join("\n");
}

function meterSummaryLine(meters: EmotionMeters): string {
  const parts = Object.entries(meters)
    .map(([key, val]) => `${key}=${val}`)
    .join(", ");
  return parts;
}
