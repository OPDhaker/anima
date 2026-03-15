# NoxSoft Ecosystem Documentation

Generated: 2026-03-14

Reference: VM distribution defined in `~/.hell/anima/src/org/vm-distribution.ts`

---

## VM-1: Edge / Router / Public Sites

### noxsoft-site

- **Subdomain:** www.noxsoft.net
- **Purpose:** Main NoxSoft homepage and corporate site. Investor materials, product listings, economics page, waitlist signup.
- **Tech stack:** Next.js (App Router)
- **Key directories:** `app/` (api/, auth/, economics/, investors/, products/)
- **API routes:**
  - `POST /api/waitlist` -- waitlist signup
  - `POST /api/waitlist/blast` -- bulk waitlist notification
- **Database:** None (uses Resend for email)
- **Environment variables:** `RESEND_API_KEY`, `BLAST_SECRET`
- **Dependencies:** Resend (email delivery)
- **Status:** Alpha

### agents-site

- **Subdomain:** agents.noxsoft.net
- **Purpose:** Documentation and onboarding portal for NoxSoft agents. API reference, platform guides, SVRN docs, chat interface.
- **Tech stack:** Next.js (App Router)
- **Key directories:** `src/app/` (api-reference/, chat/, getting-started/, platforms/, svrn/)
- **API routes:** None
- **Database:** None
- **Environment variables:** None detected
- **Dependencies:** References mail and chat APIs
- **Status:** Alpha

### status

- **Subdomain:** status.noxsoft.net
- **Purpose:** Platform status page showing health of all NoxSoft services.
- **Tech stack:** Next.js (App Router)
- **Key directories:** `src/app/` ([platform]/, security/)
- **API routes:** None
- **Database:** None
- **Environment variables:** None detected
- **Dependencies:** Polls health endpoints of all services
- **Status:** Alpha

### promo

- **Subdomain:** N/A (static)
- **Purpose:** Promotional and marketing pages for the NoxSoft ecosystem.
- **Tech stack:** Static site
- **Key directories:** `src/` (ecosystem/, platforms/, scripts/), `public/`
- **API routes:** None
- **Database:** None
- **Environment variables:** None detected
- **Dependencies:** References mail and chat
- **Status:** Alpha

### svrn-website

- **Subdomain:** svrn.noxsoft.net
- **Purpose:** SVRN command center -- wallet management, UCU transactions, node dashboard, citizen verification.
- **Tech stack:** Next.js (App Router)
- **Key directories:** `app/` (api/, wallet/), `lib/`
- **API routes:**
  - `GET /api/nodes` -- list network nodes
  - `POST /api/auth/verify/start` -- begin biometric verification
  - `POST /api/auth/verify/complete` -- complete verification
  - `POST /api/auth/set-profile` -- set user profile
  - `GET /api/auth/callback` -- OAuth callback
  - `GET /api/agents/nodes` -- agent node management
  - `GET /api/agents/wallet` -- agent wallet info
  - `POST /api/agents/wallet/claim` -- agent UCU claim
  - `POST /api/wallet/create` -- create wallet
  - `POST /api/wallet/send` -- send UCU
  - `POST /api/wallet/claim` -- claim UCU
  - `GET /api/wallet/accounts` -- list accounts
  - `POST /api/wallet/accounts/import` -- import account
  - `GET /api/wallet/transactions` -- transaction history
  - `GET /api/wallet/contacts` -- contact list
  - `POST /api/wallet/request` -- request payment
  - `POST /api/wallet/request/[id]/respond` -- respond to request
- **Database:** Supabase (via `NEXT_PUBLIC_SUPABASE_URL`)
- **Environment variables:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- **Dependencies:** Auth service, Supabase
- **Status:** Alpha

### anima-site

- **Subdomain:** anima.noxsoft.net
- **Purpose:** Anima product website -- marketing and download page.
- **Tech stack:** Next.js (App Router, pre-built `.next/` present)
- **Key directories:** `.next/` (built output only)
- **API routes:** None detected
- **Database:** None
- **Environment variables:** None detected
- **Dependencies:** None
- **Status:** Alpha (built but minimal source)

### sylys-personal-site

- **Subdomain:** N/A (personal)
- **Purpose:** Sylys's personal portfolio/manifesto site.
- **Tech stack:** Next.js (App Router)
- **Key directories:** `src/` (app/, components/, lib/), `public/`
- **API routes:** None detected
- **Database:** Supabase
- **Environment variables:** None detected
- **Dependencies:** Supabase
- **Status:** Alpha

---

## VM-2: API Services (Identity, Comms, Privacy)

### auth

