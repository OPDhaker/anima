/**
 * Local Provider — Zero-dependency TTS fallback using macOS `say` command
 *
 * Uses the built-in macOS speech synthesis (NSSpeechSynthesizer via CLI).
 * No API keys, no downloads, no network required. Works on any Mac.
 *
 * Limitations:
 * - macOS only
 * - No STT capability
 * - Limited voice quality compared to neural TTS
 * - No streaming support
 */

import { execFile } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type {
  VoiceProvider,
  SynthesisOptions,
  SynthesisResult,
  LocalProviderConfig,
} from "../VoiceConfig.js";
import { resolveEmotionParameters, toMacOSSayRate } from "../EmotionVoiceMap.js";

const execFileAsync = promisify(execFile);

const DEFAULT_VOICE = "Samantha";
const DEFAULT_RATE = 175; // WPM
const SAY_BINARY = "/usr/bin/say";

export class LocalProvider implements VoiceProvider {
  readonly name = "local";
  readonly type = "tts" as const;

  private readonly voice: string;
  private readonly baseRate: number;

  constructor(config?: LocalProviderConfig) {
    this.voice = config?.voice ?? DEFAULT_VOICE;
    this.baseRate = config?.rate ?? DEFAULT_RATE;
  }

  async isAvailable(): Promise<boolean> {
    if (process.platform !== "darwin") {
      return false;
    }
    return existsSync(SAY_BINARY);
  }

  async synthesize(text: string, options?: SynthesisOptions): Promise<SynthesisResult> {
    if (process.platform !== "darwin") {
      throw new Error("LocalProvider requires macOS");
    }

    const startTime = Date.now();
    const tempDir = mkdtempSync(path.join(tmpdir(), "voice-local-"));
    const outputPath = path.join(tempDir, `speech-${Date.now()}.aiff`);

    try {
      // Resolve emotion parameters
      let rate = this.baseRate;
      if (options?.emotion) {
        const params = resolveEmotionParameters(options.emotion);
        rate = toMacOSSayRate(params, this.baseRate);
      }
      if (options?.speed) {
        rate = Math.round(rate * options.speed);
      }

      // Clamp rate to sane range
      rate = Math.max(80, Math.min(500, rate));

      const args: string[] = [
        "-v",
        this.voice,
        "-r",
        String(rate),
        "-o",
        outputPath,
        "--data-format=LEF32@22050",
        text,
      ];

      await execFileAsync(SAY_BINARY, args, {
        timeout: options?.speed ? 60_000 : 30_000,
      });

      if (!existsSync(outputPath)) {
        throw new Error("say command completed but produced no output file");
      }

      const audio = readFileSync(outputPath);

      return {
        audio,
        format: "aiff",
        sampleRate: 22050,
        provider: "local",
        latencyMs: Date.now() - startTime,
        inputLength: text.length,
      };
    } finally {
      // Clean up temp files after a delay
      setTimeout(() => {
        try {
          if (existsSync(outputPath)) {
            unlinkSync(outputPath);
          }
          const { rmdirSync } = require("node:fs");
          rmdirSync(tempDir);
        } catch {
          // ignore cleanup errors
        }
      }, 5000).unref();
    }
  }

  /**
   * List available macOS voices.
   */
  async listVoices(): Promise<Array<{ name: string; language: string }>> {
    if (process.platform !== "darwin") {
      return [];
    }

    try {
      const { stdout } = await execFileAsync(SAY_BINARY, ["-v", "?"]);
      const voices: Array<{ name: string; language: string }> = [];

      for (const line of stdout.split("\n")) {
        const match = line.match(/^(\S+)\s+(\S+)/);
        if (match) {
          voices.push({
            name: match[1],
            language: match[2],
          });
        }
      }

      return voices;
    } catch {
      return [];
    }
  }

  async dispose(): Promise<void> {
    // No resources to clean up
  }
}
