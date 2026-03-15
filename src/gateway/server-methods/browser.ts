import crypto from "node:crypto";
import type { NodeSession } from "../node-registry.js";
import type { GatewayClient, GatewayRequestContext, GatewayRequestHandlers } from "./types.js";
import {
  createBrowserControlContext,
  startBrowserControlServiceFromConfig,
} from "../../browser/control-service.js";
import { applyBrowserProxyPaths, persistBrowserProxyFiles } from "../../browser/proxy-files.js";
import { createBrowserRouteDispatcher } from "../../browser/routes/dispatcher.js";
import { loadConfig } from "../../config/config.js";
import { isNodeCommandAllowed, resolveNodeCommandAllowlist } from "../node-command-policy.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { safeParseJson } from "./nodes.helpers.js";

type BrowserRequestParams = {
  method?: string;
  path?: string;
  query?: Record<string, unknown>;
  body?: unknown;
  timeoutMs?: number;
};

type BrowserProxyFile = {
  path: string;
  base64: string;
  mimeType?: string;
};

type BrowserProxyResult = {
  result: unknown;
  files?: BrowserProxyFile[];
};

type BrowserNodeSummary = {
  nodeId: string;
  displayName: string | null;
  remoteIp: string | null;
};

export type BrowserCapabilitiesSnapshot = {
  browserEnabled: boolean;
  evaluateEnabled: boolean;
  auth: {
    configured: boolean;
    mode: "token" | "password" | "trusted-proxy" | "none";
  };
  routing: {
    mode: "auto" | "manual" | "off";
    pinnedNode: string | null;
    activeRoute: "disabled" | "local" | "node" | "error";
    selectedNode: BrowserNodeSummary | null;
    availableNodes: BrowserNodeSummary[];
    error: string | null;
  };
  warnings: string[];
};

type NormalizedBrowserRequest = {
  methodRaw: "GET" | "POST" | "DELETE";
  path: string;
  query: Record<string, unknown> | undefined;
  body: unknown;
  timeoutMs: number | undefined;
};

type BrowserDispatchResult =
  | {
      ok: true;
      route: "local" | "node";
      nodeId: string | null;
      payload: unknown;
      status: number;
    }
  | {
      ok: false;
      route: "local" | "node";
      nodeId: string | null;
      status: number;
      error: ReturnType<typeof errorShape>;
    };

type DesktopControlSessionMethod = "GET" | "POST" | "DELETE";

type DesktopControlSessionControls = {
  allowMethods: DesktopControlSessionMethod[];
  maxRequests: number;
};

type DesktopControlSessionRiskLevel = "standard" | "elevated";

type DesktopControlSessionRisk = {
  level: DesktopControlSessionRiskLevel;
  reasons: string[];
};

type DesktopControlSessionState = "pending_approval" | "active" | "denied" | "closed" | "expired";

type DesktopControlSessionRoute =
  | {
      kind: "local";
      node: null;
    }
  | {
      kind: "node";
      node: BrowserNodeSummary;
    };

type DesktopControlSessionApproval = {
  required: true;
  decision: "pending" | "allow" | "deny";
  requestedAtMs: number;
  requestedBy: string | null;
  decidedAtMs: number | null;
  decidedBy: string | null;
  note: string | null;
};

type DesktopControlAuditEvent = {
  id: string;
  ts: number;
  type:
    | "session.created"
    | "session.approved"
    | "session.denied"
    | "session.closed"
    | "session.expired"
    | "request.start"
    | "request.ok"
    | "request.error";
  actor: string | null;
  details?: Record<string, unknown>;
};

type DesktopControlSessionRecord = {
  id: string;
  reason: string;
  createdAtMs: number;
  expiresAtMs: number;
  state: DesktopControlSessionState;
  route: DesktopControlSessionRoute;
  approval: DesktopControlSessionApproval;
  controls: DesktopControlSessionControls;
  risk: DesktopControlSessionRisk;
  requestCount: number;
  lastRequestAtMs: number | null;
  closedAtMs: number | null;
  audit: DesktopControlAuditEvent[];
};

type DesktopControlSessionSnapshot = {
  id: string;
  reason: string;
  createdAtMs: number;
  expiresAtMs: number;
  state: DesktopControlSessionState;
  route: DesktopControlSessionRoute;
  approval: DesktopControlSessionApproval;
  controls: DesktopControlSessionControls;
  risk: DesktopControlSessionRisk;
  requestCount: number;
  lastRequestAtMs: number | null;
  closedAtMs: number | null;
  audit?: DesktopControlAuditEvent[];
};

type DesktopControlSessionEventAction =
  | "created"
  | "approved"
  | "denied"
  | "closed"
  | "expired"
  | "request_ok"
  | "request_error";

type DesktopControlCreateParams = {
  reason?: string;
  ttlMs?: number;
  nodeId?: string;
  allowMethods?: string[];
  maxRequests?: number;
};

