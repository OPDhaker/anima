# NoxSoft ICO Incident Response v1

**Date:** 2026-03-15  
**Owner:** Resonant Signal (`Ju`)  
**Status:** Draft for ops and security review

---

## 1. Purpose

This document defines the incident response process for ICO-related systems and supporting operations. The goal is to contain impact quickly, preserve trust through accurate communication, and recover safely with verifiable follow-through.

---

## 2. Scope

Incident response applies to:

- ICO platform applications, APIs, and gateway services.
- Smart-contract-adjacent operational controls and event pipelines.
- Verification/compliance integrations and participant support channels.
- Security incidents affecting treasury, credentials, deployment, or governance controls.

---

## 3. Severity Levels

| Severity         | Description                                                                            | Target Initial Response | Executive Notification |
| ---------------- | -------------------------------------------------------------------------------------- | ----------------------- | ---------------------- |
| Sev-0 (Critical) | Active exploit, funds at risk, systemic outage, or high-confidence compromise          | 15 minutes              | Immediate              |
| Sev-1 (High)     | Major degraded functionality, high-risk vulnerability exposure, or sensitive data risk | 30 minutes              | Within 30 minutes      |
| Sev-2 (Medium)   | Material issue with limited blast radius and clear workaround                          | 2 hours                 | Within business day    |
| Sev-3 (Low)      | Minor security/ops issue with low immediate risk                                       | 1 business day          | Optional summary       |

Severity can be escalated or reduced as evidence evolves.

---

## 4. Roles and Responsibilities

- Incident Commander (IC): owns coordination, decisions, and timeline discipline.
- Security Lead: drives triage, containment strategy, and technical investigation.
- Platform Lead: executes production changes and recovery operations.
- Communications Lead: coordinates internal/external updates and approval flow.
- Compliance/Legal Liaison: validates statements for regulatory and policy-sensitive incidents.
- Scribe: records timeline, decisions, evidence links, and action items.

When staffing is constrained, one person may cover multiple roles except IC and Scribe, which should remain distinct when possible.

---

## 5. Lifecycle

### 5.1 Detect and Declare

- Trigger sources: monitoring alerts, anomaly detection, user reports, audit findings, or partner/vendor notification.
- Open incident channel and assign IC immediately.
- Create incident record with timestamp, suspected scope, and current severity.

### 5.2 Triage and Classify

- Validate whether the event is security, reliability, abuse, or mixed.
- Estimate blast radius: affected users, systems, data classes, financial exposure.
- Capture known facts vs assumptions to avoid premature conclusions.

### 5.3 Contain

- Isolate impacted components (feature flag, rate limits, route disablement, service segmentation).
- Revoke/rotate exposed credentials and invalidate compromised sessions.
- Trigger emergency controls (pause flows, safe mode) when required.

### 5.4 Eradicate

- Remove malicious artifacts or vulnerable configurations.
- Patch root causes and apply compensating controls where full fix takes longer.
- Validate that vulnerable paths are no longer reachable.

### 5.5 Recover

- Restore service in controlled steps with explicit health gates.
- Monitor for recurrence, side effects, and user impact drift.
- Keep incident state open until stabilization criteria are met.

### 5.6 Post-Incident Review

- Publish timeline, root cause, impact, and corrective actions.
- Assign owners and due dates for all follow-up tasks.
- Track remediation to closure with evidence links.

---

## 6. Communication Protocol

### 6.1 Internal

- Use a dedicated incident channel with timestamped updates.
- Update cadence:
  - Sev-0: every 15 minutes
  - Sev-1: every 30 minutes
  - Sev-2/3: milestone-based
- Keep updates factual: impact, actions taken, next decision point, blockers.

### 6.2 External

- External updates must be approved by IC + Communications Lead (and legal/compliance for sensitive incidents).
- Publish only verified information; avoid speculative root-cause claims.
- Include user-facing guidance where action is required (for example, key rotation, retry windows, phishing caution).

### 6.3 Message Template (Short Form)

- What happened: concise factual summary.
- Impact: who/what is affected.
- What we are doing now: active containment/recovery actions.
- Next update: timestamp or condition.

---

## 7. Evidence and Forensics

- Preserve logs and relevant artifacts before modifying affected systems.
- Maintain chain-of-custody notes for high-severity incidents.
- Snapshot configs, deployments, and auth events tied to the event window.
- Store evidence references in the incident record for auditability.

---

## 8. Recovery Gates

Required before incident closure:

- Root cause identified or constrained with accepted residual risk.
- Containment verified and no active exploit path observed.
- Service health metrics returned to defined baseline.
- Required public/internal communications sent.
- Remediation backlog created with owners and deadlines.

---

## 9. SLA Targets (Draft)

- Sev-0 remediation plan published within 4 hours.
- Sev-1 remediation plan published within 24 hours.
- Post-incident report:
  - Sev-0/1 within 5 business days
  - Sev-2/3 within 10 business days
- Critical remediation backlog reviewed weekly until closure.

---

## 10. Drills and Readiness

- Run incident simulation exercises at least monthly for launch-critical pathways.
- Include one social-engineering scenario and one infrastructure-failure scenario per quarter.
- Verify on-call rotation, escalation contacts, and fallback communication channels.
- Record drill outcomes and track corrective tasks to closure.

---

## 11. Open Items

- Finalize named role roster and backup roster.
- Confirm legal/compliance review hooks by jurisdiction.
- Add automated incident ticket generation integration.
- Align severity mapping with final public status page taxonomy.
