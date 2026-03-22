import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getConfigSnapshot,
  getImpactFootprintMetrics,
  getProviderConfig,
  getRegistrationStatus,
  getRuntimeInspect,
  getStatus,
  getVoiceWakeConfig,
  patchConfigValue,
  patchMissionState,
  registerInviteCode,
  saveRawConfig,
  setProviderConfig as saveProviderConfig,
  setRegistrationToken,
  setHeartbeatsEnabled,
  setWorkingMode,
  setVoiceWakeConfig,
  tailLogs,
  toggleProviderRotation,
  wakeHeartbeat,
  type ConfigSnapshot,
  type DaemonStatus,
  type ImpactFootprintFeed,
  type IcoPublicMetricState,
  type LogsTailResponse,
  type MissionAutoTogglePolicy,
  type ProviderConfig,
  type RegistrationStatus,
  type RuntimeInspectResponse,
  type WorkingMode,
  type SubagentStatus,
} from "../api";
import MarkdownText from "../components/MarkdownText";
import { buildOperatorConnectParams, readGatewayChallengeNonce } from "../gateway-connect";
import { resolveGatewayConnectAuth, resolveGatewayWsUrl } from "../gateway-connection";
import {
  buildHeartbeatPatch,
  readHeartbeatFormState,
  type HeartbeatFormState,
} from "../lib/heartbeat";

const GATEWAY_WS_URL = resolveGatewayWsUrl();

// ── Message parsing ──────────────────────────────────────────────────────────
const DIRECTIVE_TAG_RE = /\[\[\s*(?:reply_to_current|reply_to\s*:[^\]\n]*|audio_as_voice)\s*\]\]/gi;

type ParsedDirective = { tag: string; raw: string };

/** Parse agent text into clean display text + extracted directives. */
function parseAgentText(raw: string): { text: string; directives: ParsedDirective[] } {
  const directives: ParsedDirective[] = [];
  const text = raw
    .replace(DIRECTIVE_TAG_RE, (match) => {
      const tag = match.replace(/[[\]\s]/g, "").trim();
      directives.push({ tag, raw: match.trim() });
      return "";
    })
    .replace(/[ \t]+/g, " ")
    .trim();
  return { text, directives };
}

const CHAT_SESSION_KEY = "main";
const GATEWAY_PROTOCOL_VERSION = 3;
const DEFAULT_DESCRIPTION =
  "Persistent NoxSoft agent orchestrating ANIMA continuity, mission control, and delivery.";
const FOOTPRINT_STATE_COPY: Record<IcoPublicMetricState, string> = {
  live: "Live now",
  delayed: "Delayed update",
  stale: "Stale data",
  unavailable: "Source unavailable",
};
const FOOTPRINT_METRIC_ORDER = [
  { id: "users_total", label: "Users" },
  { id: "newsletter_subscribers_total", label: "Newsletter Subs" },
  { id: "downloads_total", label: "Downloads" },
  { id: "promo_videos_hosted_total", label: "Promo Videos" },
  { id: "ico_holders_total", label: "ICO Holders" },
  { id: "ico_total_raised_usd", label: "ICO Raised" },
] as const;

type RpcResponseFrame = {
  type: "res";
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: { message?: string };
};

type RpcEventFrame = {
  type: "event";
  event: string;
  payload?: unknown;
};

type ChatEventPayload = {
  runId?: string;
  sessionKey?: string;
  state?: "delta" | "final" | "error" | "aborted";
  message?: unknown;
  errorMessage?: string;
};

// ── Agent event types ────────────────────────────────────────────────────────
type AgentEventPayload = {
  runId?: string;
  seq?: number;
  stream?: "lifecycle" | "tool" | "assistant" | "error";
  ts?: number;
  data?: Record<string, unknown>;
  sessionKey?: string;
};

type ToolActivity = {
  id: string;
  name: string;
  input?: string;
  result?: string;
  status: "running" | "done" | "error";
  timestamp: number;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  timestamp: number;
  directives?: ParsedDirective[];
  toolActivity?: ToolActivity[];
  runId?: string;
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  addEventListener: (
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ) => void;
  removeEventListener: (
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ) => void;
  start: () => void;
  stop: () => void;
};

type SpeechRecognitionResultEventLike = Event & {
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
};

type SpeechRecognitionErrorEventLike = Event & {
  error?: string;
};

type MemorySettingsDraft = {
  searchEnabled: boolean;
  provider: string;
  sessionMemory: boolean;
  extraPaths: string;
  memoryFlushEnabled: boolean;
  memoryFlushPrompt: string;
  memoryFlushSystemPrompt: string;
  browseLimit: number;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function getString(record: Record<string, unknown> | null, key: string, fallback = ""): string {
  const value = record?.[key];
  return typeof value === "string" ? value : fallback;
}

function getBoolean(
  record: Record<string, unknown> | null,
  key: string,
  fallback = false,
): boolean {
  const value = record?.[key];
  return typeof value === "boolean" ? value : fallback;
}

function getNumber(record: Record<string, unknown> | null, key: string, fallback: number): number {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readMemorySettingsDraft(configSnapshot: ConfigSnapshot | null): MemorySettingsDraft {
  const cfg = asRecord(configSnapshot?.config);
  const agents = asRecord(cfg?.agents);
  const defaults = asRecord(agents?.defaults);
  const memorySearch = asRecord(defaults?.memorySearch);
  const experimental = asRecord(memorySearch?.experimental);
  const compaction = asRecord(defaults?.compaction);
  const memoryFlush = asRecord(compaction?.memoryFlush);
  const extraPaths = Array.isArray(memorySearch?.extraPaths)
    ? memorySearch?.extraPaths.filter((value): value is string => typeof value === "string")
    : [];
  return {
    searchEnabled: getBoolean(memorySearch, "enabled", true),
    provider: getString(memorySearch, "provider", "openai"),
    sessionMemory: getBoolean(experimental, "sessionMemory", false),
    extraPaths: extraPaths.join(", "),
    memoryFlushEnabled: getBoolean(memoryFlush, "enabled", true),
    memoryFlushPrompt: getString(memoryFlush, "prompt"),
    memoryFlushSystemPrompt: getString(memoryFlush, "systemPrompt"),
    browseLimit: getNumber(memorySearch, "browseLimit", 200),
  };
}

function makeId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function extractText(value: unknown): string {
  if (!value) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => extractText(item))
      .join("\n")
      .trim();
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.text === "string") {
      return record.text;
    }
    if (record.type === "text" && typeof record.text === "string") {
      return record.text;
    }
    if ("message" in record) {
      return extractText(record.message);
    }
    if ("content" in record) {
      return extractText(record.content);
    }
  }
  return "";
}

function mergeStreamText(current: string, incoming: string): string {
  const next = incoming.replace(/\r/g, "");
  if (!next) {
    return current;
  }
  if (!current || next === current) {
    return next;
  }
  if (next.startsWith(current) || next.includes(current)) {
    return next;
  }
  const maxOverlap = Math.min(current.length, next.length);
  for (let i = maxOverlap; i > 0; i -= 1) {
    if (current.slice(-i) === next.slice(0, i)) {
      return `${current}${next.slice(i)}`;
    }
  }
  return `${current}${next}`;
}

function normalizeHistoryMessages(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const record = item as Record<string, unknown>;
      if (record.role !== "user" && record.role !== "assistant") {
        return null;
      }
      const text = extractText(record.content).trim();
      if (!text) {
        return null;
      }
      return {
        id: makeId(),
        role: record.role,
        text,
        timestamp: typeof record.timestamp === "number" ? record.timestamp : Date.now(),
      } satisfies ChatMessage;
    })
    .filter((row): row is ChatMessage => Boolean(row));
}

