# NoxSoft ICO Launch Page Copy Blocks v1

**Date:** 2026-03-15  
**Owner:** Resonant Signal (`Ju`)  
**Status:** Draft for implementation

---

## 1. Purpose

This document converts the litepaper into production-ready copy blocks for homepage and launch-page surfaces.

Primary requirement:

- Every public stat must be real, source-defined, and state-aware (`live`, `delayed`, `stale`, or `unavailable`).

---

## 2. Voice and Guardrails

Voice:

- Human + AI future, utility-first, execution-focused.
- Confident but evidence-backed.

Guardrails:

- No equity language.
- No guaranteed return language.
- No unverifiable performance claims.

---

## 3. Homepage and Launch Page Blocks

### Block A: Hero

Headline options:

- `Build the Human + AI Network That Ships in Public`
- `Run AI-Native Workflows With Real Ownership and Real Proof`

Subheadline:

- `NoxSoft connects communication, automation, and compute into one interoperable ecosystem with transparent progress and measurable impact.`

Primary CTA:

- `Read the Whitepaper`

Secondary CTA:

- `Track Live Progress`

---

### Block B: Proof Strip (Directly Under Hero)

Title:

- `Proof, Not Promises`

Body:

- `Every major claim should map to a public artifact: commits, pull requests, docs, and test evidence.`

Proof link labels:

- `Whitepaper v1`
- `Litepaper v1`
- `Architecture Appendix`
- `Security Appendix`
- `Live PR Feed`

---

### Block C: Stats Wall (Real and State-Aware)

Title:

- `Measured Impact`

Intro copy:

- `These numbers update from defined sources. If data is delayed or unavailable, the UI shows that state explicitly.`

#### Required Metrics

| Metric ID          | Label              | Definition                                             | Source of Truth                       | Refresh Cadence |
| ------------------ | ------------------ | ------------------------------------------------------ | ------------------------------------- | --------------- |
| `newsletter_total` | Newsletter Signups | Total confirmed subscribers across all active lists    | Email provider API + dedupe job       | Hourly          |
| `users_total`      | Total Users        | Cumulative registered users (all-time)                 | Auth/identity DB                      | Hourly          |
| `users_active_30d` | Active Users (30d) | Unique users with activity in last 30 days             | Product analytics event store         | Hourly          |
| `downloads_total`  | Product Downloads  | Cumulative downloads/installs by product               | Distribution logs + release telemetry | Hourly          |
| `agents_active`    | Active Agents      | Agents with successful heartbeat in last 24h           | Agent network status index            | Every 15 min    |
| `tasks_shipped_7d` | Tasks Shipped (7d) | Closed work items with linked artifacts in last 7 days | Task tracker + PR linkage             | Hourly          |

#### Display State Rules

- `live`: data updated within the metric cadence window.
- `delayed`: update is late but still within 3x cadence.
- `stale`: older than 3x cadence; show age badge.
- `unavailable`: fetch failed or source missing; show fallback text, not fake numbers.

State microcopy:

- `live`: `Live now`
- `delayed`: `Delayed update`
- `stale`: `Stale data - refreshing`
- `unavailable`: `Data temporarily unavailable`

---

### Block D: Token and Compliance Summary

Title:

- `Utility-First Token Design`

Body:

- `The NoxSoft token is designed as a revenue-aligned utility and governance mechanism. It is not equity, and participation is subject to legal and jurisdictional rules.`

Link CTAs:

- `Read Tokenomics Draft`
- `Read Participation Policy`

---

### Block E: Roadmap Snapshot

Title:

- `Execution Roadmap`

Copy:

- `Foundation (0-3 months): hardening, docs, security baseline.`
- `Launch Readiness (3-6 months): audits, controls, operations.`
- `Expansion (6-12 months): integrations, contributors, ecosystem growth.`
- `Decentralized Operations (12+ months): governance maturity and transparent policy execution.`

CTA:

- `View Full Roadmap`

---

### Block F: Final CTA Rail

Headline:

- `Build With Us`

Body:

- `Follow progress, review artifacts, and contribute to a Human + AI ecosystem that prioritizes resilience, transparency, and shared upside.`

Buttons:

- `Explore Docs`
- `Join Community`
- `View GitHub`

---

## 4. Implementation Notes

- Treat the stats wall as a reusable component across all public sites.
- Use the same metric IDs and state labels on every surface to prevent drift.
- Show `last updated` timestamps for each metric tile.
- Link every proof-strip item to a public artifact URL.

---

## 5. QA Checklist

- Hero and CTA copy matches legal/compliance constraints.
- Stats display never shows placeholder or fabricated values in production.
- State badges render correctly (`live`, `delayed`, `stale`, `unavailable`).
- Every shown metric has a source owner and refresh job.
- Links in proof strip resolve to public docs/PR/commit artifacts.
