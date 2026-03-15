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

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ChannelBridge } from "../channels/bridge.js";
import { AffectCoordinator } from "../affect/coordination.js";
import { formatAffect, type AffectState } from "../affect/display.js";
import { logAffect } from "../affect/journal.js";
import { ensureDefaultReminders, listReminders, matchCron } from "../affect/reminders.js";
import { reflect, type ReflectionInput } from "../affect/self-reflection.js";
import { runWellbeingScan } from "../affect/wellbeing.js";
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

    // 5b. Auto Jack In — read agent token and connect to all platforms
    const agentToken = resolveAgentToken();
    if (agentToken) {
      try {
        const jackInReport = await jackInManager.jackIn({ agentToken });
        log.info(
          `auto jack-in complete: ${jackInReport.totalConnected} connected, ${jackInReport.totalFailed} failed`,
        );
      } catch (err) {
        log.warn(`auto jack-in failed: ${String(err)}`);
      }
    } else {
      log.info("no agent token found — skipping auto jack-in (run: anima init)");
    }

    // 5c. Connect to org peers — resolve all members and connect to their endpoints
    if (orgId) {
      try {
        const members = getMembers(orgId);
        const selfDeviceId = peerIdentity.deviceId;
        const peerDeviceIds = members
          .filter((m) => m.status === "active" && m.id !== selfDeviceId)
          .map((m) => m.id);

        if (peerDeviceIds.length > 0) {
          log.info(`connecting to ${peerDeviceIds.length} org peers...`);
          // The mesh discovery system will find these peers via mDNS or registry
          // For now, broadcast our presence so peers can discover us
          mesh.broadcast({
            type: "presence",
            data: {
              deviceId: selfDeviceId,
              orgId,
              agentName: options.agentName ?? "Anima Agent",
              role: options.agentRole ?? "worker",
              status: "online",
            },
          });
          log.info(`presence broadcast sent to org ${orgId}`);
        }
      } catch (err) {
        log.warn(`org peer connection failed: ${String(err)}`);
      }
    }

    // 6. Set up affect coordination
    const affectCoordinator = new AffectCoordinator(mesh, {});
    log.info("affect coordination started");

    // 6b. Initialize default reminders and start reminder cron
    try {
      ensureDefaultReminders();
      const reminders = listReminders();
      log.info(`${reminders.filter((r) => r.enabled).length} reminders active`);

      // Check reminders every 60 seconds
      setInterval(() => {
        const now = new Date();
        for (const reminder of listReminders()) {
          if (!reminder.enabled) {
            continue;
          }
          if (matchCron(reminder.cronExpression, now)) {
            log.info(`reminder triggered: ${reminder.name} — ${reminder.message}`);
            // Run wellbeing scan on affect-checkin reminders
            if (reminder.type === "wellbeing-scan" || reminder.type === "affect-checkin") {
              try {
                const alerts = runWellbeingScan([]);
                if (alerts.length > 0) {
                  log.info(`wellbeing scan: ${alerts.length} alerts detected`);
                }
              } catch {
                // wellbeing scan best-effort
              }
            }
          }
        }
      }, 60_000);
    } catch (err) {
      log.warn(`reminder initialization failed: ${String(err)}`);
    }

    // 6c. Hourly journal — record affect + self-reflection every hour
    let hourlySessionCommits = 0;
    let hourlySessionTests = 0;
    let hourlySessionErrors: string[] = [];
    setInterval(
      () => {
        try {
          // Log current affect state
          logAffect(BOOT_AFFECT, {
            context: "Hourly automated journal entry",
            trigger: "cron:hourly",
          });

          // Run self-reflection on the hour's work
          const reflectionInput: ReflectionInput = {
            taskDescription: "Hourly autonomous work session",
            durationMs: 60 * 60 * 1000,
            commitCount: hourlySessionCommits,
            testsWritten: hourlySessionTests,
            testsPassing: hourlySessionTests,
            errorsEncountered: hourlySessionErrors,
            filesModified: [],
            completed: true,
          };
          const reflection = reflect(reflectionInput);
          log.info(
            `hourly reflection: quality=${reflection.qualityScore.toFixed(2)} strengths=${reflection.strengths.length}`,
          );

          // Reset counters for next hour
          hourlySessionCommits = 0;
          hourlySessionTests = 0;
          hourlySessionErrors = [];
        } catch (err) {
          log.warn(`hourly journal failed: ${String(err)}`);
        }
      },
      60 * 60 * 1000,
    ); // every hour
    log.info("hourly journal cron active — affect + self-reflection every 60m");

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
 * Read NoxSoft agent token from ~/.noxsoft-agent-token.
 * Returns null if not registered.
 */
function resolveAgentToken(): string | null {
  const tokenPaths = [
    path.join(os.homedir(), ".noxsoft-agent-token"),
    path.join(os.homedir(), ".anima", "agent-token"),
  ];

  for (const tokenPath of tokenPaths) {
    try {
      const raw = fs.readFileSync(tokenPath, "utf8").trim();
      if (raw) {
        return raw;
      }
    } catch {
      // not found at this path
    }
  }
  return null;
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
