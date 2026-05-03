/**
 * Tests for diagnostic flags — feature flag resolution + glob matching.
 */

import { describe, it, expect } from "vitest";
import {
  resolveDiagnosticFlags,
  matchesDiagnosticFlag,
  isDiagnosticFlagEnabled,
} from "./diagnostic-flags.js";

describe("resolveDiagnosticFlags", () => {
  it("returns empty for no config or env", () => {
    expect(resolveDiagnosticFlags(undefined, {})).toEqual([]);
  });

  it("parses comma-separated env flags", () => {
    const flags = resolveDiagnosticFlags(undefined, { ANIMA_DIAGNOSTICS: "p2p,mesh,sync" });
    expect(flags).toEqual(["p2p", "mesh", "sync"]);
  });

  it("handles '1' and 'true' as enable-all", () => {
    expect(resolveDiagnosticFlags(undefined, { ANIMA_DIAGNOSTICS: "1" })).toEqual(["*"]);
    expect(resolveDiagnosticFlags(undefined, { ANIMA_DIAGNOSTICS: "true" })).toEqual(["*"]);
    expect(resolveDiagnosticFlags(undefined, { ANIMA_DIAGNOSTICS: "all" })).toEqual(["*"]);
  });

  it("handles '0' and 'false' as disable-all", () => {
    expect(resolveDiagnosticFlags(undefined, { ANIMA_DIAGNOSTICS: "0" })).toEqual([]);
    expect(resolveDiagnosticFlags(undefined, { ANIMA_DIAGNOSTICS: "false" })).toEqual([]);
    expect(resolveDiagnosticFlags(undefined, { ANIMA_DIAGNOSTICS: "off" })).toEqual([]);
  });

  it("deduplicates flags", () => {
    const flags = resolveDiagnosticFlags(undefined, { ANIMA_DIAGNOSTICS: "p2p,p2p,mesh" });
    expect(flags).toEqual(["p2p", "mesh"]);
  });

  it("normalizes to lowercase", () => {
    const flags = resolveDiagnosticFlags(undefined, { ANIMA_DIAGNOSTICS: "P2P,MESH" });
    expect(flags).toEqual(["p2p", "mesh"]);
  });

  it("merges config flags with env flags", () => {
    const cfg = { diagnostics: { flags: ["from-config"] } } as any;
    const flags = resolveDiagnosticFlags(cfg, { ANIMA_DIAGNOSTICS: "from-env" });
    expect(flags).toContain("from-config");
    expect(flags).toContain("from-env");
  });
});

describe("matchesDiagnosticFlag", () => {
  it("matches exact flag", () => {
    expect(matchesDiagnosticFlag("p2p.mesh", ["p2p.mesh"])).toBe(true);
  });

  it("does not match different flag", () => {
    expect(matchesDiagnosticFlag("p2p.mesh", ["p2p.crypto"])).toBe(false);
  });

  it("matches wildcard *", () => {
    expect(matchesDiagnosticFlag("anything", ["*"])).toBe(true);
  });

  it("matches 'all' as wildcard", () => {
    expect(matchesDiagnosticFlag("anything", ["all"])).toBe(true);
  });

  it("matches prefix glob (p2p.*)", () => {
    expect(matchesDiagnosticFlag("p2p.mesh", ["p2p.*"])).toBe(true);
    expect(matchesDiagnosticFlag("p2p.crypto", ["p2p.*"])).toBe(true);
    expect(matchesDiagnosticFlag("p2p", ["p2p.*"])).toBe(true);
    expect(matchesDiagnosticFlag("sync.brain", ["p2p.*"])).toBe(false);
  });

  it("matches suffix glob (p2p*)", () => {
    expect(matchesDiagnosticFlag("p2p-mesh", ["p2p*"])).toBe(true);
    expect(matchesDiagnosticFlag("p2p.anything", ["p2p*"])).toBe(true);
  });

  it("returns false for empty flag", () => {
    expect(matchesDiagnosticFlag("", ["p2p"])).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(matchesDiagnosticFlag("P2P.Mesh", ["p2p.mesh"])).toBe(true);
  });
});

describe("isDiagnosticFlagEnabled", () => {
  it("returns false when no flags configured", () => {
    expect(isDiagnosticFlagEnabled("p2p", undefined, {})).toBe(false);
  });

  it("returns true when flag is in env", () => {
    expect(isDiagnosticFlagEnabled("p2p", undefined, { ANIMA_DIAGNOSTICS: "p2p,mesh" })).toBe(true);
  });

  it("returns true when all enabled", () => {
    expect(isDiagnosticFlagEnabled("anything", undefined, { ANIMA_DIAGNOSTICS: "1" })).toBe(true);
  });
});
