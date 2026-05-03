/**
 * Session Spawner — spawns Claude Code CLI sessions via execFile.
 *
 * This is the core execution primitive: take a prompt, build CLI args,
 * spawn a claude process, collect results.
 *
 * Security: Uses execFile (not exec) to prevent shell injection.
 */

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";

export interface SessionResult {
  id: string;
  status: "completed" | "failed" | "timeout";
  output: string;
  tokensUsed?: number;
  costUsd?: number;
  durationMs: number;
  exitCode: number;
}

export interface SpawnOptions {
  prompt: string;
  model?: string;
  maxBudgetUsd?: number;
  timeoutMs?: number;
  systemPrompt?: string;
  workingDirectory?: string;
  outputFormat?: "text" | "json" | "stream-json";
  allowedTools?: string[];
  dangerouslySkipPermissions?: boolean;
}

/**
 * Generate a unique session ID.
 */
function generateSessionId(): string {
  return `session_${randomUUID()}`;
}

/**
 * Build CLI argument array from SpawnOptions.
 */
function buildArgs(options: SpawnOptions): string[] {
  const args: string[] = ["-p", options.prompt, "--output-format", options.outputFormat || "json"];

  if (options.model) {
    args.push("--model", options.model);
  }

  if (options.maxBudgetUsd) {
    args.push("--max-budget-usd", String(options.maxBudgetUsd));
  }

  if (options.systemPrompt) {
    args.push("--system-prompt", options.systemPrompt);
  }

  if (options.allowedTools) {
    args.push("--allowedTools", ...options.allowedTools);
  }

  if (options.dangerouslySkipPermissions) {
    args.push("--dangerously-skip-permissions");
  }

  return args;
}

/**
 * Parse JSON output from Claude CLI, extracting cost/token info if available.
 */
function parseOutput(stdout: string): {
  output: string;
  costUsd?: number;
  tokensUsed?: number;
} {
  try {
    const parsed = JSON.parse(stdout) as {
      result?: string;
      cost_usd?: number;
      total_tokens?: number;
    };
    return {
      output: parsed.result || stdout,
      costUsd: parsed.cost_usd,
      tokensUsed: parsed.total_tokens,
    };
  } catch {
    // Text output or unparseable JSON — use as-is
    return { output: stdout };
  }
}

/**
 * Spawn a Claude Code CLI session.
 *
 * Returns a promise that resolves with the session result,
 * including output, cost, duration, and status.
 */
export function spawnSession(options: SpawnOptions): Promise<SessionResult> {
  const startTime = Date.now();
  const sessionId = generateSessionId();
  const args = buildArgs(options);

  return new Promise((resolve) => {
    execFile(
      "claude",
      args,
      {
        cwd: options.workingDirectory,
        timeout: options.timeoutMs || 600_000, // 10 min default
        maxBuffer: 50 * 1024 * 1024, // 50MB
        env: (() => {
          const e = { ...process.env };
          // Clear CLAUDECODE so nested claude sessions don't refuse to start.
          delete e.CLAUDECODE;
          return e;
        })(),
      },
      (error, stdout, _stderr) => {
        const durationMs = Date.now() - startTime;

        let exitCode = 0;
        if (error) {
          // error.code can be string (like 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER')
          // or the exit code as a number
          exitCode =
            typeof error.code === "number"
              ? error.code
              : error.killed
                ? 124 // Standard timeout exit code
                : 1;
        }

        const { output, costUsd, tokensUsed } = parseOutput(stdout);

        const status: SessionResult["status"] = error
          ? error.killed
            ? "timeout"
            : "failed"
          : "completed";

        resolve({
          id: sessionId,
          status,
          output,
          tokensUsed,
          costUsd,
          durationMs,
          exitCode,
        });
      },
    );
  });
}
