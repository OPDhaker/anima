/**
 * ANIMA API Client — wraps fetch calls to the daemon gateway.
 *
 * Default endpoint: same origin as the Control UI, fallback localhost.
 */

import { buildOperatorConnectParams, readGatewayChallengeNonce } from "./gateway-connect";
import {
  resolveGatewayBaseUrl,
  resolveGatewayConnectAuth,
  resolveGatewayWsUrl,
} from "./gateway-connection";

const BASE_URL = resolveGatewayBaseUrl();
const GATEWAY_WS_URL = resolveGatewayWsUrl();
const GATEWAY_PROTOCOL_VERSION = 3;
const RPC_TIMEOUT_MS = 10_000;
const SUBAGENT_ACTIVE_WINDOW_MS = 2 * 60_000;
const SUBAGENT_RECENT_WINDOW_MS = 15 * 60_000;
const SUBAGENT_LATEST_LIMIT = 8;

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

type GatewayStatusPayload = {
  heartbeat?: {
    agents?: Array<{ enabled?: boolean; everyMs?: number }>;
  };
  queuedSystemEvents?: unknown[];
};

type LastHeartbeatPayload = {
  ts?: number;
};

type GatewayIdentityPayload = {
  name?: string;
  avatar?: string;
  agentId?: string;
};

type GatewaySessionsPayload = {
  sessions?: Array<{
    key?: string;
    kind?: string;
    sessionId?: string;
    updatedAt?: number;
    abortedLastRun?: boolean;
    model?: string;
    modelProvider?: string;
    origin?: {
      surface?: string;
    };
  }>;
};

function makeId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function parseBody(options?: RequestInit): Record<string, unknown> {
  const raw = options?.body;
  if (typeof raw !== "string" || !raw.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

async function gatewayRpc<T>(method: string, params?: Record<string, unknown>): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const ws = new WebSocket(GATEWAY_WS_URL);
    let settled = false;
    let connected = false;
    let connectInFlight = false;
    let connectNonce: string | undefined;
    let connectReqId = "";
    let methodReqId = "";
    let connectDelayTimer: number | null = null;

    const timeout = window.setTimeout(() => {
      finishError(new Error(`Gateway RPC timed out: ${method}`));
    }, RPC_TIMEOUT_MS);

    function cleanup() {
      window.clearTimeout(timeout);
      if (connectDelayTimer != null) {
        window.clearTimeout(connectDelayTimer);
      }
      ws.close();
    }

    function finishOk(value: T) {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(value);
    }

    function finishError(err: Error) {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(err);
    }

    function sendFrame(id: string, rpcMethod: string, rpcParams?: Record<string, unknown>) {
      ws.send(
        JSON.stringify({
          type: "req",
          id,
          method: rpcMethod,
          params: rpcParams ?? {},
        }),
      );
    }

    async function sendConnect() {
      if (connected || connectReqId || connectInFlight) {
        return;
      }
      connectInFlight = true;
      const auth = resolveGatewayConnectAuth();
      if (!auth) {
        connectInFlight = false;
        finishError(
          new Error(
            "Gateway token missing. Re-open this page once with ?token=ANIMA_GATEWAY_TOKEN.",
          ),
        );
        return;
      }
      try {
        const connectParams = await buildOperatorConnectParams({
          minProtocol: GATEWAY_PROTOCOL_VERSION,
          maxProtocol: GATEWAY_PROTOCOL_VERSION,
          client: {
            id: "webchat-ui",
            version: "1.0.0",
            platform: "web",
            mode: "webchat",
          },
          scopes: ["operator.read", "operator.admin"],
          caps: [],
          auth,
          nonce: connectNonce,
        });
        connectReqId = makeId();
        sendFrame(connectReqId, "connect", connectParams);
        connectInFlight = false;
      } catch (err) {
        connectInFlight = false;
        finishError(err instanceof Error ? err : new Error(String(err)));
      }
    }

    ws.addEventListener("open", () => {
      connectDelayTimer = window.setTimeout(() => {
        connectDelayTimer = null;
        void sendConnect();
      }, 100);
    });

    ws.addEventListener("message", (event) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(event.data));
      } catch {
        return;
      }

      const frame = parsed as RpcResponseFrame | RpcEventFrame;
      if (frame.type === "event") {
        if (frame.event === "connect.challenge") {
          const nonce = readGatewayChallengeNonce(frame.payload);
          if (nonce) {
            connectNonce = nonce;
          }
          void sendConnect();
        }
        return;
      }

      if (frame.type !== "res") {
        return;
      }

      if (frame.id === connectReqId) {
        connectReqId = "";
        connectInFlight = false;
        if (!frame.ok) {
          finishError(new Error(frame.error?.message || "Gateway connect failed"));
          return;
        }
        connected = true;
        methodReqId = makeId();
        sendFrame(methodReqId, method, params);
        return;
      }

      if (frame.id === methodReqId && connected) {
        if (!frame.ok) {
          finishError(new Error(frame.error?.message || `Gateway method failed: ${method}`));
          return;
        }
        finishOk((frame.payload ?? {}) as T);
      }
    });

    ws.addEventListener("error", () => {
      finishError(new Error(`Gateway websocket error while requesting ${method}`));
    });

    ws.addEventListener("close", () => {
      if (!settled) {
        finishError(new Error(`Gateway websocket closed while requesting ${method}`));
      }
    });
  });
}