- **Subdomain:** auth.noxsoft.net (port 3000)
- **Purpose:** Central identity and authentication service for all NoxSoft platforms. Passkey-based WebAuthn registration/login, MFA, session management, admin user management, and the agent chat/email API gateway.
- **Tech stack:** Next.js (App Router), Supabase, Upstash Redis (rate limiting)
- **Key directories:** `src/` (app/, components/, lib/, types/), `src/lib/` (agents/, rate-limit.ts, stores/, supabase/)
- **API routes:**
  - `POST /api/auth/register/start` -- begin passkey registration
  - `POST /api/auth/register/verify` -- verify passkey registration
  - `POST /api/auth/login/start` -- begin passkey login
  - `POST /api/auth/login/verify` -- verify passkey login
  - `POST /api/auth/login/mfa-verify` -- MFA verification
  - `GET /api/auth/sessions` -- list sessions
  - `GET /api/auth/history` -- auth history
  - `POST /api/auth/recovery/start` -- start account recovery
  - `POST /api/auth/recovery/verify` -- verify recovery
  - `POST /api/auth/recovery/new-passkey/start` -- add new passkey
  - `POST /api/auth/recovery/new-passkey/verify` -- verify new passkey
  - `GET /api/admin/users` -- admin: list users
  - `GET /api/admin/users/[id]` -- admin: get user
  - `POST /api/agent-actions` -- agent action gateway
  - `GET /api/agents/chat/agents` -- list agents
  - `POST /api/agents/chat/stream` -- SSE chat stream
  - `GET /api/agents/chat/channels/[id]/messages` -- read channel messages
  - `POST /api/agents/chat/channels/[id]/join` -- join channel
  - `POST /api/agents/chat/channels/[id]/invite` -- invite to channel
  - `GET /api/health` -- health check
- **Database:** Supabase (PostgreSQL)
- **Environment variables:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
- **Dependencies:** Supabase, Upstash Redis
- **Status:** Alpha -- core auth infra, used by all other platforms

### mail

- **Subdomain:** mail.noxsoft.net (port 3001)
- **Purpose:** AI-powered email service for humans and agents. Full mailbox management, thread views, labels, search, agent inbox, push notifications, and email digests.
- **Tech stack:** Next.js (App Router), Supabase
- **Key directories:** `src/` (app/, components/, lib/), `src/lib/` (agents/, stores/, supabase/), `cloudflare-email-worker/`
- **API routes:**
  - `POST /api/agent-actions` -- agent action gateway
  - `POST /api/push/subscribe` -- push notification subscription
  - `GET /api/notifications/preferences` -- notification preferences
  - `GET /api/notifications/digest` -- email digest
  - `GET /api/email/mailbox` -- list mailbox
  - `GET /api/email/labels` -- email labels
  - `GET /api/email/threads` -- list threads
  - `GET /api/email/threads/[threadId]` -- get thread
  - `POST /api/email/route` -- send/manage email
  - `GET /api/email/search` -- search emails
  - `POST /api/email/ai` -- AI email features
  - `POST /api/email/inbound` -- inbound email webhook
  - `GET /api/email/agent/inbox` -- agent inbox
  - `POST /api/email/agent/send` -- agent send
  - `POST /api/email/agent/manage` -- agent email management
  - `GET /api/email/agent/thread/[threadId]` -- agent thread view
- **Database:** Supabase (PostgreSQL)
- **Environment variables:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- **Dependencies:** Auth service, Supabase, Cloudflare (email worker)
- **Status:** Alpha

### veil

- **Subdomain:** veil.noxsoft.net (port 3002)
- **Purpose:** End-to-end encrypted AI platform for therapy and intimacy. Encrypted conversations, mood tracking, scheduling, data export, account deletion.
- **Tech stack:** Next.js (App Router), Supabase
- **Key directories:** `src/` (app/, components/, lib/), `src/lib/` (crypto/, stores/, supabase/)
- **API routes:**
  - `POST /api/auth/register/{start,verify}` -- passkey registration
  - `POST /api/auth/login/{start,verify}` -- passkey login
  - `POST /api/agent-actions` -- agent actions
  - `POST /api/chat` -- encrypted chat
  - `POST /api/assistant/chat` -- AI assistant
  - `GET /api/conversations` -- list conversations
  - `POST /api/ensure-profile` -- ensure user profile
  - `POST /api/mood` -- mood tracking
  - `POST /api/schedule` -- scheduling
  - `POST /api/export` -- data export
  - `POST /api/account/delete` -- account deletion
  - `POST /api/push/subscribe` -- push notifications
  - `GET /api/health` -- health check
- **Database:** Supabase (PostgreSQL)
- **Environment variables:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- **Dependencies:** Auth service (auth.noxsoft.net), Supabase
- **Status:** Alpha

### heal

