# ADR 0021 — 100-Project operational verification

Status: Accepted
Date: 2026-08-16

## Context

Phase 20 generated the canonical 100-Project corpus in an isolated workspace.
Generation alone does not prove that each Project can be opened, edited,
published, restarted, backed up, deleted, restored, and read through the same
services used by the product.

## Decision

- Verification runs only in an explicitly isolated Metadata and Project
  workspace. Repository production data is rejected as a target.
- Generation and verification must use different server instance identifiers.
  This makes a real application restart a precondition, not a reported label.
- Every one of the 100 Projects is exercised through the production service
  boundaries for open, edit, save, reload, Draft Preview, publish, immutable
  Runtime, Test data, Theme persistence, backup, recycle-bin deletion, and
  restore.
- Complex-graph Projects additionally exercise automatic layout, left-input /
  right-output Ports, and orthogonal routes. CRUD Projects exercise real
  Test-Database writes. Stress Projects exercise stale-revision rejection.
- Destructive permanent purge is run only against a disposable clone of
  CORPUS-100. Canonical corpus Projects are never permanently removed by the
  verification run.
- Per-Project results and aggregate performance distributions are immutable,
  checksummed JSON evidence. The run passes only at 100/100 with zero skipped,
  blocked, leaked Sentinel, orphan record/file, and critical error counts.
- A reusable `feature-showcase` sample Project is generated separately from
  the corpus. It contains all 22 Layout Presets, all 55 Element Types, every
  Page Type, real Test schema/data, a Relationship Binding, a Published
  Runtime version, and a verified backup. Repeated creation reuses the same
  Project instead of duplicating it.

## Consequences

- Operational evidence is slower and larger than structural validation, but it
  measures real persistence and restart behavior.
- Fault-injection recovery remains covered by the dedicated lifecycle,
  backup, and relationship integration suites; destructive checks are not run
  against the canonical 100 Projects.
- The showcase Project is intended for human inspection and demonstrations;
  it is not counted as one of the canonical corpus Projects.
