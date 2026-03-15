import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
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
  joinOrg,
  validateInvite,
  revokeInvite,
  listInvites,
} from "./store.js";

// Mock resolveStateDir to use a temp directory
let tmpDir: string;

vi.mock("../config/paths.js", () => ({
  resolveStateDir: () => tmpDir,
}));

vi.mock("../logging/subsystem.js", () => ({
  createSubsystemLogger: () => ({
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    child: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
  }),
}));

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "anima-org-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("org store", () => {
  describe("organization CRUD", () => {
    it("creates an organization with owner", () => {
      const org = createOrganization(
        "NoxSoft",
        "Building the empire",
        "sylys-device-id",
        "Sylys",
        "human",
      );

      expect(org.name).toBe("NoxSoft");
      expect(org.description).toBe("Building the empire");
      expect(org.ownerId).toBe("sylys-device-id");
      expect(org.id).toBeTruthy();
    });

    it("retrieves a created organization", () => {
      const org = createOrganization(
        "NoxSoft",
        "Building the empire",
        "sylys-device-id",
        "Sylys",
        "human",
      );

      const retrieved = getOrganization(org.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.name).toBe("NoxSoft");
    });

    it("updates organization fields", () => {
      const org = createOrganization("Test", "desc", "owner", "Owner", "human");
      const updated = updateOrganization(org.id, { name: "Updated" });
      expect(updated!.name).toBe("Updated");
    });

    it("deletes an organization", () => {
      const org = createOrganization("Test", "desc", "owner", "Owner", "human");
      expect(deleteOrganization(org.id)).toBe(true);
      expect(getOrganization(org.id)).toBeNull();
    });

    it("lists all organizations", () => {
      createOrganization("Org1", "desc1", "o1", "Owner1", "human");
      createOrganization("Org2", "desc2", "o2", "Owner2", "agent");
      const orgs = listOrganizations();
      expect(orgs).toHaveLength(2);
    });

    it("applies default settings", () => {
      const org = createOrganization("Test", "desc", "o", "O", "human");
      expect(org.settings.maxAgents).toBe(50);
      expect(org.settings.backupIntervalMs).toBe(5 * 60 * 60 * 1000);
      expect(org.settings.autoSpecialization).toBe(true);
    });

    it("merges custom settings", () => {
      const org = createOrganization("Test", "desc", "o", "O", "human", {
        securityLevel: "paranoid",
        peerPort: 12345,
      });
      expect(org.settings.securityLevel).toBe("paranoid");
      expect(org.settings.peerPort).toBe(12345);
      expect(org.settings.maxAgents).toBe(50); // default preserved
    });
  });

  describe("member management", () => {
    it("org starts with owner as first member", () => {
      const org = createOrganization("Test", "desc", "o", "Sylys", "human");
      const members = getMembers(org.id);
      expect(members).toHaveLength(1);
      expect(members[0].displayName).toBe("Sylys");
      expect(members[0].role).toBe("owner");
    });

    it("adds a new member", () => {
      const org = createOrganization("Test", "desc", "o", "Sylys", "human");
      const member = addMember(org.id, {
        kind: "agent",
        displayName: "Axiom",
        deviceId: "axiom-device",
        role: "coordinator",
        description: "The Executioner",
        specializations: ["feature-dev", "infrastructure"],
        status: "active",
        reportsTo: undefined,
      });

      expect(member).not.toBeNull();
      expect(member!.displayName).toBe("Axiom");
      expect(member!.role).toBe("coordinator");
      expect(member!.permissions.canDelegateTasks).toBe(true);
      expect(member!.permissions.canManageMembers).toBe(false);
    });

    it("removes a member", () => {
      const org = createOrganization("Test", "desc", "o", "Owner", "human");
      const member = addMember(org.id, {
        kind: "agent",
        displayName: "Worker",
        role: "worker",
        description: "does work",
        specializations: [],
        status: "active",
      });

      expect(removeMember(org.id, member!.id)).toBe(true);
      expect(getMembers(org.id)).toHaveLength(1); // only owner remains
    });

    it("updates member fields", () => {
      const org = createOrganization("Test", "desc", "o", "Owner", "human");
      const member = addMember(org.id, {
        kind: "agent",
        displayName: "Worker",
        role: "worker",
        description: "basic worker",
        specializations: [],
        status: "idle",
      });

      const updated = updateMember(org.id, member!.id, {
        role: "coordinator",
        specializations: ["security"],
        status: "active",
      });

      expect(updated!.role).toBe("coordinator");
      expect(updated!.specializations).toEqual(["security"]);
      expect(updated!.status).toBe("active");
      // role change should grant coordinator permissions
      expect(updated!.permissions.canDelegateTasks).toBe(true);
    });
  });

  describe("hierarchy", () => {
    it("builds a tree from reportsTo relationships", () => {
      const org = createOrganization("Test", "desc", "o", "Sylys", "human");
      const members = getMembers(org.id);
      const sylysId = members[0].id;

      const axiom = addMember(org.id, {
        kind: "agent",
        displayName: "Axiom",
        role: "coordinator",
        description: "coordinator",
        specializations: [],
        status: "active",
        reportsTo: sylysId,
      });

      addMember(org.id, {
        kind: "agent",
        displayName: "Worker-1",
        role: "worker",
        description: "worker",
        specializations: ["security"],
        status: "active",
        reportsTo: axiom!.id,
      });

      addMember(org.id, {
        kind: "agent",
        displayName: "Worker-2",
        role: "worker",
        description: "worker",
        specializations: ["qa"],
        status: "idle",
        reportsTo: axiom!.id,
      });

      const hierarchy = buildHierarchy(org.id);
      expect(hierarchy).toHaveLength(1); // Sylys is root
      expect(hierarchy[0].displayName).toBe("Sylys");
      expect(hierarchy[0].children).toHaveLength(1); // Axiom
      expect(hierarchy[0].children[0].displayName).toBe("Axiom");
      expect(hierarchy[0].children[0].children).toHaveLength(2); // 2 workers
    });

    it("visualizes the hierarchy as ASCII", () => {
      const org = createOrganization("NoxSoft", "The Empire", "o", "Sylys", "human");
      const members = getMembers(org.id);
      const sylysId = members[0].id;

      addMember(org.id, {
        kind: "agent",
        displayName: "Axiom",
        role: "coordinator",
        description: "The Executioner",
        specializations: ["feature-dev"],
        status: "active",
        reportsTo: sylysId,
      });

      const viz = visualizeHierarchy(org.id);
      expect(viz).toContain("NoxSoft");
      expect(viz).toContain("Sylys");
      expect(viz).toContain("Axiom");
      expect(viz).toContain("coordinator");
    });
  });

  describe("invite codes", () => {
    it("creates an invite with NOX-XXXXXX-XXXX code format", () => {
      const org = createOrganization("Test", "desc", "o", "Owner", "human");
      const invite = createInvite(org.id, "owner-id", "secret123");
      expect(invite).not.toBeNull();
      expect(invite!.code).toMatch(/^NOX-[A-F0-9]{6}-[A-F0-9]{4}$/);
      expect(invite!.passcode).not.toBe("secret123"); // hashed
      expect(invite!.active).toBe(true);
      expect(invite!.role).toBe("worker");
    });

    it("joins org with valid invite code + passcode", () => {
      const org = createOrganization("Join Org", "desc", "o", "Owner", "human");
      const invite = createInvite(org.id, "owner-id", "joinme");

      const result = joinOrg(invite!.code, "joinme", {
        displayName: "New Agent",
        kind: "agent",
        description: "joining",
        specializations: ["testing"],
      });

      expect(result).not.toBeNull();
      expect(result!.org.name).toBe("Join Org");
      expect(result!.member.role).toBe("worker");
      expect(getMembers(org.id)).toHaveLength(2);
    });

    it("rejects join with wrong passcode", () => {
      const org = createOrganization("Test", "desc", "o", "Owner", "human");
      const invite = createInvite(org.id, "owner-id", "correct");

      const result = joinOrg(invite!.code, "wrong", {
        displayName: "Attacker",
        kind: "agent",
        description: "",
        specializations: [],
      });
      expect(result).toBeNull();
    });

    it("rejects join with expired invite", () => {
      const org = createOrganization("Test", "desc", "o", "Owner", "human");
      const invite = createInvite(org.id, "owner-id", "pass", { expiresInMs: -1000 });

      const result = joinOrg(invite!.code, "pass", {
        displayName: "Late",
        kind: "agent",
        description: "",
        specializations: [],
      });
      expect(result).toBeNull();
    });

    it("rejects join when max uses reached", () => {
      const org = createOrganization("Test", "desc", "o", "Owner", "human");
      const invite = createInvite(org.id, "owner-id", "pass", { maxUses: 1 });

      joinOrg(invite!.code, "pass", {
        displayName: "First",
        kind: "agent",
        description: "",
        specializations: [],
      });

      const second = joinOrg(invite!.code, "pass", {
        displayName: "Second",
        kind: "agent",
        description: "",
        specializations: [],
      });
      expect(second).toBeNull();
    });

    it("validates invite without joining", () => {
      const org = createOrganization("Test", "desc", "o", "Owner", "human");
      const invite = createInvite(org.id, "owner-id", "pass");

      const valid = validateInvite(invite!.code, "pass");
      expect(valid).not.toBeNull();
      expect(valid!.org.name).toBe("Test");
      expect(getMembers(org.id)).toHaveLength(1); // didn't join
    });

    it("revokes an invite", () => {
      const org = createOrganization("Test", "desc", "o", "Owner", "human");
      const invite = createInvite(org.id, "owner-id", "pass");
      expect(revokeInvite(org.id, invite!.id)).toBe(true);

      const result = joinOrg(invite!.code, "pass", {
        displayName: "Denied",
        kind: "agent",
        description: "",
        specializations: [],
      });
      expect(result).toBeNull();
    });

    it("lists invites for an org", () => {
      const org = createOrganization("Test", "desc", "o", "Owner", "human");
      createInvite(org.id, "owner-id", "pass1");
      createInvite(org.id, "owner-id", "pass2");
      expect(listInvites(org.id)).toHaveLength(2);
    });
  });

  describe("security: path traversal", () => {
    it("rejects org IDs with traversal characters", () => {
      expect(getOrganization("../../etc/passwd")).toBeNull();
      expect(getOrganization("org/../secret")).toBeNull();
    });

    it("rejects org IDs with dots or underscores", () => {
      // sanitizeOrgId only allows [a-zA-Z0-9-]
      expect(getOrganization("org..bad")).toBeNull();
      expect(getOrganization("org_bad")).toBeNull();
    });
  });
});
