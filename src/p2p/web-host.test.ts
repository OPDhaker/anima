/**
 * Tests for P2P Private Web Hosting — site deployment, resolution, access control.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../logging/subsystem.js", () => {
  const noop = () => {};
  const logger = { info: noop, warn: noop, error: noop, debug: noop, trace: noop };
  return { createSubsystemLogger: () => logger };
});

let tmpDir: string;
vi.mock("../config/paths.js", () => ({
  resolveStateDir: () => tmpDir,
}));

import { WebHostManager, type SiteFile } from "./web-host.js";

function makeSiteFiles(): SiteFile[] {
  return [
    { path: "index.html", contentHash: "idx-hash", mimeType: "text/html", size: 500 },
    { path: "css/style.css", contentHash: "css-hash", mimeType: "text/css", size: 200 },
    { path: "js/app.js", contentHash: "js-hash", mimeType: "application/javascript", size: 1000 },
    { path: "404.html", contentHash: "404-hash", mimeType: "text/html", size: 100 },
    { path: "about/index.html", contentHash: "about-hash", mimeType: "text/html", size: 300 },
  ];
}

describe("WebHostManager", () => {
  let host: WebHostManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "anima-webhost-test-"));
    host = new WebHostManager("device-A", "org-1");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("site deployment", () => {
    it("deploys a site with files", () => {
      const site = host.deploySite({
        domain: "mysite.noxsoft.anima",
        name: "My Site",
        files: makeSiteFiles(),
      });

      expect(site.domain).toBe("mysite.noxsoft.anima");
      expect(site.name).toBe("My Site");
      expect(site.version).toBe(1);
      expect(site.active).toBe(true);
      expect(site.deployedBy).toBe("device-A");
    });

    it("increments version on redeploy", () => {
      host.deploySite({
        domain: "mysite.noxsoft.anima",
        name: "My Site v1",
        files: makeSiteFiles(),
      });

      const v2 = host.deploySite({
        domain: "mysite.noxsoft.anima",
        name: "My Site v2",
        files: makeSiteFiles(),
      });

      expect(v2.version).toBe(2);
      expect(v2.name).toBe("My Site v2");
    });

    it("stores site manifest", () => {
      const site = host.deploySite({
        domain: "docs.noxsoft.anima",
        name: "Docs",
        files: makeSiteFiles(),
      });

      const manifest = host.getSiteManifest(site.id);
      expect(manifest).not.toBeNull();
      expect(manifest!.domain).toBe("docs.noxsoft.anima");
      expect(manifest!.files).toHaveLength(5);
      expect(manifest!.totalSize).toBe(2100);
    });
  });

  describe("site lookup", () => {
    it("gets site by domain", () => {
      host.deploySite({ domain: "api.noxsoft.anima", name: "API", files: makeSiteFiles() });

      const site = host.getSiteByDomain("api.noxsoft.anima");
      expect(site).not.toBeNull();
      expect(site!.name).toBe("API");
    });

    it("returns null for unknown domain", () => {
      expect(host.getSiteByDomain("unknown.anima")).toBeNull();
    });

    it("lists all sites", () => {
      host.deploySite({ domain: "a.anima", name: "A", files: [] });
      host.deploySite({ domain: "b.anima", name: "B", files: [] });

      const sites = host.listSites();
      expect(sites).toHaveLength(2);
    });
  });

  describe("file resolution", () => {
    it("resolves root path to index.html", () => {
      host.deploySite({ domain: "site.anima", name: "S", files: makeSiteFiles() });

      const result = host.resolveFile("site.anima", "/");
      expect(result).not.toBeNull();
      expect(result!.file!.path).toBe("index.html");
      expect(result!.is404).toBe(false);
    });

    it("resolves exact file path", () => {
      host.deploySite({ domain: "site.anima", name: "S", files: makeSiteFiles() });

      const result = host.resolveFile("site.anima", "/css/style.css");
      expect(result).not.toBeNull();
      expect(result!.file!.contentHash).toBe("css-hash");
      expect(result!.is404).toBe(false);
    });

    it("resolves directory to index.html", () => {
      host.deploySite({ domain: "site.anima", name: "S", files: makeSiteFiles() });

      const result = host.resolveFile("site.anima", "/about");
      expect(result).not.toBeNull();
      expect(result!.file!.contentHash).toBe("about-hash");
      expect(result!.is404).toBe(false);
    });

    it("returns 404 file for unknown path", () => {
      host.deploySite({ domain: "site.anima", name: "S", files: makeSiteFiles() });

      const result = host.resolveFile("site.anima", "/nonexistent.html");
      expect(result).not.toBeNull();
      expect(result!.is404).toBe(true);
      expect(result!.file!.contentHash).toBe("404-hash");
    });

    it("returns null for unknown domain", () => {
      expect(host.resolveFile("nope.anima", "/")).toBeNull();
    });

    it("returns null for inactive site", () => {
      const site = host.deploySite({ domain: "off.anima", name: "Off", files: makeSiteFiles() });
      host.setActive(site.id, false);

      expect(host.resolveFile("off.anima", "/")).toBeNull();
    });
  });

  describe("site management", () => {
    it("activates and deactivates a site", () => {
      const site = host.deploySite({ domain: "toggle.anima", name: "T", files: [] });
      expect(site.active).toBe(true);

      host.setActive(site.id, false);
      expect(host.getSite(site.id)!.active).toBe(false);

      host.setActive(site.id, true);
      expect(host.getSite(site.id)!.active).toBe(true);
    });

    it("deletes a site", () => {
      const site = host.deploySite({ domain: "del.anima", name: "Del", files: [] });
      expect(host.getSite(site.id)).not.toBeNull();

      const result = host.deleteSite(site.id);
      expect(result).toBe(true);
      expect(host.getSite(site.id)).toBeNull();
    });
  });

  describe("access control", () => {
    it("public sites allow all devices", () => {
      const site = host.deploySite({ domain: "pub.anima", name: "P", files: [], access: "public" });
      expect(host.isAuthorized(site, "anyone")).toBe(true);
    });

    it("restricted sites only allow listed devices", () => {
      const site = host.deploySite({
        domain: "priv.anima",
        name: "P",
        files: [],
        access: "restricted",
        authorizedDevices: ["device-A"],
      });

      expect(host.isAuthorized(site, "device-A")).toBe(true);
      expect(host.isAuthorized(site, "device-B")).toBe(false);
    });
  });

  describe("stats", () => {
    it("returns correct stats", () => {
      host.deploySite({ domain: "a.anima", name: "A", files: makeSiteFiles() });
      host.deploySite({ domain: "b.anima", name: "B", files: [] });
      const c = host.deploySite({ domain: "c.anima", name: "C", files: [] });
      host.setActive(c.id, false);

      const stats = host.getStats();
      expect(stats.totalSites).toBe(3);
      expect(stats.activeSites).toBe(2);
    });
  });
});