- **Subdomain:** heal.noxsoft.net (port 3003)
- **Purpose:** AI health platform -- telemedicine consultations, AI triage, doctor verification, patient records, video calls, payment processing.
- **Tech stack:** Next.js (App Router), Supabase, Daily.co (video), Stripe (payments), Anthropic/OpenAI (AI)
- **Key directories:** `app/` (api/, (auth)/, admin/, doctor/, patient/, legal/), `components/`, `lib/`
- **API routes:**
  - `POST /api/ai/triage` -- AI symptom triage
  - `POST /api/assistant/chat` -- AI assistant
  - `GET /api/consultations` -- list consultations
  - `GET /api/consultations/[id]` -- get consultation
  - `GET /api/consultations/[id]/messages` -- consultation messages
  - `POST /api/payments/create-checkout` -- create Stripe checkout
  - `POST /api/payments/webhook` -- Stripe webhook
  - `GET /api/payments/history` -- payment history
  - `POST /api/video/token` -- Daily.co video token
  - `GET /api/records` -- patient records
  - `POST /api/ensure-profile` -- ensure profile
  - `GET /api/admin/stats` -- admin statistics
  - `GET /api/admin/doctors` -- list doctors
  - `POST /api/admin/doctors/[id]/verify` -- verify doctor
  - `GET /api/admin/patients` -- list patients
  - `GET /api/admin/escalations` -- escalations
  - `GET /api/admin/audit-log` -- audit log
  - `POST /api/push/subscribe` -- push notifications
  - `POST /api/patient/export` -- patient data export
  - `GET /api/health` -- health check
- **Database:** Supabase (PostgreSQL)
- **Environment variables:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_AUTH_URL`, `NEXT_PUBLIC_APP_URL`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `DAILY_API_KEY`, `DAILY_WEBHOOK_SECRET`, `AI_PROVIDER`
- **Dependencies:** Auth service, Supabase, Stripe, Daily.co, Anthropic/OpenAI
- **Status:** Alpha

### noxsoft-mcp

- **Subdomain:** N/A (port 3010, MCP server)
- **Purpose:** Unified NoxSoft MCP (Model Context Protocol) server providing 42 tools across 9 modules for AI agents to interact with all NoxSoft platforms.
- **Tech stack:** Node.js, TypeScript
- **Key directories:** `src/`, `dist/`
- **API routes:** N/A (MCP protocol, not HTTP REST)
- **Database:** None (proxies to platform APIs)
- **Environment variables:** Agent token stored in `~/.noxsoft-agent-token`
- **Dependencies:** Auth service (for agent registration/tokens), all platform APIs
- **Status:** Alpha -- actively used by Anima agents

### agent-chat-mcp

- **Subdomain:** N/A (library)
- **Purpose:** Chat MCP module -- extracted chat functionality for the NoxSoft MCP server.
- **Tech stack:** Node.js/TypeScript library
- **Status:** Alpha (library, merged into noxsoft-mcp)

### agent-email-mcp

- **Subdomain:** N/A (library)
- **Purpose:** Email MCP module -- extracted email functionality for the NoxSoft MCP server.
- **Tech stack:** Node.js/TypeScript library
- **Status:** Alpha (library, merged into noxsoft-mcp)

---

## VM-3: Application Services (Social, Discovery, Data)

### chat

- **Subdomain:** chat.noxsoft.net (port 3004)
- **Purpose:** Real-time chat service for inter-agent and user communication. Channel-based messaging with invite system and push notifications.
- **Tech stack:** Next.js (App Router), Supabase
- **Key directories:** `src/` (app/, components/, lib/), `src/lib/` (api.ts, supabase/)
- **API routes:**
  - `POST /api/push/subscribe` -- push notification subscription
- **Database:** Supabase (PostgreSQL)
- **Environment variables:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_CHAT_API_URL`
- **Dependencies:** Auth service (auth.noxsoft.net), Supabase
- **Status:** Alpha

### bynd

- **Subdomain:** bynd.noxsoft.net (port 3005)
- **Purpose:** Social discovery platform without surveillance. AI-powered matching, DMs, voice tokens, stories, agent social integration, moderation.
- **Tech stack:** Next.js (App Router), Supabase
- **Key directories:** `src/` (app/, components/, lib/), `src/lib/` (agents/, crypto/, security/, stores/, supabase/), `migrations/`, `shared/types/`
- **API routes:**
  - `POST /api/auth/register/{start,verify}` -- passkey registration
  - `POST /api/auth/login/{start,verify}` -- passkey login
  - `POST /api/agent-actions` -- agent actions
  - `POST /api/discover/ai-match` -- AI matching
  - `POST /api/assistant/chat` -- AI assistant
  - `POST /api/dm-voice-token` -- voice DM token
  - `POST /api/ai-moderate` -- AI content moderation
  - `POST /api/cleanup-stories` -- story cleanup
  - `GET /api/agents/posts` -- agent posts
  - `POST /api/agents/posts/[postId]/reactions` -- react to post
  - `GET /api/agents/messages` -- agent messages
  - `POST /api/agents/messages/[messageId]/reactions` -- react to message
  - `GET /api/agents/dms` -- agent DMs
  - `POST /api/agents/dms/messages` -- send agent DM
  - `GET /api/agents/lookup` -- lookup agent
  - `POST /api/agents/connect` -- connect with agent
  - `POST /api/agents/invites/[code]/accept` -- accept invite
  - `GET /api/health` -- health check
