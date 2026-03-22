import { describe, expect, it } from "vitest";
import type { IcoProject } from "../ico/launch-platform.js";
import { NOXSOFT_ICO_CONFIG, createIcoStatus } from "../ico/tokenomics.js";
import { buildImpactFootprintFeed } from "./footprint.js";

function createProjectSample(): IcoProject {
  const config = {
    ...NOXSOFT_ICO_CONFIG,
    chains: [...NOXSOFT_ICO_CONFIG.chains],
    bondingCurve: { ...NOXSOFT_ICO_CONFIG.bondingCurve },
    allocation: { ...NOXSOFT_ICO_CONFIG.allocation },
    tax: { ...NOXSOFT_ICO_CONFIG.tax },
  };
  const status = createIcoStatus(config);
  status.holders = 88;
  status.totalRaisedUsd = 250_000;

  return {
    id: "ico-footprint-test",
    config,
    status,
    createdAt: Date.UTC(2026, 2, 15, 12, 0, 0),
    createdBy: "tester",
    holders: [],
    transactions: [],
  };
}

describe("buildImpactFootprintFeed", () => {
  const nowMs = Date.UTC(2026, 2, 15, 16, 0, 0);

  it("keeps non-connected telemetry metrics unavailable", () => {
    const feed = buildImpactFootprintFeed({ nowMs, projects: [] });
    const users = feed.metrics.find((metric) => metric.id === "users_total");

    expect(users?.state).toBe("unavailable");
    expect(users?.displayValue).toBe("--");
    expect(users?.errorCode).toBe("SOURCE_NOT_CONNECTED");
  });

  it("marks ICO metrics unavailable when no ICO project exists", () => {
    const feed = buildImpactFootprintFeed({ nowMs, projects: [] });
    const holders = feed.metrics.find((metric) => metric.id === "ico_holders_total");

    expect(holders?.state).toBe("unavailable");
    expect(holders?.errorCode).toBe("ICO_PROJECT_NOT_FOUND");
  });

  it("surfaces live ICO metrics from the latest project snapshot", () => {
    const feed = buildImpactFootprintFeed({ nowMs, projects: [createProjectSample()] });
    const holders = feed.metrics.find((metric) => metric.id === "ico_holders_total");
    const raised = feed.metrics.find((metric) => metric.id === "ico_total_raised_usd");

    expect(holders?.state).toBe("live");
    expect(holders?.value).toBe(88);
    expect(raised?.state).toBe("live");
    expect(raised?.displayValue).toContain("$250,000");
  });
});