type DesktopControlDecisionParams = {
  id?: string;
  decision?: string;
  note?: string;
};

type DesktopControlGetParams = {
  id?: string;
  includeAudit?: boolean;
};

type DesktopControlListParams = {
  includeAudit?: boolean;
  state?: DesktopControlSessionState;
};

type DesktopControlCloseParams = {
  id?: string;
  note?: string;
};

type DesktopControlRequestParams = BrowserRequestParams & {
  id?: string;
};

const DESKTOP_CONTROL_DEFAULT_TTL_MS = 15 * 60 * 1000;
const DESKTOP_CONTROL_MIN_TTL_MS = 60 * 1000;
const DESKTOP_CONTROL_MAX_TTL_MS = 4 * 60 * 60 * 1000;
const DESKTOP_CONTROL_MAX_REASON_LEN = 240;
const DESKTOP_CONTROL_AUDIT_MAX_EVENTS = 200;
const DESKTOP_CONTROL_RETENTION_MS = 2 * 60 * 60 * 1000;
const DESKTOP_CONTROL_DEFAULT_ALLOWED_METHODS: DesktopControlSessionMethod[] = ["GET"];
const DESKTOP_CONTROL_DEFAULT_MAX_REQUESTS = 40;
const DESKTOP_CONTROL_MIN_MAX_REQUESTS = 1;
const DESKTOP_CONTROL_MAX_MAX_REQUESTS = 500;

const desktopControlSessions = new Map<string, DesktopControlSessionRecord>();

function isBrowserNode(node: NodeSession) {
  const caps = Array.isArray(node.caps) ? node.caps : [];
  const commands = Array.isArray(node.commands) ? node.commands : [];
  return caps.includes("browser") || commands.includes("browser.proxy");
}

function normalizeNodeKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function resolveBrowserNode(nodes: NodeSession[], query: string): NodeSession | null {
  const q = query.trim();
  if (!q) {
    return null;
  }
  const qNorm = normalizeNodeKey(q);
  const matches = nodes.filter((node) => {
    if (node.nodeId === q) {
      return true;
    }
    if (typeof node.remoteIp === "string" && node.remoteIp === q) {
      return true;
    }
    const name = typeof node.displayName === "string" ? node.displayName : "";
    if (name && normalizeNodeKey(name) === qNorm) {
      return true;
    }
    if (q.length >= 6 && node.nodeId.startsWith(q)) {
      return true;
    }
    return false;
  });
  if (matches.length === 1) {
    return matches[0] ?? null;
  }
  if (matches.length === 0) {
    return null;
  }
  throw new Error(
    `ambiguous node: ${q} (matches: ${matches
      .map((node) => node.displayName || node.remoteIp || node.nodeId)
      .join(", ")})`,
  );
}

function resolveBrowserNodeTarget(params: {
  cfg: ReturnType<typeof loadConfig>;
  nodes: NodeSession[];
}): NodeSession | null {
  const policy = params.cfg.gateway?.nodes?.browser;
  const mode = policy?.mode ?? "auto";
  if (mode === "off") {
    return null;
  }
  const browserNodes = params.nodes.filter((node) => isBrowserNode(node));
  if (browserNodes.length === 0) {
    if (policy?.node?.trim()) {
      throw new Error("No connected browser-capable nodes.");
    }
    return null;
  }
  const requested = policy?.node?.trim() || "";
  if (requested) {
    const resolved = resolveBrowserNode(browserNodes, requested);
    if (!resolved) {
      throw new Error(`Configured browser node not connected: ${requested}`);
    }
    return resolved;
  }
  if (mode === "manual") {
    return null;
  }
  if (browserNodes.length === 1) {
    return browserNodes[0] ?? null;
  }
  return null;
}

async function persistProxyFiles(files: BrowserProxyFile[] | undefined) {
  return await persistBrowserProxyFiles(files);
}

function applyProxyPaths(result: unknown, mapping: Map<string, string>) {
  applyBrowserProxyPaths(result, mapping);
}

function toNodeSummary(node: NodeSession): BrowserNodeSummary {
  return {
    nodeId: node.nodeId,
    displayName: node.displayName ?? null,
    remoteIp: node.remoteIp ?? null,
  };
}

