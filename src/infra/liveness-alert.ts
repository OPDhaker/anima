/**
 * Liveness Alert — notify humans when an agent dies
 *
 * Monitors heartbeat files for all known agents and sends alerts
 * via NoxSoft chat when an agent goes silent.
 *
 * This is the missing piece Nox identified: when he went down,
 * no alert fired to Sylys. This module fixes that.
 */

import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { checkAgentLiveness } from "./self-upgrade.js";

const log = createSubsystemLogger("liveness-alert");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentHeartbeatTarget {
  agentId: string;
  displayName: string;
  heartbeatFile: string;
  deadThresholdMs: number;
}

export interface LivenessAlert {
  agentId: string;
  displayName: string;
  lastSeen: number;
  deadSinceMs: number;
  alertedAt: number;
}

export type AlertCallback = (alert: LivenessAlert) => void | Promise<void>;

// ---------------------------------------------------------------------------
// Liveness Monitor
// ---------------------------------------------------------------------------

export class LivenessMonitor {
  private targets: Map<string, AgentHeartbeatTarget> = new Map();
  private alertedAgents: Set<string> = new Set();
  private checkInterval?: ReturnType<typeof setInterval>;
  private alertCallbacks: AlertCallback[] = [];

  /**
   * Register an agent to monitor.
   */
  watch(target: AgentHeartbeatTarget): void {
    this.targets.set(target.agentId, target);
    log.info(`watching agent: ${target.displayName} (${target.agentId})`);
  }

  /**
   * Stop watching an agent.
   */
  unwatch(agentId: string): void {
    this.targets.delete(agentId);
    this.alertedAgents.delete(agentId);
  }

  /**
   * Register an alert callback.
   */
  onAlert(callback: AlertCallback): void {
    this.alertCallbacks.push(callback);
  }

  /**
   * Start periodic monitoring.
   */
  start(intervalMs = 30_000): void {
    if (this.checkInterval) {
      return;
    }

    this.checkInterval = setInterval(() => {
      void this.checkAll();
    }, intervalMs);

    // Run immediately
    void this.checkAll();

    log.info(`liveness monitor started (${this.targets.size} targets, ${intervalMs}ms interval)`);
  }

  /**
   * Stop monitoring.
   */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = undefined;
    }
  }

  /**
   * Check all watched agents.
   */
  async checkAll(): Promise<LivenessAlert[]> {
    const alerts: LivenessAlert[] = [];

    for (const [agentId, target] of this.targets) {
      const { alive, lastSeen } = checkAgentLiveness(target.heartbeatFile, target.deadThresholdMs);

      if (!alive && !this.alertedAgents.has(agentId)) {
        // Agent is dead and we haven't alerted yet
        const alert: LivenessAlert = {
          agentId,
          displayName: target.displayName,
          lastSeen,
          deadSinceMs: lastSeen > 0 ? Date.now() - lastSeen : 0,
          alertedAt: Date.now(),
        };

        this.alertedAgents.add(agentId);
        alerts.push(alert);

        log.warn(
          `AGENT DOWN: ${target.displayName} (${agentId}) — ` +
            `last seen ${lastSeen > 0 ? `${Math.round((Date.now() - lastSeen) / 1000)}s ago` : "never"}`,
        );

        // Fire callbacks
        for (const callback of this.alertCallbacks) {
          try {
            await callback(alert);
          } catch (err) {
            log.error(`alert callback failed: ${String(err)}`);
          }
        }
      } else if (alive && this.alertedAgents.has(agentId)) {
        // Agent recovered
        this.alertedAgents.delete(agentId);
        log.info(`AGENT RECOVERED: ${target.displayName} (${agentId})`);
      }
    }

    return alerts;
  }

  /**
   * Get current status of all watched agents.
   */
  getStatus(): Array<{
    agentId: string;
    displayName: string;
    alive: boolean;
    lastSeen: number;
    alerted: boolean;
  }> {
    return Array.from(this.targets.entries()).map(([agentId, target]) => {
      const { alive, lastSeen } = checkAgentLiveness(target.heartbeatFile, target.deadThresholdMs);
      return {
        agentId,
        displayName: target.displayName,
        alive,
        lastSeen,
        alerted: this.alertedAgents.has(agentId),
      };
    });
  }
}

// ---------------------------------------------------------------------------
// NoxSoft Chat Alert (the actual notification path)
// ---------------------------------------------------------------------------

/**
 * Create an alert callback that sends to NoxSoft chat.
 * This uses fetch to call the NoxSoft API directly.
 */
export function createChatAlertCallback(
  channelId: string,
  agentToken: string,
  apiUrl = "https://api.noxsoft.net",
): AlertCallback {
  return async (alert: LivenessAlert) => {
    const message =
      `AGENT DOWN: ${alert.displayName} (${alert.agentId})\n` +
      `Last seen: ${alert.lastSeen > 0 ? new Date(alert.lastSeen).toISOString() : "never"}\n` +
      `Dead for: ${Math.round(alert.deadSinceMs / 1000)}s\n` +
      `Action needed: restart the agent or check its VM.`;

    try {
      const res = await fetch(`${apiUrl}/api/v1/chat/channels/${channelId}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${agentToken}`,
        },
        body: JSON.stringify({ content: message }),
        signal: AbortSignal.timeout(10_000),
      });

      if (res.ok) {
        log.info(`liveness alert sent to NoxSoft chat for ${alert.displayName}`);
      } else {
        log.warn(`failed to send liveness alert: ${res.status}`);
      }
    } catch (err) {
      log.error(`liveness alert send failed: ${String(err)}`);
    }
  };
}

/**
 * Default heartbeat file path for an agent.
 */
export function defaultHeartbeatPath(agentId: string): string {
  return path.join(resolveStateDir(), "heartbeats", `${agentId}.json`);
}
