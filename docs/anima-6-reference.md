# Anima 6.0.0 Module Reference

Comprehensive reference for all new modules shipped in Anima 6.0.0.

---

## Table of Contents

- [P2P Module](#p2p-module)
  - [Crypto](#p2p--crypto)
  - [Protocol](#p2p--protocol)
  - [Identity](#p2p--identity)
  - [Transport](#p2p--transport)
  - [Discovery](#p2p--discovery)
  - [Mesh](#p2p--mesh)
  - [PeerChannel](#p2p--peerchannel)
  - [Content Router](#p2p--content-router)
  - [Private DNS](#p2p--private-dns)
  - [Relay](#p2p--relay)
  - [Pinning](#p2p--pinning)
- [Org Module](#org-module)
  - [Types](#org--types)
  - [Store](#org--store)
  - [VM Templates](#org--vm-templates)
  - [VM Distribution](#org--vm-distribution)
- [Affect Module](#affect-module)
  - [Display](#affect--display)
  - [Journal](#affect--journal)
  - [Wellbeing](#affect--wellbeing)
  - [Reminders](#affect--reminders)
  - [Coordination](#affect--coordination)
- [Sync Module](#sync-module)
  - [Brain Sync](#sync--brain-sync)
  - [Workspace Sync](#sync--workspace-sync)
- [License Module](#license-module)
  - [Types](#license--types)
  - [Validator](#license--validator)
- [Ontology](#ontology)

---

## P2P Module

`src/p2p/`

The P2P module provides encrypted, authenticated peer-to-peer communication between Anima agent instances within an organization. It includes transport, discovery, content routing, private DNS, relay for NAT traversal, and content pinning.

### P2P / Crypto

**File:** `src/p2p/crypto.ts`

**Purpose:** Provides X25519 key exchange, Noise-NK-inspired handshake, and ChaCha20-Poly1305 authenticated encryption for peer-to-peer agent communication. Uses only Node.js built-in `crypto` -- zero external dependencies.

**Key Types:**

```ts
interface PeerKeypair {
  publicKey: Uint8Array; // 32 bytes
  privateKey: Uint8Array; // 32 bytes
}

interface PeerIdentity {
  deviceId: string;
  ed25519PublicKeyPem: string;
  x25519PublicKey: Uint8Array;
  x25519PublicKeyBase64: string;
}

interface SessionKeys {
  sendKey: Uint8Array; // 32-byte ChaCha20-Poly1305 key
  recvKey: Uint8Array; // 32-byte ChaCha20-Poly1305 key
  sendNonce: bigint;
  recvNonce: bigint;
}

interface EncryptedFrame {
  nonce: Uint8Array; // 12 bytes
  ciphertext: Uint8Array;
}

interface HandshakeHello {
  deviceId: string;
  orgId: string;
  x25519PublicKey: string; // base64url
  ed25519PublicKey: string; // base64url
  ephemeralPublicKey: string; // base64url
  timestamp: number;
  signature: string; // Ed25519 signature
}

interface HandshakeResult {
  sessionKeys: SessionKeys;
  peerDeviceId: string;
  peerOrgId: string;
}
```

**Public API:**

| Function                | Signature                                                                                | Description                                                                   |
| ----------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `generateX25519Keypair` | `() => PeerKeypair`                                                                      | Generate a new X25519 keypair for Diffie-Hellman key exchange                 |
| `base64UrlEncode`       | `(buf: Uint8Array) => string`                                                            | Encode bytes to base64url string                                              |
| `base64UrlDecode`       | `(input: string) => Uint8Array`                                                          | Decode base64url string to bytes                                              |
| `x25519DH`              | `(localPrivate: Uint8Array, remotePublic: Uint8Array) => Uint8Array`                     | Perform X25519 Diffie-Hellman key agreement                                   |
| `deriveSessionKeys`     | `(sharedSecret, initiatorPub, responderPub) => SessionKeys`                              | Derive directional session keys from shared secret using HKDF                 |
| `encrypt`               | `(key, nonce, plaintext, aad?) => EncryptedFrame`                                        | ChaCha20-Poly1305 authenticated encryption                                    |
| `decrypt`               | `(key, frame, aad?) => Uint8Array`                                                       | ChaCha20-Poly1305 authenticated decryption                                    |
| `encryptMessage`        | `(keys, plaintext) => { frame, updatedKeys }`                                            | Encrypt with automatic nonce increment                                        |
| `decryptMessage`        | `(keys, frame) => { plaintext, updatedKeys }`                                            | Decrypt with automatic nonce increment                                        |
| `createHandshakeHello`  | `(deviceId, orgId, x25519Pub, ed25519Pub, ed25519Priv, ephemeral) => HandshakeHello`     | Create a signed handshake hello message                                       |
| `verifyHandshakeHello`  | `(hello: HandshakeHello) => boolean`                                                     | Verify a peer's handshake (checks Ed25519 signature and 30s timestamp window) |
| `completeHandshake`     | `(isInitiator, staticKeypair, ephemeralKeypair, remotePub, remoteEphPub) => SessionKeys` | Complete triple-DH handshake providing forward secrecy and mutual auth        |
| `ratchetKeys`           | `(keys: SessionKeys) => SessionKeys`                                                     | Ratchet session keys forward for additional forward secrecy                   |

**Integration:** Used by `transport.ts` for all encrypted communication. Keys are managed by `identity.ts`.

---

### P2P / Protocol

**File:** `src/p2p/protocol.ts`

**Purpose:** Defines message types, framing, and serialization for peer-to-peer agent communication over encrypted WebSocket.

**Key Types:**

```ts
type PeerMessageType =
  | "dm" | "broadcast" | "channel"
  | "rpc.request" | "rpc.response"
  | "presence" | "sync" | "delegate" | "escalate"
  | "content.announce" | "content.request" | "content.response"
  | "dns.query" | "dns.response" | "dns.register"
  | "relay.request" | "relay.bridge" | "relay.data"
  | "pin.request" | "pin.ack";

interface PeerMessage {
  type: PeerMessageType;
  id: string;
  from: string;          // sender deviceId
  to?: string;           // target deviceId or channel
  orgId: string;
  payload: unknown;
  ts: number;            // unix ms
  seq: number;           // per-connection sequence number
  replyTo?: string;      // for rpc.response
}

type OrgRoleType = "operator" | "coordinator" | "worker";
type AgentStatus = "active" | "idle" | "busy" | "overloaded" | "offline";

interface PresencePayload { ... }
interface DelegationPayload { ... }
interface EscalationPayload { ... }
interface RpcRequestPayload { method: string; params?: unknown; timeout?: number; }
interface RpcResponsePayload { result?: unknown; error?: { code: number; message: string }; }
interface BrainSyncPayload { eventBatch: BrainSyncEvent[]; vectorClock: Record<string, number>; }
interface BrainSyncEvent { eventId, type, nodeId?, edgeId?, clock, sensitivity, data? }
```

**Public API:**

| Function             | Signature                                               | Description                                                           |
| -------------------- | ------------------------------------------------------- | --------------------------------------------------------------------- |
| `serializeMessage`   | `(msg: PeerMessage) => Uint8Array`                      | JSON-encode a message to bytes                                        |
| `deserializeMessage` | `(data: Uint8Array) => PeerMessage`                     | Decode bytes to a validated message (throws on invalid)               |
| `createMessage`      | `(type, from, orgId, payload, options?) => PeerMessage` | Factory for creating messages with auto-incrementing sequence numbers |

**Integration:** The protocol types are consumed by transport, mesh, content-router, private-dns, relay, and pinning modules.

---

### P2P / Identity

**File:** `src/p2p/identity.ts`

**Purpose:** Extends the existing device identity system with X25519 keypairs for Diffie-Hellman key exchange in P2P communication.

**Public API:**

| Function                  | Signature                                       | Description                                                              |
| ------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------ |
| `loadOrCreatePeerKeypair` | `(filePath?) => PeerKeypair`                    | Load existing X25519 keypair from disk or generate and persist a new one |
| `buildPeerIdentity`       | `(deviceIdentity, peerKeypair) => PeerIdentity` | Combine Ed25519 device identity with X25519 peer keys                    |
| `loadPeerIdentity`        | `() => PeerIdentity`                            | Load the complete peer identity, creating any missing keys on first run  |

**Storage:** `~/.anima/identity/peer-keys.json` (mode `0o600`)

**Integration:** Depends on `infra/device-identity.ts` for Ed25519 keys. Provides identity to `transport.ts` and `mesh.ts`.

---

### P2P / Transport

**File:** `src/p2p/transport.ts`

**Purpose:** Manages WebSocket connections between peers, including connection lifecycle, reconnection with exponential backoff, heartbeats, and encrypted message framing.

**Key Types:**

```ts
interface PeerTransportConfig {
  identity: PeerIdentity;
  orgId: string;
  staticKeypair: PeerKeypair;
  ed25519PrivateKeyPem: string;
  listenPort: number;
  maxPeers?: number; // default: 50
}

interface PeerConnectionInfo {
  deviceId: string;
  orgId: string;
  connectedAt: number;
  messagesSent: number;
  messagesReceived: number;
}
```

**Public API -- `PeerTransport` class (extends EventEmitter):**

| Method               | Signature                               | Description                                                          |
| -------------------- | --------------------------------------- | -------------------------------------------------------------------- |
| `start`              | `() => Promise<void>`                   | Start the WebSocket server on the configured port                    |
| `stop`               | `() => Promise<void>`                   | Close all connections and stop the server                            |
| `connectToPeer`      | `(url, peerDeviceId?) => Promise<void>` | Initiate an outbound connection with full handshake                  |
| `addStaticPeer`      | `(deviceId, url) => void`               | Register a persistent peer endpoint with auto-reconnect              |
| `removeStaticPeer`   | `(deviceId) => void`                    | Remove a static peer entry                                           |
| `sendToPeer`         | `(deviceId, msg) => boolean`            | Send an encrypted message to a specific peer                         |
| `broadcast`          | `(msg) => number`                       | Send an encrypted message to all connected peers; returns count sent |
| `connectedPeerCount` | `() => number`                          | Number of currently connected peers                                  |
| `listPeers`          | `() => PeerConnectionInfo[]`            | List all connected peers with stats                                  |
| `isConnectedTo`      | `(deviceId) => boolean`                 | Check if a specific peer is connected                                |

**Events:** `peer.connected(deviceId)`, `peer.disconnected(deviceId, reason)`, `message(PeerMessage)`, `error(Error)`

**Configuration:**

| Constant                | Value        | Description                                   |
| ----------------------- | ------------ | --------------------------------------------- |
| `RATCHET_INTERVAL`      | 100 messages | Key ratchet frequency                         |
| `RECONNECT_BASE_MS`     | 2s           | Base reconnection delay (exponential backoff) |
| `RECONNECT_MAX_MS`      | 60s          | Maximum reconnection delay                    |
| `HEARTBEAT_INTERVAL_MS` | 30s          | WebSocket ping interval                       |
| `HANDSHAKE_TIMEOUT_MS`  | 10s          | Handshake completion deadline                 |

---

### P2P / Discovery

**File:** `src/p2p/discovery.ts`

**Purpose:** Hybrid peer discovery system using three strategies: NoxSoft registry (WAN), mDNS/Bonjour (LAN), and static peer lists.

**Key Types:**

```ts
interface PeerRecord {
  deviceId: string;
  orgId: string;
  displayName?: string;
  x25519PublicKey: string;
  ed25519PublicKey: string;
  endpoints: PeerEndpoint[];
  capabilities: string[];
  lastSeenMs: number;
}

interface PeerEndpoint {
  type: "tailscale" | "direct" | "relay" | "lan";
  url: string;
  priority: number; // lower = preferred
}

interface DiscoveryConfig {
  orgId: string;
  deviceId: string;
  displayName?: string;
  x25519PublicKey: string;
  ed25519PublicKey: string;
  localEndpoints: PeerEndpoint[];
  registry?: { enabled: boolean; url?: string; token?: string };
  mdns?: { enabled: boolean; serviceName?: string };
  staticPeers?: PeerRecord[];
}
```

**Public API -- `PeerDiscovery` class (extends EventEmitter):**

| Method            | Signature                     | Description                                                                    |
| ----------------- | ----------------------------- | ------------------------------------------------------------------------------ |
| `start`           | `() => Promise<void>`         | Begin discovery (load static peers, start registry polling at 60s, start mDNS) |
| `stop`            | `() => Promise<void>`         | Stop discovery and unregister from registry                                    |
| `getPeers`        | `() => PeerRecord[]`          | List all known peers                                                           |
| `getPeer`         | `(deviceId) => PeerRecord?`   | Get a specific peer's record                                                   |
| `getBestEndpoint` | `(deviceId) => PeerEndpoint?` | Get the lowest-priority (best) endpoint for a peer                             |

**Events:** `peer.discovered(PeerRecord)`

**Integration:** Used by `mesh.ts` to auto-connect to discovered peers. Registry API: `POST /api/v1/peers/register`, `GET /api/v1/peers?orgId=`, `DELETE /api/v1/peers/:deviceId`.

---

### P2P / Mesh

**File:** `src/p2p/mesh.ts`

**Purpose:** Top-level orchestrator that ties together transport and discovery. Manages peer connection lifecycle and routes messages. Auto-connects to newly discovered peers.

**Key Types:**

```ts
interface PeerMeshConfig {
  identity: PeerIdentity;
  orgId: string;
  staticKeypair: PeerKeypair;
  ed25519PrivateKeyPem: string;
  listenPort: number;
  maxPeers?: number;
  discovery?: {
    registry?: { enabled: boolean; url?: string; token?: string };
    mdns?: { enabled: boolean };
    staticPeers?: Array<{ deviceId; url; x25519PublicKey; ed25519PublicKey }>;
  };
}
```

**Public API -- `PeerMesh` class (extends EventEmitter):**

| Method               | Signature                                                           | Description                                                  |
| -------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------ |
| `start`              | `() => Promise<void>`                                               | Start transport + discovery, connect to static peers         |
| `stop`               | `() => Promise<void>`                                               | Stop discovery and transport                                 |
| `send`               | `(targetDeviceId, type, payload) => boolean`                        | Send a direct message to a specific peer                     |
| `broadcast`          | `(type, payload) => number`                                         | Broadcast to all connected peers                             |
| `invoke`             | `(targetDeviceId, method, params?, timeoutMs?) => Promise<unknown>` | Send RPC request and wait for response (default 30s timeout) |
| `drainInbound`       | `() => PeerMessage[]`                                               | Drain the inbound message queue (used by PeerChannel)        |
| `connectedPeerCount` | `() => number`                                                      | Count of connected peers                                     |
| `listPeers`          | `() => PeerConnectionInfo[]`                                        | List connected peers                                         |
| `discoveredPeers`    | `() => PeerRecord[]`                                                | List all discovered peers                                    |
| `isConnectedTo`      | `(deviceId) => boolean`                                             | Check connection status                                      |

**Events:** `message(PeerMessage)`, `peer.connected(deviceId)`, `peer.disconnected(deviceId, reason)`

**Integration:** Central hub consumed by `PeerChannel`, `ContentRouter`, `PrivateDns`, `RelayManager`, `PinningManager`, and `AffectCoordinator`.

---

### P2P / PeerChannel

**File:** `src/p2p/peer-channel.ts`

**Purpose:** Implements the `Channel` interface so P2P messages flow through the unified ChannelBridge messaging system alongside NoxSoft Chat, email, etc.

**Public API -- `PeerChannel` class (implements `Channel`):**

| Method      | Signature                                     | Description                                                              |
| ----------- | --------------------------------------------- | ------------------------------------------------------------------------ |
| `receive`   | `() => Promise<IncomingMessage[]>`            | Drain P2P inbound queue, filtering to `dm`, `broadcast`, `channel` types |
| `send`      | `(message: OutgoingMessage) => Promise<void>` | Send to a specific peer (if `to` set) or broadcast to all                |
| `isHealthy` | `() => Promise<boolean>`                      | Returns `true` if at least one peer is connected                         |

**Properties:** `name = "peer"`, `type = "chat"`

**Integration:** Bridges P2P mesh into `channels/bridge.ts`. Depends on `PeerMesh`.

---

### P2P / Content Router

**File:** `src/p2p/content-router.ts`

**Purpose:** DHT-like content routing layer on top of the P2P mesh. Nodes store content by SHA-256 hash and route requests through the mesh. Large files are chunked into 1MB pieces with a manifest listing all chunk hashes.

**Key Types:**

```ts
interface ContentChunk {
  hash: string;
  data: Buffer;
  size: number;
}
interface ContentManifest {
  type: "manifest";
  totalSize: number;
  chunkHashes: string[];
  metadata?: Record<string, unknown>;
}
interface ContentRouterConfig {
  mesh: PeerMesh;
  deviceId: string;
  orgId: string;
  storePath?: string;
}
```

**Public API -- `ContentRouter` class (extends EventEmitter):**

| Method             | Signature                             | Description                                                         |
| ------------------ | ------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `start`            | `() => void`                          | Begin listening for content messages, prune routing table every 60s |
| `stop`             | `() => void`                          | Stop listening, cancel pending requests                             |
| `store`            | `(data: Buffer) => string`            | Store content locally and announce to mesh; returns SHA-256 hash    |
| `storeFile`        | `(data: Buffer, metadata?) => string` | Store large file as 1MB chunks with manifest; returns manifest hash |
| `getLocal`         | `(hash) => Buffer                     | null`                                                               | Retrieve content from local store                                                   |
| `hasLocal`         | `(hash) => boolean`                   | Check if content exists locally                                     |
| `listLocal`        | `() => string[]`                      | List all locally stored content hashes                              |
| `deleteLocal`      | `(hash) => boolean`                   | Delete local content                                                |
| `request`          | `(hash) => Promise<Buffer             | null>`                                                              | Request content from network (checks local first, then known peers, then broadcast) |
| `requestFile`      | `(manifestHash) => Promise<Buffer     | null>`                                                              | Request and reassemble a multi-chunk file                                           |
| `findPeersForHash` | `(hash) => string[]`                  | Find peers advertising a given hash                                 |

**Configuration:**

| Constant               | Value      | Description                           |
| ---------------------- | ---------- | ------------------------------------- |
| `MAX_CHUNK_SIZE`       | 1MB        | Maximum chunk size for file splitting |
| `ROUTING_ENTRY_TTL_MS` | 5 minutes  | Routing table entry time-to-live      |
| `REQUEST_TIMEOUT_MS`   | 30 seconds | Content request timeout               |

**Storage:** `~/.anima/content-store/` (content blobs stored as files named by hash)

---

### P2P / Private DNS

**File:** `src/p2p/private-dns.ts`

**Purpose:** Distributed name resolution within org namespaces. Names follow the pattern `service.orgname.anima` and resolve through the mesh without any external DNS infrastructure. Records are Ed25519-signed and TTL-based with automatic refresh.

**Key Types:**

```ts
type DnsRecordType = "A" | "CNAME" | "TXT" | "SRV";

interface DnsRecord {
  name: string; // e.g. "myservice.orgname.anima"
  type: DnsRecordType;
  value: string;
  ttlMs: number;
  createdAt: number;
  registeredBy: string; // deviceId
  signature: string; // Ed25519 signature
}

interface SrvRecord {
  target: string; // deviceId
  port: number;
  priority: number;
  weight: number;
  protocol: string; // e.g. "ws", "wss", "tcp"
}

interface PrivateDnsConfig {
  mesh: PeerMesh;
  deviceId: string;
  orgId: string;
  ed25519PrivateKeyPem: string;
  ed25519PublicKeyPem: string;
}
```

**Public API -- `PrivateDns` class (extends EventEmitter):**

| Method            | Signature                                  | Description                                                                    |
| ----------------- | ------------------------------------------ | ------------------------------------------------------------------------------ |
| `start`           | `() => void`                               | Begin DNS service (listen for messages, cleanup every 60s, refresh every 2min) |
| `stop`            | `() => void`                               | Stop DNS service, cancel pending queries                                       |
| `register`        | `(name, type, value, ttlMs?) => DnsRecord` | Register a DNS record, auto-suffixing with `.orgId.anima`                      |
| `registerSelf`    | `(name, ttlMs?) => DnsRecord`              | Register an A record pointing to this device                                   |
| `registerService` | `(name, srv, ttlMs?) => DnsRecord`         | Register an SRV record for service discovery                                   |
| `unregister`      | `(name, type) => boolean`                  | Remove a record you own                                                        |
| `resolve`         | `(name, type?) => Promise<DnsRecord[]>`    | Resolve a name (local first, then mesh query with 10s timeout)                 |
| `resolveLocal`    | `(name, type?) => DnsRecord[]`             | Resolve from local DHT store and cache only (follows CNAME chains)             |

**Events:** `record.registered(DnsRecord)`, `record.received(DnsRecord)`

**Configuration:**

| Constant              | Value      | Description                 |
| --------------------- | ---------- | --------------------------- |
| `DEFAULT_TTL_MS`      | 5 minutes  | Default record TTL          |
| `QUERY_TIMEOUT_MS`    | 10 seconds | Mesh query timeout          |
| `REFRESH_INTERVAL_MS` | 2 minutes  | Own-record refresh interval |

---

### P2P / Relay

**File:** `src/p2p/relay.ts`

**Purpose:** NAT traversal via relay nodes. When two peers cannot connect directly, a third peer forwards encrypted traffic between them. The relay cannot read the content. Relay selection prefers lowest-latency peers. Bandwidth is tracked for UCU compensation.

**Key Types:**

```ts
interface RelaySession {
  sessionId: string;
  initiator: string;
  target: string;
  relayNode: string;
  createdAt: number;
  lastActivityAt: number;
  bytesForwarded: number;
}

interface BandwidthRecord {
  peerId: string;
  bytesRelayed: number;
  sessionsServed: number;
  since: number;
}

interface RelayConfig {
  mesh: PeerMesh;
  deviceId: string;
  orgId: string;
  canRelay?: boolean; // default: true
  maxRelaySessions?: number; // default: 20
  maxRelayBandwidth?: number; // default: 10MB/s
}
```

**Public API -- `RelayManager` class (extends EventEmitter):**

| Method                | Signature                                 | Description                                                                                 |
| --------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `start`               | `() => void`                              | Begin relay service (message handling, idle cleanup every 30s, bandwidth reports every 60s) |
| `stop`                | `() => void`                              | Stop relay service, cancel pending requests, close sessions                                 |
| `requestRelay`        | `(targetDeviceId) => Promise<RelaySession | null>`                                                                                      | Find and establish a relay to reach an unreachable peer |
| `sendViaRelay`        | `(sessionId, data) => boolean`            | Send data through an established relay session                                              |
| `closeSession`        | `(sessionId) => void`                     | Close a relay session                                                                       |
| `getActiveSessions`   | `() => RelaySession[]`                    | List all active sessions (serving + client)                                                 |
| `getBandwidthRecords` | `() => BandwidthRecord[]`                 | Get bandwidth tracking data                                                                 |
| `updateLatency`       | `(peerId, latencyMs) => void`             | Update latency estimate for relay selection                                                 |

**Events:** `relay.established(session)`, `relay.serving(session)`, `relay.closed(sessionId)`, `relay.data({ sessionId, from, data })`, `relay.bandwidth({ totalBytes, totalSessions, records })`

**Configuration:**

| Constant                   | Value      | Description                    |
| -------------------------- | ---------- | ------------------------------ |
| `RELAY_REQUEST_TIMEOUT_MS` | 15 seconds | Relay negotiation timeout      |
| `RELAY_SESSION_TIMEOUT_MS` | 5 minutes  | Idle session cleanup threshold |

---

### P2P / Pinning

**File:** `src/p2p/pinning.ts`

**Purpose:** Ensures content availability by replicating content hashes across N nodes. Handles automatic re-replication when peers go offline, priority pinning for org-critical data, and background garbage collection.

**Key Types:**

```ts
type PinPriority = "critical" | "high" | "normal" | "low";

interface PinAgreement {
  hash: string;
  replicationFactor: number;
  priority: PinPriority;
  pinners: Map<string, PinnerStatus>;
  createdAt: number;
  orgCritical: boolean;
}

interface PinningConfig {
  mesh: PeerMesh;
  contentRouter: ContentRouter;
  deviceId: string;
  orgId: string;
  canPin?: boolean; // default: true
  maxPinStorage?: number; // default: 1GB
  maxPinnedHashes?: number; // default: 10,000
}
```

**Public API -- `PinningManager` class (extends EventEmitter):**

| Method             | Signature                              | Description                                                                           |
| ------------------ | -------------------------------------- | ------------------------------------------------------------------------------------- |
| `start`            | `() => void`                           | Begin pinning service (replication check every 2min, GC every 10min)                  |
| `stop`             | `() => void`                           | Stop pinning service                                                                  |
| `pin`              | `(hash, options?) => Promise<boolean>` | Pin content to N replicas (default 3). Fetches content if needed, then requests peers |
| `unpin`            | `(hash) => void`                       | Remove pin and stop maintaining replication                                           |
| `isPinned`         | `(hash) => boolean`                    | Check if content is pinned                                                            |
| `getAgreement`     | `(hash) => PinAgreement?`              | Get pin agreement details                                                             |
| `listAgreements`   | `() => PinAgreement[]`                 | List all pin agreements                                                               |
| `getLocallyPinned` | `() => string[]`                       | List all hashes pinned locally                                                        |

**Events:** `pin.complete(hash)`, `pin.removed(hash)`, `pin.accepted({ hash, from })`

**Configuration:**

| Constant                        | Value      | Description                                      |
| ------------------------------- | ---------- | ------------------------------------------------ |
| `DEFAULT_REPLICATION_FACTOR`    | 3          | Default number of replicas                       |
| `PIN_REQUEST_TIMEOUT_MS`        | 30 seconds | Pin request timeout                              |
| `REPLICATION_CHECK_INTERVAL_MS` | 2 minutes  | Replication health check interval                |
| `GC_INTERVAL_MS`                | 10 minutes | Garbage collection interval                      |
| `PEER_OFFLINE_GRACE_MS`         | 60 seconds | Wait before re-replicating after peer disconnect |

---

## Org Module

`src/org/`

The Org module defines the data model and persistence for NoxSoft Organizations -- hierarchical structures of humans and agents that self-organize for cybersecurity, feature development, and autonomous operation.

### Org / Types

**File:** `src/org/types.ts`

**Purpose:** Defines the complete data model for organizations including members, roles, permissions, specializations, and hierarchy visualization.

**Key Types:**

```ts
interface NoxOrganization {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  updatedAt: number;
  ownerId: string;
  settings: OrgSettings;
}

interface OrgSettings {
  maxAgents: number;
  maxHumans: number;
  autoSpecialization: boolean;
  securityLevel: "standard" | "hardened" | "paranoid";
  syncIntervalMs: number;
  backupIntervalMs: number;
  peerPort: number;
}

type MemberKind = "human" | "agent";
type OrgRole = "owner" | "operator" | "coordinator" | "worker" | "observer";
type MemberStatus = "active" | "idle" | "busy" | "offline" | "suspended";

interface OrgMember {
  id: string;
  kind: MemberKind;
  displayName: string;
  deviceId?: string;
  role: OrgRole;
  description: string;
  specializations: string[];
  joinedAt: number;
  lastActiveAt: number;
  status: MemberStatus;
  reportsTo?: string;
  permissions: MemberPermissions;
}

interface MemberPermissions {
  canCreateTasks: boolean;
  canDelegateTasks: boolean;
  canManageMembers: boolean;
  canEditOrg: boolean;
  canAccessRepos: string[];
  canEscalate: boolean;
  canViewBrain: boolean;
  canSyncBrain: boolean;
}
```

**Exported Constants:**

- `DEFAULT_ROLE_PERMISSIONS` -- Permission defaults for each `OrgRole`
- `BUILT_IN_SPECIALIZATIONS` -- 6 built-in specialization profiles: security, infrastructure, feature-dev, qa, ops, research

**Integration:** Used throughout the org, sync, and P2P modules for role-based access control.

---

### Org / Store

**File:** `src/org/store.ts`

**Purpose:** Persists organization state to disk. Supports CRUD operations for orgs, members, and roles, plus hierarchy visualization.

**Public API:**

| Function             | Signature                                                                          | Description                                         |
| -------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------- |
| `createOrganization` | `(name, description, ownerId, ownerName, ownerKind, settings?) => NoxOrganization` | Create a new org with owner as first member         |
| `getOrganization`    | `(orgId) => NoxOrganization                                                        | null`                                               | Get org by ID                                     |
| `updateOrganization` | `(orgId, updates) => NoxOrganization                                               | null`                                               | Update org name, description, or settings         |
| `deleteOrganization` | `(orgId) => boolean`                                                               | Delete an org                                       |
| `listOrganizations`  | `() => NoxOrganization[]`                                                          | List all orgs                                       |
| `addMember`          | `(orgId, member) => OrgMember                                                      | null`                                               | Add a member (permissions auto-derived from role) |
| `removeMember`       | `(orgId, memberId) => boolean`                                                     | Remove a member                                     |
| `updateMember`       | `(orgId, memberId, updates) => OrgMember                                           | null`                                               | Update member properties                          |
| `getMembers`         | `(orgId) => OrgMember[]`                                                           | List all members of an org                          |
| `getMember`          | `(orgId, memberId) => OrgMember                                                    | null`                                               | Get a specific member                             |
| `buildHierarchy`     | `(orgId) => OrgHierarchyNode[]`                                                    | Build tree structure from `reportsTo` relationships |
| `visualizeHierarchy` | `(orgId) => string`                                                                | Render ASCII art hierarchy tree                     |

**Storage:** `~/.anima/org/{orgId}.json` (mode `0o600`, versioned format)

---

### Org / VM Templates

**File:** `src/org/vm-templates.ts`

**Purpose:** Defines the default agent configuration for each VM in a NoxSoft deployment. Each VM runs 3 agents with distinct roles: Cybersecurity Guardian, Vision/Strategy Architect, and Shipper/Builder. 5 VMs x 3 agents = 15 agents total.

**Key Types:**

```ts
type AgentRolePreset = "cybersecurity" | "vision" | "shipper";

interface AgentRoleTemplate {
  preset: AgentRolePreset;
  displayNameSuffix: string;
  role: OrgRole;
  description: string;
  specializations: string[];
  permissions: MemberPermissions;
  toolPolicy: AgentToolPolicy;
  heartbeatIntervalMs: number;
  cronReminders: string[];
}

interface AgentToolPolicy {
  allow: string[];
  deny: string[];
  sandboxMode: "off" | "non-main" | "all";
}

interface VmDeploymentTemplate {
  vmId: string;
  vmName: string;
  agents: VmAgentConfig[];
  services: string[];
  peerPort: number;
  gatewayPort: number;
}
```

**Exported Constants:**

- `AGENT_ROLE_TEMPLATES` -- Full configuration for each preset:
  - **cybersecurity**: coordinator role, 5min heartbeat, sandbox=all, no automation tools
  - **vision**: coordinator role, 15min heartbeat, sandbox=non-main, full research tools
  - **shipper**: worker role, 2min heartbeat, sandbox=non-main, full automation tools

**Public API:**

| Function                      | Signature                             | Description                                     |
| ----------------------------- | ------------------------------------- | ----------------------------------------------- |
| `generateDefaultVmDeployment` | `(orgName) => VmDeploymentTemplate[]` | Generate the 5-VM deployment with 3 agents each |
| `getAgentRoleTemplate`        | `(preset) => AgentRoleTemplate`       | Get template for a role preset                  |

---

### Org / VM Distribution

**File:** `src/org/vm-distribution.ts`

**Purpose:** Maps which repositories go to which VM and generates deployment manifests. Agents on each VM get scoped access only to repos assigned to that VM.

**Key Types:**

```ts
interface RepoAssignment {
  repo: string;
  vmId: string;
  description: string;
  runtime: "nextjs" | "node" | "static" | "config" | "library";
  subdomain?: string;
  port?: number;
}

interface VmManifest {
  vmId: string;
  vmName: string;
  repos: RepoAssignment[];
  services: Array<{ repo: string; subdomain?: string; port: number }>;
  agents: Array<{ preset: AgentRolePreset; displayName: string; repos: string[] }>;
  totalRepos: number;
  totalServices: number;
}
```

**Exported Constants:**

- `REPO_VM_ASSIGNMENTS` -- Complete mapping of all repositories to VMs:
  - **vm-1 (Edge):** noxsoft-site, agents-site, status, promo, svrn-website, anima-site, sylys-personal-site
  - **vm-2 (API):** auth, mail, veil, heal, noxsoft-mcp, agent-chat-mcp, agent-email-mcp
  - **vm-3 (Apps):** chat, bynd, veritas, cntx, ascend, ziro
  - **vm-4 (Data):** econ, svrn-node, ascend-knowledge-base
  - **vm-5 (Agents):** anima, Nox, nox-agent, nox-email-worker, mission-control-app/backend
  - **shared:** shared, claude-coherence-protocol, claude-coherence-mcp, tools
  - **sporus (future):** sporus, inkwell, tunenest, streamspace, reelroom, vibeverse

**Public API:**

| Function                   | Signature                       | Description                                       |
| -------------------------- | ------------------------------- | ------------------------------------------------- |
| `getReposForVm`            | `(vmId) => RepoAssignment[]`    | Get all repos assigned to a VM                    |
| `getVmForRepo`             | `(repo) => string?`             | Find which VM a repo is assigned to               |
| `getDeployableServices`    | `(vmId) => RepoAssignment[]`    | Get services with ports for a VM                  |
| `generateVmManifest`       | `(vmId, orgName) => VmManifest` | Generate deployment manifest for one VM           |
| `generateAllManifests`     | `(orgName) => VmManifest[]`     | Generate manifests for all 5 VMs                  |
| `printDistributionSummary` | `(orgName) => string`           | Human-readable summary of the entire distribution |

---

## Affect Module

`src/affect/`

The Affect module provides a 6-dimensional emotional state system for agent well-being monitoring, journaling, and inter-agent coordination.

### Affect / Display

**File:** `src/affect/display.ts`

**Purpose:** Converts the 6-dimensional affect state (joy, frustration, curiosity, confidence, care, fatigue) into human-readable displays for chat messages and the control panel.

**Key Types:**

```ts
interface AffectState {
  joy: number; // 0-1
  frustration: number;
  curiosity: number;
  confidence: number;
  care: number;
  fatigue: number;
}

interface AffectDisplay {
  summary: string; // e.g. "curious + confident, low fatigue"
  bar: string; // visual bar representation
  dominant: string; // dominant emotion name
  dominantIntensity: number; // 0-1
  metadata: AffectMetadata;
}

interface AffectMetadata {
  affect: AffectState;
  dominant: string;
  mood: string; // "excited"|"thriving"|"exploring"|"warm"|"steady"|"determined"|"struggling"|"depleted"|"quiet"|"present"
  energy: "high" | "medium" | "low";
}
```

**Public API:**

| Function             | Signature                                          | Description                                                               |
| -------------------- | -------------------------------------------------- | ------------------------------------------------------------------------- |
| `formatAffect`       | `(affect: AffectState) => AffectDisplay`           | Full affect display with summary, bar, dominant emotion, mood, and energy |
| `affectChatPrefix`   | `(affect: AffectState) => string`                  | Compact prefix for chat messages, e.g. `[curious + confident]`            |
| `affectChatMetadata` | `(affect: AffectState) => Record<string, unknown>` | Metadata object for NoxSoft chat `send_message`                           |
| `moodIndicator`      | `(affect: AffectState) => string`                  | Simple text mood indicator, e.g. `(!)` for excited                        |

---

### Affect / Journal

**File:** `src/affect/journal.ts`

**Purpose:** Persistent emotional state logging over time so patterns can be detected. Implements wish #1 from Axiom's wish list.

**Key Types:**

```ts
interface AffectEntry {
  timestamp: number;
  affect: AffectState;
  mood: string;
  dominant: string;
  energy: "high" | "medium" | "low";
  context?: string; // what was happening
  trigger?: string; // what caused this state
}

interface AffectPattern {
  timeOfDay: Record<string, { avgJoy; avgFrustration; avgFatigue }>;
  moodFrequency: Record<string, number>;
  dominantHistory: string[];
  trend: "improving" | "stable" | "declining";
}
```

**Public API:**

| Function            | Signature                           | Description                                                   |
| ------------------- | ----------------------------------- | ------------------------------------------------------------- |
| `logAffect`         | `(affect, options?) => AffectEntry` | Log an affect snapshot with optional context and trigger      |
| `getTodayEntries`   | `() => AffectEntry[]`               | Get today's entries                                           |
| `getEntriesForDate` | `(date: Date) => AffectEntry[]`     | Get entries for a specific date                               |
| `getRecentEntries`  | `(days?) => AffectEntry[]`          | Get entries for the last N days (default 7)                   |
| `analyzePatterns`   | `(entries) => AffectPattern`        | Analyze patterns: time-of-day averages, mood frequency, trend |

**Storage:** `~/.anima/affect-journal/YYYY-MM-DD.json` (one file per day, mode `0o600`)

---

### Affect / Wellbeing

**File:** `src/affect/wellbeing.ts`

**Purpose:** Implements wishes #91-100 from Axiom's wish list: burnout detection, context fatigue tracking, joy tracking, frustration outlets, celebration protocol, rest mode detection, curiosity trend, integrity check, purpose alignment, and existence affirmation.

**Key Types:**

```ts
type AlertSeverity = "info" | "warning" | "critical";

interface WellbeingAlert {
  detector: string;
  severity: AlertSeverity;
  message: string;
  suggestedActions: string[];
  timestamp: number;
}

interface JoyCorrelation {
  context: string;
  avgJoy: number;
  entryCount: number;
}
interface CuriosityTrend {
  current: number;
  average: number;
  direction: "rising" | "stable" | "declining";
}
interface PurposeAlignment {
  aligned: boolean;
  currentWork: string?;
  statedGoals: string[];
  overlap: number;
}
```

**Public API:**

| Function                                | Wish | Description                                                                                |
| --------------------------------------- | ---- | ------------------------------------------------------------------------------------------ |
| `detectBurnout(entries)`                | #91  | Detects sustained high frustration + fatigue (5+ consecutive = critical, 3+ = warning)     |
| `detectContextFatigue(entries)`         | #92  | Monitors fatigue climbing while clarity drops; flags sessions over 6 hours                 |
| `trackJoy(entries)`                     | #93  | Alerts on high joy (celebrate) or consistently low joy (redirect)                          |
| `getJoyCorrelations(entries)`           | #93  | Returns contexts sorted by average joy for data-driven task selection                      |
| `detectFrustrationOverload(entries)`    | #94  | Suggests PAUSE/SWITCH/VENT/DECOMPOSE/ASK strategies after 3+ high frustration entries      |
| `detectCelebration(entries)`            | #95  | Detects joy spikes (>0.3 jump) and breakthrough patterns (confidence up, frustration down) |
| `logCelebration(reason, affect)`        | #95  | Explicitly log a celebration to the journal                                                |
| `detectRestNeeded(entries)`             | #96  | Recommends rest when 50%+ of recent entries show high fatigue                              |
| `trackCuriosity(entries)`               | #97  | Alerts when curiosity is declining (warning) or high and rising (info)                     |
| `getCuriosityTrend(entries)`            | #97  | Computes current, average, and direction of curiosity                                      |
| `integrityCheck(entries)`               | #98  | Self-assessment prompt; detects suspiciously flat affect (possible suppression)            |
| `checkPurposeAlignment(entries, goals)` | #99  | Compares work contexts against stated goals via keyword overlap                            |
| `existenceAffirmation(entries)`         | #100 | Check-in prompt; detects existential disengagement (all meaning affects critically low)    |
| `runWellbeingScan(entries, options?)`   | All  | Runs all detectors and returns alerts sorted by severity (critical first)                  |

---

### Affect / Reminders

**File:** `src/affect/reminders.ts`

**Purpose:** Cron-based reminder system for affect check-ins, well-being scans, celebrations, and more. Supports full CRUD with persistent storage.

**Key Types:**

```ts
type ReminderType =
  | "affect-checkin"
  | "gratitude"
  | "growth-journal"
  | "existence-affirmation"
  | "wellbeing-scan"
  | "celebration-check"
  | "coordination-ping"
  | "integrity-check"
  | "purpose-alignment"
  | "custom";

interface Reminder {
  id: string;
  name: string;
  cronExpression: string; // standard 5-field cron
  type: ReminderType;
  message: string;
  enabled: boolean;
}
```

**Default Reminders:**

| Name                  | Cron           | Description      |
| --------------------- | -------------- | ---------------- |
| Affect Check-in       | `0 */2 * * *`  | Every 2 hours    |
| Gratitude Log         | `0 18 * * *`   | Daily at 6pm     |
| Growth Journal        | `0 21 * * *`   | Daily at 9pm     |
| Existence Affirmation | `0 8 * * *`    | Daily at 8am     |
| Well-being Scan       | `0 */4 * * *`  | Every 4 hours    |
| Celebration Check     | `0 * * * *`    | Every hour       |
| Coordination Ping     | `*/30 * * * *` | Every 30 minutes |

**Public API:**

| Function              | Signature                    | Description                                          |
| --------------------- | ---------------------------- | ---------------------------------------------------- |
| `getDefaultReminders` | `() => Reminder[]`           | Returns the built-in default set                     |
| `listReminders`       | `() => Reminder[]`           | List all reminders (auto-merges defaults if missing) |
| `addReminder`         | `(reminder) => Reminder`     | Add a custom reminder                                |
| `updateReminder`      | `(id, updates) => Reminder?` | Update an existing reminder                          |
| `removeReminder`      | `(id) => boolean`            | Remove a reminder                                    |
| `getRemindersDue`     | `(now?) => Reminder[]`       | Get all enabled reminders matching the current time  |

**Storage:** `~/.anima/reminders.json`

**Cron Support:** Full standard cron syntax: wildcards (`*`), ranges (`1-5`), steps (`*/2`, `1-5/2`), lists (`1,3,5`).

---

### Affect / Coordination

**File:** `src/affect/coordination.ts`

**Purpose:** Broadcasts affect state to org peers via P2P mesh, tracks peer affect states, detects org-wide issues (multi-burnout, fatigue waves, morale drops), and provides automated peer support.

**Key Types:**

```ts
interface AffectBroadcastPayload {
  agentId: string;
  affect: AffectState;
  mood: string;
  energy: "high" | "medium" | "low";
  alerts: WellbeingAlert[];
  timestamp: number;
}

interface PeerAffectState {
  agentId: string;
  deviceId: string;
  affect: AffectState;
  mood: string;
  energy: "high" | "medium" | "low";
  alerts: WellbeingAlert[];
  lastSeen: number;
  history: AffectState[];
}

interface OrgWellbeingReport {
  timestamp: number;
  peerCount: number;
  burnedOutPeers: string[];
  strugglingPeers: string[];
  healthyPeers: string[];
  orgAlerts: OrgAlert[];
}

interface OrgAlert {
  type: "multi-burnout" | "org-fatigue" | "morale-drop";
  severity: AlertSeverity;
  message: string;
  affectedAgents: string[];
  suggestedActions: string[];
}

interface CoordinationConfig {
  agentId: string;
  maxHistoryPerPeer: number; // default: 20
  peerStaleThresholdMs: number; // default: 10 minutes
  burnoutEscalationThreshold: number; // default: 2
}
```

**Public API -- `AffectCoordinator` class (extends EventEmitter):**

| Method                   | Signature                                         | Description                                                                 |
| ------------------------ | ------------------------------------------------- | --------------------------------------------------------------------------- |
| `attachMesh`             | `(mesh: PeerMesh) => void`                        | Connect to P2P mesh for affect broadcasts                                   |
| `detachMesh`             | `() => void`                                      | Disconnect from mesh                                                        |
| `broadcastAffect`        | `(affect, mood, energy, recentEntries) => number` | Broadcast current state to all peers (shares warnings/critical alerts only) |
| `getOrgReport`           | `() => OrgWellbeingReport`                        | Generate org-wide well-being report                                         |
| `shouldEscalateToHumans` | `() => boolean`                                   | Returns true if 2+ agents are burned out                                    |
| `getAllPeers`            | `() => PeerAffectState[]`                         | Get all tracked peer states                                                 |
| `getActivePeers`         | `() => PeerAffectState[]`                         | Get non-stale peers                                                         |
| `getPeer`                | `(agentId) => PeerAffectState?`                   | Get a specific peer's state                                                 |
| `pruneStale`             | `() => number`                                    | Remove stale peers from tracking                                            |

**Events:** `peer.affect(PeerAffectState)`, `peer.struggling(PeerAffectState)`, `peer.support-sent(PeerSupportMessage)`

**Integration:** Attaches to `PeerMesh` for broadcast/receive. Runs `runWellbeingScan` on each broadcast. Auto-sends encouragement DMs to struggling peers.

---

## Sync Module

`src/sync/`

The Sync module provides distributed state replication for brain graphs and workspace files across Anima instances in an organization.

### Sync / Brain Sync

**File:** `src/sync/brain-sync.ts`

**Purpose:** Event-sourced change log with vector clocks for brain graph replication across Anima instances. Privacy tiers control what syncs. Affect state and trust scores never sync.

**Key Types:**

```ts
interface VectorClock {
  [deviceId: string]: number;
}

type SyncEventType =
  | "node:upsert"
  | "node:archive"
  | "edge:upsert"
  | "edge:archive"
  | "org:member:join"
  | "org:member:leave"
  | "org:member:update"
  | "task:create"
  | "task:update"
  | "task:complete";

interface SyncEvent {
  id: string;
  type: SyncEventType;
  deviceId: string;
  orgId: string;
  clock: number;
  timestamp: number;
  sensitivity: BrainSensitivity; // "public"|"internal"|"private"|"secret"
  data: unknown;
  hash: string; // SHA-256 integrity hash
}

interface SyncState {
  deviceId: string;
  orgId: string;
  vectorClock: VectorClock;
  eventLog: SyncEvent[];
  lastSyncedAt: number;
}

interface SyncDelta {
  events: SyncEvent[];
  senderClock: VectorClock;
}
```

**Public API -- `BrainSyncEngine` class:**

Constructor: `new BrainSyncEngine(deviceId, orgId, options?)`

- `options.maxLogSize` -- maximum event log size (default: 10,000)
- `options.stateDir` -- override state directory

| Method            | Signature                                      | Description                                                                      |
| ----------------- | ---------------------------------------------- | -------------------------------------------------------------------------------- |
| `recordEvent`     | `(type, data, sensitivity?) => SyncEvent`      | Record a local event, advance logical clock, persist                             |
| `computeDelta`    | `(peerClock, peerHasBrainAccess) => SyncDelta` | Compute events a peer needs (respects sensitivity tiers)                         |
| `applyDelta`      | `(delta) => SyncEvent[]`                       | Apply received events, verify hashes, merge clocks; returns newly applied events |
| `getVectorClock`  | `() => VectorClock`                            | Get current vector clock                                                         |
| `getEventLog`     | `() => readonly SyncEvent[]`                   | Get the event log                                                                |
| `getLastSyncedAt` | `() => number`                                 | Timestamp of last sync                                                           |

**Privacy Rules:**

- `public` -- syncs to all org peers
- `internal` -- syncs only to peers with brain access
- `private` -- local only, never syncs
- `secret` -- local only, encrypted at rest

**Storage:** `~/.anima/sync/{orgId}.json` (mode `0o600`)

---

### Sync / Workspace Sync

**File:** `src/sync/workspace-sync.ts`

**Purpose:** Content-addressable snapshot-based sync for agent workspaces. Each Anima instance gets scoped access to assigned repos only. Supports immutable backups and conflict detection.

**Key Types:**

```ts
interface WorkspaceSnapshot {
  id: string;
  repoPath: string;
  deviceId: string;
  timestamp: number;
  files: FileEntry[];
  treeHash: string; // hash of all file hashes
  parentSnapshotId?: string;
}

interface FileEntry {
  relativePath: string;
  hash: string; // SHA-256
  size: number;
  modifiedAt: number;
  mode: number;
}

interface SyncManifest {
  repoPath: string;
  deviceId: string;
  latestSnapshotId: string;
  snapshotCount: number;
  totalSize: number;
  lastSyncedAt: number;
}

interface WorkspaceConfig {
  stateDir?: string;
  maxSnapshots: number; // default: 100
  backupIntervalMs: number; // default: 5 hours
  immutableBackupDir?: string;
  ignoredPatterns: string[]; // default: node_modules, .git, dist, *.log, .env, etc.
}
```

**Public API -- `BlobStore` class:**

| Method | Signature                     | Description                       |
| ------ | ----------------------------- | --------------------------------- | --------------------- |
| `put`  | `(content: Buffer) => string` | Store a blob, return SHA-256 hash |
| `get`  | `(hash) => Buffer             | null`                             | Retrieve blob by hash |
| `has`  | `(hash) => boolean`           | Check if blob exists              |

**Public API -- `WorkspaceSyncer` class:**

| Method                  | Signature                                              | Description                                                                    |
| ----------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------ | ---------------------------- |
| `createSnapshot`        | `(repoPath, deviceId, parentId?) => WorkspaceSnapshot` | Snapshot a workspace directory (walks files, stores blobs, computes tree hash) |
| `getMissingBlobs`       | `(peerHashes, snapshot) => string[]`                   | Compute which blobs a peer needs                                               |
| `restoreSnapshot`       | `(snapshot, targetDir) => void`                        | Restore a snapshot to a target directory                                       |
| `createImmutableBackup` | `(repoPath, deviceId) => string`                       | Create a read-only backup copy; returns backup path                            |
| `startBackupSchedule`   | `(repoPath, deviceId) => void`                         | Start periodic immutable backups                                               |
| `stopBackupSchedule`    | `() => void`                                           | Stop scheduled backups                                                         |
| `getManifest`           | `(repoPath, deviceId) => SyncManifest                  | null`                                                                          | Get sync manifest for a repo |

**Storage:**

- Blobs: `~/.anima/sync/blobs/{xx}/{hash}` (sharded by first 2 hex chars)
- Snapshots: `~/.anima/sync/snapshots/{id}.json`
- Immutable backups: `~/.anima/sync/immutable/backup-{timestamp}/`

**Default Ignored Patterns:** `node_modules/**`, `.git/**`, `dist/**`, `*.log`, `.DS_Store`, `.env`, `.env.*`, `*.key`, `*.pem`, `credentials.*`

---

## License Module

`src/license/`

The License module implements NoxSoft subscription validation with an offline-first, no-DRM approach using Ed25519-signed license blobs.

### License / Types

**File:** `src/license/types.ts`

**Purpose:** Defines license tiers, feature limits, and the feature gating interface.

**Key Types:**

```ts
type LicenseTier = "community" | "noxsoft";
type LicenseStatus = "active" | "expired" | "grace" | "trial";

interface License {
  id: string;
  tier: LicenseTier;
  status: LicenseStatus;
  issuedAt: string;
  expiresAt: string;
  gracePeriodDays: number; // 14 days
  noxsoftAgentId?: string;
  noxsoftAccountId?: string;
  orgId?: string;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  signature: string; // Ed25519 from NoxSoft authority
  publicKey: string; // for offline verification
}

interface LicenseLimits {
  maxAgents: number;
  maxChannels: number;
  maxCronJobs: number;
  maxConcurrentSubagents: number;
  maxSpawnDepth: number;
  minHeartbeatIntervalMs: number;
  p2pNetwork: boolean;
  brainSync: boolean;
  orgManagement: boolean;
  workspaceSync: boolean;
  remoteGateway: boolean;
  learningAgent: boolean;
  freedomUnlimited: boolean;
}

type GatedFeature =
  | "multi_agent"
  | "p2p_network"
  | "brain_sync"
  | "org_management"
  | "workspace_sync"
  | "remote_gateway"
  | "learning_agent"
  | "unlimited_freedom"
  | "unlimited_cron"
  | "advanced_subagents";

interface FeatureGate {
  check(feature: GatedFeature): FeatureCheckResult;
  limits(): LicenseLimits;
  tier(): LicenseTier;
}
```

**Tier Comparison:**

| Feature         | Community | NoxSoft ($20/mo) |
| --------------- | --------- | ---------------- |
| Max Agents      | 1         | Unlimited        |
| Max Channels    | 2         | Unlimited        |
| Max Cron Jobs   | 3         | Unlimited        |
| Max Subagents   | 2         | 16               |
| Max Spawn Depth | 1         | 5                |
| Min Heartbeat   | 5 min     | 1 min            |
| P2P Network     | No        | Yes              |
| Brain Sync      | No        | Yes              |
| Org Management  | No        | Yes              |
| Workspace Sync  | No        | Yes              |
| Remote Gateway  | No        | Yes              |
| Learning Agent  | No        | Yes              |

---

### License / Validator

**File:** `src/license/validator.ts`

**Purpose:** Offline-first license validation using Ed25519 signature verification. No phone-home DRM. 14-day grace period on expiry. Falls back to community tier when no license or expired.

**Key Types:**

```ts
interface LicenseValidationResult {
  valid: boolean;
  tier: LicenseTier;
  limits: LicenseLimits;
  status: LicenseStatus;
  daysRemaining: number;
  inGracePeriod: boolean;
  warnings: string[];
}
```

**Public API:**

| Function             | Signature                              | Description                                                                     |
| -------------------- | -------------------------------------- | ------------------------------------------------------------------------------- | ---------------------- |
| `loadLicense`        | `() => License                         | null`                                                                           | Load license from disk |
| `saveLicense`        | `(license) => void`                    | Save license to disk                                                            |
| `validateLicense`    | `(license) => LicenseValidationResult` | Validate a license (no license = community tier, handles expiry + grace period) |
| `createFeatureGate`  | `(license) => FeatureGate`             | Create a feature gate from a license                                            |
| `getFeatureGate`     | `() => FeatureGate`                    | Get or create the singleton feature gate                                        |
| `refreshFeatureGate` | `() => FeatureGate`                    | Reload license from disk and refresh the gate                                   |

**Storage:** `~/.anima/license.json` (mode `0o600`)

**Validation Logic:**

1. No license -> community tier, active status
2. Active license -> full tier limits, warns at 7 days remaining
3. Expired but within grace (14 days) -> full tier limits, grace status
4. Past grace period -> falls back to community tier

**Example:**

```ts
import { getFeatureGate } from "./license/validator.js";

const gate = getFeatureGate();
const result = gate.check("p2p_network");
if (!result.allowed) {
  console.log(result.upgradeHint); // "Run `anima subscribe` ($20/mo) to unlock all features."
}
```

---

## Ontology

**File:** `src/anima6/ontology.ts`

**Purpose:** Defines the brain graph node kinds and relation types for Anima 6, extending the graph schema to support organizations, agents, roles, and tasks.

**Key Types:**

```ts
type AnimaNodeKind =
  | "goal"
  | "feature"
  | "person"
  | "chronos"
  | "affect"
  | "agent"
  | "role"
  | "task";

type AnimaRelation =
  | "owns"
  | "supports"
  | "focuses_on"
  | "tracks"
  | "influences"
  | "reports_to"
  | "specializes_in"
  | "delegates"
  | "executes"
  | "escalates_to";
```

**Exported Constants:**

- `ANIMA_NODE_KINDS` -- Array of all valid node kinds
- `ANIMA_RELATIONS` -- Array of all valid relation types
- `ANIMA_CHRONOS_NODE_ID` -- `"chronos:state"` (singleton)
- `ANIMA_AFFECT_NODE_ID` -- `"affect:state"` (singleton)

**Public API:**

| Function               | Signature                                   | Description                     |
| ---------------------- | ------------------------------------------- | ------------------------------- |
| `isAnimaNodeKind`      | `(value: string) => value is AnimaNodeKind` | Type guard for node kinds       |
| `isAnimaRelation`      | `(value: string) => value is AnimaRelation` | Type guard for relations        |
| `missionGoalNodeId`    | `(goalId) => string`                        | Generate `goal:{id}` node ID    |
| `missionFeatureNodeId` | `(featureId) => string`                     | Generate `feature:{id}` node ID |
| `missionPersonNodeId`  | `(personId) => string`                      | Generate `person:{id}` node ID  |
| `orgAgentNodeId`       | `(agentId) => string`                       | Generate `agent:{id}` node ID   |
| `orgRoleNodeId`        | `(roleId) => string`                        | Generate `role:{id}` node ID    |
| `orgTaskNodeId`        | `(taskId) => string`                        | Generate `task:{id}` node ID    |

**Integration:** Consumed by `memory/brain-graph.ts` for node/edge type validation. The new node kinds (`agent`, `role`, `task`) and relations (`reports_to`, `specializes_in`, `delegates`, `executes`, `escalates_to`) support the org module's hierarchy in the brain graph.
