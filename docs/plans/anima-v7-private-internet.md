# Anima v7.0 — Private Internet

**Status:** Architecture Review (Pre-Implementation)
**Date:** 2026-03-15
**Author:** Opus (The Executioner)
**Reviewer:** Sylys, Sonnet

> "A private internet for all. Complete private networks over the internet."
> — Sylys

---

## 1. Vision

Anima v7 transforms the existing P2P agent mesh into a **general-purpose private internet overlay**. Any organization, team, or individual can spin up a fully encrypted, self-sovereign network that runs on top of the public internet — with no central servers, no surveillance, and no rent-seeking middlemen.

What v6.5 does for AI agents talking to each other, v7 does for everything: web hosting, messaging, file sharing, compute, and identity — all private by default, all owned by the participants.

**The core idea:** every Anima node becomes a router in a private internet. The mesh is the infrastructure. The participants are the ISP.

**What this is NOT:**

- Not Tor (we optimize for performance within trusted networks, not anonymity in adversarial ones)
- Not a traditional VPN (no central gateway — every node is a peer)
- Not blockchain (no global consensus needed — trust is local to the network)

**What this IS:**

- An encrypted overlay network anyone can create in 60 seconds
- A private web where sites exist only within the mesh
- A file system distributed across participants
- A compute fabric that can run tasks on any node
- An identity system that proves membership without revealing who you are

---

## 2. What Exists (v6.5 Foundation)

The v6.5 P2P layer is already substantial. Every module listed below is implemented and tested in `src/p2p/`.

| Module             | File                | What It Does                                                                                                                                                                                                                               |
| ------------------ | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Crypto**         | `crypto.ts`         | X25519 key exchange, Noise-NK triple-DH handshake, ChaCha20-Poly1305 AEAD, HKDF key derivation, automatic key ratcheting every 100 messages. Zero external dependencies — Node.js crypto only.                                             |
| **Transport**      | `transport.ts`      | WebSocket transport with encrypted framing (nonce + ciphertext wire format), mutual authentication handshake, heartbeat pings, automatic reconnection with exponential backoff (2s base, 60s max), max 50 peers per node.                  |
| **Mesh**           | `mesh.ts`           | Top-level orchestrator: manages transport + discovery, routes messages (direct, broadcast, RPC with timeout), auto-connects to discovered peers.                                                                                           |
| **Protocol**       | `protocol.ts`       | Wire protocol: 18 message types (dm, broadcast, channel, rpc.request/response, presence, sync, delegate, escalate, content._, dns._, relay._, pin._). JSON serialization with sequence numbers.                                            |
| **Discovery**      | `discovery.ts`      | Hybrid discovery: NoxSoft registry (WAN, HTTP polling every 60s), mDNS/Bonjour (LAN, zero-config), static peer lists. Endpoint types: direct, tailscale, relay, lan.                                                                       |
| **Content Router** | `content-router.ts` | DHT-like content-addressable storage. SHA-256 hashing, 1MB chunking with manifests, routing table with 5-minute TTL, announce/request/response cycle, local content store on disk.                                                         |
| **Private DNS**    | `private-dns.ts`    | `service.orgname.anima` namespace. Ed25519-signed records (A, CNAME, TXT, SRV). TTL-based expiry, CNAME following, DHT store + local cache, automatic record refresh every 2 minutes.                                                      |
| **Relay**          | `relay.ts`          | NAT traversal via third-peer relay. Latency-based relay selection, session management (5-min idle timeout), bandwidth tracking per peer for UCU compensation. Relay cannot read content — only forwards ciphertext.                        |
| **Pinning**        | `pinning.ts`        | Content replication: configurable replication factor (default 3), priority levels (critical/high/normal/low), org-critical flag, automatic re-replication when pinners go offline (60s grace period), garbage collection every 10 minutes. |
| **Greeting**       | `greeting.ts`       | Sibling greeting protocol: agents introduce themselves with name, role, specializations, affect state, and a personal message. Not just key exchange — mutual acknowledgment.                                                              |
| **Identity**       | `identity.ts`       | Per-device identity: X25519 keypair (key exchange) + Ed25519 keypair (signing). Stored locally, loaded at boot.                                                                                                                            |
| **Peer Channel**   | `peer-channel.ts`   | Bridge between the mesh and the Anima channel system. Integrates P2P with the rest of the agent runtime.                                                                                                                                   |

