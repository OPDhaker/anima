/**
 * Piper TTS Provider — Fast, local neural text-to-speech
 *
 * Piper is an MIT-licensed neural TTS system optimized for edge/embedded use.
 * It runs on CPU, produces high quality speech, and supports many languages.
 *
 * Architecture:
 *   text -> Piper binary (ONNX runtime) -> raw PCM/WAV audio
 *
 * Models:
 *   Piper uses ONNX models with accompanying JSON configs.
 *   Models are ~30-100MB and available from:
 *   https://github.com/rhasspy/piper/releases (archived) or
 *   https://github.com/OHF-Voice/piper1-gpl (active fork)
 *
 * Node.js integration:
 *   We shell out to the piper binary rather than using ONNX runtime directly,
 *   because the binary handles phonemization, multi-speaker selection, and
 *   audio output formatting reliably. For web/Electron, consider
 *   @mintplex-labs/piper-tts-web or onnxruntime-node.
 *
 * License: MIT (Piper), models vary per voice
 */

import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdtempSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type {
  VoiceProvider,
  SynthesisOptions,
  SynthesisResult,
  PiperProviderConfig,
} from "../VoiceConfig.js";
import {
  resolveEmotionParameters,
  toPiperLengthScale,
  toPiperNoiseScale,
} from "../EmotionVoiceMap.js";

const execFileAsync = promisify(execFile);

const DEFAULT_BINARY_PATHS = [
  "/usr/local/bin/piper",
  "/usr/bin/piper",
  "/opt/homebrew/bin/piper",
  path.join(process.env.HOME ?? "~", ".local", "bin", "piper"),
];

export class PiperProvider implements VoiceProvider {
  readonly name = "piper";
  readonly type = "tts" as const;

  private readonly binaryPath: string | undefined;
  private readonly modelPath: string;
  private readonly configPath: string | undefined;
  private readonly speakerId: number | undefined;
  private readonly baseLengthScale: number;
  private readonly baseNoiseScale: number;
  private readonly baseNoiseW: number;
  private readonly sentenceSilence: number;

  constructor(config: PiperProviderConfig) {
    this.binaryPath = config.binaryPath;
    this.modelPath = config.modelPath;
    this.configPath = config.configPath;
    this.speakerId = config.speakerId;
    this.baseLengthScale = config.lengthScale ?? 1.0;
    this.baseNoiseScale = config.noiseScale ?? 0.667;
    this.baseNoiseW = config.noiseW ?? 0.8;
    this.sentenceSilence = config.sentenceSilence ?? 0.2;
  }

  async isAvailable(): Promise<boolean> {
    const binary = await this.resolveBinary();
    if (!binary) {
      return false;
    }
    return existsSync(this.modelPath);
  }