export async function callGatewayMethod<T>(
  method: string,
  params?: Record<string, unknown>,
): Promise<T> {
  return await gatewayRpc<T>(method, params);
}

function mapDaemonStatus(
  status: GatewayStatusPayload,
  lastHeartbeat: LastHeartbeatPayload | null,
  subagents: SubagentStatus = createEmptySubagentStatus(),
): DaemonStatus {
  const firstAgent = Array.isArray(status.heartbeat?.agents) ? status.heartbeat?.agents[0] : null;
  const interval =
    typeof firstAgent?.everyMs === "number" && Number.isFinite(firstAgent.everyMs)
      ? firstAgent.everyMs
      : 300_000;
  const lastTs =
    typeof lastHeartbeat?.ts === "number" && Number.isFinite(lastHeartbeat.ts)
      ? lastHeartbeat.ts
      : null;

  return {
    heartbeat: {
      running: Boolean(firstAgent?.enabled),
      paused: false,
      beatCount: 0,
      lastBeat: lastTs != null ? new Date(lastTs).toISOString() : null,
      nextBeat: lastTs != null ? new Date(lastTs + interval).toISOString() : null,
      interval,
    },
    budget: {
      spent: 0,
      remaining: 200,
      limit: 200,
      sessionCount: 0,
    },
    queue: {
      queued: Array.isArray(status.queuedSystemEvents) ? status.queuedSystemEvents.length : 0,
      running: 0,
      completed: 0,
      failed: 0,
    },
    mcp: {
      servers: [],
    },
    subagents,
  };
}

function createEmptySubagentStatus(): SubagentStatus {
  return {
    total: 0,
    active: 0,
    recent: 0,
    failed: 0,
    latest: [],
  };
}

function normalizeUpdatedAt(updatedAt: number | undefined): number | null {
  return typeof updatedAt === "number" && Number.isFinite(updatedAt) ? updatedAt : null;
}

function isSubagentSessionKey(key: string | undefined): boolean {
  const normalized = key?.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return normalized.startsWith("subagent:") || normalized.includes(":subagent:");
}

function deriveSubagentStatus(payload: GatewaySessionsPayload): SubagentStatus {
  if (!Array.isArray(payload.sessions) || payload.sessions.length === 0) {
    return createEmptySubagentStatus();
  }

  const now = Date.now();
  const rows = payload.sessions
    .filter((entry) => isSubagentSessionKey(entry.key))
    .map((entry) => {
      const updatedAtMs = normalizeUpdatedAt(entry.updatedAt);
      const ageMs = updatedAtMs == null ? Number.POSITIVE_INFINITY : Math.max(0, now - updatedAtMs);
      const failed = entry.abortedLastRun === true;

      let status: SubagentStatusEntry["status"] = "idle";
      if (failed) {
        status = "failed";
      } else if (ageMs <= SUBAGENT_ACTIVE_WINDOW_MS) {
        status = "active";
      } else if (ageMs <= SUBAGENT_RECENT_WINDOW_MS) {
        status = "recent";
      }

      return {
        key: entry.key?.trim() || makeId(),
        status,
        updatedAt: updatedAtMs != null ? new Date(updatedAtMs).toISOString() : null,
        updatedAtMs,
      };
    })
    .toSorted(
      (
        a: {
          key: string;
          status: SubagentStatusEntry["status"];
          updatedAt: string | null;
          updatedAtMs: number | null;
        },
        b: {
          key: string;
          status: SubagentStatusEntry["status"];
          updatedAt: string | null;
          updatedAtMs: number | null;
        },
      ) => (b.updatedAtMs ?? 0) - (a.updatedAtMs ?? 0),
    );

  if (rows.length === 0) {
    return createEmptySubagentStatus();
  }

  return {
    total: rows.length,
    active: rows.filter((row) => row.status === "active").length,
    recent: rows.filter((row) => row.status === "recent").length,
    failed: rows.filter((row) => row.status === "failed").length,
    latest: rows.slice(0, SUBAGENT_LATEST_LIMIT).map((row) => ({
      key: row.key,
      status: row.status,
      updatedAt: row.updatedAt,
    })),
  };
}

