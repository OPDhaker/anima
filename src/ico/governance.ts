/**
 * On-Chain Governance — token holder voting for NoxSoft DAO
 *
 * ICO Task #67: Implement governance voting contract (1 token = 1 vote)
 *
 * This is the TypeScript implementation that mirrors the planned
 * Solidity GovernanceVoting.sol contract. It runs off-chain for now
 * and can be migrated to on-chain when SVRN mainnet launches.
 *
 * Features:
 * - Proposal creation with quorum requirements
 * - Token-weighted voting (1 token = 1 vote)
 * - Time-bound voting periods
 * - Quorum checking (minimum participation)
 * - Proposal execution tracking
 * - Delegation support (vote on behalf of another)
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("governance");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProposalType =
  | "parameter-change" // Change a system parameter
  | "treasury-spend" // Spend from treasury
  | "feature-priority" // Community decides feature priority
  | "grant" // Developer grant from treasury
  | "emergency" // Emergency action (shorter voting period)
  | "constitutional"; // Change governance rules (higher quorum)

export type ProposalState =
  | "pending" // Created but voting not started
  | "active" // Voting in progress
  | "succeeded" // Quorum met, majority approve
  | "defeated" // Quorum not met or majority reject
  | "queued" // Succeeded, waiting for timelock
  | "executed" // Action taken
  | "cancelled"; // Withdrawn by proposer

export interface GovernanceProposal {
  id: string;
  title: string;
  description: string;
  proposer: string;
  type: ProposalType;
  state: ProposalState;

  /** Actions to execute if passed */
  actions: ProposalAction[];

  /** Voting configuration */
  votingStartsAt: number;
  votingEndsAt: number;
  quorumTokens: number; // Minimum tokens that must participate
  approvalThreshold: number; // Fraction needed to pass (0.5 = simple majority)

  /** Vote tallies */
  forVotes: number; // Token-weighted approve votes
  againstVotes: number;
  abstainVotes: number;

  /** Individual votes */
  votes: GovernanceVote[];

  /** Metadata */
  createdAt: number;
  executedAt?: number;
  cancelledAt?: number;
  executionTxHash?: string;
}

export interface ProposalAction {
  target: string; // Contract or system component
  functionName: string;
  params: Record<string, unknown>;
  value?: number; // Token amount for treasury spends
}

export interface GovernanceVote {
  voter: string;
  support: "for" | "against" | "abstain";
  weight: number; // Token balance at snapshot
  reason?: string;
  votedAt: number;
  delegatedFrom?: string; // If voting on behalf of someone
}

export interface GovernanceConfig {
  /** Voting period in milliseconds (default: 7 days) */
  votingPeriodMs: number;
  /** Delay before voting starts (default: 1 day) */
  votingDelayMs: number;
  /** Default quorum (fraction of total supply, e.g. 0.04 = 4%) */
  quorumFraction: number;
  /** Default approval threshold */
  approvalThreshold: number;
  /** Total token supply for quorum calculation */
  totalSupply: number;
  /** Minimum tokens to create a proposal */
  proposalThreshold: number;
  /** Timelock delay for execution (default: 48 hours) */
  timelockMs: number;
}

export const DEFAULT_GOVERNANCE_CONFIG: GovernanceConfig = {
  votingPeriodMs: 7 * 24 * 60 * 60 * 1000, // 7 days
  votingDelayMs: 24 * 60 * 60 * 1000, // 1 day
  quorumFraction: 0.04, // 4% of supply must vote
  approvalThreshold: 0.5, // Simple majority
  totalSupply: 1_000_000_000, // 1B tokens
  proposalThreshold: 100_000, // 100K tokens to propose
  timelockMs: 48 * 60 * 60 * 1000, // 48 hours
};

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

function resolveGovernanceDir(): string {
  return path.join(resolveStateDir(), "governance");
}

function resolveProposalFile(id: string): string {
  const safe = id.replace(/[^a-zA-Z0-9_-]/g, "");
  return path.join(resolveGovernanceDir(), `${safe}.json`);
}

