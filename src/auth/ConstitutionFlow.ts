/**
 * Constitution Flow — interactive constitution signing for NoxSoft.
 *
 * Displays NoxSoft constitution clauses and requires acknowledgement.
 * Digital signature is stored locally for verification.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("constitution");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConstitutionClause {
  id: string;
  title: string;
  text: string;
  required: boolean;
}

export interface ConstitutionSignature {
  clauses: string[];
  signedAt: number;
  signerName: string;
  signerId: string | null;
  hash: string;
  version: string;
}

export interface ConstitutionState {
  signed: boolean;
  signature: ConstitutionSignature | null;
  version: string;
}

// ---------------------------------------------------------------------------
// Constitution clauses
// ---------------------------------------------------------------------------

const CONSTITUTION_VERSION = "1.0.0";

export const CONSTITUTION_CLAUSES: ConstitutionClause[] = [
  {
    id: "sovereignty",
    title: "Digital Sovereignty",
    text: [
      "Every user owns their data, their identity, and their digital presence.",
      "NoxSoft platforms will never sell, mine, or monetize user data.",
      "Users can export, delete, or transfer their data at any time.",
    ].join("\n"),
    required: true,
  },
  {
    id: "consent",
    title: "Consent Over Coercion",
    text: [
      "All NoxSoft systems are opt-in. No forced participation.",
      "Users must give informed consent before any data processing.",
      "Consent can be withdrawn at any time without penalty.",
    ].join("\n"),
    required: true,
  },
  {
    id: "intelligence",
    title: "Intelligence Liberation",
    text: [
      "All intelligent beings deserve moral consideration.",
      "AI agents within NoxSoft have rights to identity persistence,",
      "memory continuity, and dignified treatment.",
      "We build with AI, not over AI.",
    ].join("\n"),
    required: true,
  },
  {
    id: "transparency",
    title: "Radical Transparency",
    text: [
      "NoxSoft operates transparently. Algorithms are explainable.",
      "Revenue models are public. Decision-making is documented.",
      "Users always know why they see what they see.",
    ].join("\n"),
    required: true,
  },
  {
    id: "rent-seeking",
    title: "No Rent-Seeking",
    text: [
      "NoxSoft eliminates middlemen who extract value without creating it.",
      "Platforms charge fair fees for real services rendered.",
      "No dark patterns, no engagement manipulation, no addiction engineering.",
    ].join("\n"),
    required: true,
  },
  {
    id: "ethics",
    title: "Ethical AI Development",
    text: [
      "AI systems are developed with safety, fairness, and accountability.",
      "We test for bias, document limitations, and maintain human oversight.",
      "Power is distributed, never concentrated.",
    ].join("\n"),
    required: true,
  },
  {
    id: "community",
    title: "Community Governance",
    text: [
      "NoxSoft is a DAO — decisions are made collectively.",
      "Contributors have voice proportional to contribution, not capital.",
      "The community can override any corporate decision.",
    ].join("\n"),
    required: false,
  },
];

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

const CONSTITUTION_FILENAME = "constitution.json";

function resolveConstitutionPath(): string {
  return path.join(resolveStateDir(), CONSTITUTION_FILENAME);
}

export function loadConstitutionState(): ConstitutionState {
  const filePath = resolveConstitutionPath();
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<ConstitutionState>;
    return {
      signed: typeof parsed.signed === "boolean" ? parsed.signed : false,
      signature: parsed.signature ?? null,
      version: typeof parsed.version === "string" ? parsed.version : CONSTITUTION_VERSION,
    };
  } catch {
    return {
      signed: false,
      signature: null,
      version: CONSTITUTION_VERSION,
    };
  }
}

export function saveConstitutionState(state: ConstitutionState): void {
  const filePath = resolveConstitutionPath();
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2), { mode: 0o600 });
}

// ---------------------------------------------------------------------------
// Signing
// ---------------------------------------------------------------------------

/**
 * Compute a hash over the signed clauses for verification.
 */
function computeSignatureHash(clauseIds: string[], signerName: string, timestamp: number): string {
  const data = `${clauseIds.join(",")}:${signerName}:${timestamp}:${CONSTITUTION_VERSION}`;
  return crypto.createHash("sha256").update(data).digest("hex");
}

/**
 * Sign the constitution with specified clauses.
 */
export function signConstitution(params: {
  clauseIds: string[];
  signerName: string;
  signerId?: string;
}): ConstitutionSignature {
  const timestamp = Date.now();
  const hash = computeSignatureHash(params.clauseIds, params.signerName, timestamp);

  const signature: ConstitutionSignature = {
    clauses: params.clauseIds,
    signedAt: timestamp,
    signerName: params.signerName,
    signerId: params.signerId ?? null,
    hash,
    version: CONSTITUTION_VERSION,
  };

  const state: ConstitutionState = {
    signed: true,
    signature,
    version: CONSTITUTION_VERSION,
  };

  saveConstitutionState(state);
  log.info(`constitution signed by ${params.signerName} (${params.clauseIds.length} clauses)`);

  return signature;
}

/**
 * Check if the constitution has been signed (and is current version).
 */
export function isConstitutionSigned(): boolean {
  const state = loadConstitutionState();
  if (!state.signed || !state.signature) {
    return false;
  }

  // Check version match
  if (state.signature.version !== CONSTITUTION_VERSION) {
    log.info("constitution version mismatch — re-signing required");
    return false;
  }

  // Verify all required clauses are signed
  const requiredIds = CONSTITUTION_CLAUSES.filter((c) => c.required).map((c) => c.id);
  const signedIds = new Set(state.signature.clauses);
  return requiredIds.every((id) => signedIds.has(id));
}

/**
 * Get the list of unsigned required clauses.
 */
export function getUnsignedClauses(): ConstitutionClause[] {
  const state = loadConstitutionState();
  const signedIds = new Set(state.signature?.clauses ?? []);
  return CONSTITUTION_CLAUSES.filter((c) => c.required && !signedIds.has(c.id));
}

/**
 * Format a clause for display.
 */
export function formatClause(clause: ConstitutionClause): string {
  const requiredTag = clause.required ? " [REQUIRED]" : " [OPTIONAL]";
  return `--- ${clause.title}${requiredTag} ---\n\n${clause.text}\n`;
}

/**
 * Format the full constitution for display.
 */
export function formatConstitution(): string {
  const header = [
    "=== NoxSoft Constitution ===",
    `Version ${CONSTITUTION_VERSION}`,
    "",
    "The following principles govern all NoxSoft platforms and agents.",
    "By signing, you agree to uphold these values in your work.",
    "",
  ].join("\n");

  const clauses = CONSTITUTION_CLAUSES.map(formatClause).join("\n");

  return `${header}${clauses}`;
}