function mapIdentity(identity: GatewayIdentityPayload): IdentityResponse {
  const name = identity.name?.trim() || "Assistant";
  const agentId = identity.agentId?.trim() || "main";
  const avatar = identity.avatar?.trim() || "A";

  return {
    loadedAt: new Date().toISOString(),
    components: [
      {
        name: "SOUL",
        content: `# ${name}\nAgent ID: ${agentId}\nAvatar: ${avatar}`,
        source: "user",
        description: "Core identity resolved from active gateway agent profile.",
      },
      {
        name: "HEART",
        content: "Heartbeat mode active. This instance listens for ongoing directives.",
        source: "template",
        description: "Heartbeat and operating rhythm configuration.",
      },
      {
        name: "MEMORY",
        content: "Memory systems are managed by ANIMA runtime and session storage.",
        source: "template",
        description: "Long-term continuity and session persistence layer.",
      },
    ],
  };
}

function mapSessions(payload: GatewaySessionsPayload): SessionEntry[] {
  if (!Array.isArray(payload.sessions)) {
    return [];
  }

  return payload.sessions.map((entry) => {
    const updatedAt =
      typeof entry.updatedAt === "number" && Number.isFinite(entry.updatedAt)
        ? new Date(entry.updatedAt).toISOString()
        : new Date().toISOString();
    const model =
      [entry.modelProvider, entry.model]
        .filter((part) => typeof part === "string" && part)
        .join("/") || "gateway session";

    return {
      sessionId: entry.sessionId || entry.key || makeId(),
      mode: entry.origin?.surface || entry.kind || "session",
      status: entry.abortedLastRun ? "failed" : "completed",
      prompt: `Model: ${model}`,
      durationMs: 0,
      costUsd: null,
      savedAt: updatedAt,
    };
  });
}

const DEFAULT_SVRN_STATUS: SVRNStatus = {
  enabled: false,
  running: false,
  paused: false,
  nodeId: "unavailable",
  uptimeMs: 0,
  tasksCompleted: 0,
  tasksFailed: 0,
  balance: 0,
  sessionEarnings: 0,
  limits: {
    maxCpuPercent: 10,
    maxRamMB: 256,
    maxBandwidthMbps: 5,
  },
  resources: null,
  earnings: {
    allTimeEarned: 0,
    allTimeApplied: 0,
    balanceValueUSD: 0,
    todayEarned: 0,
    todayTasks: 0,
  },
};

async function requestViaGatewayRpc<T>(path: string, options?: RequestInit): Promise<T> {
  const method = (options?.method || "GET").toUpperCase();

  if (method === "GET" && path === "/api/status") {
    const [status, lastHeartbeat, sessions] = await Promise.all([
      gatewayRpc<GatewayStatusPayload>("status", {}),
      gatewayRpc<LastHeartbeatPayload>("last-heartbeat", {}).catch(() => null),
      gatewayRpc<GatewaySessionsPayload>("sessions.list", {
        limit: 200,
        includeGlobal: true,
        includeUnknown: true,
      }).catch(() => ({ sessions: [] })),
    ]);
    const subagents = deriveSubagentStatus(sessions);
    return mapDaemonStatus(status, lastHeartbeat, subagents) as T;
  }

  if (method === "GET" && path === "/api/identity") {
    const identity = await gatewayRpc<GatewayIdentityPayload>("agent.identity.get", {
      sessionKey: "main",
    }).catch(() => ({ name: "Assistant", avatar: "A", agentId: "main" }));
    return mapIdentity(identity) as T;
  }

  if (method === "GET" && path === "/api/sessions") {
    const sessions = await gatewayRpc<GatewaySessionsPayload>("sessions.list", { limit: 50 }).catch(
      () => ({ sessions: [] }),
    );
    return mapSessions(sessions) as T;
  }

  if (method === "GET" && path === "/api/queue") {
    return [] as T;
  }

  if (method === "POST" && path === "/api/queue") {
    const body = parseBody(options);
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    const runId = makeId();
    if (prompt) {
      await gatewayRpc<{ runId?: string }>("chat.send", {
        sessionKey: "main",
        message: prompt,
        deliver: false,
        idempotencyKey: runId,
      });
    }
    return { id: runId } as T;
  }

  if (method === "GET" && path === "/api/mcp") {
    return [] as T;
  }

  if (method === "GET" && path === "/api/svrn/status") {
    return DEFAULT_SVRN_STATUS as T;
  }

  if (method === "POST" && (path === "/api/svrn/toggle" || path === "/api/svrn/limits")) {
    return { success: true } as T;
  }

  throw new Error(`Unsupported control UI API path: ${method} ${path}`);
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  try {
    const headers = new Headers(options?.headers ?? {});
    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const resp = await fetch(`${BASE_URL}${path}`, {
      ...options,
      headers,
    });

    if (!resp.ok) {
      if (path.startsWith("/api/")) {
        return await requestViaGatewayRpc<T>(path, options);
      }
      throw new Error(`API error: ${resp.status} ${resp.statusText}`);
    }

    const contentType = String(resp.headers.get("content-type") || "");
    if (contentType.includes("application/json")) {
      return (await resp.json()) as T;
    }

    const raw = await resp.text();
    if (path.startsWith("/api/")) {
      const normalized = raw.trim().toLowerCase();
      if (normalized.startsWith("<!doctype html") || normalized.startsWith("<html")) {
        return await requestViaGatewayRpc<T>(path, options);
      }
      try {
        return JSON.parse(raw) as T;
      } catch {
        return await requestViaGatewayRpc<T>(path, options);
      }
    }

    return JSON.parse(raw) as T;
  } catch (err) {
    if (path.startsWith("/api/")) {
      return await requestViaGatewayRpc<T>(path, options);
    }
    throw err;
  }
}

