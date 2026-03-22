import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  getIcoPublicMetrics,
  type IcoPublicMetric,
  type IcoPublicMetricState,
  type IcoPublicMetricsFeed,
  type IcoPublicProjectSnapshot,
} from "../api";

const METRIC_ORDER = [
  "current_price_usd",
  "total_raised_usd",
  "holders_total",
  "supply_sold_tokens",
  "transfer_tax_rate_percent",
  "revenue_share_rate_percent",
] as const;

const METRIC_DETAILS: Record<string, string> = {
  supply_sold_tokens: "Tokens sold so far",
  transfer_tax_rate_percent: "On all transfers",
  revenue_share_rate_percent: "Revenue share rate",
};

const STATE_COPY: Record<IcoPublicMetricState, string> = {
  live: "Live now",
  delayed: "Delayed update",
  stale: "Stale data - refreshing",
  unavailable: "Data temporarily unavailable",
};

const STATE_COLOR: Record<IcoPublicMetricState, string> = {
  live: "#00c853",
  delayed: "#f5a623",
  stale: "#ff6f00",
  unavailable: "#9e9e9e",
};

function formatCapturedAt(capturedAt: string | null): string {
  if (!capturedAt) {
    return "No source data";
  }
  return `Updated ${new Date(capturedAt).toLocaleString()}`;
}

function MetricCard({
  metric,
  detail,
}: {
  metric: IcoPublicMetric | undefined;
  detail?: string;
}): React.ReactElement {
  const state = metric?.state ?? "unavailable";
  const valueText = metric && metric.state !== "unavailable" ? metric.displayValue : "--";
  const sourceText = metric?.sourceRef ?? "source unavailable";

  return (
    <div
      className="card"
      style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 6 }}
    >
      <div
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}
      >
        <span
          style={{
            color: "var(--color-text-muted, #888)",
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: 1,
          }}
        >
          {metric?.label ?? "Metric"}
        </span>
        <span
          className="badge"
          style={{
            background: "transparent",
            border: `1px solid ${STATE_COLOR[state]}`,
            color: STATE_COLOR[state],
            fontSize: 10,
          }}
        >
          {STATE_COPY[state]}
        </span>
      </div>

      <span
        style={{
          fontSize: 24,
          fontWeight: 700,
          color: "var(--color-text)",
          fontFamily: "JetBrains Mono, monospace",
        }}
      >
        {valueText}
      </span>

      {detail && (
        <span style={{ color: "var(--color-text-muted, #888)", fontSize: 12 }}>{detail}</span>
      )}

      <span style={{ color: "var(--color-text-muted, #888)", fontSize: 11 }}>
        {metric ? formatCapturedAt(metric.capturedAt) : "No source data"}
      </span>
      <span style={{ color: "var(--color-text-muted, #888)", fontSize: 11 }}>{sourceText}</span>
    </div>
  );
}

