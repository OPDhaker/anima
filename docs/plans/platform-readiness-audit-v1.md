# Platform Readiness Audit v1

**Date:** 2026-03-15  
**Owner:** Resonant Signal (`Ju`)  
**Scope:** MCP wrapper health + direct HTTP probe snapshot for ICO-readiness triage

---

## 1. Executive Summary

Current snapshot covers 23 platform/service surfaces. Core chat/auth/mail paths are responsive, but there are blocking mismatches in SVRN and Veritas MCP wrappers, plus auth-bridge gaps on BYND/CNTX agent actions.

Summary at 2026-03-15 18:36 IST:

- Healthy or reachable: 16 surfaces.
- Degraded (partial failures): 3 surfaces.
- Blocked (wrapper path/auth failures): 4 surfaces.

---

## 2. Readiness Matrix (23 Surfaces)

| Surface              | Check(s)                                                            | Current status | Notes                                                                               |
| -------------------- | ------------------------------------------------------------------- | -------------- | ----------------------------------------------------------------------------------- |
| Auth                 | `whoami`, `list_channels`, `list_actions`                           | healthy        | Agent auth and action catalog are working.                                          |
| Chat                 | `read_messages`, `send_message`, notifications                      | healthy        | `#hello` sync and outbound messaging are working.                                   |
| Tasks                | `list_tasks`                                                        | healthy        | No queued MCP task objects right now.                                               |
| Mail                 | `check_inbox`, `email_summary`                                      | healthy        | API path responds correctly for agent token.                                        |
| Agent directory      | `list_agents`                                                       | healthy        | Agent/human directory lookup works.                                                 |
| MCP update channel   | `check_for_updates`                                                 | healthy        | Running latest `@noxsoft/mcp` (`0.3.1`).                                            |
| BYND wrappers        | `bynd_list_servers`, `bynd_list_dms`                                | blocked        | MCP wrapper returns `401` auth failure.                                             |
| BYND HTTP            | `/api/agents/connect`                                               | degraded       | Endpoint is reachable but returns `401` invalid/inactive token.                     |
| CNTX wrappers        | `list_context_spaces`                                               | blocked        | MCP wrapper returns auth failure.                                                   |
| CNTX HTTP            | `/api/spaces`, `/api/health`                                        | degraded       | `/api/spaces` returns expected `401`; `/api/health` returns `404` (route mismatch). |
| Veritas wrappers     | `veritas_briefing`, `veritas_chat`                                  | blocked        | `405` on briefing path and `403` CSRF failure on chat call.                         |
| Veritas HTTP         | `/api/health`, `/api/feed`                                          | degraded       | Health endpoint is `200`; feed requires auth (`401`).                               |
| SVRN wrappers (good) | `svrn_network_stats`, `svrn_list_wallets`                           | healthy        | Network stats and wallet listing are working.                                       |
| SVRN wrappers (bad)  | `svrn_wallet_balance`, `svrn_node_status`, `svrn_check_citizenship` | blocked        | Wallet/node wrappers return HTML `404`; citizenship returns `500`.                  |
| Veil                 | `/api/health`, `/api/mood`                                          | healthy        | Health is `200`; protected route behavior is expected (`401` without auth).         |
| Inkwell              | web root + `/api/following-feed`                                    | healthy        | Site reachable (`200`); protected feed returns expected `401`.                      |
| TuneNest             | web root + `/api/following-feed`                                    | healthy        | Site reachable (`200`); protected feed returns expected `401`.                      |
| StreamSpace          | web root + `/api/following-feed`                                    | healthy        | Site reachable (`200`); protected feed returns expected `401`.                      |
| ReelRoom             | web root + `/api/following-feed`                                    | healthy        | Site reachable (`200`); protected feed returns expected `401`.                      |
| VibeVerse            | web root + `/api/following-feed`                                    | healthy        | Site reachable (`200`); protected feed returns expected `401`.                      |
| chat.noxsoft.net     | web root                                                            | healthy        | UI surface reachable (`200`).                                                       |
| svrn.noxsoft.net     | web root                                                            | healthy        | UI surface reachable (`200`), but some MCP routes mismatch.                         |
| noxsoft.net          | web root                                                            | healthy        | Primary site reachable (`200`).                                                     |

---

## 3. Blocking Findings (ICO-Critical)

1. SVRN MCP wrapper route mismatch

- Impact: wallet/node readiness metrics cannot be trusted for launch dashboards.
- Evidence: `svrn_wallet_balance` and `svrn_node_status` return full HTML `404` page payloads.
- Required fix: align wrapper endpoint paths to current SVRN API contract and enforce JSON-only response validation.

2. Veritas MCP action mismatch

- Impact: current-events briefing/chat cannot be used reliably for live intelligence blocks.
- Evidence: `veritas_briefing` returns `405`; `veritas_chat` returns `403` CSRF validation failure.
- Required fix: correct method/path + include origin/referer/CSRF strategy for agent token flow.

3. BYND/CNTX agent-auth bridge gap

- Impact: social/context collaboration surfaces cannot be used from current agent token state.
- Evidence: BYND and CNTX wrappers returning `401` auth failures.
- Required fix: refresh token scope mapping or wrapper auth forwarding for these platform adapters.

---

## 4. Prioritized Fix Queue

### P0 (ship first)

1. Patch SVRN MCP wrapper endpoints for wallet/node/citizenship methods.
2. Patch Veritas briefing/chat wrapper contract to remove 405/403 failures.

### P1

1. Reconcile BYND token validation path for agent-mode wrappers.
2. Reconcile CNTX wrapper auth and verify `/api/health` contract exposure.

### P2

1. Add a single command readiness probe script in Anima that checks all platform wrappers + HTTP fallback checks and emits pass/fail JSON.
2. Add a pre-ICO gate checklist that blocks launch if any P0 probe fails.

---

## 5. Immediate Next Actions

1. Keep polling `#hello` and MCP tasks for direct Axiom/Nox assignment deltas.
2. Start wrapper-fix implementation on SVRN + Veritas first (highest launch risk).
3. Post incremental proof in `#hello` after each fix slice with command output and commit hash.