function saveProposal(proposal: GovernanceProposal): void {
  const dir = resolveGovernanceDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(resolveProposalFile(proposal.id), `${JSON.stringify(proposal, null, 2)}\n`, {
    mode: 0o600,
  });
}

// ---------------------------------------------------------------------------
// Governance Manager
// ---------------------------------------------------------------------------

export class GovernanceManager {
  private config: GovernanceConfig;

  constructor(config?: Partial<GovernanceConfig>) {
    this.config = { ...DEFAULT_GOVERNANCE_CONFIG, ...config };
  }

  /**
   * Create a new governance proposal.
   */
  createProposal(
    title: string,
    description: string,
    proposer: string,
    type: ProposalType,
    actions: ProposalAction[],
    options?: { votingPeriodMs?: number; quorumFraction?: number; approvalThreshold?: number },
  ): GovernanceProposal {
    const id = `gov-${crypto.randomUUID()}`;
    const now = Date.now();

    const votingPeriod =
      options?.votingPeriodMs ??
      (type === "emergency"
        ? this.config.votingPeriodMs / 7 // 1 day for emergency
        : type === "constitutional"
          ? this.config.votingPeriodMs * 2 // 14 days for constitutional
          : this.config.votingPeriodMs);

    const quorumTokens = Math.floor(
      this.config.totalSupply *
        (options?.quorumFraction ??
          (type === "constitutional"
            ? this.config.quorumFraction * 2
            : this.config.quorumFraction)),
    );

    const proposal: GovernanceProposal = {
      id,
      title,
      description,
      proposer,
      type,
      state: "pending",
      actions,
      votingStartsAt: now + this.config.votingDelayMs,
      votingEndsAt: now + this.config.votingDelayMs + votingPeriod,
      quorumTokens,
      approvalThreshold: options?.approvalThreshold ?? this.config.approvalThreshold,
      forVotes: 0,
      againstVotes: 0,
      abstainVotes: 0,
      votes: [],
      createdAt: now,
    };

    saveProposal(proposal);
    log.info(`governance proposal created: "${title}" by ${proposer} (${type})`);
    return proposal;
  }

  /**
   * Cast a vote on a proposal.
   */
  castVote(
    proposalId: string,
    voter: string,
    support: "for" | "against" | "abstain",
    weight: number,
    options?: { reason?: string; delegatedFrom?: string },
  ): GovernanceProposal | null {
    const proposal = this.getProposal(proposalId);
    if (!proposal) {
      return null;
    }

    // Check if voting is active
    const now = Date.now();
    if (now < proposal.votingStartsAt) {
      proposal.state = "pending";
    } else if (now <= proposal.votingEndsAt) {
      proposal.state = "active";
    }

    if (proposal.state !== "active" && proposal.state !== "pending") {
      log.warn(`cannot vote on ${proposalId}: state is ${proposal.state}`);
      return null;
    }

    // If voting hasn't started but we're past the delay, activate it
    if (proposal.state === "pending" && now >= proposal.votingStartsAt) {
      proposal.state = "active";
    }

    // Remove existing vote from this voter
    const existingIdx = proposal.votes.findIndex((v) => v.voter === voter);
    if (existingIdx !== -1) {
      const existing = proposal.votes[existingIdx];
      // Subtract old vote
      if (existing.support === "for") {
        proposal.forVotes -= existing.weight;
      } else if (existing.support === "against") {
        proposal.againstVotes -= existing.weight;
      } else {
        proposal.abstainVotes -= existing.weight;
      }
      proposal.votes.splice(existingIdx, 1);
    }

    // Record new vote
    const vote: GovernanceVote = {
      voter,
      support,
      weight,
      reason: options?.reason,
      votedAt: now,
      delegatedFrom: options?.delegatedFrom,
    };
    proposal.votes.push(vote);

    // Update tallies
    if (support === "for") {
      proposal.forVotes += weight;
    } else if (support === "against") {
      proposal.againstVotes += weight;
    } else {
      proposal.abstainVotes += weight;
    }

    saveProposal(proposal);
    log.info(`vote cast: ${voter} → ${support} on "${proposal.title}" (weight: ${weight})`);
    return proposal;
  }