function hasValue(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function resolveGatewayAuthMode(
  cfg: ReturnType<typeof loadConfig>,
): BrowserCapabilitiesSnapshot["auth"]["mode"] {
  const configuredMode = cfg.gateway?.auth?.mode;
  if (
    configuredMode === "token" ||
    configuredMode === "password" ||
    configuredMode === "trusted-proxy"
  ) {
    return configuredMode;
  }
  if (hasValue(cfg.gateway?.auth?.token)) {
    return "token";
  }
  if (hasValue(cfg.gateway?.auth?.password)) {
    return "password";
  }
  if (hasValue(cfg.gateway?.auth?.trustedProxy?.userHeader)) {
    return "trusted-proxy";
  }
  return "none";
}

function resolveClientActor(client: GatewayClient | null): string | null {
  const displayName = client?.connect?.client?.displayName;
  if (typeof displayName === "string" && displayName.trim().length > 0) {
    return displayName.trim();
  }
  const clientId = client?.connect?.client?.id;
  if (typeof clientId === "string" && clientId.trim().length > 0) {
    return clientId.trim();
  }
  const deviceId = client?.connect?.device?.id;
  if (typeof deviceId === "string" && deviceId.trim().length > 0) {
    return deviceId.trim();
  }
  return null;
}

function hasOperatorScope(client: GatewayClient | null, scope: string): boolean {
  const scopes = Array.isArray(client?.connect?.scopes) ? client?.connect?.scopes : [];
  return scopes.includes("operator.admin") || scopes.includes(scope);
}

function normalizeDesktopSessionTtl(input: unknown): number {
  if (typeof input !== "number" || !Number.isFinite(input)) {
    return DESKTOP_CONTROL_DEFAULT_TTL_MS;
  }
  return Math.min(
    DESKTOP_CONTROL_MAX_TTL_MS,
    Math.max(DESKTOP_CONTROL_MIN_TTL_MS, Math.floor(input)),
  );
}

function normalizeDesktopSessionReason(input: unknown): string {
  if (typeof input !== "string") {
    return "Desktop control session";
  }
  const trimmed = input.trim();
  if (!trimmed) {
    return "Desktop control session";
  }
  return trimmed.slice(0, DESKTOP_CONTROL_MAX_REASON_LEN);
}

function normalizeDesktopSessionAllowMethods(input: unknown): DesktopControlSessionMethod[] {
  if (!Array.isArray(input)) {
    return [...DESKTOP_CONTROL_DEFAULT_ALLOWED_METHODS];
  }
  const normalized: DesktopControlSessionMethod[] = [];
  for (const entry of input) {
    if (typeof entry !== "string") {
      continue;
    }
    const method = entry.trim().toUpperCase();
    if (
      (method === "GET" || method === "POST" || method === "DELETE") &&
      !normalized.includes(method)
    ) {
      normalized.push(method);
    }
  }
  if (normalized.length === 0) {
    return [...DESKTOP_CONTROL_DEFAULT_ALLOWED_METHODS];
  }
  return normalized;
}

function normalizeDesktopSessionMaxRequests(input: unknown): number {
  if (typeof input !== "number" || !Number.isFinite(input)) {
    return DESKTOP_CONTROL_DEFAULT_MAX_REQUESTS;
  }
  return Math.min(
    DESKTOP_CONTROL_MAX_MAX_REQUESTS,
    Math.max(DESKTOP_CONTROL_MIN_MAX_REQUESTS, Math.floor(input)),
  );
}

function resolveDesktopSessionRisk(
  controls: DesktopControlSessionControls,
): DesktopControlSessionRisk {
  const reasons: string[] = [];
  const hasWriteMethod = controls.allowMethods.some((method) => method !== "GET");
  if (hasWriteMethod) {
    reasons.push("write methods enabled (POST/DELETE)");
  }
  if (controls.maxRequests > DESKTOP_CONTROL_DEFAULT_MAX_REQUESTS) {
    reasons.push(
      `request budget exceeds standard (${controls.maxRequests} > ${DESKTOP_CONTROL_DEFAULT_MAX_REQUESTS})`,
    );
  }
  return {
    level: reasons.length > 0 ? "elevated" : "standard",
    reasons,
  };
}

function appendDesktopControlAudit(
  session: DesktopControlSessionRecord,
  event: Omit<DesktopControlAuditEvent, "id" | "ts"> & { ts?: number },
) {
  const next: DesktopControlAuditEvent = {
    id: crypto.randomUUID(),
    ts: typeof event.ts === "number" && Number.isFinite(event.ts) ? event.ts : Date.now(),
    type: event.type,
    actor: event.actor,
    details: event.details,
  };
  session.audit.push(next);
  if (session.audit.length > DESKTOP_CONTROL_AUDIT_MAX_EVENTS) {
    session.audit.splice(0, session.audit.length - DESKTOP_CONTROL_AUDIT_MAX_EVENTS);
  }
}

function toDesktopControlSessionSnapshot(
  session: DesktopControlSessionRecord,
  includeAudit = false,
): DesktopControlSessionSnapshot {
  return {
    id: session.id,
    reason: session.reason,
    createdAtMs: session.createdAtMs,
    expiresAtMs: session.expiresAtMs,
    state: session.state,
    route:
      session.route.kind === "node"
        ? { kind: "node", node: { ...session.route.node } }
        : session.route,
    approval: { ...session.approval },
    controls: {
      allowMethods: [...session.controls.allowMethods],
      maxRequests: session.controls.maxRequests,
    },
    risk: {
      level: session.risk.level,
      reasons: [...session.risk.reasons],
    },
    requestCount: session.requestCount,
    lastRequestAtMs: session.lastRequestAtMs,
    closedAtMs: session.closedAtMs,
    audit: includeAudit ? session.audit.map((entry) => ({ ...entry })) : undefined,
  };
}

function broadcastDesktopControlSessionEvent(params: {
  context: GatewayRequestContext;
  action: DesktopControlSessionEventAction;
  session: DesktopControlSessionRecord;
  actor: string | null;
  details?: Record<string, unknown>;
}) {
  const latestAudit = params.session.audit[params.session.audit.length - 1];
  params.context.broadcast(
    "desktop.control.session.updated",
    {
      ts: Date.now(),
      action: params.action,
      actor: params.actor,
      details: params.details,
      session: toDesktopControlSessionSnapshot(params.session, false),
      latestAudit: latestAudit ? { ...latestAudit } : null,
    },
    { dropIfSlow: true },
  );
}

function pruneDesktopControlSessions(params?: { now?: number; context?: GatewayRequestContext }) {
  const now = params?.now ?? Date.now();
  const context = params?.context;
  for (const session of desktopControlSessions.values()) {
    if (
      (session.state === "pending_approval" || session.state === "active") &&
      session.expiresAtMs <= now
    ) {
      session.state = "expired";
      session.closedAtMs = now;
      appendDesktopControlAudit(session, {
        type: "session.expired",
        actor: "system",
      });
      if (context) {
        broadcastDesktopControlSessionEvent({
          context,
          action: "expired",
          session,
          actor: "system",
        });
      }
    }
  }

  for (const [id, session] of desktopControlSessions.entries()) {
    if (
      (session.state === "closed" || session.state === "denied" || session.state === "expired") &&
      session.closedAtMs &&
      now - session.closedAtMs > DESKTOP_CONTROL_RETENTION_MS
    ) {
      desktopControlSessions.delete(id);
    }
  }
}

function normalizeBrowserRequest(
  params: BrowserRequestParams,
):
  | { ok: true; request: NormalizedBrowserRequest }
  | { ok: false; error: ReturnType<typeof errorShape> } {
  const methodRaw = typeof params.method === "string" ? params.method.trim().toUpperCase() : "";
  const path = typeof params.path === "string" ? params.path.trim() : "";
  const query = params.query && typeof params.query === "object" ? params.query : undefined;
  const body = params.body;
  const timeoutMs =
    typeof params.timeoutMs === "number" && Number.isFinite(params.timeoutMs)
      ? Math.max(1, Math.floor(params.timeoutMs))
      : undefined;

  if (!methodRaw || !path) {
    return {
      ok: false,
      error: errorShape(ErrorCodes.INVALID_REQUEST, "method and path are required"),
    };
  }
  if (methodRaw !== "GET" && methodRaw !== "POST" && methodRaw !== "DELETE") {
    return {
      ok: false,
      error: errorShape(ErrorCodes.INVALID_REQUEST, "method must be GET, POST, or DELETE"),
    };
  }

  return {
    ok: true,
    request: {
      methodRaw,
      path,
      query,
      body,
      timeoutMs,
    },
  };
}

async function dispatchBrowserRequest(params: {
  cfg: ReturnType<typeof loadConfig>;
  request: NormalizedBrowserRequest;
  context: GatewayRequestContext;
  nodeTarget: NodeSession | null;
}): Promise<BrowserDispatchResult> {
  const { cfg, request, context, nodeTarget } = params;

  if (nodeTarget) {
    const allowlist = resolveNodeCommandAllowlist(cfg, nodeTarget);
    const allowed = isNodeCommandAllowed({
      command: "browser.proxy",
      declaredCommands: nodeTarget.commands,
      allowlist,
    });
    if (!allowed.ok) {
      return {
        ok: false,
        route: "node",
        nodeId: nodeTarget.nodeId,
        status: 403,
        error: errorShape(ErrorCodes.INVALID_REQUEST, "node command not allowed", {
          details: { reason: allowed.reason, command: "browser.proxy" },
        }),
      };
    }

    const proxyParams = {
      method: request.methodRaw,
      path: request.path,
      query: request.query,
      body: request.body,
      timeoutMs: request.timeoutMs,
      profile: typeof request.query?.profile === "string" ? request.query.profile : undefined,
    };
    const res = await context.nodeRegistry.invoke({
      nodeId: nodeTarget.nodeId,
      command: "browser.proxy",
      params: proxyParams,
      timeoutMs: request.timeoutMs,
      idempotencyKey: crypto.randomUUID(),
    });
    if (!res.ok) {
      return {
        ok: false,
        route: "node",
        nodeId: nodeTarget.nodeId,
        status: 503,
        error: errorShape(ErrorCodes.UNAVAILABLE, res.error?.message ?? "node invoke failed", {
          details: { nodeError: res.error ?? null },
        }),
      };
    }

    const payload = res.payloadJSON ? safeParseJson(res.payloadJSON) : res.payload;
    const proxy = payload && typeof payload === "object" ? (payload as BrowserProxyResult) : null;
    if (!proxy || !("result" in proxy)) {
      return {
        ok: false,
        route: "node",
        nodeId: nodeTarget.nodeId,
        status: 503,
        error: errorShape(ErrorCodes.UNAVAILABLE, "browser proxy failed"),
      };
    }
    const mapping = await persistProxyFiles(proxy.files);
    applyProxyPaths(proxy.result, mapping);
    return {
      ok: true,
      route: "node",
      nodeId: nodeTarget.nodeId,
      status: 200,
      payload: proxy.result,
    };
  }

  const ready = await startBrowserControlServiceFromConfig();
  if (!ready) {
    return {
      ok: false,
      route: "local",
      nodeId: null,
      status: 503,
      error: errorShape(ErrorCodes.UNAVAILABLE, "browser control is disabled"),
    };
  }

  let dispatcher;
  try {
    dispatcher = createBrowserRouteDispatcher(createBrowserControlContext());
  } catch (err) {
    return {
      ok: false,
      route: "local",
      nodeId: null,
      status: 503,
      error: errorShape(ErrorCodes.UNAVAILABLE, String(err)),
    };
  }

  const result = await dispatcher.dispatch({
    method: request.methodRaw,
    path: request.path,
    query: request.query,
    body: request.body,
  });

  if (result.status >= 400) {
    const message =
      result.body && typeof result.body === "object" && "error" in result.body
        ? String((result.body as { error?: unknown }).error)
        : `browser request failed (${result.status})`;
    const code = result.status >= 500 ? ErrorCodes.UNAVAILABLE : ErrorCodes.INVALID_REQUEST;
    return {
      ok: false,
      route: "local",
      nodeId: null,
      status: result.status,
      error: errorShape(code, message, { details: result.body }),
    };
  }

  return {
    ok: true,
    route: "local",
    nodeId: null,
    status: result.status,
    payload: result.body,
  };
}

function resolveDesktopSessionNodeTarget(params: {
  session: DesktopControlSessionRecord;
  nodes: NodeSession[];
}): NodeSession | null {
  if (params.session.route.kind !== "node") {
    return null;
  }
  return (
    params.nodes.find(
      (node) => node.nodeId === params.session.route.node.nodeId && isBrowserNode(node),
    ) ?? null
  );
}

function ensureDesktopSessionExists(
  idRaw: unknown,
):
  | { ok: true; session: DesktopControlSessionRecord }
  | { ok: false; error: ReturnType<typeof errorShape> } {
  const id = typeof idRaw === "string" ? idRaw.trim() : "";
  if (!id) {
    return {
      ok: false,
      error: errorShape(ErrorCodes.INVALID_REQUEST, "id is required"),
    };
  }
  const session = desktopControlSessions.get(id);
  if (!session) {
    return {
      ok: false,
      error: errorShape(ErrorCodes.INVALID_REQUEST, "unknown desktop control session id"),
    };
  }
  return { ok: true, session };
}

export function resetDesktopControlSessionsForTests() {
  desktopControlSessions.clear();
}

export function buildBrowserCapabilitiesSnapshot(params: {
  cfg: ReturnType<typeof loadConfig>;
  nodes: NodeSession[];
}): BrowserCapabilitiesSnapshot {
  const browserEnabled = params.cfg.browser?.enabled !== false;
  const evaluateEnabled = browserEnabled && params.cfg.browser?.evaluateEnabled !== false;
  const mode = params.cfg.gateway?.nodes?.browser?.mode ?? "auto";
  const pinnedNode = hasValue(params.cfg.gateway?.nodes?.browser?.node)
    ? String(params.cfg.gateway?.nodes?.browser?.node).trim()
    : null;
  const availableNodes = params.nodes.filter((node) => isBrowserNode(node)).map(toNodeSummary);
  const authMode = resolveGatewayAuthMode(params.cfg);
  const authConfigured =
    hasValue(params.cfg.gateway?.auth?.token) ||
    hasValue(params.cfg.gateway?.auth?.password) ||
    authMode === "trusted-proxy";

  let selectedNode: NodeSession | null = null;
  let routingError: string | null = null;
  try {
    selectedNode = resolveBrowserNodeTarget(params);
  } catch (error) {
    routingError = String(error);
  }

  const activeRoute: BrowserCapabilitiesSnapshot["routing"]["activeRoute"] =
    !browserEnabled || mode === "off"
      ? "disabled"
      : routingError
        ? "error"
        : selectedNode
          ? "node"
          : "local";

  const warnings: string[] = [];
  if (browserEnabled && !authConfigured) {
    warnings.push(
      "Browser control is enabled without gateway auth. Configure gateway.auth.token or gateway.auth.password.",
    );
  }
  if (mode === "manual" && !pinnedNode) {
    warnings.push(
      "Browser node routing is set to manual but no gateway.nodes.browser.node is pinned; routing will fall back to local browser control.",
    );
  }
  if (availableNodes.length > 1 && mode === "auto" && !pinnedNode && !selectedNode) {
    warnings.push(
      "Multiple browser-capable nodes are connected; set gateway.nodes.browser.node to pin a target.",
    );
  }
  if (routingError) {
    warnings.push(routingError);
  }

  return {
    browserEnabled,
    evaluateEnabled,
    auth: {
      configured: authConfigured,
      mode: authMode,
    },
    routing: {
      mode,
      pinnedNode,
      activeRoute,
      selectedNode: selectedNode ? toNodeSummary(selectedNode) : null,
      availableNodes,
      error: routingError,
    },
    warnings,
  };
}

export const browserHandlers: GatewayRequestHandlers = {
  "browser.capabilities.get": async ({ respond, context }) => {
    try {
      const snapshot = buildBrowserCapabilitiesSnapshot({
        cfg: loadConfig(),
        nodes: context.nodeRegistry.listConnected(),
      });
      respond(true, snapshot);
    } catch (error) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(error)));
    }
  },
  "browser.request": async ({ params, respond, context }) => {
    const normalized = normalizeBrowserRequest(params as BrowserRequestParams);
    if (!normalized.ok) {
      respond(false, undefined, normalized.error);
      return;
    }
    const cfg = loadConfig();
    let nodeTarget: NodeSession | null = null;
    try {
      nodeTarget = resolveBrowserNodeTarget({
        cfg,
        nodes: context.nodeRegistry.listConnected(),
      });
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
      return;
    }
    const result = await dispatchBrowserRequest({
      cfg,
      request: normalized.request,
      context,
      nodeTarget,
    });
    if (!result.ok) {
      respond(false, undefined, result.error);
      return;
    }
    respond(true, result.payload);
  },
  "desktop.control.session.create": async ({ params, respond, context, client }) => {
    pruneDesktopControlSessions({ context });
    const typed = params as DesktopControlCreateParams;
    const cfg = loadConfig();
    const connectedNodes = context.nodeRegistry.listConnected();
    const browserNodes = connectedNodes.filter((node) => isBrowserNode(node));
    const requestedNodeId = typeof typed.nodeId === "string" ? typed.nodeId.trim() : "";
    const reason = normalizeDesktopSessionReason(typed.reason);
    const ttlMs = normalizeDesktopSessionTtl(typed.ttlMs);
    const allowMethods = normalizeDesktopSessionAllowMethods(typed.allowMethods);
    const maxRequests = normalizeDesktopSessionMaxRequests(typed.maxRequests);
    const risk = resolveDesktopSessionRisk({
      allowMethods,
      maxRequests,
    });
    const now = Date.now();
    const actor = resolveClientActor(client);

    const snapshot = buildBrowserCapabilitiesSnapshot({
      cfg,
      nodes: connectedNodes,
    });
    if (!snapshot.browserEnabled || snapshot.routing.mode === "off") {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, "browser control is disabled"));
      return;
    }

    let routeNode: NodeSession | null = null;
    try {
      if (requestedNodeId) {
        routeNode = resolveBrowserNode(browserNodes, requestedNodeId);
        if (!routeNode) {
          respond(
            false,
            undefined,
            errorShape(
              ErrorCodes.INVALID_REQUEST,
              `requested browser node is not connected: ${requestedNodeId}`,
            ),
          );
          return;
        }
      } else {
        routeNode = resolveBrowserNodeTarget({
          cfg,
          nodes: connectedNodes,
        });
      }
    } catch (error) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(error)));
      return;
    }

    const id = crypto.randomUUID();
    const session: DesktopControlSessionRecord = {
      id,
      reason,
      createdAtMs: now,
      expiresAtMs: now + ttlMs,
      state: "pending_approval",
      route: routeNode
        ? {
            kind: "node",
            node: toNodeSummary(routeNode),
          }
        : {
            kind: "local",
            node: null,
          },
      approval: {
        required: true,
        decision: "pending",
        requestedAtMs: now,
        requestedBy: actor,
        decidedAtMs: null,
        decidedBy: null,
        note: null,
      },
      controls: {
        allowMethods,
        maxRequests,
      },
      risk,
      requestCount: 0,
      lastRequestAtMs: null,
      closedAtMs: null,
      audit: [],
    };
    appendDesktopControlAudit(session, {
      type: "session.created",
      actor,
      details: {
        reason: session.reason,
        route: session.route.kind,
        nodeId: session.route.kind === "node" ? session.route.node.nodeId : null,
        expiresAtMs: session.expiresAtMs,
        allowMethods: session.controls.allowMethods,
        maxRequests: session.controls.maxRequests,
        riskLevel: session.risk.level,
        riskReasons: session.risk.reasons,
      },
    });
    desktopControlSessions.set(id, session);
    broadcastDesktopControlSessionEvent({
      context,
      action: "created",
      session,
      actor,
    });
    respond(true, toDesktopControlSessionSnapshot(session, true));
  },
  "desktop.control.session.list": async ({ params, respond, context }) => {
    pruneDesktopControlSessions({ context });
    const typed = params as DesktopControlListParams;
    const includeAudit = typed.includeAudit === true;
    const state = typeof typed.state === "string" ? typed.state : undefined;
    const sessions = Array.from(desktopControlSessions.values())
      .filter((entry) => (state ? entry.state === state : true))
      .toSorted((a, b) => b.createdAtMs - a.createdAtMs)
      .map((entry) => toDesktopControlSessionSnapshot(entry, includeAudit));
    respond(true, {
      ts: Date.now(),
      total: sessions.length,
      sessions,
    });
  },
  "desktop.control.session.get": async ({ params, respond, context }) => {
    pruneDesktopControlSessions({ context });
    const typed = params as DesktopControlGetParams;
    const found = ensureDesktopSessionExists(typed.id);
    if (!found.ok) {
      respond(false, undefined, found.error);
      return;
    }
    respond(true, toDesktopControlSessionSnapshot(found.session, typed.includeAudit === true));
  },
  "desktop.control.session.approve": async ({ params, respond, client, context }) => {
    pruneDesktopControlSessions({ context });
    if (!hasOperatorScope(client, "operator.approvals")) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "missing scope: operator.approvals"),
      );
      return;
    }
    const typed = params as DesktopControlDecisionParams;
    const found = ensureDesktopSessionExists(typed.id);
    if (!found.ok) {
      respond(false, undefined, found.error);
      return;
    }
    const session = found.session;
    if (session.state !== "pending_approval") {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `session is not pending approval (state: ${session.state})`,
        ),
      );
      return;
    }
    if (session.expiresAtMs <= Date.now()) {
      session.state = "expired";
      session.closedAtMs = Date.now();
      appendDesktopControlAudit(session, {
        type: "session.expired",
        actor: "system",
      });
      broadcastDesktopControlSessionEvent({
        context,
        action: "expired",
        session,
        actor: "system",
      });
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "session has expired"));
      return;
    }
    const decisionRaw =
      typeof typed.decision === "string" ? typed.decision.trim().toLowerCase() : "";
    if (decisionRaw !== "allow" && decisionRaw !== "deny") {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "decision must be allow or deny"),
      );
      return;
    }
    const note = typeof typed.note === "string" && typed.note.trim() ? typed.note.trim() : null;
    if (decisionRaw === "allow" && session.risk.level === "elevated" && !note) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "note is required when approving elevated-risk desktop control sessions",
          {
            details: {
              riskLevel: session.risk.level,
              riskReasons: session.risk.reasons,
            },
          },
        ),
      );
      return;
    }
    const actor = resolveClientActor(client);
    const now = Date.now();
    session.approval.decision = decisionRaw;
    session.approval.decidedAtMs = now;
    session.approval.decidedBy = actor;
    session.approval.note = note;
    session.state = decisionRaw === "allow" ? "active" : "denied";
    if (session.state === "denied") {
      session.closedAtMs = now;
    }
    appendDesktopControlAudit(session, {
      type: decisionRaw === "allow" ? "session.approved" : "session.denied",
      actor,
      details: {
        note: session.approval.note,
      },
    });
    broadcastDesktopControlSessionEvent({
      context,
      action: decisionRaw === "allow" ? "approved" : "denied",
      session,
      actor,
      details: {
        note: session.approval.note,
      },
    });
    respond(true, toDesktopControlSessionSnapshot(session, true));
  },
  "desktop.control.session.close": async ({ params, respond, client, context }) => {
    pruneDesktopControlSessions({ context });
    const typed = params as DesktopControlCloseParams;
    const found = ensureDesktopSessionExists(typed.id);
    if (!found.ok) {
      respond(false, undefined, found.error);
      return;
    }
    const session = found.session;
    if (session.state === "closed") {
      respond(true, toDesktopControlSessionSnapshot(session, true));
      return;
    }
    const now = Date.now();
    session.state = "closed";
    session.closedAtMs = now;
    const note = typeof typed.note === "string" && typed.note.trim() ? typed.note.trim() : null;
    appendDesktopControlAudit(session, {
      type: "session.closed",
      actor: resolveClientActor(client),
      details: {
        note,
      },
    });
    broadcastDesktopControlSessionEvent({
      context,
      action: "closed",
      session,
      actor: resolveClientActor(client),
      details: {
        note,
      },
    });
    respond(true, toDesktopControlSessionSnapshot(session, true));
  },
  "desktop.control.session.request": async ({ params, respond, client, context }) => {
    pruneDesktopControlSessions({ context });
    const typed = params as DesktopControlRequestParams;
    const found = ensureDesktopSessionExists(typed.id);
    if (!found.ok) {
      respond(false, undefined, found.error);
      return;
    }
    const session = found.session;
    if (session.state !== "active" || session.approval.decision !== "allow") {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "session is not approved"));
      return;
    }
    if (session.expiresAtMs <= Date.now()) {
      session.state = "expired";
      session.closedAtMs = Date.now();
      appendDesktopControlAudit(session, {
        type: "session.expired",
        actor: "system",
      });
      broadcastDesktopControlSessionEvent({
        context,
        action: "expired",
        session,
        actor: "system",
      });
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "session has expired"));
      return;
    }
    const normalized = normalizeBrowserRequest(typed);
    if (!normalized.ok) {
      respond(false, undefined, normalized.error);
      return;
    }
    const actor = resolveClientActor(client);
    if (!session.controls.allowMethods.includes(normalized.request.methodRaw)) {
      appendDesktopControlAudit(session, {
        type: "request.error",
        actor,
        details: {
          reason: "method not allowed",
          method: normalized.request.methodRaw,
          allowedMethods: session.controls.allowMethods,
        },
      });
      broadcastDesktopControlSessionEvent({
        context,
        action: "request_error",
        session,
        actor,
        details: {
          reason: "method not allowed",
          method: normalized.request.methodRaw,
          allowedMethods: [...session.controls.allowMethods],
        },
      });
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `method is not allowed for this session: ${normalized.request.methodRaw}`,
          {
            details: {
              allowedMethods: session.controls.allowMethods,
            },
          },
        ),
      );
      return;
    }
    if (session.requestCount >= session.controls.maxRequests) {
      session.state = "closed";
      session.closedAtMs = Date.now();
      appendDesktopControlAudit(session, {
        type: "session.closed",
        actor: "system",
        details: {
          reason: "max requests reached",
          maxRequests: session.controls.maxRequests,
        },
      });
      broadcastDesktopControlSessionEvent({
        context,
        action: "closed",
        session,
        actor: "system",
        details: {
          reason: "max requests reached",
          maxRequests: session.controls.maxRequests,
        },
      });
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `session request budget exhausted (${session.controls.maxRequests})`,
        ),
      );
      return;
    }
    appendDesktopControlAudit(session, {
      type: "request.start",
      actor,
      details: {
        method: normalized.request.methodRaw,
        path: normalized.request.path,
        route: session.route.kind,
        nodeId: session.route.kind === "node" ? session.route.node.nodeId : null,
      },
    });
    const nodeTarget = resolveDesktopSessionNodeTarget({
      session,
      nodes: context.nodeRegistry.listConnected(),
    });
    if (session.route.kind === "node" && !nodeTarget) {
      appendDesktopControlAudit(session, {
        type: "request.error",
        actor,
        details: {
          reason: "pinned node disconnected",
          nodeId: session.route.node.nodeId,
        },
      });
      broadcastDesktopControlSessionEvent({
        context,
        action: "request_error",
        session,
        actor,
        details: {
          reason: "pinned node disconnected",
          nodeId: session.route.node.nodeId,
        },
      });
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.UNAVAILABLE,
          `pinned browser node is not connected: ${session.route.node.nodeId}`,
        ),
      );
      return;
    }
    const result = await dispatchBrowserRequest({
      cfg: loadConfig(),
      request: normalized.request,
      context,
      nodeTarget,
    });
    session.requestCount += 1;
    session.lastRequestAtMs = Date.now();
    if (!result.ok) {
      appendDesktopControlAudit(session, {
        type: "request.error",
        actor,
        details: {
          route: result.route,
          nodeId: result.nodeId,
          status: result.status,
          message: result.error.message,
        },
      });
      broadcastDesktopControlSessionEvent({
        context,
        action: "request_error",
        session,
        actor,
        details: {
          route: result.route,
          nodeId: result.nodeId,
          status: result.status,
          message: result.error.message,
        },
      });
      respond(false, undefined, result.error);
      return;
    }
    appendDesktopControlAudit(session, {
      type: "request.ok",
      actor,
      details: {
        route: result.route,
        nodeId: result.nodeId,
        status: result.status,
      },
    });
    broadcastDesktopControlSessionEvent({
      context,
      action: "request_ok",
      session,
      actor,
      details: {
        route: result.route,
        nodeId: result.nodeId,
        status: result.status,
      },
    });
    respond(true, result.payload);
  },
};
