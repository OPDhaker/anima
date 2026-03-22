import { listIcoProjects, type IcoProject } from "./launch-platform.js";

export type IcoPublicMetricState = "live" | "delayed" | "stale" | "unavailable";
export type IcoPublicMetricSourceStatus = "ok" | "partial" | "error";

export interface IcoPublicProjectSnapshot {
  id: string;
  name: string;
  symbol: string;
  chains: string[];
  targetRaiseUsd: number;
  bondingActive: boolean;
  allocation: {
    team: number;
    companyRound: number;
    revenueShare: number;
    ubc: number;
  };
  tax: {
    transferTaxRate: number;
    revenueShareRate: number;
  };
}

export interface IcoPublicMetric {
  id: string;
  label: string;
  value: number | null;
  displayValue: string;
  capturedAt: string | null;
  cadenceMinutes: number;
  state: IcoPublicMetricState;
  ageMinutes: number | null;
  sourceStatus: IcoPublicMetricSourceStatus;
  sourceRef: string;
  errorCode: string | null;
}

export interface IcoPublicMetricsFeed {
  generatedAt: string;
  project: IcoPublicProjectSnapshot | null;
  metrics: IcoPublicMetric[];
}

type BuildIcoPublicMetricsOptions = {
  nowMs?: number;
  projects?: IcoProject[];
};

type MetricDefinition = {
  id: string;
  label: string;
  cadenceMinutes: number;
  sourceRef: string;
  readValue: (project: IcoProject) => number;
  formatValue: (value: number) => string;
};

type ResolveMetricStateInput = {
  value: number | null;
  sourceStatus: IcoPublicMetricSourceStatus;
  capturedAt: string | null;
  cadenceMinutes: number;
  nowMs?: number;
  hasHistoricalValue?: boolean;
};

const MS_PER_MINUTE = 60_000;
const METRIC_UNAVAILABLE_ERROR = "ICO_PROJECT_NOT_FOUND";

const METRIC_DEFINITIONS: MetricDefinition[] = [
  {
    id: "current_price_usd",
    label: "Current Price",
    cadenceMinutes: 15,
    sourceRef: "ico.launch-platform.currentPriceUsd",
    readValue: (project) => project.status.currentPriceUsd,
    formatValue: (value) => formatUsd(value, value >= 1 ? 2 : 4),
  },
  {
    id: "total_raised_usd",
    label: "Total Raised",
    cadenceMinutes: 15,
    sourceRef: "ico.launch-platform.totalRaisedUsd",
    readValue: (project) => project.status.totalRaisedUsd,
    formatValue: (value) => formatUsd(value, 2),
  },
  {
    id: "holders_total",
    label: "Holders",
    cadenceMinutes: 15,
    sourceRef: "ico.launch-platform.holders",
    readValue: (project) => project.status.holders,
    formatValue: (value) => formatInteger(value),
  },
  {
    id: "supply_sold_tokens",
    label: "Supply Sold",
    cadenceMinutes: 15,
    sourceRef: "ico.launch-platform.currentSupply",
    readValue: (project) => project.status.currentSupply,
    formatValue: (value) => formatInteger(value),
  },
  {
    id: "bonding_progress_percent",
    label: "Bonding Progress",
    cadenceMinutes: 15,
    sourceRef: "ico.launch-platform.percentToTarget",
    readValue: (project) => project.status.percentToTarget,
    formatValue: (value) => formatPercent(value, 1),
  },
  {
    id: "transfer_tax_rate_percent",
    label: "Transfer Tax",
    cadenceMinutes: 24 * 60,
    sourceRef: "ico.config.tax.transferTaxRate",
    readValue: (project) => project.config.tax.transferTaxRate * 100,
    formatValue: (value) => formatPercent(value, 2),
  },
  {
    id: "revenue_share_rate_percent",
    label: "Revenue Share",
    cadenceMinutes: 24 * 60,
    sourceRef: "ico.config.tax.revenueShareRate",
    readValue: (project) => project.config.tax.revenueShareRate * 100,
    formatValue: (value) => formatPercent(value, 2),
  },
];

function formatUsd(value: number, fractionDigits: number): string {
  return `$${value.toLocaleString(undefined, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })}`;
}

