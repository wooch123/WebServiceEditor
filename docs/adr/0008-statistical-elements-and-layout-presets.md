# ADR 0008: Statistical elements and layout preset instances

Status: accepted

Date: 2026-08-16

## Context

Phase 7 must add the first statistical renderers and turn Layout Presets into
real, inspectable Page content. The source specification requires Preview
before Apply, Replace/Add choices, real Elements, binding placeholders, and
durable Preset instances, but it does not define Preset APIs, preview lifetime,
history ownership, or persistence. The prose names 17 minimum Presets while the
canonical corpus fixes 22 layout-preset IDs. ADR 0002 requires the larger
canonical inventory to win rather than silently shrinking coverage.

## Decision

- Phase 7 adds exactly `line-chart`, `bar-chart`, `histogram`, `scatter-plot`,
  `box-plot`, and `summary-statistics` after the six Phase 6 Registry types.
  The resulting ordered Registry has 12 real Element types. Other statistical
  and collaboration types remain later-phase work.
- Statistical definitions declare semantic properties, bounds, required input
  ports, events, and `EMPTY`, `LOADING`, `ERROR`, and `DATA` render states.
  Persisted Elements never contain demo datasets. Until the Binding Engine
  exists, required ports report `UNCONNECTED` and render a truthful empty state.
- Editor and Published Runtime use the same Registry projection and semantic
  theme tokens. Charts are responsive, expose an accessible text equivalent,
  disable animation for reduced motion, and use a lightweight resize preview
  before the final full render. Draft changes remain absent from an immutable
  published version until republish.
- The canonical Layout Preset inventory is the corpus order of 22 IDs:
  `analysis-dashboard`, `blank-grid`, `board`, `chat`,
  `comparison-dashboard`, `correlation-analysis`, `data-browser`,
  `data-entry`, `data-table`, `distribution-analysis`,
  `executive-dashboard`, `experiment-comparison`, `form`, `kpi-dashboard`,
  `master-detail`, `monitoring-dashboard`, `quality-dashboard`,
  `regression-analysis`, `report`, `settings`, `spc-dashboard`, and
  `trend-analysis`. Every definition has a stable version and checksum and at
  least one real Element template with exact grid coordinates. Preview artwork
  is generated from that structure; screenshot-only templates are forbidden.
- Preset reads use `GET /api/v1/layout-presets` and
  `GET /api/v1/layout-presets/:presetId`. Definitions may contain a read-only
  suggested schema. Phase 7 may display that proposal but never creates,
  changes, or deletes a runtime Database table; schema execution begins in
  Phase 8.
- Preview uses
  `POST /api/v1/pages/:pageId/layout-presets/:presetId/preview` with `ADD` or
  `REPLACE` and expected layout and Project revisions. It performs no durable
  write. A server-owned snapshot contains the exact proposed Elements,
  deletions, required-port placeholders, impact, warnings, and coordinate
  checksum. Snapshots are bound to Project, Page, Preset ID/version/checksum,
  mode, and revisions in a 256-entry, five-minute cache.
- Apply uses
  `POST /api/v1/pages/:pageId/layout-presets/:presetId/apply` and accepts only
  the preview ID, expected revisions, and idempotency key. It consumes the exact
  snapshot atomically; clients cannot submit replacement coordinates, Element
  types, or impact data. Completed replay is checked before snapshot
  consumption. Expired, stale, reused, cross-Page, cross-Preset, or mismatched
  previews fail closed.
- `ADD` deterministically translates the entire template below existing Page
  content and resolves collisions without changing relative template geometry.
  `REPLACE` uses canonical coordinates, reports all removals before Apply, and
  refuses to remove locked Elements. Both modes increment Project and layout
  revisions once and record one `PRESET_APPLY` history command.
- Metadata migration v6 preserves all v1-v5 SQL and checksums. It adds durable
  `layout_preset_instances`, stable template-to-Element membership, and
  required-port placeholder records with composite Project/Page ownership.
  Placeholder records are requirements in state `UNCONNECTED`; they are not
  executable Binding or Edge records.
- `GET /api/v1/pages/:pageId/layout-preset-instances` exposes the Page-owned
  provenance needed for reload and audit. Every Preview item and stored member
  carries its stable template ID, and the canonical template/Element/type/grid
  tuple hashes to the same coordinate checksum before and after Apply.
- A Preset instance and its generated membership remain queryable after reload
  and restart. Undo, Redo, and discarded Redo branches synchronize instance
  state and restore the exact before/after Page snapshot with stable Element
  IDs. Clone, export, and import remap instance, membership, Element, and Page
  ownership consistently. Trash and restore retain them; purge removes them by
  Project ownership without orphans.
- Preset application affects Draft metadata only. Preview and Apply never
  mutate an already published version, runtime data tables, or unrelated Pages.
  Failure, revision conflict, or injected interruption rolls back Elements,
  layouts, placeholders, instances, history, audit, and revisions together.

## Consequences

Preset Preview and Apply share one authoritative structural snapshot, so the
rendered proposal, stored instance, and undoable command cannot drift. Durable
provenance and truthful placeholders add schema and lifecycle work, but leave
the future Database Designer and Binding Engine clear ownership boundaries.
