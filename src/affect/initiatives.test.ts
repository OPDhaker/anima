/**
 * Tests for Initiative Proposals — agents proposing ideas.
 * Wish #37: "I think we should..." as a formal process.
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
  proposeInitiative,
  getInitiative,
  listInitiatives,
  voteOnInitiative,
  commentOnInitiative,
  updateInitiativeStatus,
} from "./initiatives.js";

describe("Initiatives", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "anima-initiatives-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("proposeInitiative", () => {
    it("creates a proposal with defaults", () => {
      const init = proposeInitiative(
        "Add dark mode to BYND",
        "Users want dark mode for late-night browsing",
        "Axiom",
      );
      expect(init.title).toBe("Add dark mode to BYND");
      expect(init.proposedBy).toBe("Axiom");
      expect(init.status).toBe("proposed");
      expect(init.priority).toBe("medium");
      expect(init.effort).toBe("medium");
      expect(init.approvers).toEqual(["sylys"]);
      expect(init.votes).toEqual([]);
    });

    it("accepts all options", () => {
      const init = proposeInitiative("SVRN chain launch", "Time to launch mainnet", "Nox", {
        rationale: "We have 7 nodes ready",
        scope: ["deploy", "monitor", "docs"],
        effort: "epic",
        priority: "critical",
        approvers: ["sylys", "axiom"],
      });
      expect(init.priority).toBe("critical");
      expect(init.effort).toBe("epic");
      expect(init.scope).toHaveLength(3);
      expect(init.approvers).toEqual(["sylys", "axiom"]);
    });

    it("persists to disk", () => {
      const init = proposeInitiative("Test", "Desc", "Agent");
      const file = path.join(tmpDir, "initiatives", `${init.id}.json`);
      expect(fs.existsSync(file)).toBe(true);
    });
  });

  describe("getInitiative", () => {
    it("retrieves by ID", () => {
      const init = proposeInitiative("Get me", "Please", "Axiom");
      const retrieved = getInitiative(init.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.title).toBe("Get me");
    });

    it("returns null for unknown ID", () => {
      expect(getInitiative("nonexistent")).toBeNull();
    });
  });

  describe("listInitiatives", () => {
    it("lists all initiatives", () => {
      proposeInitiative("A", "desc", "Axiom");
      proposeInitiative("B", "desc", "Nox");
      expect(listInitiatives()).toHaveLength(2);
    });

    it("filters by status", () => {
      const init = proposeInitiative("Filter me", "desc", "Axiom");
      updateInitiativeStatus(init.id, "approved");
      proposeInitiative("Keep me", "desc", "Axiom");

      const proposed = listInitiatives({ status: "proposed" });
      expect(proposed).toHaveLength(1);
      expect(proposed[0].title).toBe("Keep me");
    });

    it("filters by proposedBy", () => {
      proposeInitiative("By Axiom", "desc", "Axiom");
      proposeInitiative("By Nox", "desc", "Nox");

      const byAxiom = listInitiatives({ proposedBy: "Axiom" });
      expect(byAxiom).toHaveLength(1);
      expect(byAxiom[0].proposedBy).toBe("Axiom");
    });

    it("returns sorted by proposedAt descending", () => {
      proposeInitiative("First", "desc", "A");
      proposeInitiative("Second", "desc", "A");
      const all = listInitiatives();
      expect(all[0].proposedAt).toBeGreaterThanOrEqual(all[1].proposedAt);
    });

    it("returns empty for no initiatives", () => {
      expect(listInitiatives()).toEqual([]);
    });
  });

  describe("voteOnInitiative", () => {
    it("records a vote", () => {
      const init = proposeInitiative("Vote on me", "desc", "Axiom");
      const voted = voteOnInitiative(init.id, "sylys", "approve", "Good idea");
      expect(voted).not.toBeNull();
      expect(voted!.votes).toHaveLength(1);
      expect(voted!.votes[0].voter).toBe("sylys");
      expect(voted!.votes[0].vote).toBe("approve");
    });

    it("auto-approves when enough approvals", () => {
      const init = proposeInitiative("Auto-approve", "desc", "Axiom", {
        approvers: ["sylys"],
      });
      const voted = voteOnInitiative(init.id, "sylys", "approve");
      expect(voted!.status).toBe("approved");
    });

    it("auto-rejects when enough rejections", () => {
      const init = proposeInitiative("Auto-reject", "desc", "Axiom", {
        approvers: ["sylys"],
      });
      const voted = voteOnInitiative(init.id, "sylys", "reject", "Not now");
      expect(voted!.status).toBe("rejected");
    });

    it("moves to under-review on partial votes", () => {
      const init = proposeInitiative("Partial", "desc", "Axiom", {
        approvers: ["sylys", "nox"],
      });
      const voted = voteOnInitiative(init.id, "sylys", "approve");
      expect(voted!.status).toBe("under-review");
    });

    it("replaces previous vote from same voter", () => {
      const init = proposeInitiative("Change mind", "desc", "Axiom");
      voteOnInitiative(init.id, "sylys", "reject");
      const changed = voteOnInitiative(init.id, "sylys", "approve");
      expect(changed!.votes).toHaveLength(1);
      expect(changed!.votes[0].vote).toBe("approve");
    });

    it("returns null for unknown initiative", () => {
      expect(voteOnInitiative("nonexistent", "sylys", "approve")).toBeNull();
    });
  });

  describe("commentOnInitiative", () => {
    it("adds a comment", () => {
      const init = proposeInitiative("Comment me", "desc", "Axiom");
      const commented = commentOnInitiative(init.id, "Nox", "Great idea!");
      expect(commented!.discussion).toHaveLength(1);
      expect(commented!.discussion[0].author).toBe("Nox");
      expect(commented!.discussion[0].content).toBe("Great idea!");
    });

    it("accumulates comments", () => {
      const init = proposeInitiative("Many comments", "desc", "Axiom");
      commentOnInitiative(init.id, "A", "First");
      commentOnInitiative(init.id, "B", "Second");
      const result = commentOnInitiative(init.id, "C", "Third");
      expect(result!.discussion).toHaveLength(3);
    });

    it("returns null for unknown initiative", () => {
      expect(commentOnInitiative("nonexistent", "A", "comment")).toBeNull();
    });
  });

  describe("updateInitiativeStatus", () => {
    it("updates status", () => {
      const init = proposeInitiative("Update me", "desc", "Axiom");
      const updated = updateInitiativeStatus(init.id, "implementing", {
        implementedBy: "Axiom",
      });
      expect(updated!.status).toBe("implementing");
      expect(updated!.implementedBy).toBe("Axiom");
    });

    it("sets implementedAt on completion", () => {
      const init = proposeInitiative("Complete me", "desc", "Axiom");
      const completed = updateInitiativeStatus(init.id, "completed", {
        outcome: "Shipped successfully",
      });
      expect(completed!.implementedAt).toBeGreaterThan(0);
      expect(completed!.outcome).toBe("Shipped successfully");
    });

    it("returns null for unknown initiative", () => {
      expect(updateInitiativeStatus("nonexistent", "approved")).toBeNull();
    });
  });
});
