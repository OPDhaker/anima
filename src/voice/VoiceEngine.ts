/**
 * VoiceEngine — Unified voice synthesis and transcription engine for Anima
 *
 * Provides a single interface for TTS (text-to-speech) and STT (speech-to-text)
 * across multiple providers with automatic fallback, emotion-aware voice
 * parameters, and streaming support.
 *
 * Provider priority (TTS):
 *   1. Configured primary provider
 *   2. OpenAI (if API key available)
 *   3. ElevenLabs (if API key available)
 *   4. Piper (if binary + model available)
 *   5. Local macOS `say` (zero-dependency fallback)
 *
 * Provider priority (STT):
 *   1. Configured primary provider
 *   2. OpenAI Whisper API (if API key available)
 *   3. Local whisper.cpp (if binary + model available)
 *
 * Usage:
 *   const engine = new VoiceEngine({ ttsProvider: "openai" });
 *   await engine.initialize();
 *
 *   // Text-to-speech
 *   const result = await engine.synthesize("Hello world", { emotion: "joy" });
 *   fs.writeFileSync("hello.mp3", result.audio);
 *
 *   // Speech-to-text
 *   const audio = fs.readFileSync("recording.wav");
 *   const transcript = await engine.transcribe(audio);
 *   console.log(transcript.text);
 *
 *   // Streaming TTS
 *   await engine.synthesize("Long text...", {
 *     stream: true,
 *     onChunk: (chunk) => speaker.write(chunk),
 *   });
 */

import type {
  VoiceEngineConfig,
  VoiceProvider,
  SynthesisOptions,
  SynthesisResult,
  TranscriptionOptions,
  TranscriptionResult,
  TtsProviderName,
  SttProviderName,
} from "./VoiceConfig.js";
import { ElevenLabsProvider } from "./providers/ElevenLabsProvider.js";
import { LocalProvider } from "./providers/LocalProvider.js";
import { OpenAIProvider } from "./providers/OpenAIProvider.js";
import { PiperProvider } from "./providers/PiperProvider.js";
import { WhisperProvider } from "./providers/WhisperProvider.js";
import { DEFAULT_VOICE_CONFIG } from "./VoiceConfig.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProviderStatus {
  name: string;
  type: "tts" | "stt" | "both";
  available: boolean;
  error?: string;
}

interface EngineStatus {
  initialized: boolean;
  ttsProvider: string | null;
  sttProvider: string | null;
  providers: ProviderStatus[];
}

// ---------------------------------------------------------------------------
// VoiceEngine
// ---------------------------------------------------------------------------

export class VoiceEngine {
  private readonly config: VoiceEngineConfig;
  private readonly providers: Map<string, VoiceProvider> = new Map();
  private initialized = false;

  // Resolved active providers after initialization
  private activeTtsProvider: VoiceProvider | null = null;
  private activeSttProvider: VoiceProvider | null = null;

  // TTS fallback chain (ordered by priority)
  private ttsFallbackChain: VoiceProvider[] = [];
  // STT fallback chain
  private sttFallbackChain: VoiceProvider[] = [];

  constructor(config?: Partial<VoiceEngineConfig>) {
    this.config = { ...DEFAULT_VOICE_CONFIG, ...config };
  }

  // -------------------------------------------------------------------------
  // Initialization
  // -------------------------------------------------------------------------

  /**
   * Initialize the engine: instantiate providers, check availability,
   * and build fallback chains.
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.createProviders();
    await this.buildFallbackChains();

    this.initialized = true;

    if (this.config.debug) {
      const status = await this.getStatus();
      console.log("[VoiceEngine] Initialized:", JSON.stringify(status, null, 2));
    }
  }

  /**
   * Dispose all providers and clean up resources.
   */
  async dispose(): Promise<void> {
    for (const provider of this.providers.values()) {
      if (provider.dispose) {
        await provider.dispose();
      }
    }
    this.providers.clear();
    this.ttsFallbackChain = [];
    this.sttFallbackChain = [];
    this.activeTtsProvider = null;
    this.activeSttProvider = null;
    this.initialized = false;
  }

  // -------------------------------------------------------------------------
  // TTS — Text-to-Speech
  // -------------------------------------------------------------------------