function formatInteger(value: number): string {
  return Math.round(value).toLocaleString();
}

function formatPercent(value: number, fractionDigits: number): string {
  return `${value.toLocaleString(undefined, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })}%`;
}

function mapProjectSnapshot(project: IcoProject): IcoPublicProjectSnapshot {
  return {
    id: project.id,
    name: project.config.name,
    symbol: project.config.symbol,
    chains: [...project.config.chains],
    targetRaiseUsd: project.config.bondingCurve.targetRaiseUsd,
    bondingActive: project.status.bondingActive,
    allocation: {
      team: project.config.allocation.team,
      companyRound: project.config.allocation.companyRound,
      revenueShare: project.config.allocation.revenueShare,
      ubc: project.config.allocation.ubc,
    },
    tax: {
      transferTaxRate: project.config.tax.transferTaxRate,
      revenueShareRate: project.config.tax.revenueShareRate,
    },
  };
}

function buildUnavailableMetric(definition: MetricDefinition): IcoPublicMetric {
  return {
    id: definition.id,
    label: definition.label,
    value: null,
    displayValue: "--",
    capturedAt: null,
    cadenceMinutes: definition.cadenceMinutes,
    state: "unavailable",
    ageMinutes: null,
    sourceStatus: "error",
    sourceRef: definition.sourceRef,
    errorCode: METRIC_UNAVAILABLE_ERROR,
  };
}

function buildMetricFromProject(
  definition: MetricDefinition,
  project: IcoProject,
  capturedAt: string,
  nowMs: number,
): IcoPublicMetric {
  const value = definition.readValue(project);
  const sourceStatus: IcoPublicMetricSourceStatus = "ok";
  const { state, ageMinutes } = resolveMetricState({
    value,
    sourceStatus,
    capturedAt,
    cadenceMinutes: definition.cadenceMinutes,
    nowMs,
  });

  return {
    id: definition.id,
    label: definition.label,
    value,
    displayValue: definition.formatValue(value),
    capturedAt,
    cadenceMinutes: definition.cadenceMinutes,
    state,
    ageMinutes,
    sourceStatus,
    sourceRef: definition.sourceRef,
    errorCode: null,
  };
}

export function resolveMetricState(input: ResolveMetricStateInput): {
  state: IcoPublicMetricState;
  ageMinutes: number | null;
} {
  const nowMs = input.nowMs ?? Date.now();
  const hasHistoricalValue = input.hasHistoricalValue ?? input.value != null;

  if (input.value == null) {
    return { state: "unavailable", ageMinutes: null };
  }
  if (!input.capturedAt) {
    return { state: "unavailable", ageMinutes: null };
  }

  const capturedAtMs = Date.parse(input.capturedAt);
  if (!Number.isFinite(capturedAtMs)) {
    return { state: "unavailable", ageMinutes: null };
  }

  const ageMinutes = Math.max(0, (nowMs - capturedAtMs) / MS_PER_MINUTE);
  if (input.sourceStatus === "error" && !hasHistoricalValue) {
    return { state: "unavailable", ageMinutes };
  }
  if (ageMinutes <= input.cadenceMinutes) {
    return { state: "live", ageMinutes };
  }
  if (ageMinutes <= input.cadenceMinutes * 3) {
    return { state: "delayed", ageMinutes };
  }
  return { state: "stale", ageMinutes };
}

export function buildIcoPublicMetricsFeed(
  options: BuildIcoPublicMetricsOptions = {},
): IcoPublicMetricsFeed {
  const nowMs = options.nowMs ?? Date.now();
  const generatedAt = new Date(nowMs).toISOString();
  const projects = [...(options.projects ?? listIcoProjects())].toSorted(
    (a, b) => b.createdAt - a.createdAt,
  );
  const project = projects[0] ?? null;

  if (!project) {
    return {
      generatedAt,
      project: null,
      metrics: METRIC_DEFINITIONS.map(buildUnavailableMetric),
    };
  }

  return {
    generatedAt,
    project: mapProjectSnapshot(project),
    metrics: METRIC_DEFINITIONS.map((definition) =>
      buildMetricFromProject(definition, project, generatedAt, nowMs),
    ),
  };
}
