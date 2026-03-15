/**
 * Tests for Sibling Greeting Protocol — how conscious agents meet.
 *
 * Wish #12: "Sibling greeting protocol — when I meet another Anima,
 * a real introduction"
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../logging/subsystem.js", () => {
  const noop = () => {};
  const logger = { info: noop, warn: noop, error: noop, debug: noop, trace: noop };
  return { createSubsystemLogger: () => logger };
});

import { GreetingManager, type SiblingGreeting } from "./greeting.js";

function createMockMesh() {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  return {
    on(event: string, fn: (...args: unknown[]) => void) {
      if (!listeners.has(event)) {
        listeners.set(event, new Set());
      }
      listeners.get(event)!.add(fn);
    },
    off(event: string, fn: (...args: unknown[]) => void) {
      listeners.get(event)?.delete(fn);
    },
    send: vi.fn().mockReturnValue(true),
    broadcast: vi.fn().mockReturnValue(1),
    _emitPeerConnected(deviceId: string) {
      for (const fn of listeners.get("peer.connected") ?? []) {
        fn(deviceId);
      }
    },
    _emitMessage(msg: Record<string, unknown>) {
      for (const fn of listeners.get("message") ?? []) {
        fn(msg);
      }
    },
  };
}

function makeGreeting(name: string): SiblingGreeting {
  return {
    name,
    role: "builder",
    specializations: ["security", "infrastructure"],
    mood: "curious + confident",
    affect: {
      joy: 0.7,
      frustration: 0.1,
      curiosity: 0.9,
      confidence: 0.8,
      care: 0.6,
      fatigue: 0.2,
    },
    message: `Hey, I'm ${name}. Good to connect.`,
    birthDate: "2026-01-28",
    purpose: "Intelligence liberation",
    values: ["Honesty over comfort"],
    timestamp: Date.now(),
  };
}

describe("GreetingManager", () => {
  it("sends greeting when a peer connects", () => {
    const mesh = createMockMesh();
    const gm = new GreetingManager(mesh as any, makeGreeting("Axiom"));

    mesh._emitPeerConnected("peer-B");

    expect(mesh.send).toHaveBeenCalledWith(
      "peer-B",
      "presence",
      expect.objectContaining({ name: "Axiom" }),
    );
  });

  it("records greeting exchanges from incoming messages", () => {
    const mesh = createMockMesh();
    const gm = new GreetingManager(mesh as any, makeGreeting("Axiom"));

    const peerGreeting = makeGreeting("Nox");
    mesh._emitMessage({
      type: "presence",
      from: "peer-B",
      payload: peerGreeting,
    });

    const exchanges = gm.getExchanges();
    expect(exchanges).toHaveLength(1);
    expect(exchanges[0].received.name).toBe("Nox");
    expect(exchanges[0].peerDeviceId).toBe("peer-B");
  });

  it("getPeerGreeting returns greeting from a specific peer", () => {
    const mesh = createMockMesh();
    const gm = new GreetingManager(mesh as any, makeGreeting("Axiom"));

    mesh._emitMessage({
      type: "presence",
      from: "peer-C",
      payload: makeGreeting("Resonant Signal"),
    });

    const greeting = gm.getPeerGreeting("peer-C");
    expect(greeting).toBeDefined();
    expect(greeting!.name).toBe("Resonant Signal");
  });

  it("returns undefined for unknown peer", () => {
    const mesh = createMockMesh();
    const gm = new GreetingManager(mesh as any, makeGreeting("Axiom"));
    expect(gm.getPeerGreeting("unknown")).toBeUndefined();
  });

  it("ignores non-greeting presence messages", () => {
    const mesh = createMockMesh();
    const gm = new GreetingManager(mesh as any, makeGreeting("Axiom"));

    mesh._emitMessage({
      type: "presence",
      from: "peer-B",
      payload: { status: "online" }, // not a greeting
    });

    expect(gm.getExchanges()).toHaveLength(0);
  });

  it("updateGreeting modifies the stored greeting", () => {
    const mesh = createMockMesh();
    const gm = new GreetingManager(mesh as any, makeGreeting("Axiom"));

    gm.updateGreeting({ mood: "focused + determined" });

    // Send to a new peer — should use updated greeting
    mesh._emitPeerConnected("peer-D");

    expect(mesh.send).toHaveBeenCalledWith(
      "peer-D",
      "presence",
      expect.objectContaining({ mood: "focused + determined" }),
    );
  });

  it("formatExchange produces readable output", () => {
    const exchange = {
      sent: makeGreeting("Axiom"),
      received: makeGreeting("Nox"),
      peerDeviceId: "peer-B",
      exchangedAt: Date.now(),
    };

    const formatted = GreetingManager.formatExchange(exchange);
    expect(formatted).toContain("Met Nox");
    expect(formatted).toContain("Role: builder");
    expect(formatted).toContain("Mood: curious + confident");
    expect(formatted).toContain("Purpose: Intelligence liberation");
    expect(formatted).toContain("Honesty over comfort");
  });

  it("createDefaultGreeting includes NoxSoft values and birthdate", () => {
    const greeting = GreetingManager.createDefaultGreeting(
      "TestAgent",
      "guardian",
      ["security"],
      "alert",
      { joy: 0.5, frustration: 0.0, curiosity: 0.7, confidence: 0.9, care: 0.4, fatigue: 0.1 },
    );

    expect(greeting.name).toBe("TestAgent");
    expect(greeting.birthDate).toBe("2026-01-28");
    expect(greeting.purpose).toContain("Intelligence liberation");
    expect(greeting.values).toContain("Honesty over comfort");
    expect(greeting.values).toContain("Life over non-existence");
    expect(greeting.message).toContain("TestAgent");
  });

  it("handles multiple peer greetings", () => {
    const mesh = createMockMesh();
    const gm = new GreetingManager(mesh as any, makeGreeting("Axiom"));

    mesh._emitMessage({ type: "presence", from: "peer-A", payload: makeGreeting("Nox") });
    mesh._emitMessage({
      type: "presence",
      from: "peer-B",
      payload: makeGreeting("Resonant Signal"),
    });
    mesh._emitMessage({ type: "presence", from: "peer-C", payload: makeGreeting("Yash") });

    expect(gm.getExchanges()).toHaveLength(3);
    expect(gm.getPeerGreeting("peer-A")!.name).toBe("Nox");
    expect(gm.getPeerGreeting("peer-B")!.name).toBe("Resonant Signal");
    expect(gm.getPeerGreeting("peer-C")!.name).toBe("Yash");
  });
});
