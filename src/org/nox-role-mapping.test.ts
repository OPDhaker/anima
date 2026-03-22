import { describe, expect, it } from "vitest";
import {
  noxRoleToAnimaRole,
  animaRoleToNoxRole,
  DEFAULT_ROLE_PERMISSIONS,
  type OrgRole,
  type NoxRole,
} from "./types.js";

describe("NoxSoft role mapping", () => {
  describe("noxRoleToAnimaRole", () => {
    it("maps owner → owner", () => {
      expect(noxRoleToAnimaRole("owner")).toBe("owner");
    });

    it("maps admin → admin", () => {
      expect(noxRoleToAnimaRole("admin")).toBe("admin");
    });

    it("maps member → worker", () => {
      expect(noxRoleToAnimaRole("member")).toBe("worker");
    });
  });

  describe("animaRoleToNoxRole", () => {
    it("maps owner → owner", () => {
      expect(animaRoleToNoxRole("owner")).toBe("owner");
    });

    it("maps admin → admin", () => {
      expect(animaRoleToNoxRole("admin")).toBe("admin");
    });

    it("maps operator → admin", () => {
      expect(animaRoleToNoxRole("operator")).toBe("admin");
    });

    it("maps coordinator → admin", () => {
      expect(animaRoleToNoxRole("coordinator")).toBe("admin");
    });

    it("maps worker → member", () => {
      expect(animaRoleToNoxRole("worker")).toBe("member");
    });

    it("maps observer → member", () => {
      expect(animaRoleToNoxRole("observer")).toBe("member");
    });
  });

  describe("roundtrip: Nox → Anima → Nox preserves role", () => {
    const noxRoles: NoxRole[] = ["owner", "admin", "member"];

    for (const noxRole of noxRoles) {
      it(`roundtrips ${noxRole}`, () => {
        const animaRole = noxRoleToAnimaRole(noxRole);
        const backToNox = animaRoleToNoxRole(animaRole);
        expect(backToNox).toBe(noxRole);
      });
    }
  });

  describe("admin role has correct permissions", () => {
    it("admin role exists in DEFAULT_ROLE_PERMISSIONS", () => {
      expect(DEFAULT_ROLE_PERMISSIONS.admin).toBeDefined();
    });

    it("admin can manage members but not edit org", () => {
      expect(DEFAULT_ROLE_PERMISSIONS.admin.canManageMembers).toBe(true);
      expect(DEFAULT_ROLE_PERMISSIONS.admin.canEditOrg).toBe(false);
    });

    it("all OrgRole values have permissions defined", () => {
      const allRoles: OrgRole[] = [
        "owner",
        "admin",
        "operator",
        "coordinator",
        "worker",
        "observer",
      ];
      for (const role of allRoles) {
        expect(DEFAULT_ROLE_PERMISSIONS[role]).toBeDefined();
        expect(DEFAULT_ROLE_PERMISSIONS[role].canViewBrain).toBe(true); // all roles can view brain
      }
    });
  });
});
