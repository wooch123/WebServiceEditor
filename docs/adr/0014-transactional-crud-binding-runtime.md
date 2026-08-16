# ADR 0014: Transactional CRUD Binding Runtime

Status: accepted

Date: 2026-08-16

## Context

Phase 13 must turn Form inputs and Button events into real CREATE, UPDATE, and
DELETE operations. The browser must not send SQL, physical table names, or
physical column names. Draft Preview must mutate only Test data, Published
Runtime must mutate only Production data, and a successful write must refresh
the affected read views without leaking Draft definitions into Published
Runtime.

## Decision

- A write Binding connects one Button event to one logical Table record port.
  Its operation is the Binding type. Its stored query contains only the schema
  version, operation, logical Table ID, and logical primary-key Field ID. Its
  stored mapping contains logical Field IDs paired with same-Page Number Input
  Element IDs.
- The server validates the mapping against the immutable Runtime snapshot and
  the Element Registry. CREATE excludes auto-increment Fields and requires all
  non-null Fields without defaults. UPDATE requires the primary key and at
  least one non-key Field. DELETE accepts only the primary key. The current
  vertical slice maps Number Input values to INTEGER or REAL Fields; later
  input types extend this compiler instead of accepting browser SQL.
- Runtime write routes accept only mapped Element values and an idempotency
  key. Published routes resolve the latest immutable Project Definition
  Snapshot and open `production.sqlite`; Draft Preview routes resolve the
  captured Draft snapshot and open `test.sqlite`. A Binding absent from the
  selected snapshot, a stale schema revision, or a disabled Binding fails
  closed.
- The row mutation and its idempotent response ledger run in one SQLite
  `IMMEDIATE` transaction inside the selected runtime database. This keeps the
  data row and replay record atomic without a cross-database transaction.
  Successful responses replay exactly. Reusing a key with different values is
  a conflict. Validation, constraint, row, and busy conflicts roll back the
  entire transaction.
- The server derives all quoted physical identifiers from the validated schema
  snapshot and enforces the existing identifier allowlist. Values are always
  bound parameters. Runtime errors expose stable codes and logical
  `fieldId`/`inputElementId` mappings, never SQL or physical identifiers.
- After a successful mutation, the response lists READY READ Bindings whose
  targets are on the source Button's Page. The Runtime reruns those reads and
  replaces their render data. Inputs and actions are disabled while a write is
  pending. A lost response may be retried with the same idempotency key; a
  deterministic client error clears that retry boundary.

## Consequences

The Editor can configure a real CRUD vertical slice entirely with logical IDs.
Draft Preview proves Test database behavior without touching Production, while
Published Runtime executes the same immutable definition against Production.
Field errors remain attached to their input controls, concurrent row changes
surface as conflicts, and Data Table views refresh only after a committed
write.
