/**
 * OpenAI Voice Provider — TTS and STT via OpenAI API
 *
 * TTS Models:
 *   - gpt-4o-mini-tts: Latest, most expressive, supports instructions
 *   - tts-1: Fast, good quality
 *   - tts-1-hd: Higher quality, slightly slower
 *
 * TTS Voices:
 *   alloy, ash, ballad, cedar, coral, echo, fable, juniper, marin,
 *   onyx, nova, sage, shimmer, verse
 *
 * STT Models:
 *   - whisper-1: General purpose transcription
 *   - gpt-4o-transcribe: Higher quality, supports prompting
 *   - gpt-4o-mini-transcribe: Fast, lower cost
 *
 * Supports custom OpenAI-compatible endpoints (Kokoro, LocalAI, etc.)
 * via the OPENAI_TTS_BASE_URL environment variable or config.baseUrl.
 *
 * License: Proprietary API (usage requires API key and billing)
 */

import { mkdtempSync, writeFileSync, readFileSync, unlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type {
  VoiceProvider,
  SynthesisOptions,
  SynthesisResult,
  TranscriptionOptions,
  TranscriptionResult,
  OpenAIProviderConfig,
  AudioFormat,
} from "../VoiceConfig.js";
import { resolveEmotionParameters, toOpenAISpeed } from "../EmotionVoiceMap.js";

const DEFAULT_TTS_MODEL = "gpt-4o-mini-tts";
const DEFAULT_TTS_VOICE = "alloy";
const DEFAULT_STT_MODEL = "whisper-1";
const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_RESPONSE_FORMAT: "mp3" | "opus" | "pcm" = "mp3";
const DEFAULT_TIMEOUT_MS = 30_000;

const VALID_VOICES = new Set([
  "alloy",
  "ash",
  "ballad",
  "cedar",
  "coral",
  "echo",
  "fable",
  "juniper",
  "marin",
  "onyx",
  "nova",
  "sage",
  "shimmer",
  "verse",
]);

const FORMAT_TO_MIME: Record<string, string> = {
  mp3: "audio/mpeg",
  opus: "audio/opus",
  pcm: "audio/pcm",
};

const FORMAT_SAMPLE_RATES: Record<string, number> = {
  mp3: 44100,
  opus: 48000,
  pcm: 24000,
};

export class OpenAIProvider implements VoiceProvider {
  readonly name = "openai";
  readonly type = "both" as const;

  private readonly apiKey: string | undefined;
  private readonly ttsModel: string;
  private readonly ttsVoice: string;
  private readonly sttModel: string;
  private readonly baseUrl: string;
  private readonly responseFormat: "mp3" | "opus" | "pcm";
  private readonly timeoutMs: number;

  constructor(config?: OpenAIProviderConfig) {
    this.apiKey = config?.apiKey;
    this.ttsModel = config?.ttsModel ?? DEFAULT_TTS_MODEL;
    this.ttsVoice = config?.ttsVoice ?? DEFAULT_TTS_VOICE;
    this.sttModel = config?.sttModel ?? DEFAULT_STT_MODEL;
    this.baseUrl = (config?.baseUrl ?? process.env.OPENAI_TTS_BASE_URL ?? DEFAULT_BASE_URL).replace(
      /\/+$/,
      "",
    );
    this.responseFormat = config?.responseFormat ?? DEFAULT_RESPONSE_FORMAT;
    this.timeoutMs = config?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(this.resolveApiKey());
  }

  async synthesize(text: string, options?: SynthesisOptions): Promise<SynthesisResult> {
    const apiKey = this.resolveApiKey();
    if (!apiKey) {
      throw new Error(
        "OpenAI API key not configured. Set OPENAI_API_KEY or pass apiKey in config.",
      );
    }

    const startTime = Date.now();

    // Compute speed from emotion parameters
    let speed = 1.0;
    if (options?.emotion) {
      const params = resolveEmotionParameters(options.emotion);
      speed = toOpenAISpeed(params);
    }
    if (options?.speed) {
      speed = Math.max(0.25, Math.min(4.0, speed * options.speed));
    }

    const format = this.mapFormat(options?.format) ?? this.responseFormat;

    const body: Record<string, unknown> = {
      model: this.ttsModel,
      input: text,
      voice: this.ttsVoice,
      response_format: format,
      speed,
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/audio/speech`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        throw new Error(
          `OpenAI TTS API error (${response.status}): ${errorText || response.statusText}`,
        );
      }

      // Handle streaming
      if (options?.stream && options.onChunk && response.body) {
        return this.handleStreamResponse(response, format, startTime, text.length, options.onChunk);
      }

      const audio = Buffer.from(await response.arrayBuffer());

      return {
        audio,
        format: format as AudioFormat,
        sampleRate: FORMAT_SAMPLE_RATES[format] ?? 44100,
        provider: "openai",
        latencyMs: Date.now() - startTime,
        inputLength: text.length,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async transcribe(audio: Buffer, options?: TranscriptionOptions): Promise<TranscriptionResult> {
    const apiKey = this.resolveApiKey();
    if (!apiKey) {
      throw new Error(
        "OpenAI API key not configured. Set OPENAI_API_KEY or pass apiKey in config.",
      );
    }

    const startTime = Date.now();

    // Write audio to temp file (OpenAI API requires file upload)
    const tempDir = mkdtempSync(path.join(tmpdir(), "voice-openai-stt-"));
    const audioPath = path.join(tempDir, `audio-${Date.now()}.wav`);

    try {
      writeFileSync(audioPath, audio);

      const formData = new FormData();
      const blob = new Blob([audio], { type: "audio/wav" });
      formData.append("file", blob, "audio.wav");
      formData.append("model", this.sttModel);

      if (options?.language) {
        formData.append("language", options.language);
      }

      if (options?.prompt) {
        formData.append("prompt", options.prompt);
      }

      if (options?.timestamps) {
        formData.append("response_format", "verbose_json");
        formData.append("timestamp_granularities[]", "segment");
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs * 2);

      try {
        const response = await fetch(`${this.baseUrl}/audio/transcriptions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
          body: formData,
          signal: controller.signal,
        });

        if (!response.ok) {
          const errorText = await response.text().catch(() => "");
          throw new Error(
            `OpenAI STT API error (${response.status}): ${errorText || response.statusText}`,
          );
        }

        if (options?.timestamps) {
          const result = (await response.json()) as {
            text: string;
            language: string;
            segments?: Array<{
              text: string;
              start: number;
              end: number;
            }>;
          };

          return {
            text: result.text.trim(),
            language: result.language ?? options?.language ?? "en",
            provider: "whisper-api",
            latencyMs: Date.now() - startTime,
            segments: result.segments?.map((s) => ({
              text: s.text.trim(),
              start: s.start,
              end: s.end,
            })),
          };
        }

        const result = (await response.json()) as { text: string };

        return {
          text: result.text.trim(),
          language: options?.language ?? "en",
          provider: "whisper-api",
          latencyMs: Date.now() - startTime,
        };
      } finally {
        clearTimeout(timeout);
      }
    } finally {
      // Clean up
      setTimeout(() => {
        try {
          if (existsSync(audioPath)) {
            unlinkSync(audioPath);
          }
          const { rmdirSync } = require("node:fs");
          rmdirSync(tempDir);
        } catch {
          // ignore
        }
      }, 5000).unref();
    }
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private resolveApiKey(): string | undefined {
    return this.apiKey || process.env.OPENAI_API_KEY;
  }

  private mapFormat(format?: AudioFormat): "mp3" | "opus" | "pcm" | undefined {
    if (!format) {
      return undefined;
    }
    switch (format) {
      case "mp3":
        return "mp3";
      case "opus":
        return "opus";
      case "ogg":
        return "opus";
      case "pcm":
        return "pcm";
      case "wav":
        return "pcm";
      default:
        return undefined;
    }
  }

  private async handleStreamResponse(
    response: Response,
    format: string,
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
      format: format as AudioFormat,
      sampleRate: FORMAT_SAMPLE_RATES[format] ?? 44100,
      provider: "openai",
      latencyMs: Date.now() - startTime,
      inputLength,
    };
  }

  async dispose(): Promise<void> {
    // No persistent resources
  }
}
