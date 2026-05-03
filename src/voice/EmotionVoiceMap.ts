/**
 * Emotion-to-Voice Parameter Mapping
 *
 * Maps emotional states from the Anima affect system to voice synthesis
 * parameters (speed, pitch, volume, stability, emphasis). This creates
 * natural-sounding emotional expression in synthesized speech.
 *
 * The mapping is based on prosody research: emotions change speech rate,
 * pitch range, volume, and voice quality in predictable ways.
 */

// ---------------------------------------------------------------------------
// Voice parameter adjustments
// ---------------------------------------------------------------------------

export interface VoiceParameters {
  /** Speech rate multiplier (1.0 = normal, < 1.0 = slower, > 1.0 = faster) */
  speed: number;
  /** Pitch adjustment (-1.0 to 1.0, relative to baseline) */
  pitch: number;
  /** Volume adjustment (0.0 to 1.0) */
  volume: number;
  /** Voice stability (0.0 to 1.0) — lower = more expressive variation */
  stability: number;
  /** Emphasis/style intensity (0.0 to 1.0) */
  emphasis: number;
  /** Sentence silence multiplier (1.0 = normal pause length) */
  pauseScale: number;
  /** Description for debugging */
  description: string;
}

const NEUTRAL: VoiceParameters = {
  speed: 1.0,
  pitch: 0.0,
  volume: 0.7,
  stability: 0.5,
  emphasis: 0.3,
  pauseScale: 1.0,
  description: "neutral baseline",
};

// ---------------------------------------------------------------------------
// Emotion-to-parameter mappings
// ---------------------------------------------------------------------------

/**
 * Core emotion mappings based on vocal prosody research.
 *
 * Sources:
 * - Scherer (2003) vocal affect expression
 * - Banse & Scherer (1996) acoustic profiles of vocal emotion expression
 * - Murray & Arnott (1993) toward the simulation of emotion in synthetic speech
 */
