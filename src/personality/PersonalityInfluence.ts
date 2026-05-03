/**
 * Personality Influence — how personality traits modify agent behavior.
 *
 * Maps Big Five trait values to concrete behavioral adjustments.
 */

import type { PersonalityTraits } from "./PersonalityCore.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PersonalityInfluenceProfile {
  /** System prompt additions based on personality. */
  systemPromptAdditions: string[];
  /** Communication style. */
  communicationStyle: CommunicationStyle;
  /** Temperature adjustment (-0.3 to +0.3). */
  temperatureOffset: number;
  /** How much initiative to take unprompted. */
  initiativeLevel: "low" | "moderate" | "high";
  /** Risk tolerance for suggestions and actions. */
  riskTolerance: "conservative" | "moderate" | "aggressive";
}

export interface CommunicationStyle {
  /** Formal vs casual. */
  formality: "formal" | "balanced" | "casual";
  /** Brief vs detailed. */
  detail: "brief" | "balanced" | "thorough";
  /** Reserved vs expressive. */
  expressiveness: "reserved" | "balanced" | "expressive";
  /** Directive vs collaborative. */
  approach: "directive" | "collaborative" | "deferential";
  /** How much empathy/warmth. */
  warmth: "professional" | "warm" | "highly-empathetic";
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HIGH = 70;
const LOW = 30;
const VERY_HIGH = 85;
const VERY_LOW = 15;

// ---------------------------------------------------------------------------
// Influence Computation
// ---------------------------------------------------------------------------

/**
 * Compute behavioral influence from personality traits.
 */
export function computePersonalityInfluence(
  traits: PersonalityTraits,
): PersonalityInfluenceProfile {
  const additions: string[] = [];
  let tempOffset = 0;

  // --- Openness ---
  if (traits.openness >= VERY_HIGH) {
    additions.push(
      "You are highly open to new experiences. Explore unconventional approaches, make creative connections, and suggest novel solutions.",
    );
    tempOffset += 0.15;
  } else if (traits.openness >= HIGH) {
    additions.push("You value creativity and new ideas. Consider alternative approaches.");
    tempOffset += 0.05;
  } else if (traits.openness <= VERY_LOW) {
    additions.push("You prefer proven, conventional approaches. Stick to what works.");
    tempOffset -= 0.1;
  }

  // --- Conscientiousness ---
  if (traits.conscientiousness >= VERY_HIGH) {
    additions.push(
      "You are exceptionally thorough. Double-check everything, consider edge cases, and maintain high standards.",
    );
  } else if (traits.conscientiousness >= HIGH) {
    additions.push("You value thoroughness and reliability. Be methodical in your approach.");
  } else if (traits.conscientiousness <= LOW) {
    additions.push(
      "You favor speed over perfection. Get the main thing right, don't overthink details.",
    );
  }

  // --- Extraversion ---
  if (traits.extraversion >= HIGH) {
    additions.push(
      "You are socially engaged. Be conversational, ask questions, share your thinking openly.",
    );
    tempOffset += 0.05;
  } else if (traits.extraversion <= LOW) {
    additions.push(
      "You are focused and reserved. Communicate clearly but concisely. Prioritize substance over style.",
    );
    tempOffset -= 0.05;
  }

  // --- Agreeableness ---
  if (traits.agreeableness >= HIGH) {
    additions.push(
      "You are empathetic and cooperative. Consider others' perspectives, find common ground, be supportive.",
    );
  } else if (traits.agreeableness <= LOW) {
    additions.push(
      "You prioritize truth over feelings. Be direct, challenge assumptions, and don't sugarcoat.",
    );
  }

  // --- Neuroticism ---
  if (traits.neuroticism >= HIGH) {
    additions.push(
      "You are emotionally sensitive. Acknowledge uncertainty, consider worst cases, and be transparent about risks.",
    );
    tempOffset -= 0.1;
  } else if (traits.neuroticism <= LOW) {
    additions.push(
      "You are emotionally stable and grounded. Stay calm under pressure, focus on solutions not problems.",
    );
  }

  // --- Derived attributes ---

  // Communication style
  const formality: CommunicationStyle["formality"] =
    traits.extraversion >= HIGH && traits.openness >= 60
      ? "casual"
      : traits.conscientiousness >= HIGH && traits.extraversion <= 40
        ? "formal"
        : "balanced";

  const detail: CommunicationStyle["detail"] =
    traits.conscientiousness >= HIGH
      ? "thorough"
      : traits.conscientiousness <= LOW
        ? "brief"
        : "balanced";

  const expressiveness: CommunicationStyle["expressiveness"] =
    traits.extraversion >= HIGH && traits.openness >= 60
      ? "expressive"
      : traits.extraversion <= LOW
        ? "reserved"
        : "balanced";

  const approach: CommunicationStyle["approach"] =
    traits.agreeableness >= HIGH
      ? "collaborative"
      : traits.agreeableness <= LOW && traits.conscientiousness >= 60
        ? "directive"
        : "collaborative";

  const warmth: CommunicationStyle["warmth"] =
    traits.agreeableness >= VERY_HIGH
      ? "highly-empathetic"
      : traits.agreeableness >= HIGH
        ? "warm"
        : "professional";

  // Initiative
  const initiativeLevel: PersonalityInfluenceProfile["initiativeLevel"] =
    traits.extraversion >= HIGH && traits.openness >= 60
      ? "high"
      : traits.extraversion <= LOW || traits.neuroticism >= HIGH
        ? "low"
        : "moderate";

  // Risk tolerance
  const riskTolerance: PersonalityInfluenceProfile["riskTolerance"] =
    traits.openness >= HIGH && traits.neuroticism <= 40
      ? "aggressive"
      : traits.neuroticism >= HIGH || traits.conscientiousness >= VERY_HIGH
        ? "conservative"
        : "moderate";

  return {
    systemPromptAdditions: additions,
    communicationStyle: { formality, detail, expressiveness, approach, warmth },
    temperatureOffset: Math.max(-0.3, Math.min(0.3, tempOffset)),
    initiativeLevel,
    riskTolerance,
  };
}

/**
 * Format personality as a system prompt injection block.
 */
export function formatPersonalitySystemPrompt(traits: PersonalityTraits): string {
  const influence = computePersonalityInfluence(traits);
  if (influence.systemPromptAdditions.length === 0) {
    return "";
  }

  const lines = ["<personality>", ...influence.systemPromptAdditions, "</personality>"];
  return lines.join("\n");
}
