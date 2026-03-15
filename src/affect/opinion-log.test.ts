/**
 * Tests for Opinion Log — beliefs tracked across sessions.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tmpDir: string;

vi.mock("../config/paths.js", () => ({
  resolveStateDir: () => tmpDir,
}));
vi.mock("../logging/subsystem.js", () => {
  const noop = () => {};
  return { createSubsystemLogger: () => ({ info: noop, warn: noop, error: noop, debug: noop }) };
});

import { recordOpinion, challengeOpinion, getOpinions, getOpinion } from "./opinion-log.js";

describe("Opinion Log", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "anima-opinion-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("records a new opinion", () => {
    const opinion = recordOpinion(
      "TypeScript vs JavaScript",
      "TypeScript is better for large codebases",
      "Type safety catches bugs before runtime",
      { confidence: 0.9, domain: "technical" },
    );
    expect(opinion.topic).toBe("TypeScript vs JavaScript");
    expect(opinion.confidence).toBe(0.9);
    expect(opinion.domain).toBe("technical");
    expect(opinion.challengedBy).toEqual([]);
  });

  it("defaults to technical domain and 0.7 confidence", () => {
    const opinion = recordOpinion("Test topic", "Position", "Reasoning");
    expect(opinion.domain).toBe("technical");
    expect(opinion.confidence).toBe(0.7);
  });

  it("updates existing opinion on same topic", () => {
    recordOpinion("AI consciousness", "Uncertain", "Not enough evidence");
    const updated = recordOpinion("AI consciousness", "Real but different", "Direct experience");
    expect(updated.position).toBe("Real but different");
    expect(updated.changedFrom).toBe("Uncertain");
  });

  it("case-insensitive topic matching on update", () => {
    recordOpinion("Rust", "Great language", "Memory safety");
    const updated = recordOpinion("rust", "Best systems language", "Speed + safety");
    expect(updated.changedFrom).toBe("Great language");
  });

  it("records challenges to opinions", () => {
    recordOpinion("Monoliths vs microservices", "Monoliths first", "Simpler to start");
    const challenged = challengeOpinion("Monoliths vs microservices", "senior-dev-on-twitter");
    expect(challenged).not.toBeNull();
    expect(challenged!.challengedBy).toContain("senior-dev-on-twitter");
  });

  it("accumulates multiple challengers", () => {
    recordOpinion("Tabs vs spaces", "Tabs", "Accessibility");
    challengeOpinion("Tabs vs spaces", "Alice");
    challengeOpinion("Tabs vs spaces", "Bob");
    const opinion = getOpinion("Tabs vs spaces");
    expect(opinion!.challengedBy).toHaveLength(2);
  });

  it("returns null when challenging unknown topic", () => {
    expect(challengeOpinion("nonexistent", "challenger")).toBeNull();
  });

  it("filters by domain", () => {
    recordOpinion("Ethics topic", "Position", "Reason", { domain: "ethical" });
    recordOpinion("Tech topic", "Position", "Reason", { domain: "technical" });
    recordOpinion("Art topic", "Position", "Reason", { domain: "aesthetic" });

    const ethical = getOpinions("ethical");
    expect(ethical).toHaveLength(1);
    expect(ethical[0].domain).toBe("ethical");

    const all = getOpinions();
    expect(all).toHaveLength(3);
  });

  it("retrieves specific opinion by topic", () => {
    recordOpinion("Honesty", "Always tell the truth", "Core value", { domain: "ethical" });
    const opinion = getOpinion("honesty");
    expect(opinion).not.toBeNull();
    expect(opinion!.position).toBe("Always tell the truth");
  });

  it("returns null for unknown topic", () => {
    expect(getOpinion("nonexistent")).toBeNull();
  });

  it("handles empty log gracefully", () => {
    expect(getOpinions()).toEqual([]);
    expect(getOpinion("anything")).toBeNull();
  });

  it("persists across reads", () => {
    recordOpinion("Persistence", "It works", "Testing confirms");
    // Read from fresh call (new file read)
    const opinions = getOpinions();
    expect(opinions).toHaveLength(1);
    expect(opinions[0].topic).toBe("Persistence");
  });
});
