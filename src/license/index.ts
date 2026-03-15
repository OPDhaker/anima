/**
 * ANIMA 6 License & Payment System
 *
 * NoxSoft subscription: $20/mo via Stripe.
 * Community tier free forever with generous limits.
 */

export {
  type License,
  type LicenseTier,
  type LicenseStatus,
  type LicenseLimits,
  type GatedFeature,
  type FeatureCheckResult,
  type FeatureGate,
  TIER_LIMITS,
} from "./types.js";

export {
  loadLicense,
  saveLicense,
  validateLicense,
  createFeatureGate,
  getFeatureGate,
  refreshFeatureGate,
  type LicenseValidationResult,
} from "./validator.js";
