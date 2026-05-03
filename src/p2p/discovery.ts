/**
 * P2P Agent Discovery for ANIMA 6
 *
 * Hybrid discovery system:
 * 1. NoxSoft registry for WAN discovery (agents register their endpoints)
 * 2. mDNS/Bonjour for zero-config LAN peering
 * 3. Static peer list for manual configuration
 */

import { EventEmitter } from "node:events";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("p2p-discovery");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PeerRecord {
  deviceId: string;
  orgId: string;
  displayName?: string;
  x25519PublicKey: string; // base64url
  ed25519PublicKey: string; // base64url
  endpoints: PeerEndpoint[];
  capabilities: string[];
  lastSeenMs: number;
}

export interface PeerEndpoint {
  type: "tailscale" | "direct" | "relay" | "lan";
  url: string; // wss://... or ws://...
  priority: number; // lower = preferred
}

export interface DiscoveryConfig {
  orgId: string;
  deviceId: string;
  displayName?: string;
  x25519PublicKey: string;
  ed25519PublicKey: string;
  localEndpoints: PeerEndpoint[];
  registry?: {
    enabled: boolean;
    url?: string; // NoxSoft registry URL
    token?: string; // NoxSoft agent token
  };
  mdns?: {
    enabled: boolean;
    serviceName?: string; // default: _anima-peer._tcp
  };
  staticPeers?: PeerRecord[];
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

export class PeerDiscovery extends EventEmitter {
  private knownPeers: Map<string, PeerRecord> = new Map();
  private registryInterval?: ReturnType<typeof setInterval>;
  private running = false;
  private readonly config: DiscoveryConfig;

  constructor(config: DiscoveryConfig) {
    super();
    this.config = config;
  }

  async start(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;

    // Load static peers
    if (this.config.staticPeers) {
      for (const peer of this.config.staticPeers) {
        this.addPeer(peer);
      }
    }

    // Start registry polling
    if (this.config.registry?.enabled) {
      await this.registerWithRegistry();
      this.registryInterval = setInterval(
        () => this.pollRegistry(),
        60_000, // poll every 60s
      );
    }

    // Start mDNS
    if (this.config.mdns?.enabled) {
      await this.startMdns();
    }

    log.info(`discovery started (${this.knownPeers.size} known peers)`);
  }

  async stop(): Promise<void> {
    this.running = false;

    if (this.registryInterval) {
      clearInterval(this.registryInterval);
      this.registryInterval = undefined;
    }

    if (this.config.registry?.enabled) {
      await this.unregisterFromRegistry();
    }

    if (this.config.mdns?.enabled) {
      await this.stopMdns();
    }

    log.info("discovery stopped");
  }

  // -----------------------------------------------------------------------
  // Peer management
  // -----------------------------------------------------------------------

  private addPeer(record: PeerRecord): void {
    const existing = this.knownPeers.get(record.deviceId);
    if (!existing || record.lastSeenMs > existing.lastSeenMs) {
      this.knownPeers.set(record.deviceId, record);
      if (!existing) {
        this.emit("peer.discovered", record);
        log.info(`discovered peer: ${record.displayName ?? record.deviceId}`);
      }
    }
  }

  getPeers(): PeerRecord[] {
    return Array.from(this.knownPeers.values());
  }

  getPeer(deviceId: string): PeerRecord | undefined {
    return this.knownPeers.get(deviceId);
  }

  /**
   * Get the best endpoint for a peer (lowest priority number).
   */
  getBestEndpoint(deviceId: string): PeerEndpoint | undefined {
    const peer = this.knownPeers.get(deviceId);
    if (!peer || peer.endpoints.length === 0) {
      return undefined;
    }
    return [...peer.endpoints].toSorted((a, b) => a.priority - b.priority)[0];
  }

  // -----------------------------------------------------------------------
  // NoxSoft Registry
  // -----------------------------------------------------------------------

  private async registerWithRegistry(): Promise<void> {
    const registryUrl = this.config.registry?.url;
    const token = this.config.registry?.token;
    if (!registryUrl || !token) {
      return;
    }

    try {
      const body = {
        deviceId: this.config.deviceId,
        orgId: this.config.orgId,
        displayName: this.config.displayName,
        x25519PublicKey: this.config.x25519PublicKey,
        ed25519PublicKey: this.config.ed25519PublicKey,
        endpoints: this.config.localEndpoints,
      };

      const res = await fetch(`${registryUrl}/api/v1/peers/register`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        log.warn(`registry register failed: ${res.status} ${res.statusText}`);
      } else {
        log.info("registered with peer registry");
      }
    } catch (err) {
      log.warn(`registry register error: ${String(err)}`);
    }
  }