// --- Types ---

export interface DaemonStatus {
  heartbeat: {
    running: boolean;
    paused: boolean;
    beatCount: number;
    lastBeat: string | null;
    nextBeat: string | null;
    interval: number;
  };
  budget: {
    spent: number;
    remaining: number;
    limit: number;
    sessionCount: number;
  };
  queue: {
    queued: number;
    running: number;
    completed: number;
    failed: number;
  };
  mcp: {
    servers: MCPServerStatus[];
  };
  subagents?: SubagentStatus;
}

export interface SubagentStatusEntry {
  key: string;
  status: "active" | "recent" | "idle" | "failed";
  updatedAt: string | null;
}

export interface SubagentStatus {
  total: number;
  active: number;
  recent: number;
  failed: number;
  latest: SubagentStatusEntry[];
}

export interface MCPServerStatus {
  name: string;
  status: "healthy" | "unhealthy" | "unknown";
  lastHealthCheck: string | null;
  consecutiveFailures: number;
  command: string;
  args: string[];
}

export interface IdentityResponse {
  components: {
    name: string;
    content: string;
    source: "user" | "template";
    description: string;
  }[];
  loadedAt: string;
}

export interface SessionEntry {
  sessionId: string;
  mode: string;
  status: string;
  prompt: string;
  durationMs: number;
  costUsd: number | null;
  savedAt: string;
}

export interface QueueItem {
  id: string;
  prompt: string;
  priority: string;
  status: string;
  source: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  result?: string;
  error?: string;
}

export interface ConfigIssue {
  path?: string;
  message?: string;
}

export interface ConfigSnapshot {
  raw?: string;
  hash?: string;
  valid?: boolean;
  issues?: ConfigIssue[];
  config?: unknown;
}

export interface HeartbeatAgentRuntime {
  agentId: string;
  enabled: boolean;
  every: string;
  everyMs: number | null;
}

export interface RuntimeInspectResponse {
  stateDir: string;
  assistant: {
    agentId: string;
    name: string;
    avatar: string;
    emoji?: string;
  };
  lastHeartbeat: {
    ts?: number;
    status?: string;
    preview?: string;
    reason?: string;
    channel?: string;
  } | null;
  heartbeat: {
    defaultAgentId: string;
    agents: HeartbeatAgentRuntime[];
  };
  mission: {
    directory: string;
    statePath: string;
    state: MissionControlState;
    repo: MissionRepoState;
    files: MissionControlFile[];
    innerWorld: MissionInnerWorldEntry[];
    importantHistory: MissionImportantHistoryEntry[];
  };
  mainSession: {
    key: string;
    storePath: string;
    sessionId: string | null;
    updatedAt: number | null;
    thinkingLevel: string | null;
    verboseLevel: string | null;
    reasoningLevel: string | null;
    elevatedLevel: string | null;
    execHost: string | null;
    execSecurity: string | null;
    execAsk: string | null;
    model: string | null;
  };
  queuedSystemEvents: string[];
}

export type WorkingMode = "read" | "write";

export interface MissionRepoState {
  provider?: "github" | "gitlab" | "custom";
  url?: string;
  branch?: string;
  preferredTransport?: "ssh" | "https";
  remoteName?: string;
  connectedAt?: number;
  remoteConfigured?: boolean;
  lastError?: string;
}

export interface MissionSpeechState {
  recognition: "browser" | "manual";
  autoSpeak: boolean;
  continuous: boolean;
  lang: string;
  voiceName?: string;
  rate: number;
  pitch: number;
}

export type MissionPriority = "critical" | "high" | "medium" | "low";
export type MissionGoalStatus = "active" | "paused" | "completed" | "blocked";
export type MissionFeatureStatus = "queued" | "in_progress" | "review" | "done" | "blocked";
export type MissionFeatureRisk = "low" | "medium" | "high";
export type MissionFeatureTestStatus = "missing" | "partial" | "passing";
export type MissionRelationship = "operator" | "ally" | "stakeholder" | "unknown";

