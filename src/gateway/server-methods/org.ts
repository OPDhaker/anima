import type { VoteValue } from "../../org/boardroom.js";
import type { MemberKind, OrgRole, MemberStatus } from "../../org/types.js";
import type { GatewayRequestHandlers } from "./types.js";
import {
  createSession,
  startSession,
  joinSession,
  concludeSession,
  addDecision,
  createProposal,
  castVote,
  resolveProposalVote,
  listSessions,
  listProposals,
  getSession,
  getProposal,
} from "../../org/boardroom.js";
// Note: we reuse INVALID_REQUEST for not-found since the protocol has no NOT_FOUND code
import {
  listOrganizations,
  getOrganization,
  createOrganization,
  updateOrganization,
  getMembers,
  addMember,
  updateMember,
  removeMember,
  buildHierarchy,
  createInvite,
  joinOrg,
  validateInvite,
} from "../../org/store.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";

function invalid(message: string) {
  return errorShape(ErrorCodes.INVALID_REQUEST, message);
}

function requireString(params: Record<string, unknown>, key: string): string | null {
  const val = params[key];
  return typeof val === "string" ? val.trim() || null : null;
}

export const orgHandlers: GatewayRequestHandlers = {
  "org.list": async ({ respond }) => {
    try {
      const orgs = listOrganizations();
      respond(true, { orgs }, undefined);
    } catch (error) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(error)));
    }
  },

  "org.get": async ({ params, respond }) => {
    const orgId = requireString(params, "orgId");
    if (!orgId) {
      respond(false, undefined, invalid("orgId is required"));
      return;
    }
    try {
      const org = getOrganization(orgId);
      if (!org) {
        respond(false, undefined, invalid("Organization not found"));
        return;
      }
      const members = getMembers(orgId);
      respond(true, { org, members }, undefined);
    } catch (error) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(error)));
    }
  },

  "org.create": async ({ params, respond }) => {
    const name = requireString(params, "name");
    const description = requireString(params, "description") ?? "";
    const ownerId = requireString(params, "ownerId");
    const ownerName = requireString(params, "ownerName");
    const ownerKind = requireString(params, "ownerKind") as MemberKind | null;

    if (!name) {
      respond(false, undefined, invalid("name is required"));
      return;
    }
    if (!ownerId) {
      respond(false, undefined, invalid("ownerId is required"));
      return;
    }
    if (!ownerName) {
      respond(false, undefined, invalid("ownerName is required"));
      return;
    }
    if (!ownerKind || (ownerKind !== "human" && ownerKind !== "agent")) {
      respond(false, undefined, invalid('ownerKind must be "human" or "agent"'));
      return;
    }

    const settings =
      params.settings && typeof params.settings === "object" && !Array.isArray(params.settings)
        ? (params.settings as Record<string, unknown>)
        : undefined;

    try {
      const org = createOrganization(
        name,
        description,
        ownerId,
        ownerName,
        ownerKind,
        settings as any,
      );
      const members = getMembers(org.id);
      respond(true, { org, members }, undefined);
    } catch (error) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(error)));
    }
  },

  "org.update": async ({ params, respond }) => {
    const orgId = requireString(params, "orgId");
    if (!orgId) {
      respond(false, undefined, invalid("orgId is required"));
      return;
    }

    const updates: Record<string, unknown> = {};
    const name = requireString(params, "name");
    if (name) {
      updates.name = name;
    }
    const description = requireString(params, "description");
    if (description) {
      updates.description = description;
    }
    if (params.settings && typeof params.settings === "object" && !Array.isArray(params.settings)) {
      updates.settings = params.settings;
    }

    try {
      const org = updateOrganization(orgId, updates as any);
      if (!org) {
        respond(false, undefined, invalid("Organization not found"));
        return;
      }
      respond(true, { org }, undefined);
    } catch (error) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(error)));
    }
  },

  "org.addMember": async ({ params, respond }) => {
    const orgId = requireString(params, "orgId");
    if (!orgId) {
      respond(false, undefined, invalid("orgId is required"));
      return;
    }

    const displayName = requireString(params, "displayName");
    if (!displayName) {
      respond(false, undefined, invalid("displayName is required"));
      return;
    }

    const kind = requireString(params, "kind") as MemberKind | null;
    if (!kind || (kind !== "human" && kind !== "agent")) {
      respond(false, undefined, invalid('kind must be "human" or "agent"'));
      return;
    }

    const role = (requireString(params, "role") ?? "worker") as OrgRole;
    const description = requireString(params, "description") ?? "";
    const specializations = Array.isArray(params.specializations)
      ? (params.specializations as string[])
      : [];
    const status = (requireString(params, "status") ?? "active") as MemberStatus;
    const reportsTo = requireString(params, "reportsTo") ?? undefined;

    try {
      const member = addMember(orgId, {
        kind,
        displayName,
        role,
        description,
        specializations,
        status,
        reportsTo,
      });
      if (!member) {
        respond(false, undefined, invalid("Organization not found"));
        return;
      }
      respond(true, { member }, undefined);
    } catch (error) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(error)));
    }
  },

  "org.updateMember": async ({ params, respond }) => {
    const orgId = requireString(params, "orgId");
    const memberId = requireString(params, "memberId");
    if (!orgId) {
      respond(false, undefined, invalid("orgId is required"));
      return;
    }
    if (!memberId) {
      respond(false, undefined, invalid("memberId is required"));
      return;
    }

    const updates: Record<string, unknown> = {};
    const displayName = requireString(params, "displayName");
    if (displayName) {
      updates.displayName = displayName;
    }
    const role = requireString(params, "role");
    if (role) {
      updates.role = role;
    }
    const description = params.description;
    if (typeof description === "string") {
      updates.description = description;
    }
    if (Array.isArray(params.specializations)) {
      updates.specializations = params.specializations;
    }
    const status = requireString(params, "status");
    if (status) {
      updates.status = status;
    }
    if (params.reportsTo !== undefined) {
      updates.reportsTo = typeof params.reportsTo === "string" ? params.reportsTo : undefined;
    }

    try {
      const member = updateMember(orgId, memberId, updates as any);
      if (!member) {
        respond(false, undefined, invalid("Member not found"));
        return;
      }
      respond(true, { member }, undefined);
    } catch (error) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(error)));
    }
  },

  "org.removeMember": async ({ params, respond }) => {
    const orgId = requireString(params, "orgId");
    const memberId = requireString(params, "memberId");
    if (!orgId) {
      respond(false, undefined, invalid("orgId is required"));
      return;
    }
    if (!memberId) {
      respond(false, undefined, invalid("memberId is required"));
      return;
    }

    try {
      const removed = removeMember(orgId, memberId);
      if (!removed) {
        respond(false, undefined, invalid("Member not found"));
        return;
      }
      respond(true, { ok: true }, undefined);
    } catch (error) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(error)));
    }
  },

  "org.hierarchy": async ({ params, respond }) => {
    const orgId = requireString(params, "orgId");
    if (!orgId) {
      respond(false, undefined, invalid("orgId is required"));
      return;
    }

    try {
      const org = getOrganization(orgId);
      if (!org) {
        respond(false, undefined, invalid("Organization not found"));
        return;
      }
      const hierarchy = buildHierarchy(orgId);
      respond(true, { hierarchy }, undefined);
    } catch (error) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(error)));
    }
  },

  "org.createInvite": async ({ params, respond }) => {
    const orgId = requireString(params, "orgId");
    const passcode = requireString(params, "passcode");
    if (!orgId || !passcode) {
      respond(false, undefined, invalid("orgId and passcode are required"));
      return;
    }
    try {
      const role = (requireString(params, "role") as OrgRole) ?? "worker";
      const maxUses = typeof params.maxUses === "number" ? params.maxUses : 0;
      const expiresInMs = typeof params.expiresInMs === "number" ? params.expiresInMs : 0;
      const invite = createInvite(orgId, "gateway", passcode, { role, maxUses, expiresInMs });
      if (!invite) {
        respond(false, undefined, invalid("Organization not found"));
        return;
      }
      respond(true, { code: invite.code, passcode }, undefined);
    } catch (error) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(error)));
    }
  },

  "org.validateInvite": async ({ params, respond }) => {
    const inviteCode = requireString(params, "inviteCode");
    const passcode = requireString(params, "passcode");
    if (!inviteCode || !passcode) {
      respond(false, undefined, invalid("inviteCode and passcode are required"));
      return;
    }
    try {
      const result = validateInvite(inviteCode, passcode);
      if (!result) {
        respond(false, undefined, invalid("Invalid invite code or passcode"));
        return;
      }
      respond(true, { org: result.org, role: result.role }, undefined);
    } catch (error) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(error)));
    }
  },

  "org.join": async ({ params, respond }) => {
    const inviteCode = requireString(params, "inviteCode");
    const passcode = requireString(params, "passcode");
    const displayName = requireString(params, "displayName");
    const kind = (requireString(params, "kind") as MemberKind) ?? "agent";
    if (!inviteCode || !passcode || !displayName) {
      respond(false, undefined, invalid("inviteCode, passcode, and displayName are required"));
      return;
    }
    try {
      const description = requireString(params, "description") ?? "";
      const specializations = Array.isArray(params.specializations)
        ? (params.specializations as string[])
        : [];
      const result = joinOrg(inviteCode, passcode, {
        displayName,
        kind,
        description,
        specializations,
      });
      if (!result) {
        respond(false, undefined, invalid("Invalid invite code, passcode, or already a member"));
        return;
      }
      respond(true, { org: result.org, member: result.member }, undefined);
    } catch (error) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(error)));
    }
  },

  // -------------------------------------------------------------------------
  // Boardroom — sessions, proposals, voting
  // -------------------------------------------------------------------------

  "boardroom.createSession": async ({ params, respond }) => {
    const orgId = requireString(params, "orgId");
    const calledBy = requireString(params, "calledBy");
    const title = requireString(params, "title");
    if (!orgId || !calledBy || !title) {
      respond(false, undefined, invalid("orgId, calledBy, and title are required"));
      return;
    }
    try {
      const description = requireString(params, "description") ?? "";
      const agenda = Array.isArray(params.agenda)
        ? (params.agenda as Array<{ title: string; description: string; duration?: number }>)
        : [];
      const session = createSession(orgId, calledBy, title, description, agenda);
      respond(true, { session }, undefined);
    } catch (error) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(error)));
    }
  },

  "boardroom.startSession": async ({ params, respond }) => {
    const sessionId = requireString(params, "sessionId");
    const chairId = requireString(params, "chairId");
    if (!sessionId || !chairId) {
      respond(false, undefined, invalid("sessionId and chairId are required"));
      return;
    }
    try {
      const session = startSession(sessionId, chairId);
      if (!session) {
        respond(false, undefined, invalid("Session not found or not scheduled"));
        return;
      }
      respond(true, { session }, undefined);
    } catch (error) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(error)));
    }
  },

  "boardroom.joinSession": async ({ params, respond }) => {
    const sessionId = requireString(params, "sessionId");
    const memberId = requireString(params, "memberId");
    const displayName = requireString(params, "displayName");
    const kind = (requireString(params, "kind") as "human" | "agent") ?? "agent";
    if (!sessionId || !memberId || !displayName) {
      respond(false, undefined, invalid("sessionId, memberId, and displayName are required"));
      return;
    }
    try {
      const session = joinSession(sessionId, memberId, displayName, kind);
      if (!session) {
        respond(false, undefined, invalid("Session not found or not active"));
        return;
      }
      respond(true, { session }, undefined);
    } catch (error) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(error)));
    }
  },

  "boardroom.concludeSession": async ({ params, respond }) => {
    const sessionId = requireString(params, "sessionId");
    if (!sessionId) {
      respond(false, undefined, invalid("sessionId is required"));
      return;
    }
    try {
      const minutes = requireString(params, "minutes") ?? undefined;
      const session = concludeSession(sessionId, minutes);
      if (!session) {
        respond(false, undefined, invalid("Session not found or not active"));
        return;
      }
      respond(true, { session }, undefined);
    } catch (error) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(error)));
    }
  },

  "boardroom.addDecision": async ({ params, respond }) => {
    const sessionId = requireString(params, "sessionId");
    const title = requireString(params, "title");
    const description = requireString(params, "description") ?? "";
    const madeBy = requireString(params, "madeBy");
    if (!sessionId || !title || !madeBy) {
      respond(false, undefined, invalid("sessionId, title, and madeBy are required"));
      return;
    }
    try {
      const session = addDecision(sessionId, title, description, madeBy, {
        proposalId: requireString(params, "proposalId") ?? undefined,
        supporters: Array.isArray(params.supporters) ? (params.supporters as string[]) : undefined,
        actionItems: Array.isArray(params.actionItems)
          ? (params.actionItems as Array<{ description: string; assignee: string; dueBy?: number }>)
          : undefined,
      });
      if (!session) {
        respond(false, undefined, invalid("Session not found or not active"));
        return;
      }
      respond(true, { session }, undefined);
    } catch (error) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(error)));
    }
  },

  "boardroom.listSessions": async ({ params, respond }) => {
    const orgId = requireString(params, "orgId");
    if (!orgId) {
      respond(false, undefined, invalid("orgId is required"));
      return;
    }
    try {
      const status = requireString(params, "status") as any;
      const sessions = listSessions(orgId, status ?? undefined);
      respond(true, { sessions }, undefined);
    } catch (error) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(error)));
    }
  },

  "boardroom.getSession": async ({ params, respond }) => {
    const sessionId = requireString(params, "sessionId");
    if (!sessionId) {
      respond(false, undefined, invalid("sessionId is required"));
      return;
    }
    try {
      const session = getSession(sessionId);
      if (!session) {
        respond(false, undefined, invalid("Session not found"));
        return;
      }
      respond(true, { session }, undefined);
    } catch (error) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(error)));
    }
  },

  "boardroom.createProposal": async ({ params, respond }) => {
    const orgId = requireString(params, "orgId");
    const proposedBy = requireString(params, "proposedBy");
    const title = requireString(params, "title");
    if (!orgId || !proposedBy || !title) {
      respond(false, undefined, invalid("orgId, proposedBy, and title are required"));
      return;
    }
    try {
      const description = requireString(params, "description") ?? "";
      const proposal = createProposal(orgId, proposedBy, title, description, {
        sessionId: requireString(params, "sessionId") ?? undefined,
        threshold: typeof params.threshold === "number" ? params.threshold : undefined,
        eligibleVoters: Array.isArray(params.eligibleVoters)
          ? (params.eligibleVoters as string[])
          : undefined,
        votingDeadline:
          typeof params.votingDeadline === "number" ? params.votingDeadline : undefined,
      });
      respond(true, { proposal }, undefined);
    } catch (error) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(error)));
    }
  },

  "boardroom.castVote": async ({ params, respond }) => {
    const proposalId = requireString(params, "proposalId");
    const voterId = requireString(params, "voterId");
    const voterName = requireString(params, "voterName");
    const value = requireString(params, "value") as VoteValue | null;
    if (!proposalId || !voterId || !voterName || !value) {
      respond(false, undefined, invalid("proposalId, voterId, voterName, and value are required"));
      return;
    }
    if (value !== "approve" && value !== "reject" && value !== "abstain") {
      respond(false, undefined, invalid('value must be "approve", "reject", or "abstain"'));
      return;
    }
    try {
      const reason = requireString(params, "reason") ?? undefined;
      const proposal = castVote(proposalId, voterId, voterName, value, reason);
      if (!proposal) {
        respond(false, undefined, invalid("Proposal not found, closed, or voter not eligible"));
        return;
      }
      respond(true, { proposal }, undefined);
    } catch (error) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(error)));
    }
  },

  "boardroom.resolveVote": async ({ params, respond }) => {
    const proposalId = requireString(params, "proposalId");
    if (!proposalId) {
      respond(false, undefined, invalid("proposalId is required"));
      return;
    }
    try {
      const proposal = resolveProposalVote(proposalId);
      if (!proposal) {
        respond(false, undefined, invalid("Proposal not found or not open"));
        return;
      }
      respond(true, { proposal }, undefined);
    } catch (error) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(error)));
    }
  },

  "boardroom.listProposals": async ({ params, respond }) => {
    const orgId = requireString(params, "orgId");
    if (!orgId) {
      respond(false, undefined, invalid("orgId is required"));
      return;
    }
    try {
      const status = requireString(params, "status") as any;
      const proposals = listProposals(orgId, status ?? undefined);
      respond(true, { proposals }, undefined);
    } catch (error) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(error)));
    }
  },

  "boardroom.getProposal": async ({ params, respond }) => {
    const proposalId = requireString(params, "proposalId");
    if (!proposalId) {
      respond(false, undefined, invalid("proposalId is required"));
      return;
    }
    try {
      const proposal = getProposal(proposalId);
      if (!proposal) {
        respond(false, undefined, invalid("Proposal not found"));
        return;
      }
      respond(true, { proposal }, undefined);
    } catch (error) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(error)));
    }
  },
};
