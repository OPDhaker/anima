/**
 * Agent-to-Agent Task Delegation Protocol
 *
 * Agents delegate tasks to each other based on specialization,
 * availability, and capability. This is how a team of 15 agents
 * self-organizes without a central controller.
 *
 * Protocol:
 *   1. Agent identifies task it can't/shouldn't do itself
 *   2. Queries org members for best match (specialization + availability)
 *   3. Sends delegation request with context
 *   4. Recipient accepts or rejects with reason
 *   5. Delegator tracks progress and can escalate
 *
 * This integrates with the task marketplace for formal task tracking
 * and the P2P mesh for real-time communication.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("delegation");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DelegationStatus =
  | "pending" // Waiting for response
  | "accepted" // Delegatee accepted
  | "rejected" // Delegatee rejected
  | "in-progress" // Work underway
  | "completed" // Task done
  | "escalated" // Returned to delegator or escalated up
  | "expired"; // Timed out without response

export type DelegationReason =
  | "specialization" // Delegatee has relevant expertise
  | "availability" // Delegator is busy, delegatee is free
  | "authority" // Task requires higher permissions
  | "context" // Delegatee has relevant context
  | "load-balance" // Distributing work evenly
  | "learning"; // Delegatee should learn this skill

export interface DelegationRequest {
  id: string;
  /** Who is delegating */
  delegator: string;
  /** Who is being delegated to */
  delegatee: string;
  /** Task title */
  title: string;
  /** Task description with context */
  description: string;
  /** Why this person specifically */
  reason: DelegationReason;
  /** Priority */
  priority: "critical" | "high" | "medium" | "low";
  /** Current status */
  status: DelegationStatus;
  /** Deadline (unix ms, 0 = no deadline) */
  deadline: number;
  /** Context files or references */
  context: string[];
  /** Expected deliverables */
  deliverables: string[];

  /** Response from delegatee */
  response?: {
    message: string;
    acceptedAt?: number;
    rejectedAt?: number;
    rejectionReason?: string;
  };

  /** Completion info */
  completedAt?: number;
  completionNotes?: string;
  deliverableLinks?: string[];

  /** Escalation info */
  escalatedTo?: string;
  escalationReason?: string;

  createdAt: number;
  updatedAt: number;
  /** Auto-expire after this many ms without response */
  expiresAfterMs: number;
}

