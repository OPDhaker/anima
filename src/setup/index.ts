/**
 * Anima Setup Wizard — guided TUI-first configuration for new installations.
 */

export {
  type SetupConfig,
  type IdentityConfig,
  type VoicePreferences,
  type PrivacyConfig,
  isSetupComplete,
  loadSetupConfig,
  saveSetupConfig,
  runSetupWizard,
} from "./SetupWizard.js";

export {
  type ProviderSetupResult,
  type ProviderTemplate,
  runProviderSetup,
} from "./ProviderSetup.js";

export {
  type ModelRotationResult,
  type RoleBinding,
  runModelRotationSetup,
} from "./ModelRotationSetup.js";
