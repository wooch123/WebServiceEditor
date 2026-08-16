# ADR 0024: Reference applications and real domain data

Status: accepted

Date: 2026-08-17

## Context

The comprehensive feature showcase proves inventory coverage, but it is not a
substitute for recognizable business systems. A non-developer needs to see how
Pages, Elements, Tables, Relations, actions, and Published Runtime data work
together in a domain they understand. A screenshot-only template or browser
fixture would not prove the Test and Production database boundaries.

## Decision

- Provide four deterministic reference applications: semiconductor yield,
  commerce operations, personal blog, and work management.
- Each application owns four Pages, at least nineteen real Elements, related
  logical Tables, thirteen executable Bindings, a published immutable version,
  and a verified backup.
- Seed 3,938 rows per environment across the suite. Test and Production use
  separate SQLite files and receive equivalent deterministic domain data; no
  Test database is copied into Production.
- Every application exposes actual Data Table, aggregate KPI, and statistical
  chart READ paths. Its execution Page also exposes CREATE, UPDATE, DELETE, and
  refreshed READ Bindings against a domain-specific activity Table.
- Generation uses the existing schema planner, migration integrity checks,
  placement, relationship, publish, and backup services. Direct row insertion
  is limited to server-owned physical identifiers already produced by the
  schema service and runs inside an immediate transaction with foreign-key and
  quick-check assertions.
- Re-running generation returns the same active Projects after verifying exact
  Page, Element, Table, Binding, published-version, and Test/Production row
  counts. It never creates duplicate active reference Projects.
- Project Home exposes one equal-size `예제 프로젝트` action, a concise dialog
  with the four domains and row counts, a visible busy state, and an `예제`
  badge on generated Project cards.

## Consequences

Users can open, edit, publish, and run four understandable systems instead of
starting from an empty Canvas. The examples exercise real databases and action
paths while preserving the product's isolation and recovery invariants. The
generation operation is intentionally administrator-scoped and may take a few
seconds; the UI remains modal and disables duplicate submission until the
server returns verified results.