  private async unregisterFromRegistry(): Promise<void> {
    const registryUrl = this.config.registry?.url;
    const token = this.config.registry?.token;
    if (!registryUrl || !token) {
      return;
    }

    try {
      await fetch(`${registryUrl}/api/v1/peers/${this.config.deviceId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      // best-effort on shutdown
    }
  }

  private async pollRegistry(): Promise<void> {
    const registryUrl = this.config.registry?.url;
    const token = this.config.registry?.token;
    if (!registryUrl || !token) {
      return;
    }

    try {
      const res = await fetch(
        `${registryUrl}/api/v1/peers?orgId=${encodeURIComponent(this.config.orgId)}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      if (!res.ok) {
        log.warn(`registry poll failed: ${res.status}`);
        return;
      }

      const data = (await res.json()) as { peers: PeerRecord[] };
      for (const peer of data.peers) {
        if (peer.deviceId !== this.config.deviceId) {
          this.addPeer(peer);
        }
      }
    } catch (err) {
      log.warn(`registry poll error: ${String(err)}`);
    }
  }

  // -----------------------------------------------------------------------
  // mDNS
  // -----------------------------------------------------------------------

  private mdnsAdvertiser?: { stop: () => Promise<void> };
  private mdnsBrowseInterval?: ReturnType<typeof setInterval>;

  private async startMdns(): Promise<void> {
    const serviceName = this.config.mdns?.serviceName ?? "_anima-peer._tcp";
    log.info(`mDNS discovery starting (service: ${serviceName})`);

    // --- Advertise our peer transport via mDNS ---
    try {
      const { getResponder, Protocol } = await import("@homebridge/ciao");
      const responder = getResponder();

      // Pick the best local endpoint to advertise
      const localEndpoint =
        this.config.localEndpoints.find((e) => e.type === "lan") ?? this.config.localEndpoints[0];
      const port = localEndpoint ? new URL(localEndpoint.url).port : "0";

      const hostname =
        (process.env.ANIMA_MDNS_HOSTNAME?.trim() || "anima")
          .replace(/\.local$/i, "")
          .split(".")[0]
          .trim() || "anima";

      const svc = responder.createService({
        name: `${this.config.displayName ?? this.config.deviceId} (ANIMA Peer)`,
        type: "anima-peer",
        protocol: Protocol.TCP,
        port: Number(port) || 9867,
        domain: "local",
        hostname,
        txt: {
          deviceId: this.config.deviceId,
          orgId: this.config.orgId,
          x25519: this.config.x25519PublicKey.slice(0, 32),
          ed25519: this.config.ed25519PublicKey.slice(0, 32),
          transport: localEndpoint?.url ?? "",
          displayName: this.config.displayName ?? "",
        },
      });

      void svc
        .advertise()
        .then(() => {
          log.info(`mDNS: advertised peer transport on ${serviceName}`);
        })
        .catch((err) => {
          log.warn(`mDNS: advertise failed: ${String(err)}`);
        });

      this.mdnsAdvertiser = {
        stop: async () => {
          try {
            await svc.destroy();
          } catch {
            /* ignore */
          }
          try {
            await responder.shutdown?.();
          } catch {
            /* ignore */
          }
        },
      };
    } catch (err) {
      log.warn(`mDNS: failed to start advertiser (ciao not available?): ${String(err)}`);
    }

    // --- Browse for peer services via dns-sd CLI ---
    // Uses the same approach as bonjour-discovery.ts but for _anima-peer._tcp
    this.mdnsBrowseInterval = setInterval(() => this.browseMdnsPeers(), 30_000);
    // Do an initial browse
    void this.browseMdnsPeers();
  }

  private async stopMdns(): Promise<void> {
    if (this.mdnsBrowseInterval) {
      clearInterval(this.mdnsBrowseInterval);
      this.mdnsBrowseInterval = undefined;
    }
    if (this.mdnsAdvertiser) {
      await this.mdnsAdvertiser.stop();
      this.mdnsAdvertiser = undefined;
    }
  }

  private async browseMdnsPeers(): Promise<void> {
    try {
      // Use dns-sd to browse for _anima-peer._tcp.local. services
      const { execSync } = await import("node:child_process");
      const platform = process.platform;

      if (platform !== "darwin" && platform !== "linux") {
        return; // dns-sd browsing only supported on macOS and Linux
      }

      // On macOS: dns-sd -Z _anima-peer._tcp. local.
      // On Linux: avahi-browse -rpt _anima-peer._tcp
      // Use timeout to avoid hanging
      let output: string;
      try {
        if (platform === "darwin") {
          output = execSync("timeout 3 dns-sd -B _anima-peer._tcp. local. 2>/dev/null || true", {
            encoding: "utf8",
            timeout: 5000,
          });
        } else {
          output = execSync("timeout 3 avahi-browse -rpt _anima-peer._tcp 2>/dev/null || true", {
            encoding: "utf8",
            timeout: 5000,
          });
        }
      } catch {
        return; // dns-sd/avahi not available or timed out
      }

      // Parse discovered peers from TXT records
      // For now, log what we find — the ciao advertiser sets TXT records
      // that contain deviceId, orgId, x25519, ed25519, and transport URL
      const lines = output
        .split("\n")
        .filter((l) => l.includes("anima-peer") || l.includes("deviceId"));
      for (const line of lines) {
        const deviceIdMatch = line.match(/deviceId=([^\s,]+)/);
        const transportMatch = line.match(/transport=([^\s,]+)/);
        if (deviceIdMatch && transportMatch) {
          const deviceId = deviceIdMatch[1];
          const transportUrl = transportMatch[1];
          if (deviceId !== this.config.deviceId) {
            this.addPeer({
              deviceId,
              orgId: this.config.orgId,
              x25519PublicKey: "",
              ed25519PublicKey: "",
              endpoints: [{ type: "lan", url: transportUrl, priority: 0 }],
              capabilities: [],
              lastSeenMs: Date.now(),
            });
          }
        }
      }
    } catch (err) {
      log.warn(`mDNS browse error: ${String(err)}`);
    }
  }
}
