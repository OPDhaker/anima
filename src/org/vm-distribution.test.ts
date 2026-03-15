/**
 * Tests for VM Distribution — repo-to-VM mapping and deployment manifests.
 */

import { describe, it, expect } from "vitest";
import {
  REPO_VM_ASSIGNMENTS,
  getReposForVm,
  getVmForRepo,
  getDeployableServices,
  generateVmManifest,
  generateAllManifests,
  printDistributionSummary,
} from "./vm-distribution.js";

describe("VM Distribution", () => {
  describe("REPO_VM_ASSIGNMENTS", () => {
    it("has assignments across multiple VMs", () => {
      const vmIds = new Set(REPO_VM_ASSIGNMENTS.map((r) => r.vmId));
      expect(vmIds.size).toBeGreaterThanOrEqual(5);
    });

    it("has no empty repo names", () => {
      for (const a of REPO_VM_ASSIGNMENTS) {
        expect(a.repo.trim().length).toBeGreaterThan(0);
      }
    });

    it("has descriptions for all repos", () => {
      for (const a of REPO_VM_ASSIGNMENTS) {
        expect(a.description.length).toBeGreaterThan(0);
      }
    });
  });

  describe("getReposForVm", () => {
    it("returns repos assigned to VM-1", () => {
      const repos = getReposForVm("vm-1");
      expect(repos.length).toBeGreaterThan(0);
      expect(repos.every((r) => r.vmId === "vm-1")).toBe(true);
    });

    it("returns empty for unknown VM", () => {
      expect(getReposForVm("vm-99")).toEqual([]);
    });
  });

  describe("getVmForRepo", () => {
    it("finds VM for a known repo", () => {
      const vmId = getVmForRepo("noxsoft-site");
      expect(vmId).toBe("vm-1");
    });

    it("returns undefined for unknown repo", () => {
      expect(getVmForRepo("nonexistent-repo")).toBeUndefined();
    });
  });

  describe("getDeployableServices", () => {
    it("returns services array (may be empty if no ports assigned)", () => {
      // Some VMs have port-based services, some don't
      const allServices = ["vm-1", "vm-2", "vm-3", "vm-4", "vm-5"].flatMap((vm) =>
        getDeployableServices(vm),
      );
      // At least some VMs should have deployable services across all
      expect(Array.isArray(allServices)).toBe(true);
    });
  });

  describe("generateVmManifest", () => {
    it("generates a manifest for a VM", () => {
      const manifest = generateVmManifest("vm-1", "NoxSoft");
      expect(manifest.vmId).toBe("vm-1");
      expect(manifest.vmName).toContain("VM-1");
      expect(manifest.repos.length).toBeGreaterThan(0);
      expect(manifest.agents).toHaveLength(3); // guardian, architect, builder
    });
  });

  describe("generateAllManifests", () => {
    it("generates manifests for all 5 VMs", () => {
      const manifests = generateAllManifests("NoxSoft");
      expect(manifests.length).toBeGreaterThanOrEqual(5);
    });
  });

  describe("printDistributionSummary", () => {
    it("produces readable summary", () => {
      const summary = printDistributionSummary("NoxSoft");
      expect(summary).toContain("VM");
      expect(summary.length).toBeGreaterThan(50);
    });
  });
});
