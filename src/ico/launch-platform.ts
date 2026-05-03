/**
 * ICO Launch Platform — backend for dual-chain token launches
 *
 * Manages the lifecycle of an ICO: creation, bonding curve tracking,
 * chain deployment status, holder tracking, and revenue share distribution.
 *
 * Free to launch. No fees. NoxSoft does its own ICO first.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import {
  type IcoLaunchConfig,
  type IcoStatus,
  type Chain,
  createIcoStatus,
  bondingCurvePrice,
  tokensForInvestment,
  isBondingCapReached,
  calculateTransferTax,
} from "./tokenomics.js";

const log = createSubsystemLogger("ico-platform");

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

function resolveIcoDir(): string {
  return path.join(resolveStateDir(), "ico");
}

function resolveIcoFile(id: string): string {
  return path.join(resolveIcoDir(), `${id}.json`);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IcoProject {
  id: string;
  config: IcoLaunchConfig;
  status: IcoStatus;
  createdAt: number;
  createdBy: string;
  holders: IcoHolder[];
  transactions: IcoTransaction[];
}

export interface IcoHolder {
  address: string;
  chain: Chain;
  balance: number;
  totalInvested: number;
  firstPurchaseAt: number;
}

export interface IcoTransaction {
  id: string;
  type: "buy" | "sell" | "transfer" | "tax";
  from: string;
  to: string;
  amount: number;
  pricePerToken: number;
  chain: Chain;
  txHash?: string;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Create an ICO project
// ---------------------------------------------------------------------------

export function createIcoProject(config: IcoLaunchConfig, createdBy: string): IcoProject {
  const id = `ico-${crypto.randomUUID()}`;

  const project: IcoProject = {
    id,
    config,
    status: createIcoStatus(config),
    createdAt: Date.now(),
    createdBy,
    holders: [],
    transactions: [],
  };

  const dir = resolveIcoDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(resolveIcoFile(id), `${JSON.stringify(project, null, 2)}\n`, { mode: 0o600 });

  log.info(`ICO project created: ${config.name} (${config.symbol}) by ${createdBy}`);
  return project;
}

// ---------------------------------------------------------------------------
// Read/Write
// ---------------------------------------------------------------------------

export function getIcoProject(id: string): IcoProject | null {
  try {
    const raw = fs.readFileSync(resolveIcoFile(id), "utf8");
    return JSON.parse(raw) as IcoProject;
  } catch {
    return null;
  }
}

function saveIcoProject(project: IcoProject): void {
  fs.writeFileSync(resolveIcoFile(project.id), `${JSON.stringify(project, null, 2)}\n`, {
    mode: 0o600,
  });
}

export function listIcoProjects(): IcoProject[] {
  const dir = resolveIcoDir();
  try {
    if (!fs.existsSync(dir)) {
      return [];
    }
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        try {
          const raw = fs.readFileSync(path.join(dir, f), "utf8");
          return JSON.parse(raw) as IcoProject;
        } catch {
          return null;
        }
      })
      .filter((p): p is IcoProject => p != null)
      .toSorted((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Buy tokens (bonding curve purchase)
// ---------------------------------------------------------------------------

export function buyTokens(
  projectId: string,
  buyerAddress: string,
  investmentUsd: number,
  chain: Chain,
): { tokens: number; pricePerToken: number; project: IcoProject } | null {
  const project = getIcoProject(projectId);
  if (!project) {
    return null;
  }

  if (!project.status.bondingActive) {
    log.warn("bonding curve ended — trade on free market");
    return null;
  }

  const currentPrice = bondingCurvePrice(project.status.currentSupply, project.config.bondingCurve);
  const tokens = tokensForInvestment(
    investmentUsd,
    project.status.currentSupply,
    project.config.bondingCurve,
  );

  if (tokens <= 0) {
    return null;
  }

  // Update status
  project.status.currentSupply += tokens;
  project.status.totalRaisedUsd += investmentUsd;
  project.status.currentPriceUsd = bondingCurvePrice(
    project.status.currentSupply,
    project.config.bondingCurve,
  );
  project.status.percentToTarget =
    (project.status.totalRaisedUsd / project.config.bondingCurve.targetRaiseUsd) * 100;

  // Check cap
  if (isBondingCapReached(project.status.totalRaisedUsd, project.config.bondingCurve)) {
    project.status.bondingActive = false;
    log.info(
      `bonding cap reached for ${project.config.symbol}! $${project.status.totalRaisedUsd} raised`,
    );
  }

  // Update holder
  let holder = project.holders.find((h) => h.address === buyerAddress && h.chain === chain);
  if (!holder) {
    holder = {
      address: buyerAddress,
      chain,
      balance: 0,
      totalInvested: 0,
      firstPurchaseAt: Date.now(),
    };
    project.holders.push(holder);
    project.status.holders = project.holders.length;
  }
  holder.balance += tokens;
  holder.totalInvested += investmentUsd;

  // Record transaction
  project.transactions.push({
    id: `tx-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
    type: "buy",
    from: "bonding-curve",
    to: buyerAddress,
    amount: tokens,
    pricePerToken: currentPrice,
    chain,
    timestamp: Date.now(),
  });

  saveIcoProject(project);
  log.info(
    `${buyerAddress} bought ${tokens} ${project.config.symbol} for $${investmentUsd} on ${chain}`,
  );

  return { tokens, pricePerToken: currentPrice, project };
}

// ---------------------------------------------------------------------------
// Transfer tokens (with tax)
// ---------------------------------------------------------------------------

export function transferTokens(
  projectId: string,
  fromAddress: string,
  toAddress: string,
  amount: number,
  chain: Chain,
): { net: number; tax: number; project: IcoProject } | null {
  const project = getIcoProject(projectId);
  if (!project) {
    return null;
  }

  const fromHolder = project.holders.find((h) => h.address === fromAddress && h.chain === chain);
  if (!fromHolder || fromHolder.balance < amount) {
    return null;
  }

  const { tax, net } = calculateTransferTax(amount, project.config.tax);

  // Deduct from sender
  fromHolder.balance -= amount;

  // Add net to recipient
  let toHolder = project.holders.find((h) => h.address === toAddress && h.chain === chain);
  if (!toHolder) {
    toHolder = {
      address: toAddress,
      chain,
      balance: 0,
      totalInvested: 0,
      firstPurchaseAt: Date.now(),
    };
    project.holders.push(toHolder);
    project.status.holders = project.holders.length;
  }
  toHolder.balance += net;

  // Record transactions
  project.transactions.push({
    id: `tx-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
    type: "transfer",
    from: fromAddress,
    to: toAddress,
    amount: net,
    pricePerToken: project.status.currentPriceUsd,
    chain,
    timestamp: Date.now(),
  });

  if (tax > 0) {
    project.transactions.push({
      id: `tx-${crypto.randomUUID().slice(0, 8)}-tax`,
      type: "tax",
      from: fromAddress,
      to: "revenue-share-pool",
      amount: tax,
      pricePerToken: project.status.currentPriceUsd,
      chain,
      timestamp: Date.now(),
    });
  }

  saveIcoProject(project);
  return { net, tax, project };
}

// ---------------------------------------------------------------------------
// Dashboard data
// ---------------------------------------------------------------------------

export interface IcoDashboard {
  project: IcoProject;
  currentPrice: number;
  percentToTarget: number;
  totalHolders: number;
  totalTransactions: number;
  recentTransactions: IcoTransaction[];
  topHolders: IcoHolder[];
}

export function getIcoDashboard(projectId: string): IcoDashboard | null {
  const project = getIcoProject(projectId);
  if (!project) {
    return null;
  }

  return {
    project,
    currentPrice: project.status.currentPriceUsd,
    percentToTarget: project.status.percentToTarget,
    totalHolders: project.holders.length,
    totalTransactions: project.transactions.length,
    recentTransactions: project.transactions.slice(-20).toReversed(),
    topHolders: [...project.holders].toSorted((a, b) => b.balance - a.balance).slice(0, 10),
  };
}