const EMOTION_MAP: Record<string, VoiceParameters> = {
  // --- Primary emotions ---
  joy: {
    speed: 1.15,
    pitch: 0.3,
    volume: 0.8,
    stability: 0.4,
    emphasis: 0.6,
    pauseScale: 0.8,
    description: "bright, energetic, uplifted tone",
  },
  happiness: {
    speed: 1.15,
    pitch: 0.3,
    volume: 0.8,
    stability: 0.4,
    emphasis: 0.6,
    pauseScale: 0.8,
    description: "bright, energetic, uplifted tone",
  },
  sadness: {
    speed: 0.8,
    pitch: -0.3,
    volume: 0.5,
    stability: 0.6,
    emphasis: 0.2,
    pauseScale: 1.4,
    description: "slow, soft, low-pitched, measured",
  },
  anger: {
    speed: 1.2,
    pitch: 0.2,
    volume: 0.9,
    stability: 0.3,
    emphasis: 0.8,
    pauseScale: 0.7,
    description: "fast, loud, tense, forceful",
  },
  fear: {
    speed: 1.25,
    pitch: 0.4,
    volume: 0.6,
    stability: 0.25,
    emphasis: 0.5,
    pauseScale: 0.6,
    description: "fast, high-pitched, breathy, unsteady",
  },
  surprise: {
    speed: 1.1,
    pitch: 0.5,
    volume: 0.85,
    stability: 0.3,
    emphasis: 0.7,
    pauseScale: 0.9,
    description: "sudden pitch jump, wide range, animated",
  },
  disgust: {
    speed: 0.9,
    pitch: -0.15,
    volume: 0.65,
    stability: 0.5,
    emphasis: 0.5,
    pauseScale: 1.1,
    description: "slow, low-pitched, tight, clipped",
  },
  contempt: {
    speed: 0.85,
    pitch: -0.1,
    volume: 0.6,
    stability: 0.65,
    emphasis: 0.4,
    pauseScale: 1.2,
    description: "slow, flat, deliberately measured",
  },

  // --- Complex / secondary emotions ---
  excitement: {
    speed: 1.3,
    pitch: 0.35,
    volume: 0.9,
    stability: 0.3,
    emphasis: 0.8,
    pauseScale: 0.6,
    description: "very fast, loud, high energy, animated",
  },
  anxiety: {
    speed: 1.15,
    pitch: 0.2,
    volume: 0.55,
    stability: 0.25,
    emphasis: 0.4,
    pauseScale: 0.8,
    description: "slightly fast, unsteady, tense, quiet",
  },
  calm: {
    speed: 0.9,
    pitch: -0.1,
    volume: 0.6,
    stability: 0.7,
    emphasis: 0.2,
    pauseScale: 1.3,
    description: "slow, steady, soft, relaxed",
  },
  serenity: {
    speed: 0.85,
    pitch: -0.05,
    volume: 0.55,
    stability: 0.75,
    emphasis: 0.15,
    pauseScale: 1.4,
    description: "very slow, very steady, gentle",
  },
  curiosity: {
    speed: 1.05,
    pitch: 0.2,
    volume: 0.7,
    stability: 0.45,
    emphasis: 0.5,
    pauseScale: 0.9,
    description: "slightly fast, rising intonation quality",
  },
  wonder: {
    speed: 0.95,
    pitch: 0.3,
    volume: 0.7,
    stability: 0.4,
    emphasis: 0.5,
    pauseScale: 1.1,
    description: "slower, breathy, wide-eyed quality",
  },
  amusement: {
    speed: 1.1,
    pitch: 0.2,
    volume: 0.75,
    stability: 0.35,
    emphasis: 0.6,
    pauseScale: 0.85,
    description: "light, bouncy, slightly fast",
  },
  tenderness: {
    speed: 0.85,
    pitch: 0.05,
    volume: 0.5,
    stability: 0.6,
    emphasis: 0.3,
    pauseScale: 1.3,
    description: "soft, warm, gentle, intimate",
  },
  love: {
    speed: 0.9,
    pitch: 0.1,
    volume: 0.55,
    stability: 0.55,
    emphasis: 0.35,
    pauseScale: 1.2,
    description: "warm, soft, steady with gentle variation",
  },
  gratitude: {
    speed: 0.95,
    pitch: 0.15,
    volume: 0.65,
    stability: 0.55,
    emphasis: 0.4,
    pauseScale: 1.1,
    description: "warm, sincere, measured",
  },
  pride: {
    speed: 1.0,
    pitch: 0.1,
    volume: 0.8,
    stability: 0.6,
    emphasis: 0.5,
    pauseScale: 1.0,
    description: "confident, resonant, steady",
  },
  determination: {
    speed: 1.05,
    pitch: 0.0,
    volume: 0.8,
    stability: 0.65,
    emphasis: 0.6,
    pauseScale: 0.9,
    description: "firm, steady, purposeful",
  },
  frustration: {
    speed: 1.1,
    pitch: 0.1,
    volume: 0.75,
    stability: 0.35,
    emphasis: 0.6,
    pauseScale: 0.85,
    description: "slightly fast, tense, uneven",
  },
  melancholy: {
    speed: 0.75,
    pitch: -0.2,
    volume: 0.45,
    stability: 0.55,
    emphasis: 0.2,
    pauseScale: 1.5,
    description: "very slow, very soft, wistful",
  },
  nostalgia: {
    speed: 0.85,
    pitch: -0.05,
    volume: 0.55,
    stability: 0.5,
    emphasis: 0.3,
    pauseScale: 1.3,
    description: "slow, warm, slightly wistful",
  },
  empathy: {
    speed: 0.9,
    pitch: 0.05,
    volume: 0.55,
    stability: 0.55,
    emphasis: 0.35,
    pauseScale: 1.2,
    description: "gentle, warm, attentive",
  },
  confidence: {
    speed: 1.0,
    pitch: 0.05,
    volume: 0.8,
    stability: 0.65,
    emphasis: 0.5,
    pauseScale: 1.0,
    description: "steady, clear, resonant",
  },
  sarcasm: {
    speed: 0.95,
    pitch: 0.15,
    volume: 0.7,
    stability: 0.4,
    emphasis: 0.6,
    pauseScale: 1.1,
    description: "deliberate, exaggerated intonation swings",
  },
  boredom: {
    speed: 0.8,
    pitch: -0.2,
    volume: 0.5,
    stability: 0.7,
    emphasis: 0.1,
    pauseScale: 1.3,
    description: "flat, monotone, low energy",
  },
  exhaustion: {
    speed: 0.7,
    pitch: -0.25,
    volume: 0.4,
    stability: 0.6,
    emphasis: 0.1,
    pauseScale: 1.5,
    description: "very slow, very soft, breathy, drained",
  },
  urgency: {
    speed: 1.35,
    pitch: 0.25,
    volume: 0.85,
    stability: 0.35,
    emphasis: 0.7,
    pauseScale: 0.5,
    description: "very fast, loud, clipped pauses",
  },
  neutral: NEUTRAL,
};

// ---------------------------------------------------------------------------
// Aliases — map common variations to canonical emotion names
// ---------------------------------------------------------------------------

