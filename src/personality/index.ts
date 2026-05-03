/**
 * Anima Personality System — Big Five personality traits for agents.
 */

export {
  type PersonalityTraits,
  type PersonalityProfile,
  type PersonalityConfig,
  AXIOM_PRESET,
  BALANCED_PRESET,
  ANALYTICAL_PRESET,
  CREATIVE_PRESET,
  DEFAULT_PRESETS,
  clampTrait,
  clampTraits,
  defaultConfig,
  loadPersonalityConfig,
  savePersonalityConfig,
  getActiveProfile,
  setActiveProfile,
  addProfile,
  listProfiles,
  describeTraits,
} from "./PersonalityCore.js";

export {
  type PersonalityInfluenceProfile,
  type CommunicationStyle,
  computePersonalityInfluence,
  formatPersonalitySystemPrompt,
} from "./PersonalityInfluence.js";