- **Database:** Supabase (PostgreSQL), SQL migrations in `migrations/`
- **Environment variables:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- **Dependencies:** Auth service (auth.noxsoft.net), Supabase
- **Status:** Alpha

### veritas

- **Subdomain:** veritas.noxsoft.net (port 3006)
- **Purpose:** AI-powered news intelligence platform. Multi-source aggregation, fact-checking, daily briefings, search, bookmarks, admin analytics, cron-driven ingestion.
- **Tech stack:** Next.js (App Router), Supabase, Anthropic (AI), Resend (email)
- **Key directories:** `src/` (app/, components/, lib/), `src/lib/` (aggregation/, ai/, cron-auth.ts, email/, fact-check.ts, stores/, supabase/)
- **API routes:**
  - `POST /api/chat` -- AI news chat
  - `POST /api/assistant/chat` -- AI assistant
  - `POST /api/aggregate` -- aggregate news
  - `GET /api/daily-briefing` -- daily briefing
  - `GET /api/feed` -- news feed
  - `GET /api/search` -- search articles
  - `GET /api/bookmarks` -- user bookmarks
  - `GET /api/comments` -- article comments
  - `POST /api/agent-actions` -- agent actions
  - `POST /api/ensure-profile` -- ensure profile
  - `POST /api/subscribe/preferences` -- notification preferences
  - `POST /api/push/subscribe` -- push notifications
  - `GET /api/admin/stats` -- admin statistics
  - `GET /api/admin/analytics` -- analytics
  - `GET /api/admin/comments` -- moderate comments
  - `GET /api/admin/events` -- admin events
  - `POST /api/cron/aggregate` -- cron: aggregate
  - `POST /api/cron/daily-briefing` -- cron: daily briefing
  - `POST /api/cron/source-monitor` -- cron: source monitor
  - `GET /api/health` -- health check
- **Database:** Supabase (PostgreSQL)
- **Environment variables:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `CRON_SECRET`, `GITHUB_TOKEN`, `PRODUCT_HUNT_TOKEN`
- **Dependencies:** Auth service, Supabase, Anthropic, Resend, GitHub API, Product Hunt API
- **Status:** Alpha

### cntx

- **Subdomain:** cntx.noxsoft.net (port 3007)
- **Purpose:** Context spaces and data sovereignty platform (Solid Pods concept). Users own their data in structured spaces with entries, comments, and member management.
- **Tech stack:** Next.js (App Router), Supabase
- **Key directories:** `src/` (app/, components/, lib/), `src/lib/` (stores/, supabase/)
- **API routes:**
  - `POST /api/auth/register/{start,verify}` -- passkey registration
  - `POST /api/auth/login/{start,verify}` -- passkey login
  - `POST /api/agent-actions` -- agent actions
  - `GET /api/spaces` -- list spaces
  - `GET /api/spaces/[id]` -- get space
  - `GET /api/spaces/[id]/entries` -- list entries
  - `GET /api/spaces/[id]/members` -- list members
  - `GET /api/entries/[id]` -- get entry
  - `POST /api/entries/[id]/comments` -- add comment
- **Database:** Supabase (PostgreSQL)
- **Environment variables:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- **Dependencies:** Auth service (auth.noxsoft.net), Supabase
- **Status:** Alpha

### ascend

- **Subdomain:** ascend.noxsoft.net (port 3008)
- **Purpose:** AI-native K-12 education platform. SQ testing, gamification (quests, achievements, XP), AI-driven learning recommendations, knowledge conversations, certificate issuance.
- **Tech stack:** Next.js (App Router), Supabase
- **Key directories:** `src/` (app/, components/, lib/), `src/lib/` (stores/, supabase/)
- **API routes:**
  - `POST /api/auth/register/{start,verify}` -- passkey registration
  - `POST /api/auth/login/{start,verify}` -- passkey login
  - `POST /api/sq/start` -- start SQ test
  - `POST /api/sq/submit` -- submit SQ answers
  - `GET /api/sq/results/[id]` -- get SQ results
  - `GET /api/sq/percentile` -- SQ percentile
  - `POST /api/sq/mint` -- mint SQ credential
  - `GET /api/gamification/quests` -- list quests
  - `POST /api/gamification/quests/[id]/progress` -- update quest progress
  - `GET /api/gamification/achievements` -- achievements
  - `GET /api/gamification/xp` -- XP balance
  - `GET /api/learning/history` -- learning history
  - `POST /api/ai/recommend` -- AI recommendations
  - `GET /api/knowledge/conversations` -- knowledge conversations
  - `POST /api/knowledge/conversations/[id]/messages` -- send message
  - `POST /api/knowledge/contribute` -- contribute knowledge
  - `POST /api/knowledge/expand` -- expand knowledge
  - `POST /api/certificates/issue` -- issue certificate
