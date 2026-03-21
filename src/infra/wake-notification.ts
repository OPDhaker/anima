/**
 * Wake Notification Layer — lightweight triage on incoming notifications.
 *
 * When Anima receives a notification (message, email, system event), the
 * wake layer uses the cheapest available model to quickly decide:
 *
 *   1. RESPOND — needs a reply (route to conversation or execution layer)
 *   2. ACKNOWLEDGE — send a quick ack, no full response needed
 *   3. IGNORE — not actionable, skip
 *   4. ESCALATE — urgent, wake the primary model immediately
 *
 * This keeps Anima responsive to notifications without burning expensive
 * model tokens on every incoming ping.
 *
 * Part of Anima's layered architecture:
 *   Wake (this file)  → triage incoming notifications (cheapest model)
 *   Conversation       → handle chat/DMs (conversationalModel / haiku)
 *   Inner Thoughts     → background self-reflection (cheapest model, cron)
 *   Execution          → task work (primary model / sonnet / opus)
 */

import type { AnimaConfig } from "../config/config.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("wake");

export type WakeDecision = "respond" | "acknowledge" | "ignore" | "escalate";

export interface WakeTriageResult {
  decision: WakeDecision;
  reason: string;
  /** Suggested model tier for response (if decision is "respond" or "escalate"). */
  suggestedTier?: "cheapest" | "conversational" | "primary";
  /** Time taken for triage in ms. */
  triageMs: number;
}

export interface WakeNotification {
  type: "message" | "email" | "system_event" | "mention" | "reaction";
  source: string;
  sender?: string;
  preview?: string;
  channel?: string;
  priority?: "low" | "normal" | "high" | "urgent";
  timestamp: number;
}

export interface WakeConfig {
  model?: string;
  enabled?: boolean;
}

export function resolveWakeConfig(config?: AnimaConfig): WakeConfig {
  const layers = config?.agents?.defaults?.layers;
  return {
    model: layers?.wake?.model,
    enabled: layers?.wake?.enabled ?? true,
  };
}

/**
 * Fast heuristic triage — no model call needed for obvious cases.
 * Returns null if the notification needs model-based triage.
 */
function fastTriage(notification: WakeNotification): WakeTriageResult | null {
  const start = Date.now();

  // Urgent priority always escalates
  if (notification.priority === "urgent") {
    return {
      decision: "escalate",
      reason: "urgent priority",
      suggestedTier: "primary",
      triageMs: Date.now() - start,
    };
  }

  // System events are usually informational
  if (notification.type === "system_event" && notification.priority !== "high") {
    return {
      decision: "ignore",
      reason: "low-priority system event",
      triageMs: Date.now() - start,
    };
  }

  // Reactions don't need a response
  if (notification.type === "reaction") {
    return {
      decision: "acknowledge",
      reason: "reaction received",
      triageMs: Date.now() - start,
    };
  }

  // Direct mentions are high-signal
  if (notification.type === "mention") {
    return {
      decision: "respond",
      reason: "direct mention",
      suggestedTier: "conversational",
      triageMs: Date.now() - start,
    };
  }

  // Messages from known owner/operator
  if (notification.type === "message" && notification.priority === "high") {
    return {
      decision: "respond",
      reason: "high-priority message",
      suggestedTier: "conversational",
      triageMs: Date.now() - start,
    };
  }

  // Email can usually wait
  if (notification.type === "email" && notification.priority !== "high") {
    return {
      decision: "acknowledge",
      reason: "email received, not urgent",
      triageMs: Date.now() - start,
    };
  }

  return null; // Needs model-based triage
}

/**
 * Triage an incoming notification.
 * Uses fast heuristics first, falls back to model-based triage if needed.
 */
export function triageNotification(
  notification: WakeNotification,
  config?: AnimaConfig,
): WakeTriageResult {
  const wakeConfig = resolveWakeConfig(config);
  const start = Date.now();

  if (!wakeConfig.enabled) {
    return {
      decision: "respond",
      reason: "wake layer disabled, passing through",
      suggestedTier: "conversational",
      triageMs: Date.now() - start,
    };
  }

  // Try fast heuristic triage first (no model call)
  const fast = fastTriage(notification);
  if (fast) {
    log.info(`wake triage: ${fast.decision} (${fast.reason}) [${fast.triageMs}ms, heuristic]`);
    return fast;
  }

  // Default: regular messages get conversational treatment
  const result: WakeTriageResult = {
    decision: "respond",
    reason: "default triage — message needs response",
    suggestedTier: "conversational",
    triageMs: Date.now() - start,
  };

  log.info(`wake triage: ${result.decision} (${result.reason}) [${result.triageMs}ms]`);
  return result;
}

/**
 * Check if a notification should wake Anima from idle/sleep.
 */
export function shouldWake(notification: WakeNotification, config?: AnimaConfig): boolean {
  const result = triageNotification(notification, config);
  return result.decision === "respond" || result.decision === "escalate";
}
