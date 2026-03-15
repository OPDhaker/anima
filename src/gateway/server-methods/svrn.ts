/**
 * SVRN Gateway Methods — wallet balance, node status, earnings
 *
 * Exposes SVRN node data through the gateway RPC and HTTP API.
 * Fixes the wallet balance 404 by providing actual endpoints.
 */

import { createSubsystemLogger } from "../../logging/subsystem.js";
import { loadSvrnNodeModule } from "../../svrn/module.js";

const log = createSubsystemLogger("svrn-gateway");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SVRNWalletResponse {
  address: string;
  balance: number;
  totalEarned: number;
  totalSpent: number;
  createdAt: string | null;
  recentTransactions: Array<{
    type: "earn" | "spend";
    amount: number;
    description?: string;
    timestamp: number;
  }>;
}

export interface SVRNStatusResponse {
  enabled: boolean;
  running: boolean;
  paused: boolean;
  nodeId: string;
  uptimeMs: number;
  tasksCompleted: number;
  tasksFailed: number;
  balance: number;
  sessionEarnings: number;
  limits: {
    maxCpuPercent: number;
    maxRamMB: number;
    maxBandwidthMbps: number;
  };
  resources: {
    cpuPercent: number;
    ramUsedMB: number;
    bandwidthMbps: number;
  } | null;
  earnings: {
    allTimeEarned: number;
    allTimeApplied: number;
    balanceValueUSD: number;
    todayEarned: number;
    todayTasks: number;
  };
}

// ---------------------------------------------------------------------------
// Node instance cache
// ---------------------------------------------------------------------------

let nodeInstance: unknown = null;

async function getNode(): Promise<unknown> {
  if (nodeInstance) {
    return nodeInstance;
  }

  const mod = await loadSvrnNodeModule();
  if (!mod) {
    log.warn("SVRN node module not available");
    return null;
  }

  try {
    nodeInstance = mod.createNode();
    return nodeInstance;
  } catch (err) {
    log.warn(`failed to create SVRN node: ${String(err)}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Gateway methods
// ---------------------------------------------------------------------------

/**
 * Get SVRN wallet balance and transaction history.
 * This is the endpoint that was returning 404.
 */
export async function getWalletBalance(): Promise<SVRNWalletResponse> {
  const node = await getNode();
  if (!node || typeof (node as Record<string, unknown>).getWallet !== "function") {
    return {
      address: "0x0000000000000000000000000000000000000000",
      balance: 0,
      totalEarned: 0,
      totalSpent: 0,
      createdAt: null,
      recentTransactions: [],
    };
  }

  const wallet = (
    node as {
      getWallet: () => {
        getAddress: () => string;
        getBalance: () => number;
        getTotalEarned: () => number;
        getTotalSpent: () => number;
        getCreatedAt: () => string | null;
        getRecentTransactions: (limit: number) => Array<{
          type: "earn" | "spend";
          amount: number;
          description?: string;
          timestamp: number;
        }>;
      };
    }
  ).getWallet();

  return {
    address: wallet.getAddress(),
    balance: wallet.getBalance(),
    totalEarned: wallet.getTotalEarned(),
    totalSpent: wallet.getTotalSpent(),
    createdAt: wallet.getCreatedAt(),
    recentTransactions: wallet.getRecentTransactions(20),
  };
}

/**
 * Get full SVRN node status.
 */
export async function getNodeStatus(): Promise<SVRNStatusResponse> {
  const node = await getNode();
  if (!node || typeof (node as Record<string, unknown>).getStatus !== "function") {
    return {
      enabled: false,
      running: false,
      paused: false,
      nodeId: "",
      uptimeMs: 0,
      tasksCompleted: 0,
      tasksFailed: 0,
      balance: 0,
      sessionEarnings: 0,
      limits: { maxCpuPercent: 0, maxRamMB: 0, maxBandwidthMbps: 0 },
      resources: null,
      earnings: {
        allTimeEarned: 0,
        allTimeApplied: 0,
        balanceValueUSD: 0,
        todayEarned: 0,
        todayTasks: 0,
      },
    };
  }

  const status = (
    node as {
      getStatus: () => {
        nodeId: string;
        state: string;
        uptime: number;
        tasksCompleted: number;
        tasksFailed: number;
        balance: number;
        sessionEarnings: number;
      };
    }
  ).getStatus();

  const resources = (
    node as { getResources: () => { cpuPercent: number; ramMB: number; bandwidthMbps: number } }
  ).getResources();
  const earnings = (
    node as {
      getEarnings: () => {
        allTime: number;
        today: number;
        tasksToday: number;
        session: number;
        estimatedMonthlySavingsUSD: number;
      };
    }
  ).getEarnings();

  return {
    enabled: true,
    running: status.state === "running",
    paused: false,
    nodeId: status.nodeId,
    uptimeMs: status.uptime * 1000,
    tasksCompleted: status.tasksCompleted,
    tasksFailed: status.tasksFailed,
    balance: status.balance,
    sessionEarnings: status.sessionEarnings,
    limits: { maxCpuPercent: 50, maxRamMB: 512, maxBandwidthMbps: 10 },
    resources: resources
      ? {
          cpuPercent: resources.cpuPercent,
          ramUsedMB: resources.ramMB,
          bandwidthMbps: resources.bandwidthMbps,
        }
      : null,
    earnings: {
      allTimeEarned: earnings.allTime,
      allTimeApplied: 0,
      balanceValueUSD: status.balance * 0.001,
      todayEarned: earnings.today,
      todayTasks: earnings.tasksToday,
    },
  };
}
