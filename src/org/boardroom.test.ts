/**
 * Tests for Boardroom — structured decision-making for orgs.
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

import {
  createSession,
  startSession,
  joinSession,
  concludeSession,
  addDecision,
  createProposal,
  castVote,
  resolveProposalVote,
  listSessions,
  listProposals,
  getSession,
  getProposal,
} from "./boardroom.js";

describe("Boardroom", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "anima-boardroom-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("sessions", () => {
    it("creates a scheduled session", () => {
      const session = createSession("org-1", "sylys", "Sprint Planning", "Plan next sprint");
      expect(session.id).toMatch(/^session-/);
      expect(session.status).toBe("scheduled");
      expect(session.calledBy).toBe("sylys");
      expect(session.participants).toEqual([]);
      expect(session.decisions).toEqual([]);
    });

    it("starts a session", () => {
      const session = createSession("org-1", "sylys", "Meeting", "");
      const started = startSession(session.id, "sylys");
      expect(started).not.toBeNull();
      expect(started!.status).toBe("active");
      expect(started!.startedAt).toBeGreaterThan(0);
    });

    it("returns null starting nonexistent session", () => {
      expect(startSession("nope", "user")).toBeNull();
    });

    it("joins a session", () => {
      const session = createSession("org-1", "sylys", "Meeting", "");
      startSession(session.id, "sylys");
      const joined = joinSession(session.id, "axiom", "Axiom", "agent");
      expect(joined).not.toBeNull();
      expect(joined!.participants.some((p) => p.displayName === "Axiom")).toBe(true);
    });

    it("concludes a session with minutes", () => {
      const session = createSession("org-1", "sylys", "Meeting", "");
      startSession(session.id, "sylys");
      const concluded = concludeSession(session.id, "We decided to ship v7.");
      expect(concluded).not.toBeNull();
      expect(concluded!.status).toBe("concluded");
      expect(concluded!.minutes).toBe("We decided to ship v7.");
      expect(concluded!.concludedAt).toBeGreaterThan(0);
    });

    it("lists sessions for an org", () => {
      createSession("org-1", "a", "S1", "");
      createSession("org-1", "b", "S2", "");
      createSession("org-2", "c", "S3", "");

      const org1Sessions = listSessions("org-1");
      expect(org1Sessions).toHaveLength(2);
    });

    it("filters sessions by status", () => {
      const s = createSession("org-1", "a", "Active", "");
      startSession(s.id, "a");
      createSession("org-1", "b", "Scheduled", "");

      const active = listSessions("org-1", "active");
      expect(active).toHaveLength(1);
      expect(active[0].title).toBe("Active");
    });

    it("retrieves session by ID", () => {
      const session = createSession("org-1", "sylys", "Get me", "");
      const retrieved = getSession(session.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.title).toBe("Get me");
    });
  });

  describe("decisions", () => {
    it("adds a decision to a session", () => {
      const session = createSession("org-1", "sylys", "Meeting", "");
      startSession(session.id, "sylys");
      const updated = addDecision(session.id, "Ship v7 today", "All tests pass", "sylys");
      expect(updated).not.toBeNull();
      expect(updated!.decisions).toHaveLength(1);
      expect(updated!.decisions[0].title).toBe("Ship v7 today");
    });
  });

  describe("proposals", () => {
    it("creates a proposal", () => {
      const proposal = createProposal(
        "org-1",
        "axiom",
        "Add ego system",
        "Agents need a self-model",
      );
      expect(proposal.id).toMatch(/^proposal-/);
      expect(proposal.status).toBe("open");
      expect(proposal.votes).toEqual([]);
    });

    it("casts a vote on a proposal", () => {
      const proposal = createProposal("org-1", "axiom", "Vote on me", "");
      const voted = castVote(proposal.id, "sylys", "Sylys", "approve", "Great idea");
      expect(voted).not.toBeNull();
      expect(voted!.votes).toHaveLength(1);
      expect(voted!.votes[0].voterId).toBe("sylys");
      expect(voted!.votes[0].value).toBe("approve");
    });

    it("replaces previous vote from same voter", () => {
      const proposal = createProposal("org-1", "axiom", "Change mind", "");
      castVote(proposal.id, "sylys", "Sylys", "reject");
      const changed = castVote(proposal.id, "sylys", "Sylys", "approve");
      expect(changed!.votes).toHaveLength(1);
      expect(changed!.votes[0].value).toBe("approve");
    });

    it("resolves proposal (majority approve)", () => {
      const proposal = createProposal("org-1", "axiom", "Resolve me", "");
      castVote(proposal.id, "sylys", "Sylys", "approve");
      castVote(proposal.id, "nox", "Nox", "approve");
      castVote(proposal.id, "yash", "Yash", "reject");

      const resolved = resolveProposalVote(proposal.id);
      expect(resolved).not.toBeNull();
      expect(resolved!.status).toBe("passed");
    });

    it("resolves proposal (majority reject)", () => {
      const proposal = createProposal("org-1", "axiom", "Reject me", "");
      castVote(proposal.id, "a", "A", "reject");
      castVote(proposal.id, "b", "B", "reject");
      castVote(proposal.id, "c", "C", "approve");

      const resolved = resolveProposalVote(proposal.id);
      expect(resolved!.status).toBe("rejected");
    });

    it("lists proposals for an org", () => {
      createProposal("org-1", "a", "P1", "");
      createProposal("org-1", "b", "P2", "");

      expect(listProposals("org-1")).toHaveLength(2);
    });

    it("filters proposals by status", () => {
      const p = createProposal("org-1", "a", "Resolve me", "");
      castVote(p.id, "voter", "Voter", "approve");
      resolveProposalVote(p.id);
      createProposal("org-1", "b", "Still open", "");

      const open = listProposals("org-1", "open");
      expect(open).toHaveLength(1);
      expect(open[0].title).toBe("Still open");
    });

    it("retrieves proposal by ID", () => {
      const proposal = createProposal("org-1", "axiom", "Find me", "");
      expect(getProposal(proposal.id)!.title).toBe("Find me");
    });

    it("returns null for nonexistent proposal", () => {
      expect(getProposal("nonexistent")).toBeNull();
    });
  });
});
