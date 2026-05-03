# Governance Proposal Lifecycle v1

**Date:** 2026-03-15  
**Owner:** Resonant Signal (`Ju`)  
**Status:** Draft for governance review

---

## 1. Purpose

This document defines a clear governance workflow for proposals in the NoxSoft ecosystem. The intent is to balance execution speed with accountability and safety.

---

## 2. Proposal Classes

### 2.1 Operational

- Scope: day-to-day process, documentation, and low-risk parameter changes.
- Risk level: low to medium.
- Expected cycle: short review and fast execution.

### 2.2 Economic

- Scope: tokenomics parameters, treasury policy, incentive design, distribution rules.
- Risk level: medium to high.
- Expected cycle: expanded review and explicit impact analysis.

### 2.3 Security

- Scope: controls, hardening policy, incident-response standards, access boundaries.
- Risk level: high.
- Expected cycle: security-owner review plus defined rollback conditions.

### 2.4 Constitutional

- Scope: governance rules, voting rights, quorum mechanics, core policy constraints.
- Risk level: highest.
- Expected cycle: longest review period with strict quorum and execution delay.

---

## 3. Lifecycle Stages

### Stage 0: Draft

Requirements:

- Problem statement and motivation.
- Proposed change and expected impact.
- Risk notes and fallback plan.

Exit criteria:

- Proposal completeness checklist is satisfied.

### Stage 1: Review

Requirements:

- Open comment window with stakeholders.
- Required reviewers based on proposal class are assigned.
- Conflicts, assumptions, and dependencies are documented.

Exit criteria:

- Reviewer sign-offs meet class-specific requirements.

### Stage 2: Vote

Requirements:

- Voting window and quorum threshold are published.
- Eligibility and delegated-vote snapshots are frozen.
- Voting interface and tally logic are validated.

Exit criteria:

- Quorum met and final tally resolved.

### Stage 3: Timelock

Requirements:

- Execution payload is finalized and verifiable.
- Timelock duration depends on proposal class.
- Emergency cancel path remains available for critical issues.

Exit criteria:

- Timelock elapses without valid cancellation.

### Stage 4: Execute

Requirements:

- Change is applied with audit logs.
- Operational owner confirms post-change checks.

Exit criteria:

- Execution event recorded with artifact links.

### Stage 5: Post-Review

Requirements:

- Measure intended vs actual outcomes.
- Document lessons, regressions, or follow-up actions.

Exit criteria:

- Post-review report published and linked to the original proposal.

---

## 4. Quorum and Approval Baselines (Draft)

- Operational proposals: standard quorum, simple majority.
- Economic proposals: elevated quorum, majority + impact disclosure required.
- Security proposals: elevated quorum plus security-owner concurrence.
- Constitutional proposals: highest quorum and supermajority threshold.

Final thresholds are defined in contract configuration and legal/governance ratification docs before launch.

---

## 5. Delegation Rules

- Delegation is opt-in and revocable.
- Delegates must disclose known conflicts for high-impact proposals.
- Delegated vote records remain transparent and auditable.
- Delegation snapshots are locked at vote-window start for determinism.

---

## 6. Emergency Governance Path

Use emergency path only for severe risk scenarios:

- Active exploit risk.
- Critical infrastructure compromise.
- Immediate legal/compliance exposure requiring urgent containment.

Emergency actions require:

- Justification record.
- Limited scope and explicit expiry.
- Mandatory post-action review and ratification vote.

---

## 7. Transparency Requirements

Every proposal should publish:

- Author, class, and ownership.
- Impact summary and risk statement.
- Voting window, quorum, and final tally.
- Execution artifact links (PRs, commits, docs, config diffs).
- Post-review outcome report.

---

## 8. Open Items

- Final quorum/supermajority percentages per proposal class.
- Timelock durations per class.
- Delegation cap and anti-capture safeguards.
- Appeal path for contested outcomes.
