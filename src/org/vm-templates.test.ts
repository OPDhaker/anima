/**
 * Tests for VM Agent Templates — role presets for 15-agent deployment.
 */

import { describe, it, expect } from "vitest";
import { AGENT_ROLE_TEMPLATES, type AgentRolePreset } from "./vm-templates.js";

describe("VM Agent Templates", () => {
  const presets: AgentRolePreset[] = ["cybersecurity", "vision", "shipper"];

  it("defines all 3 role presets", () => {
    for (const preset of presets) {
      expect(AGENT_ROLE_TEMPLATES[preset]).toBeTruthy();
    }
  });

  it("each preset has a display name suffix", () => {
    for (const preset of presets) {
      const tmpl = AGENT_ROLE_TEMPLATES[preset];
      expect(tmpl.displayNameSuffix.length).toBeGreaterThan(0);
    }
  });

  it("each preset has specializations", () => {
    for (const preset of presets) {
      const tmpl = AGENT_ROLE_TEMPLATES[preset];
      expect(tmpl.specializations.length).toBeGreaterThan(0);
    }
  });

  it("each preset has a tool policy", () => {
    for (const preset of presets) {
      const tmpl = AGENT_ROLE_TEMPLATES[preset];
      expect(tmpl.toolPolicy.allow.length).toBeGreaterThan(0);
      expect(tmpl.toolPolicy.sandboxMode).toMatch(/^(off|non-main|all)$/);
    }
  });

  it("each preset has a heartbeat interval", () => {
    for (const preset of presets) {
      const tmpl = AGENT_ROLE_TEMPLATES[preset];
      expect(tmpl.heartbeatIntervalMs).toBeGreaterThan(0);
    }
  });

  it("cybersecurity guardian is always sandboxed", () => {
    expect(AGENT_ROLE_TEMPLATES.cybersecurity.toolPolicy.sandboxMode).toBe("all");
  });

  it("shipper has deploy access", () => {
    const shipper = AGENT_ROLE_TEMPLATES.shipper;
    expect(
      shipper.toolPolicy.allow.some((a) => a.includes("automation") || a.includes("deploy")),
    ).toBe(true);
  });

  it("cybersecurity denies automation (no automated deploys)", () => {
    const guardian = AGENT_ROLE_TEMPLATES.cybersecurity;
    expect(guardian.toolPolicy.deny.some((d) => d.includes("automation"))).toBe(true);
  });

  it("vision has research specialization", () => {
    const vision = AGENT_ROLE_TEMPLATES.vision;
    expect(vision.specializations).toContain("research");
  });
});
