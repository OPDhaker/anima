/**
 * Voice Engine Configuration
 *
 * Defines all configuration types and defaults for the unified voice engine.
 * Supports TTS (text-to-speech) and STT (speech-to-text) across multiple providers.
 */

// ---------------------------------------------------------------------------
// Provider identifiers
// ---------------------------------------------------------------------------

export type TtsProviderName = "local" | "piper" | "openai" | "elevenlabs" | "edge";
export type SttProviderName = "whisper-local" | "whisper-api" | "local";

// ---------------------------------------------------------------------------
// Voice model configuration
// ---------------------------------------------------------------------------

export interface VoiceModelConfig {
  /** Path to ONNX model file (Piper) or model identifier string */
  modelPath?: string;
  /** Whisper model size: tiny, base, small, medium, large, turbo */
  whisperModel?: WhisperModelSize;
  /** Speaker ID for multi-speaker models */
  speakerId?: number;
}

export type WhisperModelSize = "tiny" | "base" | "small" | "medium" | "large" | "turbo";

// ---------------------------------------------------------------------------
// Audio format configuration
// ---------------------------------------------------------------------------

export interface AudioFormatConfig {
  /** Sample rate in Hz */
  sampleRate: number;
  /** Number of audio channels (1 = mono, 2 = stereo) */
  channels: number;
  /** Output encoding format */
  format: AudioFormat;
}

export type AudioFormat = "mp3" | "wav" | "opus" | "pcm" | "ogg" | "aiff";

export const DEFAULT_AUDIO_FORMAT: AudioFormatConfig = {
  sampleRate: 22050,
  channels: 1,
  format: "wav",
};

// ---------------------------------------------------------------------------
// Provider-specific configuration
// ---------------------------------------------------------------------------

export interface LocalProviderConfig {
  /** macOS voice name (e.g. "Samantha", "Alex", "Karen") */
  voice?: string;
  /** Speech rate in words per minute (default: 175) */
  rate?: number;
  /** Output audio format */
  audioFormat?: AudioFormat;
}

export interface PiperProviderConfig {
  /** Path to Piper binary */
  binaryPath?: string;
  /** Path to ONNX voice model */
  modelPath: string;
  /** Path to model config JSON */
  configPath?: string;
  /** Speaker ID for multi-speaker models */
  speakerId?: number;
  /** Length scale (speed): < 1.0 = faster, > 1.0 = slower */
  lengthScale?: number;
  /** Noise scale (variation in phoneme duration) */
  noiseScale?: number;
  /** Noise width (variation in phoneme pitch) */
  noiseW?: number;
  /** Sentence silence duration in seconds */
  sentenceSilence?: number;
}

export interface WhisperProviderConfig {
  /** Path to whisper.cpp binary or nodejs-whisper installation */
  binaryPath?: string;
  /** Model size to use */
  modelSize: WhisperModelSize;
  /** Path to model files directory */
  modelDir?: string;
  /** Language code for transcription (e.g. "en", "de", "fr") */
  language?: string;
  /** Enable translation to English */
  translate?: boolean;
  /** Number of threads for inference */
  threads?: number;
  /** Maximum segment length in characters */
  maxLen?: number;
}

export interface OpenAIProviderConfig {
  /** OpenAI API key (falls back to OPENAI_API_KEY env var) */
  apiKey?: string;
  /** TTS model: "gpt-4o-mini-tts", "tts-1", "tts-1-hd" */
  ttsModel?: string;
  /** TTS voice: "alloy", "ash", "ballad", "coral", "echo", "fable", etc. */
  ttsVoice?: string;
  /** STT model: "whisper-1", "gpt-4o-transcribe", "gpt-4o-mini-transcribe" */
  sttModel?: string;
  /** Custom base URL (for OpenAI-compatible endpoints like Kokoro, LocalAI) */
  baseUrl?: string;
  /** Response format for TTS */
  responseFormat?: "mp3" | "opus" | "pcm";
  /** Timeout in milliseconds */
  timeoutMs?: number;
}

