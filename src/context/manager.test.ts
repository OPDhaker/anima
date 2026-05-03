/**
 * Tests for Context Automanagement — 120K token budget system.
 *
 * Tests the three-zone architecture (identity/prompt/working),
 * priority-based eviction, sticky blocks, assembly ordering,
 * compaction, and working memory clearing.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  ContextManager,
  estimateTokens,
  MAX_CONTEXT_TOKENS,
  IDENTITY_ZONE_TOKENS,
  PROMPT_ZONE_TOKENS,
  WORKING_ZONE_TOKENS,
} from "./manager.js";

describe("estimateTokens", () => {
  it("estimates ~4 chars per token", () => {
    expect(estimateTokens("hello")).toBe(2); // 5 chars / 4 = 1.25 → ceil = 2
    expect(estimateTokens("a".repeat(100))).toBe(25);
    expect(estimateTokens("")).toBe(0);
  });
});

describe("ContextManager", () => {
  let cm: ContextManager;

  beforeEach(() => {
    cm = new ContextManager();
  });

  describe("zone constants", () => {
    it("has correct budget totals", () => {
      expect(MAX_CONTEXT_TOKENS).toBe(120_000);
      expect(IDENTITY_ZONE_TOKENS).toBe(20_000);
      expect(PROMPT_ZONE_TOKENS).toBe(50_000);
      expect(WORKING_ZONE_TOKENS).toBe(50_000);
      expect(IDENTITY_ZONE_TOKENS + PROMPT_ZONE_TOKENS + WORKING_ZONE_TOKENS).toBe(
        MAX_CONTEXT_TOKENS,
      );
    });
  });

  describe("addBlock / removeBlock / updateBlock", () => {
    it("adds a block with computed token estimate", () => {
      const block = cm.addBlock({
        id: "test-1",
        zone: "identity",
        priority: 50,
        content: "Hello world",
        source: "test",
        sticky: false,
      });
      expect(block.id).toBe("test-1");
      expect(block.tokenEstimate).toBe(estimateTokens("Hello world"));
      expect(block.createdAt).toBeGreaterThan(0);
    });

    it("removes a block", () => {
      cm.addBlock({
        id: "rm-1",
        zone: "working",
        priority: 10,
        content: "x",
        source: "test",
        sticky: false,
      });
      expect(cm.removeBlock("rm-1")).toBe(true);
      expect(cm.removeBlock("rm-1")).toBe(false); // already removed
    });

    it("updates block content and recalculates tokens", () => {
      cm.addBlock({
        id: "upd-1",
        zone: "prompt",
        priority: 50,
        content: "short",
        source: "test",
        sticky: false,
      });
      const updated = cm.updateBlock("upd-1", "a".repeat(400));
      expect(updated).not.toBeNull();
      expect(updated!.tokenEstimate).toBe(100); // 400/4
    });

    it("returns null when updating non-existent block", () => {
      expect(cm.updateBlock("nope", "content")).toBeNull();
    });
  });

  describe("identity zone helpers", () => {
    it("sets core identity as sticky", () => {
      const block = cm.setIdentity("I am Axiom. She/her.");
      expect(block.zone).toBe("identity");
      expect(block.sticky).toBe(true);
      expect(block.priority).toBe(100);
    });

    it("adds tool info as sticky", () => {
      const block = cm.setToolInfo("Available tools: read, write, bash...");
      expect(block.zone).toBe("identity");
      expect(block.sticky).toBe(true);
      expect(block.priority).toBe(90);
    });

    it("adds history as non-sticky", () => {
      const block = cm.addImportantHistory("h1", "Something important happened");
      expect(block.zone).toBe("identity");
      expect(block.sticky).toBe(false);
    });
  });

  describe("prompt zone helpers", () => {
    it("sets system prompt as sticky", () => {
      const block = cm.setSystemPrompt("You are Axiom...");
      expect(block.zone).toBe("prompt");
      expect(block.sticky).toBe(true);
      expect(block.priority).toBe(95);
    });

    it("sets user prompt as non-sticky", () => {
      const block = cm.setUserPrompt("steer-1", "Focus on security", 80);
      expect(block.zone).toBe("prompt");
      expect(block.priority).toBe(80);
    });

    it("sets mission context", () => {
      const block = cm.setMissionContext("Active mission: ship v7");
      expect(block.zone).toBe("prompt");
      expect(block.source).toBe("mission");
    });
  });

  describe("working memory helpers", () => {
    it("adds conversation turns", () => {
      const userTurn = cm.addConversationTurn("user", "Hello");
      const assistantTurn = cm.addConversationTurn("assistant", "Hi there!");
      expect(userTurn.zone).toBe("working");
      expect(assistantTurn.zone).toBe("working");
      expect(userTurn.content).toContain("[user]");
      expect(assistantTurn.content).toContain("[assistant]");
    });

    it("adds tool results", () => {
      const block = cm.addToolResult("read", "file contents here...");
      expect(block.zone).toBe("working");
      expect(block.content).toContain("[tool:read]");
    });

    it("sets active task", () => {
      const block = cm.setActiveTask("Building OpenAI runner");
      expect(block.zone).toBe("working");
      expect(block.priority).toBe(50);
    });
  });

  describe("assemble", () => {
    it("returns empty packet when no blocks added", () => {
      const packet = cm.assemble();
      expect(packet.messages).toHaveLength(0);
      expect(packet.evicted).toHaveLength(0);
      expect(packet.budget.total.used).toBe(0);
    });

    it("includes all blocks when under budget", () => {
      cm.setIdentity("Identity");
      cm.setSystemPrompt("System prompt");
      cm.addConversationTurn("user", "Hello");
      const packet = cm.assemble();
      expect(packet.messages).toHaveLength(3);
      expect(packet.evicted).toHaveLength(0);
    });

    it("orders messages: identity first, then prompt, then working", () => {
      cm.addConversationTurn("user", "working");
      cm.setSystemPrompt("prompt");
      cm.setIdentity("identity");
      const packet = cm.assemble();
      expect(packet.messages[0].zone).toBe("identity");
      expect(packet.messages[1].zone).toBe("prompt");
      expect(packet.messages[2].zone).toBe("working");
    });

    it("evicts low-priority non-sticky blocks when zone is full", () => {
      // Fill identity zone with a big block
      cm.addBlock({
        id: "big",
        zone: "identity",
        priority: 90,
        content: "x".repeat(IDENTITY_ZONE_TOKENS * 4), // exactly fills 20K tokens
        source: "test",
        sticky: false,
      });
      // Add another non-sticky block
      cm.addBlock({
        id: "overflow",
        zone: "identity",
        priority: 10,
        content: "should be evicted",
        source: "test",
        sticky: false,
      });

      const packet = cm.assemble();
      const evictedIds = packet.evicted.map((b) => b.id);
      expect(evictedIds).toContain("overflow");
    });

    it("keeps sticky blocks even when over budget", () => {
      cm.addBlock({
        id: "big-sticky",
        zone: "identity",
        priority: 100,
        content: "x".repeat(IDENTITY_ZONE_TOKENS * 4), // fills zone
        source: "test",
        sticky: true,
      });
      cm.addBlock({
        id: "also-sticky",
        zone: "identity",
        priority: 90,
        content: "y".repeat(1000),
        source: "test",
        sticky: true,
      });

      const packet = cm.assemble();
      const includedIds = packet.messages.map((b) => b.id);
      expect(includedIds).toContain("big-sticky");
      expect(includedIds).toContain("also-sticky");
      expect(packet.warnings.length).toBeGreaterThan(0);
    });

    it("sorts by priority within same zone", () => {
      cm.addBlock({
        id: "low",
        zone: "prompt",
        priority: 10,
        content: "low",
        source: "test",
        sticky: false,
      });
      cm.addBlock({
        id: "high",
        zone: "prompt",
        priority: 90,
        content: "high",
        source: "test",
        sticky: false,
      });
      cm.addBlock({
        id: "mid",
        zone: "prompt",
        priority: 50,
        content: "mid",
        source: "test",
        sticky: false,
      });

      const packet = cm.assemble();
      const promptBlocks = packet.messages.filter((b) => b.zone === "prompt");
      expect(promptBlocks[0].id).toBe("high");
      expect(promptBlocks[1].id).toBe("mid");
      expect(promptBlocks[2].id).toBe("low");
    });
  });

  describe("getBudget", () => {
    it("returns accurate budget breakdown", () => {
      cm.setIdentity("identity content");
      cm.setSystemPrompt("system prompt");
      cm.addConversationTurn("user", "hello");

      const budget = cm.getBudget();
      expect(budget.identity.blocks).toBe(1);
      expect(budget.prompt.blocks).toBe(1);
      expect(budget.working.blocks).toBe(1);
      expect(budget.total.used).toBeGreaterThan(0);
      expect(budget.total.max).toBe(MAX_CONTEXT_TOKENS);
    });
  });

  describe("clearWorkingMemory", () => {
    it("removes non-sticky working blocks", () => {
      cm.setIdentity("stays");
      cm.addConversationTurn("user", "removed");
      cm.addToolResult("bash", "also removed");
      cm.setActiveTask("also removed");

      const cleared = cm.clearWorkingMemory();
      expect(cleared).toBe(3);
      expect(cm.getBudget().working.blocks).toBe(0);
      expect(cm.getBudget().identity.blocks).toBe(1); // identity untouched
    });

    it("does not remove sticky working blocks", () => {
      cm.addBlock({
        id: "sticky-work",
        zone: "working",
        priority: 100,
        content: "important",
        source: "test",
        sticky: true,
      });
      cm.addConversationTurn("user", "normal");

      const cleared = cm.clearWorkingMemory();
      expect(cleared).toBe(1); // only the non-sticky one
      expect(cm.getBudget().working.blocks).toBe(1); // sticky remains
    });
  });

  describe("compact", () => {
    it("does nothing when under budget", () => {
      cm.setIdentity("small");
      expect(cm.compact()).toBe(0);
    });

    it("removes lowest-priority blocks to fit budget", () => {
      // Overflow the total budget
      cm.addBlock({
        id: "huge-identity",
        zone: "identity",
        priority: 100,
        content: "x".repeat(IDENTITY_ZONE_TOKENS * 4),
        source: "test",
        sticky: true,
      });
      cm.addBlock({
        id: "huge-prompt",
        zone: "prompt",
        priority: 90,
        content: "y".repeat(PROMPT_ZONE_TOKENS * 4),
        source: "test",
        sticky: true,
      });
      cm.addBlock({
        id: "huge-working",
        zone: "working",
        priority: 80,
        content: "z".repeat(WORKING_ZONE_TOKENS * 4),
        source: "test",
        sticky: true,
      });
      // Add a small non-sticky block
      cm.addBlock({
        id: "expendable",
        zone: "working",
        priority: 1,
        content: "remove me",
        source: "test",
        sticky: false,
      });

      const removed = cm.compact();
      expect(removed).toBeGreaterThan(0);
    });
  });
});
