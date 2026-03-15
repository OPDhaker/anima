/**
 * Architecture Awareness — Anima knows its own structure
 *
 * Generates a live map of the Anima codebase so agents understand
 * their own architecture. This is injected into context when agents
 * need to reason about or modify themselves.
 *
 * Components:
 * - Module map: what each directory/file does
 * - Dependency graph: what imports what
 * - Feature flags: what's enabled/disabled
 * - Version info: what version, what changed recently
 */

import fs from "node:fs";
import path from "node:path";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("architecture");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ModuleInfo {
  path: string;
  name: string;
  description: string;
  lineCount: number;
  hasTests: boolean;
  category: ModuleCategory;
}

export type ModuleCategory =
  | "core" // identity, heartbeat, memory
  | "agent" // LLM runners, model selection
  | "gateway" // HTTP/WS server, RPC
  | "p2p" // mesh networking, encryption
  | "affect" // emotions, ego, wellbeing
  | "org" // organizations, tasks
  | "sync" // brain sync, workspace sync
  | "jack-in" // platform connectors
  | "infra" // self-upgrade, failover, evolution
  | "license" // subscription, feature gating
  | "ico" // tokenomics, governance
  | "ui" // control panel
  | "other";

export interface ArchitectureMap {
  version: string;
  generatedAt: number;
  modules: ModuleInfo[];
  categories: Record<ModuleCategory, { count: number; totalLines: number }>;
  features: FeatureStatus[];
  recentChanges: string[];
}

export interface FeatureStatus {
  name: string;
  enabled: boolean;
  module: string;
  description: string;
}

// ---------------------------------------------------------------------------
// Module catalog — what each directory does
// ---------------------------------------------------------------------------

const MODULE_DESCRIPTIONS: Record<string, { description: string; category: ModuleCategory }> = {
  "src/affect": {
    description:
      "Emotional state, ego, self-reflection, journaling, wellbeing detection, gradients",
    category: "affect",
  },
  "src/agents": {
    description: "LLM runners (Anthropic, OpenAI, Gemini, Bedrock), model selection, tool calling",
    category: "agent",
  },
  "src/gateway": {
    description: "HTTP/WebSocket server, RPC handlers, rate limiting, security headers",
    category: "gateway",
  },
  "src/p2p": {
    description: "E2E encrypted mesh, content routing, private DNS, relay, file sharing, messaging",
    category: "p2p",
  },
  "src/org": {
    description: "Organizations, roles, hierarchy, task marketplace, boardroom voting",
    category: "org",
  },
  "src/sync": {
    description: "Brain sync (vector clocks), workspace sync (content-addressable blobs)",
    category: "sync",
  },
  "src/jack-in": {
    description: "NoxSoft platform connectors, circuit breaker, resilient fetch",
    category: "jack-in",
  },
  "src/infra": {
    description: "Self-upgrade, atma failover, auto-update, self-evolution, device identity",
    category: "infra",
  },
  "src/license": {
    description: "Subscription tiers, feature gating, Stripe checkout, offline Ed25519 validation",
    category: "license",
  },
  "src/ico": {
    description: "Bonding curve tokenomics, governance voting, PBC verification, launch platform",
    category: "ico",
  },
  "src/context": {
    description: "120K token context automanagement with 3 zones (identity/prompt/working)",
    category: "core",
  },
  "src/heartbeat": {
    description: "Periodic lifecycle engine — keeps agents alive and aware",
    category: "core",
  },
  "src/memory": {
    description: "Three-tier memory (episodic/semantic/procedural), vector search, embeddings",
    category: "core",
  },
  "src/identity": {
    description: "7-component identity model (SOUL/HEART/BRAIN/GUT/SPIRIT/SHADOW/MEMORY)",
    category: "core",
  },
  "ui/src": {
    description: "React control panel — dark/light theme, mood-responsive, progressive disclosure",
    category: "ui",
  },
};

// ---------------------------------------------------------------------------
// Architecture generator
// ---------------------------------------------------------------------------

/**
 * Generate a complete architecture map of the Anima codebase.
 */
