/**
 * Anima Voice Engine — TTS/STT with emotion-aware voice modulation.
 */

export type {
  TtsProviderName,
  SttProviderName,
  VoiceEngineConfig,
  VoiceProvider,
  SynthesisOptions,
  SynthesisResult,
  TranscriptionOptions,
  TranscriptionResult,
  VoiceModelConfig,
  AudioFormatConfig,
  AudioFormat,
} from "./VoiceConfig.js";

export { DEFAULT_VOICE_CONFIG, DEFAULT_AUDIO_FORMAT } from "./VoiceConfig.js";

export { VoiceEngine, getVoiceEngine, resetVoiceEngine } from "./VoiceEngine.js";

export {
  SystemTTSProvider,
  OpenAITTSProvider,
  ElevenLabsTTSProvider,
  NoxSoftTTSProvider,
  createBuiltinProviders,
  initializeVoiceEngine,
} from "./VoiceProviders.js";