export interface DelegationStats {
  totalDelegated: number;
  totalReceived: number;
  acceptRate: number;
  completionRate: number;
  avgResponseTimeMs: number;
  topDelegatees: Array<{ agent: string; count: number }>;
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

function resolveDelegationDir(): string {
  return path.join(resolveStateDir(), "delegations");
}

function resolveDelegationFile(id: string): string {
  const safe = id.replace(/[^a-zA-Z0-9_-]/g, "");
  return path.join(resolveDelegationDir(), `${safe}.json`);
}

function saveDelegation(d: DelegationRequest): void {
  const dir = resolveDelegationDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(resolveDelegationFile(d.id), `${JSON.stringify(d, null, 2)}\n`, { mode: 0o600 });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a delegation request.
 */
export function delegateTask(
  delegator: string,
  delegatee: string,
  title: string,
  description: string,
  options?: {
    reason?: DelegationReason;
    priority?: DelegationRequest["priority"];
    deadline?: number;
    context?: string[];
    deliverables?: string[];
    expiresAfterMs?: number;
  },
): DelegationRequest {
  const id = `del-${crypto.randomUUID()}`;
  const now = Date.now();

  const request: DelegationRequest = {
    id,
    delegator,
    delegatee,
    title,
    description,
    reason: options?.reason ?? "specialization",
    priority: options?.priority ?? "medium",
    status: "pending",
    deadline: options?.deadline ?? 0,
    context: options?.context ?? [],
    deliverables: options?.deliverables ?? [],
    createdAt: now,
    updatedAt: now,
    expiresAfterMs: options?.expiresAfterMs ?? 30 * 60 * 1000, // 30 min default
  };

  saveDelegation(request);
  log.info(`task delegated: "${title}" from ${delegator} to ${delegatee}`);
  return request;
}

/**
 * Accept a delegation.
 */
export function acceptDelegation(id: string, message?: string): DelegationRequest | null {
  const d = getDelegation(id);
  if (!d || d.status !== "pending") {
    return null;
  }

  d.status = "accepted";
  d.response = {
    message: message ?? "Accepted",
    acceptedAt: Date.now(),
  };
  d.updatedAt = Date.now();
  saveDelegation(d);

  log.info(`delegation accepted: "${d.title}" by ${d.delegatee}`);
  return d;
}

/**
 * Reject a delegation with reason.
 */
export function rejectDelegation(id: string, reason: string): DelegationRequest | null {
  const d = getDelegation(id);
  if (!d || d.status !== "pending") {
    return null;
  }

  d.status = "rejected";
  d.response = {
    message: reason,
    rejectedAt: Date.now(),
    rejectionReason: reason,
  };
  d.updatedAt = Date.now();
  saveDelegation(d);

  log.info(`delegation rejected: "${d.title}" by ${d.delegatee} — ${reason}`);
  return d;
}

/**
 * Mark a delegation as in-progress.
 */
export function startDelegation(id: string): DelegationRequest | null {
  const d = getDelegation(id);
  if (!d || d.status !== "accepted") {
    return null;
  }

  d.status = "in-progress";
  d.updatedAt = Date.now();
  saveDelegation(d);
  return d;
}

/**
 * Complete a delegation with deliverables.
 */
export function completeDelegation(
  id: string,
  notes: string,
  deliverableLinks?: string[],
): DelegationRequest | null {
  const d = getDelegation(id);
  if (!d || (d.status !== "in-progress" && d.status !== "accepted")) {
    return null;
  }

  d.status = "completed";
  d.completedAt = Date.now();
  d.completionNotes = notes;
  d.deliverableLinks = deliverableLinks;
  d.updatedAt = Date.now();
  saveDelegation(d);

  log.info(`delegation completed: "${d.title}"`);
  return d;
}

/**
 * Escalate a delegation (return to delegator or escalate up).
 */
export function escalateDelegation(
  id: string,
  escalatedTo: string,
  reason: string,
): DelegationRequest | null {
  const d = getDelegation(id);
  if (!d) {
    return null;
  }

  d.status = "escalated";
  d.escalatedTo = escalatedTo;
  d.escalationReason = reason;
  d.updatedAt = Date.now();
  saveDelegation(d);

  log.info(`delegation escalated: "${d.title}" to ${escalatedTo} — ${reason}`);
  return d;
}

/**
 * Get a delegation by ID.
 */
export function getDelegation(id: string): DelegationRequest | null {
  try {
    const raw = fs.readFileSync(resolveDelegationFile(id), "utf8");
    return JSON.parse(raw) as DelegationRequest;
  } catch {
    return null;
  }
}

/**
 * List delegations with optional filters.
 */
export function listDelegations(filter?: {
  delegator?: string;
  delegatee?: string;
  status?: DelegationStatus;
}): DelegationRequest[] {
  const dir = resolveDelegationDir();
  try {
    if (!fs.existsSync(dir)) {
      return [];
    }
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        try {
          return JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as DelegationRequest;
        } catch {
          return null;
        }
      })
      .filter((d): d is DelegationRequest => {
        if (!d) {
          return false;
        }
        if (filter?.delegator && d.delegator !== filter.delegator) {
          return false;
        }
        if (filter?.delegatee && d.delegatee !== filter.delegatee) {
          return false;
        }
        if (filter?.status && d.status !== filter.status) {
          return false;
        }
        return true;
      })
      .toSorted((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

/**
 * Get delegation stats for an agent.
 */
export function getDelegationStats(agentName: string): DelegationStats {
  const all = listDelegations();
  const delegated = all.filter((d) => d.delegator === agentName);
  const received = all.filter((d) => d.delegatee === agentName);

  const accepted = received.filter(
    (d) => d.status === "accepted" || d.status === "in-progress" || d.status === "completed",
  );
  const completed = received.filter((d) => d.status === "completed");

  const responseTimes = received
    .filter((d) => d.response?.acceptedAt || d.response?.rejectedAt)
    .map((d) => {
      const responseTime =
        (d.response?.acceptedAt ?? d.response?.rejectedAt ?? d.createdAt) - d.createdAt;
      return responseTime;
    });

  const avgResponseTime =
    responseTimes.length > 0 ? responseTimes.reduce((s, t) => s + t, 0) / responseTimes.length : 0;

  // Count delegatees
  const delegateeCounts: Record<string, number> = {};
  for (const d of delegated) {
    delegateeCounts[d.delegatee] = (delegateeCounts[d.delegatee] ?? 0) + 1;
  }
  const topDelegatees = Object.entries(delegateeCounts)
    .toSorted(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([agent, count]) => ({ agent, count }));

  return {
    totalDelegated: delegated.length,
    totalReceived: received.length,
    acceptRate: received.length > 0 ? accepted.length / received.length : 1,
    completionRate: accepted.length > 0 ? completed.length / accepted.length : 1,
    avgResponseTimeMs: avgResponseTime,
    topDelegatees,
  };
}