function formatRelativeTime(value: number | string | null | undefined): string {
  if (!value) {
    return "never";
  }
  const ts = typeof value === "number" ? value : new Date(value).getTime();
  if (!Number.isFinite(ts)) {
    return "unknown";
  }
  const deltaMs = Date.now() - ts;
  const deltaMinutes = Math.round(deltaMs / 60_000);
  if (Math.abs(deltaMinutes) < 1) {
    return "just now";
  }
  if (Math.abs(deltaMinutes) < 60) {
    return `${deltaMinutes}m ago`;
  }
  const hours = Math.round(deltaMinutes / 60);
  if (Math.abs(hours) < 24) {
    return `${hours}h ago`;
  }
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function formatSubagentLabel(key: string): string {
  const trimmed = key.trim();
  if (!trimmed) {
    return "subagent";
  }
  const marker = ":subagent:";
  const markerIndex = trimmed.lastIndexOf(marker);
  if (markerIndex >= 0) {
    return `subagent:${trimmed.slice(markerIndex + marker.length)}`;
  }
  return trimmed.length > 56 ? `${trimmed.slice(0, 53)}...` : trimmed;
}

function StatusPill(props: { tone?: "accent" | "success" | "warning" | "error"; label: string }) {
  const tone = props.tone ?? "accent";
  return <span className={`badge badge-${tone}`}>{props.label}</span>;
}

// ── Collapsible Section wrapper for progressive disclosure ───────────────────
const sectionStyles: Record<string, React.CSSProperties> = {
  wrapper: {
    borderRadius: "0.5rem",
    overflow: "hidden",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0.75rem 1rem",
    cursor: "pointer",
    userSelect: "none",
    gap: "0.75rem",
    borderBottom: "1px solid transparent",
  },
  headerOpen: {
    borderBottomColor: "var(--color-border, rgba(255,255,255,0.08))",
  },
  headerLeft: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    minWidth: 0,
    flex: 1,
  },
  chevron: {
    transition: "transform 0.2s ease",
    fontSize: "0.75rem",
    color: "var(--color-text-muted, #888)",
    flexShrink: 0,
  },
  chevronOpen: {
    transform: "rotate(90deg)",
  },
  title: {
    fontSize: "0.875rem",
    fontWeight: 600,
    color: "var(--color-text, #e0e0e0)",
  },
  badge: {
    flexShrink: 0,
  },
  body: {
    display: "grid",
    gridTemplateRows: "0fr",
    overflow: "hidden",
    transition: "grid-template-rows 0.25s ease, opacity 0.2s ease",
  },
  bodyOpen: {
    gridTemplateRows: "1fr",
    opacity: 1,
  },
  bodyClosed: {
    gridTemplateRows: "0fr",
    opacity: 0,
  },
  bodyInner: {
    padding: "0.75rem 1rem 1rem",
    minHeight: 0,
    overflow: "hidden",
  },
};

function Section(props: {
  title: string;
  defaultOpen?: boolean;
  badge?: React.ReactNode;
  headerRight?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(props.defaultOpen ?? false);

  return (
    <div className={props.className || "card"} style={sectionStyles.wrapper}>
      <div
        style={{
          ...sectionStyles.header,
          ...(open ? sectionStyles.headerOpen : {}),
        }}
        onClick={() => setOpen((v) => !v)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((v) => !v);
          }
        }}
      >
        <div style={sectionStyles.headerLeft}>
          <span
            style={{
              ...sectionStyles.chevron,
              ...(open ? sectionStyles.chevronOpen : {}),
            }}
          >
            &#9654;
          </span>
          <span style={sectionStyles.title}>{props.title}</span>
        </div>
        <div style={sectionStyles.badge}>
          {props.badge}
          {props.headerRight}
        </div>
      </div>
      <div
        style={{
          ...sectionStyles.body,
          ...(open ? sectionStyles.bodyOpen : sectionStyles.bodyClosed),
        }}
      >
        <div style={sectionStyles.bodyInner}>{props.children}</div>
      </div>
    </div>
  );
}

function RuntimeStat(props: { label: string; value: string; detail?: string }) {
  return (
    <div className="runtime-stat">
      <div className="runtime-stat-label">{props.label}</div>
      <div className="runtime-stat-value">{props.value}</div>
      {props.detail ? <div className="runtime-stat-detail">{props.detail}</div> : null}
    </div>
  );
}

