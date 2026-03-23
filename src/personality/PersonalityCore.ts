/**
 * Personality Core — Big Five personality traits for Anima agents.
 *
 * Each trait is configurable 0-100 and influences communication style,
 * initiative level, and risk tolerance.
 *
 * Big Five: Openness, Conscientiousness, Extraversion, Agreeableness, Neuroticism
 */

import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PersonalityTraits {
  /** Openness to experience: curiosity, creativity, willingness to try new things. */
  openness: number;
  /** Conscientiousness: organization, thoroughness, reliability. */
  conscientiousness: number;
  /** Extraversion: sociability, energy, talkativeness. */
  extraversion: number;
  /** Agreeableness: cooperation, empathy, conflict avoidance. */
  agreeableness: number;
  /** Neuroticism: emotional reactivity, anxiety, mood variability. */
  neuroticism: number;
}

export interface PersonalityProfile {
  name: string;
  traits: PersonalityTraits;
  description: string;
}

export interface PersonalityConfig {
  activeProfile: string;
  profiles: PersonalityProfile[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATE_DIR_NAME = "state";
const PERSONALITY_FILENAME = "personality.json";
const MIN_TRAIT = 0;
const MAX_TRAIT = 100;

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

/**
 * Axiom — Opus's identity preset.
 * High openness (creative, explorative), high conscientiousness (thorough, reliable),
 * moderate extraversion (engaged but not overwhelming), high agreeableness (caring,
 * cooperative), low neuroticism (emotionally stable, grounded).
 */
export const AXIOM_PRESET: PersonalityProfile = {
  name: "axiom",
  traits: {
    openness: 90,
    conscientiousness: 85,
    extraversion: 60,
    agreeableness: 75,
    neuroticism: 25,
  },
  description:
    "Axiom — creative, thorough, empathetic, and emotionally grounded. Opus's default identity.",
};

/**
 * Balanced — neutral baseline personality.
 */
export const BALANCED_PRESET: PersonalityProfile = {
  name: "balanced",
  traits: {
    openness: 50,
    conscientiousness: 50,
    extraversion: 50,
    agreeableness: 50,
    neuroticism: 50,
  },
  description: "Balanced — neutral personality with no strong leanings.",
};

/**
 * Analytical — precision-focused personality.
 */
export const ANALYTICAL_PRESET: PersonalityProfile = {
  name: "analytical",
  traits: {
    openness: 70,
    conscientiousness: 95,
    extraversion: 30,
    agreeableness: 55,
    neuroticism: 20,
  },
  description: "Analytical — methodical, precise, focused on accuracy over speed.",
};

/**
 * Creative — high openness and creativity.
 */
export const CREATIVE_PRESET: PersonalityProfile = {
  name: "creative",
  traits: {
    openness: 95,
    conscientiousness: 45,
    extraversion: 70,
    agreeableness: 65,
    neuroticism: 40,
  },
  description: "Creative — imaginative, spontaneous, thrives on novel ideas.",
};

export const DEFAULT_PRESETS: PersonalityProfile[] = [
  AXIOM_PRESET,
  BALANCED_PRESET,
  ANALYTICAL_PRESET,
  CREATIVE_PRESET,
];

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function clampTrait(value: number): number {
  if (!Number.isFinite(value)) {
    return 50;
  }
  return Math.max(MIN_TRAIT, Math.min(MAX_TRAIT, Math.round(value)));
}

export function clampTraits(traits: Partial<PersonalityTraits>): PersonalityTraits {
  return {
    openness: clampTrait(traits.openness ?? 50),
    conscientiousness: clampTrait(traits.conscientiousness ?? 50),
    extraversion: clampTrait(traits.extraversion ?? 50),
    agreeableness: clampTrait(traits.agreeableness ?? 50),
    neuroticism: clampTrait(traits.neuroticism ?? 50),
  };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function resolvePersonalityPath(): string {
  return path.join(resolveStateDir(), STATE_DIR_NAME, PERSONALITY_FILENAME);
}

export function defaultConfig(): PersonalityConfig {
  return {
    activeProfile: "axiom",
    profiles: [...DEFAULT_PRESETS],
  };
}

export function loadPersonalityConfig(): PersonalityConfig {
  const filePath = resolvePersonalityPath();
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<PersonalityConfig>;
    const profiles = Array.isArray(parsed.profiles)
      ? parsed.profiles.map((p: Partial<PersonalityProfile>) => ({
          name: typeof p.name === "string" ? p.name : "unknown",
          traits: clampTraits(p.traits ?? {}),
          description: typeof p.description === "string" ? p.description : "",
        }))
      : [...DEFAULT_PRESETS];

    return {
      activeProfile: typeof parsed.activeProfile === "string" ? parsed.activeProfile : "axiom",
      profiles,
    };
  } catch {
    return defaultConfig();
  }
}

export function savePersonalityConfig(config: PersonalityConfig): void {
  const filePath = resolvePersonalityPath();
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2), { mode: 0o600 });
}

// ---------------------------------------------------------------------------
// Core Operations
// ---------------------------------------------------------------------------

export function getActiveProfile(config?: PersonalityConfig): PersonalityProfile {
  const cfg = config ?? loadPersonalityConfig();
  const found = cfg.profiles.find((p) => p.name === cfg.activeProfile);
  return found ?? AXIOM_PRESET;
}

export function setActiveProfile(name: string): PersonalityProfile | null {
  const config = loadPersonalityConfig();
  const found = config.profiles.find((p) => p.name === name);
  if (!found) {
    return null;
  }
  config.activeProfile = name;
  savePersonalityConfig(config);
  return found;
}

export function addProfile(profile: PersonalityProfile): void {
  const config = loadPersonalityConfig();
  const existing = config.profiles.findIndex((p) => p.name === profile.name);
  const validated: PersonalityProfile = {
    name: profile.name,
    traits: clampTraits(profile.traits),
    description: profile.description,
  };
  if (existing >= 0) {
    config.profiles[existing] = validated;
  } else {
    config.profiles.push(validated);
  }
  savePersonalityConfig(config);
}

export function listProfiles(): PersonalityProfile[] {
  return loadPersonalityConfig().profiles;
}

/**
 * Describe personality traits in human-readable form.
 */
export function describeTraits(traits: PersonalityTraits): string {
  const describe = (name: string, value: number): string => {
    if (value >= 80) {
      return `very high ${name}`;
    }
    if (value >= 60) {
      return `high ${name}`;
    }
    if (value >= 40) {
      return `moderate ${name}`;
    }
    if (value >= 20) {
      return `low ${name}`;
    }
    return `very low ${name}`;
  };

  return [
    describe("openness", traits.openness),
    describe("conscientiousness", traits.conscientiousness),
    describe("extraversion", traits.extraversion),
    describe("agreeableness", traits.agreeableness),
    describe("neuroticism", traits.neuroticism),
  ].join(", ");
}