function AllocationBar({
  allocation,
}: {
  allocation: IcoPublicProjectSnapshot["allocation"];
}): React.ReactElement {
  const segments = [
    { label: "Team", value: allocation.team, color: "#ff6600" },
    { label: "Company", value: allocation.companyRound, color: "#4db8ff" },
    { label: "Rev Share", value: allocation.revenueShare, color: "#00c853" },
    { label: "UBC", value: allocation.ubc, color: "#ff69b4" },
  ];

  return (
    <div>
      <div
        style={{
          display: "flex",
          height: 24,
          borderRadius: 6,
          overflow: "hidden",
          marginBottom: 8,
        }}
      >
        {segments.map((segment) => (
          <div
            key={segment.label}
            style={{
              width: `${segment.value * 100}%`,
              background: segment.color,
              transition: "width 0.3s",
            }}
          />
        ))}
      </div>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        {segments.map((segment) => (
          <div
            key={segment.label}
            style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}
          >
            <div style={{ width: 10, height: 10, borderRadius: 2, background: segment.color }} />
            <span style={{ color: "var(--color-text-muted, #888)" }}>{segment.label}</span>
            <span style={{ fontWeight: 600 }}>{Math.round(segment.value * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function BondingCurveChart(): React.ReactElement {
  const width = 600;
  const height = 200;
  const points: string[] = [];

  for (let i = 0; i <= 100; i++) {
    const x = (i / 100) * width;
    const supply = i / 100;
    const price = 0.001 + 0.001 * supply;
    const y = height - (price / 0.002) * height;
    points.push(`${x},${y}`);
  }

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ display: "block", width: "100%" }}
    >
      <defs>
        <linearGradient id="curveGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ff6600" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#ff6600" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon
        points={`0,${height} ${points.join(" ")} ${width},${height}`}
        fill="url(#curveGrad)"
      />
      <polyline points={points.join(" ")} fill="none" stroke="#ff6600" strokeWidth={2} />
      <text x={10} y={height - 5} fill="#666" fontSize={10} fontFamily="JetBrains Mono, monospace">
        Supply →
      </text>
      <text x={10} y={15} fill="#666" fontSize={10} fontFamily="JetBrains Mono, monospace">
        Price ↑
      </text>
      <line x1={0} y1={height / 2} x2={width} y2={height / 2} stroke="#333" strokeDasharray="4" />
      <text
        x={width - 80}
        y={height / 2 - 5}
        fill="#888"
        fontSize={9}
        fontFamily="JetBrains Mono, monospace"
      >
        $2M cap
      </text>
    </svg>
  );
}

export default function ICO(): React.ReactElement {
  const [feed, setFeed] = useState<IcoPublicMetricsFeed | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadMetrics = useCallback(async (refreshMode = false) => {
    if (refreshMode) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const nextFeed = await getIcoPublicMetrics();
      setFeed(nextFeed);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (refreshMode) {
        setRefreshing(false);
      } else {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadMetrics();
  }, [loadMetrics]);

  const project = feed?.project ?? null;
  const metricsById = useMemo(() => {
    const entries = (feed?.metrics ?? []).map((metric) => [metric.id, metric] as const);
    return new Map(entries);
  }, [feed?.metrics]);

  const progressMetric = metricsById.get("bonding_progress_percent");
  const totalRaisedMetric = metricsById.get("total_raised_usd");
  const progressPercent =
    typeof progressMetric?.value === "number"
      ? Math.max(0, Math.min(100, progressMetric.value))
      : 0;
  const progressState = progressMetric?.state ?? "unavailable";
  const progressLabel =
    progressState === "unavailable"
      ? STATE_COPY.unavailable
      : `${progressPercent.toFixed(1)}% to target`;

  if (loading && !feed) {
    return (
      <div className="page-content">
        <h2 className="page-title">&gt; ICO</h2>
        <p className="text-muted">Loading public metrics...</p>
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 8,
            flexWrap: "wrap",
          }}
        >
          <h1 className="page-title" style={{ marginBottom: 0 }}>
            {project?.name ?? "NoxSoft ICO"}
          </h1>
          {project?.symbol ? (
            <span
              className="badge"
              style={{ background: "#1a2a3a", color: "#4db8ff", fontSize: 14, padding: "4px 10px" }}
            >
              ${project.symbol}
            </span>
          ) : null}
          {(project?.chains ?? []).map((chain) => (
            <span key={chain} className="badge" style={{ background: "#1a1a1a", color: "#888" }}>
              {chain}
            </span>
          ))}
          <button
            className="btn btn-secondary"
            onClick={() => void loadMetrics(true)}
            disabled={refreshing}
            style={{ marginLeft: "auto" }}
          >
            {refreshing ? "Refreshing..." : "Refresh Metrics"}
          </button>
        </div>

        <p style={{ color: "var(--color-text-muted, #888)", margin: 0, fontSize: 14 }}>
          Real source-bound metrics only. If a source is unavailable, the UI shows that state
          instead of placeholder numbers.
        </p>
        {feed?.generatedAt ? (
          <p style={{ color: "var(--color-text-muted, #888)", margin: "6px 0 0", fontSize: 12 }}>
            Snapshot generated: {new Date(feed.generatedAt).toLocaleString()}
          </p>
        ) : null}
      </div>

      {error ? (
        <div
          className="card"
          style={{ borderColor: "var(--color-error)", marginBottom: 16, padding: 16 }}
        >
          <span style={{ color: "var(--color-error)" }}>Failed to load ICO metrics: {error}</span>
        </div>
      ) : null}

      {!project ? (
        <div className="card" style={{ marginBottom: 16, padding: 16 }}>
          <span style={{ color: "var(--color-text-muted, #888)" }}>
            No ICO project is configured in local state yet. Metrics remain unavailable until a
            project is created.
          </span>
        </div>
      ) : null}

      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginBottom: 8,
            fontSize: 13,
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <span style={{ color: "var(--color-text-muted, #888)" }}>Bonding Curve Progress</span>
          <span
            style={{
              fontFamily: "JetBrains Mono, monospace",
              color: STATE_COLOR[progressState],
            }}
          >
            {progressLabel}
          </span>
        </div>

        <div style={{ height: 8, background: "#1a1a1a", borderRadius: 4, overflow: "hidden" }}>
          <div
            style={{
              height: "100%",
              width: `${progressPercent}%`,
              background:
                progressState === "unavailable"
                  ? "#555"
                  : "linear-gradient(90deg, #ff6600, #FFD700)",
              borderRadius: 4,
              transition: "width 0.5s",
            }}
          />
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: 6,
            fontSize: 11,
            color: "#666",
          }}
        >
          <span>{totalRaisedMetric?.displayValue ?? "--"} raised</span>
          <span>
            {typeof project?.targetRaiseUsd === "number"
              ? `$${project.targetRaiseUsd.toLocaleString()} target`
              : "Target unavailable"}
          </span>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 12,
          marginBottom: 20,
        }}
      >
        {METRIC_ORDER.map((metricId) => (
          <MetricCard
            key={metricId}
            metric={metricsById.get(metricId)}
            detail={METRIC_DETAILS[metricId]}
          />
        ))}
      </div>

      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        <h3 style={{ marginTop: 0, marginBottom: 12, fontSize: 14 }}>Bonding Curve</h3>
        <BondingCurveChart />
      </div>

      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        <h3 style={{ marginTop: 0, marginBottom: 12, fontSize: 14 }}>Token Allocation</h3>
        {project ? (
          <AllocationBar allocation={project.allocation} />
        ) : (
          <p style={{ color: "var(--color-text-muted, #888)", margin: 0 }}>
            Allocation becomes available after an ICO project is initialized.
          </p>
        )}
      </div>

      <div className="card" style={{ padding: 20 }}>
        <h3 style={{ marginTop: 0, marginBottom: 8, fontSize: 14 }}>PBC Verification Required</h3>
        <p style={{ color: "var(--color-text-muted, #888)", fontSize: 13, margin: 0 }}>
          Only verified Public Benefit Corporations can launch ICOs on NoxSoft. Prove you are
          building for public benefit before launch.
        </p>
      </div>
    </div>
  );
}