export interface ElevenLabsProviderConfig {
  /** ElevenLabs API key (falls back to ELEVENLABS_API_KEY or XI_API_KEY) */
  apiKey?: string;
  /** Voice ID */
  voiceId?: string;
  /** Model ID (e.g. "eleven_multilingual_v2") */
  modelId?: string;
  /** Base API URL */
  baseUrl?: string;
  /** Output format string */
  outputFormat?: string;
  /** Voice settings */
  voiceSettings?: {
    stability: number;
    similarityBoost: number;
    style: number;
    useSpeakerBoost: boolean;
    speed: number;
  };
  /** Timeout in milliseconds */
  timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Main voice engine configuration
// ---------------------------------------------------------------------------

export interface VoiceEngineConfig {
  /** Primary TTS provider */
  ttsProvider: TtsProviderName;
  /** Primary STT provider */
  sttProvider: SttProviderName;
  /** Language code (ISO 639-1) */
  language: string;
  /** Voice model configuration */
  model?: VoiceModelConfig;
  /** Audio format settings */
  audioFormat: AudioFormatConfig;
  /** Enable emotion-to-voice parameter mapping */
  emotionMapping: boolean;
  /** Maximum text length for TTS (chars) */
  maxTextLength: number;
  /** Global timeout in milliseconds */
  timeoutMs: number;
  /** Enable debug logging */
  debug: boolean;

  /** Provider-specific configs */
  local?: LocalProviderConfig;
  piper?: PiperProviderConfig;
  whisper?: WhisperProviderConfig;
  openai?: OpenAIProviderConfig;
  elevenlabs?: ElevenLabsProviderConfig;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_VOICE_CONFIG: VoiceEngineConfig = {
  ttsProvider: "local",
  sttProvider: "whisper-local",
  language: "en",
  audioFormat: DEFAULT_AUDIO_FORMAT,
  emotionMapping: true,
  maxTextLength: 4096,
  timeoutMs: 30_000,
  debug: false,
};

// ---------------------------------------------------------------------------
// Synthesis and transcription options
// ---------------------------------------------------------------------------

export interface SynthesisOptions {
  /** Emotion state to apply to voice parameters */
  emotion?: string;
  /** Speech speed multiplier (0.5 - 2.0) */
  speed?: number;
  /** Pitch adjustment (-1.0 to 1.0, where supported) */
  pitch?: number;
  /** Volume adjustment (0.0 to 1.0) */
  volume?: number;
  /** Override the configured provider for this call */
  provider?: TtsProviderName;
  /** Override the output format */
  format?: AudioFormat;
  /** Enable streaming mode (returns chunks via callback) */
  stream?: boolean;
  /** Callback for streaming audio chunks */
  onChunk?: (chunk: Buffer) => void;
}

export interface TranscriptionOptions {
  /** Override the configured STT provider for this call */
  provider?: SttProviderName;
  /** Language hint for transcription */
  language?: string;
  /** Enable word-level timestamps */
  timestamps?: boolean;
  /** Translate to English */
  translate?: boolean;
  /** Custom prompt/context for the transcription model */
  prompt?: string;
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface SynthesisResult {
  /** Audio data buffer */
  audio: Buffer;
  /** Audio format of the output */
  format: AudioFormat;
  /** Sample rate in Hz */
  sampleRate: number;
  /** Provider that generated the audio */
  provider: TtsProviderName;
  /** Processing time in milliseconds */
  latencyMs: number;
  /** Character count of input text */
  inputLength: number;
}

export interface TranscriptionResult {
  /** Transcribed text */
  text: string;
  /** Language detected or used */
  language: string;
  /** Confidence score (0.0 to 1.0) if available */
  confidence?: number;
  /** Provider that performed the transcription */
  provider: SttProviderName;
  /** Processing time in milliseconds */
  latencyMs: number;
  /** Word-level timestamps if requested */
  segments?: TranscriptionSegment[];
}

export interface TranscriptionSegment {
  /** Segment text */
  text: string;
  /** Start time in seconds */
  start: number;
  /** End time in seconds */
  end: number;
}

// ---------------------------------------------------------------------------
// Provider interface
// ---------------------------------------------------------------------------

export interface VoiceProvider {
  readonly name: string;
  readonly type: "tts" | "stt" | "both";

  /** Check if this provider is available (binary exists, API key set, etc.) */
  isAvailable(): Promise<boolean>;

  /** Synthesize speech from text (TTS providers only) */
  synthesize?(text: string, options?: SynthesisOptions): Promise<SynthesisResult>;

  /** Transcribe audio to text (STT providers only) */
  transcribe?(audio: Buffer, options?: TranscriptionOptions): Promise<TranscriptionResult>;

  /** Clean up resources */
  dispose?(): Promise<void>;
}
