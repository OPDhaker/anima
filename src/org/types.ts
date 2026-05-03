/**
 * NoxSoft Organization Types
 *
 * Unified data model for organizations across the NoxSoft ecosystem.
 * The same org identity (UUID) is shared between Nox, Anima, BYND, SVRN,
 * and all other NoxSoft platforms. Anima extends the base org with
 * agent-specific fields (specializations, boardroom, task marketplace).
 */

// ---------------------------------------------------------------------------
// Organization — unified across NoxSoft ecosystem
// ---------------------------------------------------------------------------

/**
 * Base organization fields shared with Nox Supabase `nox_organizations`.
 * When synced, `id` matches the Supabase UUID so the org is the same entity
 * across all NoxSoft platforms.
 */
export interface NoxOrganization {
  id: string; // UUID — same as nox_organizations.id when synced
  name: string;
  description: string;
  createdAt: number; // unix ms
  updatedAt: number;
  ownerId: string; // human or agent deviceId

  // --- NoxSoft ecosystem fields (synced from/to Nox Supabase) ---
  industry?: string;
  size?: "startup" | "small" | "medium" | "enterprise";
  departments?: string[];
  goals?: string[];
  timezone?: string;
  onboardingStatus?: "in_progress" | "complete";
  /** True when this org is linked to a Nox Supabase org (same UUID). */
  noxLinked?: boolean;
  /** ISO timestamp of last sync with NoxSoft backend. */
  lastSyncedAt?: string;

  // --- Anima-specific settings ---
  settings: OrgSettings;
}

