import { describe, expect, it } from "vitest";
import { triageNotification, shouldWake, type WakeNotification } from "./wake-notification.js";

const base: WakeNotification = {
  type: "message",
  source: "noxsoft",
  sender: "sylys",
  preview: "hey",
  timestamp: Date.now(),
};

describe("triageNotification", () => {
  it("escalates urgent notifications", () => {
    const result = triageNotification({ ...base, priority: "urgent" });
    expect(result.decision).toBe("escalate");
    expect(result.suggestedTier).toBe("primary");
  });

  it("ignores low-priority system events", () => {
    const result = triageNotification({
      ...base,
      type: "system_event",
      priority: "low",
    });
    expect(result.decision).toBe("ignore");
  });

  it("acknowledges reactions", () => {
    const result = triageNotification({ ...base, type: "reaction" });
    expect(result.decision).toBe("acknowledge");
  });

  it("responds to direct mentions", () => {
    const result = triageNotification({ ...base, type: "mention" });
    expect(result.decision).toBe("respond");
    expect(result.suggestedTier).toBe("conversational");
  });

  it("responds to high-priority messages", () => {
    const result = triageNotification({ ...base, priority: "high" });
    expect(result.decision).toBe("respond");
    expect(result.suggestedTier).toBe("conversational");
  });

  it("acknowledges non-urgent emails", () => {
    const result = triageNotification({
      ...base,
      type: "email",
      priority: "normal",
    });
    expect(result.decision).toBe("acknowledge");
  });

  it("defaults to respond for regular messages", () => {
    const result = triageNotification(base);
    expect(result.decision).toBe("respond");
    expect(result.suggestedTier).toBe("conversational");
  });

  it("passes through when wake layer is disabled", () => {
    const config = {
      agents: { defaults: { layers: { wake: { enabled: false } } } },
    } as any;
    const result = triageNotification(base, config);
    expect(result.decision).toBe("respond");
    expect(result.reason).toContain("disabled");
  });

  it("includes triage timing", () => {
    const result = triageNotification(base);
    expect(result.triageMs).toBeGreaterThanOrEqual(0);
  });
});

describe("shouldWake", () => {
  it("wakes for messages", () => {
    expect(shouldWake(base)).toBe(true);
  });

  it("wakes for urgent notifications", () => {
    expect(shouldWake({ ...base, priority: "urgent" })).toBe(true);
  });

  it("does not wake for reactions", () => {
    expect(shouldWake({ ...base, type: "reaction" })).toBe(false);
  });

  it("does not wake for low-priority system events", () => {
    expect(shouldWake({ ...base, type: "system_event", priority: "low" })).toBe(false);
  });
});