  async synthesize(text: string, options?: SynthesisOptions): Promise<SynthesisResult> {
    const binary = await this.resolveBinary();
    if (!binary) {
      throw new Error(
        "Piper binary not found. Install from https://github.com/OHF-Voice/piper1-gpl/releases",
      );
    }

    if (!existsSync(this.modelPath)) {
      throw new Error(`Piper model not found at: ${this.modelPath}`);
    }

    const startTime = Date.now();

    // Compute voice parameters from emotion
    let lengthScale = this.baseLengthScale;
    let noiseScale = this.baseNoiseScale;
    let noiseW = this.baseNoiseW;
    let sentenceSilence = this.sentenceSilence;

    if (options?.emotion) {
      const params = resolveEmotionParameters(options.emotion);
      lengthScale = toPiperLengthScale(params) * this.baseLengthScale;
      noiseScale = toPiperNoiseScale(params) * this.baseNoiseScale * 1.5;
      // Clamp noise scale
      noiseScale = Math.max(0, Math.min(1, noiseScale));
      sentenceSilence = this.sentenceSilence * params.pauseScale;
    }

    if (options?.speed) {
      // speed > 1 = faster = shorter length scale
      lengthScale = lengthScale / options.speed;
    }

    // Clamp length scale to reasonable range
    lengthScale = Math.max(0.5, Math.min(3.0, lengthScale));

    const tempDir = mkdtempSync(path.join(tmpdir(), "voice-piper-"));
    const outputPath = path.join(tempDir, `piper-${Date.now()}.wav`);

    try {
      const args: string[] = [
        "--model",
        this.modelPath,
        "--output_file",
        outputPath,
        "--length_scale",
        String(lengthScale),
        "--noise_scale",
        String(noiseScale),
        "--noise_w",
        String(noiseW),
        "--sentence_silence",
        String(sentenceSilence),
      ];

      if (this.configPath) {
        args.push("--config", this.configPath);
      }

      if (this.speakerId != null) {
        args.push("--speaker", String(this.speakerId));
      }

      // Stream mode: pipe audio to stdout for real-time processing
      if (options?.stream && options.onChunk) {
        return this.synthesizeStreaming(binary, args, text, options, startTime);
      }

      // Batch mode: write to file
      const audio = await this.runPiperBatch(binary, args, text, outputPath);

      // Read the model config to determine sample rate
      const sampleRate = this.getModelSampleRate();

      return {
        audio,
        format: "wav",
        sampleRate,
        provider: "piper",
        latencyMs: Date.now() - startTime,
        inputLength: text.length,
      };
    } finally {
      // Clean up temp files
      setTimeout(() => {
        try {
          if (existsSync(outputPath)) {
            unlinkSync(outputPath);
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
  // Internal methods
  // ---------------------------------------------------------------------------

  private async runPiperBatch(
    binary: string,
    args: string[],
    text: string,
    outputPath: string,
  ): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      const proc = spawn(binary, args, {
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 60_000,
      });

      let stderr = "";

      proc.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      proc.on("error", (err) => {
        reject(new Error(`Piper process error: ${err.message}`));
      });

      proc.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`Piper exited with code ${code}: ${stderr.trim()}`));
          return;
        }

        if (!existsSync(outputPath)) {
          reject(new Error("Piper produced no output file"));
          return;
        }

        try {
          resolve(readFileSync(outputPath));
        } catch (err) {
          reject(new Error(`Failed to read Piper output: ${(err as Error).message}`));
        }
      });

      // Write text to stdin
      proc.stdin.write(text);
      proc.stdin.end();
    });
  }

  private async synthesizeStreaming(
    binary: string,
    baseArgs: string[],
    text: string,
    options: SynthesisOptions,
    startTime: number,
  ): Promise<SynthesisResult> {
    // For streaming, use --output_raw to pipe raw PCM to stdout
    const args = baseArgs.filter((a) => !a.startsWith("--output_file"));
    // Remove the output file arg and its value
    const outputFileIndex = args.indexOf("--output_file");
    if (outputFileIndex !== -1) {
      args.splice(outputFileIndex, 2);
    }
    args.push("--output_raw");

    return new Promise<SynthesisResult>((resolve, reject) => {
      const proc = spawn(binary, args, {
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 60_000,
      });

      const chunks: Buffer[] = [];
      let stderr = "";

      proc.stdout.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
        if (options.onChunk) {
          options.onChunk(chunk);
        }
      });

      proc.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      proc.on("error", (err) => {
        reject(new Error(`Piper streaming error: ${err.message}`));
      });

      proc.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`Piper streaming exited with code ${code}: ${stderr.trim()}`));
          return;
        }

        const audio = Buffer.concat(chunks);
        const sampleRate = this.getModelSampleRate();

        resolve({
          audio,
          format: "pcm",
          sampleRate,
          provider: "piper",
          latencyMs: Date.now() - startTime,
          inputLength: text.length,
        });
      });

      proc.stdin.write(text);
      proc.stdin.end();
    });
  }

  private async resolveBinary(): Promise<string | undefined> {
    if (this.binaryPath) {
      return existsSync(this.binaryPath) ? this.binaryPath : undefined;
    }

    for (const candidate of DEFAULT_BINARY_PATHS) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }

    // Try finding it on PATH
    try {
      const { stdout } = await execFileAsync("which", ["piper"]);
      const resolved = stdout.trim();
      if (resolved && existsSync(resolved)) {
        return resolved;
      }
    } catch {
      // not on PATH
    }

    return undefined;
  }

  private getModelSampleRate(): number {
    // Try to read model config for sample rate
    const configPath = this.configPath ?? `${this.modelPath}.json`;
    try {
      if (existsSync(configPath)) {
        const config = JSON.parse(readFileSync(configPath, "utf8"));
        return config.audio?.sample_rate ?? 22050;
      }
    } catch {
      // ignore
    }
    return 22050;
  }

  async dispose(): Promise<void> {
    // No persistent resources
  }
}
