/**
 * Tests for port formatting and classification utilities.
 */

import { describe, it, expect } from "vitest";
import { classifyPortListener, buildPortHints, formatPortListener } from "./ports-format.js";

describe("classifyPortListener", () => {
  it("classifies anima gateway", () => {
    expect(classifyPortListener({ command: "node anima.mjs gateway" }, 18789)).toBe("gateway");
  });

  it("classifies SSH tunnel", () => {
    expect(classifyPortListener({ command: "ssh -L 18789:localhost:18789" }, 18789)).toBe("ssh");
  });

  it("classifies unknown process", () => {
    expect(classifyPortListener({ command: "nginx" }, 80)).toBe("unknown");
  });
});

describe("buildPortHints", () => {
  it("returns empty for no listeners", () => {
    expect(buildPortHints([], 18789)).toEqual([]);
  });

  it("hints for gateway listener", () => {
    const hints = buildPortHints([{ command: "anima gateway" }], 18789);
    expect(hints.some((h) => h.includes("Gateway already running"))).toBe(true);
  });

  it("hints for SSH tunnel", () => {
    const hints = buildPortHints([{ command: "ssh -L 18789:localhost:18789" }], 18789);
    expect(hints.some((h) => h.includes("SSH tunnel"))).toBe(true);
  });

  it("warns about multiple listeners", () => {
    const hints = buildPortHints([{ command: "anima gateway" }, { command: "ssh tunnel" }], 18789);
    expect(hints.some((h) => h.includes("Multiple listeners"))).toBe(true);
  });
});

describe("formatPortListener", () => {
  it("formats with all fields", () => {
    const formatted = formatPortListener({
      pid: 1234,
      user: "root",
      command: "anima",
      address: "0.0.0.0:18789",
    });
    expect(formatted).toContain("1234");
    expect(formatted).toContain("root");
    expect(formatted).toContain("anima");
  });

  it("handles missing fields", () => {
    const formatted = formatPortListener({});
    expect(formatted).toContain("pid ?");
    expect(formatted).toContain("unknown");
  });
});