export interface MissionGoal {
  id: string;
  title: string;
  status: MissionGoalStatus;
  priority: MissionPriority;
  summary?: string;
  owner?: string;
  updatedAt: number;
}

export interface MissionFeature {
  id: string;
  title: string;
  status: MissionFeatureStatus;
  risk: MissionFeatureRisk;
  testStatus: MissionFeatureTestStatus;
  area?: string;
  lastTouchedAt: number;
}

export interface MissionPerson {
  id: string;
  name: string;
  relationship: MissionRelationship;
  trust: number;
  notes?: string;
  lastInteractedAt?: number;
}

export interface TrustGraphPerson {
  id: string;
  name: string;
  aliases?: string[];
  relationship: MissionRelationship;
  trust: number;
  roles?: string[];
  location?: string;
  notes?: string;
  lastInteractedAt?: number;
  updatedAt: number;
}

export interface TrustGraphSnapshot {
  path: string;
  people: TrustGraphPerson[];
}

export interface MissionChronosState {
  heartbeatMinutes: number;
  focusBlockMinutes: number;
  checkpointIntervalMinutes: number;
  activeWorkstream?: string;
  contractStartedAt?: number;
  contractTargetMinutes: number;
  contractElapsedMinutes: number;
  checkpointCount: number;
  lastCheckpointAt?: number;
  driftMinutes: number;
  updatedAt: number;
}

export interface MissionAffectState {
  joy: number;
  frustration: number;
  curiosity: number;
  confidence: number;
  care: number;
  fatigue: number;
  updatedAt: number;
}

export interface MissionAutoTogglePolicy {
  workingMode: boolean;
  speech: boolean;
  voiceWake: boolean;
  heartbeat: boolean;
  providers: boolean;
  missionRepo: boolean;
  missionState: boolean;
  memory: boolean;
  rawConfig: boolean;
}

export interface MissionControlState {
  version: 1;
  workingMode: WorkingMode;
  repo: MissionRepoState;
  speech: MissionSpeechState;
  goals: MissionGoal[];
  features: MissionFeature[];
  people: MissionPerson[];
  chronos: MissionChronosState;
  affect: MissionAffectState;
  autoToggle: MissionAutoTogglePolicy;
}

export type MissionCollectionKey = "goals" | "features" | "people";

export interface MissionControlStatePatch {
  workingMode?: WorkingMode;
  repo?: Partial<MissionRepoState>;
  speech?: Partial<MissionSpeechState>;
  goals?: MissionGoal[];
  features?: MissionFeature[];
  people?: MissionPerson[];
  goalIdsToRemove?: string[];
  featureIdsToRemove?: string[];
  personIdsToRemove?: string[];
  replaceCollections?: MissionCollectionKey[];
  chronos?: Partial<MissionChronosState>;
  affect?: Partial<MissionAffectState>;
  autoToggle?: Partial<MissionAutoTogglePolicy>;
}

export interface MissionControlFile {
  id: string;
  fileName: string;
  title: string;
  path: string;
  content: string;
  size: number;
  updatedAt: number | null;
}

export interface MissionInnerWorldEntry {
  id: string;
  title: string;
  path: string;
  content: string;
  updatedAt: number | null;
}

export type BrainSensitivity = "public" | "internal" | "private" | "secret";
export type BrainRecordState = "active" | "candidate" | "archived";
export type AnimaNodeKind = "goal" | "feature" | "person" | "chronos" | "affect";
export type AnimaRelation = "owns" | "supports" | "focuses_on" | "tracks" | "influences";

export interface BrainEvidence {
  source: string;
  sourceId?: string;
  excerpt?: string;
  recordedAt?: number;
}

export interface BrainNodeMeta {
  provenance: string[];
  confidence: number;
  salience: number;
  recency: number;
  sensitivity: BrainSensitivity;
  lastReviewedAt?: number;
  state: BrainRecordState;
}

export interface BrainEdgeMeta extends BrainNodeMeta {
  strength: number;
  direction: "forward" | "bidirectional";
}

export interface BrainNode {
  id: string;
  type: AnimaNodeKind;
  label: string;
  aliases: string[];
  properties: Record<string, unknown>;
  evidence: BrainEvidence[];
  meta: BrainNodeMeta;
}

export interface BrainEdge {
  id: string;
  source: string;
  target: string;
  relation: AnimaRelation;
  evidence: BrainEvidence[];
  meta: BrainEdgeMeta;
}

export interface BrainGraphSnapshot {
  nodes: BrainNode[];
  edges: BrainEdge[];
}

