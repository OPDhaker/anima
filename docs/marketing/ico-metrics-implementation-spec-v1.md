# NoxSoft Public Metrics Implementation Spec v1

**Date:** 2026-03-15  
**Owner:** Resonant Signal (`Ju`)  
**Status:** Draft for engineering implementation

---

## 1. Purpose

Define one implementation contract for all public NoxSoft metric surfaces (homepage, launch page, status/product pages) so:

- data is real and source-bound,
- state handling is consistent (`live`, `delayed`, `stale`, `unavailable`),
- no page can silently show fabricated or placeholder values.

---

## 2. Scope

In scope:

- Metric identifiers, ownership, source systems, and refresh cadence.
- Aggregation and publish rules.
- API response schema for frontend consumption.
- UI state logic and fallback behavior.
- QA and release checklist.

Out of scope:

- Final visual design tokens.
- Vendor-specific implementation details for each data source.

---

## 3. Canonical Metric Catalog

| Metric ID          | Label              | Definition                                                   | Source of Truth                       | Cadence      | Owner               |
| ------------------ | ------------------ | ------------------------------------------------------------ | ------------------------------------- | ------------ | ------------------- |
| `newsletter_total` | Newsletter Signups | Total confirmed subscribers across active lists after dedupe | Email provider API + dedupe worker    | Hourly       | Growth Ops          |
| `users_total`      | Total Users        | Cumulative registered users (all time)                       | Identity/auth database                | Hourly       | Platform Ops        |
| `users_active_30d` | Active Users (30d) | Unique users with qualifying activity in trailing 30 days    | Product analytics event store         | Hourly       | Product Analytics   |
| `downloads_total`  | Product Downloads  | Cumulative downloads/installs per public product             | Release telemetry + distribution logs | Hourly       | Release Engineering |
| `agents_active`    | Active Agents      | Agents with successful heartbeat in last 24h                 | Agent network status index            | Every 15 min | Agent Platform      |
| `tasks_shipped_7d` | Tasks Shipped (7d) | Closed tasks with linked public artifacts in trailing 7 days | Task tracker + PR linkage job         | Hourly       | Program Ops         |

Rules:

- Do not add/remove metrics without updating this table.
- Every metric must have one named owner.
- If source ownership is unknown, metric state must be `unavailable`.

---

## 4. Aggregation and Publish Pipeline

### 4.1 Data Flow

1. Pull source values by metric ID.
2. Validate shape and type.
3. Apply normalization (timezone, dedupe, numeric coercion).
4. Persist aggregate snapshot with `captured_at`.
5. Publish API payload consumed by all public surfaces.

### 4.2 Snapshot Contract

Each publish run must write:

- `metric_id`
- `value` (number or `null`)
- `captured_at` (ISO 8601 UTC)
- `cadence_minutes`
- `source_status` (`ok` | `partial` | `error`)
- `error_code` (nullable)

### 4.3 Failure Rules

- If source fetch fails, preserve last known value and set `source_status=error`.
- Never emit invented fallback numbers.
- If no historical value exists and source fails, return `value=null` with `unavailable`.

---

## 5. API Schema (Public Metrics Feed)

Suggested endpoint:

- `GET /api/public/metrics`

Response shape:

```json
{
  "generatedAt": "2026-03-15T10:00:00Z",
  "metrics": [
    {
      "id": "users_total",
      "label": "Total Users",
      "value": 123456,
      "displayValue": "123,456",
      "capturedAt": "2026-03-15T09:56:01Z",
      "cadenceMinutes": 60,
      "state": "live",
      "ageMinutes": 3.98,
      "sourceStatus": "ok",
      "sourceRef": "identity-db",
      "errorCode": null
    }
  ]
}
```

State enum:

- `live`
- `delayed`
- `stale`
- `unavailable`

---

## 6. State Logic

Given:

- `age_minutes = now_utc - captured_at`
- `cadence = cadence_minutes`

State resolution:

1. If `value` is `null` OR `source_status=error` with no historical value -> `unavailable`.
2. Else if `age_minutes <= cadence` -> `live`.
3. Else if `age_minutes <= cadence * 3` -> `delayed`.
4. Else -> `stale`.

State copy:

- `live`: `Live now`
- `delayed`: `Delayed update`
- `stale`: `Stale data - refreshing`
- `unavailable`: `Data temporarily unavailable`

---

## 7. Frontend Rendering Requirements

All public surfaces must:

- Render metric label, value (or fallback copy), state badge, and `last updated`.
- Use exactly the shared state labels from this spec.
- Link to a source/about tooltip for metric definition.
- Prefer `displayValue` from API; never format from unknown string input.

Fallback rendering:

- `unavailable`: show `--` and state badge.
- `stale`: show last known numeric value plus stale badge and age.

Accessibility:

- State badge text must be visible and not color-only.
- Include `aria-label` on each metric tile with state + timestamp.

---

## 8. QA Checklist

- API never returns fabricated defaults.
- All metrics include `capturedAt`, `cadenceMinutes`, and `state`.
- State transitions are tested at cadence boundaries (`1x`, `3x` windows).
- Frontend displays `last updated` timestamp for every metric tile.
- `unavailable` state tested with hard source-failure simulation.
- Cross-page consistency: homepage, launch page, and status page render same values for same metric IDs.

---

## 9. Rollout Plan

Phase A:

- Ship feed schema and one surface (homepage).

Phase B:

- Reuse same API and components on launch page and status page.

Phase C:

- Add automated regression checks to prevent metric/state drift across surfaces.

---

## 10. Evidence and Linking

Related docs:

- `docs/marketing/ico-launch-page-copy-v1.md`
- `docs/plans/ico-litepaper-v1.md`
- `docs/plans/ico-whitepaper-v1.md`

Publication rule:

- If a metric claim appears in copy, it must map to a metric ID in this spec.
