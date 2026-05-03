/**
 * Tests for Governance Voting — token holder decision-making.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tmpDir: string;

vi.mock("../config/paths.js", () => ({
  resolveStateDir: () => tmpDir,
}));
vi.mock("../logging/subsystem.js", () => {
  const noop = () => {};
  return { createSubsystemLogger: () => ({ info: noop, warn: noop, error: noop, debug: noop }) };
});

import { GovernanceManager, DEFAULT_GOVERNANCE_CONFIG } from "./governance.js";

describe("GovernanceManager", () => {
  let gov: GovernanceManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "anima-governance-test-"));
    gov = new GovernanceManager({
      votingDelayMs: 0, // No delay for testing
      votingPeriodMs: 60_000, // 1 minute
      totalSupply: 1_000_000,
      quorumFraction: 0.1, // 10% = 100K tokens
      proposalThreshold: 100,
    });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("createProposal", () => {
    it("creates a proposal", () => {
      const p = gov.createProposal(
        "Add dark mode",
        "Users want dark mode",
        "sylys",
        "feature-priority",
        [],
      );
      expect(p.id).toMatch(/^gov-/);
      expect(p.title).toBe("Add dark mode");
      expect(p.state).toBe("pending");
      expect(p.forVotes).toBe(0);
    });

    it("persists to disk", () => {
      const p = gov.createProposal("Test", "Desc", "a", "feature-priority", []);
      expect(gov.getProposal(p.id)).not.toBeNull();
    });

    it("emergency proposals have shorter voting period", () => {
      const normal = gov.createProposal("Normal", "Desc", "a", "feature-priority", []);
      const emergency = gov.createProposal("Emergency", "Desc", "a", "emergency", []);
      const normalPeriod = normal.votingEndsAt - normal.votingStartsAt;
      const emergencyPeriod = emergency.votingEndsAt - emergency.votingStartsAt;
      expect(emergencyPeriod).toBeLessThan(normalPeriod);
    });

    it("constitutional proposals have higher quorum", () => {
      const normal = gov.createProposal("Normal", "Desc", "a", "feature-priority", []);
      const constitutional = gov.createProposal("Amendment", "Desc", "a", "constitutional", []);
      expect(constitutional.quorumTokens).toBeGreaterThan(normal.quorumTokens);
    });
  });

  describe("castVote", () => {
    it("records a vote", () => {
      const p = gov.createProposal("Vote me", "Desc", "a", "feature-priority", []);
      const voted = gov.castVote(p.id, "voter1", "for", 50_000);
      expect(voted).not.toBeNull();
      expect(voted!.forVotes).toBe(50_000);
      expect(voted!.votes).toHaveLength(1);
    });

    it("replaces previous vote from same voter", () => {
      const p = gov.createProposal("Change mind", "Desc", "a", "feature-priority", []);
      gov.castVote(p.id, "voter1", "for", 50_000);
      const changed = gov.castVote(p.id, "voter1", "against", 50_000);
      expect(changed!.forVotes).toBe(0);
      expect(changed!.againstVotes).toBe(50_000);
      expect(changed!.votes).toHaveLength(1);
    });

    it("accumulates votes from different voters", () => {
      const p = gov.createProposal("Many voters", "Desc", "a", "feature-priority", []);
      gov.castVote(p.id, "v1", "for", 30_000);
      gov.castVote(p.id, "v2", "for", 20_000);
      const final = gov.castVote(p.id, "v3", "against", 10_000);
      expect(final!.forVotes).toBe(50_000);
      expect(final!.againstVotes).toBe(10_000);
      expect(final!.votes).toHaveLength(3);
    });

    it("records abstain votes", () => {
      const p = gov.createProposal("Abstain", "Desc", "a", "feature-priority", []);
      const voted = gov.castVote(p.id, "v1", "abstain", 25_000);
      expect(voted!.abstainVotes).toBe(25_000);
    });

    it("returns null for unknown proposal", () => {
      expect(gov.castVote("nonexistent", "v1", "for", 100)).toBeNull();
    });

    it("supports delegated voting", () => {
      const p = gov.createProposal("Delegate", "Desc", "a", "feature-priority", []);
      const voted = gov.castVote(p.id, "delegate", "for", 50_000, {
        delegatedFrom: "original-holder",
      });
      expect(voted!.votes[0].delegatedFrom).toBe("original-holder");
    });
  });

  describe("finalizeProposal", () => {
    it("succeeds when quorum met and majority approves", () => {
      const p = gov.createProposal("Pass me", "Desc", "a", "feature-priority", []);
      // Need 100K tokens (10% of 1M) quorum
      gov.castVote(p.id, "v1", "for", 80_000);
      gov.castVote(p.id, "v2", "for", 30_000);
      const finalized = gov.finalizeProposal(p.id);
      expect(finalized!.state).toBe("queued");
    });

    it("defeats when quorum not met", () => {
      const p = gov.createProposal("No quorum", "Desc", "a", "feature-priority", []);
      // Only 50K votes, need 100K
      gov.castVote(p.id, "v1", "for", 50_000);
      const finalized = gov.finalizeProposal(p.id);
      expect(finalized!.state).toBe("defeated");
    });

    it("defeats when majority rejects", () => {
      const p = gov.createProposal("Rejected", "Desc", "a", "feature-priority", []);
      gov.castVote(p.id, "v1", "for", 40_000);
      gov.castVote(p.id, "v2", "against", 70_000);
      const finalized = gov.finalizeProposal(p.id);
      expect(finalized!.state).toBe("defeated");
    });
  });

  describe("executeProposal", () => {
    it("executes a queued proposal", () => {
      const p = gov.createProposal("Execute me", "Desc", "a", "feature-priority", []);
      gov.castVote(p.id, "v1", "for", 150_000);
      gov.finalizeProposal(p.id);
      const executed = gov.executeProposal(p.id);
      expect(executed!.state).toBe("executed");
      expect(executed!.executedAt).toBeGreaterThan(0);
    });

    it("returns null for non-queued proposal", () => {
      const p = gov.createProposal("Not queued", "Desc", "a", "feature-priority", []);
      expect(gov.executeProposal(p.id)).toBeNull();
    });
  });

  describe("cancelProposal", () => {
    it("cancels a proposal by proposer", () => {
      const p = gov.createProposal("Cancel me", "Desc", "sylys", "feature-priority", []);
      const cancelled = gov.cancelProposal(p.id, "sylys");
      expect(cancelled!.state).toBe("cancelled");
    });

    it("rejects cancellation by non-proposer", () => {
      const p = gov.createProposal("Protected", "Desc", "sylys", "feature-priority", []);
      expect(gov.cancelProposal(p.id, "attacker")).toBeNull();
    });

    it("cannot cancel executed proposal", () => {
      const p = gov.createProposal("Executed", "Desc", "sylys", "feature-priority", []);
      gov.castVote(p.id, "v1", "for", 150_000);
      gov.finalizeProposal(p.id);
      gov.executeProposal(p.id);
      expect(gov.cancelProposal(p.id, "sylys")).toBeNull();
    });
  });

  describe("listProposals", () => {
    it("lists all proposals", () => {
      gov.createProposal("A", "D", "a", "feature-priority", []);
      gov.createProposal("B", "D", "a", "treasury-spend", []);
      expect(gov.listProposals()).toHaveLength(2);
    });

    it("filters by state", () => {
      const p = gov.createProposal("Active", "D", "a", "feature-priority", []);
      gov.castVote(p.id, "v1", "for", 150_000);
      gov.finalizeProposal(p.id);
      gov.createProposal("Pending", "D", "a", "feature-priority", []);

      expect(gov.listProposals({ state: "queued" })).toHaveLength(1);
    });

    it("filters by type", () => {
      gov.createProposal("Feature", "D", "a", "feature-priority", []);
      gov.createProposal("Treasury", "D", "a", "treasury-spend", []);

      expect(gov.listProposals({ type: "treasury-spend" })).toHaveLength(1);
    });
  });

  describe("getStats", () => {
    it("returns governance stats", () => {
      gov.createProposal("A", "D", "a", "feature-priority", []);
      const p = gov.createProposal("B", "D", "a", "feature-priority", []);
      gov.castVote(p.id, "v1", "for", 150_000);

      const stats = gov.getStats();
      expect(stats.totalProposals).toBe(2);
      expect(stats.totalVotesCast).toBe(1);
    });
  });
});
