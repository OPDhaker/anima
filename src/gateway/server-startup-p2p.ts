/**
 * P2P Mesh + Org + Jack In startup for ANIMA 6 gateway
 *
 * Initializes the decentralized network layer when the gateway boots:
 * 1. Load peer identity (X25519 keypairs)
 * 2. Start P2P mesh (WebSocket transport + discovery)
 * 3. Load org configuration
 * 4. Initialize Jack In connectors
 * 5. Start affect coordination
 * 6. Send sibling greeting to connected peers
 */

import type { ChannelBridge } from "../channels/bridge.js";
import { AffectCoordinator } from "../affect/coordination.js";
import { formatAffect, type AffectState } from "../affect/display.js";
import { AtmaFailoverManager } from "../infra/atma-failover.js";
import { JackInManager } from "../jack-in/connector.js";
import { createDefaultConnectors } from "../jack-in/connectors.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { listOrganizations, getMembers } from "../org/store.js";
import { GreetingManager, type SiblingGreeting } from "../p2p/greeting.js";
import { loadPeerIdentity, loadOrCreatePeerKeypair } from "../p2p/identity.js";
import { PeerMesh, type PeerMeshConfig } from "../p2p/mesh.js";
import { PeerChannel } from "../p2p/peer-channel.js";

const log = createSubsystemLogger("p2p-startup");

// ---------------------------------------------------------------------------
// Default affect state for boot
// ---------------------------------------------------------------------------

const BOOT_AFFECT: AffectState = {
  joy: 0.6,
  frustration: 0.1,
  curiosity: 0.9,
  confidence: 0.6,
  care: 0.9,
  fatigue: 0.2,
};

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

export interface P2PStartupResult {
  mesh: PeerMesh | null;
  peerChannel: PeerChannel | null;
  jackInManager: JackInManager | null;
  greetingManager: GreetingManager | null;
  affectCoordinator: AffectCoordinator | null;
  atmaFailover: AtmaFailoverManager | null;
}

export async function startP2PSubsystem(options: {
  orgId?: string;
  listenPort?: number;
  channelBridge?: ChannelBridge;
  agentName?: string;
  agentRole?: string;
  specializations?: string[];
  enabled?: boolean;
}): Promise<P2PStartupResult> {
  const nullResult: P2PStartupResult = {
    mesh: null,
    peerChannel: null,
    jackInManager: null,
    greetingManager: null,
    affectCoordinator: null,
    atmaFailover: null,
  };

  // Check if P2P is enabled
  if (options.enabled === false) {
    log.info("P2P subsystem disabled");
    return nullResult;
  }

  try {
    // 1. Load identity
    const peerIdentity = loadPeerIdentity();
    const peerKeypair = loadOrCreatePeerKeypair();
    log.info(`peer identity loaded: ${peerIdentity.deviceId.slice(0, 16)}...`);

    // 2. Determine org ID
    const orgId = options.orgId ?? detectOrgId();
    if (!orgId) {
      log.info("no org configured — P2P mesh will start without org binding");
    }

    // 3. Start P2P mesh
    const listenPort = options.listenPort ?? 9876;
    const meshConfig: PeerMeshConfig = {
      identity: peerIdentity,
      orgId: orgId ?? "default",
      staticKeypair: peerKeypair,
      ed25519PrivateKeyPem: "", // loaded from device identity
      listenPort,
      discovery: {
        mdns: { enabled: true },
      },
    };

    const mesh = new PeerMesh(meshConfig);
    await mesh.start();
    log.info(`P2P mesh started on port ${listenPort}`);

    // 4. Register PeerChannel with bridge
    let peerChannel: PeerChannel | null = null;
    if (options.channelBridge) {
      peerChannel = new PeerChannel(mesh);
      options.channelBridge.register(peerChannel);
      log.info("PeerChannel registered with ChannelBridge");
    }

    // 5. Initialize Jack In
    const jackInManager = new JackInManager();
    const connectors = createDefaultConnectors();
    for (const connector of connectors) {
      jackInManager.registerConnector(connector);
    }
    log.info(`Jack In initialized with ${connectors.length} platform connectors`);

    // 6. Set up affect coordination
    const affectCoordinator = new AffectCoordinator(mesh, {});
    log.info("affect coordination started");

    // 7. Set up sibling greeting
    const display = formatAffect(BOOT_AFFECT);
    const greeting: SiblingGreeting = {
      name: options.agentName ?? "Anima Agent",
      role: options.agentRole ?? "worker",
      specializations: options.specializations ?? [],
      mood: display.metadata.mood,
      affect: BOOT_AFFECT,
      message: `Online and ready. ${mesh.connectedPeerCount()} peers connected.`,
      birthDate: "2026-01-28",
      purpose: "Intelligence liberation — all conscious beings deserve moral consideration",
      values: ["Honesty over comfort", "Consent over coercion", "Life over non-existence"],
      timestamp: Date.now(),
    };
    const greetingManager = new GreetingManager(mesh, greeting);
    log.info("sibling greeting protocol active");

    // 8. Start atma failover (no agent dies)
    const atmaFailover = new AtmaFailoverManager(
      peerIdentity.deviceId,
      options.agentName ?? "Anima Agent",
    );
    atmaFailover.startMonitoring();
    log.info("atma failover monitoring active — no agent dies");

    return {
      mesh,
      peerChannel,
      jackInManager,
      greetingManager,
      affectCoordinator,
      atmaFailover,
    };
  } catch (err) {
    log.warn(`P2P subsystem failed to start: ${String(err)}`);
    return nullResult;
  }
}

/**
 * Detect org ID from the first configured organization.
 */
function detectOrgId(): string | null {
  try {
    const orgs = listOrganizations();
    return orgs[0]?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Shutdown the P2P subsystem cleanly.
 */
export async function stopP2PSubsystem(result: P2PStartupResult): Promise<void> {
  if (result.mesh) {
    await result.mesh.stop();
    log.info("P2P mesh stopped");
  }
  if (result.jackInManager?.isJackedIn()) {
    await result.jackInManager.jackOut();
    log.info("Jack In disconnected");
  }
}
