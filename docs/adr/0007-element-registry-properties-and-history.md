# ADR 0007: Element registry, properties, and durable history

Status: accepted

Date: 2026-08-16

## Context

Phase 6 must replace the Canvas kernel's duplicated Element metadata with a
registry-driven Property Inspector, add real input and data-display Elements,
and render published Elements without exposing Draft changes. The source
specification does not fix Registry, Property, Runtime Page, or Undo/Redo API
shapes. It also assigns charts and presets to Phase 7, so the Phase 6 inventory
boundary must be explicit.

## Decision

- Phase 6 retains `text`, `button`, `container`, and `kpi-card`, and adds
  `number-input` and `data-table`. These six real types cover BASIC, INPUT,
  DATA, and the existing Canvas KPI slice. Charts, statistical data execution,
  and presets remain Phase 7 or later work.
- A versioned deterministic Registry is the serializable source for type,
  label, description, category, Lucide icon, defaults, layout limits, Property
  Schema, binding ports, events, render states, validation, and migrations.
  Editor and Runtime renderer registrations are executable projections of the
  same type inventory. Tests fail when Palette, Inspector, Inventory, Editor,
  Runtime, server validation, and SQLite type constraints drift.
- Registry reads use `GET /api/v1/elements/registry` and
  `GET /api/v1/elements/registry/:elementType`. Responses have stable ordering,
  schema version, and checksum and contain JSON metadata rather than component
  code or SVG markup.
- The Inspector uses the six canonical tabs: General, Style, Data,
  Interaction, Validation, and Advanced. Form controls are generated from
  stable Property field IDs. Writes send only Registry-declared fields through
  `PATCH /api/v1/elements/:elementId` with a `PROPERTIES` change. Unknown,
  read-only, malformed, non-finite, oversized, or prototype-sensitive values
  fail before mutation. Custom CSS and arbitrary object paths are not accepted.
- Element name, visibility, disabled state, lock state, tooltip, and accessible
  name use explicit Registry mappings to canonical Element columns or validated
  property records. Style values remain semantic and bounded; layout size is
  displayed from the layout record and continues to mutate through the Canvas
  layout contract.
- Registry defaults are overlaid beneath stored values at every server read,
  import, legacy published-snapshot read, and history replay boundary. This
  keeps sparse v4 records compatible while returning one canonical Property
  shape to the Editor and Runtime.
- Property input is locally drafted, debounced for 500 ms, and flushed on blur.
  The UI reports saving only while a request is active and saved only after the
  server response. A stale or failed write retains a visible retryable state and
  never reports success optimistically.
- Project-scoped Element history is durable and linear. Add, move, resize,
  batch layout, lock, delete, and property commands store sufficient before and
  after state for exact Undo/Redo. Undo preserves IDs and increments revisions;
  Redo reapplies the same logical result with new monotonic revisions. A new
  command after Undo marks the abandoned Redo branch discarded. Only successful
  commands enter history; deterministic error replay is not an undoable edit.
- History reads use `GET /api/v1/projects/:projectId/element-history`; commands
  use `POST .../element-history/undo` and `POST .../element-history/redo` with
  the expected Project revision, expected command ID, and idempotency key.
  Lifecycle operations never enter this stack.
- The latest immutable Project Version is the only Runtime Element source.
  `GET /api/v1/runtime/:projectId/pages/:pageId` returns its published Page and
  Element/layout snapshot. It never reads current Draft tables. Hidden Elements
  do not render, and Runtime never imports Editor selection, grid, handles,
  Inspector, or command controls.
- Until the Binding Engine exists, binding status is truthful:
  `NOT_APPLICABLE` for types without ports and `UNCONNECTED` for unbound ports.
  Connected, warning, and error states are renderer and schema capabilities but
  are not fabricated from sample data. Data renderers expose deterministic
  Empty, Loading, Error, and Data states for generated tests.
- Metadata migration v5 preserves migration v1–v4 SQL and checksums, expands
  Element type and command-history constraints, and adds idempotent history
  operation storage. Clone, export, and import preserve canonical Properties,
  layouts, and immutable published versions but intentionally start a new,
  empty command history so command IDs and replay keys never cross Project
  ownership. Trash and restore retain history; purge removes it by Project
  ownership. Checksum and publish continue to preserve the Element definition
  boundary.

## Consequences

The right Inspector becomes a real persisted editor instead of a summary, and
new Registry entries expand every required projection through generated
coverage. Undo/Redo and Runtime rendering add schema and test cost, but keep
Draft edits, immutable published versions, and lifecycle operations safely
separate.
