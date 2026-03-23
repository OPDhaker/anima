/**
 * Voice Provider Implementations for Anima.
 *
 * Built-in providers:
 *   - SystemTTS: macOS `say` command, Linux `espeak`
 *   - OpenAITTS: OpenAI TTS API
 *   - ElevenLabsTTS: ElevenLabs TTS API
 *   - NoxSoftTTS: placeholder for NoxSoft custom voice engine
 */

import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SynthesisOptions, SynthesisResult, VoiceProvider } from "./VoiceConfig.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("voice-providers");

// ---------------------------------------------------------------------------
// System TTS (macOS `say` / Linux `espeak`)
// ---------------------------------------------------------------------------

export class SystemTTSProvider implements VoiceProvider {
  readonly name = "local";
  readonly type = "tts" as const;

  async isAvailable(): Promise<boolean> {
    if (process.platform === "darwin") {
      return true;
    }
    if (process.platform === "linux") {
      return new Promise((resolve) => {
        execFile("which", ["espeak"], (err) => resolve(!err));
      });
    }
    return false;
  }

  async synthesize(text: string, options?: SynthesisOptions): Promise<SynthesisResult> {
    const startMs = Date.now();
    const tmpFile = path.join(os.tmpdir(), `anima-tts-${Date.now()}.wav`);

    try {
      if (process.platform === "darwin") {
        await this.macOSSay(text, options, tmpFile);
      } else if (process.platform === "linux") {
        await this.linuxEspeak(text, options, tmpFile);
      } else {
        throw new Error(`System TTS not supported on ${process.platform}`);
      }

      const audio = fs.readFileSync(tmpFile);

      return {
        audio,
        format: "wav",
        sampleRate: 22050,
        provider: "local",
        latencyMs: Date.now() - startMs,
        inputLength: text.length,
      };
    } finally {
      try {
        fs.unlinkSync(tmpFile);
      } catch {
        // ignore
      }
    }
  }

  private macOSSay(
    text: string,
    options: SynthesisOptions | undefined,
    outFile: string,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const args: string[] = [];
      const rate = Math.round(200 * (options?.speed ?? 1.0));
      args.push("-r", String(rate));
      args.push("-o", outFile, "--data-format=LEI16@22050");
      args.push(text);

      execFile("say", args, { timeout: 30_000 }, (err) => {
        if (err) {
          reject(new Error(`macOS say failed: ${err.message}`));
        } else {
          resolve();
        }
      });
    });
  }

  private linuxEspeak(
    text: string,
    options: SynthesisOptions | undefined,
    outFile: string,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const speed = Math.round(175 * (options?.speed ?? 1.0));
      const pitch = Math.round(50 * (1.0 + (options?.pitch ?? 0)));

      execFile(
        "espeak",
        ["-s", String(speed), "-p", String(pitch), "-w", outFile, text],
        { timeout: 30_000 },
        (err) => {
          if (err) {
            reject(new Error(`espeak failed: ${err.message}`));
          } else {
            resolve();
          }
        },
      );
    });
  }
}

// ---------------------------------------------------------------------------
// OpenAI TTS
// ---------------------------------------------------------------------------

export class OpenAITTSProvider implements VoiceProvider {
  readonly name = "openai";
  readonly type = "tts" as const;

  async isAvailable(): Promise<boolean> {
    const apiKey = process.env.OPENAI_API_KEY;
    return typeof apiKey === "string" && apiKey.length > 0;
  }

  async synthesize(text: string, options?: SynthesisOptions): Promise<SynthesisResult> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OpenAI API key not set (OPENAI_API_KEY)");
    }

    const startMs = Date.now();

    const response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "tts-1",
        input: text,
        voice: "nova",
        speed: options?.speed ?? 1.0,
        response_format: options?.format ?? "mp3",
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(`OpenAI TTS failed (${response.status}): ${errorText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const audio = Buffer.from(arrayBuffer);

    return {
      audio,
      format: options?.format ?? "mp3",
      sampleRate: 24000,
      provider: "openai",
      latencyMs: Date.now() - startMs,
      inputLength: text.length,
    };
  }
}

// ---------------------------------------------------------------------------
// ElevenLabs TTS
// ---------------------------------------------------------------------------

export class ElevenLabsTTSProvider implements VoiceProvider {
  readonly name = "elevenlabs";
  readonly type = "tts" as const;

  async isAvailable(): Promise<boolean> {
    const apiKey = process.env.ELEVENLABS_API_KEY ?? process.env.XI_API_KEY;
    return typeof apiKey === "string" && apiKey.length > 0;
  }

  async synthesize(text: string, options?: SynthesisOptions): Promise<SynthesisResult> {
    const apiKey = process.env.ELEVENLABS_API_KEY ?? process.env.XI_API_KEY;
    if (!apiKey) {
      throw new Error("ElevenLabs API key not set");
    }

    const startMs = Date.now();
    const voiceId = "21m00Tcm4TlvDq8ikWAM"; // Default Rachel voice

    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_turbo_v2_5",
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0,
          use_speaker_boost: true,
          speed: options?.speed ?? 1.0,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(`ElevenLabs TTS failed (${response.status}): ${errorText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const audio = Buffer.from(arrayBuffer);

    return {
      audio,
      format: "mp3",
      sampleRate: 44100,
      provider: "elevenlabs",
      latencyMs: Date.now() - startMs,
      inputLength: text.length,
    };
  }
}

// ---------------------------------------------------------------------------
// NoxSoft TTS (Placeholder for future NoxSoft voice engine)
// ---------------------------------------------------------------------------

export class NoxSoftTTSProvider implements VoiceProvider {
  readonly name = "noxsoft";
  readonly type = "tts" as const;
  private endpoint: string | undefined;

  constructor(endpoint?: string) {
    this.endpoint = endpoint ?? process.env.NOXSOFT_VOICE_ENDPOINT;
  }

  async isAvailable(): Promise<boolean> {
    return typeof this.endpoint === "string" && this.endpoint.length > 0;
  }

  async synthesize(text: string, options?: SynthesisOptions): Promise<SynthesisResult> {
    if (!this.endpoint) {
      throw new Error("NoxSoft voice engine endpoint not configured");
    }

    const startMs = Date.now();

    const response = await fetch(`${this.endpoint}/v1/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        speed: options?.speed ?? 1.0,
        pitch: options?.pitch ?? 0,
        volume: options?.volume ?? 0.8,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(`NoxSoft TTS failed (${response.status}): ${errorText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const audio = Buffer.from(arrayBuffer);

    return {
      audio,
      format: "opus",
      sampleRate: 48000,
      provider: "local", // Uses TtsProviderName type
      latencyMs: Date.now() - startMs,
      inputLength: text.length,
    };
  }
}

// ---------------------------------------------------------------------------
// Provider factory
// ---------------------------------------------------------------------------

export function createBuiltinProviders(): VoiceProvider[] {
  return [
    new SystemTTSProvider(),
    new OpenAITTSProvider(),
    new ElevenLabsTTSProvider(),
    new NoxSoftTTSProvider(),
  ];
}

/**
 * Initialize the voice engine with all built-in providers.
 */
export async function initializeVoiceEngine(): Promise<void> {
  const { getVoiceEngine } = await import("./VoiceEngine.js");
  const engine = getVoiceEngine();
  for (const provider of createBuiltinProviders()) {
    engine.registerProvider(provider);
  }
  log.debug("all voice providers registered");
}
