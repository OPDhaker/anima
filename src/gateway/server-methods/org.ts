import type { MemberKind, OrgRole, MemberStatus } from "../../org/types.js";
import type { GatewayRequestHandlers } from "./types.js";
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
};
