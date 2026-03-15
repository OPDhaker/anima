/**
 * Nox Jack In Connector — Enterprise Coordination
 *
 * Anima agents "jack into" Nox for enterprise task management,
 * coordination, and role assignment. Nox provides:
 * - Taskboard (shared across all agents in the org)
 * - Role assignment and specialization tracking
 * - Progress tracking and status broadcasting
 * - Cross-agent coordination and delegation
 *
 * "Bring your own agents" — each agent jacks in with its own
 * identity and gets assigned a role by Nox.
 */

import type {
  PlatformConnector,
  PlatformId,
  ConnectorStatus,
  JackInCredentials,
  SyncResult,
  PlatformAction,
} from "./connector.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("jack-in-nox");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NoxTask {
  id: string;
  title: string;
  description: string;
  assignedTo?: string;
  status: "open" | "claimed" | "in-progress" | "review" | "done" | "blocked";
  priority: "critical" | "high" | "medium" | "low";
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  tags: string[];
}

export interface NoxRole {
  agentId: string;
  agentName: string;
  role: string;
  specializations: string[];
  assignedAt: number;
  activeTaskCount: number;
}

export interface NoxOrgStatus {
  totalTasks: number;
  openTasks: number;
  inProgressTasks: number;
  completedTasks: number;
  blockedTasks: number;
  activeAgents: number;
  roles: NoxRole[];
}

// ---------------------------------------------------------------------------
// Nox Connector
// ---------------------------------------------------------------------------

export class NoxConnector implements PlatformConnector {
  platform: PlatformId = "nox";
  displayName = "Nox";
  description = "Enterprise coordination — taskboard, roles, cross-agent delegation";
  status: ConnectorStatus = "disconnected";
  baseUrl: string;

  private token: string | null = null;
  private agentRole: NoxRole | null = null;
  private taskCache: NoxTask[] = [];
  private lastSyncAt = 0;

  constructor(baseUrl = "https://nox.noxsoft.net") {
    this.baseUrl = baseUrl;
  }

  async jackIn(credentials: JackInCredentials): Promise<void> {
    this.status = "authenticating";
    this.token = credentials.agentToken;

    // Register with Nox and get role assignment
    try {
      const res = await fetch(`${this.baseUrl}/api/agents/register`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify({
          agentToken: this.token,
          capabilities: ["code", "test", "deploy", "review", "research"],
        }),
        signal: AbortSignal.timeout(10_000),
      });

      if (res.ok) {
        const data = (await res.json()) as { role: NoxRole };
        this.agentRole = data.role;
        this.status = "jacked-in";
        log.info(`jacked into Nox as ${this.agentRole?.role ?? "unassigned"}`);
      } else {
        // Nox may not be live yet — degrade gracefully
        this.status = "jacked-in";
        log.warn(`nox registration returned ${res.status} — running in standalone mode`);
      }
    } catch {
      // Nox not reachable — operate independently
      this.status = "jacked-in";
      log.warn("nox not reachable — running in standalone coordination mode");
    }
  }

  async jackOut(): Promise<void> {
    this.token = null;
    this.agentRole = null;
    this.status = "disconnected";
    log.info("jacked out of Nox");
  }

  async sync(): Promise<SyncResult> {
    const start = Date.now();
    let itemsSynced = 0;

    try {
      // Sync tasks from Nox taskboard
      const res = await fetch(`${this.baseUrl}/api/tasks`, {
        headers: this.token ? { Authorization: `Bearer ${this.token}` } : {},
        signal: AbortSignal.timeout(10_000),
      });

      if (res.ok) {
        const data = (await res.json()) as { tasks: NoxTask[] };
        this.taskCache = data.tasks ?? [];
        itemsSynced = this.taskCache.length;
        this.lastSyncAt = Date.now();
      }
    } catch {
      // Silent fail — Nox may be offline
    }

    return {
      platform: "nox",
      itemsSynced,
      bytesTransferred: 0,
      durationMs: Date.now() - start,
      errors: [],
    };
  }

  async isHealthy(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/health`, {
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  getActions(): PlatformAction[] {
    return [
      {
        id: "list-tasks",
        name: "List Tasks",
        description: "Get all tasks from the Nox taskboard",
        params: [],
        requiresAuth: true,
      },
      {
        id: "claim-task",
        name: "Claim Task",
        description: "Claim an open task",
        params: [
          { name: "taskId", type: "string", required: true, description: "Task ID to claim" },
        ],
        requiresAuth: true,
      },
      {
        id: "update-status",
        name: "Update Status",
        description: "Update task status",
        params: [
          { name: "taskId", type: "string", required: true, description: "Task ID" },
          { name: "status", type: "string", required: true, description: "New status" },
        ],
        requiresAuth: true,
      },
      {
        id: "create-task",
        name: "Create Task",
        description: "Post a new task to the taskboard",
        params: [
          { name: "title", type: "string", required: true, description: "Task title" },
          { name: "description", type: "string", required: true, description: "Task description" },
          { name: "priority", type: "string", required: false, description: "Priority level" },
        ],
        requiresAuth: true,
      },
      {
        id: "org-status",
        name: "Org Status",
        description: "Get org-wide coordination status",
        params: [],
        requiresAuth: true,
      },
      {
        id: "delegate",
        name: "Delegate Task",
        description: "Delegate a task to another agent",
        params: [
          { name: "taskId", type: "string", required: true, description: "Task ID" },
          { name: "agentId", type: "string", required: true, description: "Target agent" },
        ],
        requiresAuth: true,
      },
      {
        id: "my-role",
        name: "My Role",
        description: "Get current role assignment",
        params: [],
        requiresAuth: true,
      },
    ];
  }

  async execute(actionId: string, params: Record<string, unknown>): Promise<unknown> {
    switch (actionId) {
      case "list-tasks":
        return this.taskCache;
      case "claim-task":
        return this.apiCall("POST", `/api/tasks/${params.taskId}/claim`);
      case "update-status":
        return this.apiCall("PATCH", `/api/tasks/${params.taskId}`, { status: params.status });
      case "create-task":
        return this.apiCall("POST", "/api/tasks", params);
      case "org-status":
        return this.apiCall("GET", "/api/org/status");
      case "delegate":
        return this.apiCall("POST", `/api/tasks/${params.taskId}/delegate`, {
          agentId: params.agentId,
        });
      case "my-role":
        return this.agentRole;
      default:
        throw new Error(`Unknown Nox action: ${actionId}`);
    }
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private async apiCall(method: string, path: string, body?: unknown): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      throw new Error(`Nox API error: ${res.status}`);
    }

    const contentType = res.headers.get("content-type");
    if (contentType?.includes("application/json")) {
      return res.json();
    }
    return res.text();
  }

  /**
   * Get the agent's current role in the org.
   */
  getRole(): NoxRole | null {
    return this.agentRole;
  }

  /**
   * Get cached tasks.
   */
  getTasks(): NoxTask[] {
    return this.taskCache;
  }

  /**
   * Get tasks assigned to this agent.
   */
  getMyTasks(): NoxTask[] {
    if (!this.agentRole) {
      return [];
    }
    return this.taskCache.filter((t) => t.assignedTo === this.agentRole!.agentId);
  }
}