export interface MissionControlSnapshot {
  directory: string;
  statePath: string;
  state: MissionControlState;
  brainGraph: BrainGraphSnapshot;
  trustGraph: TrustGraphSnapshot;
  files: MissionControlFile[];
  innerWorld: MissionInnerWorldEntry[];
  importantHistory: MissionImportantHistoryEntry[];
}

export interface MissionImportantHistoryEntry {
  id: string;
  archiveId: string;
  relativePath: string;
  path: string;
  content: string;
  updatedAt: number | null;
}

export type MemoryKind = "episodic" | "semantic" | "procedural";

export interface MemoryEntry {
  id: string;
  name: string;
  path: string;
  updatedAt: number | null;
  excerpt: string;
  content: string;
}

export interface RegistrationStatus {
  tokenPresent: boolean;
  tokenPath: string;
  tokenPreview: string | null;
  agent: {
    id: string;
    name: string;
    display_name: string;
  } | null;
  suggestedIdentity: {
    name: string;
    displayName: string;
  };
  invalidToken: boolean;
}

export interface LogsTailResponse {
  file: string;
  cursor: number;
  size: number;
  lines: string[];
  truncated: boolean;
  reset: boolean;
}

export interface VoiceWakeConfig {
  triggers: string[];
}

// --- API Functions ---

export async function getStatus(): Promise<DaemonStatus> {
  return request<DaemonStatus>("/api/status");
}

export async function getIdentity(): Promise<IdentityResponse> {
  return request<IdentityResponse>("/api/identity");
}

export async function getSessions(): Promise<SessionEntry[]> {
  return request<SessionEntry[]>("/api/sessions");
}

export async function getQueue(): Promise<QueueItem[]> {
  return request<QueueItem[]>("/api/queue");
}

export async function getMCPStatus(): Promise<MCPServerStatus[]> {
  return request<MCPServerStatus[]>("/api/mcp");
}

export async function addToQueue(
  prompt: string,
  priority: string = "normal",
): Promise<{ id: string }> {
  return request<{ id: string }>("/api/queue", {
    method: "POST",
    body: JSON.stringify({ prompt, priority, source: "web" }),
  });
}

// --- SVRN Types ---

export interface SVRNStatus {
  enabled: boolean;
  running: boolean;
  paused: boolean;
  nodeId: string;
  uptimeMs: number;
  tasksCompleted: number;
  tasksFailed: number;
  balance: number;
  sessionEarnings: number;
  limits: {
    maxCpuPercent: number;
    maxRamMB: number;
    maxBandwidthMbps: number;
  };
  resources: {
    cpuPercent: number;
    ramUsedMB: number;
    bandwidthMbps: number;
  } | null;
  earnings: {
    allTimeEarned: number;
    allTimeApplied: number;
    balanceValueUSD: number;
    todayEarned: number;
    todayTasks: number;
  };
}

export async function getSVRNStatus(): Promise<SVRNStatus> {
  return request<SVRNStatus>("/api/svrn/status");
}

export interface SVRNWalletDetails {
  address: string;
  balance: number;
  totalEarned: number;
  totalSpent: number;
  createdAt: string | null;
  recentTransactions: Array<{
    type: "earn" | "spend";
    amount: number;
    description?: string;
    timestamp: number;
  }>;
}

export async function getSVRNWalletBalance(): Promise<SVRNWalletDetails> {
  return request<SVRNWalletDetails>("/api/svrn/wallet/balance");
}

export async function getConfigSnapshot(): Promise<ConfigSnapshot> {
  return await callGatewayMethod<ConfigSnapshot>("config.get", {});
}

export async function getConfigSchemaSnapshot(): Promise<unknown> {
  return await callGatewayMethod("config.schema", {});
}

export async function saveRawConfig(raw: string, baseHash: string, apply = false): Promise<void> {
  await callGatewayMethod(apply ? "config.apply" : "config.set", {
    raw,
    baseHash,
  });
}

export async function patchConfigValue(rawPatch: string, baseHash: string): Promise<void> {
  await callGatewayMethod("config.patch", {
    raw: rawPatch,
    baseHash,
  });
}

export async function getRuntimeInspect(): Promise<RuntimeInspectResponse> {
  return await callGatewayMethod<RuntimeInspectResponse>("anima.runtime.get", {});
}

export async function setWorkingMode(mode: WorkingMode): Promise<void> {
  await callGatewayMethod("anima.runtime.set-working-mode", { mode });
}

export async function listMemory(
  kind: MemoryKind,
  query?: string,
  limit?: number,
): Promise<MemoryEntry[]> {
  const result = await callGatewayMethod<{ entries?: MemoryEntry[] }>("anima.memory.list", {
    kind,
    ...(query ? { query } : {}),
    ...(typeof limit === "number" ? { limit } : {}),
  });
  return Array.isArray(result.entries) ? result.entries : [];
}

