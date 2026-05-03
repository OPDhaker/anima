# ICO Participation Policy v1 (Draft)

**Date:** 2026-03-15  
**Owner:** Resonant Signal (`Ju`)  
**Status:** Draft for legal review

---

## 1. Scope

This policy defines baseline participation controls for NoxSoft ICO flows. It is an operational draft and does not replace jurisdiction-specific legal advice.

---

## 2. Core Principles

- Compliance by design: eligibility checks are part of system behavior, not manual exceptions.
- Transparency: participant-facing rules should be understandable before funds are committed.
- Least-privilege data handling: only collect compliance data needed for required controls.
- Change control: policy updates must be versioned and communicated before enforcement.

---

## 3. Eligibility Framework (Draft)

Participation checks should include:

- Jurisdiction screening against restricted-region policy.
- KYC identity verification through an approved provider.
- AML and sanctions screening before allocation finalization.
- Age and legal capacity confirmation where required by law.

Restricted flows:

- Participants in disallowed jurisdictions must be blocked from sale paths.
- Failed verification states must prevent purchase execution until cleared.

---

## 4. Data Handling Boundaries

- Store only required compliance records for legal and audit needs.
- Encrypt sensitive records in transit and at rest.
- Limit access to authorized compliance operators with audit logging enabled.
- Apply retention and deletion policies based on regulatory minimums.

---

## 5. Disclosure Requirements

Before participation, provide:

- Plain-language risk disclosure.
- Token utility and governance description.
- Non-equity clarification.
- Jurisdiction and eligibility limitations.
- Refund/cancellation policy where applicable.

---

## 6. Operational Controls

- Verification gating in purchase flow (`verify -> authorize -> execute`).
- Rate limits and abuse controls on compliance endpoints.
- Incident path for false positives, blocked participants, and provider outages.
- Manual review queue with SLA targets for resolution.

---

## 7. Exceptions and Escalation

- Exceptions require explicit approval from compliance + legal owners.
- Exception requests must include rationale, evidence, and expiry window.
- Emergency override actions must be logged and post-reviewed.

---

## 8. Versioning and Review Cadence

- Version every policy update with date and owner.
- Revalidate this policy on major jurisdiction, provider, or launch-structure changes.
- Run a monthly compliance readiness check during active ICO phases.

---

## 9. Open Items for Counsel

- Final jurisdiction matrix and restricted-list definitions.
- Provider selection and contractual controls for KYC/AML.
- Data retention period per jurisdiction.
- Public disclosure language for participant rights and dispute pathways.
