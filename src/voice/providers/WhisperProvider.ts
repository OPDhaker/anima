/**
 * Whisper STT Provider — Local speech-to-text using whisper.cpp
 *
 * Uses whisper.cpp (C++ port of OpenAI's Whisper) for fast, offline
 * speech-to-text transcription. Supports all Whisper model sizes.
 *
 * whisper.cpp: https://github.com/ggerganov/whisper.cpp
 * nodejs-whisper: https://www.npmjs.com/package/nodejs-whisper
 *
 * Model sizes and approximate VRAM/performance:
 *   tiny   —  39M params, ~1GB RAM,  fastest, lowest quality
 *   base   —  74M params, ~1GB RAM,  good for real-time
 *   small  — 244M params, ~2GB RAM,  good balance
 *   medium — 769M params, ~5GB RAM,  high quality
 *   large  — 1.5B params, ~10GB RAM, best quality
 *   turbo  — optimized large variant, faster inference
 *
 * The provider shells out to the whisper.cpp binary (main or whisper-cpp)
 * and parses its text output. Audio is converted to 16kHz WAV if needed.
 *
 * License: MIT (whisper.cpp), MIT (Whisper model weights)
 */

import { execFile, spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdtempSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type {
  VoiceProvider,
  TranscriptionOptions,
  TranscriptionResult,
  TranscriptionSegment,
  WhisperProviderConfig,
  WhisperModelSize,
} from "../VoiceConfig.js";

const execFileAsync = promisify(execFile);

const DEFAULT_MODEL_SIZE: WhisperModelSize = "base";

const MODEL_FILES: Record<WhisperModelSize, string> = {
  tiny: "ggml-tiny.bin",
  base: "ggml-base.bin",
  small: "ggml-small.bin",
  medium: "ggml-medium.bin",
  large: "ggml-large-v3.bin",
  turbo: "ggml-large-v3-turbo.bin",
};

const DEFAULT_BINARY_PATHS = [
  "/usr/local/bin/whisper-cpp",
  "/usr/local/bin/whisper",
  "/usr/local/bin/main", // whisper.cpp default binary name
  "/opt/homebrew/bin/whisper-cpp",
  "/opt/homebrew/bin/whisper",
  path.join(process.env.HOME ?? "~", ".local", "bin", "whisper-cpp"),
  path.join(process.env.HOME ?? "~", ".local", "bin", "whisper"),
];

const DEFAULT_MODEL_DIRS = [
  path.join(process.env.HOME ?? "~", ".local", "share", "whisper"),
  path.join(process.env.HOME ?? "~", ".cache", "whisper"),
  path.join(process.env.HOME ?? "~", "models", "whisper"),
  "/usr/local/share/whisper",
];

export class WhisperProvider implements VoiceProvider {
  readonly name = "whisper-local";
  readonly type = "stt" as const;

  private readonly binaryPath: string | undefined;
  private readonly modelSize: WhisperModelSize;
  private readonly modelDir: string | undefined;
  private readonly language: string;
  private readonly translate: boolean;
  private readonly threads: number;
  private readonly maxLen: number;

  constructor(config?: WhisperProviderConfig) {
    this.binaryPath = config?.binaryPath;
    this.modelSize = config?.modelSize ?? DEFAULT_MODEL_SIZE;
    this.modelDir = config?.modelDir;
    this.language = config?.language ?? "en";
    this.translate = config?.translate ?? false;
    this.threads =
      config?.threads ?? Math.max(1, Math.min(8, (require("node:os").cpus()?.length ?? 4) - 1));
    this.maxLen = config?.maxLen ?? 0;
  }

  async isAvailable(): Promise<boolean> {
    const binary = await this.resolveBinary();
    if (!binary) {
      return false;
    }
    const modelPath = this.resolveModelPath();
    return modelPath != null;
  }

  async transcribe(audio: Buffer, options?: TranscriptionOptions): Promise<TranscriptionResult> {
    const binary = await this.resolveBinary();
    if (!binary) {
      throw new Error(
        "whisper.cpp binary not found. Install from https://github.com/ggerganov/whisper.cpp",
      );
    }

    const modelPath = this.resolveModelPath();
    if (!modelPath) {
      throw new Error(
        `Whisper model '${MODEL_FILES[this.modelSize]}' not found. ` +
          `Download from https://huggingface.co/ggerganov/whisper.cpp/tree/main`,
      );
    }

    const startTime = Date.now();
    const tempDir = mkdtempSync(path.join(tmpdir(), "voice-whisper-"));
    const inputPath = path.join(tempDir, `input-${Date.now()}.wav`);
    const outputPath = path.join(tempDir, `output-${Date.now()}`);

    try {
      // Write audio buffer to temp file
      // If the audio is raw PCM, wrap it in a WAV header
      const wavAudio = this.ensureWavFormat(audio);
      writeFileSync(inputPath, wavAudio);

      // Convert to 16kHz mono WAV if needed (whisper.cpp requirement)
      const convertedPath = await this.convertTo16kHz(inputPath, tempDir);
      const finalInputPath = convertedPath ?? inputPath;

      const language = options?.language ?? this.language;
      const translate = options?.translate ?? this.translate;

      const args: string[] = [
        "-m",
        modelPath,
        "-f",
        finalInputPath,
        "-l",
        language,
        "-t",
        String(this.threads),
        "--no-timestamps",
        "-otxt",
        "-of",
        outputPath,
      ];

      if (translate) {
        args.push("--translate");
      }

      if (options?.prompt) {
        args.push("--prompt", options.prompt);
      }

      if (this.maxLen > 0) {
        args.push("--max-len", String(this.maxLen));
      }

      // For timestamps, use a different output format
      const wantTimestamps = options?.timestamps ?? false;
      if (wantTimestamps) {
        // Remove --no-timestamps and add JSON output
        const noTsIdx = args.indexOf("--no-timestamps");
        if (noTsIdx !== -1) {
          args.splice(noTsIdx, 1);
        }
      }

      await execFileAsync(binary, args, {
        timeout: 120_000, // 2 minutes for large files
      });

      // Read transcription output
      const txtPath = `${outputPath}.txt`;
      if (!existsSync(txtPath)) {
        throw new Error("whisper.cpp produced no output");
      }

      let text = readFileSync(txtPath, "utf8").trim();

      // Parse segments with timestamps if requested
      let segments: TranscriptionSegment[] | undefined;
      if (wantTimestamps) {
        segments = this.parseTimestampedOutput(text);
        // Clean text by removing timestamps
        text = segments
          .map((s) => s.text)
          .join(" ")
          .trim();
      }

      return {
        text,
        language,
        provider: "whisper-local",
        latencyMs: Date.now() - startTime,
        segments,
      };
    } finally {
      // Clean up temp files
      setTimeout(() => {
        try {
          for (const file of [inputPath, `${outputPath}.txt`]) {
            if (existsSync(file)) {
              unlinkSync(file);
            }
          }
          // Also remove any converted file
          const convertedPath = path.join(tempDir, "input-16k.wav");
          if (existsSync(convertedPath)) {
            unlinkSync(convertedPath);
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

  private async resolveBinary(): Promise<string | undefined> {
    if (this.binaryPath) {
      return existsSync(this.binaryPath) ? this.binaryPath : undefined;
    }

    for (const candidate of DEFAULT_BINARY_PATHS) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }

    // Try PATH
    for (const name of ["whisper-cpp", "whisper", "main"]) {
      try {
        const { stdout } = await execFileAsync("which", [name]);
        const resolved = stdout.trim();
        if (resolved && existsSync(resolved)) {
          return resolved;
        }
      } catch {
        // continue
      }
    }

    return undefined;
  }

  private resolveModelPath(): string | undefined {
    const fileName = MODEL_FILES[this.modelSize];
    if (!fileName) {
      return undefined;
    }

    const dirs = this.modelDir ? [this.modelDir, ...DEFAULT_MODEL_DIRS] : DEFAULT_MODEL_DIRS;

    for (const dir of dirs) {
      const candidate = path.join(dir, fileName);
      if (existsSync(candidate)) {
        return candidate;
      }
    }

    return undefined;
  }

  /**
   * Ensure audio data has a WAV header.
   * If the buffer starts with "RIFF", it's already WAV.
   * Otherwise, wrap raw PCM in a minimal WAV header (16kHz mono 16-bit).
   */
  private ensureWavFormat(audio: Buffer): Buffer {
    if (audio.length >= 4 && audio.toString("ascii", 0, 4) === "RIFF") {
      return audio;
    }

    // Assume raw PCM: 16-bit signed, 16kHz, mono
    const sampleRate = 16000;
    const channels = 1;
    const bitsPerSample = 16;
    const byteRate = sampleRate * channels * (bitsPerSample / 8);
    const blockAlign = channels * (bitsPerSample / 8);
    const dataSize = audio.length;
    const headerSize = 44;

    const header = Buffer.alloc(headerSize);
    header.write("RIFF", 0);
    header.writeUInt32LE(dataSize + headerSize - 8, 4);
    header.write("WAVE", 8);
    header.write("fmt ", 12);
    header.writeUInt32LE(16, 16); // PCM chunk size
    header.writeUInt16LE(1, 20); // PCM format
    header.writeUInt16LE(channels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitsPerSample, 34);
    header.write("data", 36);
    header.writeUInt32LE(dataSize, 40);

    return Buffer.concat([header, audio]);
  }

  /**
   * Convert audio to 16kHz mono WAV using ffmpeg or sox if available.
   * Returns the path to the converted file, or null if conversion was skipped.
   */
  private async convertTo16kHz(inputPath: string, tempDir: string): Promise<string | null> {
    const outputPath = path.join(tempDir, "input-16k.wav");

    // Try ffmpeg first
    try {
      await execFileAsync(
        "ffmpeg",
        ["-y", "-i", inputPath, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", outputPath],
        { timeout: 30_000 },
      );

      if (existsSync(outputPath)) {
        return outputPath;
      }
    } catch {
      // ffmpeg not available
    }

    // Try sox
    try {
      await execFileAsync("sox", [inputPath, "-r", "16000", "-c", "1", "-b", "16", outputPath], {
        timeout: 30_000,
      });

      if (existsSync(outputPath)) {
        return outputPath;
      }
    } catch {
      // sox not available
    }

    // No conversion tool available — hope the input is already compatible
    return null;
  }

  /**
   * Parse whisper.cpp timestamped output.
   * Format: [00:00:00.000 --> 00:00:02.500]  Hello world
   */
  private parseTimestampedOutput(rawOutput: string): TranscriptionSegment[] {
    const segments: TranscriptionSegment[] = [];
    const regex = /\[(\d{2}:\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}\.\d{3})\]\s*(.+)/g;

    let match: RegExpExecArray | null;
    while ((match = regex.exec(rawOutput)) !== null) {
      segments.push({
        start: this.parseTimestamp(match[1]),
        end: this.parseTimestamp(match[2]),
        text: match[3].trim(),
      });
    }

    return segments;
  }

  private parseTimestamp(ts: string): number {
    const parts = ts.split(":");
    if (parts.length !== 3) {
      return 0;
    }
    const hours = parseInt(parts[0], 10);
    const minutes = parseInt(parts[1], 10);
    const seconds = parseFloat(parts[2]);
    return hours * 3600 + minutes * 60 + seconds;
  }

  async dispose(): Promise<void> {
    // No persistent resources
  }
}
