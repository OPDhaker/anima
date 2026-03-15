import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NodeSession } from "../node-registry.js";
import { browserHandlers, resetDesktopControlSessionsForTests } from "./browser.js";

function createNode(overrides: Partial<NodeSession>): NodeSession {
  return {
    nodeId: "node-1",
    connId: "conn-1",
    client: {} as never,
    caps: [],
    commands: [],
    connectedAtMs: 0,
    ...overrides,
  };
}

type RpcResponse = {
  ok: boolean;
  payload?: unknown;
  error?: { message?: string };
};

async function invokeHandler(options: {
  method: string;
  params?: Record<string, unknown>;
  nodes?: NodeSession[];
  scopes?: string[];
  invokeMock?: ReturnType<typeof vi.fn>;
}) {
  const handler = browserHandlers[options.method];
  if (!handler) {
    throw new Error(`missing handler: ${options.method}`);
  }

  let response: RpcResponse | null = null;
  const invoke =
    options.invokeMock ??
    vi.fn(async () => ({
      ok: true,
      payloadJSON: JSON.stringify({ result: { ok: true } }),
    }));

  await handler({
    req: {
      type: "req",
      id: "test-req",
      method: options.method,
    } as never,
    params: options.params ?? {},
    client: {
      connect: {
        scopes: options.scopes ?? ["operator.write", "operator.read", "operator.approvals"],
        client: {
          id: "operator-test",
          displayName: "Operator Test",
        },
        device: {
          id: "device-1",
        },
      },
    } as never,
    isWebchatConnect: () => false,
    respond: (ok, payload, error) => {
      response = { ok, payload, error: error as { message?: string } | undefined };
    },
    context: {
      nodeRegistry: {
        listConnected: () => options.nodes ?? [],
        invoke,
      },
    } as never,
  });

  if (!response) {
    throw new Error("handler did not respond");
  }

  return {
    response,
    invoke,
  };
}