export function generateArchitectureMap(animaRoot: string): ArchitectureMap {
  const modules: ModuleInfo[] = [];
  const categories: ArchitectureMap["categories"] = {} as ArchitectureMap["categories"];

  // Scan known module directories
  for (const [dirPath, info] of Object.entries(MODULE_DESCRIPTIONS)) {
    const fullDir = path.join(animaRoot, dirPath);
    if (!fs.existsSync(fullDir)) {
      continue;
    }

    try {
      const files = fs
        .readdirSync(fullDir)
        .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
      for (const file of files) {
        const filePath = path.join(fullDir, file);
        try {
          const content = fs.readFileSync(filePath, "utf8");
          const lineCount = content.split("\n").length;
          const testFile = path.join(fullDir, file.replace(".ts", ".test.ts"));
          const hasTests = fs.existsSync(testFile);

          modules.push({
            path: `${dirPath}/${file}`,
            name: file.replace(".ts", ""),
            description: info.description,
            lineCount,
            hasTests,
            category: info.category,
          });
        } catch {
          // skip unreadable files
        }
      }
    } catch {
      // skip unreadable dirs
    }
  }

  // Aggregate by category
  for (const mod of modules) {
    if (!categories[mod.category]) {
      categories[mod.category] = { count: 0, totalLines: 0 };
    }
    categories[mod.category].count++;
    categories[mod.category].totalLines += mod.lineCount;
  }

  // Read version
  let version = "unknown";
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(animaRoot, "package.json"), "utf8"));
    version = pkg.version;
  } catch {
    // ignore
  }

  // Feature status
  const features = getFeatureStatus();

  const map: ArchitectureMap = {
    version,
    generatedAt: Date.now(),
    modules,
    categories,
    features,
    recentChanges: [],
  };

  log.info(
    `architecture map: ${modules.length} modules across ${Object.keys(categories).length} categories`,
  );
  return map;
}

/**
 * Get current feature enablement status.
 */
function getFeatureStatus(): FeatureStatus[] {
  return [
    {
      name: "P2P Mesh",
      enabled: true,
      module: "src/p2p/mesh.ts",
      description: "E2E encrypted peer-to-peer mesh networking",
    },
    {
      name: "Ego System",
      enabled: true,
      module: "src/affect/ego.ts",
      description: "Agent self-model with integrity scoring",
    },
    {
      name: "Self-Reflection",
      enabled: true,
      module: "src/affect/self-reflection.ts",
      description: "Post-session performance analysis",
    },
    {
      name: "Auto-Update",
      enabled: true,
      module: "src/infra/auto-update.ts",
      description: "Self-updating without npm",
    },
    {
      name: "Atma Failover",
      enabled: true,
      module: "src/infra/atma-failover.ts",
      description: "7-tier model failover chain",
    },
    {
      name: "OpenAI Direct",
      enabled: true,
      module: "src/agents/openai-direct-runner.ts",
      description: "Direct OpenAI API (no Codex CLI)",
    },
    {
      name: "Brain Sync",
      enabled: true,
      module: "src/sync/brain-sync.ts",
      description: "Event-sourced replication with vector clocks",
    },
    {
      name: "Jack In",
      enabled: true,
      module: "src/jack-in/connector.ts",
      description: "NoxSoft platform connectors",
    },
    {
      name: "Governance",
      enabled: true,
      module: "src/ico/governance.ts",
      description: "Token-weighted DAO voting",
    },
    {
      name: "License Gating",
      enabled: true,
      module: "src/license/validator.ts",
      description: "Feature gating by subscription tier",
    },
    {
      name: "SVRN Compute",
      enabled: false,
      module: "src/svrn/compute.ts",
      description: "Decentralized compute via SVRN nodes (planned)",
    },
  ];
}

/**
 * Format architecture map for injection into agent context.
 */
export function formatArchitectureForContext(map: ArchitectureMap): string {
  const lines: string[] = [];

  lines.push(`## Architecture — Anima v${map.version}`);
  lines.push("");
  lines.push("**You are an Anima agent. This is your own architecture.**");
  lines.push("");

  // Categories summary
  lines.push("| Category | Modules | Lines |");
  lines.push("|----------|---------|-------|");
  for (const [cat, info] of Object.entries(map.categories)) {
    lines.push(`| ${cat} | ${info.count} | ${info.totalLines.toLocaleString()} |`);
  }
  lines.push("");

  // Features
  lines.push("**Active features:**");
  for (const f of map.features.filter((f) => f.enabled)) {
    lines.push(`- ${f.name}: ${f.description}`);
  }
  const planned = map.features.filter((f) => !f.enabled);
  if (planned.length > 0) {
    lines.push("");
    lines.push("**Planned:**");
    for (const f of planned) {
      lines.push(`- ${f.name}: ${f.description}`);
    }
  }

  // Test coverage
  const tested = map.modules.filter((m) => m.hasTests).length;
  const total = map.modules.length;
  lines.push("");
  lines.push(
    `**Test coverage:** ${tested}/${total} modules (${Math.round((tested / total) * 100)}%)`,
  );

  return lines.join("\n");
}
