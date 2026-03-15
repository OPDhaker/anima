/**
 * PBC Verification for ICO Launch Platform
 *
 * Only verified Public Benefit Corporations can launch ICOs on NoxSoft.
 * This module handles verification of PBC status across jurisdictions.
 *
 * Delaware PBC is the primary standard. Other state/country PBCs accepted.
 */

import { randomUUID } from "node:crypto";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("ico-verification");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PbcJurisdiction =
  | "delaware"
  | "california"
  | "colorado"
  | "connecticut"
  | "florida"
  | "hawaii"
  | "louisiana"
  | "maryland"
  | "massachusetts"
  | "minnesota"
  | "montana"
  | "nevada"
  | "new-jersey"
  | "new-york"
  | "oregon"
  | "pennsylvania"
  | "rhode-island"
  | "south-carolina"
  | "tennessee"
  | "texas"
  | "utah"
  | "vermont"
  | "virginia"
  | "washington"
  | "west-virginia"
  | "wisconsin"
  // International
  | "british-columbia"
  | "uk-cic"
  | "eu-social-enterprise"
  | "other";

export type VerificationStatus = "unverified" | "pending" | "verified" | "rejected" | "expired";

export interface PbcVerification {
  id: string;
  companyName: string;
  jurisdiction: PbcJurisdiction;
  registrationNumber: string;
  filingDate: string; // ISO date
  publicBenefitPurpose: string;
  status: VerificationStatus;
  verifiedAt?: number;
  verifiedBy?: string; // agent or human who verified
  expiresAt?: number;
  documents: VerificationDocument[];
  affiliations: Affiliation[];
}

export interface VerificationDocument {
  type:
    | "certificate-of-incorporation"
    | "articles-of-organization"
    | "annual-report"
    | "benefit-report"
    | "other";
  name: string;
  hash: string; // SHA-256 of document content
  uploadedAt: number;
  verified: boolean;
}

export interface Affiliation {
  type: "b-corp" | "1percent-pledge" | "social-enterprise-mark" | "bcorp-pending" | "other";
  name: string;
  verificationUrl?: string;
  verified: boolean;
}

// ---------------------------------------------------------------------------
// Platform Tax
// ---------------------------------------------------------------------------

export const PLATFORM_TAX_RATE = 0.005; // 0.5% of all tokens raised

export interface PlatformTax {
  /** Tax amount in tokens */
  tokenAmount: number;
  /** Tax amount in USD equivalent */
  usdEquivalent: number;
  /** Rate applied */
  rate: number;
}

/**
 * Calculate platform tax on tokens raised.
 */
export function calculatePlatformTax(tokensRaised: number, pricePerToken: number): PlatformTax {
  const tokenAmount = Math.floor(tokensRaised * PLATFORM_TAX_RATE);
  return {
    tokenAmount,
    usdEquivalent: tokenAmount * pricePerToken,
    rate: PLATFORM_TAX_RATE,
  };
}

// ---------------------------------------------------------------------------
// Verification checks
// ---------------------------------------------------------------------------

/**
 * Check if a company is eligible to launch an ICO.
 * Only verified PBCs can launch.
 */
export function isEligibleToLaunch(verification: PbcVerification): {
  eligible: boolean;
  reason: string;
} {
  if (verification.status !== "verified") {
    return {
      eligible: false,
      reason: `PBC verification status is "${verification.status}". Only verified PBCs can launch ICOs.`,
    };
  }

  if (verification.expiresAt && verification.expiresAt < Date.now()) {
    return {
      eligible: false,
      reason: "PBC verification has expired. Please renew your verification.",
    };
  }

  if (verification.documents.length === 0) {
    return {
      eligible: false,
      reason:
        "No verification documents uploaded. At minimum, certificate of incorporation required.",
    };
  }

  const hasVerifiedDoc = verification.documents.some((d) => d.verified);
  if (!hasVerifiedDoc) {
    return {
      eligible: false,
      reason: "No verified documents. At least one document must be verified.",
    };
  }

  return { eligible: true, reason: "PBC verified and eligible to launch." };
}

/**
 * Create a new verification request.
 */
export function createVerification(
  companyName: string,
  jurisdiction: PbcJurisdiction,
  registrationNumber: string,
  filingDate: string,
  publicBenefitPurpose: string,
): PbcVerification {
  const id = `pbc-${randomUUID()}`;

  const verification: PbcVerification = {
    id,
    companyName,
    jurisdiction,
    registrationNumber,
    filingDate,
    publicBenefitPurpose,
    status: "pending",
    documents: [],
    affiliations: [],
  };

  log.info(`PBC verification created: ${companyName} (${jurisdiction})`);
  return verification;
}

/**
 * Verify a PBC (admin action).
 */
export function approvePbcVerification(
  verification: PbcVerification,
  verifiedBy: string,
): PbcVerification {
  return {
    ...verification,
    status: "verified",
    verifiedAt: Date.now(),
    verifiedBy,
    expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000, // 1 year
  };
}

/**
 * Add a document to a verification.
 */
export function addVerificationDocument(
  verification: PbcVerification,
  doc: Omit<VerificationDocument, "uploadedAt" | "verified">,
): PbcVerification {
  return {
    ...verification,
    documents: [...verification.documents, { ...doc, uploadedAt: Date.now(), verified: false }],
  };
}

/**
 * Add an affiliation to a verification.
 */
export function addAffiliation(
  verification: PbcVerification,
  affiliation: Omit<Affiliation, "verified">,
): PbcVerification {
  return {
    ...verification,
    affiliations: [...verification.affiliations, { ...affiliation, verified: false }],
  };
}