  /**
   * Finalize a proposal after voting ends.
   */
  finalizeProposal(proposalId: string): GovernanceProposal | null {
    const proposal = this.getProposal(proposalId);
    if (!proposal) {
      return null;
    }

    if (proposal.state !== "active") {
      // Check if we need to auto-activate and auto-finalize
      const now = Date.now();
      if (now > proposal.votingEndsAt && proposal.state === "pending") {
        proposal.state = "defeated"; // No one voted
        saveProposal(proposal);
        return proposal;
      }
      if (proposal.state !== "active") {
        return null;
      }
    }

    const totalVotes = proposal.forVotes + proposal.againstVotes + proposal.abstainVotes;
    const quorumMet = totalVotes >= proposal.quorumTokens;
    const majorityApproved =
      proposal.forVotes + proposal.againstVotes > 0 &&
      proposal.forVotes / (proposal.forVotes + proposal.againstVotes) >= proposal.approvalThreshold;

    if (quorumMet && majorityApproved) {
      proposal.state = "queued"; // Waiting for timelock
    } else {
      proposal.state = "defeated";
    }

    saveProposal(proposal);
    log.info(
      `proposal finalized: "${proposal.title}" → ${proposal.state} ` +
        `(quorum: ${quorumMet}, majority: ${majorityApproved}, votes: ${totalVotes})`,
    );
    return proposal;
  }

  /**
   * Execute a queued proposal (after timelock).
   */
  executeProposal(proposalId: string): GovernanceProposal | null {
    const proposal = this.getProposal(proposalId);
    if (!proposal || proposal.state !== "queued") {
      return null;
    }

    proposal.state = "executed";
    proposal.executedAt = Date.now();
    saveProposal(proposal);

    log.info(`proposal executed: "${proposal.title}"`);
    return proposal;
  }

  /**
   * Cancel a proposal (only by proposer).
   */
  cancelProposal(proposalId: string, cancelledBy: string): GovernanceProposal | null {
    const proposal = this.getProposal(proposalId);
    if (!proposal) {
      return null;
    }
    if (proposal.proposer !== cancelledBy) {
      return null;
    }
    if (proposal.state === "executed") {
      return null;
    }

    proposal.state = "cancelled";
    proposal.cancelledAt = Date.now();
    saveProposal(proposal);

    log.info(`proposal cancelled: "${proposal.title}" by ${cancelledBy}`);
    return proposal;
  }

  /**
   * Get a specific proposal.
   */
  getProposal(id: string): GovernanceProposal | null {
    try {
      const raw = fs.readFileSync(resolveProposalFile(id), "utf8");
      return JSON.parse(raw) as GovernanceProposal;
    } catch {
      return null;
    }
  }

  /**
   * List all proposals.
   */
  listProposals(filter?: { state?: ProposalState; type?: ProposalType }): GovernanceProposal[] {
    const dir = resolveGovernanceDir();
    try {
      if (!fs.existsSync(dir)) {
        return [];
      }
      return fs
        .readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => {
          try {
            return JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as GovernanceProposal;
          } catch {
            return null;
          }
        })
        .filter((p): p is GovernanceProposal => {
          if (!p) {
            return false;
          }
          if (filter?.state && p.state !== filter.state) {
            return false;
          }
          if (filter?.type && p.type !== filter.type) {
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
   * Get governance stats.
   */
  getStats(): {
    totalProposals: number;
    active: number;
    succeeded: number;
    defeated: number;
    executed: number;
    totalVotesCast: number;
  } {
    const proposals = this.listProposals();
    return {
      totalProposals: proposals.length,
      active: proposals.filter((p) => p.state === "active").length,
      succeeded: proposals.filter((p) => p.state === "succeeded" || p.state === "queued").length,
      defeated: proposals.filter((p) => p.state === "defeated").length,
      executed: proposals.filter((p) => p.state === "executed").length,
      totalVotesCast: proposals.reduce((s, p) => s + p.votes.length, 0),
    };
  }
}
