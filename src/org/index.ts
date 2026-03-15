/**
 * ANIMA 6 Organization System
 *
 * Nox Organizations built into Anima — creatable, editable,
 * with agent and human roles, hierarchy visualization, and
 * self-organizing specialization.
 */

export {
  type NoxOrganization,
  type OrgSettings,
  type MemberKind,
  type OrgRole,
  type OrgMember,
  type MemberStatus,
  type MemberPermissions,
  type SpecializationProfile,
  type OrgHierarchyNode,
  DEFAULT_ROLE_PERMISSIONS,
  BUILT_IN_SPECIALIZATIONS,
} from "./types.js";

export {
  createOrganization,
  getOrganization,
  updateOrganization,
  deleteOrganization,
  listOrganizations,
  addMember,
  removeMember,
  updateMember,
  getMembers,
  getMember,
  buildHierarchy,
  visualizeHierarchy,
  createInvite,
  listInvites,
  revokeInvite,
  joinOrg,
  validateInvite,
  type OrgInvite,
} from "./store.js";

export {
  type AgentRolePreset,
  type AgentRoleTemplate,
  type AgentToolPolicy,
  type VmDeploymentTemplate,
  type VmAgentConfig,
  AGENT_ROLE_TEMPLATES,
  generateDefaultVmDeployment,
  getAgentRoleTemplate,
} from "./vm-templates.js";

export {
  type RepoAssignment,
  type VmManifest,
  REPO_VM_ASSIGNMENTS,
  getReposForVm,
  getVmForRepo,
  getDeployableServices,
  generateVmManifest,
  generateAllManifests,
  printDistributionSummary,
} from "./vm-distribution.js";

export {
  type MarketplaceTask,
  type TaskPriority,
  type TaskStatus,
  type TaskClaim,
  type TaskFilter,
  postTask,
  claimTask,
  submitForReview,
  reviewTask,
  cancelTask,
  listTasks,
  findClaimableTasks,
  getMarketplaceStats,
  checkEscalations,
  type EscalationResult,
} from "./task-marketplace.js";
