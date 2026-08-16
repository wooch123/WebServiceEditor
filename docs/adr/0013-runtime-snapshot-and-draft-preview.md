# ADR 0013: Runtime definition snapshot and Draft Preview boundary

Status: accepted

Date: 2026-08-16

## Context

Phase 12 must run a published application without mounting the Editor and must
keep later Draft Page, Element, Binding, and schema edits out of that runtime.
The existing Project Version fixed Page and Element state, but READ execution
still resolved the current Draft Binding. Draft Preview also needs a runtime
surface that reads Test data without publishing or sharing Editor state.

## Decision

- A Project Definition Snapshot has one canonical schema version and contains
  the source Project revision, Element Registry checksum, ordered active Pages,
  active Element entries and layout revisions, active Binding definitions, and
  the logical Data Schema export. Its definition checksum is SHA-256 over
  recursively key-sorted compact JSON and is never self-referential.
- Publish stores that immutable definition in `project_versions`. Runtime
  navigation, Page rendering, and READ execution resolve the same latest
  version and return its version ID and definition checksum. A Runtime query
  rejects a Binding absent from that version even if the current Draft contains
  a Binding with the requested ID.
- Published READ execution compiles the snapshotted logical query and mapping
  against the snapshotted logical/physical Data Schema, then opens only
  `production.sqlite` read-only. A later Draft mutation cannot change the
  compiled plan. The existing 500-row limit, bound parameters, identifier
  allowlist, and `query_only` protections remain mandatory.
- Draft Preview creation checks the expected Project revision and snapshots the
  current Draft without a metadata write. Preview IDs are random, single
  Project scoped, capped at 128, and expire after five minutes. Navigation,
  Page, and READ APIs consume that same immutable preview definition; READ uses
  only `test.sqlite`.
- Draft Preview uses a dedicated `/preview/:projectId/:previewId/*` SPA route.
  Published Runtime uses `/runtime/:projectId/*`. Both mount the Runtime shell
  and Runtime Element factory, never the Editor Canvas, Grid, Inspector,
  selection, resize, drag, or keyboard-command components.
- Runtime Element data is loaded separately from Element props. The renderer
  receives the snapshotted target Binding result and shows truthful
  loading/error/empty/data states. Query specs and SQL never cross from the
  browser.
- Draft Preview is temporary and intentionally does not survive server restart.
  Published versions remain durable and export/import compatible. Preview
  creation, navigation, and queries never change Project revision, command
  history, audit records, Test rows, or Production rows.

## Consequences

Published navigation, Page geometry, Element properties, Binding plans, and
Registry provenance advance together only on publish. Draft Preview can show
the current editor definition with real Test data in an isolated runtime route,
while the public runtime continues to use the prior immutable definition and
Production database until the next publish.
