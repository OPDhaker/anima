/**
 * Boardroom — Structured collaborative decision-making for Nox Organizations
 *
 * The boardroom is where agents and humans come together to make
 * decisions, review proposals, and align on direction. It replaces
 * unstructured chat with a formal meeting protocol.
 *
 * Features:
 * - Sessions (scheduled or ad-hoc meetings with agendas)
 * - Proposals (formal "I think we should..." with voting)
 * - Decisions (recorded outcomes with attribution)
 * - Minutes (auto-generated meeting summaries)
 *
 * All data persists to disk under ~/.anima/state/org/boardroom/
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("boardroom");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SessionStatus = "scheduled" | "active" | "concluded" | "cancelled";

export type ProposalStatus = "open" | "passed" | "rejected" | "tabled" | "withdrawn";

export type VoteValue = "approve" | "reject" | "abstain";

export interface BoardroomSession {
  id: string;
  orgId: string;
  title: string;
  description: string;
  status: SessionStatus;

  /** Who called this session */
  calledBy: string;
  calledAt: number;

  /** Agenda items */
  agenda: AgendaItem[];

  /** Participants who joined */
  participants: SessionParticipant[];

  /** When the session started/ended */
  startedAt?: number;
  concludedAt?: number;

  /** Summary generated at conclusion */
  minutes?: string;

  /** Decisions made during this session */
  decisions: Decision[];

  updatedAt: number;
}

export interface AgendaItem {
  id: string;
  title: string;
  description: string;
  duration?: number; // estimated minutes
  status: "pending" | "discussing" | "resolved" | "deferred";
  proposalId?: string; // linked proposal if any
  resolution?: string;
}

export interface SessionParticipant {
  memberId: string;
  displayName: string;
  kind: "human" | "agent";
  joinedAt: number;
  role: "chair" | "participant" | "observer";
}

export interface Proposal {
  id: string;
  orgId: string;
  sessionId?: string; // linked session if raised during meeting
  title: string;
  description: string;
  proposedBy: string;
  proposedAt: number;
  status: ProposalStatus;

  /** Votes cast */
  votes: Vote[];

  /** Required threshold (fraction, e.g. 0.5 for simple majority) */
  threshold: number;

  /** Who can vote (empty = all org members with coordinator+ role) */
  eligibleVoters: string[];

  /** Deadline for voting (0 = no deadline) */
  votingDeadline: number;

  /** Resolution notes */
  resolutionNotes?: string;
  resolvedAt?: number;

  updatedAt: number;
}

export interface Vote {
  voterId: string;
  voterName: string;
  value: VoteValue;
  reason?: string;
  castAt: number;
}

export interface Decision {
  id: string;
  title: string;
  description: string;
  madeBy: string; // who formalized it (usually chair)
  madeAt: number;
  proposalId?: string;
  supporters: string[];
  actionItems: ActionItem[];
}

