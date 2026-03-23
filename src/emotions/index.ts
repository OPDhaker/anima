/**
 * Anima Emotion System — agent self-tracks emotions that influence behavior.
 */

export {
  type EmotionMeters,
  type EmotionSnapshot,
  type EmotionTrigger,
  type EmotionTriggerType,
  defaultMeters,
  defaultSnapshot,
  clampMeter,
  clampMeters,
  dominantEmotion,
  emotionSummary,
  loadEmotionSnapshot,
  saveEmotionSnapshot,
} from "./EmotionState.js";

export { EmotionEngine, getEmotionEngine, resetEmotionEngine } from "./EmotionEngine.js";

export {
  type EmotionInfluenceProfile,
  type ResponseStyleModifiers,
  computeEmotionInfluence,
  formatEmotionSystemPrompt,
} from "./EmotionInfluence.js";
