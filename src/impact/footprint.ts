import { listIcoProjects, type IcoProject } from "../ico/launch-platform.js";
import {
  resolveMetricState,
  type IcoPublicMetricSourceStatus,
  type IcoPublicMetricState,
} from "../ico/public-metrics.js";

export type ImpactFootprintMetricState = IcoPublicMetricState;
export type ImpactFootprintMetricSourceStatus = IcoPublicMetricSourceStatus;

export interface ImpactFootprintMetric {
  id: string;
  label: string;
  value: number | null;
  displayValue: string;
  capturedAt: string | null;
  cadenceMinutes: number;
  state: ImpactFootprintMetricState;
  ageMinutes: number | null;
  sourceStatus: ImpactFootprintMetricSourceStatus;
  sourceRef: string;
  errorCode: string | null;
}

export interface ImpactFootprintFeed {
  generatedAt: string;
  metrics: ImpactFootprintMetric[];
}

type BuildImpactFootprintOptions = {
  nowMs?: number;
  projects?: IcoProject[];
};

type MetricContext = {
  latestProject: IcoProject | null;
};

type MetricDefinition = {
  id: string;
  label: string;
  cadenceMinutes: number;
  sourceRef: string;
  readValue?: (context: MetricContext) => number | null;
  formatValue: (value: number) => string;
  missingErrorCode: string;
};

const METRIC_DEFINITIONS: MetricDefinition[] = [
  {
    id: "users_total",
    label: "Users",
    cadenceMinutes: 60,
    sourceRef: "telemetry.users.total",
    formatValue: formatInteger,
    missingErrorCode: "SOURCE_NOT_CONNECTED",
  },
  {
    id: "newsletter_subscribers_total",
    label: "Newsletter Subs",
    cadenceMinutes: 60,
    sourceRef: "telemetry.newsletter.total",
    formatValue: formatInteger,
    missingErrorCode: "SOURCE_NOT_CONNECTED",
  },
  {
    id: "downloads_total",
    label: "Downloads",
    cadenceMinutes: 60,
    sourceRef: "telemetry.downloads.total",
    formatValue: formatInteger,
    missingErrorCode: "SOURCE_NOT_CONNECTED",
  },
  {
    id: "promo_videos_hosted_total",
    label: "Promo Videos",
    cadenceMinutes: 60,
    sourceRef: "media.promo.hosted.total",
    formatValue: formatInteger,
    missingErrorCode: "SOURCE_NOT_CONNECTED",
  },
  {
    id: "ico_holders_total",
    label: "ICO Holders",
    cadenceMinutes: 15,
    sourceRef: "ico.launch-platform.holders",
    readValue: (context) => context.latestProject?.status.holders ?? null,
    formatValue: formatInteger,
    missingErrorCode: "ICO_PROJECT_NOT_FOUND",
  },
  {
    id: "ico_total_raised_usd",
    label: "ICO Raised",
    cadenceMinutes: 15,
    sourceRef: "ico.launch-platform.totalRaisedUsd",
    readValue: (context) => context.latestProject?.status.totalRaisedUsd ?? null,
    formatValue: (value) => formatUsd(value, 2),
    missingErrorCode: "ICO_PROJECT_NOT_FOUND",
  },
];

function formatInteger(value: number): string {
  return Math.round(value).toLocaleString();
}

function formatUsd(value: number, fractionDigits: number): string {
  return `$${value.toLocaleString(undefined, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })}`;
}

function buildUnavailableMetric(definition: MetricDefinition): ImpactFootprintMetric {
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
    errorCode: definition.missingErrorCode,
  };
}

function buildMetric(
  definition: MetricDefinition,
  context: MetricContext,
  generatedAt: string,
  nowMs: number,
): ImpactFootprintMetric {
  const value = definition.readValue ? definition.readValue(context) : null;
  if (value == null) {
    return buildUnavailableMetric(definition);
  }

  const sourceStatus: ImpactFootprintMetricSourceStatus = "ok";
  const { state, ageMinutes } = resolveMetricState({
    value,
    sourceStatus,
    capturedAt: generatedAt,
    cadenceMinutes: definition.cadenceMinutes,
    nowMs,
  });

  return {
    id: definition.id,
    label: definition.label,
    value,
    displayValue: definition.formatValue(value),
    capturedAt: generatedAt,
    cadenceMinutes: definition.cadenceMinutes,
    state,
    ageMinutes,
    sourceStatus,
    sourceRef: definition.sourceRef,
    errorCode: null,
  };
}

export function buildImpactFootprintFeed(
  options: BuildImpactFootprintOptions = {},
): ImpactFootprintFeed {
  const nowMs = options.nowMs ?? Date.now();
  const generatedAt = new Date(nowMs).toISOString();
  const latestProject =
    [...(options.projects ?? listIcoProjects())].toSorted((a, b) => b.createdAt - a.createdAt)[0] ??
    null;
  const context: MetricContext = { latestProject };

  return {
    generatedAt,
    metrics: METRIC_DEFINITIONS.map((definition) =>
      buildMetric(definition, context, generatedAt, nowMs),
    ),
  };
}
