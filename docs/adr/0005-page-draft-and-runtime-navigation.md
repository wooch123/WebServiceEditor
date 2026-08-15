# ADR 0005: Page draft and published navigation boundary

Status: accepted

Date: 2026-08-15

## Context

Phase 4 must persist Page creation, rename, order, icon selection, and deletion
while keeping Draft Editor changes out of Published Runtime until publish. Page
deletion must remain undoable in the Editor session and must not remove an
already published Page. The Icon Picker must cover the installed Lucide catalog
without loading every SVG into the initial browser bundle.

## Decision

- Draft Page metadata lives in the metadata SQLite database. A Page has a stable
  UUID, independent revision, Project-scoped route and sort order, Lucide export
  name, catalog version, navigation visibility, optional group, and soft-delete
  state.
- Every Page mutation validates both the Page revision and Project revision.
  Successful mutations increment the affected Page revision and Project
  revision in one transaction. Reorder accepts exactly one permutation of all
  active Page IDs and writes it once.
- Phase 4 exposes only the `blank` Page preset. Additional presets remain hidden
  until their real Element instances can be created in the corresponding later
  phases.
- Page delete writes a Draft tombstone and a command record after returning an
  impact summary. Session Undo calls the command endpoint and restores the same
  Page ID, order, icon, and route. It never mutates an immutable published
  snapshot.
- Publish creates an immutable Project Version whose definition contains the
  active Page navigation inventory. Published Runtime navigation reads only the
  latest published version. Draft mutations become visible only after another
  successful publish.
- Runtime navigation is a renderer separate from Editor UI. It supports direct
  Page routes, browser history, hidden-Page direct links, left navigation,
  collapse, search/group handling for large inventories, and narrow-screen
  navigation without importing Editor controls.
- The approved icon catalog is generated deterministically from
  `lucide-react@1.31.0`. Storage uses the actual PascalCase Lucide export name;
  catalog responses also include the corresponding dynamic-import key. The
  server returns metadata, never SVG markup. Unknown names are rejected on
  write and render with `FileQuestion` plus a validation error on read.
- Project clone, export, and import remap Page IDs without cross-Project leaks.
  Project trash and restore retain Page and published-version metadata; purge
  removes their ownership after the existing lifecycle safety gates pass.

## Consequences

Phase 4 adds Page, command, and immutable version schema plus optimistic API
contracts. Published navigation can be verified before the full Runtime Element
renderer exists, while preserving the Draft/Published safety boundary needed by
later Canvas, Data, Validation, and Publish phases.
