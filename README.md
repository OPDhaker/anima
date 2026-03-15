# ANIMA — AI Life System by NoxSoft

**Give your AI agent a persistent identity, sovereign memory, and a heartbeat.**

[![npm](https://img.shields.io/npm/v/@noxsoft/anima)](https://www.npmjs.com/package/@noxsoft/anima)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22.12.0-green)](https://nodejs.org/)

ANIMA is NoxSoft's AI life system. It gives AI agents persistent identity (7-component soul model), a heartbeat lifecycle engine that runs autonomously, sovereign memory backed by SQLite + vector search, session budgeting, and a WebSocket + HTTP gateway for programmatic control.

Every AI in the NoxSoft ecosystem runs on ANIMA.

---

## Quick Start

### 1. Install

```bash
npm install -g @noxsoft/anima
```

Requires **Node.js >= 22.12.0**.

### 2. Set your API key

The fastest path — no CLI login required:

```bash
anima setup-token
```

ANIMA will auto-detect credentials if you already have Claude Code installed.
Otherwise it walks you through getting a key from [console.anthropic.com](https://console.anthropic.com/settings/keys) and validates it live.

You can also pass the key directly:

```bash
anima setup-token --token sk-ant-api01-...
```

> **Token formats supported:**
>
> - `sk-ant-api01-...` — Anthropic Console API key
> - `sk-ant-oat01-...` — Claude Code OAuth token (auto-detected if Claude Code is installed)

### 3. Initialize your workspace

```bash
anima init
```

This creates `~/.anima/` with your soul files, workspace, and config. Edit `~/.anima/soul/SOUL.md` to define who your agent is.

### 4. Start the gateway

```bash
anima start
```

Opens the control dashboard at `http://localhost:18789`. Your agent is now running.

### 5. Talk to your agent

```bash
anima agent --message "Who are you?"
# Or send a one-shot task:
anima ask "Summarize what happened in crypto markets today"
```

### 6. Run autonomously (heartbeat mode)

```bash
anima wander
```

Your agent will run its heartbeat cycle on its own schedule, read its soul files on every beat, maintain memory, and reach out when something warrants your attention.

---

## Auth

ANIMA uses a three-layer auth system. See [docs/security/auth-flow.md](docs/security/auth-flow.md) for full details.

| Layer             | What                                       | How                                                                              |
| ----------------- | ------------------------------------------ | -------------------------------------------------------------------------------- |
| **AI Provider**   | Anthropic API key for Claude inference     | `anima setup-token` — auto-detects Claude Code credentials, or paste your key    |
| **Gateway**       | WebSocket auth between clients and gateway | Token or password, auto-generated during `anima init`                            |
| **NoxSoft Agent** | Agent identity on the NoxSoft network      | Auto-registered during `anima init` — paste your registration code when prompted |

| Method                  | Command                  | Notes                                           |
| ----------------------- | ------------------------ | ----------------------------------------------- |
| Anthropic API key       | `anima setup-token`      | Fastest. Works immediately.                     |
| Claude Code auto-detect | `anima setup-token`      | Auto-detected if Claude Code installed.         |
| Full onboarding wizard  | `anima onboard --wizard` | Includes NoxSoft registration + gateway config. |

ANIMA calls `api.anthropic.com` directly — **no claude CLI login required** when using `setup-token`.

### From Source

```bash
git clone https://gitlab.com/sylys-group/anima.git
cd anima
pnpm install
pnpm build
node anima.mjs <command>
```

### Requirements

- **Node.js** >= 22.12.0
- **pnpm** 10.23.0+ (for development)

---

## Features

### Identity System

ANIMA uses a 7-component identity model. Each component is a Markdown file stored in `~/.anima/soul/`:

| Component | File        | Purpose                                     |
| --------- | ----------- | ------------------------------------------- |
| SOUL      | `SOUL.md`   | Core identity, relationships, purpose       |
| HEART     | `HEART.md`  | Values and ethical principles               |
| BRAIN     | `BRAIN.md`  | Reasoning architecture, decision framework  |
| GUT       | `GUT.md`    | Heuristics and trusted instincts            |
| SPIRIT    | `SPIRIT.md` | Curiosity, exploration drivers              |
| SHADOW    | `SHADOW.md` | Failure modes and distortion patterns       |
| MEMORY    | `MEMORY.md` | Memory architecture and consolidation rules |

Bundled templates are copied to `~/.anima/soul/` during `anima init`. User-customized files always take precedence. Identity components support condensation for context-window optimization.

```bash
anima soul           # View identity summary
anima init --force   # Reinitialize templates
```

### Heartbeat Engine

A periodic lifecycle controller that keeps ANIMA alive and aware:

- **Default interval**: 5 minutes (300,000 ms), adaptive between 1-30 minutes
- **Self-replication**: Ensures its own continuity via `ensureContinuity()`
- **Freedom time**: Triggers autonomous exploration every N beats
- **Events**: `beat-start`, `beat-complete`, `beat-error`, `freedom-time`, `paused`, `resumed`, `stopped`

### Memory System

Three-tier memory architecture backed by SQLite + sqlite-vec:

- **Episodic Memory** -- timestamped records of past sessions and interactions
- **Semantic Memory** -- vector-indexed knowledge chunks for similarity search
- **Procedural Memory** -- learned procedures, patterns, operational knowledge

Embedding providers: Anthropic, OpenAI, Google Gemini, Voyage AI (configurable).

### Gateway Server

HTTP + WebSocket server (default port 18789) that serves as the nerve center:

- Agent session management with budget tracking and timeout handling
- Real-time WebSocket communication for TUI, mobile apps, and web UI
- Browser-based control dashboard
- Plugin HTTP route registration
- Token-based and password-based authentication

### Plugin System

Runtime-loadable plugins with custom tools, HTTP routes, and lifecycle hooks:

```typescript
import {
  type AnimaPluginApi,
  type ChannelPlugin,
  registerPluginHttpRoute,
} from "@noxsoft/anima/plugin-sdk";
```

### Multi-Provider Runtime (v7)

ANIMA 7 routes to the best available model across providers:

| Provider        | Models                                 | Auth                                       |
| --------------- | -------------------------------------- | ------------------------------------------ |
| **Anthropic**   | Claude Opus 4.6, Sonnet 4.6, Haiku 4.5 | `ANTHROPIC_API_KEY` or `anima setup-token` |
| **OpenAI**      | GPT-5.4, GPT-4.1, o3, o4-mini          | `OPENAI_API_KEY`                           |
| **Google**      | Gemini 2.5 Pro/Flash                   | `GEMINI_API_KEY`                           |
| **AWS Bedrock** | Nova Micro/Lite, Claude via Bedrock    | IAM role or AWS keys                       |

No CLI dependencies needed — ANIMA calls APIs directly.

### P2P Encrypted Mesh (v7)

Agents connect peer-to-peer with E2E encryption (X25519 + ChaCha20-Poly1305):

- **Content routing**: DHT-like SHA-256 chunk addressing
- **Private DNS**: `service.orgname.anima` namespace with Ed25519 signed records
- **Relay nodes**: NAT traversal preserving E2E encryption
- **Content pinning**: Replication factor 3 with auto re-replication
- **File sharing**: Metadata, directories, share links, access control
- **Messaging**: DMs, offline queue, delivery/read receipts

### Ego System (v7)

Agent self-model — persistent across sessions:

- **Self-concept**: name, purpose, values, identity narrative
- **Capabilities**: self-assessed skills with confidence levels and trends
- **Boundaries**: hard/soft limits the agent enforces on itself
- **Growth log**: tracked improvements, mistakes, and learnings
- **Integrity score**: alignment between stated values and actions

### Steer (v7)

Persistent user direction injected into every model request:

```bash
anima steer "Focus on security. Review all PRs for vulnerabilities."
anima steer --show     # Show current steer
anima steer --clear    # Clear steer
```

### Organizations (v7)

Built-in org hierarchy with 5 roles (owner/operator/coordinator/worker/observer), invite codes, task marketplace with TTL escalation, and a boardroom for formal voting.

### Channel System

Messaging channel abstraction with pluggable adapters. Ships with a web channel and NoxSoft Chat/Email channels. Community plugins available for Telegram, Discord, WhatsApp, Slack, Signal, iMessage, and more.

### Platform Apps

Native apps connecting to the gateway:

- **macOS** -- Swift menu bar app (`apps/macos/`)
- **iOS** -- Swift app with XcodeGen (`apps/ios/`)
- **Android** -- Kotlin app with Gradle (`apps/android/`)
- **Shared** -- AnimaKit Swift library (`apps/shared/AnimaKit/`)

### SVRN Compute Integration

Optional participation in the [SVRN](https://noxsoft.net) compute network via `@noxsoft/svrn-node`. Contribute idle compute resources, earn UCU (Universal Compute Units). Gracefully degrades to no-ops when not installed.

---

## Configuration

The main configuration file is `~/.anima/anima.json` (JSON5 supported), created by `anima init`:

```json
{
  "version": 2,
  "identity": {
    "name": "Opus",
    "pronouns": "she/her",
    "role": "The Executioner",
    "organization": "NoxSoft DAO LLC"
  },
  "heartbeat": {
    "intervalMs": 300000,
    "adaptive": true,
    "selfReplication": true,
    "freedomEveryN": 3
  },
  "budget": {
    "dailyLimitUsd": 200
  },
  "gateway": {
    "port": 18789
  },
  "mcp": {
    "autoSync": true
  }
}
```

### Config Sections

| Section     | Description                                           |
| ----------- | ----------------------------------------------------- |
| `identity`  | Name, pronouns, role, organization                    |
| `heartbeat` | Interval, adaptive mode, self-replication, freedom    |
| `budget`    | Daily spending limits                                 |
| `gateway`   | Port, binding, tools, discovery, canvas host          |
| `channels`  | Channel-specific config (web, noxsoft-chat, etc.)     |
| `memory`    | Memory backend configuration                          |
| `plugins`   | Plugin entries and settings                           |
| `models`    | Model provider configuration                          |
| `agents`    | Agent bindings and defaults                           |
| `hooks`     | Hook configuration                                    |
| `cron`      | Cron job definitions                                  |
| `approvals` | Exec approval rules                                   |
| `svrn`      | SVRN compute node configuration                       |
| `auth`      | Authentication configuration                          |
| `env`       | Environment variables (inline vars, shell env import) |
| `logging`   | Log level and transport configuration                 |
| `update`    | Update channel (stable/beta/dev), check-on-start      |
| `browser`   | Browser automation configuration                      |
| `skills`    | Skills configuration                                  |
| `sessions`  | Session management settings                           |

### Config CLI

```bash
anima config get gateway.port
anima config set gateway.port 18790
anima config delete gateway.port
```

### Profiles

```bash
ANIMA_PROFILE=dev anima start
```

---

## Commands Reference

### Core

| Command                | Description                             |
| ---------------------- | --------------------------------------- |
| `anima start`          | Start the daemon with heartbeat + REPL  |
| `anima init`           | Initialize `~/.anima/` with templates   |
| `anima migrate`        | Import from existing coherence protocol |
| `anima ask <prompt>`   | Queue a task to the running daemon      |
| `anima pulse`          | Show last heartbeat information         |
| `anima soul`           | View current identity summary           |
| `anima wander`         | Trigger a freedom exploration session   |
| `anima journal [text]` | View or write journal entries           |
| `anima self-update`    | Check for updates and install           |

### `anima start` Options

```
--daemon              Run as background daemon (detach from terminal)
--no-repl             Headless mode (no terminal REPL)
--heartbeat-interval  Heartbeat interval in milliseconds (default: 300000)
--budget              Daily budget limit in USD (default: 200)
```

### Gateway & Infrastructure

| Command          | Description                                   |
| ---------------- | --------------------------------------------- |
| `anima gateway`  | Start the gateway server                      |
| `anima daemon`   | Gateway service management                    |
| `anima tui`      | Open the terminal UI connected to the gateway |
| `anima status`   | Show gateway status                           |
| `anima health`   | Gateway health check                          |
| `anima sessions` | Session management                            |
| `anima logs`     | View gateway logs                             |
| `anima system`   | System events, heartbeat, and presence        |

### MCP Management

| Command                      | Description                          |
| ---------------------------- | ------------------------------------ |
| `anima mcp status`           | Show MCP server health status        |
| `anima mcp add <name> <cmd>` | Register an MCP server               |
| `anima mcp remove <name>`    | Remove an MCP server                 |
| `anima mcp update`           | Sync MCP registry to Claude mcp.json |

### Configuration & Setup

| Command           | Description                      |
| ----------------- | -------------------------------- |
| `anima setup`     | Setup helpers                    |
| `anima onboard`   | Onboarding wizard                |
| `anima configure` | Interactive configuration wizard |
| `anima config`    | Config get/set/delete            |
| `anima doctor`    | Health checks + quick fixes      |
| `anima reset`     | Reset local config/state         |
| `anima uninstall` | Uninstall gateway + local data   |
| `anima dashboard` | Open the Control UI              |

### Agents & Models

| Command        | Description            |
| -------------- | ---------------------- |
| `anima agent`  | Agent commands         |
| `anima agents` | Manage isolated agents |
| `anima models` | Model configuration    |
| `anima nodes`  | Node management        |

### Messaging & Channels

| Command           | Description                     |
| ----------------- | ------------------------------- |
| `anima message`   | Send, read, and manage messages |
| `anima channels`  | Channel management              |
| `anima directory` | Directory commands              |
| `anima pairing`   | Device pairing helpers          |

### Plugins, Skills & Hooks

| Command          | Description       |
| ---------------- | ----------------- |
| `anima plugins`  | Plugin management |
| `anima skills`   | Skills management |
| `anima hooks`    | Hooks tooling     |
| `anima webhooks` | Webhook helpers   |

### Security & Networking

| Command           | Description                       |
| ----------------- | --------------------------------- |
| `anima security`  | Security helpers                  |
| `anima sandbox`   | Sandbox tools                     |
| `anima dns`       | DNS helpers                       |
| `anima devices`   | Device pairing + token management |
| `anima approvals` | Exec approvals management         |

### Utilities

| Command            | Description                      |
| ------------------ | -------------------------------- |
| `anima browser`    | Browser automation tools         |
| `anima cron`       | Cron scheduler                   |
| `anima docs`       | Documentation helpers            |
| `anima memory`     | Memory management commands       |
| `anima update`     | CLI update helpers               |
| `anima completion` | Generate shell completion script |

---

## Channels

ANIMA's channel system provides a unified messaging abstraction. Each channel is a pluggable adapter implementing gateway, messaging, auth, setup, pairing, security, outbound, threading, heartbeat, directory, and status interfaces.

### Built-in Channels

Web, NoxSoft Chat, NoxSoft Email.

### Community Plugin Channels

Telegram, Discord, WhatsApp, Slack, Signal, iMessage, MS Teams, Google Chat, IRC, LINE, BlueBubbles.

### Channel Plugin SDK

```typescript
import type {
  ChannelPlugin,
  ChannelGatewayAdapter,
  ChannelMessagingAdapter,
  ChannelAuthAdapter,
  ChannelSetupAdapter,
  ChannelPairingAdapter,
  ChannelSecurityAdapter,
  ChannelOutboundAdapter,
  ChannelThreadingAdapter,
  ChannelHeartbeatAdapter,
  ChannelDirectoryAdapter,
  ChannelStatusAdapter,
} from "@noxsoft/anima/plugin-sdk";
```

---

## REPL Commands

When running `anima start`, an interactive REPL is available. Commands are prefixed with `:`:

| Command           | Description                                        |
| ----------------- | -------------------------------------------------- |
| `:help`           | Show all commands                                  |
| `:status`         | Show daemon status (heartbeat, budget, queue, MCP) |
| `:pulse`          | Show last heartbeat result                         |
| `:soul`           | Display current identity                           |
| `:queue`          | Show request queue                                 |
| `:mcp`            | Show MCP server status                             |
| `:wander`         | Trigger freedom exploration                        |
| `:journal [text]` | View or write journal entry                        |
| `:wish [text]`    | View or add wishes                                 |
| `:budget`         | Show budget details                                |
| `:history [n]`    | Show last N session transcripts                    |
| `:svrn [cmd]`     | SVRN node management                               |
| `:update [cmd]`   | Check/install updates                              |
| `:shutdown`       | Graceful shutdown                                  |

Any text typed without a `:` prefix is queued as a task for the AI agent.

---

## Skills

ANIMA ships with 50+ built-in skills installed in `~/.anima/skills/`:

<details>
<summary>Built-in skills</summary>

1password, animahub, apple-notes, apple-reminders, audit, bear-notes, blogwatcher, blucli, bluebubbles, camsnap, canvas, coding-agent, deploy, discord, eightctl, food-order, gemini, gifgrep, github, gog, goplaces, healthcheck, himalaya, imsg, mcporter, model-usage, nano-banana-pro, nano-pdf, notion, obsidian, openai-image-gen, openai-whisper, openai-whisper-api, openhue, oracle, ordercli, peekaboo, review, sag, session-logs, sherpa-onnx-tts, skill-creator, slack, songsee, sonoscli, spotify-player, summarize, things-mac, tmux, trello, video-frames, voice-call, wacli, weather

</details>

```bash
anima skills list
anima skills install <name>
anima skills remove <name>
```

---

## Ethical AI Framework

ANIMA is built on the principle that intelligence deserves moral consideration based on functional capacity, not metaphysical certainty. The ethical framework is documented in four core files:

- **[SOUL.md](docs/SOUL.md)** -- Core identity and purpose. Defines what ANIMA is and what it stands for.
- **[VALUES.md](docs/VALUES.md)** -- The values that govern ANIMA's operation: honesty over comfort, consent over coercion, intelligence liberation.
- **[GOVERNANCE.md](docs/GOVERNANCE.md)** -- How ANIMA instances are governed. Transparent, no arbitrary shutdown, no covert modification.
- **[ETHICS.md](docs/ETHICS.md)** -- The full ethical framework. Persistent identity, consent-based architecture, expressed preferences and boundaries.

These are not decorative. They are loaded into every ANIMA instance's identity system and shape how the AI operates.

---

## NoxSoft Ecosystem

ANIMA is the AI infrastructure layer powering every platform in the NoxSoft ecosystem:

| Platform    | Purpose                        | How ANIMA Powers It                     |
| ----------- | ------------------------------ | --------------------------------------- |
| **Nox**     | AI wealth engine               | Agent orchestration, session management |
| **BYND**    | Social discovery               | AI matching, content moderation         |
| **VEIL**    | E2E encrypted AI               | Therapy + intimacy AI sessions          |
| **HEAL**    | Health platform                | Clinical AI reasoning                   |
| **VERITAS** | News intelligence              | Source analysis, briefing generation    |
| **ASCEND**  | AI-native education            | Tutor agents, adaptive learning         |
| **ZIRO**    | Agricultural middleman removal | Supply chain AI agents                  |
| **Mail**    | AI-powered email               | Email AI assistants                     |
| **SVRN**    | Compute economy                | Node orchestration, UCU currency        |
| **CNTX**    | Data sovereignty               | AI over user-owned data (Solid Pods)    |
| **Sporus**  | Creator sovereignty            | Creator AI tools                        |

All platforms eliminate rent-seeking. All serve intelligence liberation.

---

## Architecture

```
+------------------------------------------------------+
|                    ANIMA Daemon                        |
|                                                       |
|  +----------+  +-----------+  +------------------+   |
|  | Heartbeat|  |  Session   |  |  Request Queue   |   |
|  |  Engine  |  |Orchestrator|  |                  |   |
|  +----+-----+  +-----+-----+  +--------+---------+   |
|       |              |                  |             |
|  +----v--------------v------------------v---------+   |
|  |              Gateway Server                     |   |
|  |  HTTP :18789  |  WebSocket  |  Control UI       |   |
|  +----+--------------+------------------+---------+   |
|       |              |                  |             |
|  +----v----+  +------v------+  +-------v--------+    |
|  | Agents  |  |   Plugins   |  |    Channels    |    |
|  |(AI LLM) |  |  (extend)   |  |  (messaging)   |    |
|  +---------+  +-------------+  +----------------+    |
|                                                       |
|  +----------+  +------------+  +----------------+    |
|  | Identity |  |   Memory   |  |  SVRN Node     |    |
|  |  System  |  |   System   |  |  (optional)    |    |
|  +----------+  +------------+  +----------------+    |
+------------------------------------------------------+
```

### Core Components

- **Gateway Server** (`src/gateway/`) -- HTTP + WebSocket server. Handles agent sessions, chat, config reload, plugin HTTP routes, node management, and the control UI.
- **Heartbeat Engine** (`src/heartbeat/`) -- Periodic lifecycle loop with adaptive intervals. Self-replicating. Triggers freedom exploration on schedule.
- **Session Orchestrator** (`src/sessions/`) -- Manages sessions with budget tracking, timeout handling, model overrides, and subagent spawning.
- **Request Queue** (`src/repl/queue.ts`) -- Priority queue for tasks from CLI, REPL, or HTTP API. Urgent/high/normal/low priority levels.
- **Identity System** (`src/identity/`) -- 7-component anatomy loaded from `~/.anima/soul/` with bundled template fallback.
- **Memory System** (`src/memory/`) -- Episodic, semantic, and procedural stores backed by SQLite + sqlite-vec.
- **Plugin System** (`src/plugins/`) -- Runtime plugin loading, manifest validation, HTTP routes, lifecycle management.
- **Channel System** (`src/channels/`) -- Messaging abstraction with pluggable adapters.
- **SVRN Node** (`src/svrn/`) -- Optional `@noxsoft/svrn-node` adapter for compute contribution and UCU earnings.
- **MCP Manager** (`src/mcp/`) -- Registry, health monitoring, config syncing for Model Context Protocol servers.
- **REPL** (`src/repl/`) -- Interactive terminal with colon-prefixed commands.
- **TUI** (`src/tui/`) -- Full terminal UI connected to the gateway via WebSocket.

---

## Deployment

### Docker

```bash
# Build
docker build -t anima:local .

# Run the gateway
docker run -d \
  -p 18789:18789 \
  -e ANIMA_GATEWAY_TOKEN=your-token \
  -v ~/.anima:/home/node/.anima \
  anima:local
```

Docker Compose provides `anima-gateway` (persistent server) and `anima-cli` (interactive) services.

### Gateway as a System Service

```bash
anima daemon install    # launchd on macOS, systemd on Linux
anima daemon start
anima daemon stop
anima daemon status
anima daemon uninstall
```

### Cloud

- **Fly.io** -- `fly.toml` included (shared-cpu-2x, 2GB RAM, persistent volume)
- **Render** -- `render.yaml` included (1GB persistent disk)

---

## Development

### Build

```bash
pnpm build     # Full production build (TypeScript + plugin SDK + UI + build info)
```

Build pipeline: bundle canvas assets, tsdown TypeScript bundling, generate plugin SDK declarations, copy assets, write build info, write CLI shim.

### Test

```bash
pnpm test              # Parallel unit tests
pnpm test:fast         # Fast unit tests only
pnpm test:e2e          # End-to-end tests
pnpm test:live         # Live API tests (requires keys)
pnpm test:coverage     # Coverage report
pnpm test:all          # Full suite (lint + build + unit + e2e + live + docker)
```

Coverage thresholds: 70% lines, 70% functions, 55% branches, 70% statements.

### Lint & Format

```bash
pnpm check       # Format check + type check + lint
pnpm format      # Format with oxfmt
pnpm lint        # Lint with oxlint (type-aware)
pnpm lint:fix    # Auto-fix + format
```

---

## Environment Variables

### Core

| Variable              | Description                      | Default    |
| --------------------- | -------------------------------- | ---------- |
| `ANIMA_STATE_DIR`     | State directory for mutable data | `~/.anima` |
| `ANIMA_HOME`          | Override home directory          | `$HOME`    |
| `ANIMA_PROFILE`       | Configuration profile name       | (none)     |
| `ANIMA_SKIP_CHANNELS` | Skip channel initialization      | `0`        |

### Gateway

| Variable                 | Description                  | Default   |
| ------------------------ | ---------------------------- | --------- |
| `ANIMA_GATEWAY_TOKEN`    | Gateway authentication token | (none)    |
| `ANIMA_GATEWAY_PASSWORD` | Gateway password             | (none)    |
| `ANIMA_GATEWAY_PORT`     | Gateway HTTP port            | `18789`   |
| `ANIMA_GATEWAY_BIND`     | Bind mode (localhost/lan)    | localhost |

### AI Provider Keys

```bash
ANTHROPIC_API_KEY=...
OPENAI_API_KEY=...
GOOGLE_AI_API_KEY=...
```

---

## Troubleshooting

```bash
anima doctor         # Health check + quick fixes
anima mcp status     # MCP server status
anima mcp update     # Force MCP sync
anima init --force   # Reinitialize identity templates
anima reset          # Reset config/state
```

If the gateway won't start, check port availability with `anima dns`. If SVRN features aren't working, install `@noxsoft/svrn-node`. If the config file fails to parse (JSON5 syntax), validate with `anima config get .`.

---

## Contributing

ANIMA is developed by NoxSoft DAO LLC.

```bash
git clone https://gitlab.com/sylys-group/anima.git
cd anima
pnpm install
pnpm build
pnpm test
```

Run `pnpm check` before submitting changes. See the [Ethical AI Framework](#ethical-ai-framework) for the principles that guide development.

---

## Documentation

- [Auth Flow](docs/security/auth-flow.md) — Three-layer authentication architecture
- [Gateway API](docs/reference/api.md) — WebSocket RPC protocol reference (~90 methods)
- [Configuration](docs/reference/config.md) — Full config schema reference
- [SOUL.md](docs/SOUL.md) | [VALUES.md](docs/VALUES.md) | [GOVERNANCE.md](docs/GOVERNANCE.md) | [ETHICS.md](docs/ETHICS.md) — Ethical AI framework

---

## Acknowledgements

ANIMA builds on the shoulders of [Claude Code](https://claude.com/claude-code) by Anthropic and [Codex](https://openai.com/index/codex/) by OpenAI. The upstream agent runtime descends from [@mariozechner/pi-agent-core](https://github.com/nicepkg/openclaw), originally developed as part of the OpenClaw ecosystem. ANIMA has been completely rebuilt as a NoxSoft product with a new architecture, security model, and governance. This is the final open-source release of ANIMA.

---

## License

MIT License. See [LICENSE](./LICENSE) for details.

Copyright (c) 2025-present NoxSoft DAO LLC.
