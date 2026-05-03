/**
 * P2P Private Web Hosting — Anima v7 Private Internet
 *
 * Serve websites directly from mesh nodes, resolved via private DNS.
 * No public servers, no domains, no TLS certificates needed.
 *
 * How it works:
 * 1. Register a .anima domain: `mysite.orgname.anima`
 * 2. Store site files in the content router (chunked, replicated)
 * 3. Mesh peers access via local proxy that resolves .anima domains
 * 4. Static sites served from content store, dynamic proxied to host node
 *
 * Integration:
 * - private-dns.ts: SRV records for service discovery
 * - content-router.ts: content-addressable static file storage
 * - pinning.ts: pin site assets for availability
 */

import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("p2p-web-host");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SiteConfig {
  /** Site ID (auto-generated) */
  id: string;
  /** Domain: e.g., "mysite.orgname.anima" */
  domain: string;
  /** Display name */
  name: string;
  /** Description */
  description?: string;
  /** Root content hash (manifest hash of the site root) */
  rootManifestHash: string;
  /** Index file path within the site (default: index.html) */
  indexPath: string;
  /** 404 file path (default: 404.html) */
  notFoundPath: string;
  /** Who deployed this site */
  deployedBy: string;
  /** Deploy timestamp */
  deployedAt: number;
  /** Version (incremented on each deploy) */
  version: number;
  /** Whether the site is live */
  active: boolean;
  /** Access: "public" (anyone in org) or "restricted" (authorized only) */
  access: "public" | "restricted";
  /** Authorized devices (only if access === "restricted") */
  authorizedDevices: string[];
}

export interface SiteFile {
  /** Relative path within the site (e.g., "index.html", "css/style.css") */
  path: string;
  /** Content hash (SHA-256) */
  contentHash: string;
  /** MIME type */
  mimeType: string;
  /** File size in bytes */
  size: number;
}

export interface SiteManifest {
  type: "site-manifest";
  domain: string;
  version: number;
  files: SiteFile[];
  deployedAt: number;
  deployedBy: string;
  totalSize: number;
}

export interface SiteStats {
  totalSites: number;
  activeSites: number;
  totalDeployments: number;
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

function resolveSitesDir(): string {
  return path.join(resolveStateDir(), "web-host", "sites");
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}

function sanitizeId(id: string): string {
  const cleaned = id.replace(/[^a-zA-Z0-9_.-]/g, "");
  if (!cleaned || cleaned !== id) {
    throw new Error("Invalid site ID");
  }
  return cleaned;
}

// ---------------------------------------------------------------------------
// WebHostManager
// ---------------------------------------------------------------------------

export class WebHostManager extends EventEmitter {
  private readonly deviceId: string;
  private readonly orgId: string;

  constructor(deviceId: string, orgId: string) {
    super();
    this.deviceId = deviceId;
    this.orgId = orgId;
    ensureDir(resolveSitesDir());
  }

  // -----------------------------------------------------------------------
  // Deploy
  // -----------------------------------------------------------------------

