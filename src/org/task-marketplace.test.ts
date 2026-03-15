/**
 * Tests for Task Marketplace — peer-to-peer task coordination.
 *
 * Tests task CRUD, claiming, review, escalation, filtering,
 * and the path traversal fix (sanitizeId).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// We need to mock resolveStateDir before importing the module
const TEST_DIR = path.join(os.tmpdir(), `anima-marketplace-test-${Date.now()}`);
vi.mock("../config/paths.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../config/paths.js")>();
  return {
    ...original,
    resolveStateDir: () => TEST_DIR,
  };
});

import {
  postTask,
  claimTask,
  submitForReview,
  reviewTask,
  cancelTask,
  listTasks,
  findClaimableTasks,
  getMarketplaceStats,
  checkEscalations,
} from "./task-marketplace.js";

describe("TaskMarketplace", () => {
  beforeEach(() => {
    fs.mkdirSync(path.join(TEST_DIR, "task-marketplace"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  describe("postTask", () => {
    it("creates a task with correct defaults", () => {
      const task = postTask("Fix bug", "Description of the bug", "agent-1");
      expect(task.title).toBe("Fix bug");
      expect(task.description).toBe("Description of the bug");
      expect(task.postedBy).toBe("agent-1");
      expect(task.status).toBe("open");
      expect(task.priority).toBe("medium");
      expect(task.effort).toBe("medium");
      expect(task.escalationLevel).toBe(0);
      expect(task.id).toMatch(/^task-\d+-[a-f0-9]{8}$/);
    });

    it("creates a task with custom options", () => {
      const task = postTask("Critical vuln", "SQL injection found", "guardian-1", {
        priority: "critical",
        requiredSpecializations: ["security"],
        repos: ["anima", "nox"],
        effort: "large",
        tags: ["security", "p0"],
      });
      expect(task.priority).toBe("critical");
      expect(task.requiredSpecializations).toEqual(["security"]);
      expect(task.repos).toEqual(["anima", "nox"]);
      expect(task.effort).toBe("large");
      expect(task.tags).toEqual(["security", "p0"]);
    });

    it("persists task to disk", () => {
      const task = postTask("Persistent task", "Check disk", "agent-1");
      const filePath = path.join(TEST_DIR, "task-marketplace", `${task.id}.json`);
      expect(fs.existsSync(filePath)).toBe(true);
      const read = JSON.parse(fs.readFileSync(filePath, "utf8"));
      expect(read.title).toBe("Persistent task");
    });
  });

  describe("claimTask", () => {
    it("claims an open task", () => {
      const task = postTask("Test task", "desc", "agent-1");
      const claimed = claimTask(task.id, {
        taskId: task.id,
        claimant: "builder-1",
        specializations: [],
        estimatedCompletionMs: 60_000,
      });
      expect(claimed).not.toBeNull();
      expect(claimed!.status).toBe("claimed");
      expect(claimed!.claimedBy).toBe("builder-1");
    });

    it("rejects claim on non-existent task", () => {
      const result = claimTask("nonexistent", {
        taskId: "nonexistent",
        claimant: "builder-1",
        specializations: [],
        estimatedCompletionMs: 60_000,
      });
      expect(result).toBeNull();
    });

    it("rejects claim on already-claimed task", () => {
      const task = postTask("Test", "desc", "agent-1");
      claimTask(task.id, {
        taskId: task.id,
        claimant: "builder-1",
        specializations: [],
        estimatedCompletionMs: 60_000,
      });
      const secondClaim = claimTask(task.id, {
        taskId: task.id,
        claimant: "builder-2",
        specializations: [],
        estimatedCompletionMs: 60_000,
      });
      expect(secondClaim).toBeNull();
    });

    it("enforces specialization requirements", () => {
      const task = postTask("Security fix", "desc", "agent-1", {
        requiredSpecializations: ["security"],
      });
      const noMatch = claimTask(task.id, {
        taskId: task.id,
        claimant: "frontend-dev",
        specializations: ["frontend", "ui"],
        estimatedCompletionMs: 60_000,
      });
      expect(noMatch).toBeNull();

      const match = claimTask(task.id, {
        taskId: task.id,
        claimant: "sec-agent",
        specializations: ["security", "auditing"],
        estimatedCompletionMs: 60_000,
      });
      expect(match).not.toBeNull();
      expect(match!.claimedBy).toBe("sec-agent");
    });
  });

  describe("review flow", () => {
    it("submit for review → approve → completed", () => {
      const task = postTask("Feature", "desc", "agent-1");
      claimTask(task.id, {
        taskId: task.id,
        claimant: "builder-1",
        specializations: [],
        estimatedCompletionMs: 60_000,
      });

      const submitted = submitForReview(task.id, "PR #123 merged");
      expect(submitted!.status).toBe("in-review");
      expect(submitted!.outcome).toBe("PR #123 merged");

      const reviewed = reviewTask(task.id, "architect-1", true, "LGTM");
      expect(reviewed!.status).toBe("completed");
      expect(reviewed!.reviewedBy).toBe("architect-1");
      expect(reviewed!.reviewNotes).toBe("LGTM");
      expect(reviewed!.completedAt).toBeGreaterThan(0);
    });

    it("submit for review → reject → back to open", () => {
      const task = postTask("Feature", "desc", "agent-1");
      claimTask(task.id, {
        taskId: task.id,
        claimant: "builder-1",
        specializations: [],
        estimatedCompletionMs: 60_000,
      });
      submitForReview(task.id, "Draft PR");

      const rejected = reviewTask(task.id, "architect-1", false, "Needs tests");
      expect(rejected!.status).toBe("rejected");
      expect(rejected!.claimedBy).toBeUndefined();
    });
  });

  describe("cancelTask", () => {
    it("cancels a task", () => {
      const task = postTask("Cancel me", "desc", "agent-1");
      const cancelled = cancelTask(task.id);
      expect(cancelled!.status).toBe("cancelled");
    });

    it("returns null for non-existent task", () => {
      expect(cancelTask("nonexistent")).toBeNull();
    });
  });

  describe("listTasks and filtering", () => {
    it("lists all tasks sorted by priority then time", () => {
      postTask("Low", "desc", "agent-1", { priority: "low" });
      postTask("Critical", "desc", "agent-1", { priority: "critical" });
      postTask("High", "desc", "agent-1", { priority: "high" });

      const all = listTasks();
      expect(all).toHaveLength(3);
      expect(all[0].priority).toBe("critical");
      expect(all[1].priority).toBe("high");
      expect(all[2].priority).toBe("low");
    });

    it("filters by status", () => {
      const t1 = postTask("Open", "desc", "agent-1");
      const t2 = postTask("Claimed", "desc", "agent-1");
      claimTask(t2.id, {
        taskId: t2.id,
        claimant: "b-1",
        specializations: [],
        estimatedCompletionMs: 1000,
      });

      const open = listTasks({ status: "open" });
      expect(open).toHaveLength(1);
      expect(open[0].id).toBe(t1.id);
    });

    it("filters by postedBy", () => {
      postTask("By A", "desc", "agent-A");
      postTask("By B", "desc", "agent-B");

      const byA = listTasks({ postedBy: "agent-A" });
      expect(byA).toHaveLength(1);
      expect(byA[0].postedBy).toBe("agent-A");
    });
  });

  describe("findClaimableTasks", () => {
    it("returns tasks matching agent specializations", () => {
      postTask("Sec task", "desc", "agent-1", { requiredSpecializations: ["security"] });
      postTask("UI task", "desc", "agent-1", { requiredSpecializations: ["frontend"] });
      postTask("Any task", "desc", "agent-1"); // no specialization required

      const secTasks = findClaimableTasks(["security"]);
      expect(secTasks).toHaveLength(2); // sec task + any task
    });
  });

  describe("getMarketplaceStats", () => {
    it("returns correct counts", () => {
      const t1 = postTask("Open", "desc", "agent-1");
      const t2 = postTask("Claimed", "desc", "agent-1");
      claimTask(t2.id, {
        taskId: t2.id,
        claimant: "b-1",
        specializations: [],
        estimatedCompletionMs: 1000,
      });

      const stats = getMarketplaceStats();
      expect(stats.open).toBe(1);
      expect(stats.claimed).toBe(1);
      expect(stats.totalPosted).toBe(2);
    });
  });

  describe("TTL escalation", () => {
    it("escalates critical tasks to broadcast after 5 minutes", () => {
      vi.useFakeTimers();
      const task = postTask("Critical bug", "desc", "agent-1", { priority: "critical" });

      // No escalation yet
      let escalations = checkEscalations();
      expect(escalations).toHaveLength(0);

      // Advance past broadcast threshold (5 min)
      vi.advanceTimersByTime(6 * 60_000);
      escalations = checkEscalations();
      expect(escalations).toHaveLength(1);
      expect(escalations[0].action).toBe("broadcast");
      expect(escalations[0].newLevel).toBe(1);

      // Advance past human alert threshold (15 min)
      vi.advanceTimersByTime(10 * 60_000);
      escalations = checkEscalations();
      expect(escalations).toHaveLength(1);
      expect(escalations[0].action).toBe("human-alert");
      expect(escalations[0].newLevel).toBe(2);

      // No further escalation
      vi.advanceTimersByTime(60 * 60_000);
      escalations = checkEscalations();
      expect(escalations).toHaveLength(0);

      vi.useRealTimers();
    });
  });

  describe("security: path traversal prevention", () => {
    it("prevents path traversal — returns null for malicious IDs", () => {
      // sanitizeId throws internally; readTask/claimTask catch it and return null
      // The key point: the file system is never accessed with ../../ paths
      const result = claimTask("../../etc/passwd", {
        taskId: "../../etc/passwd",
        claimant: "attacker",
        specializations: [],
        estimatedCompletionMs: 1000,
      });
      expect(result).toBeNull();
    });

    it("prevents slash traversal", () => {
      const result = cancelTask("task/../secret");
      expect(result).toBeNull();
    });

    it("prevents dot traversal", () => {
      const result = cancelTask("task..secret");
      expect(result).toBeNull();
    });

    it("does NOT create files with traversal paths", () => {
      // Even though postTask generates its own ID (safe), verify writeTask path
      // is always inside the marketplace dir
      const task = postTask("Safe task", "desc", "agent-1");
      const dir = path.join(TEST_DIR, "task-marketplace");
      const files = fs.readdirSync(dir);
      // All files should be in the marketplace dir, none outside
      expect(files.every((f) => f.endsWith(".json"))).toBe(true);
      expect(files.every((f) => !f.includes(".."))).toBe(true);
    });

    it("accepts valid task IDs", () => {
      const result = cancelTask("task-1234567890-abcdef12");
      expect(result).toBeNull(); // doesn't exist, but doesn't throw
    });
  });
});
