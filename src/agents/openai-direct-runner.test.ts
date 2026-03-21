import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../auto-reply/heartbeat.js", () => ({
  resolveHeartbeatPrompt: vi.fn(() => undefined),
}));

vi.mock("./agent-scope.js", () => ({
  resolveSessionAgentIds: vi.fn(() => ({ defaultAgentId: "main", sessionAgentId: "main" })),
}));

vi.mock("./bootstrap-files.js", () => ({
  resolveBootstrapContextForRun: vi.fn(async () => ({ contextFiles: [] })),
  makeBootstrapWarn: vi.fn(() => () => {}),
}));

vi.mock("./cli-runner/helpers.js", () => ({
  buildSystemPrompt: vi.fn(() => "system"),
}));

vi.mock("./docs-path.js", () => ({
  resolveAnimaDocsPath: vi.fn(async () => undefined),
}));

vi.mock("./pi-tools.js", () => ({
  createAnimaCodingTools: vi.fn(() => [
    {
      name: "echo_tool",
      description: "echoes",
      parameters: { type: "object", properties: {} },
      execute: vi.fn(async () => "tool-ok"),
    },
  ]),
}));

vi.mock("./runner-capabilities.js", () => ({
  appendRunnerCapabilityPrompt: vi.fn((prompt?: string) => prompt ?? ""),
}));

vi.mock("./workspace-run.js", () => ({
  resolveRunWorkspaceDir: vi.fn((params: { workspaceDir: string }) => ({
    workspaceDir: params.workspaceDir,
  })),
}));

describe("runOpenAIDirectAgent", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("retries without tools when the provider rejects tool support", async () => {
    const { runOpenAIDirectAgent } = await import("./openai-direct-runner.js");
    const requests: Array<Record<string, unknown>> = [];

    global.fetch = vi
      .fn()
      .mockImplementationOnce(async (_input: RequestInfo | URL, init?: RequestInit) => {
        requests.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
        return new Response(
          JSON.stringify({
            error: { message: "registry.ollama.ai/library/test:latest does not support tools" },
          }),
          { status: 400, headers: { "content-type": "application/json" } },
        );
      })
      .mockImplementationOnce(async (_input: RequestInfo | URL, init?: RequestInit) => {
        requests.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                'data: {"choices":[{"delta":{"content":"LOCAL_OK"}}]}\n\ndata: [DONE]\n\n',
              ),
            );
            controller.close();
          },
        });
        return new Response(stream, { status: 200 });
      }) as typeof fetch;

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "anima-openai-direct-"));

    try {
      const result = await runOpenAIDirectAgent({
        apiKey: "",
        provider: "ollama",
        sessionId: "s1",
        sessionFile: path.join(dir, "session.jsonl"),
        workspaceDir: dir,
        prompt: "Reply with exactly LOCAL_OK",
        model: "test:latest",
        timeoutMs: 30_000,
        runId: "r1",
      });

      expect(result.status).toBe("completed");
      expect(result.output).toBe("LOCAL_OK");
      expect(requests).toHaveLength(2);
      expect(requests[0]?.tools).toBeDefined();
      expect(requests[1]?.tools).toBeUndefined();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