describe("desktop control session handlers", () => {
  beforeEach(() => {
    resetDesktopControlSessionsForTests();
  });

  it("creates a pending local session by default", async () => {
    const { response } = await invokeHandler({
      method: "desktop.control.session.create",
      params: {
        reason: "validate remote browser control",
      },
      nodes: [],
    });

    expect(response.ok).toBe(true);
    const payload = response.payload as {
      state: string;
      route: { kind: string; node: unknown };
      approval: { decision: string };
      risk: { level: string; reasons: string[] };
    };
    expect(payload.state).toBe("pending_approval");
    expect(payload.route.kind).toBe("local");
    expect(payload.route.node).toBeNull();
    expect(payload.approval.decision).toBe("pending");
    expect(payload.risk.level).toBe("standard");
    expect(payload.risk.reasons).toEqual([]);
  });

  it("requires approvals scope to resolve a pending session", async () => {
    const created = await invokeHandler({
      method: "desktop.control.session.create",
      params: { reason: "approval gate check" },
    });
    const createdPayload = created.response.payload as { id: string };

    const approve = await invokeHandler({
      method: "desktop.control.session.approve",
      params: {
        id: createdPayload.id,
        decision: "allow",
      },
      scopes: ["operator.write", "operator.read"],
    });

    expect(approve.response.ok).toBe(false);
    expect(approve.response.error?.message).toContain("missing scope: operator.approvals");
  });

  it("rejects desktop requests until a session is approved", async () => {
    const created = await invokeHandler({
      method: "desktop.control.session.create",
      params: { reason: "pre-approval request test" },
    });
    const createdPayload = created.response.payload as { id: string };

    const requested = await invokeHandler({
      method: "desktop.control.session.request",
      params: {
        id: createdPayload.id,
        method: "GET",
        path: "/status",
      },
    });

    expect(requested.response.ok).toBe(false);
    expect(requested.response.error?.message).toContain("session is not approved");
  });

  it("requires an approval note for elevated-risk sessions", async () => {
    const browserNode = createNode({
      nodeId: "desktop-risk",
      displayName: "Desktop Risk",
      caps: ["browser"],
      commands: ["browser.proxy"],
    });

    const created = await invokeHandler({
      method: "desktop.control.session.create",
      params: {
        reason: "allow write operations",
        nodeId: "desktop-risk",
        allowMethods: ["GET", "POST"],
      },
      nodes: [browserNode],
    });
    const createdPayload = created.response.payload as {
      id: string;
      risk: { level: string; reasons: string[] };
    };
    expect(createdPayload.risk.level).toBe("elevated");
    expect(createdPayload.risk.reasons).toContain("write methods enabled (POST/DELETE)");

    const missingNote = await invokeHandler({
      method: "desktop.control.session.approve",
      params: {
        id: createdPayload.id,
        decision: "allow",
      },
      scopes: ["operator.approvals", "operator.read"],
      nodes: [browserNode],
    });
    expect(missingNote.response.ok).toBe(false);
    expect(missingNote.response.error?.message).toContain("note is required");

    const approved = await invokeHandler({
      method: "desktop.control.session.approve",
      params: {
        id: createdPayload.id,
        decision: "allow",
        note: "Write access is needed for this troubleshooting window.",
      },
      scopes: ["operator.approvals", "operator.read"],
      nodes: [browserNode],
    });
    expect(approved.response.ok).toBe(true);
    const approvedPayload = approved.response.payload as {
      state: string;
      approval: { note: string | null };
    };
    expect(approvedPayload.state).toBe("active");
    expect(approvedPayload.approval.note).toContain("Write access is needed");
  });

  it("routes approved requests through the pinned browser node", async () => {
    const browserNode = createNode({
      nodeId: "desktop-1",
      displayName: "Desktop One",
      caps: ["browser"],
      commands: ["browser.proxy"],
    });

    const invokeMock = vi.fn(async () => ({
      ok: true,
      payloadJSON: JSON.stringify({
        result: {
          pong: true,
        },
      }),
    }));

    const created = await invokeHandler({
      method: "desktop.control.session.create",
      params: {
        reason: "node-pinned desktop control",
        nodeId: "desktop-1",
      },
      nodes: [browserNode],
      invokeMock,
    });
    const createdPayload = created.response.payload as { id: string; route: { kind: string } };
    expect(createdPayload.route.kind).toBe("node");

    const approved = await invokeHandler({
      method: "desktop.control.session.approve",
      params: {
        id: createdPayload.id,
        decision: "allow",
      },
      scopes: ["operator.approvals", "operator.read"],
      nodes: [browserNode],
      invokeMock,
    });
    expect(approved.response.ok).toBe(true);

    const requested = await invokeHandler({
      method: "desktop.control.session.request",
      params: {
        id: createdPayload.id,
        method: "GET",
        path: "/status",
      },
      scopes: ["operator.write", "operator.read"],
      nodes: [browserNode],
      invokeMock,
    });

    expect(requested.response.ok).toBe(true);
    expect(requested.response.payload).toEqual({ pong: true });
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock.mock.calls[0]?.[0]).toMatchObject({
      nodeId: "desktop-1",
      command: "browser.proxy",
    });
  });

  it("blocks non-whitelisted request methods for a session", async () => {
    const browserNode = createNode({
      nodeId: "desktop-2",
      displayName: "Desktop Two",
      caps: ["browser"],
      commands: ["browser.proxy"],
    });
    const invokeMock = vi.fn(async () => ({
      ok: true,
      payloadJSON: JSON.stringify({ result: { ok: true } }),
    }));

    const created = await invokeHandler({
      method: "desktop.control.session.create",
      params: {
        reason: "method policy guardrail",
        nodeId: "desktop-2",
      },
      nodes: [browserNode],
      invokeMock,
    });
    const createdPayload = created.response.payload as { id: string };

    await invokeHandler({
      method: "desktop.control.session.approve",
      params: {
        id: createdPayload.id,
        decision: "allow",
      },
      scopes: ["operator.approvals", "operator.read"],
      nodes: [browserNode],
      invokeMock,
    });

    const blocked = await invokeHandler({
      method: "desktop.control.session.request",
      params: {
        id: createdPayload.id,
        method: "POST",
        path: "/status",
      },
      scopes: ["operator.write", "operator.read"],
      nodes: [browserNode],
      invokeMock,
    });

    expect(blocked.response.ok).toBe(false);
    expect(blocked.response.error?.message).toContain("method is not allowed for this session");
    expect(invokeMock).toHaveBeenCalledTimes(0);
  });

  it("auto-closes a session when max request budget is exhausted", async () => {
    const browserNode = createNode({
      nodeId: "desktop-3",
      displayName: "Desktop Three",
      caps: ["browser"],
      commands: ["browser.proxy"],
    });
    const invokeMock = vi.fn(async () => ({
      ok: true,
      payloadJSON: JSON.stringify({ result: { ok: true } }),
    }));

    const created = await invokeHandler({
      method: "desktop.control.session.create",
      params: {
        reason: "request budget guardrail",
        nodeId: "desktop-3",
        maxRequests: 1,
      },
      nodes: [browserNode],
      invokeMock,
    });
    const createdPayload = created.response.payload as { id: string };

    await invokeHandler({
      method: "desktop.control.session.approve",
      params: {
        id: createdPayload.id,
        decision: "allow",
      },
      scopes: ["operator.approvals", "operator.read"],
      nodes: [browserNode],
      invokeMock,
    });

    const first = await invokeHandler({
      method: "desktop.control.session.request",
      params: {
        id: createdPayload.id,
        method: "GET",
        path: "/status",
      },
      scopes: ["operator.write", "operator.read"],
      nodes: [browserNode],
      invokeMock,
    });
    expect(first.response.ok).toBe(true);

    const second = await invokeHandler({
      method: "desktop.control.session.request",
      params: {
        id: createdPayload.id,
        method: "GET",
        path: "/status",
      },
      scopes: ["operator.write", "operator.read"],
      nodes: [browserNode],
      invokeMock,
    });
    expect(second.response.ok).toBe(false);
    expect(second.response.error?.message).toContain("session request budget exhausted");

    const after = await invokeHandler({
      method: "desktop.control.session.get",
      params: { id: createdPayload.id },
      nodes: [browserNode],
      invokeMock,
    });
    const session = after.response.payload as { state: string };
    expect(session.state).toBe("closed");
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });
});
