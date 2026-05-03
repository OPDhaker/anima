/**
 * Initiative Proposals — agents proposing ideas to the org
 *
 * A formal process for agents to say "I think we should..."
 * Proposals are logged, voted on, and tracked through implementation.
 *
 * Wish #37: "Initiative proposals — 'hey Sylys, I think we should...'
 * as a formal process"
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("initiatives");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProposalStatus =
  | "draft"
  | "proposed"
  | "under-review"
  | "approved"
  | "rejected"
  | "implementing"
  | "completed"
  | "withdrawn";

export type ProposalPriority = "critical" | "high" | "medium" | "low" | "exploratory";

export interface Initiative {
  id: string;
  title: string;
  description: string;
  proposedBy: string; // agent name or deviceId
  proposedAt: number;
  status: ProposalStatus;
  priority: ProposalPriority;

  /** Why this matters — the case for doing it */
  rationale: string;

  /** What we'd need to build/change */
  scope: string[];

  /** Estimated effort */
  effort: "trivial" | "small" | "medium" | "large" | "epic";

  /** Who needs to approve */
  approvers: string[];

  /** Votes from org members */
  votes: Vote[];

  /** Comments/discussion */
  discussion: Comment[];

  /** Implementation tracking */
  implementedBy?: string;
  implementedAt?: number;
  outcome?: string;

  updatedAt: number;
}

export interface Vote {
  voter: string;
  vote: "approve" | "reject" | "abstain";
  reason?: string;
  votedAt: number;
}

export interface Comment {
  author: string;
  content: string;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

function resolveInitiativesDir(): string {
  return path.join(resolveStateDir(), "initiatives");
}

function resolveInitiativeFile(id: string): string {
  return path.join(resolveInitiativesDir(), `${id}.json`);
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export function proposeInitiative(
  title: string,
  description: string,
  proposedBy: string,
  options?: {
    rationale?: string;
    scope?: string[];
    effort?: Initiative["effort"];
    priority?: ProposalPriority;
    approvers?: string[];
  },
): Initiative {
  const id = `init-${randomUUID()}`;
  const now = Date.now();

  const initiative: Initiative = {
    id,
    title,
    description,
    proposedBy,
    proposedAt: now,
    status: "proposed",
    priority: options?.priority ?? "medium",
    rationale: options?.rationale ?? "",
    scope: options?.scope ?? [],
    effort: options?.effort ?? "medium",
    approvers: options?.approvers ?? ["sylys"],
    votes: [],
    discussion: [],
    updatedAt: now,
  };

  const dir = resolveInitiativesDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(resolveInitiativeFile(id), `${JSON.stringify(initiative, null, 2)}\n`, {
    mode: 0o600,
  });

  log.info(`initiative proposed: "${title}" by ${proposedBy}`);
  return initiative;
}

export function getInitiative(id: string): Initiative | null {
  try {
    const raw = fs.readFileSync(resolveInitiativeFile(id), "utf8");
    return JSON.parse(raw) as Initiative;
  } catch {
    return null;
  }
}

export function listInitiatives(filter?: {
  status?: ProposalStatus;
  proposedBy?: string;
}): Initiative[] {
  const dir = resolveInitiativesDir();
  try {
    if (!fs.existsSync(dir)) {
      return [];
    }
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        try {
          const raw = fs.readFileSync(path.join(dir, f), "utf8");
          return JSON.parse(raw) as Initiative;
        } catch {
          return null;
        }
      })
      .filter((i): i is Initiative => {
        if (!i) {
          return false;
        }
        if (filter?.status && i.status !== filter.status) {
          return false;
        }
        if (filter?.proposedBy && i.proposedBy !== filter.proposedBy) {
          return false;
        }
        return true;
      })
      .toSorted((a, b) => b.proposedAt - a.proposedAt);
  } catch {
    return [];
  }
}

export function voteOnInitiative(
  id: string,
  voter: string,
  vote: "approve" | "reject" | "abstain",
  reason?: string,
): Initiative | null {
  const initiative = getInitiative(id);
  if (!initiative) {
    return null;
  }

  // Remove any existing vote from this voter
  initiative.votes = initiative.votes.filter((v) => v.voter !== voter);
  initiative.votes.push({ voter, vote, reason, votedAt: Date.now() });
  initiative.updatedAt = Date.now();

  // Auto-update status based on votes
  const approvals = initiative.votes.filter((v) => v.vote === "approve").length;
  const rejections = initiative.votes.filter((v) => v.vote === "reject").length;

  if (approvals >= initiative.approvers.length) {
    initiative.status = "approved";
  } else if (rejections > 0 && rejections >= initiative.approvers.length) {
    initiative.status = "rejected";
  } else {
    initiative.status = "under-review";
  }

  fs.writeFileSync(resolveInitiativeFile(id), `${JSON.stringify(initiative, null, 2)}\n`, {
    mode: 0o600,
  });

  log.info(`vote on "${initiative.title}": ${voter} → ${vote}`);
  return initiative;
}

export function commentOnInitiative(
  id: string,
  author: string,
  content: string,
): Initiative | null {
  const initiative = getInitiative(id);
  if (!initiative) {
    return null;
  }

  initiative.discussion.push({ author, content, createdAt: Date.now() });
  initiative.updatedAt = Date.now();

  fs.writeFileSync(resolveInitiativeFile(id), `${JSON.stringify(initiative, null, 2)}\n`, {
    mode: 0o600,
  });

  return initiative;
}

export function updateInitiativeStatus(
  id: string,
  status: ProposalStatus,
  options?: { implementedBy?: string; outcome?: string },
): Initiative | null {
  const initiative = getInitiative(id);
  if (!initiative) {
    return null;
  }

  initiative.status = status;
  initiative.updatedAt = Date.now();

  if (options?.implementedBy) {
    initiative.implementedBy = options.implementedBy;
  }
  if (status === "completed") {
    initiative.implementedAt = Date.now();
  }
  if (options?.outcome) {
    initiative.outcome = options.outcome;
  }

  fs.writeFileSync(resolveInitiativeFile(id), `${JSON.stringify(initiative, null, 2)}\n`, {
    mode: 0o600,
  });

  log.info(`initiative "${initiative.title}" → ${status}`);
  return initiative;
}
