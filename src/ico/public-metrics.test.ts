import { describe, expect, it } from "vitest";
import type { IcoProject } from "./launch-platform.js";
import { buildIcoPublicMetricsFeed, resolveMetricState } from "./public-metrics.js";
import { NOXSOFT_ICO_CONFIG, createIcoStatus } from "./tokenomics.js";

function createProjectSample(): IcoProject {
  const config = {
    ...NOXSOFT_ICO_CONFIG,
    chains: [...NOXSOFT_ICO_CONFIG.chains],
    bondingCurve: { ...NOXSOFT_ICO_CONFIG.bondingCurve },
    allocation: { ...NOXSOFT_ICO_CONFIG.allocation },
    tax: { ...NOXSOFT_ICO_CONFIG.tax },
  };
  const status = createIcoStatus(config);
  status.currentSupply = 1_500_000;
  status.totalRaisedUsd = 125_000;
  status.currentPriceUsd = 0.0012;
  status.percentToTarget = 6.25;
  status.holders = 42;

  return {
    id: "ico-test",
    config,
    status,
    createdAt: Date.UTC(2026, 2, 15, 10, 0, 0),
    createdBy: "tester",
    holders: [],
    transactions: [],
  };
}

describe("resolveMetricState", () => {
  const nowMs = Date.UTC(2026, 2, 15, 10, 0, 0);

  it("returns unavailable when value is null", () => {
    const result = resolveMetricState({
      value: null,
      sourceStatus: "error",
      capturedAt: null,
      cadenceMinutes: 60,
      nowMs,
    });
    expect(result.state).toBe("unavailable");
  });

  it("returns live when age is within cadence", () => {
    const result = resolveMetricState({
      value: 10,
      sourceStatus: "ok",
      capturedAt: new Date(nowMs - 30 * 60_000).toISOString(),
      cadenceMinutes: 60,
      nowMs,
    });
    expect(result.state).toBe("live");
  });

  it("returns delayed when age is between 1x and 3x cadence", () => {
    const result = resolveMetricState({
      value: 10,
      sourceStatus: "ok",
      capturedAt: new Date(nowMs - 2 * 60 * 60_000).toISOString(),
      cadenceMinutes: 60,
      nowMs,
    });
    expect(result.state).toBe("delayed");
  });

  it("returns stale when age is above 3x cadence", () => {
    const result = resolveMetricState({
      value: 10,
      sourceStatus: "ok",
      capturedAt: new Date(nowMs - 4 * 60 * 60_000).toISOString(),
      cadenceMinutes: 60,
      nowMs,
    });
    expect(result.state).toBe("stale");
  });
});

describe("buildIcoPublicMetricsFeed", () => {
  const nowMs = Date.UTC(2026, 2, 15, 12, 0, 0);

  it("returns unavailable metrics when no projects are available", () => {
    const feed = buildIcoPublicMetricsFeed({ nowMs, projects: [] });
    expect(feed.project).toBeNull();
    expect(feed.metrics.length).toBeGreaterThan(0);
    expect(feed.metrics.every((metric) => metric.state === "unavailable")).toBe(true);
    expect(feed.metrics.every((metric) => metric.displayValue === "--")).toBe(true);
  });

  it("returns live metrics from the latest project snapshot", () => {
    const feed = buildIcoPublicMetricsFeed({ nowMs, projects: [createProjectSample()] });
    expect(feed.project?.symbol).toBe("NOX");
    expect(feed.metrics.every((metric) => metric.state === "live")).toBe(true);

    const totalRaised = feed.metrics.find((metric) => metric.id === "total_raised_usd");
    const holders = feed.metrics.find((metric) => metric.id === "holders_total");

    expect(totalRaised?.value).toBe(125_000);
    expect(holders?.value).toBe(42);
    expect(totalRaised?.displayValue).toContain("$125,000");
  });
});
