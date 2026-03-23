/**
 * ElevenLabs Voice Provider — Premium TTS via ElevenLabs API
 *
 * ElevenLabs offers best-in-class voice synthesis with:
 * - Voice cloning from short audio samples
 * - Fine-grained voice settings (stability, similarity, style, speed)
 * - Multilingual support (29+ languages)
 * - Streaming audio for low-latency applications
 *
 * Models:
 *   eleven_multilingual_v2  — Best quality, 29 languages
 *   eleven_monolingual_v1   — English only, fast
 *   eleven_turbo_v2         — Low latency, good quality
 *   eleven_turbo_v2_5       — Latest turbo, improved quality
 *
 * License: Proprietary API (requires API key and subscription)
 */

import type {
  VoiceProvider,
  SynthesisOptions,
  SynthesisResult,
  ElevenLabsProviderConfig,
  AudioFormat,
} from "../VoiceConfig.js";
import { resolveEmotionParameters, toElevenLabsSettings } from "../EmotionVoiceMap.js";

const DEFAULT_BASE_URL = "https://api.elevenlabs.io";
const DEFAULT_VOICE_ID = "pMsXgVXv3BLzUgSXRplE"; // "Aria" — expressive female
const DEFAULT_MODEL_ID = "eleven_multilingual_v2";
const DEFAULT_OUTPUT_FORMAT = "mp3_44100_128";
const DEFAULT_TIMEOUT_MS = 30_000;

const DEFAULT_VOICE_SETTINGS = {
  stability: 0.5,
  similarityBoost: 0.75,
  style: 0.0,
  useSpeakerBoost: true,
  speed: 1.0,
};

const OUTPUT_FORMAT_SAMPLE_RATES: Record<string, number> = {
  mp3_44100_128: 44100,
  mp3_44100_64: 44100,
  mp3_44100_32: 44100,
  mp3_22050_32: 22050,
  pcm_16000: 16000,
  pcm_22050: 22050,
  pcm_24000: 24000,
  pcm_44100: 44100,
  ulaw_8000: 8000,
  opus_48000_64: 48000,
  opus_48000_32: 48000,
};

const OUTPUT_FORMAT_AUDIO_FORMATS: Record<string, AudioFormat> = {
  mp3_44100_128: "mp3",
  mp3_44100_64: "mp3",
  mp3_44100_32: "mp3",
  mp3_22050_32: "mp3",
  pcm_16000: "pcm",
  pcm_22050: "pcm",
  pcm_24000: "pcm",
  pcm_44100: "pcm",
  opus_48000_64: "opus",
  opus_48000_32: "opus",
};

function isValidVoiceId(voiceId: string): boolean {
  return /^[a-zA-Z0-9]{10,40}$/.test(voiceId);
}

export class ElevenLabsProvider implements VoiceProvider {
  readonly name = "elevenlabs";
  readonly type = "tts" as const;

  private readonly apiKey: string | undefined;
  private readonly voiceId: string;
  private readonly modelId: string;
  private readonly baseUrl: string;
  private readonly outputFormat: string;
  private readonly voiceSettings: typeof DEFAULT_VOICE_SETTINGS;
  private readonly timeoutMs: number;

