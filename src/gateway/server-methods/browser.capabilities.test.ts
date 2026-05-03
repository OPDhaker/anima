import { describe, expect, it } from "vitest";
import type { loadConfig } from "../../config/config.js";
import type { NodeSession } from "../node-registry.js";
import { buildBrowserCapabilitiesSnapshot } from "./browser.js";

type LoadedConfig = ReturnType<typeof loadConfig>;

function asConfig(value: Partial<LoadedConfig>): LoadedConfig {
  return value as LoadedConfig;
}

function createNode(overrides: Partial<NodeSession>): NodeSession {
  return {
    nodeId: "node-1",
    connId: "conn-1",
    client: {} as never,
    caps: [],
    commands: [],
    connectedAtMs: 0,
    ...overrides,
  };
}

describe("buildBrowserCapabilitiesSnapshot", () => {
  it("returns local browser routing with an auth warning by default", () => {
    const snapshot = buildBrowserCapabilitiesSnapshot({
      cfg: asConfig({}),
      nodes: [],
    });

    expect(snapshot.browserEnabled).toBe(true);
    expect(snapshot.evaluateEnabled).toBe(true);
    expect(snapshot.auth.mode).toBe("none");
    expect(snapshot.auth.configured).toBe(false);
    expect(snapshot.routing.activeRoute).toBe("local");
    expect(snapshot.warnings.some((warning) => warning.includes("without gateway auth"))).toBe(
      true,
    );
  });

  it("selects a connected browser-capable node in auto mode", () => {
    const snapshot = buildBrowserCapabilitiesSnapshot({
      cfg: asConfig({
        browser: { evaluateEnabled: false },
        gateway: {
          auth: { token: "secret-token" },
          nodes: { browser: { mode: "auto" } },
        },
      }),
      nodes: [
        createNode({
          nodeId: "desktop-1",
          displayName: "Desktop",
          remoteIp: "100.64.0.5",
          caps: ["browser"],
        }),
      ],
    });

    expect(snapshot.auth.mode).toBe("token");
    expect(snapshot.auth.configured).toBe(true);
    expect(snapshot.routing.activeRoute).toBe("node");
    expect(snapshot.routing.selectedNode?.nodeId).toBe("desktop-1");
    expect(snapshot.routing.availableNodes).toHaveLength(1);
    expect(snapshot.warnings).toHaveLength(0);
  });

  it("reports an error route when a pinned node is disconnected", () => {
    const snapshot = buildBrowserCapabilitiesSnapshot({
      cfg: asConfig({
        gateway: {
          auth: { token: "secret-token" },
          nodes: {
            browser: {
              mode: "manual",
              node: "desktop-primary",
            },
          },
        },
      }),
      nodes: [
        createNode({
          nodeId: "desktop-secondary",
          caps: ["browser"],
        }),
      ],
    });

    expect(snapshot.routing.activeRoute).toBe("error");
    expect(snapshot.routing.error).toContain(
      "Configured browser node not connected: desktop-primary",
    );
    expect(snapshot.warnings).toContain(
      "Error: Configured browser node not connected: desktop-primary",
    );
  });
});
