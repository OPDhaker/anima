# NoxSoft ICO Threat Model v1

**Date:** 2026-03-15  
**Owner:** Resonant Signal (`Ju`)  
**Status:** Draft for security review

---

## 1. Purpose

This document defines the baseline threat model for NoxSoft ICO-related systems and operational workflows. It is intended to guide control design, testing priorities, and incident preparedness before launch.

---

## 2. Scope

Systems and workflows in scope:

- ICO web surfaces (public pages, purchase flow, wallet connection, verification pages).
- API and gateway pathways that process purchase, eligibility, and status events.
- Smart-contract-adjacent execution paths (sale triggers, treasury operations, event handling).
- Off-chain support systems (KYC/AML pipelines, notifications, analytics, dashboards).
- Operational controls (access management, deployment pipelines, secrets, change approval).

Out of scope for this draft:

- Deep protocol proofs of third-party chains.
- Vendor internal controls beyond our integration boundaries.

---

## 3. Security Objectives

- Preserve participant funds and transaction integrity.
- Preserve policy integrity for eligibility and compliance decisions.
- Preserve service availability during launch and high-volume periods.
- Preserve confidentiality of sensitive data (KYC/AML, identity, operational credentials).
- Preserve governance and treasury action integrity.

---

## 4. High-Value Assets

- Treasury custody controls (multi-sig permissions and policy controls).
- Token sale transaction paths and event logs.
- KYC/AML data and verification outcomes.
- API keys, signing keys, webhook secrets, and deployment credentials.
- Governance and configuration authority for launch parameters.
- Public trust artifacts (status, incident communication, progress evidence).

---

## 5. Threat Actors

- External attackers targeting funds, data, or operational disruption.
- Opportunistic abusers (bots, fraud rings, phishing operators, credential stealers).
- Sophisticated adversaries exploiting launch visibility and social pressure.
- Insider threat and privileged misuse (malicious or negligent).
- Supply-chain attackers targeting dependencies, CI, or release artifacts.

---

## 6. Attack Surface Map

### 6.1 Application Layer

- Input handling in purchase, verification, and support endpoints.
- Session/auth boundaries for admin and operator interfaces.
- Abuse vectors: injection, brute-force, spoofing, replay, and data scraping.

### 6.2 Contract and Transaction Layer

- Sale logic abuse, parameter manipulation, and edge-case execution paths.
- Transaction ordering and front-running-related abuse.
- Privileged function misuse and emergency controls abuse.

### 6.3 Infrastructure Layer

- DDoS or traffic-flood disruption.
- Misconfigured gateway, storage, or networking boundaries.
- Secrets exposure through logs, CI artifacts, or build pipeline compromise.

### 6.4 Human and Process Layer

- Social engineering against operators and support staff.
- Impersonation in public channels and spoofed announcement links.
- Weak change management under time pressure.

---

## 7. Risk Register (v1)

| Risk ID | Scenario                                   | Impact      | Likelihood | Initial Rating | Primary Controls                                                             |
| ------- | ------------------------------------------ | ----------- | ---------- | -------------- | ---------------------------------------------------------------------------- |
| R-001   | Purchase endpoint abuse (automation/fraud) | High        | Medium     | High           | Rate limiting, CAPTCHA, bot detection, transaction anomaly monitoring        |
| R-002   | Privileged key or secret compromise        | Critical    | Medium     | Critical       | Secret rotation, scoped credentials, hardware-backed custody, access reviews |
| R-003   | Smart-contract logic exploit               | Critical    | Low-Med    | Critical       | Multi-audit path, invariant tests, emergency pause, timelock guards          |
| R-004   | KYC/AML data leak                          | High        | Medium     | High           | Encryption, least privilege, retention controls, audit logging               |
| R-005   | Infrastructure outage during launch        | High        | Medium     | High           | Redundancy, health checks, fallback providers, runbook drills                |
| R-006   | Governance/treasury action misuse          | Critical    | Low-Med    | High           | Multi-sig, separation of duties, policy approvals, transparent audit trail   |
| R-007   | Phishing/impersonation campaign            | Medium-High | High       | High           | Verified channels, signed announcements, user education, abuse reporting     |
| R-008   | Supply-chain compromise in dependencies    | High        | Medium     | High           | Dependency scanning, lockfile hygiene, signed releases, staged rollout       |

Ratings are relative and will be refined as control maturity and testing evidence improve.

---

## 8. Control Catalog

### 8.1 Preventive Controls

- Strong authentication and role-based access on all privileged surfaces.
- Strict input validation and canonicalization on external interfaces.
- Rate limits, anti-automation controls, and abuse throttles.
- Secrets management with scoped tokens and rotation policy.
- Multi-sig + timelock for high-impact treasury and governance actions.

### 8.2 Detective Controls

- Structured audit logs for auth, policy decisions, and critical state changes.
- Real-time monitoring for anomaly detection (traffic, purchase patterns, auth drift).
- Contract event monitoring with alerting for unusual flows.
- Integrity checks in CI/CD and dependency vulnerability scanning.

### 8.3 Corrective Controls

- Emergency pause and containment workflows.
- Credential revocation and forced secret rotation.
- Verified incident communication procedures.
- Recovery runbooks with explicit rollback criteria.

---

## 9. Validation and Assurance Plan

- Maintain a recurring threat-model review cadence as architecture changes.
- Run static analysis, dependency scans, and configuration checks in CI.
- Execute abuse-path and resilience tests for launch-critical endpoints.
- Track remediation SLA by severity and publish closure evidence internally.
- Align final pre-launch sign-off with audit findings and unresolved-risk acceptance.

---

## 10. Open Items

- Final severity taxonomy alignment with incident response policy.
- Confirm exact ownership map for each high-risk control.
- Confirm launch-day escalation contacts and alternate communication lanes.
- Add architecture diagram references once security-reviewed diagrams are finalized.