  constructor(config?: ElevenLabsProviderConfig) {
    this.apiKey = config?.apiKey;
    this.voiceId = config?.voiceId ?? DEFAULT_VOICE_ID;
    this.modelId = config?.modelId ?? DEFAULT_MODEL_ID;
    this.baseUrl = (config?.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.outputFormat = config?.outputFormat ?? DEFAULT_OUTPUT_FORMAT;
    this.voiceSettings = {
      ...DEFAULT_VOICE_SETTINGS,
      ...config?.voiceSettings,
    };
    this.timeoutMs = config?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(this.resolveApiKey());
  }

  async synthesize(text: string, options?: SynthesisOptions): Promise<SynthesisResult> {
    const apiKey = this.resolveApiKey();
    if (!apiKey) {
      throw new Error(
        "ElevenLabs API key not configured. Set ELEVENLABS_API_KEY or XI_API_KEY, or pass apiKey in config.",
      );
    }

    if (!isValidVoiceId(this.voiceId)) {
      throw new Error(`Invalid ElevenLabs voice ID: ${this.voiceId}`);
    }

    const startTime = Date.now();

    // Apply emotion-based voice settings
    let voiceSettings = { ...this.voiceSettings };
    if (options?.emotion) {
      const params = resolveEmotionParameters(options.emotion);
      const emotionSettings = toElevenLabsSettings(params);
      voiceSettings = {
        ...voiceSettings,
        stability: emotionSettings.stability,
        similarityBoost: emotionSettings.similarityBoost,
        style: emotionSettings.style,
        speed: emotionSettings.speed,
      };
    }

    if (options?.speed) {
      voiceSettings.speed = Math.max(0.5, Math.min(2.0, voiceSettings.speed * options.speed));
    }

    const outputFormat = this.resolveOutputFormat(options?.format);
    const url = new URL(`${this.baseUrl}/v1/text-to-speech/${this.voiceId}`);

    if (options?.stream) {
      url.pathname += "/stream";
    }

    url.searchParams.set("output_format", outputFormat);

    const requestBody = {
      text,
      model_id: this.modelId,
      voice_settings: {
        stability: voiceSettings.stability,
        similarity_boost: voiceSettings.similarityBoost,
        style: voiceSettings.style,
        use_speaker_boost: voiceSettings.useSpeakerBoost,
        speed: voiceSettings.speed,
      },
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url.toString(), {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        throw new Error(
          `ElevenLabs API error (${response.status}): ${errorText || response.statusText}`,
        );
      }

      // Handle streaming
      if (options?.stream && options.onChunk && response.body) {
        return this.handleStreamResponse(
          response,
          outputFormat,
          startTime,
          text.length,
          options.onChunk,
        );
      }

      const audio = Buffer.from(await response.arrayBuffer());

      return {
        audio,
        format: OUTPUT_FORMAT_AUDIO_FORMATS[outputFormat] ?? "mp3",
        sampleRate: OUTPUT_FORMAT_SAMPLE_RATES[outputFormat] ?? 44100,
        provider: "elevenlabs",
        latencyMs: Date.now() - startTime,
        inputLength: text.length,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private resolveApiKey(): string | undefined {
    return this.apiKey || process.env.ELEVENLABS_API_KEY || process.env.XI_API_KEY;
  }

  private resolveOutputFormat(format?: AudioFormat): string {
    if (!format) {
      return this.outputFormat;
    }
    switch (format) {
      case "mp3":
        return "mp3_44100_128";
      case "opus":
        return "opus_48000_64";
      case "ogg":
        return "opus_48000_64";
      case "pcm":
        return "pcm_24000";
      case "wav":
        return "pcm_22050";
      default:
        return this.outputFormat;
    }
  }

  private async handleStreamResponse(
    response: Response,
    outputFormat: string,
    startTime: number,
    inputLength: number,
    onChunk: (chunk: Buffer) => void,
  ): Promise<SynthesisResult> {
    const reader = response.body!.getReader();
    const chunks: Buffer[] = [];

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        const buffer = Buffer.from(value);
        chunks.push(buffer);
        onChunk(buffer);
      }
    } finally {
      reader.releaseLock();
    }

    return {
      audio: Buffer.concat(chunks),
      format: OUTPUT_FORMAT_AUDIO_FORMATS[outputFormat] ?? "mp3",
      sampleRate: OUTPUT_FORMAT_SAMPLE_RATES[outputFormat] ?? 44100,
      provider: "elevenlabs",
      latencyMs: Date.now() - startTime,
      inputLength,
    };
  }

  async dispose(): Promise<void> {
    // No persistent resources
  }
}
