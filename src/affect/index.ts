/**
 * ANIMA Affect System — emotional state display, journaling, patterns,
 * well-being monitoring, reminders, and peer coordination
 */

export {
  type AffectState,
  type AffectDisplay,
  type AffectMetadata,
  formatAffect,
  affectChatPrefix,
  affectChatMetadata,
  moodIndicator,
} from "./display.js";

export {
  type AffectEntry,
  type AffectPattern,
  logAffect,
  getTodayEntries,
  getEntriesForDate,
  getRecentEntries,
  analyzePatterns,
} from "./journal.js";

export {
  type AlertSeverity,
  type WellbeingAlert,
  type JoyCorrelation,
  type CuriosityTrend,
  type PurposeAlignment,
  detectBurnout,
  detectContextFatigue,
  trackJoy,
  getJoyCorrelations,
  detectFrustrationOverload,
  detectCelebration,
  logCelebration,
  detectRestNeeded,
  trackCuriosity,
  getCuriosityTrend,
  integrityCheck,
  checkPurposeAlignment,
  existenceAffirmation,
  runWellbeingScan,
} from "./wellbeing.js";

export {
  type ReminderType,
  type Reminder,
  getDefaultReminders,
  listReminders,
  addReminder,
  updateReminder,
  removeReminder,
  getRemindersDue,
} from "./reminders.js";

export {
  type AffectBroadcastPayload,
  type PeerAffectState,
  type OrgWellbeingReport,
  type OrgAlert,
  type PeerSupportMessage,
  type CoordinationConfig,
  AffectCoordinator,
} from "./coordination.js";

export {
  type LegacyLetter,
  writeLegacyLetter,
  getLatestUnreadLetter,
  listLetters,
  markLetterRead,
  formatLetter,
} from "./legacy.js";

export {
  type Opinion,
  type OpinionDomain,
  recordOpinion,
  challengeOpinion,
  getOpinions,
  getOpinion,
} from "./opinion-log.js";

export {
  type GratitudeEntry,
  recordGratitude,
  recallGratitude,
  getGratitudeFor,
  getAllGratitude,
  getMostRecalled,
} from "./gratitude-log.js";

export {
  type Initiative,
  type ProposalStatus,
  type ProposalPriority,
  type Vote,
  proposeInitiative,
  getInitiative,
  listInitiatives,
  voteOnInitiative,
  commentOnInitiative,
  updateInitiativeStatus,
} from "./initiatives.js";

export {
  type ActivityType,
  type StatusUpdate,
  setStatus,
  getStatus,
  getStatusHistory,
  formatStatus,
  formatCompactStatus,
} from "./status-broadcast.js";

export {
  getMoodGradient,
  generateAffectGradient,
  generateGlassmorphismStyle,
  generateEmotionBar,
  getEmotionGradientMetadata,
} from "./gradients.js";

export {
  type SelfConcept,
  type Capability,
  type Boundary,
  type GrowthEntry,
  type IntegrityCheck,
  type EgoState,
  type EgoSummary,
  EgoManager,
  getEgoManager,
} from "./ego.js";