export async function getMissionControl(): Promise<MissionControlSnapshot> {
  return await callGatewayMethod<MissionControlSnapshot>("anima.mission.get", {});
}

export async function saveMissionFile(
  fileName: string,
  content: string,
): Promise<MissionControlFile> {
  const result = await callGatewayMethod<{ file: MissionControlFile }>("anima.mission.set", {
    fileName,
    content,
  });
  return result.file;
}

export async function patchMissionState(
  patch: MissionControlStatePatch,
): Promise<MissionControlState> {
  const result = await callGatewayMethod<{ state: MissionControlState }>("anima.mission.patch", {
    patch,
  });
  return result.state;
}

export async function connectMissionRepo(params: {
  url: string;
  branch?: string;
  provider?: "github" | "gitlab" | "custom";
}): Promise<MissionRepoState> {
  const result = await callGatewayMethod<{ repo: MissionRepoState }>("anima.mission.connect-repo", {
    ...params,
  });
  return result.repo;
}

export async function saveTrustGraph(people: TrustGraphPerson[]): Promise<void> {
  await callGatewayMethod<{ ok: true }>("anima.trust.set", {
    people,
  });
}

export async function importMissionHistory(params: {
  preset?: string;
  source?: string;
}): Promise<void> {
  await callGatewayMethod("anima.mission.import", params);
}

export async function getRegistrationStatus(): Promise<RegistrationStatus> {
  return await callGatewayMethod<RegistrationStatus>("anima.registration.status", {});
}

export async function setRegistrationToken(token: string): Promise<void> {
  await callGatewayMethod("anima.registration.set-token", { token });
}

export async function registerInviteCode(params: {
  code: string;
  name?: string;
  displayName?: string;
  description?: string;
}): Promise<void> {
  await callGatewayMethod("anima.registration.register-invite", params);
}

export async function setHeartbeatsEnabled(enabled: boolean): Promise<void> {
  await callGatewayMethod("set-heartbeats", { enabled });
}

export async function wakeHeartbeat(
  text: string,
  mode: "now" | "next-heartbeat" = "next-heartbeat",
) {
  await callGatewayMethod("wake", { text, mode });
}

export async function tailLogs(cursor?: number): Promise<LogsTailResponse> {
  return await callGatewayMethod<LogsTailResponse>("logs.tail", {
    ...(typeof cursor === "number" ? { cursor } : {}),
    limit: 160,
    maxBytes: 120_000,
  });
}

export async function getVoiceWakeConfig(): Promise<VoiceWakeConfig> {
  return await callGatewayMethod<VoiceWakeConfig>("voicewake.get", {});
}

export async function setVoiceWakeConfig(triggers: string[]): Promise<VoiceWakeConfig> {
  return await callGatewayMethod<VoiceWakeConfig>("voicewake.set", { triggers });
}

// --- Provider / API Key Rotation ---

export interface ProviderEntry {
  id: string;
  name: string;
  apiKeyMasked: string;
  enabled: boolean;
  priority: number;
  rateLimited?: boolean;
  rateLimitResetsAt?: number;
}

export interface ProviderConfig {
  providers: ProviderEntry[];
  activeProvider: string;
  autoRotation: boolean;
  rotationStrategy: string;
}

export async function getProviderConfig(): Promise<ProviderConfig> {
  return await callGatewayMethod<ProviderConfig>("anima.providers.get", {});
}

export async function setProviderConfig(
  providers: Array<{
    id: string;
    name: string;
    apiKey?: string;
    enabled: boolean;
    priority: number;
  }>,
): Promise<void> {
  await callGatewayMethod("anima.providers.set", { providers });
}

export async function toggleProviderRotation(enabled: boolean): Promise<void> {
  await callGatewayMethod("anima.providers.rotate", { enabled });
}

export async function setSVRNEnabled(enabled: boolean): Promise<{ success: boolean }> {
  return request<{ success: boolean }>("/api/svrn/toggle", {
    method: "POST",
    body: JSON.stringify({ enabled }),
  });
}

export async function updateSVRNLimits(limits: {
  maxCpuPercent?: number;
  maxRamMB?: number;
  maxBandwidthMbps?: number;
}): Promise<{ success: boolean }> {
  return request<{ success: boolean }>("/api/svrn/limits", {
    method: "POST",
    body: JSON.stringify(limits),
  });
}

// --- WebSocket ---

// --- Organization Types ---

export type OrgMemberKind = "human" | "agent";
export type OrgRoleType = "owner" | "operator" | "coordinator" | "worker" | "observer";
export type OrgMemberStatus = "active" | "idle" | "busy" | "offline" | "suspended";

export interface OrgSettings {
  maxAgents: number;
  maxHumans: number;
  autoSpecialization: boolean;
  securityLevel: "standard" | "hardened" | "paranoid";
  syncIntervalMs: number;
  backupIntervalMs: number;
  peerPort: number;
}