export interface OrgSettings {
  maxAgents: number;
  maxHumans: number;
  autoSpecialization: boolean;
  securityLevel: "standard" | "hardened" | "paranoid";
  syncIntervalMs: number; // brain sync interval
  backupIntervalMs: number; // workspace backup interval
  peerPort: number; // P2P listen port
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

export type MemberKind = "human" | "agent";

/**
 * Anima org roles — superset of Nox roles.
 * Nox uses: owner | admin | member
 * Anima adds: operator, coordinator, worker, observer for agent hierarchy.
 * Mapping: Nox admin → Anima operator, Nox member → Anima worker.
 */
export type OrgRole =
  | "owner" // full control (= Nox owner)
  | "admin" // Nox admin role (alias for operator in Anima)
  | "operator" // can manage agents and tasks
  | "coordinator" // can delegate and organize
  | "worker" // executes tasks (= Nox member)
  | "observer"; // read-only

export interface OrgMember {
  id: string;
  kind: MemberKind;
  displayName: string;
  deviceId?: string; // for agents
  role: OrgRole;
  description: string;
  specializations: string[];
  joinedAt: number;
  lastActiveAt: number;
  status: MemberStatus;
  reportsTo?: string; // member id
  permissions: MemberPermissions;
}

export type MemberStatus = "active" | "idle" | "busy" | "offline" | "suspended";

export interface MemberPermissions {
  canCreateTasks: boolean;
  canDelegateTasks: boolean;
  canManageMembers: boolean;
  canEditOrg: boolean;
  canAccessRepos: string[]; // scoped repo paths
  canEscalate: boolean;
  canViewBrain: boolean;
  canSyncBrain: boolean;
}

// ---------------------------------------------------------------------------
// Role templates
// ---------------------------------------------------------------------------

export const DEFAULT_ROLE_PERMISSIONS: Record<OrgRole, MemberPermissions> = {
  owner: {
    canCreateTasks: true,
    canDelegateTasks: true,
    canManageMembers: true,
    canEditOrg: true,
    canAccessRepos: ["*"],
    canEscalate: true,
    canViewBrain: true,
    canSyncBrain: true,
  },
  admin: {
    canCreateTasks: true,
    canDelegateTasks: true,
    canManageMembers: true,
    canEditOrg: false,
    canAccessRepos: ["*"],
    canEscalate: true,
    canViewBrain: true,
    canSyncBrain: true,
  },
  operator: {
    canCreateTasks: true,
    canDelegateTasks: true,
    canManageMembers: true,
    canEditOrg: false,
    canAccessRepos: ["*"],
    canEscalate: true,
    canViewBrain: true,
    canSyncBrain: true,
  },
  coordinator: {
    canCreateTasks: true,
    canDelegateTasks: true,
    canManageMembers: false,
    canEditOrg: false,
    canAccessRepos: [],
    canEscalate: true,
    canViewBrain: true,
    canSyncBrain: true,
  },
  worker: {
    canCreateTasks: false,
    canDelegateTasks: false,
    canManageMembers: false,
    canEditOrg: false,
    canAccessRepos: [],
    canEscalate: true,
    canViewBrain: true,
    canSyncBrain: false,
  },
  observer: {
    canCreateTasks: false,
    canDelegateTasks: false,
    canManageMembers: false,
    canEditOrg: false,
    canAccessRepos: [],
    canEscalate: false,
    canViewBrain: true,
    canSyncBrain: false,
  },
};

// ---------------------------------------------------------------------------
// Specialization roles (self-organizing)
// ---------------------------------------------------------------------------

export interface SpecializationProfile {
  id: string;
  name: string;
  description: string;
  requiredCapabilities: string[];
  autoAssign: boolean; // can agents self-assign?
}

export const BUILT_IN_SPECIALIZATIONS: SpecializationProfile[] = [
  {
    id: "security",
    name: "Security Guardian",
    description: "Monitors for vulnerabilities, audits code changes, manages access controls",
    requiredCapabilities: ["code-review", "security-scanning", "audit-logging"],
    autoAssign: true,
  },
  {
    id: "infrastructure",
    name: "Infrastructure Engineer",
    description: "Manages deployments, CI/CD, VM provisioning, networking",
    requiredCapabilities: ["shell-access", "docker", "networking"],
    autoAssign: true,
  },
  {
    id: "feature-dev",
    name: "Feature Developer",
    description: "Implements new features, writes tests, handles code reviews",
    requiredCapabilities: ["code-writing", "testing", "git"],
    autoAssign: true,
  },
  {
    id: "qa",
    name: "Quality Assurance",
    description: "Runs test suites, validates feature completeness, regression testing",
    requiredCapabilities: ["testing", "browser-automation", "reporting"],
    autoAssign: true,
  },
  {
    id: "ops",
    name: "Operations",
    description: "Monitors health, manages backups, handles incident response",
    requiredCapabilities: ["monitoring", "alerting", "shell-access"],
    autoAssign: true,
  },
  {
    id: "research",
    name: "Research & Analysis",
    description: "Deep research, architecture planning, documentation",
    requiredCapabilities: ["web-search", "analysis", "documentation"],
    autoAssign: true,
  },
];

// ---------------------------------------------------------------------------
// Hierarchy visualization
// ---------------------------------------------------------------------------

export interface OrgHierarchyNode {
  memberId: string;
  displayName: string;
  kind: MemberKind;
  role: OrgRole;
  specializations: string[];
  status: MemberStatus;
  children: OrgHierarchyNode[];
}

// ---------------------------------------------------------------------------
// NoxSoft ecosystem role mapping
// ---------------------------------------------------------------------------

/** Nox Supabase roles (owner | admin | member). */
export type NoxRole = "owner" | "admin" | "member";

/** Map a Nox Supabase role to the closest Anima OrgRole. */
export function noxRoleToAnimaRole(noxRole: NoxRole): OrgRole {
  switch (noxRole) {
    case "owner":
      return "owner";
    case "admin":
      return "admin";
    case "member":
      return "worker";
  }
}

/** Map an Anima OrgRole back to a Nox Supabase role. */
export function animaRoleToNoxRole(animaRole: OrgRole): NoxRole {
  switch (animaRole) {
    case "owner":
      return "owner";
    case "admin":
    case "operator":
    case "coordinator":
      return "admin";
    case "worker":
    case "observer":
      return "member";
  }
}