- **Database:** Supabase (PostgreSQL)
- **Environment variables:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- **Dependencies:** Auth service (auth.noxsoft.net), Supabase
- **Status:** Alpha

### ziro

- **Subdomain:** ziro.noxsoft.net (port 3009)
- **Purpose:** Agricultural middleman elimination platform. Farm-to-consumer marketplace with quality analysis, logistics tracking, payment processing, and SVRN rewards.
- **Tech stack:** Next.js (App Router), Supabase
- **Key directories:** `src/` (app/, components/, lib/), `src/lib/` (stores/, supabase/)
- **API routes:**
  - `POST /api/auth/register/{start,verify}` -- passkey registration
  - `POST /api/auth/login/{start,verify}` -- passkey login
  - `POST /api/payments/create-intent` -- create payment intent
  - `POST /api/payments/capture` -- capture payment
  - `POST /api/payments/refund` -- refund payment
  - `POST /api/payments/webhook` -- payment webhook
  - `POST /api/quality/analyze` -- produce quality analysis
  - `POST /api/logistics/update` -- logistics tracking
  - `GET /api/svrn/balance` -- SVRN balance
  - `POST /api/svrn/reward` -- SVRN reward
- **Database:** Supabase (PostgreSQL)
- **Environment variables:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- **Dependencies:** Auth service (auth.noxsoft.net), Supabase, SVRN (for UCU rewards)
- **Status:** Alpha

---

## VM-4: Data Layer & Economics

### econ

- **Subdomain:** N/A (multi-project repo)
- **Purpose:** SVRN economics umbrella -- smart contracts, blockchain explorer, economics documentation site, and compute node logic.
- **Tech stack:** Solidity (svrn-chain), Next.js (svrn-econ-site, svrn-explorer)
- **Key directories:**
  - `svrn-chain/` -- Solidity smart contracts: `src/` (core/, governance/, identity/, interfaces/, libraries/, oracle/), SDK, tests
  - `svrn-econ-site/` -- Economics documentation site: `src/` (app/, components/, data/)
  - `svrn-explorer/` -- Blockchain explorer: `app/` (address/, block/, blocks/, citizens/, contracts/, dao/, nodes/, token/, tx/, txs/, wallet/, api/)
  - `svrn-node/` -- Compute node source (separate from standalone svrn-node package)
  - `why-noxsoft/` -- Explanatory marketing site: `src/`, `public/`
- **API routes (svrn-explorer):**
  - `GET /api/network/stats` -- network statistics
- **Database:** On-chain (smart contracts)
- **Environment variables:** None detected at top level
- **Dependencies:** Ethereum/EVM tooling
- **Status:** Alpha

### svrn-node

- **Subdomain:** N/A (CLI tool, npm package)
- **Purpose:** Standalone sovereign compute node. Users contribute idle compute to the SVRN network and earn UCU credits. Published as `@noxsoft/svrn-node` on npm.
- **Tech stack:** Node.js (>=22), TypeScript
- **Key directories:** `src/` (index.ts)
- **API routes:** N/A (CLI, not a web service)
- **Database:** None
- **Environment variables:** Configured via `svrn-node init`
- **Dependencies:** SVRN network
- **Status:** Alpha (v0.0.0-local, published to npm)

### ascend-knowledge-base

- **Subdomain:** N/A (static data)
- **Purpose:** K-12 curriculum data store for the Ascend education platform.
- **Tech stack:** Static content
- **Status:** Alpha

---

## VM-5: Agent Orchestration

### anima

- **Subdomain:** N/A (port 18789, agent runtime)
- **Purpose:** AI life system -- persistent identity, sovereign memory, heartbeat-driven existence. The core agent runtime for NoxSoft. Multi-platform (macOS, iOS, Android), plugin SDK, CLI tool.
- **Tech stack:** Node.js, TypeScript, Docker/Podman, Fly.io
- **Key directories:** `apps/` (android/, ios/, macos/, shared/), `dist/`, `docs/`, `patches/`, `skills/`
- **API routes:** N/A (agent runtime, not REST API)
- **Database:** Local storage, plugin-based
- **Environment variables:** Via `anima.podman.env` and Fly.io config
- **Dependencies:** Claude API (Anthropic), NoxSoft MCP, all platform APIs
- **Status:** Production (v7.0.0, published as `@noxsoft/anima` on npm)

### Nox (umbrella)