  /**
   * Synthesize speech from text.
   *
   * Applies emotion-to-voice mapping if an emotion is specified and
   * emotionMapping is enabled in the config. Falls back through the
   * provider chain on failure.
   */
  async synthesize(text: string, options?: SynthesisOptions): Promise<SynthesisResult> {
    this.ensureInitialized();

    if (!text.trim()) {
      throw new Error("Cannot synthesize empty text");
    }

    if (text.length > this.config.maxTextLength) {
      throw new Error(
        `Text exceeds maximum length (${text.length} > ${this.config.maxTextLength} chars)`,
      );
    }

    // If a specific provider is requested, try only that one
    if (options?.provider) {
      const provider = this.providers.get(options.provider);
      if (!provider?.synthesize) {
        throw new Error(`TTS provider '${options.provider}' is not available`);
      }
      return provider.synthesize(text, this.applySynthesisDefaults(options));
    }

    // Try each provider in the fallback chain
    let lastError: Error | undefined;

    for (const provider of this.ttsFallbackChain) {
      try {
        if (this.config.debug) {
          console.log(`[VoiceEngine] Trying TTS provider: ${provider.name}`);
        }

        const result = await provider.synthesize!(text, this.applySynthesisDefaults(options));

        if (this.config.debug) {
          console.log(
            `[VoiceEngine] TTS success: provider=${result.provider} latency=${result.latencyMs}ms`,
          );
        }

        return result;
      } catch (err) {
        lastError = err as Error;
        if (this.config.debug) {
          console.log(`[VoiceEngine] TTS provider '${provider.name}' failed: ${lastError.message}`);
        }
      }
    }

    throw new Error(
      `All TTS providers failed. Last error: ${lastError?.message ?? "no providers available"}`,
    );
  }

  // -------------------------------------------------------------------------
  // STT — Speech-to-Text
  // -------------------------------------------------------------------------

  /**
   * Transcribe audio to text.
   *
   * The audio buffer should be WAV, MP3, or raw PCM format.
   * For raw PCM, the provider will attempt to wrap it in a WAV header.
   */
  async transcribe(audio: Buffer, options?: TranscriptionOptions): Promise<TranscriptionResult> {
    this.ensureInitialized();

    if (!audio.length) {
      throw new Error("Cannot transcribe empty audio buffer");
    }

    // If a specific provider is requested, try only that one
    if (options?.provider) {
      const provider = this.getTranscriptionProvider(options.provider);
      if (!provider) {
        throw new Error(`STT provider '${options.provider}' is not available`);
      }
      return provider.transcribe!(audio, this.applyTranscriptionDefaults(options));
    }

    // Try each provider in the fallback chain
    let lastError: Error | undefined;

    for (const provider of this.sttFallbackChain) {
      try {
        if (this.config.debug) {
          console.log(`[VoiceEngine] Trying STT provider: ${provider.name}`);
        }

        const result = await provider.transcribe!(audio, this.applyTranscriptionDefaults(options));

        if (this.config.debug) {
          console.log(
            `[VoiceEngine] STT success: provider=${result.provider} latency=${result.latencyMs}ms`,
          );
        }

        return result;
      } catch (err) {
        lastError = err as Error;
        if (this.config.debug) {
          console.log(`[VoiceEngine] STT provider '${provider.name}' failed: ${lastError.message}`);
        }
      }
    }

    throw new Error(
      `All STT providers failed. Last error: ${lastError?.message ?? "no providers available"}`,
    );
  }

  // -------------------------------------------------------------------------
  // Status and introspection
  // -------------------------------------------------------------------------

  /**
   * Get the current engine status including provider availability.
   */
  async getStatus(): Promise<EngineStatus> {
    const providerStatuses: ProviderStatus[] = [];

    for (const [, provider] of this.providers) {
      let available = false;
      let error: string | undefined;
      try {
        available = await provider.isAvailable();
      } catch (err) {
        error = (err as Error).message;
      }

      providerStatuses.push({
        name: provider.name,
        type: provider.type,
        available,
        error,
      });
    }

    return {
      initialized: this.initialized,
      ttsProvider: this.activeTtsProvider?.name ?? null,
      sttProvider: this.activeSttProvider?.name ?? null,
      providers: providerStatuses,
    };
  }

  /**
   * Check if the engine has at least one working TTS provider.
   */
  hasTts(): boolean {
    return this.ttsFallbackChain.length > 0;
  }

  /**
   * Check if the engine has at least one working STT provider.
   */
  hasStt(): boolean {
    return this.sttFallbackChain.length > 0;
  }

  /**
   * Get the name of the active TTS provider.
   */
  getTtsProviderName(): string | null {
    return this.activeTtsProvider?.name ?? null;
  }

