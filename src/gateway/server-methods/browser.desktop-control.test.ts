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
  error?: { message?: string; details?: Record<string, unknown> };
};

async function invokeHandler(options: {
  method: string;
  params?: unknown;
  nodes?: NodeSession[];
  scopes?: string[];
  invokeMock?: ReturnType<typeof vi.fn>;
  broadcastMock?: ReturnType<typeof vi.fn>;
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
  const broadcast = options.broadcastMock ?? vi.fn();

  await handler({
    req: {
      type: "req",
      id: "test-req",
      method: options.method,
    } as never,
    params: Object.prototype.hasOwnProperty.call(options, "params")
      ? (options.params as never)
      : {},
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
      response = {
        ok,
        payload,
        error: error as { message?: string; details?: Record<string, unknown> } | undefined,
      };
    },
    context: {
      nodeRegistry: {
        listConnected: () => options.nodes ?? [],
        invoke,
      },
      broadcast,
    } as never,
  });

  if (!response) {
    throw new Error("handler did not respond");
  }

  return {
    response,
    invoke,
    broadcast,
  };
}

describe("desktop control session handlers", () => {
  beforeEach(() => {
    resetDesktopControlSessionsForTests();
  });

  it("requires write scope to create a desktop control session", async () => {
    const created = await invokeHandler({
      method: "desktop.control.session.create",
      params: {
        reason: "scope enforcement create",
      },
      scopes: ["operator.read"],
    });

    expect(created.response.ok).toBe(false);
    expect(created.response.error?.message).toContain("missing scope: operator.write");
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

  it("rejects malformed allowMethods values when creating a desktop control session", async () => {
    const invalidCreateParams: Array<{
      params: Record<string, unknown>;
      expectedMessage: string;
    }> = [
      {
        params: {
          reason: "allowMethods must be an array",
          allowMethods: "GET",
        },
        expectedMessage: "invalid allowMethods",
      },
      {
        params: {
          reason: "allowMethods values must be strings",
          allowMethods: [true],
        },
        expectedMessage: "invalid allowMethods[0]",
      },
      {
        params: {
          reason: "allowMethods values must be known methods",
          allowMethods: ["PATCH"],
        },
        expectedMessage: "invalid allowMethods[0]: PATCH",
      },
      {
        params: {
          reason: "allowMethods must include at least one method",
          allowMethods: [],
        },
        expectedMessage: "allowMethods must include at least one method",
      },
    ];

    for (const invalid of invalidCreateParams) {
      const created = await invokeHandler({
        method: "desktop.control.session.create",
        params: invalid.params,
      });

      expect(created.response.ok).toBe(false);
      expect(created.response.error?.message).toContain(invalid.expectedMessage);
    }
  });

  it("rejects invalid maxRequests values when creating a desktop control session", async () => {
    const invalidMaxRequests = [0, 501, 1.5, "40"];

    for (const maxRequests of invalidMaxRequests) {
      const created = await invokeHandler({
        method: "desktop.control.session.create",
        params: {
          reason: "maxRequests validation guardrail",
          maxRequests,
        },
      });

      expect(created.response.ok).toBe(false);
      expect(created.response.error?.message).toContain("invalid maxRequests");
      expect(created.response.error?.details).toEqual(
        expect.objectContaining({
          minMaxRequests: 1,
          maxMaxRequests: 500,
        }),
      );
    }
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

  it("returns id is required when params payload is missing for approve/close/request", async () => {
    const methods = [
      "desktop.control.session.approve",
      "desktop.control.session.close",
      "desktop.control.session.request",
    ] as const;

    for (const method of methods) {
      const result = await invokeHandler({
        method,
        params: undefined,
      });

      expect(result.response.ok).toBe(false);
      expect(result.response.error?.message).toContain("id is required");
    }
  });

  it("rejects non-object params payloads for desktop control session handlers", async () => {
    const methods = [
      "desktop.control.session.create",
      "desktop.control.session.list",
      "desktop.control.session.get",
      "desktop.control.session.approve",
      "desktop.control.session.close",
      "desktop.control.session.request",
    ] as const;
    const invalidParamsCases: Array<{ params: unknown; actualType: string }> = [
      { params: "invalid", actualType: "string" },
      { params: 42, actualType: "number" },
      { params: true, actualType: "boolean" },
      { params: [], actualType: "array" },
    ];

    for (const method of methods) {
      for (const invalidCase of invalidParamsCases) {
        const result = await invokeHandler({
          method,
          params: invalidCase.params,
        });

        expect(result.response.ok).toBe(false);
        expect(result.response.error?.message).toContain("invalid params: expected object");
        expect(result.response.error?.details).toEqual(
          expect.objectContaining({
            expectedType: "object",
            actualType: invalidCase.actualType,
          }),
        );
      }
    }
  });

  it("rejects non-string id payloads for get/approve/close/request", async () => {
    const methods = [
      "desktop.control.session.get",
      "desktop.control.session.approve",
      "desktop.control.session.close",
      "desktop.control.session.request",
    ] as const;

    for (const method of methods) {
      const result = await invokeHandler({
        method,
        params: { id: 42 },
      });

      expect(result.response.ok).toBe(false);
      expect(result.response.error?.message).toContain("invalid id: 42");
      expect(result.response.error?.details).toEqual(
        expect.objectContaining({
          expectedType: "string",
        }),
      );
    }
  });

  it("rejects approval when a session was already manually closed", async () => {
    const created = await invokeHandler({
      method: "desktop.control.session.create",
      params: { reason: "close then approve should fail" },
    });
    const createdPayload = created.response.payload as { id: string };

    const closed = await invokeHandler({
      method: "desktop.control.session.close",
      params: {
        id: createdPayload.id,
        note: "Closing this request before approval due to context change.",
      },
      scopes: ["operator.write", "operator.read"],
    });
    expect(closed.response.ok).toBe(true);

    const approveAfterClose = await invokeHandler({
      method: "desktop.control.session.approve",
      params: {
        id: createdPayload.id,
        decision: "allow",
      },
      scopes: ["operator.approvals", "operator.read"],
    });
    expect(approveAfterClose.response.ok).toBe(false);
    expect(approveAfterClose.response.error?.message).toContain(
      "session is not pending approval (state: closed)",
    );
    expect(approveAfterClose.response.error?.details).toEqual(
      expect.objectContaining({
        state: "closed",
        decision: "deny",
        expiresAtMs: expect.any(Number),
      }),
    );
    expect(approveAfterClose.broadcast).not.toHaveBeenCalled();

    const after = await invokeHandler({
      method: "desktop.control.session.get",
      params: { id: createdPayload.id },
      scopes: ["operator.read"],
    });
    expect(after.response.ok).toBe(true);
    expect(after.response.payload).toEqual(
      expect.objectContaining({
        state: "closed",
        approval: expect.objectContaining({
          decision: "deny",
        }),
      }),
    );
  });

  it("rejects approval when the session is already denied", async () => {
    const created = await invokeHandler({
      method: "desktop.control.session.create",
      params: { reason: "deny then approve should fail" },
    });
    const createdPayload = created.response.payload as { id: string };

    const denied = await invokeHandler({
      method: "desktop.control.session.approve",
      params: {
        id: createdPayload.id,
        decision: "deny",
        note: "Denied after policy review for this request.",
      },
      scopes: ["operator.approvals", "operator.read"],
    });
    expect(denied.response.ok).toBe(true);

    const approveAfterDeny = await invokeHandler({
      method: "desktop.control.session.approve",
      params: {
        id: createdPayload.id,
        decision: "allow",
      },
      scopes: ["operator.approvals", "operator.read"],
    });
    expect(approveAfterDeny.response.ok).toBe(false);
    expect(approveAfterDeny.response.error?.message).toContain(
      "session is not pending approval (state: denied)",
    );
    expect(approveAfterDeny.response.error?.details).toEqual(
      expect.objectContaining({
        state: "denied",
        decision: "deny",
        expiresAtMs: expect.any(Number),
      }),
    );
    expect(approveAfterDeny.broadcast).not.toHaveBeenCalled();

    const after = await invokeHandler({
      method: "desktop.control.session.get",
      params: { id: createdPayload.id },
      scopes: ["operator.read"],
    });
    expect(after.response.ok).toBe(true);
    expect(after.response.payload).toEqual(
      expect.objectContaining({
        state: "denied",
        approval: expect.objectContaining({
          decision: "deny",
        }),
      }),
    );
  });

  it("rejects approval when prune has already marked the session expired", async () => {
    const now = new Date("2026-03-16T00:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    try {
      const created = await invokeHandler({
        method: "desktop.control.session.create",
        params: {
          reason: "expiry should block approval",
          ttlMs: 60_000,
        },
        nodes: [],
      });
      const createdPayload = created.response.payload as { id: string };

      vi.setSystemTime(new Date(now.getTime() + 60_001));

      const approveAfterExpiry = await invokeHandler({
        method: "desktop.control.session.approve",
        params: {
          id: createdPayload.id,
          decision: "allow",
        },
        scopes: ["operator.approvals", "operator.read"],
        nodes: [],
      });
      expect(approveAfterExpiry.response.ok).toBe(false);
      expect(approveAfterExpiry.response.error?.message).toContain(
        "session is not pending approval (state: expired)",
      );
      expect(approveAfterExpiry.response.error?.details).toEqual(
        expect.objectContaining({
          state: "expired",
          decision: "pending",
          expiresAtMs: expect.any(Number),
        }),
      );
      expect(approveAfterExpiry.broadcast).toHaveBeenCalledWith(
        "desktop.control.session.updated",
        expect.objectContaining({
          action: "expired",
          actor: "system",
          session: expect.objectContaining({ id: createdPayload.id, state: "expired" }),
        }),
        expect.objectContaining({ dropIfSlow: true }),
      );

      const after = await invokeHandler({
        method: "desktop.control.session.get",
        params: { id: createdPayload.id },
        scopes: ["operator.read"],
        nodes: [],
      });
      expect(after.response.ok).toBe(true);
      expect(after.response.payload).toEqual(
        expect.objectContaining({
          state: "expired",
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("blocks approval when the pinned browser node is disconnected", async () => {
    const browserNode = createNode({
      nodeId: "desktop-approval-route",
      displayName: "Desktop Approval Route",
      caps: ["browser"],
      commands: ["browser.proxy"],
    });

    const created = await invokeHandler({
      method: "desktop.control.session.create",
      params: {
        reason: "approval should require live pinned node",
        nodeId: "desktop-approval-route",
      },
      nodes: [browserNode],
    });
    const createdPayload = created.response.payload as { id: string };

    const disconnectedApproval = await invokeHandler({
      method: "desktop.control.session.approve",
      params: {
        id: createdPayload.id,
        decision: "allow",
      },
      scopes: ["operator.approvals", "operator.read"],
      nodes: [],
    });

    expect(disconnectedApproval.response.ok).toBe(false);
    expect(disconnectedApproval.response.error?.message).toContain(
      "pinned browser node is not connected",
    );
    expect(disconnectedApproval.response.error?.details).toEqual(
      expect.objectContaining({
        nodeId: "desktop-approval-route",
        state: "pending_approval",
        decision: "pending",
        expiresAtMs: expect.any(Number),
        requestCount: 0,
        maxRequests: expect.any(Number),
      }),
    );

    const pendingAfterFailure = await invokeHandler({
      method: "desktop.control.session.get",
      params: {
        id: createdPayload.id,
      },
      scopes: ["operator.read"],
      nodes: [],
    });
    expect(pendingAfterFailure.response.ok).toBe(true);
    expect(pendingAfterFailure.response.payload).toEqual(
      expect.objectContaining({
        state: "pending_approval",
      }),
    );

    const approvalAfterReconnect = await invokeHandler({
      method: "desktop.control.session.approve",
      params: {
        id: createdPayload.id,
        decision: "allow",
      },
      scopes: ["operator.approvals", "operator.read"],
      nodes: [browserNode],
    });
    expect(approvalAfterReconnect.response.ok).toBe(true);
    expect(approvalAfterReconnect.response.payload).toEqual(
      expect.objectContaining({
        state: "active",
      }),
    );
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
    expect(requested.response.error?.message).toContain("state: pending_approval");
    expect(requested.response.error?.message).toContain("decision: pending");
  });

  it("rejects desktop requests once a session is denied", async () => {
    const created = await invokeHandler({
      method: "desktop.control.session.create",
      params: { reason: "denied session request should stay blocked" },
      nodes: [],
    });
    const createdPayload = created.response.payload as { id: string };

    const denied = await invokeHandler({
      method: "desktop.control.session.approve",
      params: {
        id: createdPayload.id,
        decision: "deny",
        note: "Denied after policy-based risk review.",
      },
      scopes: ["operator.approvals", "operator.read"],
      nodes: [],
    });
    expect(denied.response.ok).toBe(true);

    const requested = await invokeHandler({
      method: "desktop.control.session.request",
      params: {
        id: createdPayload.id,
        method: "GET",
        path: "/status",
      },
      scopes: ["operator.write", "operator.read"],
      nodes: [],
    });

    expect(requested.response.ok).toBe(false);
    expect(requested.response.error?.message).toContain("session is not approved");
    expect(requested.response.error?.message).toContain("state: denied");
    expect(requested.response.error?.message).toContain("decision: deny");
  });

  it("rejects desktop requests once a session is closed", async () => {
    const created = await invokeHandler({
      method: "desktop.control.session.create",
      params: { reason: "closed session request should stay blocked" },
      nodes: [],
    });
    const createdPayload = created.response.payload as { id: string };

    const approved = await invokeHandler({
      method: "desktop.control.session.approve",
      params: {
        id: createdPayload.id,
        decision: "allow",
      },
      scopes: ["operator.approvals", "operator.read"],
      nodes: [],
    });
    expect(approved.response.ok).toBe(true);

    const closed = await invokeHandler({
      method: "desktop.control.session.close",
      params: {
        id: createdPayload.id,
        note: "Closing this session after operator review completed.",
      },
      scopes: ["operator.write", "operator.read"],
      nodes: [],
    });
    expect(closed.response.ok).toBe(true);

    const requested = await invokeHandler({
      method: "desktop.control.session.request",
      params: {
        id: createdPayload.id,
        method: "GET",
        path: "/status",
      },
      scopes: ["operator.write", "operator.read"],
      nodes: [],
    });

    expect(requested.response.ok).toBe(false);
    expect(requested.response.error?.message).toContain("session is not approved");
    expect(requested.response.error?.message).toContain("state: closed");
    expect(requested.response.error?.message).toContain("decision: allow");
  });

  it("returns an explicit expiry error when requesting an expired session", async () => {
    const now = new Date("2026-03-16T00:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    try {
      const created = await invokeHandler({
        method: "desktop.control.session.create",
        params: {
          reason: "expired request should return explicit error",
          ttlMs: 60_000,
        },
        nodes: [],
      });
      const createdPayload = created.response.payload as { id: string };

      const approved = await invokeHandler({
        method: "desktop.control.session.approve",
        params: {
          id: createdPayload.id,
          decision: "allow",
        },
        scopes: ["operator.approvals", "operator.read"],
        nodes: [],
      });
      expect(approved.response.ok).toBe(true);

      vi.setSystemTime(new Date(now.getTime() + 60_001));

      const requested = await invokeHandler({
        method: "desktop.control.session.request",
        params: {
          id: createdPayload.id,
          method: "GET",
          path: "/status",
        },
        scopes: ["operator.write", "operator.read"],
        nodes: [],
      });
      expect(requested.response.ok).toBe(false);
      expect(requested.response.error?.message).toContain("session has expired");
      expect(requested.response.error?.message).not.toContain("session is not approved");
      expect(requested.broadcast).toHaveBeenCalledWith(
        "desktop.control.session.updated",
        expect.objectContaining({
          action: "expired",
          actor: "system",
          session: expect.objectContaining({ id: createdPayload.id, state: "expired" }),
        }),
        expect.objectContaining({ dropIfSlow: true }),
      );

      const after = await invokeHandler({
        method: "desktop.control.session.get",
        params: { id: createdPayload.id },
        scopes: ["operator.read"],
        nodes: [],
      });
      expect(after.response.ok).toBe(true);
      expect(after.response.payload).toEqual(
        expect.objectContaining({
          state: "expired",
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("requires read scope to list desktop control sessions", async () => {
    await invokeHandler({
      method: "desktop.control.session.create",
      params: { reason: "scope enforcement list" },
    });

    const listed = await invokeHandler({
      method: "desktop.control.session.list",
      params: {},
      scopes: ["operator.write"],
    });

    expect(listed.response.ok).toBe(false);
    expect(listed.response.error?.message).toContain("missing scope: operator.read");
  });

  it("rejects non-boolean includeAudit filters when getting a session", async () => {
    const created = await invokeHandler({
      method: "desktop.control.session.create",
      params: { reason: "invalid get includeAudit filter" },
    });
    const createdPayload = created.response.payload as { id: string };

    const got = await invokeHandler({
      method: "desktop.control.session.get",
      params: {
        id: createdPayload.id,
        includeAudit: "true",
      },
      scopes: ["operator.read"],
    });

    expect(got.response.ok).toBe(false);
    expect(got.response.error?.message).toContain("invalid includeAudit filter: true");
    expect(got.response.error?.details).toEqual(
      expect.objectContaining({
        expectedType: "boolean",
      }),
    );
  });

  it("rejects non-boolean includeAudit filters when listing sessions", async () => {
    const listed = await invokeHandler({
      method: "desktop.control.session.list",
      params: {
        includeAudit: "true",
      },
      scopes: ["operator.read"],
    });

    expect(listed.response.ok).toBe(false);
    expect(listed.response.error?.message).toContain("invalid includeAudit filter: true");
    expect(listed.response.error?.details).toEqual(
      expect.objectContaining({
        expectedType: "boolean",
      }),
    );
  });

  it("rejects non-string list filters when listing sessions", async () => {
    const invalidFilters: Array<{
      params: Record<string, unknown>;
      expectedError: string;
    }> = [
      {
        params: { state: { value: "active" } },
        expectedError: "invalid state filter",
      },
      {
        params: { decision: { value: "allow" } },
        expectedError: "invalid decision filter",
      },
      {
        params: { route: { value: "node" } },
        expectedError: "invalid route filter",
      },
      {
        params: { riskLevel: { value: "elevated" } },
        expectedError: "invalid riskLevel filter",
      },
      {
        params: { nodeId: { value: "desktop-route-a" } },
        expectedError: "invalid nodeId filter",
      },
    ];

    for (const invalid of invalidFilters) {
      const listed = await invokeHandler({
        method: "desktop.control.session.list",
        params: invalid.params,
        scopes: ["operator.read"],
      });

      expect(listed.response.ok).toBe(false);
      expect(listed.response.error?.message).toContain(invalid.expectedError);
    }
  });

  it("rejects invalid state filters when listing sessions", async () => {
    const listed = await invokeHandler({
      method: "desktop.control.session.list",
      params: {
        state: "pending",
      },
      scopes: ["operator.read"],
    });

    expect(listed.response.ok).toBe(false);
    expect(listed.response.error?.message).toContain("invalid state filter");
    expect(listed.response.error?.details).toEqual(
      expect.objectContaining({
        allowedStates: ["pending_approval", "active", "denied", "closed", "expired"],
      }),
    );
  });

  it("treats state filters as case-insensitive when listing sessions", async () => {
    const created = await invokeHandler({
      method: "desktop.control.session.create",
      params: { reason: "case-insensitive state filter" },
      scopes: ["operator.write", "operator.read"],
    });
    const createdPayload = created.response.payload as { id: string };

    const approved = await invokeHandler({
      method: "desktop.control.session.approve",
      params: {
        id: createdPayload.id,
        decision: "allow",
      },
      scopes: ["operator.approvals", "operator.read"],
    });
    expect(approved.response.ok).toBe(true);

    const listed = await invokeHandler({
      method: "desktop.control.session.list",
      params: {
        state: " ACTIVE ",
      },
      scopes: ["operator.read"],
    });

    expect(listed.response.ok).toBe(true);
    const payload = listed.response.payload as {
      sessions: Array<{ id: string; state: string }>;
    };
    expect(payload.sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: createdPayload.id,
          state: "active",
        }),
      ]),
    );
  });

  it("treats decision filters as case-insensitive when listing sessions", async () => {
    const created = await invokeHandler({
      method: "desktop.control.session.create",
      params: { reason: "case-insensitive decision filter" },
      scopes: ["operator.write", "operator.read"],
    });
    const createdPayload = created.response.payload as { id: string };

    const approved = await invokeHandler({
      method: "desktop.control.session.approve",
      params: {
        id: createdPayload.id,
        decision: "allow",
      },
      scopes: ["operator.approvals", "operator.read"],
    });
    expect(approved.response.ok).toBe(true);

    const listed = await invokeHandler({
      method: "desktop.control.session.list",
      params: {
        decision: " ALLOW ",
      },
      scopes: ["operator.read"],
    });

    expect(listed.response.ok).toBe(true);
    const payload = listed.response.payload as {
      sessions: Array<{ id: string; approval: { decision: string } }>;
    };
    expect(payload.sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: createdPayload.id,
          approval: expect.objectContaining({
            decision: "allow",
          }),
        }),
      ]),
    );
  });

  it("treats route filters as case-insensitive when listing sessions", async () => {
    const browserNode = createNode({
      nodeId: "desktop-route-case-insensitive",
      displayName: "Desktop Route Case Insensitive",
      caps: ["browser"],
      commands: ["browser.proxy"],
    });
    const created = await invokeHandler({
      method: "desktop.control.session.create",
      params: {
        reason: "case-insensitive route filter",
        nodeId: "desktop-route-case-insensitive",
      },
      scopes: ["operator.write", "operator.read"],
      nodes: [browserNode],
    });
    const createdPayload = created.response.payload as { id: string };

    const listed = await invokeHandler({
      method: "desktop.control.session.list",
      params: {
        route: " NODE ",
      },
      scopes: ["operator.read"],
    });

    expect(listed.response.ok).toBe(true);
    const payload = listed.response.payload as {
      sessions: Array<{ id: string; route: { kind: string } }>;
    };
    expect(payload.sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: createdPayload.id,
          route: expect.objectContaining({
            kind: "node",
          }),
        }),
      ]),
    );
  });

  it("treats riskLevel filters as case-insensitive when listing sessions", async () => {
    const created = await invokeHandler({
      method: "desktop.control.session.create",
      params: {
        reason: "case-insensitive risk filter",
        allowMethods: ["GET", "POST"],
      },
      scopes: ["operator.write", "operator.read"],
    });
    const createdPayload = created.response.payload as { id: string };

    const listed = await invokeHandler({
      method: "desktop.control.session.list",
      params: {
        riskLevel: " ELEVATED ",
      },
      scopes: ["operator.read"],
    });

    expect(listed.response.ok).toBe(true);
    const payload = listed.response.payload as {
      sessions: Array<{ id: string; risk: { level: string } }>;
    };
    expect(payload.sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: createdPayload.id,
          risk: expect.objectContaining({
            level: "elevated",
          }),
        }),
      ]),
    );
  });

  it("rejects invalid decision filters when listing sessions", async () => {
    const listed = await invokeHandler({
      method: "desktop.control.session.list",
      params: {
        decision: " Approved ",
      },
      scopes: ["operator.read"],
    });

    expect(listed.response.ok).toBe(false);
    expect(listed.response.error?.message).toContain("invalid decision filter: Approved");
    expect(listed.response.error?.details).toEqual(
      expect.objectContaining({
        allowedDecisions: ["pending", "allow", "deny"],
      }),
    );
  });

  it("rejects invalid route filters when listing sessions", async () => {
    const listed = await invokeHandler({
      method: "desktop.control.session.list",
      params: {
        route: " EDGE ",
      },
      scopes: ["operator.read"],
    });

    expect(listed.response.ok).toBe(false);
    expect(listed.response.error?.message).toContain("invalid route filter: EDGE");
    expect(listed.response.error?.details).toEqual(
      expect.objectContaining({
        allowedRouteKinds: ["local", "node"],
      }),
    );
  });

  it("rejects invalid riskLevel filters when listing sessions", async () => {
    const listed = await invokeHandler({
      method: "desktop.control.session.list",
      params: {
        riskLevel: " HIGH ",
      },
      scopes: ["operator.read"],
    });

    expect(listed.response.ok).toBe(false);
    expect(listed.response.error?.message).toContain("invalid riskLevel filter: HIGH");
    expect(listed.response.error?.details).toEqual(
      expect.objectContaining({
        allowedRiskLevels: ["standard", "elevated"],
      }),
    );
  });

  it("rejects invalid limit filters when listing sessions", async () => {
    const listed = await invokeHandler({
      method: "desktop.control.session.list",
      params: {
        limit: 0,
      },
      scopes: ["operator.read"],
    });

    expect(listed.response.ok).toBe(false);
    expect(listed.response.error?.message).toContain("invalid limit filter");
    expect(listed.response.error?.details).toEqual(
      expect.objectContaining({
        minLimit: 1,
        maxLimit: 500,
      }),
    );
  });

  it("rejects invalid offset filters when listing sessions", async () => {
    const listed = await invokeHandler({
      method: "desktop.control.session.list",
      params: {
        offset: -1,
      },
      scopes: ["operator.read"],
    });

    expect(listed.response.ok).toBe(false);
    expect(listed.response.error?.message).toContain("invalid offset filter");
    expect(listed.response.error?.details).toEqual(
      expect.objectContaining({
        minOffset: 0,
        maxOffset: 10000,
      }),
    );
  });

  it("rejects nodeId filters when route=local", async () => {
    const listed = await invokeHandler({
      method: "desktop.control.session.list",
      params: {
        route: "local",
        nodeId: "desktop-route",
      },
      scopes: ["operator.read"],
    });

    expect(listed.response.ok).toBe(false);
    expect(listed.response.error?.message).toContain("nodeId filter requires route=node");
  });

  it("rejects invalid nodeId filters when listing sessions", async () => {
    const listed = await invokeHandler({
      method: "desktop.control.session.list",
      params: {
        route: "node",
        nodeId: "---",
      },
      scopes: ["operator.read"],
    });

    expect(listed.response.ok).toBe(false);
    expect(listed.response.error?.message).toContain("invalid nodeId filter");
  });

  it("applies limit and returns truncation metadata when listing sessions", async () => {
    const now = new Date("2026-03-16T00:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    try {
      const first = await invokeHandler({
        method: "desktop.control.session.create",
        params: { reason: "list limit session first" },
        scopes: ["operator.write", "operator.read"],
      });
      const firstPayload = first.response.payload as { id: string };

      vi.setSystemTime(new Date(now.getTime() + 1_000));
      const second = await invokeHandler({
        method: "desktop.control.session.create",
        params: { reason: "list limit session second" },
        scopes: ["operator.write", "operator.read"],
      });
      const secondPayload = second.response.payload as { id: string };

      vi.setSystemTime(new Date(now.getTime() + 2_000));
      const third = await invokeHandler({
        method: "desktop.control.session.create",
        params: { reason: "list limit session third" },
        scopes: ["operator.write", "operator.read"],
      });
      const thirdPayload = third.response.payload as { id: string };

      const listed = await invokeHandler({
        method: "desktop.control.session.list",
        params: {
          limit: 2,
        },
        scopes: ["operator.read"],
      });

      expect(listed.response.ok).toBe(true);
      const payload = listed.response.payload as {
        total: number;
        returned: number;
        offset: number;
        nextOffset: number | null;
        truncated: boolean;
        sessions: Array<{ id: string }>;
      };
      expect(payload.total).toBe(3);
      expect(payload.returned).toBe(2);
      expect(payload.offset).toBe(0);
      expect(payload.nextOffset).toBe(2);
      expect(payload.truncated).toBe(true);
      expect(payload.sessions.map((session) => session.id)).toEqual([
        thirdPayload.id,
        secondPayload.id,
      ]);
      expect(payload.sessions.map((session) => session.id)).not.toContain(firstPayload.id);
    } finally {
      vi.useRealTimers();
    }
  });

  it("applies offset windows when listing sessions", async () => {
    const now = new Date("2026-03-16T00:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    try {
      const first = await invokeHandler({
        method: "desktop.control.session.create",
        params: { reason: "list offset session first" },
        scopes: ["operator.write", "operator.read"],
      });
      const firstPayload = first.response.payload as { id: string };

      vi.setSystemTime(new Date(now.getTime() + 1_000));
      const second = await invokeHandler({
        method: "desktop.control.session.create",
        params: { reason: "list offset session second" },
        scopes: ["operator.write", "operator.read"],
      });
      const secondPayload = second.response.payload as { id: string };

      vi.setSystemTime(new Date(now.getTime() + 2_000));
      const third = await invokeHandler({
        method: "desktop.control.session.create",
        params: { reason: "list offset session third" },
        scopes: ["operator.write", "operator.read"],
      });
      const thirdPayload = third.response.payload as { id: string };

      const listed = await invokeHandler({
        method: "desktop.control.session.list",
        params: {
          offset: 1,
          limit: 1,
        },
        scopes: ["operator.read"],
      });

      expect(listed.response.ok).toBe(true);
      const payload = listed.response.payload as {
        total: number;
        returned: number;
        offset: number;
        nextOffset: number | null;
        truncated: boolean;
        sessions: Array<{ id: string }>;
      };
      expect(payload.total).toBe(3);
      expect(payload.returned).toBe(1);
      expect(payload.offset).toBe(1);
      expect(payload.nextOffset).toBe(2);
      expect(payload.truncated).toBe(true);
      expect(payload.sessions.map((session) => session.id)).toEqual([secondPayload.id]);
      expect(payload.sessions.map((session) => session.id)).not.toContain(thirdPayload.id);
      expect(payload.sessions.map((session) => session.id)).not.toContain(firstPayload.id);
    } finally {
      vi.useRealTimers();
    }
  });

  it("filters listed sessions by a valid state", async () => {
    const first = await invokeHandler({
      method: "desktop.control.session.create",
      params: { reason: "state filter pending session" },
      scopes: ["operator.write", "operator.read"],
    });
    const firstPayload = first.response.payload as { id: string };

    const second = await invokeHandler({
      method: "desktop.control.session.create",
      params: { reason: "state filter denied session" },
      scopes: ["operator.write", "operator.read"],
    });
    const secondPayload = second.response.payload as { id: string };

    const denied = await invokeHandler({
      method: "desktop.control.session.approve",
      params: {
        id: secondPayload.id,
        decision: "deny",
        note: "Denied for state-filter regression coverage.",
      },
      scopes: ["operator.approvals", "operator.read"],
    });
    expect(denied.response.ok).toBe(true);

    const listed = await invokeHandler({
      method: "desktop.control.session.list",
      params: {
        state: "pending_approval",
      },
      scopes: ["operator.read"],
    });

    expect(listed.response.ok).toBe(true);
    const payload = listed.response.payload as {
      sessions: Array<{ id: string; state: string }>;
    };
    expect(payload.sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: firstPayload.id,
          state: "pending_approval",
        }),
      ]),
    );
    expect(payload.sessions).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: secondPayload.id,
        }),
      ]),
    );
  });

  it("filters listed sessions by a valid approval decision", async () => {
    const pending = await invokeHandler({
      method: "desktop.control.session.create",
      params: { reason: "decision filter pending session" },
      scopes: ["operator.write", "operator.read"],
    });
    const pendingPayload = pending.response.payload as { id: string };

    const allowed = await invokeHandler({
      method: "desktop.control.session.create",
      params: { reason: "decision filter allow session" },
      scopes: ["operator.write", "operator.read"],
    });
    const allowedPayload = allowed.response.payload as { id: string };

    const approved = await invokeHandler({
      method: "desktop.control.session.approve",
      params: {
        id: allowedPayload.id,
        decision: "allow",
      },
      scopes: ["operator.approvals", "operator.read"],
    });
    expect(approved.response.ok).toBe(true);

    const denied = await invokeHandler({
      method: "desktop.control.session.create",
      params: { reason: "decision filter deny session" },
      scopes: ["operator.write", "operator.read"],
    });
    const deniedPayload = denied.response.payload as { id: string };

    const rejected = await invokeHandler({
      method: "desktop.control.session.approve",
      params: {
        id: deniedPayload.id,
        decision: "deny",
        note: "Denied for decision-filter regression coverage.",
      },
      scopes: ["operator.approvals", "operator.read"],
    });
    expect(rejected.response.ok).toBe(true);

    const listed = await invokeHandler({
      method: "desktop.control.session.list",
      params: {
        decision: "deny",
      },
      scopes: ["operator.read"],
    });

    expect(listed.response.ok).toBe(true);
    const payload = listed.response.payload as {
      sessions: Array<{ id: string; approval: { decision: string } }>;
    };
    expect(payload.sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: deniedPayload.id,
          approval: expect.objectContaining({
            decision: "deny",
          }),
        }),
      ]),
    );
    expect(payload.sessions).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: pendingPayload.id,
        }),
      ]),
    );
    expect(payload.sessions).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: allowedPayload.id,
        }),
      ]),
    );
  });

  it("filters listed sessions by route kind", async () => {
    const browserNode = createNode({
      nodeId: "desktop-route",
      displayName: "Desktop Route",
      caps: ["browser"],
      commands: ["browser.proxy"],
    });

    const local = await invokeHandler({
      method: "desktop.control.session.create",
      params: { reason: "route filter local session" },
      scopes: ["operator.write", "operator.read"],
      nodes: [],
    });
    const localPayload = local.response.payload as { id: string };

    const node = await invokeHandler({
      method: "desktop.control.session.create",
      params: {
        reason: "route filter node session",
        nodeId: "desktop-route",
      },
      scopes: ["operator.write", "operator.read"],
      nodes: [browserNode],
    });
    const nodePayload = node.response.payload as { id: string };

    const listed = await invokeHandler({
      method: "desktop.control.session.list",
      params: {
        route: "node",
      },
      scopes: ["operator.read"],
    });

    expect(listed.response.ok).toBe(true);
    const payload = listed.response.payload as {
      sessions: Array<{ id: string; route: { kind: string } }>;
    };
    expect(payload.sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: nodePayload.id,
          route: expect.objectContaining({
            kind: "node",
          }),
        }),
      ]),
    );
    expect(payload.sessions).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: localPayload.id,
        }),
      ]),
    );
  });

  it("filters listed sessions by nodeId", async () => {
    const nodeA = createNode({
      nodeId: "desktop-route-a",
      displayName: "Desktop Route A",
      caps: ["browser"],
      commands: ["browser.proxy"],
    });
    const nodeB = createNode({
      nodeId: "desktop-route-b",
      displayName: "Desktop Route B",
      caps: ["browser"],
      commands: ["browser.proxy"],
    });

    const local = await invokeHandler({
      method: "desktop.control.session.create",
      params: { reason: "nodeId filter local session" },
      scopes: ["operator.write", "operator.read"],
      nodes: [],
    });
    const localPayload = local.response.payload as { id: string };

    const nodeSessionA = await invokeHandler({
      method: "desktop.control.session.create",
      params: {
        reason: "nodeId filter route A session",
        nodeId: "desktop-route-a",
      },
      scopes: ["operator.write", "operator.read"],
      nodes: [nodeA, nodeB],
    });
    const nodeSessionAPayload = nodeSessionA.response.payload as { id: string };

    const nodeSessionB = await invokeHandler({
      method: "desktop.control.session.create",
      params: {
        reason: "nodeId filter route B session",
        nodeId: "desktop-route-b",
      },
      scopes: ["operator.write", "operator.read"],
      nodes: [nodeA, nodeB],
    });
    const nodeSessionBPayload = nodeSessionB.response.payload as { id: string };

    const listed = await invokeHandler({
      method: "desktop.control.session.list",
      params: {
        nodeId: "desktop-route-a",
      },
      scopes: ["operator.read"],
    });

    expect(listed.response.ok).toBe(true);
    const payload = listed.response.payload as {
      sessions: Array<{ id: string; route: { kind: string; node: { nodeId: string } | null } }>;
    };
    expect(payload.sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: nodeSessionAPayload.id,
          route: expect.objectContaining({
            kind: "node",
            node: expect.objectContaining({
              nodeId: "desktop-route-a",
            }),
          }),
        }),
      ]),
    );
    expect(payload.sessions).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: nodeSessionBPayload.id,
        }),
      ]),
    );
    expect(payload.sessions).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: localPayload.id,
        }),
      ]),
    );
  });

  it("applies normalized nodeId filters when listing sessions", async () => {
    const nodeA = createNode({
      nodeId: "DeskTop-Route-X_01",
      displayName: "Desktop Route X 01",
      caps: ["browser"],
      commands: ["browser.proxy"],
    });
    const nodeB = createNode({
      nodeId: "desktop-route-y-02",
      displayName: "Desktop Route Y 02",
      caps: ["browser"],
      commands: ["browser.proxy"],
    });

    const nodeSessionA = await invokeHandler({
      method: "desktop.control.session.create",
      params: {
        reason: "nodeId normalized filter target",
        nodeId: "DeskTop-Route-X_01",
      },
      scopes: ["operator.write", "operator.read"],
      nodes: [nodeA, nodeB],
    });
    const nodeSessionAPayload = nodeSessionA.response.payload as { id: string };

    const nodeSessionB = await invokeHandler({
      method: "desktop.control.session.create",
      params: {
        reason: "nodeId normalized filter control",
        nodeId: "desktop-route-y-02",
      },
      scopes: ["operator.write", "operator.read"],
      nodes: [nodeA, nodeB],
    });
    const nodeSessionBPayload = nodeSessionB.response.payload as { id: string };

    const listed = await invokeHandler({
      method: "desktop.control.session.list",
      params: {
        nodeId: "  desktop route x 01  ",
      },
      scopes: ["operator.read"],
    });

    expect(listed.response.ok).toBe(true);
    const payload = listed.response.payload as {
      sessions: Array<{ id: string; route: { kind: string; node: { nodeId: string } | null } }>;
    };
    expect(payload.sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: nodeSessionAPayload.id,
          route: expect.objectContaining({
            kind: "node",
            node: expect.objectContaining({
              nodeId: "DeskTop-Route-X_01",
            }),
          }),
        }),
      ]),
    );
    expect(payload.sessions).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: nodeSessionBPayload.id,
        }),
      ]),
    );
  });

  it("filters listed sessions by risk level", async () => {
    const standard = await invokeHandler({
      method: "desktop.control.session.create",
      params: { reason: "risk filter standard session" },
      scopes: ["operator.write", "operator.read"],
    });
    const standardPayload = standard.response.payload as { id: string };

    const elevated = await invokeHandler({
      method: "desktop.control.session.create",
      params: {
        reason: "risk filter elevated session",
        allowMethods: ["GET", "POST"],
      },
      scopes: ["operator.write", "operator.read"],
    });
    const elevatedPayload = elevated.response.payload as { id: string };

    const listed = await invokeHandler({
      method: "desktop.control.session.list",
      params: {
        riskLevel: "elevated",
      },
      scopes: ["operator.read"],
    });

    expect(listed.response.ok).toBe(true);
    const payload = listed.response.payload as {
      sessions: Array<{ id: string; risk: { level: string } }>;
    };
    expect(payload.sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: elevatedPayload.id,
          risk: expect.objectContaining({
            level: "elevated",
          }),
        }),
      ]),
    );
    expect(payload.sessions).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: standardPayload.id,
        }),
      ]),
    );
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
    expect(missingNote.response.error?.message).toContain("at least");

    const shortNote = await invokeHandler({
      method: "desktop.control.session.approve",
      params: {
        id: createdPayload.id,
        decision: "allow",
        note: "ok",
      },
      scopes: ["operator.approvals", "operator.read"],
      nodes: [browserNode],
    });
    expect(shortNote.response.ok).toBe(false);
    expect(shortNote.response.error?.message).toContain("at least");

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

  it("rejects non-string note payloads when approving sessions", async () => {
    const created = await invokeHandler({
      method: "desktop.control.session.create",
      params: {
        reason: "approve note type guardrail",
      },
      nodes: [],
    });
    const createdPayload = created.response.payload as { id: string };

    const approved = await invokeHandler({
      method: "desktop.control.session.approve",
      params: {
        id: createdPayload.id,
        decision: "allow",
        note: { text: "not-a-string" },
      },
      scopes: ["operator.approvals", "operator.read"],
      nodes: [],
    });

    expect(approved.response.ok).toBe(false);
    expect(approved.response.error?.message).toContain("invalid note");
  });

  it("requires a rationale note when denying a session", async () => {
    const created = await invokeHandler({
      method: "desktop.control.session.create",
      params: {
        reason: "deny rationale guardrail",
      },
      nodes: [],
    });
    const createdPayload = created.response.payload as { id: string };

    const missingNote = await invokeHandler({
      method: "desktop.control.session.approve",
      params: {
        id: createdPayload.id,
        decision: "deny",
      },
      scopes: ["operator.approvals", "operator.read"],
      nodes: [],
    });
    expect(missingNote.response.ok).toBe(false);
    expect(missingNote.response.error?.message).toContain("at least");

    const shortNote = await invokeHandler({
      method: "desktop.control.session.approve",
      params: {
        id: createdPayload.id,
        decision: "deny",
        note: "no",
      },
      scopes: ["operator.approvals", "operator.read"],
      nodes: [],
    });
    expect(shortNote.response.ok).toBe(false);
    expect(shortNote.response.error?.message).toContain("at least");

    const denied = await invokeHandler({
      method: "desktop.control.session.approve",
      params: {
        id: createdPayload.id,
        decision: "deny",
        note: "Denied after checking operator policy requirements.",
      },
      scopes: ["operator.approvals", "operator.read"],
      nodes: [],
    });
    expect(denied.response.ok).toBe(true);
    expect(denied.response.payload).toEqual(
      expect.objectContaining({
        state: "denied",
        approval: expect.objectContaining({
          decision: "deny",
          note: "Denied after checking operator policy requirements.",
        }),
      }),
    );
  });

  it("requires a rationale note when manually closing an active session", async () => {
    const created = await invokeHandler({
      method: "desktop.control.session.create",
      params: {
        reason: "manual close rationale guardrail",
      },
      nodes: [],
    });
    const createdPayload = created.response.payload as { id: string };

    const approved = await invokeHandler({
      method: "desktop.control.session.approve",
      params: {
        id: createdPayload.id,
        decision: "allow",
      },
      scopes: ["operator.approvals", "operator.read"],
      nodes: [],
    });
    expect(approved.response.ok).toBe(true);

    const missingNote = await invokeHandler({
      method: "desktop.control.session.close",
      params: {
        id: createdPayload.id,
      },
      scopes: ["operator.write", "operator.read"],
      nodes: [],
    });
    expect(missingNote.response.ok).toBe(false);
    expect(missingNote.response.error?.message).toContain("at least");

    const shortNote = await invokeHandler({
      method: "desktop.control.session.close",
      params: {
        id: createdPayload.id,
        note: "done",
      },
      scopes: ["operator.write", "operator.read"],
      nodes: [],
    });
    expect(shortNote.response.ok).toBe(false);
    expect(shortNote.response.error?.message).toContain("at least");

    const closed = await invokeHandler({
      method: "desktop.control.session.close",
      params: {
        id: createdPayload.id,
        note: "Closed after operator finished troubleshooting window.",
      },
      scopes: ["operator.write", "operator.read"],
      nodes: [],
    });
    expect(closed.response.ok).toBe(true);
    expect(closed.response.payload).toEqual(
      expect.objectContaining({
        state: "closed",
      }),
    );
    expect(closed.broadcast).toHaveBeenCalledWith(
      "desktop.control.session.updated",
      expect.objectContaining({
        action: "closed",
        details: expect.objectContaining({
          note: "Closed after operator finished troubleshooting window.",
        }),
      }),
      expect.objectContaining({ dropIfSlow: true }),
    );
  });

  it("rejects non-string note payloads when closing sessions", async () => {
    const created = await invokeHandler({
      method: "desktop.control.session.create",
      params: {
        reason: "close note type guardrail",
      },
      nodes: [],
    });
    const createdPayload = created.response.payload as { id: string };

    const closed = await invokeHandler({
      method: "desktop.control.session.close",
      params: {
        id: createdPayload.id,
        note: { text: "not-a-string" },
      },
      scopes: ["operator.write", "operator.read"],
      nodes: [],
    });

    expect(closed.response.ok).toBe(false);
    expect(closed.response.error?.message).toContain("invalid note");
  });

  it("requires write scope to close a desktop control session", async () => {
    const created = await invokeHandler({
      method: "desktop.control.session.create",
      params: {
        reason: "close scope guardrail",
      },
      nodes: [],
    });
    const createdPayload = created.response.payload as { id: string };

    const closed = await invokeHandler({
      method: "desktop.control.session.close",
      params: {
        id: createdPayload.id,
        note: "Closing before approval due to operator context change.",
      },
      scopes: ["operator.read"],
      nodes: [],
    });

    expect(closed.response.ok).toBe(false);
    expect(closed.response.error?.message).toContain("missing scope: operator.write");
  });

  it("requires rationale and records a deny decision when closing a pending session", async () => {
    const created = await invokeHandler({
      method: "desktop.control.session.create",
      params: {
        reason: "pending close rationale guardrail",
      },
      nodes: [],
    });
    const createdPayload = created.response.payload as { id: string };

    const missingNote = await invokeHandler({
      method: "desktop.control.session.close",
      params: {
        id: createdPayload.id,
      },
      scopes: ["operator.write", "operator.read"],
      nodes: [],
    });
    expect(missingNote.response.ok).toBe(false);
    expect(missingNote.response.error?.message).toContain("at least");

    const shortNote = await invokeHandler({
      method: "desktop.control.session.close",
      params: {
        id: createdPayload.id,
        note: "skip",
      },
      scopes: ["operator.write", "operator.read"],
      nodes: [],
    });
    expect(shortNote.response.ok).toBe(false);
    expect(shortNote.response.error?.message).toContain("at least");

    const closed = await invokeHandler({
      method: "desktop.control.session.close",
      params: {
        id: createdPayload.id,
        note: "Closing before approval due to changed operator context.",
      },
      scopes: ["operator.write", "operator.read"],
      nodes: [],
    });
    expect(closed.response.ok).toBe(true);
    expect(closed.response.payload).toEqual(
      expect.objectContaining({
        state: "closed",
        approval: expect.objectContaining({
          decision: "deny",
          decidedBy: "Operator Test",
          note: "Closing before approval due to changed operator context.",
        }),
      }),
    );
    expect(closed.broadcast).toHaveBeenCalledWith(
      "desktop.control.session.updated",
      expect.objectContaining({
        action: "closed",
        details: expect.objectContaining({
          note: "Closing before approval due to changed operator context.",
        }),
      }),
      expect.objectContaining({ dropIfSlow: true }),
    );
  });

  it("is idempotent when close is called on an already closed session", async () => {
    const created = await invokeHandler({
      method: "desktop.control.session.create",
      params: {
        reason: "closed-state idempotency",
      },
      nodes: [],
    });
    const createdPayload = created.response.payload as { id: string };

    await invokeHandler({
      method: "desktop.control.session.approve",
      params: {
        id: createdPayload.id,
        decision: "allow",
      },
      scopes: ["operator.approvals", "operator.read"],
      nodes: [],
    });

    const firstClose = await invokeHandler({
      method: "desktop.control.session.close",
      params: {
        id: createdPayload.id,
        note: "Closing after finishing requested troubleshooting.",
      },
      scopes: ["operator.write", "operator.read"],
      nodes: [],
    });
    expect(firstClose.response.ok).toBe(true);
    const firstPayload = firstClose.response.payload as {
      state: string;
      closedAtMs: number | null;
    };
    expect(firstPayload.state).toBe("closed");
    expect(typeof firstPayload.closedAtMs).toBe("number");

    const secondClose = await invokeHandler({
      method: "desktop.control.session.close",
      params: {
        id: createdPayload.id,
        note: "Second close should be no-op.",
      },
      scopes: ["operator.write", "operator.read"],
      nodes: [],
    });
    expect(secondClose.response.ok).toBe(true);
    expect(secondClose.response.payload).toEqual(
      expect.objectContaining({
        state: "closed",
        closedAtMs: firstPayload.closedAtMs,
      }),
    );
    expect(secondClose.broadcast).not.toHaveBeenCalled();
  });

  it("keeps denied sessions denied when close is called", async () => {
    const created = await invokeHandler({
      method: "desktop.control.session.create",
      params: {
        reason: "deny state should remain terminal",
      },
      nodes: [],
    });
    const createdPayload = created.response.payload as { id: string };

    const denied = await invokeHandler({
      method: "desktop.control.session.approve",
      params: {
        id: createdPayload.id,
        decision: "deny",
        note: "Denied after checking operator policy requirements.",
      },
      scopes: ["operator.approvals", "operator.read"],
      nodes: [],
    });
    expect(denied.response.ok).toBe(true);

    const closedAfterDeny = await invokeHandler({
      method: "desktop.control.session.close",
      params: {
        id: createdPayload.id,
        note: "Manual cleanup",
      },
      scopes: ["operator.write", "operator.read"],
      nodes: [],
    });
    expect(closedAfterDeny.response.ok).toBe(true);
    expect(closedAfterDeny.response.payload).toEqual(
      expect.objectContaining({
        state: "denied",
        approval: expect.objectContaining({
          decision: "deny",
        }),
      }),
    );
    expect(closedAfterDeny.broadcast).not.toHaveBeenCalled();
  });

  it("keeps expired sessions expired when close is called", async () => {
    const now = new Date("2026-03-16T00:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    try {
      const created = await invokeHandler({
        method: "desktop.control.session.create",
        params: {
          reason: "expiry should remain terminal",
          ttlMs: 60_000,
        },
        nodes: [],
      });
      const createdPayload = created.response.payload as { id: string };

      vi.setSystemTime(new Date(now.getTime() + 60_001));

      const closedAfterExpiry = await invokeHandler({
        method: "desktop.control.session.close",
        params: {
          id: createdPayload.id,
          note: "Manual cleanup",
        },
        scopes: ["operator.write", "operator.read"],
        nodes: [],
      });
      expect(closedAfterExpiry.response.ok).toBe(true);
      expect(closedAfterExpiry.response.payload).toEqual(
        expect.objectContaining({
          state: "expired",
        }),
      );
      const actions = closedAfterExpiry.broadcast.mock.calls.map(
        (entry) => (entry[1] as { action?: string }).action,
      );
      expect(actions).toContain("expired");
      expect(actions).not.toContain("closed");
    } finally {
      vi.useRealTimers();
    }
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
    expect(created.broadcast).toHaveBeenCalledWith(
      "desktop.control.session.updated",
      expect.objectContaining({
        action: "created",
        session: expect.objectContaining({ id: createdPayload.id }),
      }),
      expect.objectContaining({ dropIfSlow: true }),
    );
    expect(approved.broadcast).toHaveBeenCalledWith(
      "desktop.control.session.updated",
      expect.objectContaining({
        action: "approved",
        session: expect.objectContaining({ id: createdPayload.id, state: "active" }),
      }),
      expect.objectContaining({ dropIfSlow: true }),
    );
    expect(requested.broadcast).toHaveBeenCalledWith(
      "desktop.control.session.updated",
      expect.objectContaining({
        action: "request_ok",
        session: expect.objectContaining({ id: createdPayload.id, requestCount: 1 }),
      }),
      expect.objectContaining({ dropIfSlow: true }),
    );
    expect(invokeMock.mock.calls[0]?.[0]).toMatchObject({
      nodeId: "desktop-1",
      command: "browser.proxy",
    });
  });

  it("requires write scope to issue desktop control requests", async () => {
    const browserNode = createNode({
      nodeId: "desktop-scope",
      displayName: "Desktop Scope",
      caps: ["browser"],
      commands: ["browser.proxy"],
    });

    const invokeMock = vi.fn(async () => ({
      ok: true,
      payloadJSON: JSON.stringify({
        result: {
          ok: true,
        },
      }),
    }));

    const created = await invokeHandler({
      method: "desktop.control.session.create",
      params: {
        reason: "scope enforcement request",
        nodeId: "desktop-scope",
      },
      nodes: [browserNode],
      invokeMock,
    });
    const createdPayload = created.response.payload as { id: string };

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
      scopes: ["operator.read"],
      nodes: [browserNode],
      invokeMock,
    });

    expect(requested.response.ok).toBe(false);
    expect(requested.response.error?.message).toContain("missing scope: operator.write");
    expect(invokeMock).toHaveBeenCalledTimes(0);
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

  it("requires desktop control request paths to start with /", async () => {
    const browserNode = createNode({
      nodeId: "desktop-path",
      displayName: "Desktop Path",
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
        reason: "path normalization guardrail",
        nodeId: "desktop-path",
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

    const requested = await invokeHandler({
      method: "desktop.control.session.request",
      params: {
        id: createdPayload.id,
        method: "GET",
        path: "status",
      },
      scopes: ["operator.write", "operator.read"],
      nodes: [browserNode],
      invokeMock,
    });

    expect(requested.response.ok).toBe(false);
    expect(requested.response.error?.message).toContain("path must start with /");
    expect(invokeMock).toHaveBeenCalledTimes(0);
  });

  it("rejects invalid timeoutMs values for desktop control requests", async () => {
    const browserNode = createNode({
      nodeId: "desktop-timeout",
      displayName: "Desktop Timeout",
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
        reason: "timeout guardrail",
        nodeId: "desktop-timeout",
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

    for (const timeoutMs of ["1000", 0, 999_999, 10.5] as const) {
      const requested = await invokeHandler({
        method: "desktop.control.session.request",
        params: {
          id: createdPayload.id,
          method: "GET",
          path: "/status",
          timeoutMs,
        },
        scopes: ["operator.write", "operator.read"],
        nodes: [browserNode],
        invokeMock,
      });

      expect(requested.response.ok).toBe(false);
      expect(requested.response.error?.message).toContain("invalid timeoutMs");
      expect(requested.response.error?.details).toEqual(
        expect.objectContaining({
          expectedType: "integer",
          minTimeoutMs: 1,
          maxTimeoutMs: 120000,
        }),
      );
    }

    expect(invokeMock).toHaveBeenCalledTimes(0);
  });

  it("does not consume request budget when dispatch fails", async () => {
    const browserNode = createNode({
      nodeId: "desktop-budget",
      displayName: "Desktop Budget",
      caps: ["browser"],
      commands: ["browser.proxy"],
    });
    const invokeMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        error: { message: "simulated invoke failure" },
      })
      .mockResolvedValueOnce({
        ok: true,
        payloadJSON: JSON.stringify({ result: { ok: true } }),
      });

    const created = await invokeHandler({
      method: "desktop.control.session.create",
      params: {
        reason: "failure should not spend request budget",
        nodeId: "desktop-budget",
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

    const firstAttempt = await invokeHandler({
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
    expect(firstAttempt.response.ok).toBe(false);
    expect(firstAttempt.response.error?.message).toContain("simulated invoke failure");

    const afterFail = await invokeHandler({
      method: "desktop.control.session.get",
      params: { id: createdPayload.id },
      scopes: ["operator.read"],
      nodes: [browserNode],
      invokeMock,
    });
    expect(afterFail.response.ok).toBe(true);
    expect(afterFail.response.payload).toEqual(
      expect.objectContaining({
        state: "active",
        requestCount: 0,
      }),
    );

    const secondAttempt = await invokeHandler({
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
    expect(secondAttempt.response.ok).toBe(true);
    expect(secondAttempt.response.payload).toEqual({ ok: true });
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  it("blocks overlapping requests when remaining budget is reserved in-flight", async () => {
    const browserNode = createNode({
      nodeId: "desktop-budget-race",
      displayName: "Desktop Budget Race",
      caps: ["browser"],
      commands: ["browser.proxy"],
    });
    let releaseFirstInvoke: ((value: { ok: boolean; payloadJSON: string }) => void) | null = null;
    let markFirstInvokeStarted: (() => void) | null = null;
    const firstInvokeStarted = new Promise<void>((resolve) => {
      markFirstInvokeStarted = resolve;
    });
    const firstInvokeResult = new Promise<{ ok: boolean; payloadJSON: string }>((resolve) => {
      releaseFirstInvoke = resolve;
    });
    const invokeMock = vi.fn().mockImplementationOnce(async () => {
      markFirstInvokeStarted?.();
      return firstInvokeResult;
    });

    const created = await invokeHandler({
      method: "desktop.control.session.create",
      params: {
        reason: "in-flight request budget reservation",
        nodeId: "desktop-budget-race",
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

    const firstRequest = invokeHandler({
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
    await firstInvokeStarted;

    const overlappingRequest = await invokeHandler({
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
    expect(overlappingRequest.response.ok).toBe(false);
    expect(overlappingRequest.response.error?.message).toContain(
      "session request budget reserved by in-flight requests",
    );
    expect(overlappingRequest.response.error?.details).toEqual(
      expect.objectContaining({
        state: "active",
        decision: "allow",
        requestCount: 0,
        inFlightRequests: 1,
        maxRequests: 1,
        expiresAtMs: expect.any(Number),
      }),
    );
    expect(invokeMock).toHaveBeenCalledTimes(1);

    expect(releaseFirstInvoke).not.toBeNull();
    releaseFirstInvoke?.({
      ok: true,
      payloadJSON: JSON.stringify({ result: { ok: true } }),
    });
    const firstCompleted = await firstRequest;
    expect(firstCompleted.response.ok).toBe(true);
    expect(firstCompleted.response.payload).toEqual({ ok: true });

    const after = await invokeHandler({
      method: "desktop.control.session.get",
      params: { id: createdPayload.id },
      scopes: ["operator.read"],
      nodes: [browserNode],
      invokeMock,
    });
    expect(after.response.ok).toBe(true);
    expect(after.response.payload).toEqual(
      expect.objectContaining({
        state: "closed",
        requestCount: 1,
      }),
    );
  });

  it("preserves manual close state when an in-flight request completes", async () => {
    const now = new Date("2026-03-16T00:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    try {
      const browserNode = createNode({
        nodeId: "desktop-manual-close-race",
        displayName: "Desktop Manual Close Race",
        caps: ["browser"],
        commands: ["browser.proxy"],
      });
      let releaseFirstInvoke: ((value: { ok: boolean; payloadJSON: string }) => void) | null = null;
      let markFirstInvokeStarted: (() => void) | null = null;
      const firstInvokeStarted = new Promise<void>((resolve) => {
        markFirstInvokeStarted = resolve;
      });
      const firstInvokeResult = new Promise<{ ok: boolean; payloadJSON: string }>((resolve) => {
        releaseFirstInvoke = resolve;
      });
      const invokeMock = vi.fn().mockImplementationOnce(async () => {
        markFirstInvokeStarted?.();
        return firstInvokeResult;
      });
      const sharedBroadcast = vi.fn();

      const created = await invokeHandler({
        method: "desktop.control.session.create",
        params: {
          reason: "manual close while request in-flight",
          nodeId: "desktop-manual-close-race",
          maxRequests: 1,
        },
        nodes: [browserNode],
        invokeMock,
        broadcastMock: sharedBroadcast,
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
        broadcastMock: sharedBroadcast,
      });

      const firstRequest = invokeHandler({
        method: "desktop.control.session.request",
        params: {
          id: createdPayload.id,
          method: "GET",
          path: "/status",
        },
        scopes: ["operator.write", "operator.read"],
        nodes: [browserNode],
        invokeMock,
        broadcastMock: sharedBroadcast,
      });
      await firstInvokeStarted;

      vi.setSystemTime(new Date(now.getTime() + 1_000));
      const closed = await invokeHandler({
        method: "desktop.control.session.close",
        params: {
          id: createdPayload.id,
          note: "manual close during request",
        },
        scopes: ["operator.write", "operator.read"],
        nodes: [browserNode],
        invokeMock,
        broadcastMock: sharedBroadcast,
      });
      expect(closed.response.ok).toBe(true);
      expect(closed.response.payload).toEqual(
        expect.objectContaining({
          state: "closed",
          closedAtMs: now.getTime() + 1_000,
          requestCount: 0,
        }),
      );

      vi.setSystemTime(new Date(now.getTime() + 2_000));
      expect(releaseFirstInvoke).not.toBeNull();
      releaseFirstInvoke?.({
        ok: true,
        payloadJSON: JSON.stringify({ result: { ok: true } }),
      });
      const firstCompleted = await firstRequest;
      expect(firstCompleted.response.ok).toBe(true);
      expect(firstCompleted.response.payload).toEqual({ ok: true });

      const after = await invokeHandler({
        method: "desktop.control.session.get",
        params: { id: createdPayload.id },
        scopes: ["operator.read"],
        nodes: [browserNode],
        invokeMock,
        broadcastMock: sharedBroadcast,
      });
      expect(after.response.ok).toBe(true);
      expect(after.response.payload).toEqual(
        expect.objectContaining({
          state: "closed",
          requestCount: 1,
          closedAtMs: now.getTime() + 1_000,
        }),
      );

      const systemClosedEvents = sharedBroadcast.mock.calls.filter(([, payload]) => {
        const event = payload as { action?: string; actor?: string };
        return event.action === "closed" && event.actor === "system";
      });
      expect(systemClosedEvents).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
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
    expect(first.broadcast).toHaveBeenCalledWith(
      "desktop.control.session.updated",
      expect.objectContaining({
        action: "closed",
        actor: "system",
        details: expect.objectContaining({
          reason: "max requests reached",
        }),
        session: expect.objectContaining({ id: createdPayload.id, state: "closed" }),
      }),
      expect.objectContaining({ dropIfSlow: true }),
    );

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
    expect(second.response.error?.details).toEqual(
      expect.objectContaining({
        state: "closed",
        decision: "allow",
        requestCount: 1,
        maxRequests: 1,
        expiresAtMs: expect.any(Number),
      }),
    );
    expect(second.broadcast).not.toHaveBeenCalled();

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

  it("broadcasts expired when list prunes a timed-out session", async () => {
    const now = new Date("2026-03-16T00:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    try {
      const created = await invokeHandler({
        method: "desktop.control.session.create",
        params: {
          reason: "expiry broadcast on prune",
          ttlMs: 60_000,
        },
        nodes: [],
      });
      const createdPayload = created.response.payload as { id: string };

      vi.setSystemTime(new Date(now.getTime() + 60_001));

      const listBroadcast = vi.fn();
      const listed = await invokeHandler({
        method: "desktop.control.session.list",
        params: {},
        nodes: [],
        broadcastMock: listBroadcast,
      });

      expect(listed.response.ok).toBe(true);
      expect(listBroadcast).toHaveBeenCalledWith(
        "desktop.control.session.updated",
        expect.objectContaining({
          action: "expired",
          actor: "system",
          session: expect.objectContaining({ id: createdPayload.id, state: "expired" }),
        }),
        expect.objectContaining({ dropIfSlow: true }),
      );
      const payload = listed.response.payload as {
        sessions: Array<{ id: string; state: string }>;
      };
      const entry = payload.sessions.find((session) => session.id === createdPayload.id);
      expect(entry?.state).toBe("expired");
    } finally {
      vi.useRealTimers();
    }
  });

  it("broadcasts request_error when the pinned node disconnects mid-session", async () => {
    const browserNode = createNode({
      nodeId: "desktop-4",
      displayName: "Desktop Four",
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
        reason: "disconnect guardrail",
        nodeId: "desktop-4",
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

    const requestAfterDisconnect = await invokeHandler({
      method: "desktop.control.session.request",
      params: {
        id: createdPayload.id,
        method: "GET",
        path: "/status",
      },
      scopes: ["operator.write", "operator.read"],
      nodes: [],
      invokeMock,
    });

    expect(requestAfterDisconnect.response.ok).toBe(false);
    expect(requestAfterDisconnect.response.error?.message).toContain(
      "pinned browser node is not connected",
    );
    expect(requestAfterDisconnect.response.error?.details).toEqual(
      expect.objectContaining({
        nodeId: "desktop-4",
        state: "active",
        decision: "allow",
        expiresAtMs: expect.any(Number),
        requestCount: 0,
        maxRequests: expect.any(Number),
      }),
    );
    expect(requestAfterDisconnect.broadcast).toHaveBeenCalledWith(
      "desktop.control.session.updated",
      expect.objectContaining({
        action: "request_error",
        details: expect.objectContaining({
          reason: "pinned node disconnected",
          nodeId: "desktop-4",
        }),
      }),
      expect.objectContaining({ dropIfSlow: true }),
    );
    expect(invokeMock).toHaveBeenCalledTimes(0);
  });
});