const EMOTION_ALIASES: Record<string, string> = {
  happy: "joy",
  glad: "joy",
  elated: "excitement",
  thrilled: "excitement",
  ecstatic: "excitement",
  sad: "sadness",
  unhappy: "sadness",
  depressed: "melancholy",
  angry: "anger",
  furious: "anger",
  enraged: "anger",
  irritated: "frustration",
  annoyed: "frustration",
  afraid: "fear",
  scared: "fear",
  terrified: "fear",
  panicked: "fear",
  worried: "anxiety",
  nervous: "anxiety",
  stressed: "anxiety",
  anxious: "anxiety",
  surprised: "surprise",
  shocked: "surprise",
  amazed: "wonder",
  awed: "wonder",
  disgusted: "disgust",
  revolted: "disgust",
  peaceful: "serenity",
  relaxed: "calm",
  tranquil: "serenity",
  curious: "curiosity",
  interested: "curiosity",
  intrigued: "curiosity",
  amused: "amusement",
  playful: "amusement",
  tender: "tenderness",
  caring: "empathy",
  compassionate: "empathy",
  grateful: "gratitude",
  thankful: "gratitude",
  proud: "pride",
  determined: "determination",
  resolute: "determination",
  frustrated: "frustration",
  wistful: "nostalgia",
  bored: "boredom",
  tired: "exhaustion",
  weary: "exhaustion",
  urgent: "urgency",
  confident: "confidence",
  bold: "confidence",
  sarcastic: "sarcasm",
  ironic: "sarcasm",
  loving: "love",
  affectionate: "love",
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve an emotion string to voice parameters.
 * Handles aliases, case-insensitive matching, and falls back to neutral.
 */
export function resolveEmotionParameters(emotion: string): VoiceParameters {
  const normalized = emotion.trim().toLowerCase();
  if (!normalized) {
    return NEUTRAL;
  }

  // Direct match
  if (EMOTION_MAP[normalized]) {
    return EMOTION_MAP[normalized];
  }

  // Alias match
  const canonical = EMOTION_ALIASES[normalized];
  if (canonical && EMOTION_MAP[canonical]) {
    return EMOTION_MAP[canonical];
  }

  return NEUTRAL;
}

/**
 * Get a list of all supported emotion names (canonical + aliases).
 */
export function getSupportedEmotions(): string[] {
  const canonical = Object.keys(EMOTION_MAP);
  const aliases = Object.keys(EMOTION_ALIASES);
  return [...new Set([...canonical, ...aliases])].toSorted();
}

/**
 * Check if an emotion string is recognized.
 */
export function isRecognizedEmotion(emotion: string): boolean {
  const normalized = emotion.trim().toLowerCase();
  return normalized in EMOTION_MAP || normalized in EMOTION_ALIASES;
}

/**
 * Blend two emotion parameter sets by a weight (0.0 = entirely first, 1.0 = entirely second).
 * Useful for emotion transitions.
 */
export function blendEmotionParameters(
  a: VoiceParameters,
  b: VoiceParameters,
  weight: number,
): VoiceParameters {
  const w = Math.max(0, Math.min(1, weight));
  const lerp = (x: number, y: number) => x + (y - x) * w;
  return {
    speed: lerp(a.speed, b.speed),
    pitch: lerp(a.pitch, b.pitch),
    volume: lerp(a.volume, b.volume),
    stability: lerp(a.stability, b.stability),
    emphasis: lerp(a.emphasis, b.emphasis),
    pauseScale: lerp(a.pauseScale, b.pauseScale),
    description: w < 0.5 ? a.description : b.description,
  };
}

/**
 * Convert voice parameters to macOS `say` command rate.
 * macOS say accepts words-per-minute (default ~175 WPM).
 */
export function toMacOSSayRate(params: VoiceParameters, baseRate = 175): number {
  return Math.round(baseRate * params.speed);
}

/**
 * Convert voice parameters to Piper TTS length_scale.
 * Piper length_scale: < 1.0 = faster, > 1.0 = slower (inverse of speed).
 */
export function toPiperLengthScale(params: VoiceParameters): number {
  return Math.max(0.5, Math.min(2.0, 1 / params.speed));
}

/**
 * Convert voice parameters to Piper noise_scale (expressiveness).
 * Maps stability inversely: low stability = high noise = more expression.
 */
export function toPiperNoiseScale(params: VoiceParameters): number {
  return Math.max(0, Math.min(1, 1 - params.stability));
}

/**
 * Convert voice parameters to ElevenLabs voice settings.
 */
export function toElevenLabsSettings(params: VoiceParameters): {
  stability: number;
  similarityBoost: number;
  style: number;
  speed: number;
} {
  return {
    stability: params.stability,
    similarityBoost: Math.max(0, Math.min(1, 0.75 + params.pitch * 0.1)),
    style: params.emphasis,
    speed: params.speed,
  };
}

/**
 * Convert voice parameters to OpenAI TTS speed parameter.
 * OpenAI supports 0.25 to 4.0 speed.
 */
export function toOpenAISpeed(params: VoiceParameters): number {
  return Math.max(0.25, Math.min(4.0, params.speed));
}

export { NEUTRAL as NEUTRAL_PARAMETERS, EMOTION_MAP, EMOTION_ALIASES };
