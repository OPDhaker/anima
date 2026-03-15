# ICO Launchpad Selection v1

**Date:** 2026-03-15  
**Owner:** Resonant Signal (`Ju`)  
**Status:** Proposed recommendation for immediate execution

---

## 1. Decision Inputs

Captured direction from the active `#hello` lane:

- Use an existing launchpad path for fastest execution.
- Keep platform behavior custom and MCP-native where required.
- Public stats must be real, source-bound, and state-aware (no fabricated values).
- Prefer immediate execution over long vendor onboarding cycles.

---

## 2. Selection Criteria

Primary criteria used for this decision:

- Data integrity: can we publish only source-bound metrics with explicit state handling.
- MCP integration fit: can this run cleanly with NoxSoft MCP and Anima gateway methods.
- Time to go live: shortest path to a public, auditable launch surface.
- Control and flexibility: ability to enforce our own policy/compliance and UX behavior.

---

## 3. Options Reviewed

### Option A: Anima Native Launch Platform (existing internal platform)

Current base already exists in code:

- `src/ico/launch-platform.ts`
- `src/ico/public-metrics.ts`
- `src/gateway/server-methods/ico.ts`
- `ui/src/pages/ICO.tsx`

Strengths:

- Highest control over compliance rules, UX, and metric state semantics.
- Direct MCP/gateway compatibility with no connector gap.
- Already aligned to the "no fake numbers" constraint via state-aware feeds.
- Fastest execution because core building blocks are already in the repository.

Tradeoff:

- Requires us to keep shipping product hardening internally.

### Option B: Third-Party Hosted Launchpad

Strengths:

- Potentially faster traffic access from existing platform users.

Tradeoffs:

- Lower control on metric semantics, policy boundaries, and custom behavior.
- Integration overhead to keep stats source-bound and consistent with our gateway model.
- Vendor dependency risk for future roadmap changes.

### Option C: Exchange-Led Launch Path (later-stage route)

Strengths:

- Distribution upside after maturity.

Tradeoffs:

- Not a fast go-live path for the current sprint.
- Higher external dependency/compliance coordination overhead.

---

## 4. Recommendation

Choose **Option A: Anima Native Launch Platform** as the primary launchpad for this phase.

Why this is the best fit now:

- It is already implemented enough to execute immediately.
- It preserves strict real-data requirements and state-aware publishing.
- It is the cleanest path for MCP-native automation and future extensibility.
- It avoids introducing external platform constraints while we are still iterating quickly.

Secondary strategy:

- Re-evaluate Option B/C only after internal launchpad hardening and stable public metrics cadence are complete.

---

## 5. Immediate Execution Plan (Next 24-48 Hours)

1. Lock this decision in `#hello` and treat Anima launch platform as default.
2. Complete homepage/public-surface metric wiring using the existing state model (`live`, `delayed`, `stale`, `unavailable`).
3. Add launch-readiness checks for source ownership, refresh cadence, and fallback behavior.
4. Publish a short "how launch stats are derived" operator note for transparency.

---

## 6. Open Adjacent Track

The "browser-controlled agent desktop" request (AnyDesk-like control via browser) is a separate product track and should run as a parallel feature stream after the launchpad decision is locked.
