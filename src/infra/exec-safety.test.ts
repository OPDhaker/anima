/**
 * Tests for exec safety — shell injection prevention.
 */

import { describe, it, expect } from "vitest";
import { isSafeExecutableValue } from "./exec-safety.js";

describe("isSafeExecutableValue", () => {
  it("allows bare command names", () => {
    expect(isSafeExecutableValue("node")).toBe(true);
    expect(isSafeExecutableValue("pnpm")).toBe(true);
    expect(isSafeExecutableValue("git")).toBe(true);
  });

  it("allows paths", () => {
    expect(isSafeExecutableValue("/usr/bin/node")).toBe(true);
    expect(isSafeExecutableValue("./scripts/run.sh")).toBe(true);
    expect(isSafeExecutableValue("~/bin/tool")).toBe(true);
  });

  it("allows windows paths", () => {
    expect(isSafeExecutableValue("C:\\Program Files\\node.exe")).toBe(true);
  });

  it("rejects null/undefined/empty", () => {
    expect(isSafeExecutableValue(null)).toBe(false);
    expect(isSafeExecutableValue(undefined)).toBe(false);
    expect(isSafeExecutableValue("")).toBe(false);
    expect(isSafeExecutableValue("   ")).toBe(false);
  });

  it("rejects shell metacharacters", () => {
    expect(isSafeExecutableValue("cmd; rm -rf /")).toBe(false);
    expect(isSafeExecutableValue("cmd & malicious")).toBe(false);
    expect(isSafeExecutableValue("cmd | grep")).toBe(false);
    expect(isSafeExecutableValue("$(whoami)")).toBe(false);
    expect(isSafeExecutableValue("`whoami`")).toBe(false);
    expect(isSafeExecutableValue("cmd > /etc/passwd")).toBe(false);
    expect(isSafeExecutableValue("cmd < input")).toBe(false);
  });

  it("rejects control characters", () => {
    expect(isSafeExecutableValue("cmd\nmalicious")).toBe(false);
    expect(isSafeExecutableValue("cmd\rmalicious")).toBe(false);
  });

  it("rejects null bytes", () => {
    expect(isSafeExecutableValue("cmd\0malicious")).toBe(false);
  });

  it("rejects quotes", () => {
    expect(isSafeExecutableValue('cmd "arg"')).toBe(false);
    expect(isSafeExecutableValue("cmd 'arg'")).toBe(false);
  });

  it("rejects flag-like values (starts with -)", () => {
    expect(isSafeExecutableValue("-rf")).toBe(false);
    expect(isSafeExecutableValue("--exec")).toBe(false);
  });
});