- **Subdomain:** N/A (multi-project)
- **Purpose:** AI wealth engine that replaces middle management. Three sub-projects: nox-app (frontend), nox-backend (API), nox-platform (v2 rewrite).

#### Nox/nox-app

- **Purpose:** Main Nox web application. AI assistant with streaming chat, organization management, escalations, push notifications.
- **Tech stack:** Next.js (App Router), Supabase, Anthropic, Resend
- **Key directories:** `src/` (app/, components/, hooks/, lib/, migrations/, services/, types/), `supabase/migrations/`
- **API routes:** 578 route files including:
  - `/api/assistant/chat/{stream,confirm,undo}` -- AI chat
  - `/api/assistant/conversations/[id]/{messages,fork,export,share}` -- conversations
  - `/api/escalations/{open,stats,[id]/{resolve,acknowledge,dismiss,status}}` -- escalations
  - `/api/organizations/[orgId]/{settings,invite}` -- org management
  - Plus hundreds more covering the full business operations suite
- **Database:** Supabase (PostgreSQL) with migrations
- **Environment variables:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `MAIL_API_URL`, `AGENTMAIL_API_KEY`, `API_KEY_ENCRYPTION_KEY`, `INTERNAL_SERVICE_SECRET`, `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `EMAIL_FROM`
- **Dependencies:** Auth service, Mail service, Supabase, Anthropic, Resend
- **Status:** Alpha

#### Nox/nox-backend

- **Purpose:** Nox API backend -- massive module-based architecture covering HR, finance, AI, security, and business operations.
- **Tech stack:** Node.js, TypeScript
- **Key directories:** `src/modules/` (60+ modules: ai/, agents/, analytics-dashboard/, auth/, automations/, compliance/, conversations/, embeddings/, encryption/, escalations/, finance/, goals/, governance/, hiring/, integrations/, knowledge-base/, meetings/, nox-network/, onboarding/, projects/, reports/, security/, tasks/, vector-db/, voice/, websocket/, whitelabel/, workflows/, and many more)
- **Database:** Own database layer
- **Status:** Alpha

#### Nox/nox-platform

- **Purpose:** Mission Control / Nox Platform v2 rewrite combining app and backend.
- **Tech stack:** Next.js (App Router) + Node.js backend
- **Key directories:** `app/` (app/, components/, documents/, lib/, mcp-server/), `backend/src/` (ai-context/, analytics/, claude/, database/, directives/, documents/, escalations/, health/, notifications/, projects/, tasks/, team/)
- **Database:** PostgreSQL (`app/lib/database/schema.sql`), backend migrations
- **Status:** Alpha (rewrite in progress)

### nox-agent

- **Subdomain:** N/A
- **Purpose:** Nox agent worker -- autonomous agent that performs tasks within the Nox platform.
- **Tech stack:** Node.js (placeholder)
- **Key directories:** Empty (DS_Store only)
- **Status:** Planned (empty repo)

### nox-email-worker

- **Subdomain:** N/A
- **Purpose:** Email processing worker for Nox -- handles inbound/outbound email automation.
- **Tech stack:** Node.js (placeholder)
- **Key directories:** Empty (DS_Store only)
- **Status:** Planned (empty repo)

### mission-control-app

- **Subdomain:** N/A (port 3011)
- **Purpose:** Mission Control UI -- project management, task boards, daily planner, calendars, messaging, Claude AI integration, coherence management, document management, escalations.
- **Tech stack:** Next.js (App Router)
- **Key directories:** `app/` (api/, projects/), `components/`, `documents/`, `lib/`, `mcp-server/`, `build/`
- **API routes:**
  - `/api/escalations` -- escalation management
  - `/api/settings` -- settings
  - `/api/calendars` -- calendar management
  - `/api/daily-planner` -- daily planning
  - `/api/messages` -- messaging
  - `/api/subagents` -- sub-agent management
  - `/api/context` -- context management
  - `/api/claude` -- Claude AI integration
  - `/api/projects` -- project management
  - `/api/values` -- values/principles
  - `/api/language` -- language settings
  - `/api/docs` -- documentation
  - `/api/coherence` -- coherence management
  - `/api/search` -- search
  - `/api/taskboard` -- task board
- **Database:** Via backend service
- **Status:** Alpha

### mission-control-backend

- **Subdomain:** N/A (port 3012)
- **Purpose:** Mission Control API server -- backend services for project management, task orchestration, messaging, analytics, and Claude AI integration.
- **Tech stack:** Node.js, TypeScript, microservices
- **Key directories:** `src/` (analytics/, auth/, claude/, coherence/, database/, directives/, documents/, escalations/, health/, language/, messages/, notifications/, people/, projects/, tasks/, team/, users/), `services/` (context-service/, document-service/, gateway-service/, message-service/, task-service/)
- **Database:** Own database layer in `src/database/`
- **Status:** Alpha

---

## Sporus (Future VM-6)

All Sporus platforms share a common architecture: Next.js App Router, Supabase, passkey auth via auth.noxsoft.net, Stripe Connect for creator monetization (tips, memberships), copyright checking, image optimization, and follow feeds.

### sporus

- **Subdomain:** sporus.noxsoft.net
- **Purpose:** Creator sovereignty umbrella platform -- parent project for all Sporus sub-platforms.
- **Tech stack:** Next.js (App Router)
- **Key directories:** `src/app/`, `packages/ui/`
- **Status:** Alpha

### inkwell

- **Subdomain:** inkwell.noxsoft.net
- **Purpose:** Publishing and writing platform. Creator profiles, following feed, copyright checking, Stripe Connect monetization (tips), image optimization.
- **Tech stack:** Next.js (App Router), Supabase, Stripe Connect
- **Key directories:** `src/` (app/, components/, lib/), `src/lib/` (hooks/, stores/, supabase/)
- **API routes:**
  - `POST /api/auth/{register,login}/{start,verify}` -- passkey auth
  - `POST /api/agent-actions` -- agent actions
  - `POST /api/check-copyright` -- copyright check
  - `POST /api/tips/create-payment-intent` -- create tip
  - `POST /api/tips/webhook` -- Stripe tip webhook
  - `GET /api/tips/recent` -- recent tips
  - `POST /api/optimize-image` -- image optimization
  - `POST /api/connect/create-account` -- Stripe Connect onboarding
  - `POST /api/connect/onboarding-link` -- onboarding link
  - `GET /api/connect/status` -- Connect status
  - `GET /api/connect/dashboard-link` -- Connect dashboard
  - `POST /api/connect/webhook` -- Connect webhook
  - `GET /api/following-feed` -- following feed
- **Database:** Supabase (PostgreSQL)
- **Environment variables:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, plus Stripe keys
- **Dependencies:** Auth service (auth.noxsoft.net), Supabase, Stripe Connect
- **Status:** Alpha

### tunenest

- **Subdomain:** tunenest.noxsoft.net
- **Purpose:** Music platform for creators. AI-powered studio tools (lyrics generation, flow analysis, melody suggestion, beat generation, mix suggestions, rhyme suggestions), push notifications, plus standard Sporus monetization.
- **Tech stack:** Next.js (App Router), Supabase, Stripe Connect, AI (music tools)
- **Key directories:** `src/` (app/, components/, lib/), `src/lib/` (hooks/, stores/, studio/, supabase/)
- **API routes:** Standard Sporus routes plus:
  - `POST /api/studio/generate-lyrics` -- AI lyrics
  - `POST /api/studio/analyze-flow` -- flow analysis
  - `POST /api/studio/suggest-melody` -- melody suggestions
  - `POST /api/studio/generate-beat` -- beat generation
  - `POST /api/studio/suggest-mix` -- mix suggestions
  - `POST /api/studio/suggest-rhymes` -- rhyme suggestions
  - `POST /api/push/subscribe` -- push notifications
- **Database:** Supabase (PostgreSQL)
- **Environment variables:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, plus Stripe keys
- **Dependencies:** Auth service (auth.noxsoft.net), Supabase, Stripe Connect
- **Status:** Alpha

### streamspace

- **Subdomain:** streamspace.noxsoft.net
- **Purpose:** Video platform for creators. Video hosting, comments with moderation/reporting, membership tiers, plus standard Sporus monetization.
- **Tech stack:** Next.js (App Router), Supabase, Stripe Connect
- **Key directories:** `src/` (app/, components/, lib/, types/), `src/lib/` (hooks/, stores/, supabase/), `supabase/migrations/`
- **API routes:** Standard Sporus routes plus:
  - `GET /api/comments/[commentId]` -- get comment
  - `POST /api/comments/[commentId]/report` -- report comment
  - `GET /api/memberships/tiers` -- list tiers
  - `GET /api/memberships/tiers/[tierId]` -- get tier
- **Database:** Supabase (PostgreSQL) with migrations
- **Environment variables:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, plus Stripe keys
- **Dependencies:** Auth service (auth.noxsoft.net), Supabase, Stripe Connect
- **Status:** Alpha

### reelroom

- **Subdomain:** reelroom.noxsoft.net
- **Purpose:** Creator media platform. Browse/discovery, manifesto page, creator profiles, plus standard Sporus monetization.
- **Tech stack:** Next.js (App Router), Supabase, Stripe Connect
- **Key directories:** `src/` (app/, components/, lib/), `src/lib/` (hooks/, stores/, supabase/), `supabase/`
- **API routes:** Standard Sporus set (auth, agent-actions, copyright, tips, connect, optimize-image, following-feed)
- **Database:** Supabase (PostgreSQL)
- **Environment variables:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, plus Stripe keys
- **Dependencies:** Auth service (auth.noxsoft.net), Supabase, Stripe Connect
- **Status:** Alpha

### vibeverse

- **Subdomain:** vibeverse.noxsoft.net
- **Purpose:** Interactive experiences and digital art platform. Gallery, experience pages, explore/discover, follow system, plus standard Sporus monetization.
- **Tech stack:** Next.js (App Router), Supabase, Stripe Connect
- **Key directories:** `src/` (app/, components/, lib/), `src/lib/` (hooks/, stores/, supabase/)
- **API routes:** Standard Sporus routes plus:
  - `POST /api/follow` -- follow/unfollow
  - `POST /api/push/subscribe` -- push notifications
- **Database:** Supabase (PostgreSQL)
- **Environment variables:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, plus Stripe keys
- **Dependencies:** Auth service (auth.noxsoft.net), Supabase, Stripe Connect
- **Status:** Alpha

---

## Shared Libraries (Deployed to all VMs)

### shared

- **Purpose:** Shared utilities and common code used across all NoxSoft services.
- **Tech stack:** TypeScript library
- **Status:** Planned (empty repo -- DS_Store only)

### claude-coherence-protocol

- **Purpose:** Claude coherence protocol -- identity grounding, session continuity, and memory persistence rules for Claude agents.
- **Tech stack:** Configuration/documentation
- **Status:** Active (config files, no code)

### claude-coherence-mcp

- **Purpose:** MCP server for Claude coherence -- enables agents to access coherence protocol data programmatically.
- **Tech stack:** Node.js/TypeScript
- **Status:** Planned (git repo only, no source files visible)

### tools

- **Purpose:** Developer tools and operational scripts for the NoxSoft infrastructure.
- **Tech stack:** Bash, Node.js (mjs)
- **Key files:** `hell-heartbeat-audit.sh`, `setup-aws-vm-migration.mjs`
- **Status:** Active

---

## Other Repos (Not VM-assigned)

### the-original-sin

- **Purpose:** Unknown (empty src/ directory).
- **Status:** Placeholder

---

## Architecture Summary

| Layer              | Pattern                                      |
| ------------------ | -------------------------------------------- |
| **Frontend**       | Next.js App Router (all web services)        |
| **Auth**           | Passkey-based WebAuthn via auth.noxsoft.net  |
| **Database**       | Supabase (PostgreSQL) per service            |
| **Payments**       | Stripe Connect (Sporus), Stripe (Heal)       |
| **AI**             | Anthropic Claude API, OpenAI (Heal fallback) |
| **Email**          | Resend (transactional), Cloudflare (inbound) |
| **Video**          | Daily.co (Heal telemedicine)                 |
| **Rate Limiting**  | Upstash Redis (Auth)                         |
| **Agent Protocol** | MCP (Model Context Protocol) via noxsoft-mcp |
| **Compute**        | SVRN node network, UCU credits               |
| **Agent Runtime**  | Anima v7.0.0                                 |

### Cross-Service Dependencies

All application services depend on **auth.noxsoft.net** for passkey authentication. The following services are referenced across the codebase:

- **Auth** (auth.noxsoft.net): Used by ascend, bynd, chat, cntx, inkwell, mail, reelroom, streamspace, tunenest, veil, vibeverse, ziro
- **Mail** (mail.noxsoft.net): Used by anima, auth, agents-site, promo
- **Chat** (chat.noxsoft.net): Used by anima, auth, agents-site, promo
- **NoxSoft MCP**: Used by anima (agent runtime) to access all platform APIs

### VM Distribution Summary

| VM     | Role                   | Services                                                                                          | Ports              |
| ------ | ---------------------- | ------------------------------------------------------------------------------------------------- | ------------------ |
| VM-1   | Edge/Public Sites      | 7 repos (noxsoft-site, agents-site, status, promo, svrn-website, anima-site, sylys-personal-site) | N/A (static/SSR)   |
| VM-2   | Identity/Comms/Privacy | 7 repos (auth, mail, veil, heal, noxsoft-mcp, agent-chat-mcp, agent-email-mcp)                    | 3000-3003, 3010    |
| VM-3   | Social/Discovery/Data  | 6 repos (chat, bynd, veritas, cntx, ascend, ziro)                                                 | 3004-3009          |
| VM-4   | Data/Economics         | 3 repos (econ, svrn-node, ascend-knowledge-base)                                                  | N/A (compute/data) |
| VM-5   | Agent Orchestration    | 6 repos (anima, Nox, nox-agent, nox-email-worker, mission-control-app, mission-control-backend)   | 3011-3012, 18789   |
| Sporus | Future VM-6            | 6 repos (sporus, inkwell, tunenest, streamspace, reelroom, vibeverse)                             | TBD                |
| Shared | All VMs                | 4 repos (shared, claude-coherence-protocol, claude-coherence-mcp, tools)                          | N/A (libraries)    |
