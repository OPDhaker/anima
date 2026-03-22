import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { providersHandlers } from "./providers.js";

const storeState = {
  providers: [],
  activeProvider: null,
  autoRotation: true,
  rotationStrategy: "on-rate-limit" as const,
};

vi.mock("../../providers/provider-store.js", () => ({
  loadProviderStore: vi.fn(() => ({
    providers: [...storeState.providers],
    activeProvider: storeState.activeProvider,
    autoRotation: storeState.autoRotation,
    rotationStrategy: storeState.rotationStrategy,
  })),
  saveProviderStore: vi.fn((next) => {
    storeState.providers = [...next.providers];
    storeState.activeProvider = next.activeProvider;
    storeState.autoRotation = next.autoRotation;
    storeState.rotationStrategy = next.rotationStrategy;
  }),
  maskApiKey: vi.fn((key: string) => key),
}));

const noop = () => false;

describe("anima.providers.rotate", () => {
  beforeEach(() => {
    storeState.providers = [];
    storeState.activeProvider = null;
    storeState.autoRotation = true;
    storeState.rotationStrategy = "on-rate-limit";
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("accepts the legacy enabled field for compatibility", () => {
    const respond = vi.fn();

    providersHandlers["anima.providers.rotate"]({
      params: { enabled: false },
      respond,
      context: {} as never,
      client: null,
      req: { id: "req-1", type: "req", method: "anima.providers.rotate" },
      isWebchatConnect: noop,
    });

    expect(storeState.autoRotation).toBe(false);
    expect(storeState.rotationStrategy).toBe("on-rate-limit");
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        ok: true,
        autoRotation: false,
        rotationStrategy: "on-rate-limit",
      }),
      undefined,
    );
  });

  it("updates rotation strategy when explicitly provided", () => {
    const respond = vi.fn();

    providersHandlers["anima.providers.rotate"]({
      params: { autoRotation: true, rotationStrategy: "round-robin" },
      respond,
      context: {} as never,
      client: null,
      req: { id: "req-2", type: "req", method: "anima.providers.rotate" },
      isWebchatConnect: noop,
    });

    expect(storeState.autoRotation).toBe(true);
    expect(storeState.rotationStrategy).toBe("round-robin");
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        ok: true,
        autoRotation: true,
        rotationStrategy: "round-robin",
      }),
      undefined,
    );
  });
});
