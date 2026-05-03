/**
 * Tests for Agent-to-Agent Task Delegation Protocol.
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
  delegateTask,
  acceptDelegation,
  rejectDelegation,
  startDelegation,
  completeDelegation,
  escalateDelegation,
  getDelegation,
  listDelegations,
  getDelegationStats,
} from "./delegation.js";

describe("Task Delegation", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "anima-delegation-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("delegateTask", () => {
    it("creates a delegation request", () => {
      const d = delegateTask("Axiom", "Guardian", "Security audit", "Review auth flow");
      expect(d.id).toMatch(/^del-/);
      expect(d.delegator).toBe("Axiom");
      expect(d.delegatee).toBe("Guardian");
      expect(d.status).toBe("pending");
    });

    it("accepts all options", () => {
      const d = delegateTask("Axiom", "Builder", "Ship feature", "Build dark mode", {
        reason: "specialization",
        priority: "high",
        deadline: Date.now() + 3600000,
        context: ["ui/theme.tsx", "docs/design.md"],
        deliverables: ["PR link", "Test results"],
      });
      expect(d.priority).toBe("high");
      expect(d.reason).toBe("specialization");
      expect(d.context).toHaveLength(2);
      expect(d.deliverables).toHaveLength(2);
    });
  });

  describe("acceptDelegation", () => {
    it("accepts a pending delegation", () => {
      const d = delegateTask("A", "B", "Task", "Desc");
      const accepted = acceptDelegation(d.id, "On it!");
      expect(accepted!.status).toBe("accepted");
      expect(accepted!.response!.message).toBe("On it!");
      expect(accepted!.response!.acceptedAt).toBeGreaterThan(0);
    });

    it("returns null for non-pending", () => {
      const d = delegateTask("A", "B", "Task", "Desc");
      acceptDelegation(d.id);
      expect(acceptDelegation(d.id)).toBeNull(); // already accepted
    });
  });

  describe("rejectDelegation", () => {
    it("rejects with reason", () => {
      const d = delegateTask("A", "B", "Task", "Desc");
      const rejected = rejectDelegation(d.id, "Too busy");
      expect(rejected!.status).toBe("rejected");
      expect(rejected!.response!.rejectionReason).toBe("Too busy");
    });
  });

  describe("startDelegation", () => {
    it("transitions accepted to in-progress", () => {
      const d = delegateTask("A", "B", "Task", "Desc");
      acceptDelegation(d.id);
      const started = startDelegation(d.id);
      expect(started!.status).toBe("in-progress");
    });

    it("returns null if not accepted", () => {
      const d = delegateTask("A", "B", "Task", "Desc");
      expect(startDelegation(d.id)).toBeNull();
    });
  });

  describe("completeDelegation", () => {
    it("completes with notes and deliverables", () => {
      const d = delegateTask("A", "B", "Task", "Desc");
      acceptDelegation(d.id);
      const completed = completeDelegation(d.id, "Done!", ["https://github.com/pr/123"]);
      expect(completed!.status).toBe("completed");
      expect(completed!.completionNotes).toBe("Done!");
      expect(completed!.deliverableLinks).toHaveLength(1);
      expect(completed!.completedAt).toBeGreaterThan(0);
    });
  });

  describe("escalateDelegation", () => {
    it("escalates to another agent", () => {
      const d = delegateTask("A", "B", "Task", "Desc");
      acceptDelegation(d.id);
      const escalated = escalateDelegation(d.id, "C", "Need more expertise");
      expect(escalated!.status).toBe("escalated");
      expect(escalated!.escalatedTo).toBe("C");
      expect(escalated!.escalationReason).toBe("Need more expertise");
    });
  });

  describe("listDelegations", () => {
    it("lists all delegations", () => {
      delegateTask("A", "B", "Task 1", "D1");
      delegateTask("A", "C", "Task 2", "D2");
      expect(listDelegations()).toHaveLength(2);
    });

    it("filters by delegator", () => {
      delegateTask("A", "B", "T1", "D1");
      delegateTask("X", "B", "T2", "D2");
      expect(listDelegations({ delegator: "A" })).toHaveLength(1);
    });

    it("filters by delegatee", () => {
      delegateTask("A", "B", "T1", "D1");
      delegateTask("A", "C", "T2", "D2");
      expect(listDelegations({ delegatee: "B" })).toHaveLength(1);
    });

    it("filters by status", () => {
      const d = delegateTask("A", "B", "T1", "D1");
      delegateTask("A", "C", "T2", "D2");
      acceptDelegation(d.id);
      expect(listDelegations({ status: "accepted" })).toHaveLength(1);
    });
  });

  describe("getDelegationStats", () => {
    it("computes stats for an agent", () => {
      const d1 = delegateTask("Axiom", "Builder", "T1", "D1");
      const d2 = delegateTask("Axiom", "Guardian", "T2", "D2");
      delegateTask("Nox", "Axiom", "T3", "D3");

      acceptDelegation(d1.id);
      completeDelegation(d1.id, "Done");
      rejectDelegation(d2.id, "Busy");

      const stats = getDelegationStats("Axiom");
      expect(stats.totalDelegated).toBe(2);
      expect(stats.totalReceived).toBe(1);
      expect(stats.topDelegatees).toHaveLength(2);
    });

    it("handles empty state", () => {
      const stats = getDelegationStats("Nobody");
      expect(stats.totalDelegated).toBe(0);
      expect(stats.totalReceived).toBe(0);
    });
  });
});
