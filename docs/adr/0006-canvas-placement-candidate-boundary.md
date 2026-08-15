# ADR 0006: Canvas placement candidate and drag boundary

Status: accepted

Date: 2026-08-16

## Context

Phase 5 must place Palette Elements on a 24-column Canvas, show the final
snapped position and size before drop, resolve collisions, support movement and
all eight resize directions, and persist the resulting layout. Palette drag is
owned by dnd-kit while Canvas layout is owned by react-grid-layout; sharing
their transient state would make Page reorder and Element placement interfere.
Recomputing a drop after preview could also move the Element by one or more grid
units when another layout mutation occurs.

## Decision

- Draft Elements use stable UUIDs and Project/Page foreign keys in metadata
  SQLite. Desktop layout stores integer `x`, `y`, `w`, and `h` values against a
  Page-scoped layout revision. The schema reserves tablet and mobile
  breakpoints, but Phase 5 edits only the 24-column desktop layout.
- Canvas constants are 24 columns, 8 px row height, 8 px gap, and 16 px padding.
  The browser corrects zoom and scroll and sends a Canvas-local pointer plus the
  measured content width and height. Both dimensions must be finite and between
  240 and 100,000 px. The server owns grid conversion, registry default and
  limit resolution, horizontal clamping, deterministic nearest free-space
  collision resolution, and vertical compaction of a new placement.
- Candidate validity covers all four Canvas edges. The pointer must remain in
  `[0, canvasWidth] × [0, canvasHeight]`, and the final compacted Element must
  also fit vertically. Its lower pixel boundary is calculated as
  `padding + y × (rowHeight + gap) + h × rowHeight + (h - 1) × gap + padding`.
  The measured height is stored only in the transient candidate snapshot and is
  checked again when the candidate is consumed; it is not accepted from the
  commit request or exposed as persisted Element state.
- `POST /api/v1/pages/:pageId/placement-candidates` never writes SQLite or
  Project files. It returns the final `candidateId`, `x`, `y`, `w`, `h`,
  validity, collision result, layout revision, and expiry. Candidates live only
  in a 512-entry, 15-second server cache and are bound to Project, Page, Element
  type, default-size snapshot, Project revision, and layout revision.
- `POST /api/v1/pages/:pageId/elements/from-placement` accepts the candidate ID,
  expected revisions, and an idempotency key, but no client-provided geometry.
  It consumes one valid candidate atomically. Expired, stale, invalid,
  cross-Page, reused under a different operation, or otherwise mismatched
  candidates fail closed. A completed idempotent request replays its stored
  result even after candidate consumption.
- Element mutations are single SQLite transactions. Successful results and
  deterministic 4xx command failures are stored for exact idempotent replay;
  transient 5xx failures roll back without poisoning the key so a safe retry
  can succeed.
- The canonical Element mutation routes remain the Phase 5 write contract.
  `PATCH /api/v1/elements/:elementId` persists move, resize, and lock state;
  `POST /api/v1/elements/batch-layout` persists one validated atomic layout
  command. `GET /api/v1/pages/:pageId/elements` is added as the read-side
  counterpart required for reload and restart recovery.
- The Phase 5 kernel exposes four real Element types: `text`, `button`,
  `container`, and `kpi-card`. Direct create is reserved for programmatic and
  later preset generation; user Palette placement always uses a placement
  candidate.
- App-level Editor state owns the latest Project revision. Page and Canvas
  features report successful revisions to that owner rather than maintaining
  divergent optimistic revision sources. A Page layout revision independently
  invalidates stale placement candidates.
- dnd-kit owns Palette drag sensors and the dangling DragOverlay. A controlled
  react-grid-layout instance owns placed Element movement and resizing. It uses
  `noCompactor` while rendering controlled server coordinates, so mounting the
  Canvas cannot silently move persisted Elements. Drag, resize, and keyboard
  movement explicitly run the vertical compactor once and persist the complete
  resulting layout in one atomic batch. The bridge between dnd-kit and the
  Canvas is only the server-issued placement candidate; Page reorder sensors
  never enter the Canvas layout engine.
- Phase 5 registers only the small real Canvas-kernel inventory needed to prove
  layout behavior. The complete Element Registry, schema-driven properties,
  render states, and user-facing Undo/Redo workflow remain Phase 6 work. Phase 5
  still records idempotent layout commands so later Undo/Redo can use durable
  before/after geometry.
- Project clone, export, import, trash, restore, purge, checksum, and immutable
  publish snapshots include Element ownership and layout data. Draft Element
  changes do not mutate an already published version.

## Consequences

Preview geometry and committed geometry have one server-owned source of truth,
and drag-over traffic cannot create autosave storms. Stale concurrent edits are
visible as revision conflicts instead of silent relocation. The Phase 6
Registry can extend the same size and renderer contract without replacing the
Canvas kernel or persistence model.