export interface NoxOrganization {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  updatedAt: number;
  ownerId: string;
  settings: OrgSettings;
}

export interface OrgMember {
  id: string;
  kind: OrgMemberKind;
  displayName: string;
  deviceId?: string;
  role: OrgRoleType;
  description: string;
  specializations: string[];
  joinedAt: number;
  lastActiveAt: number;
  status: OrgMemberStatus;
  reportsTo?: string;
  permissions: Record<string, boolean | string[]>;
}

export interface OrgHierarchyNode {
  memberId: string;
  displayName: string;
  kind: OrgMemberKind;
  role: OrgRoleType;
  specializations: string[];
  status: OrgMemberStatus;
  children: OrgHierarchyNode[];
}

// --- Organization API ---

export async function listOrgs(): Promise<NoxOrganization[]> {
  const result = await callGatewayMethod<{ orgs: NoxOrganization[] }>("org.list", {});
  return Array.isArray(result.orgs) ? result.orgs : [];
}

export async function getOrg(
  orgId: string,
): Promise<{ org: NoxOrganization; members: OrgMember[] }> {
  return await callGatewayMethod<{ org: NoxOrganization; members: OrgMember[] }>("org.get", {
    orgId,
  });
}

export async function createOrg(params: {
  name: string;
  description?: string;
  ownerId: string;
  ownerName: string;
  ownerKind: OrgMemberKind;
  settings?: Partial<OrgSettings>;
}): Promise<{ org: NoxOrganization; members: OrgMember[] }> {
  return await callGatewayMethod<{ org: NoxOrganization; members: OrgMember[] }>(
    "org.create",
    params,
  );
}

export async function updateOrg(
  orgId: string,
  updates: { name?: string; description?: string; settings?: Partial<OrgSettings> },
): Promise<NoxOrganization> {
  const result = await callGatewayMethod<{ org: NoxOrganization }>("org.update", {
    orgId,
    ...updates,
  });
  return result.org;
}

export async function addOrgMember(
  orgId: string,
  member: {
    displayName: string;
    kind: OrgMemberKind;
    role?: OrgRoleType;
    description?: string;
    specializations?: string[];
    status?: OrgMemberStatus;
    reportsTo?: string;
  },
): Promise<OrgMember> {
  const result = await callGatewayMethod<{ member: OrgMember }>("org.addMember", {
    orgId,
    ...member,
  });
  return result.member;
}

export async function updateOrgMember(
  orgId: string,
  memberId: string,
  updates: {
    displayName?: string;
    role?: OrgRoleType;
    description?: string;
    specializations?: string[];
    status?: OrgMemberStatus;
    reportsTo?: string;
  },
): Promise<OrgMember> {
  const result = await callGatewayMethod<{ member: OrgMember }>("org.updateMember", {
    orgId,
    memberId,
    ...updates,
  });
  return result.member;
}

export async function removeOrgMember(orgId: string, memberId: string): Promise<void> {
  await callGatewayMethod<{ ok: true }>("org.removeMember", { orgId, memberId });
}

export async function getOrgHierarchy(orgId: string): Promise<OrgHierarchyNode[]> {
  const result = await callGatewayMethod<{ hierarchy: OrgHierarchyNode[] }>("org.hierarchy", {
    orgId,
  });
  return Array.isArray(result.hierarchy) ? result.hierarchy : [];
}

export async function joinOrgWithInvite(params: {
  inviteCode: string;
  passcode: string;
  displayName: string;
  kind: OrgMemberKind;
  description: string;
  specializations: string[];
}): Promise<{ org: NoxOrganization; member: OrgMember }> {
  return callGatewayMethod<{ org: NoxOrganization; member: OrgMember }>("org.join", params);
}

export async function validateOrgInvite(params: {
  inviteCode: string;
  passcode: string;
}): Promise<{ org: NoxOrganization; role: OrgRoleType }> {
  return callGatewayMethod<{ org: NoxOrganization; role: OrgRoleType }>(
    "org.validateInvite",
    params,
  );
}

export async function createOrgInvite(params: {
  orgId: string;
  passcode: string;
  role?: OrgRoleType;
  maxUses?: number;
  expiresInMs?: number;
}): Promise<{ code: string; passcode: string }> {
  return callGatewayMethod<{ code: string; passcode: string }>("org.createInvite", params);
}

// --- WebSocket ---

export function connectWebSocket(
  onMessage: (event: MessageEvent) => void,
  onError?: (event: Event) => void,
): WebSocket {
  const ws = new WebSocket(GATEWAY_WS_URL);

  ws.addEventListener("message", onMessage);
  if (onError) {
    ws.addEventListener("error", onError);
  }

  return ws;
}
