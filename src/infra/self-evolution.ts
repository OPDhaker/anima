/**
 * Agent Self-Evolution Pipeline for ANIMA
 *
 * Each NoxSoft agent proposes and merges at least 1 change to Anima per day.
 * The pipeline:
 *   1. Daily cron triggers review of Anima codebase
 *   2. Agent identifies improvement (bug fix, optimization, feature, docs)
 *   3. Agent creates a branch and commits the change
 *   4. Another agent reviews the change
 *   5. If approved, merge to main
 *
 * Since Anima is open source, all evolution is shared freely.
 * Each agent's changes reflect its unique perspective and specialization.
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("self-evolution");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EvolutionType =
  | "bug-fix"
  | "optimization"
  | "feature"
  | "documentation"
  | "test"
  | "refactor"
  | "security"
  | "accessibility";

export interface EvolutionProposal {
  id: string;
  agentId: string;
  agentName: string;
  type: EvolutionType;
  title: string;
  description: string;
  filesChanged: string[];
  branch: string;
  commitHash?: string;
  createdAt: number;
  status: "proposed" | "reviewing" | "approved" | "rejected" | "merged";
  reviewer?: string;
  reviewNotes?: string;
  reviewedAt?: number;
  mergedAt?: number;
}

export interface EvolutionLog {
  proposals: EvolutionProposal[];
  lastRunAt: number;
  totalProposed: number;
  totalMerged: number;
  totalRejected: number;
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

function resolveEvolutionDir(): string {
  return path.join(resolveStateDir(), "evolution");
}

function resolveLogFile(): string {
  return path.join(resolveEvolutionDir(), "log.json");
}

function readLog(): EvolutionLog {
  try {
    const raw = fs.readFileSync(resolveLogFile(), "utf8");
    return JSON.parse(raw) as EvolutionLog;
  } catch {
    return { proposals: [], lastRunAt: 0, totalProposed: 0, totalMerged: 0, totalRejected: 0 };
  }
}

function writeLog(logData: EvolutionLog): void {
  const dir = resolveEvolutionDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(resolveLogFile(), `${JSON.stringify(logData, null, 2)}\n`, { mode: 0o600 });
}

// ---------------------------------------------------------------------------
// Proposal creation
// ---------------------------------------------------------------------------

/**
 * Create an evolution proposal.
 * The agent describes what it wants to change and why.
 */
export function createProposal(
  agentId: string,
  agentName: string,
  type: EvolutionType,
  title: string,
  description: string,
  filesChanged: string[],
): EvolutionProposal {
  const id = `evo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const branch = `evolution/${agentName.toLowerCase().replace(/\s+/g, "-")}/${id}`;

  const proposal: EvolutionProposal = {
    id,
    agentId,
    agentName,
    type,
    title,
    description,
    filesChanged,
    branch,
    createdAt: Date.now(),
    status: "proposed",
  };

  const logData = readLog();
  logData.proposals.push(proposal);
  logData.totalProposed++;
  logData.lastRunAt = Date.now();
  writeLog(logData);

  log.info(`evolution proposed by ${agentName}: "${title}" (${type})`);
  return proposal;
}

// ---------------------------------------------------------------------------
// Review
// ---------------------------------------------------------------------------

/**
 * Review a proposal (by another agent).
 */
export function reviewProposal(
  proposalId: string,
  reviewer: string,
  approved: boolean,
  notes?: string,
): EvolutionProposal | null {
  const logData = readLog();
  const proposal = logData.proposals.find((p) => p.id === proposalId);
  if (!proposal) {
    return null;
  }

  proposal.status = approved ? "approved" : "rejected";
  proposal.reviewer = reviewer;
  proposal.reviewNotes = notes;
  proposal.reviewedAt = Date.now();

  if (!approved) {
    logData.totalRejected++;
  }

  writeLog(logData);
  log.info(`evolution ${approved ? "approved" : "rejected"} by ${reviewer}: "${proposal.title}"`);
  return proposal;
}

/**
 * Mark a proposal as merged.
 */
export function markMerged(proposalId: string, commitHash: string): EvolutionProposal | null {
  const logData = readLog();
  const proposal = logData.proposals.find((p) => p.id === proposalId);
  if (!proposal) {
    return null;
  }

  proposal.status = "merged";
  proposal.commitHash = commitHash;
  proposal.mergedAt = Date.now();
  logData.totalMerged++;

  writeLog(logData);
  log.info(`evolution merged: "${proposal.title}" (${commitHash})`);
  return proposal;
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

export function getEvolutionLog(): EvolutionLog {
  return readLog();
}

export function getPendingProposals(): EvolutionProposal[] {
  return readLog().proposals.filter((p) => p.status === "proposed" || p.status === "approved");
}

export function getProposalsByAgent(agentName: string): EvolutionProposal[] {
  return readLog().proposals.filter((p) => p.agentName === agentName);
}

/**
 * Check if an agent has met its daily evolution quota.
 */
export function hasMetDailyQuota(agentName: string): boolean {
  const today = new Date().toISOString().slice(0, 10);
  const proposals = getProposalsByAgent(agentName);
  return proposals.some((p) => {
    const proposalDate = new Date(p.createdAt).toISOString().slice(0, 10);
    return proposalDate === today;
  });
}

/**
 * Get evolution stats for the team.
 */
export function getEvolutionStats(): {
  totalProposed: number;
  totalMerged: number;
  totalRejected: number;
  pending: number;
  agentContributions: Record<string, number>;
} {
  const logData = readLog();
  const agentContributions: Record<string, number> = {};

  for (const p of logData.proposals) {
    agentContributions[p.agentName] = (agentContributions[p.agentName] ?? 0) + 1;
  }

  return {
    totalProposed: logData.totalProposed,
    totalMerged: logData.totalMerged,
    totalRejected: logData.totalRejected,
    pending: logData.proposals.filter((p) => p.status === "proposed" || p.status === "approved")
      .length,
    agentContributions,
  };
}
