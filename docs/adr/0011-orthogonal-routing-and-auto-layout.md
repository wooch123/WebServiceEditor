# ADR 0011: Orthogonal routing and automatic relationship layout

Status: accepted

Date: 2026-08-16

## Context

Phase 10 adds free Node movement, persisted viewport state, obstacle-avoiding
orthogonal Edges, and preview-before-apply automatic layout to the Phase 9
Binding-backed relationship graph. The source specification fixes left input
and right output sides, 16px horizontal endpoint stubs, 12px Node clearance,
small rounded bends, ELK layered layout, pinned Nodes, and one undoable command
for an applied automatic layout.

## Decision

- Metadata migration v9 stores Project-owned Node positions, pin state,
  viewport, layout commands, and layout history operations. Position changes
  advance graph and Project revisions; viewport changes are local-user view
  state and have their own optimistic revision.
- A Node position is keyed by stable Project and graph Node IDs. Deleted Page,
  Element, and Table positions remain available for restoration; missing or
  cross-Project ownership fails closed. Clone and export/import remap Node and
  object IDs while preserving geometry and viewport values.
- The server is authoritative for Edge routes. Routes contain only horizontal
  and vertical segments, leave and enter on the required port side, reserve a
  16px endpoint corridor, and search a visibility grid outside each Node's 12px
  clearance rectangle. The renderer rounds visual corners to 8px without
  changing the route coordinates. It does not use a Bezier path.
- Dragging may request a read-only route preview containing every active Node
  exactly once. Node identity, object ownership, pin state, position revision,
  graph revision, and Project revision must match the current graph. The final
  position write is optimistic, idempotent, and one atomic layout command.
- Automatic layout uses ELK's layered algorithm in the left-to-right direction.
  Input ports are fixed WEST, output ports are fixed EAST, and port order is
  fixed. Pinned Nodes retain their positions. A bounded 128-entry, 15-second
  server preview owns the complete position and route snapshot; Apply accepts
  only its preview ID plus revisions and idempotency key.
- Apply writes every previewed position and advances graph and Project revisions
  once. It is one durable `AUTO_LAYOUT` command with Undo/Redo. A new move or
  automatic layout discards an abandoned Redo branch.
- The Editor uses `@xyflow/react` 12.11.3 (MIT) for Node/Handle interaction,
  panning, zooming, and fit view. The server uses `elkjs` 0.12.0
  (EPL-2.0 OR GPL-3.0-or-later) for automatic layout. Both dependencies are
  pinned. ELK stays server-side and is excluded from the browser bundle;
  React Flow is included only in the lazy Editor feature surface.

## Consequences

Reload and Project lifecycle operations preserve manual geometry, pin state,
viewport, and exact Binding identity. Auto Layout can be inspected and canceled
without metadata writes. Applied layouts have zero Node overlap, keep port
direction, recompute routes after movement, and remain independently auditable
through one durable command.
