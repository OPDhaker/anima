/**
 * NoxSoft ICO — Dual-chain token launch platform
 *
 * Bonding curve to $2M, then free market.
 * Free to launch. NoxSoft does its own ICO first.
 */

export {
  type TokenAllocation,
  type BondingCurveConfig,
  type TaxConfig,
  type Chain,
  type IcoLaunchConfig,
  type IcoStatus,
  type ChainStatus,
  NOXSOFT_TOKEN_ALLOCATION,
  NOXSOFT_TAX_CONFIG,
  NOXSOFT_ICO_CONFIG,
  DEFAULT_BONDING_CURVE,
  bondingCurvePrice,
  tokensForInvestment,
  totalRaisedAtSupply,
  isBondingCapReached,
  calculateTransferTax,
  calculateRevenueShare,
  createIcoStatus,
} from "./tokenomics.js";

export {
  type IcoProject,
  type IcoHolder,
  type IcoTransaction,
  type IcoDashboard,
  createIcoProject,
  getIcoProject,
  listIcoProjects,
  buyTokens,
  transferTokens,
  getIcoDashboard,
} from "./launch-platform.js";

export {
  type PbcJurisdiction,
  type VerificationStatus,
  type PbcVerification,
  type VerificationDocument,
  type Affiliation,
  type PlatformTax,
  PLATFORM_TAX_RATE,
  calculatePlatformTax,
  isEligibleToLaunch,
  createVerification,
  approvePbcVerification,
  addVerificationDocument,
  addAffiliation,
} from "./verification.js";

export {
  type IcoPublicMetricState,
  type IcoPublicMetricSourceStatus,
  type IcoPublicProjectSnapshot,
  type IcoPublicMetric,
  type IcoPublicMetricsFeed,
  buildIcoPublicMetricsFeed,
  resolveMetricState,
} from "./public-metrics.js";