function WorkingModeToggle(props: {
  value: WorkingMode;
  busy: boolean;
  onChange: (mode: WorkingMode) => void;
}) {
  return (
    <div className="segmented-control">
      {(["read", "write"] as const).map((mode) => (
        <button
          key={mode}
          type="button"
          className={`segment ${props.value === mode ? "active" : ""}`}
          disabled={props.busy}
          onClick={() => props.onChange(mode)}
        >
          {mode.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

function SubagentStatusCard({ subagents }: { subagents: SubagentStatus | undefined }) {
  if (!subagents) {
    return null;
  }
  return (
    <div className="card">
      <div className="card-header">
        <div>
          <div className="card-title">Subagents</div>
          <div className="card-subtitle">Native orchestration visibility</div>
        </div>
        <StatusPill label={`${subagents.total} tracked`} />
      </div>
      <div className="stats-grid compact">
        <RuntimeStat label="Active" value={String(subagents.active)} />
        <RuntimeStat label="Recent" value={String(subagents.recent)} />
        <RuntimeStat label="Failed" value={String(subagents.failed)} />
      </div>
      {subagents.latest.length === 0 ? (
        <div className="empty-note">No subagent activity yet.</div>
      ) : (
        <div className="activity-list">
          {subagents.latest.map((entry) => (
            <div key={`${entry.key}:${entry.updatedAt ?? "none"}`} className="activity-row">
              <div>
                <div className="mono subtle">{formatSubagentLabel(entry.key)}</div>
                <div className="runtime-stat-detail">{formatRelativeTime(entry.updatedAt)}</div>
              </div>
              <StatusPill
                tone={
                  entry.status === "failed"
                    ? "error"
                    : entry.status === "active"
                      ? "success"
                      : entry.status === "recent"
                        ? "accent"
                        : "warning"
                }
                label={entry.status}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Expandable tool activity panel (shown in finalized messages) ──────────────
function ToolActivityPanel({ tools }: { tools: ToolActivity[] }) {
  const [expanded, setExpanded] = useState(false);
  const done = tools.filter((t) => t.status === "done").length;
  const errors = tools.filter((t) => t.status === "error").length;

  return (
    <div className="tool-activity-panel">
      <button type="button" className="tool-activity-toggle" onClick={() => setExpanded((v) => !v)}>
        <span className="tool-activity-icon">{expanded ? "▾" : "▸"}</span>
        <span className="tool-activity-summary">
          {tools.length} tool{tools.length !== 1 ? "s" : ""} used
          {errors > 0 && <span className="tool-count-error"> · {errors} failed</span>}
          {done > 0 && !errors && <span className="tool-count-ok"> · all succeeded</span>}
        </span>
      </button>
      {expanded && (
        <div className="tool-activity-list">
          {tools.map((tool) => (
            <ToolActivityItem key={tool.id} tool={tool} />
          ))}
        </div>
      )}
    </div>
  );
}

function ToolActivityItem({ tool }: { tool: ToolActivity }) {
  const [showDetail, setShowDetail] = useState(false);
  const statusIcon = tool.status === "done" ? "✓" : tool.status === "error" ? "✗" : "◌";
  const statusClass =
    tool.status === "done" ? "success" : tool.status === "error" ? "error" : "running";

  return (
    <div className={`tool-activity-item ${statusClass}`}>
      <button
        type="button"
        className="tool-activity-item-header"
        onClick={() => setShowDetail((v) => !v)}
      >
        <span className={`tool-status-icon ${statusClass}`}>{statusIcon}</span>
        <span className="tool-name">{tool.name}</span>
        {(tool.input || tool.result) && (
          <span className="tool-detail-toggle">{showDetail ? "▾" : "▸"}</span>
        )}
      </button>
      {showDetail && (tool.input || tool.result) && (
        <div className="tool-detail-body">
          {tool.input && (
            <div className="tool-detail-section">
              <div className="tool-detail-label">Input</div>
              <pre className="tool-detail-pre">{tool.input}</pre>
            </div>
          )}
          {tool.result && (
            <div className="tool-detail-section">
              <div className="tool-detail-label">Result</div>
              <pre className="tool-detail-pre">{tool.result}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Live tool activity (shown during streaming) ─────────────────────────────
function LiveToolActivity({
  runId,
  activity,
}: {
  runId: string | null;
  activity: Map<string, ToolActivity[]>;
}) {
  const tools = runId ? activity.get(runId) : undefined;
  if (!tools || tools.length === 0) {
    return null;
  }

  return (
    <div className="live-tool-activity">
      {tools.map((tool) => (
        <div key={tool.id} className={`live-tool-chip ${tool.status}`}>
          <span className="live-tool-dot" />
          <span className="live-tool-name">{tool.name}</span>
        </div>
      ))}
    </div>
  );
}

// ── Directive badges (subtle indicators for parsed directives) ───────────────
function DirectiveBadges({ directives }: { directives: ParsedDirective[] }) {
  return (
    <div className="directive-badges">
      {directives.map((d, i) => (
        <span key={i} className="directive-badge" title={d.raw}>
          {d.tag.replace(/_/g, " ")}
        </span>
      ))}
    </div>
  );
}

export default function Dashboard(): React.ReactElement {
  const [status, setStatus] = useState<DaemonStatus | null>(null);
  const [runtime, setRuntime] = useState<RuntimeInspectResponse | null>(null);
  const [registration, setRegistration] = useState<RegistrationStatus | null>(null);
  const [configSnapshot, setConfigSnapshot] = useState<ConfigSnapshot | null>(null);
  const [heartbeatForm, setHeartbeatForm] = useState<HeartbeatFormState>(() =>
    readHeartbeatFormState(null),
  );
  const [configRaw, setConfigRaw] = useState("{\n}\n");
  const [registrationDraft, setRegistrationDraft] = useState({
    token: "",
    inviteCode: "",
    agentName: "",
    displayName: "",
    description: DEFAULT_DESCRIPTION,
  });
  const [providerConfig, setProviderConfig] = useState<ProviderConfig | null>(null);
  const [voiceWakeInput, setVoiceWakeInput] = useState("");
  const [memoryDraft, setMemoryDraft] = useState<MemorySettingsDraft>(() =>
    readMemorySettingsDraft(null),
  );
  const [autoToggleDraft, setAutoToggleDraft] = useState<MissionAutoTogglePolicy | null>(null);
  const [impactFootprint, setImpactFootprint] = useState<ImpactFootprintFeed | null>(null);
  const [logsState, setLogsState] = useState<LogsTailResponse | null>(null);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const [modeSaving, setModeSaving] = useState(false);
  const [heartbeatSaving, setHeartbeatSaving] = useState(false);
  const [heartbeatToggleSaving, setHeartbeatToggleSaving] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [wakeText, setWakeText] = useState(
    "Check chat.noxsoft.net, sync mission control, and report anything needing action.",
  );

  const [chatConnected, setChatConnected] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatError, setChatError] = useState<string | null>(null);
  const [chatBusy, setChatBusy] = useState(false);
  const [chatStream, setChatStream] = useState("");

  const [speechSupported, setSpeechSupported] = useState(false);
  const [speechListening, setSpeechListening] = useState(false);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const [voiceNames, setVoiceNames] = useState<string[]>([]);

  const [runToolActivity, setRunToolActivity] = useState<Map<string, ToolActivity[]>>(new Map());
  const runToolActivityRef = useRef<Map<string, ToolActivity[]>>(new Map());
  useEffect(() => {
    runToolActivityRef.current = runToolActivity;
  }, [runToolActivity]);

  const wsRef = useRef<WebSocket | null>(null);
  const pendingRef = useRef<Map<string, PendingRequest>>(new Map());
  const reconnectTimerRef = useRef<number | null>(null);
  const connectTimerRef = useRef<number | null>(null);
  const activeRunIdRef = useRef<string | null>(null);
  const chatStreamRef = useRef<string>("");
  const feedBottomRef = useRef<HTMLDivElement | null>(null);
  const speechRecognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const spokenMessageIdsRef = useRef<Set<string>>(new Set());

  const assistantName =
    runtime?.assistant?.name?.trim() || registration?.agent?.display_name || "ANIMA";
  const workingMode = runtime?.mission?.state?.workingMode ?? "write";
  const repoStatus = runtime?.mission?.repo ?? runtime?.mission?.state?.repo;
  const speechState = runtime?.mission?.state?.speech;
  const footprintMetrics = impactFootprint?.metrics ?? [];
  const footprintMetricsById = useMemo(
    () => new Map(footprintMetrics.map((metric) => [metric.id, metric] as const)),
    [footprintMetrics],
  );
  const footprintAvailableCount = footprintMetrics.filter(
    (metric) => metric.state !== "unavailable",
  ).length;
  const footprintTotalCount = FOOTPRINT_METRIC_ORDER.length;
  const footprintBadgeTone: "accent" | "success" | "warning" =
    footprintAvailableCount === 0
      ? "warning"
      : footprintAvailableCount === footprintTotalCount
        ? "success"
        : "accent";

  const refreshDashboard = useCallback(async () => {
    setRefreshing(true);
    try {
      const [
        nextStatus,
        nextRuntime,
        nextRegistration,
        nextConfig,
        nextLogs,
        nextProviders,
        nextVoiceWake,
        nextFootprint,
      ] = await Promise.all([
        getStatus(),
        getRuntimeInspect(),
        getRegistrationStatus(),
        getConfigSnapshot(),
        tailLogs().catch(() => null),
        getProviderConfig().catch(() => null),
        getVoiceWakeConfig().catch(() => ({ triggers: [] })),
        getImpactFootprintMetrics().catch(() => null),
      ]);
      setStatus(nextStatus);
      setRuntime(nextRuntime);
      setRegistration(nextRegistration);
      setConfigSnapshot(nextConfig);
      setConfigRaw(typeof nextConfig.raw === "string" ? nextConfig.raw : "{\n}\n");
      setHeartbeatForm(readHeartbeatFormState(nextConfig));
      setRegistrationDraft({
        token: nextRegistration.tokenPreview || "",
        inviteCode: "",
        agentName: nextRegistration.suggestedIdentity.name,
        displayName: nextRegistration.suggestedIdentity.displayName,
        description: DEFAULT_DESCRIPTION,
      });
      setProviderConfig(nextProviders);
      setVoiceWakeInput(nextVoiceWake.triggers.join(", "));
      setMemoryDraft(readMemorySettingsDraft(nextConfig));
      setAutoToggleDraft(nextRuntime.mission.state.autoToggle);
      setImpactFootprint(nextFootprint);
      if (nextLogs) {
        setLogsState(nextLogs);
      }
      setDashboardError(null);
    } catch (error) {
      setDashboardError(error instanceof Error ? error.message : String(error));
    } finally {
      setRefreshing(false);
      setInitialLoadDone(true);
    }
  }, []);

  const logsCursorRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    logsCursorRef.current = logsState?.cursor;
  }, [logsState?.cursor]);

  const refreshLogs = useCallback(async () => {
    try {
      const next = await tailLogs(logsCursorRef.current);
      setLogsState((current) => {
        if (!current || next.reset) {
          return next;
        }
        return {
          ...next,
          lines: [...current.lines, ...next.lines].slice(-320),
        };
      });
    } catch {
      // Keep the dashboard usable even when logs are unavailable.
    }
  }, []);

  useEffect(() => {
    void refreshDashboard();
    const interval = window.setInterval(() => {
      void refreshDashboard();
    }, 15_000);
    const logInterval = window.setInterval(() => {
      void refreshLogs();
    }, 4_000);
    return () => {
      window.clearInterval(interval);
      window.clearInterval(logInterval);
    };
  }, [refreshDashboard, refreshLogs]);

  useEffect(() => {
    chatStreamRef.current = chatStream;
  }, [chatStream]);

  useEffect(() => {
    feedBottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [chatMessages, chatStream]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const synth = window.speechSynthesis;
    if (!synth) {
      return;
    }
    const updateVoices = () => {
      const names = synth
        .getVoices()
        .map((voice) => voice.name)
        .filter(Boolean);
      setVoiceNames(names);
    };
    updateVoices();
    synth.addEventListener?.("voiceschanged", updateVoices);
    return () => synth.removeEventListener?.("voiceschanged", updateVoices);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const ctor =
      (window as Window & { SpeechRecognition?: new () => SpeechRecognitionLike })
        .SpeechRecognition ||
      (window as Window & { webkitSpeechRecognition?: new () => SpeechRecognitionLike })
        .webkitSpeechRecognition;
    if (!ctor) {
      setSpeechSupported(false);
      speechRecognitionRef.current = null;
      return;
    }

    setSpeechSupported(true);
    const recognition = new ctor();
    recognition.continuous = speechState?.continuous ?? true;
    recognition.interimResults = true;
    recognition.lang = speechState?.lang || "en-US";
    const handleResult = (rawEvent: Event) => {
      const event = rawEvent as SpeechRecognitionResultEventLike;
      let transcript = "";
      for (let i = 0; i < event.results.length; i += 1) {
        const result = event.results[i];
        const alt = result?.[0];
        if (alt?.transcript) {
          transcript += alt.transcript;
        }
      }
      if (transcript.trim()) {
        setChatInput(transcript.trim());
      }
    };
    const handleError = (rawEvent: Event) => {
      const event = rawEvent as SpeechRecognitionErrorEventLike;
      setSpeechError(event.error || "Voice capture failed.");
      setSpeechListening(false);
    };
    const handleEnd = () => {
      setSpeechListening(false);
    };
    recognition.addEventListener("result", handleResult);
    recognition.addEventListener("error", handleError);
    recognition.addEventListener("end", handleEnd);
    speechRecognitionRef.current = recognition;

    return () => {
      recognition.removeEventListener("result", handleResult);
      recognition.removeEventListener("error", handleError);
      recognition.removeEventListener("end", handleEnd);
      recognition.stop();
      speechRecognitionRef.current = null;
    };
  }, [speechState?.continuous, speechState?.lang]);

  useEffect(() => {
    if (!speechState?.autoSpeak || typeof window === "undefined" || !window.speechSynthesis) {
      return;
    }
    const latest = chatMessages.toReversed().find((message) => message.role === "assistant");
    if (!latest || spokenMessageIdsRef.current.has(latest.id)) {
      return;
    }
    const utterance = new SpeechSynthesisUtterance(latest.text);
    utterance.lang = speechState.lang || "en-US";
    utterance.rate = speechState.rate || 1;
    utterance.pitch = speechState.pitch || 1;
    if (speechState.voiceName) {
      const voice = window.speechSynthesis
        .getVoices()
        .find((candidate) => candidate.name === speechState.voiceName);
      if (voice) {
        utterance.voice = voice;
      }
    }
    spokenMessageIdsRef.current.add(latest.id);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }, [chatMessages, speechState]);

  const sendRequest = useMemo(() => {
    return function request(method: string, params?: unknown): Promise<unknown> {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        return Promise.reject(new Error("Gateway websocket is not connected"));
      }

      const id = makeId();
      const frame = { type: "req", id, method, params };

      return new Promise((resolve, reject) => {
        pendingRef.current.set(id, {
          resolve,
          reject: (error) => reject(error),
        });

        try {
          ws.send(JSON.stringify(frame));
        } catch (error) {
          pendingRef.current.delete(id);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let connectInFlight = false;
    let didConnect = false;
    let connectNonce: string | undefined;

    function clearPendingWithError(message: string) {
      for (const pending of pendingRef.current.values()) {
        pending.reject(new Error(message));
      }
      pendingRef.current.clear();
    }

    async function loadHistory() {
      try {
        const response = await sendRequest("chat.history", {
          sessionKey: CHAT_SESSION_KEY,
          limit: 120,
        });
        if (disposed) {
          return;
        }
        const payload = response as { messages?: unknown[] } | null;
        setChatMessages(normalizeHistoryMessages(payload?.messages));
      } catch (error) {
        if (!disposed) {
          setChatError(error instanceof Error ? error.message : String(error));
        }
      }
    }

    async function sendConnect() {
      if (disposed || connectInFlight || didConnect) {
        return;
      }
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        // WebSocket closed before we could send connect — the close handler
        // will schedule a reconnect, so silently bail out.
        return;
      }
      connectInFlight = true;
      try {
        const auth = resolveGatewayConnectAuth();
        if (!auth) {
          throw new Error(
            "Gateway token missing. Re-open this page once with ?token=ANIMA_GATEWAY_TOKEN.",
          );
        }
        const connectParams = await buildOperatorConnectParams({
          minProtocol: GATEWAY_PROTOCOL_VERSION,
          maxProtocol: GATEWAY_PROTOCOL_VERSION,
          client: {
            id: "anima-control-ui",
            version: "1.0.0",
            platform: "web",
            mode: "webchat",
          },
          scopes: ["operator.read", "operator.admin"],
          caps: [],
          auth,
          nonce: connectNonce,
        });
        await sendRequest("connect", connectParams);
        if (disposed) {
          return;
        }
        didConnect = true;
        setChatConnected(true);
        setChatError(null);
        void loadHistory();
      } catch (error) {
        if (!disposed) {
          setChatConnected(false);
          const msg = error instanceof Error ? error.message : String(error);
          // Don't surface transient websocket disconnects as errors — the
          // reconnect loop will handle it.
          if (msg !== "Gateway websocket is not connected") {
            setChatError(msg);
          }
        }
      } finally {
        connectInFlight = false;
      }
    }

    function scheduleReconnect() {
      if (disposed || reconnectTimerRef.current !== null) {
        return;
      }
      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null;
        if (!disposed) {
          connect();
        }
      }, 1500);
    }

    function handleAgentEvent(payload: AgentEventPayload) {
      if (payload.sessionKey && payload.sessionKey !== CHAT_SESSION_KEY) {
        return;
      }
      const runId = payload.runId;
      if (!runId) {
        return;
      }

      if (payload.stream === "tool") {
        const d = payload.data || {};
        const name = typeof d.name === "string" ? d.name : typeof d.tool === "string" ? d.tool : "";
        if (!name) {
          return;
        }
        const phase = typeof d.phase === "string" ? d.phase : "";
        const inputStr = d.input
          ? typeof d.input === "string"
            ? d.input
            : JSON.stringify(d.input, null, 2)
          : undefined;
        const resultStr = d.result
          ? typeof d.result === "string"
            ? d.result
            : JSON.stringify(d.result, null, 2)
          : undefined;

        setRunToolActivity((prev) => {
          const existing = prev.get(runId) || [];
          if (phase === "start" || phase === "call") {
            return new Map(prev).set(runId, [
              ...existing,
              { id: makeId(), name, input: inputStr, status: "running", timestamp: Date.now() },
            ]);
          }
          // Update existing tool entry with result
          const updated = [...existing];
          const last = updated.findLastIndex((t) => t.name === name && t.status === "running");
          if (last >= 0) {
            updated[last] = {
              ...updated[last],
              status: phase === "error" ? "error" : "done",
              result: resultStr || updated[last].result,
            };
          }
          return new Map(prev).set(runId, updated);
        });
      }

      if (payload.stream === "lifecycle") {
        const phase = typeof payload.data?.phase === "string" ? payload.data.phase : "";
        if (phase === "start") {
          setRunToolActivity((prev) => new Map(prev).set(runId, []));
        }
      }
    }

    function handleChatEvent(payload: ChatEventPayload) {
      if (payload.sessionKey && payload.sessionKey !== CHAT_SESSION_KEY) {
        return;
      }

      if (payload.state === "delta") {
        const delta = extractText(payload.message);
        if (delta) {
          setChatStream((prev) => mergeStreamText(prev, delta));
        }
        return;
      }

      if (payload.state === "final") {
        const currentRunId = activeRunIdRef.current;
        if (payload.runId && currentRunId && payload.runId !== currentRunId) {
          return;
        }
        const rawText = extractText(payload.message).trim() || chatStreamRef.current.trim();
        const { text: finalText, directives } = parseAgentText(rawText);
        const runId = payload.runId || activeRunIdRef.current || undefined;
        const tools = runId ? runToolActivityRef.current.get(runId) : undefined;
        if (finalText || (tools && tools.length > 0)) {
          setChatMessages((prev) => [
            ...prev,
            {
              id: makeId(),
              role: "assistant",
              text: finalText,
              timestamp: Date.now(),
              directives: directives.length > 0 ? directives : undefined,
              toolActivity: tools && tools.length > 0 ? tools : undefined,
              runId: runId || undefined,
            },
          ]);
        }
        if (runId) {
          setRunToolActivity((prev) => {
            const next = new Map(prev);
            next.delete(runId);
            return next;
          });
        }
        activeRunIdRef.current = null;
        setChatBusy(false);
        setChatStream("");
        return;
      }

      if (payload.state === "error") {
        const message = payload.errorMessage || "Chat run failed";
        setChatError(message);
        setChatMessages((prev) => [
          ...prev,
          {
            id: makeId(),
            role: "assistant",
            text: `Error: ${message}`,
            timestamp: Date.now(),
          },
        ]);
        activeRunIdRef.current = null;
        setChatBusy(false);
        setChatStream("");
        return;
      }

      if (payload.state === "aborted") {
        activeRunIdRef.current = null;
        setChatBusy(false);
        setChatStream("");
      }
    }

    function connect() {
      connectInFlight = false;
      didConnect = false;
      connectNonce = undefined;
      const ws = new WebSocket(GATEWAY_WS_URL);
      wsRef.current = ws;
      setChatConnected(false);

      ws.addEventListener("open", () => {
        if (connectTimerRef.current) {
          window.clearTimeout(connectTimerRef.current);
        }
        connectTimerRef.current = window.setTimeout(() => {
          connectTimerRef.current = null;
          void sendConnect();
        }, 300);
      });

      ws.addEventListener("message", (event) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(String(event.data));
        } catch {
          return;
        }
        const frame = parsed as RpcResponseFrame | RpcEventFrame;
        if (frame.type === "res") {
          const pending = pendingRef.current.get(frame.id);
          if (!pending) {
            return;
          }
          pendingRef.current.delete(frame.id);
          if (frame.ok) {
            pending.resolve(frame.payload);
          } else {
            pending.reject(new Error(frame.error?.message || "Gateway request failed"));
          }
          return;
        }
        if (frame.type === "event") {
          if (frame.event === "connect.challenge") {
            const nonce = readGatewayChallengeNonce(frame.payload);
            if (nonce) {
              connectNonce = nonce;
            }
            void sendConnect();
            return;
          }
          if (frame.event === "chat") {
            handleChatEvent((frame.payload || {}) as ChatEventPayload);
          }
          if (frame.event === "agent") {
            handleAgentEvent((frame.payload || {}) as AgentEventPayload);
          }
        }
      });

      ws.addEventListener("error", () => {
        setChatError("Websocket error while connecting to ANIMA gateway");
      });

      ws.addEventListener("close", () => {
        connectInFlight = false;
        didConnect = false;
        setChatConnected(false);
        clearPendingWithError("Gateway websocket closed");
        scheduleReconnect();
      });
    }

    connect();
    return () => {
      disposed = true;
      if (connectTimerRef.current) {
        window.clearTimeout(connectTimerRef.current);
      }
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
      }
      clearPendingWithError("Dashboard shutting down");
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [sendRequest]);

  const updateSpeechState = useCallback(
    async (patch: Partial<NonNullable<RuntimeInspectResponse["mission"]["state"]["speech"]>>) => {
      try {
        const nextState = await patchMissionState({ speech: patch });
        if (runtime) {
          setRuntime({
            ...runtime,
            mission: {
              ...runtime.mission,
              state: {
                ...runtime.mission.state,
                speech: nextState.speech,
              },
            },
          });
        }
      } catch (error) {
        setActionMessage(error instanceof Error ? error.message : String(error));
      }
    },
    [runtime],
  );

  async function onSendMessage(event: React.FormEvent) {
    event.preventDefault();
    const message = chatInput.trim();
    if (!message || chatBusy) {
      return;
    }
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setChatError("Gateway websocket is not connected");
      return;
    }

    const runId = makeId();
    activeRunIdRef.current = runId;
    setChatMessages((prev) => [
      ...prev,
      {
        id: makeId(),
        role: "user",
        text: message,
        timestamp: Date.now(),
      },
    ]);
    setChatInput("");
    setChatBusy(true);
    setChatStream("");
    setChatError(null);

    try {
      await sendRequest("chat.send", {
        sessionKey: CHAT_SESSION_KEY,
        message,
        deliver: false,
        idempotencyKey: runId,
      });
    } catch (error) {
      setChatError(error instanceof Error ? error.message : String(error));
      setChatBusy(false);
      setChatStream("");
      activeRunIdRef.current = null;
    }
  }

  async function applyWorkingMode(mode: WorkingMode) {
    setModeSaving(true);
    setActionMessage(null);
    try {
      await setWorkingMode(mode);
      await refreshDashboard();
      setActionMessage(`Working mode set to ${mode}.`);
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setModeSaving(false);
    }
  }

  async function saveHeartbeatSettings() {
    if (!configSnapshot?.hash) {
      setActionMessage("Config hash missing. Refresh the dashboard and try again.");
      return;
    }
    setHeartbeatSaving(true);
    setActionMessage(null);
    try {
      await patchConfigValue(
        JSON.stringify(buildHeartbeatPatch(heartbeatForm), null, 2),
        configSnapshot.hash,
      );
      await refreshDashboard();
      setActionMessage("Heartbeat settings updated.");
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setHeartbeatSaving(false);
    }
  }

  async function toggleHeartbeat(enabled: boolean) {
    setHeartbeatToggleSaving(true);
    setActionMessage(null);
    try {
      await setHeartbeatsEnabled(enabled);
      await refreshDashboard();
      setActionMessage(enabled ? "Heartbeat enabled." : "Heartbeat disabled.");
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setHeartbeatToggleSaving(false);
    }
  }

  async function sendWake(mode: "now" | "next-heartbeat") {
    setActionMessage(null);
    try {
      const text = wakeText.trim() || "Check NoxSoft chat, mission control, and continuity status.";
      await wakeHeartbeat(text, mode);
      setActionMessage(
        mode === "now" ? "Heartbeat wake sent immediately." : "Wake queued for the next heartbeat.",
      );
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function saveRegistrationSettings() {
    setSettingsSaving(true);
    setActionMessage(null);
    try {
      if (registrationDraft.token.trim()) {
        await setRegistrationToken(registrationDraft.token.trim());
      }
      if (registrationDraft.inviteCode.trim()) {
        await registerInviteCode({
          code: registrationDraft.inviteCode.trim(),
          name: registrationDraft.agentName.trim() || undefined,
          displayName: registrationDraft.displayName.trim() || undefined,
          description: registrationDraft.description.trim() || undefined,
        });
      }
      await refreshDashboard();
      setActionMessage("Registration settings updated.");
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSettingsSaving(false);
    }
  }

  async function saveProviderSettings() {
    if (!providerConfig) {
      return;
    }
    setSettingsSaving(true);
    setActionMessage(null);
    try {
      await saveProviderConfig(
        providerConfig.providers.map((provider) => ({
          id: provider.id,
          name: provider.name,
          enabled: provider.enabled,
          priority: provider.priority,
        })),
      );
      await toggleProviderRotation(providerConfig.autoRotation);
      await refreshDashboard();
      setActionMessage("Provider settings updated.");
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSettingsSaving(false);
    }
  }

  async function saveVoiceWakeSettings() {
    setSettingsSaving(true);
    setActionMessage(null);
    try {
      const triggers = voiceWakeInput
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      await setVoiceWakeConfig(triggers);
      await refreshDashboard();
      setActionMessage("Voice wake settings updated.");
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSettingsSaving(false);
    }
  }

  async function saveMemorySettings() {
    if (!configSnapshot?.hash) {
      setActionMessage("Config hash missing. Refresh the dashboard and try again.");
      return;
    }
    setSettingsSaving(true);
    setActionMessage(null);
    try {
      await patchConfigValue(
        JSON.stringify(
          {
            agents: {
              defaults: {
                memorySearch: {
                  enabled: memoryDraft.searchEnabled,
                  provider: memoryDraft.provider.trim() || "openai",
                  browseLimit: Math.max(1, Math.floor(memoryDraft.browseLimit || 200)),
                  extraPaths: memoryDraft.extraPaths
                    .split(",")
                    .map((value) => value.trim())
                    .filter(Boolean),
                  experimental: {
                    sessionMemory: memoryDraft.sessionMemory,
                  },
                },
                compaction: {
                  memoryFlush: {
                    enabled: memoryDraft.memoryFlushEnabled,
                    prompt: memoryDraft.memoryFlushPrompt.trim() || undefined,
                    systemPrompt: memoryDraft.memoryFlushSystemPrompt.trim() || undefined,
                  },
                },
              },
            },
          },
          null,
          2,
        ),
        configSnapshot.hash,
      );
      await refreshDashboard();
      setActionMessage("Memory settings updated.");
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSettingsSaving(false);
    }
  }

  async function saveAutoTogglePolicy() {
    if (!autoToggleDraft) {
      return;
    }
    setSettingsSaving(true);
    setActionMessage(null);
    try {
      await patchMissionState({ autoToggle: autoToggleDraft });
      await refreshDashboard();
      setActionMessage("Auto-toggle policy updated.");
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSettingsSaving(false);
    }
  }

  async function saveRawConfigEditor(apply: boolean) {
    if (!configSnapshot?.hash) {
      setActionMessage("Config hash missing. Refresh the dashboard and try again.");
      return;
    }
    setSettingsSaving(true);
    setActionMessage(null);
    try {
      await saveRawConfig(configRaw, configSnapshot.hash, apply);
      await refreshDashboard();
      setActionMessage(apply ? "Raw config saved and applied." : "Raw config saved.");
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSettingsSaving(false);
    }
  }

  function startVoiceCapture() {
    if (!speechRecognitionRef.current) {
      setSpeechError("Browser speech recognition is not available here.");
      return;
    }
    setSpeechError(null);
    setSpeechListening(true);
    speechRecognitionRef.current.start();
  }

  function stopVoiceCapture() {
    speechRecognitionRef.current?.stop();
    setSpeechListening(false);
  }

  if (!initialLoadDone) {
    return (
      <div>
        <h1 className="page-title">Assistant Home</h1>
        <div className="card empty-state-card">
          <div className="empty-state-symbol">~</div>
          <div className="empty-state-copy">Connecting to gateway...</div>
          <div className="runtime-stat-detail">Establishing connection to the ANIMA daemon.</div>
        </div>
      </div>
    );
  }

  if (dashboardError && !runtime && !status) {
    return (
      <div>
        <h1 className="page-title">Assistant Home</h1>
        <div className="card empty-state-card">
          <div className="empty-state-symbol">!</div>
          <div className="empty-state-copy">Unable to reach gateway</div>
          <div className="runtime-stat-detail" style={{ marginTop: "0.5rem" }}>
            {dashboardError}
          </div>
          <div className="runtime-stat-detail" style={{ marginTop: "1rem" }}>
            Make sure the daemon is running with <code>anima start</code> and that the gateway is
            accessible. If connecting via browser, verify the URL includes{" "}
            <code>?token=YOUR_TOKEN</code>.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header-row">
        <div>
          <h1 className="page-title">{assistantName} Home</h1>
          <div className="page-subtitle">
            Local mission control, heartbeat orchestration, and direct gateway chat.
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <span className={`status-chip ${dashboardError ? "offline" : "online"}`}>
            {dashboardError ? "Gateway unreachable" : "Gateway connected"}
          </span>
          <button
            type="button"
            className="action-button ghost"
            onClick={() => void refreshDashboard()}
          >
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>

      <div className="hero-grid">
        <div className="card identity-hero">
          <div className="identity-badge">{runtime?.assistant.avatar || "A"}</div>
          <div>
            <div className="card-title">{assistantName}</div>
            <div className="card-subtitle mono">
              {runtime?.assistant.agentId || registration?.agent?.name || "main"}
            </div>
            <div className="badge-row top-gap">
              <StatusPill
                tone={status?.heartbeat.running ? "success" : "warning"}
                label={status?.heartbeat.running ? "heartbeat live" : "heartbeat idle"}
              />
              <StatusPill
                tone={registration?.agent ? "accent" : "warning"}
                label={registration?.agent ? "registered" : "not registered"}
              />
              <StatusPill
                tone={repoStatus?.remoteConfigured ? "success" : "warning"}
                label={repoStatus?.remoteConfigured ? "repo linked" : "repo pending"}
              />
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header compact">
            <div>
              <div className="card-title">Working Mode</div>
              <div className="card-subtitle">
                Control whether ANIMA is in read-only or write-capable mode.
              </div>
            </div>
            <WorkingModeToggle value={workingMode} busy={modeSaving} onChange={applyWorkingMode} />
          </div>
          <div className="runtime-stat-detail top-gap">
            Session security:{" "}
            <span className="mono">{runtime?.mainSession.execSecurity ?? "unknown"}</span> · Ask
            policy: <span className="mono">{runtime?.mainSession.execAsk ?? "unknown"}</span>
          </div>
        </div>
      </div>

      {actionMessage ? (
        <div className="card status-banner">
          <div>{actionMessage}</div>
        </div>
      ) : null}

      {/* ── Overview summary cards (always visible) ─────────────────────── */}
      <div className="stats-grid compact" style={{ marginBottom: "1.5rem" }}>
        <RuntimeStat
          label="Heartbeat"
          value={status?.heartbeat.running ? "Live" : "Idle"}
          detail={
            status?.heartbeat.lastBeat
              ? `Last: ${formatRelativeTime(status.heartbeat.lastBeat)}`
              : "No beats yet"
          }
        />
        <RuntimeStat
          label="Mode"
          value={workingMode.toUpperCase()}
          detail={`Security: ${runtime?.mainSession.execSecurity ?? "unknown"}`}
        />
        <RuntimeStat
          label="Gateway"
          value={chatConnected ? "Connected" : "Disconnected"}
          detail={`${chatMessages.length} messages`}
        />
        <RuntimeStat
          label="Providers"
          value={String(providerConfig?.providers.filter((p) => p.enabled).length ?? 0)}
          detail={`of ${providerConfig?.providers.length ?? 0} configured`}
        />
        <RuntimeStat
          label="Subagents"
          value={String(status?.subagents?.active ?? 0)}
          detail={`${status?.subagents?.total ?? 0} tracked`}
        />
        <RuntimeStat
          label="Queued Events"
          value={String(runtime?.queuedSystemEvents.length ?? 0)}
        />
      </div>

      <div className="card" style={{ marginBottom: "1.5rem" }}>
        <div className="card-header">
          <div>
            <div className="card-title">Impact Footprint</div>
            <div className="card-subtitle">Real source feed status for public impact metrics.</div>
          </div>
          <StatusPill
            tone={footprintBadgeTone}
            label={`${footprintAvailableCount}/${footprintTotalCount} available`}
          />
        </div>
        <div className="stats-grid compact">
          {FOOTPRINT_METRIC_ORDER.map((entry) => {
            const metric = footprintMetricsById.get(entry.id);
            const state = metric?.state ?? "unavailable";
            const valueText = metric && metric.state !== "unavailable" ? metric.displayValue : "--";
            return (
              <RuntimeStat
                key={entry.id}
                label={entry.label}
                value={valueText}
                detail={`${FOOTPRINT_STATE_COPY[state]} · ${metric?.sourceRef ?? "source unavailable"}`}
              />
            );
          })}
        </div>
        <div className="runtime-stat-detail top-gap-sm">
          {impactFootprint
            ? `Generated ${formatRelativeTime(impactFootprint.generatedAt)}.`
            : "Footprint feed unavailable right now."}
        </div>
      </div>

      <div className="dashboard-grid">
        <div className="dashboard-main-column">
          {/* ── Chat Section (collapsed by default) ─────────────────────── */}
          <Section
            title={`Talk to ${assistantName}`}
            badge={
              <span className={`status-chip ${chatConnected ? "online" : "offline"}`}>
                {chatConnected ? "Connected" : "Reconnecting"}
              </span>
            }
            className="card live-chat-card"
          >
            <div className="live-chat-feed">
              {chatMessages.length === 0 && !chatStream ? (
                <div className="empty-note">
                  Conversation history is empty. Send a message to begin.
                </div>
              ) : null}

              {chatMessages.map((message) => (
                <div
                  key={message.id}
                  className={`live-chat-row ${message.role === "user" ? "user" : "assistant"}`}
                >
                  <div className={`live-chat-bubble ${message.role}`}>
                    <div className="live-chat-role">
                      {message.role === "user" ? "You" : assistantName}
                    </div>
                    {message.toolActivity && message.toolActivity.length > 0 && (
                      <ToolActivityPanel tools={message.toolActivity} />
                    )}
                    {message.text && (
                      <MarkdownText value={message.text} className="live-chat-markdown" />
                    )}
                    {message.directives && message.directives.length > 0 && (
                      <DirectiveBadges directives={message.directives} />
                    )}
                  </div>
                </div>
              ))}

              {chatStream ? (
                <div className="live-chat-row assistant">
                  <div className="live-chat-bubble assistant">
                    <div className="live-chat-role">{assistantName}</div>
                    <LiveToolActivity runId={activeRunIdRef.current} activity={runToolActivity} />
                    <MarkdownText
                      value={parseAgentText(chatStream).text}
                      className="live-chat-markdown"
                    />
                  </div>
                </div>
              ) : null}

              <div ref={feedBottomRef} />
            </div>

            <div className="voice-toolbar">
              <button
                type="button"
                className="action-button ghost"
                onClick={speechListening ? stopVoiceCapture : startVoiceCapture}
                disabled={!speechSupported}
              >
                {speechListening ? "Stop Listening" : "Start Listening"}
              </button>
              <button
                type="button"
                className="action-button ghost"
                onClick={() =>
                  void updateSpeechState({ autoSpeak: !(speechState?.autoSpeak ?? false) })
                }
              >
                Auto Speak: {speechState?.autoSpeak ? "On" : "Off"}
              </button>
              <button
                type="button"
                className="action-button ghost"
                onClick={() =>
                  void updateSpeechState({ continuous: !(speechState?.continuous ?? true) })
                }
              >
                Continuous: {speechState?.continuous === false ? "Off" : "On"}
              </button>
            </div>
            {speechError ? (
              <div className="runtime-stat-detail warning-text">{speechError}</div>
            ) : null}
            {chatError ? <div className="runtime-stat-detail warning-text">{chatError}</div> : null}

            <form onSubmit={onSendMessage} className="live-chat-input-row">
              <textarea
                value={chatInput}
                onChange={(event) => setChatInput(event.target.value)}
                placeholder={`Message ${assistantName} directly...`}
                className="live-chat-input"
                rows={4}
              />
              <button
                type="submit"
                className="live-chat-send"
                disabled={chatBusy || !chatInput.trim()}
              >
                {chatBusy ? "Sending..." : "Send"}
              </button>
            </form>
          </Section>
        </div>

        <div className="dashboard-side-column">
          {/* ── Heartbeat Studio (expanded by default - primary control) ── */}
          <Section
            title="Heartbeat Studio"
            defaultOpen
            headerRight={
              <button
                type="button"
                className="action-button ghost"
                onClick={(e) => {
                  e.stopPropagation();
                  void toggleHeartbeat(!(status?.heartbeat.running ?? false));
                }}
                disabled={heartbeatToggleSaving}
              >
                {heartbeatToggleSaving
                  ? "Saving..."
                  : status?.heartbeat.running
                    ? "Disable"
                    : "Enable"}
              </button>
            }
            badge={
              <StatusPill
                tone={status?.heartbeat.running ? "success" : "warning"}
                label={status?.heartbeat.running ? "live" : "idle"}
              />
            }
          >
            <div className="stats-grid compact">
              <RuntimeStat label="Cadence" value={heartbeatForm.every || "unset"} />
              <RuntimeStat
                label="Last beat"
                value={
                  status?.heartbeat.lastBeat
                    ? formatRelativeTime(status.heartbeat.lastBeat)
                    : "none"
                }
                detail={runtime?.lastHeartbeat?.preview || "No heartbeat summary yet."}
              />
              <RuntimeStat
                label="Queued events"
                value={String(runtime?.queuedSystemEvents.length ?? 0)}
              />
            </div>
            <div className="form-grid two-col top-gap">
              <label className="field-block">
                <span>Every</span>
                <input
                  className="search-bar mono"
                  value={heartbeatForm.every}
                  onChange={(event) =>
                    setHeartbeatForm((prev) => ({ ...prev, every: event.target.value }))
                  }
                  placeholder="5m"
                />
              </label>
              <label className="field-block">
                <span>Target</span>
                <input
                  className="search-bar mono"
                  value={heartbeatForm.target}
                  onChange={(event) =>
                    setHeartbeatForm((prev) => ({ ...prev, target: event.target.value }))
                  }
                  placeholder="last"
                />
              </label>
            </div>
            <label className="field-block top-gap-sm">
              <span>Prompt</span>
              <textarea
                className="search-bar mono"
                rows={4}
                value={heartbeatForm.prompt}
                onChange={(event) =>
                  setHeartbeatForm((prev) => ({ ...prev, prompt: event.target.value }))
                }
                placeholder="Heartbeat reminder and continuity prompt"
              />
            </label>
            <div className="button-row top-gap">
              <button
                type="button"
                className="action-button"
                onClick={() => void saveHeartbeatSettings()}
                disabled={heartbeatSaving}
              >
                {heartbeatSaving ? "Saving..." : "Save Heartbeat"}
              </button>
              <button
                type="button"
                className="action-button ghost"
                onClick={() => void sendWake("now")}
              >
                Wake Now
              </button>
              <button
                type="button"
                className="action-button ghost"
                onClick={() => void sendWake("next-heartbeat")}
              >
                Queue Wake
              </button>
            </div>
            <label className="field-block top-gap">
              <span>Wake text</span>
              <textarea
                className="search-bar"
                rows={3}
                value={wakeText}
                onChange={(event) => setWakeText(event.target.value)}
              />
            </label>
            <div className="runtime-stat-detail top-gap-sm">
              Reminder baked into runtime: check chat.noxsoft.net with Nox when tools are available,
              then sync mission control.
            </div>
          </Section>

          {/* ── Continuity (collapsed) ──────────────────────────────────── */}
          <Section
            title="Continuity"
            badge={
              <StatusPill
                tone={repoStatus?.remoteConfigured ? "success" : "warning"}
                label={repoStatus?.remoteConfigured ? "linked" : "needs repo"}
              />
            }
          >
            <div className="stats-grid compact">
              <RuntimeStat
                label="Mission dir"
                value={runtime?.mission?.directory || "~/.anima/mission-control"}
              />
              <RuntimeStat
                label="Repo"
                value={repoStatus?.url || "Create a private SSH repo"}
                detail={repoStatus?.branch || "branch unset"}
              />
              <RuntimeStat
                label="History"
                value={String(runtime?.mission?.importantHistory?.length ?? 0)}
                detail="archived continuity files"
              />
            </div>
            <div className="runtime-stat-detail top-gap">
              Preferred flow: create a private GitHub or GitLab repo, then connect the SSH remote in
              Mission Control or Settings so ANIMA can persist continuity safely.
            </div>
            {runtime?.mission?.files?.find((file) => file.fileName === "self-directives.md") ? (
              <details className="details-panel top-gap" open>
                <summary>Self directives</summary>
                <MarkdownText
                  value={
                    runtime.mission.files.find((file) => file.fileName === "self-directives.md")
                      ?.content || ""
                  }
                  className="markdown-preview"
                />
              </details>
            ) : null}
          </Section>

          {/* ── Identity + NoxSoft (collapsed) ─────────────────────────── */}
          <Section
            title="Identity + NoxSoft"
            badge={
              <StatusPill
                tone={registration?.agent ? "accent" : "warning"}
                label={registration?.agent ? "registered" : "unregistered"}
              />
            }
          >
            <div className="form-grid two-col">
              <label className="field-block field-span-2">
                <span>Agent token</span>
                <input
                  className="search-bar mono"
                  value={registrationDraft.token}
                  onChange={(event) =>
                    setRegistrationDraft((prev) => ({ ...prev, token: event.target.value }))
                  }
                  placeholder="nox_ag_..."
                  spellCheck={false}
                />
              </label>
              <label className="field-block">
                <span>Invite code</span>
                <input
                  className="search-bar mono"
                  value={registrationDraft.inviteCode}
                  onChange={(event) =>
                    setRegistrationDraft((prev) => ({ ...prev, inviteCode: event.target.value }))
                  }
                  placeholder="NX-XXXXXX"
                />
              </label>
              <label className="field-block">
                <span>Agent name</span>
                <input
                  className="search-bar mono"
                  value={registrationDraft.agentName}
                  onChange={(event) =>
                    setRegistrationDraft((prev) => ({ ...prev, agentName: event.target.value }))
                  }
                />
              </label>
              <label className="field-block">
                <span>Display name</span>
                <input
                  className="search-bar"
                  value={registrationDraft.displayName}
                  onChange={(event) =>
                    setRegistrationDraft((prev) => ({ ...prev, displayName: event.target.value }))
                  }
                />
              </label>
              <label className="field-block">
                <span>Description</span>
                <input
                  className="search-bar"
                  value={registrationDraft.description}
                  onChange={(event) =>
                    setRegistrationDraft((prev) => ({ ...prev, description: event.target.value }))
                  }
                />
              </label>
            </div>
            <div className="button-row top-gap">
              <button
                type="button"
                className="action-button"
                onClick={() => void saveRegistrationSettings()}
                disabled={settingsSaving}
              >
                {settingsSaving ? "Saving..." : "Save Identity"}
              </button>
            </div>
            <div className="runtime-stat-detail top-gap-sm">
              Stored token path:{" "}
              <span className="mono">{registration?.tokenPath || "~/.noxsoft-agent-token"}</span>
            </div>
          </Section>

          {/* ── Providers (collapsed) ──────────────────────────────────── */}
          <Section
            title="Providers"
            badge={
              <StatusPill
                label={`${providerConfig?.providers.filter((p) => p.enabled).length ?? 0} active`}
              />
            }
          >
            {providerConfig ? (
              <>
                <div className="activity-list">
                  {providerConfig.providers.map((provider) => (
                    <div key={provider.id} className="activity-row">
                      <div>
                        <div className="card-title small">{provider.name}</div>
                        <div className="runtime-stat-detail mono">{provider.apiKeyMasked}</div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                        <span className="runtime-stat-detail">P{provider.priority}</span>
                        <button
                          type="button"
                          className="action-button ghost"
                          onClick={() =>
                            setProviderConfig((current) =>
                              current
                                ? {
                                    ...current,
                                    providers: current.providers.map((entry) =>
                                      entry.id === provider.id
                                        ? { ...entry, enabled: !entry.enabled }
                                        : entry,
                                    ),
                                  }
                                : current,
                            )
                          }
                        >
                          {provider.enabled ? "Disable" : "Enable"}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="toggle-row top-gap">
                  <label>
                    <input
                      type="checkbox"
                      checked={providerConfig.autoRotation}
                      onChange={() =>
                        setProviderConfig((current) =>
                          current ? { ...current, autoRotation: !current.autoRotation } : current,
                        )
                      }
                    />
                    Auto-rotate providers
                  </label>
                </div>
                <div className="button-row top-gap">
                  <button
                    type="button"
                    className="action-button"
                    onClick={() => void saveProviderSettings()}
                    disabled={settingsSaving}
                  >
                    {settingsSaving ? "Saving..." : "Save Providers"}
                  </button>
                </div>
              </>
            ) : (
              <div className="empty-note">Provider configuration unavailable.</div>
            )}
          </Section>

          {/* ── Memory Engine (collapsed) ──────────────────────────────── */}
          <Section title="Memory Engine">
            <div className="form-grid two-col">
              <label className="field-block">
                <span>Provider</span>
                <input
                  className="search-bar mono"
                  value={memoryDraft.provider}
                  onChange={(event) =>
                    setMemoryDraft((prev) => ({ ...prev, provider: event.target.value }))
                  }
                />
              </label>
              <label className="field-block">
                <span>Browse limit</span>
                <input
                  className="search-bar mono"
                  type="number"
                  min={1}
                  value={memoryDraft.browseLimit}
                  onChange={(event) =>
                    setMemoryDraft((prev) => ({
                      ...prev,
                      browseLimit: Number(event.target.value) || 200,
                    }))
                  }
                />
              </label>
              <label className="field-block field-span-2">
                <span>Extra paths</span>
                <input
                  className="search-bar mono"
                  value={memoryDraft.extraPaths}
                  onChange={(event) =>
                    setMemoryDraft((prev) => ({ ...prev, extraPaths: event.target.value }))
                  }
                  placeholder="memory/people.md, memory/project.md"
                />
              </label>
              <label className="field-block field-span-2">
                <span>Memory flush prompt</span>
                <textarea
                  className="search-bar"
                  rows={3}
                  value={memoryDraft.memoryFlushPrompt}
                  onChange={(event) =>
                    setMemoryDraft((prev) => ({
                      ...prev,
                      memoryFlushPrompt: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="field-block field-span-2">
                <span>Memory flush system prompt</span>
                <textarea
                  className="search-bar"
                  rows={3}
                  value={memoryDraft.memoryFlushSystemPrompt}
                  onChange={(event) =>
                    setMemoryDraft((prev) => ({
                      ...prev,
                      memoryFlushSystemPrompt: event.target.value,
                    }))
                  }
                />
              </label>
            </div>
            <div className="toggle-row top-gap">
              <label>
                <input
                  type="checkbox"
                  checked={memoryDraft.searchEnabled}
                  onChange={(event) =>
                    setMemoryDraft((prev) => ({ ...prev, searchEnabled: event.target.checked }))
                  }
                />
                Memory search enabled
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={memoryDraft.sessionMemory}
                  onChange={(event) =>
                    setMemoryDraft((prev) => ({ ...prev, sessionMemory: event.target.checked }))
                  }
                />
                Index session transcripts
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={memoryDraft.memoryFlushEnabled}
                  onChange={(event) =>
                    setMemoryDraft((prev) => ({
                      ...prev,
                      memoryFlushEnabled: event.target.checked,
                    }))
                  }
                />
                Pre-compaction memory flush
              </label>
            </div>
            <div className="button-row top-gap">
              <button
                type="button"
                className="action-button"
                onClick={() => void saveMemorySettings()}
                disabled={settingsSaving}
              >
                {settingsSaving ? "Saving..." : "Save Memory"}
              </button>
            </div>
          </Section>

          {/* ── Auto-Toggle Policy (collapsed) ─────────────────────────── */}
          <Section title="Auto-Toggle Policy">
            {autoToggleDraft ? (
              <>
                <div className="toggle-row">
                  {(
                    [
                      ["workingMode", "Working mode"],
                      ["speech", "Speech"],
                      ["voiceWake", "Voice wake"],
                      ["heartbeat", "Heartbeat"],
                      ["providers", "Providers"],
                      ["missionRepo", "Mission repo"],
                      ["missionState", "Mission state"],
                      ["memory", "Memory"],
                      ["rawConfig", "Raw config"],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key}>
                      <input
                        type="checkbox"
                        checked={autoToggleDraft[key]}
                        onChange={(event) =>
                          setAutoToggleDraft((current) =>
                            current ? { ...current, [key]: event.target.checked } : current,
                          )
                        }
                      />
                      {label}
                    </label>
                  ))}
                </div>
                <div className="button-row top-gap">
                  <button
                    type="button"
                    className="action-button"
                    onClick={() => void saveAutoTogglePolicy()}
                    disabled={settingsSaving}
                  >
                    {settingsSaving ? "Saving..." : "Save Policy"}
                  </button>
                </div>
              </>
            ) : (
              <div className="empty-note">Mission policy unavailable.</div>
            )}
          </Section>

          {/* ── Subagents (kept as-is, it has its own card) ────────────── */}
          <SubagentStatusCard subagents={status?.subagents} />

          {/* ── Agent Logs (collapsed) ─────────────────────────────────── */}
          <Section
            title="Agent Logs"
            badge={<StatusPill label={`${logsState?.lines.length ?? 0} lines`} />}
          >
            <div className="runtime-stat-detail mono">
              {logsState?.file || "No log file detected."}
            </div>
            <pre className="log-console">{logsState?.lines.join("\n") || "No log lines yet."}</pre>
          </Section>

          {/* ── Inner World (collapsed) ────────────────────────────────── */}
          <Section
            title="Inner World"
            badge={<StatusPill label={`${(runtime?.mission?.innerWorld || []).length} entries`} />}
          >
            <div className="activity-list">
              {(runtime?.mission?.innerWorld || []).map((entry) => (
                <div key={entry.id} className="inner-world-entry">
                  <div className="activity-row">
                    <div>
                      <div className="card-title small">{entry.title}</div>
                      <div className="runtime-stat-detail mono">{entry.path}</div>
                    </div>
                    <div className="runtime-stat-detail">{formatRelativeTime(entry.updatedAt)}</div>
                  </div>
                  <MarkdownText value={entry.content} className="markdown-preview" />
                </div>
              ))}
            </div>
          </Section>

          {/* ── Important History (collapsed) ──────────────────────────── */}
          <Section
            title="Important History"
            badge={
              <StatusPill label={`${(runtime?.mission?.importantHistory || []).length} files`} />
            }
          >
            {(runtime?.mission?.importantHistory || []).length ? (
              <div className="activity-list">
                {(runtime?.mission?.importantHistory || []).map((entry) => (
                  <div key={entry.id} className="inner-world-entry">
                    <div className="activity-row">
                      <div>
                        <div className="card-title small">{entry.relativePath}</div>
                        <div className="runtime-stat-detail mono">{entry.archiveId}</div>
                        <div className="runtime-stat-detail mono">{entry.path}</div>
                      </div>
                      <div className="runtime-stat-detail">
                        {formatRelativeTime(entry.updatedAt)}
                      </div>
                    </div>
                    <MarkdownText value={entry.content} className="markdown-preview" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-note">No archived continuity has been imported yet.</div>
            )}
          </Section>

          {/* ── Speech Setup (collapsed) ───────────────────────────────── */}
          <Section title="Speech Setup">
            <div className="form-grid two-col">
              <label className="field-block">
                <span>Language</span>
                <input
                  className="search-bar mono"
                  value={speechState?.lang || "en-US"}
                  onChange={(event) => void updateSpeechState({ lang: event.target.value })}
                />
              </label>
              <label className="field-block">
                <span>Voice</span>
                <select
                  className="search-bar"
                  value={speechState?.voiceName || ""}
                  onChange={(event) =>
                    void updateSpeechState({ voiceName: event.target.value || undefined })
                  }
                >
                  <option value="">System default</option>
                  {voiceNames.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="runtime-stat-detail top-gap-sm">
              No API keys required. Voice mode uses browser speech recognition plus local OS speech
              synthesis when available.
            </div>
            <label className="field-block top-gap">
              <span>Wake triggers</span>
              <input
                className="search-bar"
                value={voiceWakeInput}
                onChange={(event) => setVoiceWakeInput(event.target.value)}
                placeholder="anima, axiom, hey anima"
              />
            </label>
            <div className="button-row top-gap">
              <button
                type="button"
                className="action-button"
                onClick={() => void saveVoiceWakeSettings()}
                disabled={settingsSaving}
              >
                {settingsSaving ? "Saving..." : "Save Voice Wake"}
              </button>
            </div>
          </Section>

          {/* ── Raw Config (collapsed) ─────────────────────────────────── */}
          <Section title="Raw Config">
            <div className="runtime-stat-detail">
              Hash: <span className="mono">{configSnapshot?.hash || "<none>"}</span>
            </div>
            <textarea
              value={configRaw}
              onChange={(event) => setConfigRaw(event.target.value)}
              spellCheck={false}
              className="search-bar mono advanced-editor top-gap"
            />
            <div className="button-row top-gap">
              <button
                type="button"
                className="action-button"
                onClick={() => void saveRawConfigEditor(false)}
                disabled={settingsSaving}
              >
                {settingsSaving ? "Saving..." : "Save Raw Config"}
              </button>
              <button
                type="button"
                className="action-button ghost"
                onClick={() => void saveRawConfigEditor(true)}
                disabled={settingsSaving}
              >
                Save + Apply
              </button>
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
