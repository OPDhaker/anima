import crypto from "node:crypto";
import type { NodeSession } from "../node-registry.js";
import type { GatewayRequestHandlers } from "./types.js";
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
    const typed = params as BrowserRequestParams;
    const methodRaw = typeof typed.method === "string" ? typed.method.trim().toUpperCase() : "";
    const path = typeof typed.path === "string" ? typed.path.trim() : "";
    const query = typed.query && typeof typed.query === "object" ? typed.query : undefined;
    const body = typed.body;
    const timeoutMs =
      typeof typed.timeoutMs === "number" && Number.isFinite(typed.timeoutMs)
        ? Math.max(1, Math.floor(typed.timeoutMs))
        : undefined;

    if (!methodRaw || !path) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "method and path are required"),
      );
      return;
    }
    if (methodRaw !== "GET" && methodRaw !== "POST" && methodRaw !== "DELETE") {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "method must be GET, POST, or DELETE"),
      );
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

    if (nodeTarget) {
      const allowlist = resolveNodeCommandAllowlist(cfg, nodeTarget);
      const allowed = isNodeCommandAllowed({
        command: "browser.proxy",
        declaredCommands: nodeTarget.commands,
        allowlist,
      });
      if (!allowed.ok) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "node command not allowed", {
            details: { reason: allowed.reason, command: "browser.proxy" },
          }),
        );
        return;
      }

      const proxyParams = {
        method: methodRaw,
        path,
        query,
        body,
        timeoutMs,
        profile: typeof query?.profile === "string" ? query.profile : undefined,
      };
      const res = await context.nodeRegistry.invoke({
        nodeId: nodeTarget.nodeId,
        command: "browser.proxy",
        params: proxyParams,
        timeoutMs,
        idempotencyKey: crypto.randomUUID(),
      });
      if (!res.ok) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.UNAVAILABLE, res.error?.message ?? "node invoke failed", {
            details: { nodeError: res.error ?? null },
          }),
        );
        return;
      }
      const payload = res.payloadJSON ? safeParseJson(res.payloadJSON) : res.payload;
      const proxy = payload && typeof payload === "object" ? (payload as BrowserProxyResult) : null;
      if (!proxy || !("result" in proxy)) {
        respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, "browser proxy failed"));
        return;
      }
      const mapping = await persistProxyFiles(proxy.files);
      applyProxyPaths(proxy.result, mapping);
      respond(true, proxy.result);
      return;
    }

    const ready = await startBrowserControlServiceFromConfig();
    if (!ready) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, "browser control is disabled"));
      return;
    }

    let dispatcher;
    try {
      dispatcher = createBrowserRouteDispatcher(createBrowserControlContext());
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
      return;
    }

    const result = await dispatcher.dispatch({
      method: methodRaw,
      path,
      query,
      body,
    });

    if (result.status >= 400) {
      const message =
        result.body && typeof result.body === "object" && "error" in result.body
          ? String((result.body as { error?: unknown }).error)
          : `browser request failed (${result.status})`;
      const code = result.status >= 500 ? ErrorCodes.UNAVAILABLE : ErrorCodes.INVALID_REQUEST;
      respond(false, undefined, errorShape(code, message, { details: result.body }));
      return;
    }

    respond(true, result.body);
  },
};