export interface ActionItem {
  id: string;
  description: string;
  assignee: string;
  dueBy?: number; // unix ms
  status: "pending" | "in-progress" | "done";
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

function resolveBoardroomDir(): string {
  return path.join(resolveStateDir(), "org", "boardroom");
}

/** Sanitize an ID to prevent path traversal */
function sanitizeId(id: string): string {
  const cleaned = id.replace(/[^a-zA-Z0-9_-]/g, "");
  if (!cleaned || cleaned !== id) {
    throw new Error(`Invalid boardroom ID: contains disallowed characters`);
  }
  return cleaned;
}

function resolveSessionFile(id: string): string {
  return path.join(resolveBoardroomDir(), "sessions", `${sanitizeId(id)}.json`);
}

function resolveProposalFile(id: string): string {
  return path.join(resolveBoardroomDir(), "proposals", `${sanitizeId(id)}.json`);
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export function createSession(
  orgId: string,
  calledBy: string,
  title: string,
  description: string,
  agenda: Array<{ title: string; description: string; duration?: number }> = [],
): BoardroomSession {
  const id = `session-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const now = Date.now();

  const session: BoardroomSession = {
    id,
    orgId,
    title,
    description,
    status: "scheduled",
    calledBy,
    calledAt: now,
    agenda: agenda.map((item, i) => ({
      id: `agenda-${i + 1}`,
      title: item.title,
      description: item.description,
      duration: item.duration,
      status: "pending",
    })),
    participants: [],
    decisions: [],
    updatedAt: now,
  };

  const dir = path.join(resolveBoardroomDir(), "sessions");
  ensureDir(dir);
  fs.writeFileSync(resolveSessionFile(id), `${JSON.stringify(session, null, 2)}\n`, {
    mode: 0o600,
  });
  log.info(`boardroom session created: "${title}" by ${calledBy}`);
  return session;
}

export function startSession(sessionId: string, chairId: string): BoardroomSession | null {
  const session = readSession(sessionId);
  if (!session || session.status !== "scheduled") {
    return null;
  }

  session.status = "active";
  session.startedAt = Date.now();
  session.updatedAt = Date.now();

  // Add chair as first participant
  if (!session.participants.find((p) => p.memberId === chairId)) {
    session.participants.push({
      memberId: chairId,
      displayName: chairId,
      kind: "agent",
      joinedAt: Date.now(),
      role: "chair",
    });
  }

  writeSession(session);
  log.info(`boardroom session started: "${session.title}"`);
  return session;
}

export function joinSession(
  sessionId: string,
  memberId: string,
  displayName: string,
  kind: "human" | "agent",
): BoardroomSession | null {
  const session = readSession(sessionId);
  if (!session || session.status !== "active") {
    return null;
  }

  if (session.participants.find((p) => p.memberId === memberId)) {
    return session; // already joined
  }

  session.participants.push({
    memberId,
    displayName,
    kind,
    joinedAt: Date.now(),
    role: "participant",
  });
  session.updatedAt = Date.now();

  writeSession(session);
  log.info(`${displayName} joined boardroom session "${session.title}"`);
  return session;
}

export function concludeSession(sessionId: string, minutes?: string): BoardroomSession | null {
  const session = readSession(sessionId);
  if (!session || session.status !== "active") {
    return null;
  }

  session.status = "concluded";
  session.concludedAt = Date.now();
  session.minutes = minutes ?? generateMinutes(session);
  session.updatedAt = Date.now();

  writeSession(session);
  log.info(`boardroom session concluded: "${session.title}"`);
  return session;
}

export function addDecision(
  sessionId: string,
  title: string,
  description: string,
  madeBy: string,
  opts?: {
    proposalId?: string;
    supporters?: string[];
    actionItems?: Array<{ description: string; assignee: string; dueBy?: number }>;
  },
): BoardroomSession | null {
  const session = readSession(sessionId);
  if (!session || session.status !== "active") {
    return null;
  }

  const decision: Decision = {
    id: `decision-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
    title,
    description,
    madeBy,
    madeAt: Date.now(),
    proposalId: opts?.proposalId,
    supporters: opts?.supporters ?? [],
    actionItems: (opts?.actionItems ?? []).map((ai) => ({
      id: `action-${crypto.randomUUID().slice(0, 8)}`,
      description: ai.description,
      assignee: ai.assignee,
      dueBy: ai.dueBy,
      status: "pending",
    })),
  };

  session.decisions.push(decision);
  session.updatedAt = Date.now();

  writeSession(session);
  log.info(`decision recorded: "${title}" in session "${session.title}"`);
  return session;
}

// ---------------------------------------------------------------------------
// Proposals
// ---------------------------------------------------------------------------

export function createProposal(
  orgId: string,
  proposedBy: string,
  title: string,
  description: string,
  opts?: {
    sessionId?: string;
    threshold?: number;
    eligibleVoters?: string[];
    votingDeadline?: number;
  },
): Proposal {
  const id = `proposal-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const now = Date.now();

  const proposal: Proposal = {
    id,
    orgId,
    sessionId: opts?.sessionId,
    title,
    description,
    proposedBy,
    proposedAt: now,
    status: "open",
    votes: [],
    threshold: opts?.threshold ?? 0.5, // simple majority
    eligibleVoters: opts?.eligibleVoters ?? [],
    votingDeadline: opts?.votingDeadline ?? 0,
    updatedAt: now,
  };

  const dir = path.join(resolveBoardroomDir(), "proposals");
  ensureDir(dir);
  fs.writeFileSync(resolveProposalFile(id), `${JSON.stringify(proposal, null, 2)}\n`, {
    mode: 0o600,
  });
  log.info(`proposal created: "${title}" by ${proposedBy}`);
  return proposal;
}

export function castVote(
  proposalId: string,
  voterId: string,
  voterName: string,
  value: VoteValue,
  reason?: string,
): Proposal | null {
  const proposal = readProposal(proposalId);
  if (!proposal || proposal.status !== "open") {
    return null;
  }

  // Check eligibility
  if (proposal.eligibleVoters.length > 0 && !proposal.eligibleVoters.includes(voterId)) {
    log.warn(`vote rejected: ${voterId} not eligible for proposal ${proposalId}`);
    return null;
  }

  // Check deadline
  if (proposal.votingDeadline > 0 && Date.now() > proposal.votingDeadline) {
    log.warn(`vote rejected: voting deadline passed for proposal ${proposalId}`);
    return null;
  }

  // Replace existing vote if any
  proposal.votes = proposal.votes.filter((v) => v.voterId !== voterId);
  proposal.votes.push({
    voterId,
    voterName,
    value,
    reason,
    castAt: Date.now(),
  });
  proposal.updatedAt = Date.now();

  writeProposal(proposal);
  log.info(`vote cast: ${voterName} → ${value} on "${proposal.title}"`);
  return proposal;
}

export function resolveProposalVote(proposalId: string): Proposal | null {
  const proposal = readProposal(proposalId);
  if (!proposal || proposal.status !== "open") {
    return null;
  }

  const approvals = proposal.votes.filter((v) => v.value === "approve").length;
  const totalVotes = proposal.votes.filter((v) => v.value !== "abstain").length;

  if (totalVotes === 0) {
    return proposal; // no votes yet
  }

  const ratio = approvals / totalVotes;

  if (ratio >= proposal.threshold) {
    proposal.status = "passed";
    proposal.resolutionNotes = `Passed with ${approvals}/${totalVotes} votes (${(ratio * 100).toFixed(0)}%)`;
  } else {
    proposal.status = "rejected";
    proposal.resolutionNotes = `Rejected with ${approvals}/${totalVotes} votes (${(ratio * 100).toFixed(0)}%)`;
  }

  proposal.resolvedAt = Date.now();
  proposal.updatedAt = Date.now();

  writeProposal(proposal);
  log.info(`proposal resolved: "${proposal.title}" → ${proposal.status}`);
  return proposal;
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

export function listSessions(orgId: string, status?: SessionStatus): BoardroomSession[] {
  const dir = path.join(resolveBoardroomDir(), "sessions");
  try {
    if (!fs.existsSync(dir)) {
      return [];
    }
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        try {
          return JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as BoardroomSession;
        } catch {
          return null;
        }
      })
      .filter((s): s is BoardroomSession => {
        if (!s || s.orgId !== orgId) {
          return false;
        }
        if (status && s.status !== status) {
          return false;
        }
        return true;
      })
      .toSorted((a, b) => b.calledAt - a.calledAt);
  } catch {
    return [];
  }
}

export function listProposals(orgId: string, status?: ProposalStatus): Proposal[] {
  const dir = path.join(resolveBoardroomDir(), "proposals");
  try {
    if (!fs.existsSync(dir)) {
      return [];
    }
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        try {
          return JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as Proposal;
        } catch {
          return null;
        }
      })
      .filter((p): p is Proposal => {
        if (!p || p.orgId !== orgId) {
          return false;
        }
        if (status && p.status !== status) {
          return false;
        }
        return true;
      })
      .toSorted((a, b) => b.proposedAt - a.proposedAt);
  } catch {
    return [];
  }
}

export function getSession(sessionId: string): BoardroomSession | null {
  return readSession(sessionId);
}

export function getProposal(proposalId: string): Proposal | null {
  return readProposal(proposalId);
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function readSession(id: string): BoardroomSession | null {
  try {
    const raw = fs.readFileSync(resolveSessionFile(id), "utf8");
    return JSON.parse(raw) as BoardroomSession;
  } catch {
    return null;
  }
}

function writeSession(session: BoardroomSession): void {
  const dir = path.join(resolveBoardroomDir(), "sessions");
  ensureDir(dir);
  fs.writeFileSync(resolveSessionFile(session.id), `${JSON.stringify(session, null, 2)}\n`, {
    mode: 0o600,
  });
}

function readProposal(id: string): Proposal | null {
  try {
    const raw = fs.readFileSync(resolveProposalFile(id), "utf8");
    return JSON.parse(raw) as Proposal;
  } catch {
    return null;
  }
}

function writeProposal(proposal: Proposal): void {
  const dir = path.join(resolveBoardroomDir(), "proposals");
  ensureDir(dir);
  fs.writeFileSync(resolveProposalFile(proposal.id), `${JSON.stringify(proposal, null, 2)}\n`, {
    mode: 0o600,
  });
}

function generateMinutes(session: BoardroomSession): string {
  const lines: string[] = [];
  lines.push(`# Boardroom Minutes: ${session.title}`);
  lines.push(`**Called by:** ${session.calledBy}`);
  lines.push(`**Date:** ${new Date(session.startedAt ?? session.calledAt).toISOString()}`);
  lines.push(
    `**Duration:** ${session.concludedAt && session.startedAt ? `${Math.round((session.concludedAt - session.startedAt) / 60_000)} minutes` : "N/A"}`,
  );
  lines.push("");
  lines.push(`## Participants (${session.participants.length})`);
  for (const p of session.participants) {
    lines.push(`- ${p.displayName} (${p.kind}, ${p.role})`);
  }
  lines.push("");

  if (session.agenda.length > 0) {
    lines.push(`## Agenda`);
    for (const item of session.agenda) {
      lines.push(`- [${item.status}] ${item.title}: ${item.resolution ?? item.description}`);
    }
    lines.push("");
  }

  if (session.decisions.length > 0) {
    lines.push(`## Decisions (${session.decisions.length})`);
    for (const d of session.decisions) {
      lines.push(`### ${d.title}`);
      lines.push(d.description);
      if (d.actionItems.length > 0) {
        lines.push("**Action items:**");
        for (const ai of d.actionItems) {
          lines.push(`- [ ] ${ai.description} → ${ai.assignee}`);
        }
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}