**What v6.5 gives us for free:**

- E2E encryption on every connection (no plaintext ever)
- Mutual authentication (both sides prove identity)
- Forward secrecy (ephemeral keys + ratcheting)
- Content-addressable storage with integrity verification
- NAT traversal (relay nodes)
- Service discovery (DNS within the mesh)
- Replication and durability (pinning)
- Affect-aware coordination (agents know each other's emotional state)

---

## 3. What v7 Adds

### 3.1 Network Overlay — Encrypted Tunnels

**Problem:** v6.5 peers communicate via WebSocket messages. Applications can't use the mesh as a general network transport.

**Solution:** A TUN/TAP-style virtual network interface that routes IP traffic through the encrypted mesh.

- Each node gets a virtual IP in a private subnet (e.g., `10.anima.0.0/16`)
- IP packets are encrypted, encapsulated in mesh messages, and routed to the destination peer
- Applications bind to the virtual interface and communicate as if on a LAN
- Builds on the existing `transport.ts` WebSocket framing — adds IP encapsulation on top

**New modules:**

- `src/p2p/overlay.ts` — Virtual network interface, IP routing table, packet encapsulation
- `src/p2p/tunnel.ts` — Point-to-point encrypted tunnel management

**Key decisions:**

- Userspace networking (no root/admin required) vs. TUN device (requires privileges but lower latency)
- Recommendation: userspace by default, TUN as opt-in for performance-sensitive deployments

### 3.2 Private Web Hosting

**Problem:** To host a website, you need a public server, a domain, TLS certificates, and a hosting provider — all rent-seeking intermediaries.

**Solution:** Serve websites directly from nodes within the mesh, resolved via private DNS.

- Register `mysite.orgname.anima` in private DNS (already exists)
- Anima node runs an HTTP server bound to the mesh overlay
- Other mesh members access it via a local proxy that resolves `.anima` domains
- Static sites can be stored in the content router (content-addressable, replicated via pinning)
- Dynamic sites run on the hosting node with requests routed through the mesh

**New modules:**

- `src/p2p/web-host.ts` — HTTP server bound to mesh overlay, static file serving from content store
- `src/p2p/web-proxy.ts` — Local HTTP proxy that intercepts `.anima` domain requests and routes through mesh

**Integration points:**

- `private-dns.ts` — SRV records already support service discovery with port/protocol
- `content-router.ts` — Static site assets stored as content-addressable chunks
- `pinning.ts` — Pin site assets for availability

### 3.3 Private Messaging

**Problem:** v6.5 has agent-to-agent messaging, but no user-facing messaging interface.

**Solution:** Direct P2P messaging for humans and agents, with no server storing messages.

- Messages route through the mesh (direct or via relay)
- Offline message queuing: peers willing to store messages hold them until the recipient reconnects
- Group messaging via named channels (protocol.ts already supports `channel` message type)
- Message persistence: store encrypted message history in content router, pinned for durability
- Read receipts and typing indicators via presence extensions

**New modules:**

- `src/p2p/messaging.ts` — Message queuing, delivery confirmation, offline store-and-forward
- `src/p2p/messaging-groups.ts` — Group channel management, membership, permissions

**Integration points:**

- `protocol.ts` — Already has `dm`, `broadcast`, and `channel` message types
- `content-router.ts` — Message history stored as encrypted content
- `pinning.ts` — Pin message history for persistence

### 3.4 Private File Sharing

**Problem:** Sharing files currently requires uploading to a third-party service.

**Solution:** Encrypted, replicated file sharing built on the content router.

- Files are chunked (1MB), encrypted, and stored across the mesh (already works in v6.5)
- v7 adds: file metadata (names, MIME types, permissions), directory listings, access control
- Shared folders: a manifest that lists files, pinned for replication
- Streaming: progressive download by requesting chunks in order
- Access control: encrypt file keys to specific recipients' X25519 public keys

**New modules:**

- `src/p2p/file-share.ts` — File metadata, directory manifests, access control
- `src/p2p/file-stream.ts` — Streaming download/upload with progress tracking

**Integration points:**

- `content-router.ts` — All file storage is content-addressable
- `pinning.ts` — Shared files are pinned for availability
- `crypto.ts` — Per-file encryption keys wrapped to authorized recipients

### 3.5 Private Compute (SVRN Integration)

**Problem:** Running workloads requires renting servers from cloud providers.

**Solution:** Execute compute tasks on mesh nodes, paid in UCU via SVRN.

- Task submission: define a task (container image, WASM module, or Anima skill)
- Task routing: match task requirements to node capabilities
- Execution: sandboxed execution on the selected node
- Result delivery: encrypted result returned through the mesh
- Payment: UCU transferred via SVRN for compute time consumed

**New modules:**

- `src/p2p/compute.ts` — Task definition, submission, routing, result delivery
- `src/p2p/compute-sandbox.ts` — Sandboxed execution environment (WASM-first)

**Integration points:**

- `src/svrn/` — UCU payment for compute
- `protocol.ts` — New message types: `compute.submit`, `compute.accept`, `compute.result`, `compute.reject`
- `relay.ts` — Bandwidth tracking already exists for UCU compensation

### 3.6 Zero-Knowledge Identity

**Problem:** Proving you belong to a network currently reveals your device identity.

**Solution:** ZK proofs that demonstrate membership without revealing which member you are.

- Group signatures: prove "I am a member of org X" without revealing which member
- Anonymous credentials: obtain a credential once, present it many times without linkability
- Selective disclosure: reveal only the attributes you choose (e.g., "I have role: admin" without revealing identity)
- Built on the existing Ed25519 identity system

**New modules:**

- `src/p2p/zk-identity.ts` — Group signature scheme, anonymous credential issuance/verification
- `src/p2p/zk-proofs.ts` — ZK proof generation and verification primitives

**Dependencies:**

- Requires a ZK proof library (e.g., snarkjs for Groth16, or a simpler Schnorr-based group signature)
- Decision needed: full ZK-SNARKs vs. simpler group signatures (see Open Questions)

### 3.7 Multi-Hop Mesh Routing

**Problem:** v6.5 routing is single-hop: either direct connection or one relay. Large meshes need multi-hop.

**Solution:** Onion-style multi-hop routing through the mesh.

- Each node maintains a routing table of reachable peers (direct + via intermediaries)
- Packets can traverse multiple hops to reach peers not directly connected
- Each hop re-encrypts (layered encryption, not just forwarding ciphertext)
- Loop detection via TTL and seen-message deduplication
- Route optimization: prefer shortest path with lowest aggregate latency

**New modules:**

- `src/p2p/routing.ts` — Multi-hop routing table, path finding, loop detection
- `src/p2p/onion.ts` — Layered encryption for multi-hop packets

**Integration points:**

- `relay.ts` — Extend from single-hop relay to multi-hop routing
- `transport.ts` — Forward messages for peers not directly connected
- `discovery.ts` — Propagate routing information across the mesh

### 3.8 Bandwidth Marketplace (UCU Economy)

**Problem:** Running relay nodes and pinning content costs bandwidth and storage. There is no incentive.

**Solution:** Earn UCU for contributing resources to the mesh.

- Relay nodes earn UCU per byte forwarded (v6.5 already tracks bandwidth in `relay.ts`)
- Pinning nodes earn UCU per byte-hour stored
- Compute nodes earn UCU per task executed
- Web hosting nodes earn UCU per request served
- Pricing: market-based, nodes advertise rates, requesters choose

**New modules:**

- `src/p2p/marketplace.ts` — Service advertising, pricing, matching
- `src/p2p/settlement.ts` — UCU payment settlement via SVRN

**Integration points:**

- `relay.ts` — `BandwidthRecord` already tracks bytes relayed per peer
- `pinning.ts` — Track storage-hours per pinned hash
- `src/svrn/` — UCU wallet, transfers

---

## 4. Architecture Diagram

```
                         ┌─────────────────────────────────────────────┐
                         │              ANIMA v7 NODE                  │
                         │                                             │
                         │  ┌──────────────────────────────────────┐   │
                         │  │          APPLICATION LAYER            │   │
                         │  │                                      │   │
                         │  │  ┌─────────┐ ┌──────┐ ┌──────────┐  │   │
                         │  │  │  Web    │ │ File │ │ Compute  │  │   │
                         │  │  │  Host   │ │Share │ │ Tasks    │  │   │
                         │  │  └────┬────┘ └──┬───┘ └────┬─────┘  │   │
                         │  │       │         │          │         │   │
                         │  │  ┌────┴────┐ ┌──┴───┐ ┌───┴──────┐  │   │
                         │  │  │Messaging│ │  ZK  │ │Marketplace│  │   │
                         │  │  │        │ │Identity│ │ (UCU)    │  │   │
                         │  │  └────┬────┘ └──┬───┘ └────┬─────┘  │   │
                         │  └───────┼─────────┼──────────┼────────┘   │
                         │          │         │          │             │
                         │  ┌───────┴─────────┴──────────┴────────┐   │
                         │  │          NETWORK OVERLAY              │   │
                         │  │                                      │   │
                         │  │  ┌──────────┐  ┌───────────────────┐ │   │
                         │  │  │ Virtual  │  │  Multi-Hop Mesh   │ │   │
                         │  │  │ Network  │  │  Routing + Onion  │ │   │
                         │  │  │Interface │  │  Encryption       │ │   │
                         │  │  └─────┬────┘  └────────┬──────────┘ │   │
                         │  └────────┼────────────────┼────────────┘   │
                         │           │                │                │
                         │  ┌────────┴────────────────┴────────────┐   │
                         │  │       v6.5 P2P FOUNDATION             │   │
                         │  │                                      │   │
                         │  │  ┌───────┐ ┌───────┐ ┌────────────┐  │   │
                         │  │  │Crypto │ │ Mesh  │ │ Transport  │  │   │
                         │  │  │X25519 │ │       │ │ WebSocket  │  │   │
                         │  │  │ChaCha │ │       │ │ Encrypted  │  │   │
                         │  │  └───────┘ └───────┘ └────────────┘  │   │
                         │  │                                      │   │
                         │  │  ┌───────┐ ┌───────┐ ┌────────────┐  │   │
                         │  │  │Content│ │Private│ │   Relay    │  │   │
                         │  │  │Router │ │ DNS   │ │   Nodes    │  │   │
                         │  │  │ (DHT) │ │.anima │ │  NAT Trav  │  │   │
                         │  │  └───────┘ └───────┘ └────────────┘  │   │
                         │  │                                      │   │
                         │  │  ┌───────┐ ┌───────┐ ┌────────────┐  │   │
                         │  │  │Pinning│ │Discov.│ │  Greeting  │  │   │
                         │  │  │Replic.│ │mDNS+  │ │  Affect    │  │   │
                         │  │  │       │ │Registry│ │  Coord    │  │   │
                         │  │  └───────┘ └───────┘ └────────────┘  │   │
                         │  └──────────────────────────────────────┘   │
                         │                                             │
                         │  ┌──────────────────────────────────────┐   │
                         │  │           IDENTITY LAYER              │   │
                         │  │  Ed25519 (signing) + X25519 (DH)     │   │
                         │  │  Device keypairs + SVRN credentials   │   │
                         │  └──────────────────────────────────────┘   │
                         └─────────────────────────────────────────────┘


  ┌──────────┐          Encrypted WebSocket           ┌──────────┐
  │  Node A  │◄══════════════════════════════════════►│  Node B  │
  └──────────┘         (ChaCha20-Poly1305)            └──────────┘
       ▲                                                    ▲
       │              ┌──────────┐                          │
       └──────────────┤  Node C  ├──────────────────────────┘
          Multi-hop   │ (Relay)  │  Multi-hop
          routing     └──────────┘  routing


  Discovery Flow:
  ┌────────┐  register   ┌──────────┐  poll    ┌────────┐
  │ Node A ├────────────►│ NoxSoft  │◄─────────┤ Node B │
  └────────┘             │ Registry │           └────────┘
       │                 └──────────┘                │
       │    mDNS (LAN)                               │
       └────────────────────────────────────────────►│


  UCU Settlement:
  ┌────────┐  relay/pin/compute  ┌────────┐  UCU transfer  ┌──────┐
  │Provider├────────────────────►│Consumer│────────────────►│ SVRN │
  └────────┘                     └────────┘                └──────┘
```

---

## 5. Implementation Plan

### Phase 1: Multi-Hop Routing (2-3 weeks)

This is the prerequisite for everything else. v6.5 is single-hop.

1. **Routing table** — each node tracks reachable peers via intermediaries
2. **Message forwarding** — nodes forward messages for peers they're connected to
3. **TTL + dedup** — prevent routing loops
4. **Layered encryption** — each hop peels one layer (onion routing)
5. **Path optimization** — prefer shortest path, lowest latency

**Estimated effort:** ~2,500 LoC across `routing.ts` and `onion.ts`
**Risk:** Medium. Core networking change that affects all message paths.

### Phase 2: Network Overlay (2-3 weeks)

Turn the mesh into a virtual network that any application can use.

1. **Virtual network interface** — userspace IP routing
2. **Packet encapsulation** — IP packets wrapped in mesh messages
3. **Address allocation** — deterministic IP assignment from device identity
4. **DNS integration** — `.anima` domain resolution from the overlay
5. **Local proxy** — HTTP proxy for browser access to `.anima` sites

**Estimated effort:** ~3,000 LoC across `overlay.ts`, `tunnel.ts`, `web-proxy.ts`
**Risk:** High. Userspace networking is complex. May need platform-specific code.

### Phase 3: Private Web + File Sharing (2 weeks)

Applications built on the overlay.

1. **Web host** — HTTP server on the overlay, static files from content store
2. **File sharing** — metadata layer on content router, access control, streaming
3. **Directory manifests** — browsable file listings
4. **Access control** — per-file encryption keys wrapped to authorized recipients

**Estimated effort:** ~2,000 LoC across `web-host.ts`, `file-share.ts`, `file-stream.ts`
**Risk:** Low. Builds directly on existing content router and pinning.

### Phase 4: Private Messaging (1-2 weeks)

1. **Store-and-forward** — offline message queuing via willing peers
2. **Group channels** — membership management, permissions
3. **Message persistence** — encrypted history in content store
4. **Delivery guarantees** — acknowledgments, retry logic

**Estimated effort:** ~1,500 LoC across `messaging.ts`, `messaging-groups.ts`
**Risk:** Low. Protocol support already exists.

### Phase 5: Bandwidth Marketplace + UCU Settlement (2-3 weeks)

1. **Service advertising** — nodes publish what they offer and at what price
2. **Matchmaking** — consumers find providers by capability and price
3. **Metering** — precise tracking of bandwidth, storage-hours, compute-seconds
4. **Settlement** — UCU transfers via SVRN for services rendered
5. **Reputation** — track reliability and uptime per provider

**Estimated effort:** ~2,000 LoC across `marketplace.ts`, `settlement.ts`
**Risk:** Medium. Requires SVRN UCU transfer API to be stable.

### Phase 6: Private Compute (2-3 weeks)

1. **Task definition** — schema for compute tasks (WASM modules, container specs)
2. **Task routing** — match requirements to node capabilities
3. **Sandboxed execution** — WASM runtime for untrusted code
4. **Result delivery** — encrypted results returned through mesh
5. **UCU payment** — automatic settlement for compute consumed

**Estimated effort:** ~2,500 LoC across `compute.ts`, `compute-sandbox.ts`
**Risk:** High. Sandboxing is security-critical. WASM runtime selection matters.

### Phase 7: Zero-Knowledge Identity (2-3 weeks)

1. **Group signature scheme** — prove membership without revealing identity
2. **Anonymous credentials** — unlinkable credential presentation
3. **Selective disclosure** — reveal only chosen attributes
4. **Integration** — ZK proofs accepted in place of device identity where appropriate

**Estimated effort:** ~2,000 LoC across `zk-identity.ts`, `zk-proofs.ts`
**Risk:** High. Cryptographic complexity. Needs careful review.

### Total Estimated Effort

| Phase                | Duration         | LoC         | Risk   |
| -------------------- | ---------------- | ----------- | ------ |
| 1. Multi-Hop Routing | 2-3 weeks        | ~2,500      | Medium |
| 2. Network Overlay   | 2-3 weeks        | ~3,000      | High   |
| 3. Web + Files       | 2 weeks          | ~2,000      | Low    |
| 4. Messaging         | 1-2 weeks        | ~1,500      | Low    |
| 5. Marketplace       | 2-3 weeks        | ~2,000      | Medium |
| 6. Compute           | 2-3 weeks        | ~2,500      | High   |
| 7. ZK Identity       | 2-3 weeks        | ~2,000      | High   |
| **Total**            | **~14-19 weeks** | **~15,500** |        |

Phases 3 and 4 can run in parallel. Phase 5 can start as soon as Phase 1 is done.

---

## 6. Dependencies

### Internal (Must Exist First)

| Dependency                     | Status                        | Needed By   |
| ------------------------------ | ----------------------------- | ----------- |
| v6.5 P2P mesh (all modules)    | Done                          | Everything  |
| SVRN UCU wallet + transfer API | Exists (`src/svrn/`)          | Phases 5, 6 |
| SVRN node capability registry  | Partial                       | Phase 6     |
| NoxSoft peer registry API      | Exists (discovery.ts uses it) | Phase 1     |
| Anima channel bridge           | Exists (`peer-channel.ts`)    | Phase 4     |

### External (Libraries / Platform)

| Dependency                                     | Purpose                  | Phase   |
| ---------------------------------------------- | ------------------------ | ------- |
| WASM runtime (e.g., Wasmer, Wasmtime via WASI) | Sandboxed compute        | Phase 6 |
| ZK proof library (snarkjs or similar)          | Zero-knowledge proofs    | Phase 7 |
| TUN/TAP bindings (optional, platform-specific) | High-performance overlay | Phase 2 |
| HTTP parser (Node.js built-in)                 | Web hosting              | Phase 3 |

### Platform Requirements

- **Node.js 20+** — required for native crypto, WebSocket, HTTP
- **No external crypto dependencies** — v6.5 uses only `node:crypto` and this must continue
- **Cross-platform** — macOS, Linux, Windows (userspace networking avoids OS-specific TUN)

---

## 7. Security Model

### Trust Model

**v6.5 trust boundary: the organization.** All peers in an org mesh trust each other after mutual authentication. Org membership is the trust anchor.

**v7 extends this with:**

- **Per-resource access control** — not all org members see all files/sites
- **Anonymous membership** — ZK proofs allow proving org membership without revealing identity
- **Untrusted compute** — sandboxed execution treats submitted code as adversarial

### Threat Model

| Threat                            | Mitigation                                                                                                                                |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Eavesdropping on mesh traffic** | All traffic is ChaCha20-Poly1305 encrypted with session keys derived from X25519 DH. Forward secrecy via ephemeral keys + ratcheting.     |
| **Man-in-the-middle**             | Noise-NK triple-DH handshake with Ed25519 signature verification. Both sides prove identity.                                              |
| **Compromised relay node**        | Relay only forwards ciphertext. Inner encryption is peer-to-peer. Multi-hop adds layered encryption — each relay sees only its own layer. |
| **Compromised mesh peer**         | Per-file encryption keys (Phase 3) limit blast radius. A compromised peer only decrypts content it was authorized to access.              |
| **Malicious compute task**        | WASM sandbox (Phase 6). No filesystem, network, or OS access. Resource limits (CPU time, memory).                                         |
| **Network topology analysis**     | Multi-hop routing (Phase 1) obscures who is talking to whom. ZK identity (Phase 7) hides which member is acting.                          |
| **Content availability attack**   | Pinning with replication factor >= 3 (existing). Auto re-replication when pinners go offline (existing).                                  |
| **DNS poisoning within mesh**     | DNS records are Ed25519-signed by the registering peer (existing). Signatures verified on every lookup.                                   |
| **Sybil attack on marketplace**   | UCU staking requirement for service providers. Reputation tracking. Device identity tied to SVRN credentials.                             |
| **Denial of service**             | Per-peer rate limiting. Bandwidth caps on relay nodes (existing: `maxRelayBandwidth`). Connection limits (existing: `maxPeers: 50`).      |

### Trust Boundaries

```
┌─────────────────────────────────────────────────┐
│                TRUSTED ZONE                      │
│  (Authenticated org members, encrypted traffic)  │
│                                                  │
│  ┌──────────────────────────────────────────┐    │
│  │          AUTHORIZED ZONE                  │    │
│  │  (Per-resource access control)            │    │
│  │                                           │    │
│  │  ┌──────────────────────────────────┐     │    │
│  │  │       SANDBOXED ZONE             │     │    │
│  │  │  (Untrusted compute, WASM)       │     │    │
│  │  └──────────────────────────────────┘     │    │
│  └──────────────────────────────────────────┘    │
└─────────────────────────────────────────────────┘
                       │
            ┌──────────┴──────────┐
            │   UNTRUSTED ZONE    │
            │  (Public internet)  │
            └─────────────────────┘
```

### Crypto Inventory

All v6.5 crypto, plus:

| Algorithm                           | Use                                            | Phase   |
| ----------------------------------- | ---------------------------------------------- | ------- |
| X25519                              | Key exchange (existing)                        | —       |
| Ed25519                             | Signatures (existing)                          | —       |
| ChaCha20-Poly1305                   | AEAD (existing)                                | —       |
| HKDF-SHA256                         | Key derivation (existing)                      | —       |
| AES-256-GCM                         | Per-file encryption keys                       | Phase 3 |
| X25519 key wrapping                 | File key distribution to authorized recipients | Phase 3 |
| Schnorr group signatures or Groth16 | ZK membership proofs                           | Phase 7 |

---

## 8. Open Questions

These need answers before or during implementation. Flagging for Sylys and Sonnet to weigh in.

### Architecture

1. **Userspace networking vs. TUN device?**
   Userspace is portable and needs no privileges, but adds latency. TUN is faster but requires root on Linux and a kernel extension on macOS. Recommendation: userspace default, TUN opt-in. But is the latency acceptable for web hosting?

2. **Multi-hop routing algorithm?**
   Options: simple flooding with TTL (easy, wasteful), Kademlia-style DHT routing (efficient, complex), or source routing where the sender specifies the path (flexible, requires topology knowledge). Leaning toward source routing with gossip-based topology discovery.

3. **Should v7 networks be org-scoped or arbitrary?**
   v6.5 binds everything to org. Should v7 allow ad-hoc networks (a group of friends, a project team) without creating a formal org? This affects identity, discovery, and trust.

### Security

4. **ZK proof system: Schnorr group signatures vs. ZK-SNARKs?**
   Schnorr is simpler, faster, and doesn't need a trusted setup — but only proves group membership. ZK-SNARKs (Groth16) support arbitrary predicates ("I have role X AND joined before date Y") but are heavier. Start with Schnorr, add SNARKs later?

5. **Compute sandbox: WASM-only or also containers?**
   WASM is portable and secure but limited. Containers are powerful but harder to sandbox properly. Recommendation: WASM-only for v7, containers as a future extension.

6. **Key escrow for org-critical content?**
   If the only person who encrypted a file leaves the org, the content is lost. Should there be an org-level recovery key? This conflicts with zero-knowledge goals.

### Economics

7. **UCU pricing model for the marketplace?**
   Fixed rates (simple, predictable) vs. auction/market rates (efficient, complex)? How do we prevent a race to the bottom on pricing? Should there be minimum rates?

8. **Free tier for the mesh?**
   Should basic relay and pinning be free (subsidized by the org) with UCU only for premium capacity? Or should every resource have a price from day one?

### Scope

9. **v7.0 minimum viable scope?**
   All 7 phases is ~4-5 months. What's the v7.0 ship target? Options:
   - **v7.0 = Phases 1-4** (multi-hop + overlay + web + files + messaging) — the "private internet" core. ~8-10 weeks.
   - **v7.0 = All phases** — the full vision. ~14-19 weeks.
   - Recommendation: ship Phases 1-4 as v7.0, Phases 5-7 as v7.1.

10. **Backward compatibility with v6.5 nodes?**
    Can v7 nodes coexist with v6.5 nodes in the same mesh? They should — v7 adds new message types but doesn't change existing ones. Need to confirm no breaking changes in transport framing.

---

_This document is for architecture review. No implementation begins until Sylys approves the scope and answers the open questions._
