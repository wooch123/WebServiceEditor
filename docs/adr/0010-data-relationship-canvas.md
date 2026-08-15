# ADR 0010: Data Relationship Canvas and Binding boundary

Status: accepted

Date: 2026-08-16

## Context

Phase 9 projects Page, Element, Table, and Field metadata onto a class-diagram
Canvas. A visual connection must be exactly one durable Binding record. The
source specification requires directional ports, compatibility validation,
connection previews, deletion, and Undo/Redo, but does not define the preview
trust boundary or a lifecycle-safe export format.

## Decision

- Metadata migration v8 stores one graph-revision row per Project, Binding
  records, Binding commands, and history operations. Source endpoints are
  always right-side outputs and target endpoints are always left-side inputs;
  SQLite constraints reject reversed and duplicate active endpoint pairs.
- The graph is a read model built from active Page, Element, Table, and Field
  definitions. Phase 9 uses deterministic positions. User-controlled node
  positions, automatic layout, and advanced orthogonal routing belong to Phase 10.
- Port IDs are deterministic from the stable object ID, semantic role,
  direction, and index. Page, Element, and Table nodes expose only ports allowed
  by their canonical metadata or Element Registry definition.
- Phase 9 supports `CONTAINS`, `READ`, `CREATE`, `UPDATE`, `DELETE`, `FILTER`,
  `NAVIGATE`, and `RELATION`. Binding execution and real sample-data validation
  remain Phase 11 work; Phase 9 never fabricates runtime results.
- A connection preview is server-owned, expires after 15 seconds, and is kept
  in a bounded 512-entry cache. It is bound to Project, endpoints, graph
  revision, and Project revision. Create accepts the preview ID and Binding type
  only; client-supplied endpoint, query, or mapping data cannot bypass preview
  validation.
- Every rendered Edge is the Binding DTO itself. The Editor may derive only its
  path and label from that record. There is no separate visual-edge persistence
  model.
- Binding create, patch, delete, Undo, and Redo are optimistic, idempotent, and
  atomic. They advance the Project and graph revisions once, keep stable Binding
  IDs across history operations, and discard an abandoned Redo branch after a
  new mutation.
- Query and mapping objects are server-generated on create. Later patches are
  bounded JSON objects and reject executable or raw-query keys such as SQL,
  JavaScript, script, and code.
- Clone and export/import preserve Binding topology while remapping Binding,
  Page, Element, Table, Field, port, query, and mapping identifiers. Project
  trash/restore preserves the definition checksum; purge removes all owned
  relationship records through the existing lifecycle boundary.
- The Editor provides a separate `관계` view beside `스키마`. It renders Page,
  Element, and Table cards, left/right ports, a server-validated connection
  preview, labelled arrow Edges, and delete/Undo/Redo controls. Same-level
  controls share geometry and the graph viewport owns overflow on narrow
  screens.

## Consequences

Invalid or stale connections are rejected before a Binding row exists, and a
visible Edge can always be audited back to exactly one record. Phase 10 can add
persisted node positions and routing without changing Binding identity or the
connection protocol.