  /**
   * Deploy a static site from a directory of files.
   * Files should already be stored in the content router.
   */
  deploySite(params: {
    domain: string;
    name: string;
    files: SiteFile[];
    description?: string;
    indexPath?: string;
    notFoundPath?: string;
    access?: SiteConfig["access"];
    authorizedDevices?: string[];
  }): SiteConfig {
    // Check if site already exists (update version)
    const existing = this.getSiteByDomain(params.domain);
    const version = existing ? existing.version + 1 : 1;
    const id = existing?.id ?? `site-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;

    // Create site manifest
    const manifest: SiteManifest = {
      type: "site-manifest",
      domain: params.domain,
      version,
      files: params.files,
      deployedAt: Date.now(),
      deployedBy: this.deviceId,
      totalSize: params.files.reduce((sum, f) => sum + f.size, 0),
    };

    // Hash the manifest for content-addressable storage
    const manifestJson = JSON.stringify(manifest, null, 2);
    const manifestHash = crypto.createHash("sha256").update(manifestJson).digest("hex");

    const config: SiteConfig = {
      id,
      domain: params.domain,
      name: params.name,
      description: params.description,
      rootManifestHash: manifestHash,
      indexPath: params.indexPath ?? "index.html",
      notFoundPath: params.notFoundPath ?? "404.html",
      deployedBy: this.deviceId,
      deployedAt: Date.now(),
      version,
      active: true,
      access: params.access ?? "public",
      authorizedDevices: params.authorizedDevices ?? [],
    };

    // Persist config
    const configPath = path.join(resolveSitesDir(), `${sanitizeId(id)}.json`);
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });

    // Also store the manifest
    const manifestPath = path.join(resolveSitesDir(), `${sanitizeId(id)}.manifest.json`);
    fs.writeFileSync(manifestPath, `${manifestJson}\n`, { mode: 0o600 });

    log.info(`site deployed: ${params.domain} v${version} (${params.files.length} files)`);
    this.emit("site.deployed", config);

    return config;
  }

  // -----------------------------------------------------------------------
  // Query
  // -----------------------------------------------------------------------

  /**
   * Get a site by its domain.
   */
  getSiteByDomain(domain: string): SiteConfig | null {
    const sites = this.listSites();
    return sites.find((s) => s.domain === domain) ?? null;
  }

  /**
   * Get a site by its ID.
   */
  getSite(id: string): SiteConfig | null {
    try {
      const configPath = path.join(resolveSitesDir(), `${sanitizeId(id)}.json`);
      return JSON.parse(fs.readFileSync(configPath, "utf8")) as SiteConfig;
    } catch {
      return null;
    }
  }

  /**
   * Get the site manifest (file listing).
   */
  getSiteManifest(id: string): SiteManifest | null {
    try {
      const manifestPath = path.join(resolveSitesDir(), `${sanitizeId(id)}.manifest.json`);
      return JSON.parse(fs.readFileSync(manifestPath, "utf8")) as SiteManifest;
    } catch {
      return null;
    }
  }

  /**
   * List all sites.
   */
  listSites(): SiteConfig[] {
    const dir = resolveSitesDir();
    try {
      return fs
        .readdirSync(dir)
        .filter((f) => f.endsWith(".json") && !f.endsWith(".manifest.json"))
        .map((f) => {
          try {
            return JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as SiteConfig;
          } catch {
            return null;
          }
        })
        .filter((s): s is SiteConfig => s !== null)
        .toSorted((a, b) => b.deployedAt - a.deployedAt);
    } catch {
      return [];
    }
  }

  /**
   * Resolve a request path to a file in a site.
   * Returns the matching SiteFile or the 404 file.
   */
  resolveFile(
    domain: string,
    requestPath: string,
  ): { site: SiteConfig; file: SiteFile | null; is404: boolean } | null {
    const site = this.getSiteByDomain(domain);
    if (!site || !site.active) {
      return null;
    }

    const manifest = this.getSiteManifest(site.id);
    if (!manifest) {
      return null;
    }

    // Normalize path
    let normalized = requestPath.replace(/^\/+/, "").replace(/\/+$/, "");
    if (!normalized) {
      normalized = site.indexPath;
    }

    // Try exact match
    let file = manifest.files.find((f) => f.path === normalized) ?? null;

    // Try with /index.html appended (directory index)
    if (!file && !normalized.includes(".")) {
      file = manifest.files.find((f) => f.path === `${normalized}/index.html`) ?? null;
    }

    // 404 fallback
    if (!file) {
      const notFoundFile = manifest.files.find((f) => f.path === site.notFoundPath) ?? null;
      return { site, file: notFoundFile, is404: true };
    }

    return { site, file, is404: false };
  }

  // -----------------------------------------------------------------------
  // Manage
  // -----------------------------------------------------------------------

  /**
   * Activate or deactivate a site.
   */
  setActive(id: string, active: boolean): SiteConfig | null {
    const site = this.getSite(id);
    if (!site) {
      return null;
    }

    site.active = active;
    const configPath = path.join(resolveSitesDir(), `${sanitizeId(id)}.json`);
    fs.writeFileSync(configPath, `${JSON.stringify(site, null, 2)}\n`, { mode: 0o600 });

    log.info(`site ${active ? "activated" : "deactivated"}: ${site.domain}`);
    return site;
  }

  /**
   * Delete a site.
   */
  deleteSite(id: string): boolean {
    try {
      const configPath = path.join(resolveSitesDir(), `${sanitizeId(id)}.json`);
      const manifestPath = path.join(resolveSitesDir(), `${sanitizeId(id)}.manifest.json`);
      try {
        fs.unlinkSync(configPath);
      } catch {
        /* */
      }
      try {
        fs.unlinkSync(manifestPath);
      } catch {
        /* */
      }
      log.info(`site deleted: ${id}`);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if a device is authorized to access a site.
   */
  isAuthorized(site: SiteConfig, deviceId: string): boolean {
    if (site.access === "public") {
      return true;
    }
    return site.authorizedDevices.includes(deviceId);
  }

  /**
   * Get stats.
   */
  getStats(): SiteStats {
    const sites = this.listSites();
    return {
      totalSites: sites.length,
      activeSites: sites.filter((s) => s.active).length,
      totalDeployments: sites.reduce((sum, s) => sum + s.version, 0),
    };
  }
}
