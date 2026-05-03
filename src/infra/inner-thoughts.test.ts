import { describe, expect, it, afterEach } from "vitest";
import {
  startInnerThoughts,
  stopInnerThoughts,
  getInnerThoughtsState,
  resolveInnerThoughtsConfig,
} from "./inner-thoughts.js";

afterEach(() => {
  stopInnerThoughts();
});

describe("resolveInnerThoughtsConfig", () => {
  it("returns defaults when no config", () => {
    const cfg = resolveInnerThoughtsConfig();
    expect(cfg.enabled).toBe(true);
    expect(cfg.every).toBe("5m");
    expect(cfg.prompt).toBeDefined();
  });

  it("reads layers.innerThoughts from config", () => {
    const config = {
      agents: {
        defaults: {
          layers: {
            innerThoughts: {
              model: "haiku",
              every: "10m",
              enabled: false,
            },
          },
        },
      },
    } as any;
    const cfg = resolveInnerThoughtsConfig(config);
    expect(cfg.model).toBe("haiku");
    expect(cfg.every).toBe("10m");
    expect(cfg.enabled).toBe(false);
  });
});

describe("startInnerThoughts", () => {
  it("starts and tracks state", () => {
    const state = startInnerThoughts();
    expect(state.running).toBe(true);
    expect(state.intervalMs).toBeGreaterThan(0);
  });

  it("does not start when disabled", () => {
    const config = {
      agents: {
        defaults: {
          layers: { innerThoughts: { enabled: false } },
        },
      },
    } as any;
    const state = startInnerThoughts(config);
    expect(state.running).toBe(false);
  });

  it("tracks cycle count", async () => {
    startInnerThoughts();
    // First cycle runs immediately
    await new Promise((r) => setTimeout(r, 50));
    const state = getInnerThoughtsState();
    expect(state.cycleCount).toBeGreaterThanOrEqual(1);
    expect(state.lastRunAt).toBeDefined();
  });

  it("does not double-start", () => {
    startInnerThoughts();
    const state2 = startInnerThoughts();
    expect(state2.running).toBe(true);
  });
});

describe("stopInnerThoughts", () => {
  it("stops cleanly", () => {
    startInnerThoughts();
    stopInnerThoughts();
    expect(getInnerThoughtsState().running).toBe(false);
  });
});