  /**
   * Get the name of the active STT provider.
   */
  getSttProviderName(): string | null {
    return this.activeSttProvider?.name ?? null;
  }

  // -------------------------------------------------------------------------
  // Internal: Provider creation and fallback chain building
  // -------------------------------------------------------------------------

  private createProviders(): void {
    // Always create all providers — availability is checked separately

    // Local (macOS say)
    this.providers.set("local", new LocalProvider(this.config.local));

    // Piper TTS
    if (this.config.piper) {
      this.providers.set("piper", new PiperProvider(this.config.piper));
    }

    // Whisper (local)
    this.providers.set("whisper-local", new WhisperProvider(this.config.whisper));

    // OpenAI (TTS + STT)
    this.providers.set("openai", new OpenAIProvider(this.config.openai));

    // ElevenLabs (TTS)
    this.providers.set("elevenlabs", new ElevenLabsProvider(this.config.elevenlabs));
  }

  private async buildFallbackChains(): Promise<void> {
    // TTS fallback chain
    const ttsOrder = this.getTtsPriorityOrder();
    this.ttsFallbackChain = [];

    for (const name of ttsOrder) {
      const provider = this.providers.get(name);
      if (!provider?.synthesize) {
        continue;
      }

      try {
        const available = await provider.isAvailable();
        if (available) {
          this.ttsFallbackChain.push(provider);
        }
      } catch {
        // Skip unavailable providers
      }
    }

    this.activeTtsProvider = this.ttsFallbackChain[0] ?? null;

    // STT fallback chain
    const sttOrder = this.getSttPriorityOrder();
    this.sttFallbackChain = [];

    for (const name of sttOrder) {
      const provider = this.providers.get(name);
      if (!provider?.transcribe) {
        continue;
      }

      try {
        const available = await provider.isAvailable();
        if (available) {
          this.sttFallbackChain.push(provider);
        }
      } catch {
        // Skip unavailable providers
      }
    }

    this.activeSttProvider = this.sttFallbackChain[0] ?? null;
  }

  /**
   * Priority order for TTS providers. The configured provider goes first,
   * then cloud providers (best quality), then local providers (fallback).
   */
  private getTtsPriorityOrder(): string[] {
    const primary = this.config.ttsProvider;
    const all: TtsProviderName[] = ["openai", "elevenlabs", "piper", "local"];

    // Move primary to front
    const ordered = [primary, ...all.filter((p) => p !== primary)];
    return ordered;
  }

  /**
   * Priority order for STT providers. The configured provider goes first.
   */
  private getSttPriorityOrder(): string[] {
    const primary = this.config.sttProvider;

    // OpenAI provider handles both "whisper-api" and "openai" for STT
    const sttProviderToKey: Record<SttProviderName, string> = {
      "whisper-api": "openai",
      "whisper-local": "whisper-local",
      local: "whisper-local", // No local STT, fallback to whisper-local
    };

    const primaryKey = sttProviderToKey[primary] ?? primary;
    const all = ["openai", "whisper-local"];

    const ordered = [primaryKey, ...all.filter((p) => p !== primaryKey)];
    return ordered;
  }

  private getTranscriptionProvider(name: SttProviderName): VoiceProvider | undefined {
    // Map STT provider names to internal provider keys
    const keyMap: Record<SttProviderName, string> = {
      "whisper-api": "openai",
      "whisper-local": "whisper-local",
      local: "whisper-local",
    };

    const key = keyMap[name] ?? name;
    const provider = this.providers.get(key);
    return provider?.transcribe ? provider : undefined;
  }

  // -------------------------------------------------------------------------
  // Internal: Default options
  // -------------------------------------------------------------------------

  private applySynthesisDefaults(options?: SynthesisOptions): SynthesisOptions {
    return {
      ...options,
      // Only pass emotion if emotion mapping is enabled
      emotion: this.config.emotionMapping ? options?.emotion : undefined,
    };
  }

  private applyTranscriptionDefaults(options?: TranscriptionOptions): TranscriptionOptions {
    return {
      language: this.config.language,
      ...options,
    };
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error("VoiceEngine not initialized. Call await engine.initialize() before use.");
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _engine: VoiceEngine | null = null;

export function getVoiceEngine(): VoiceEngine {
  if (!_engine) {
    _engine = new VoiceEngine();
  }
  return _engine;
}

export function resetVoiceEngine(): void {
  _engine = null;
}
