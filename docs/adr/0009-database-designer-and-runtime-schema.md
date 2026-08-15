# ADR 0009: Database Designer and runtime schema migration boundary

Status: accepted

Date: 2026-08-16

## Context

Phase 8 introduces user-defined Tables, Fields, and Relations. These definitions
belong to Editor metadata, while actual rows belong to each Project's isolated
runtime SQLite databases. The source specification requires impact analysis,
backup, transactional application, row-count and integrity verification, and
rollback. It does not define a safe request protocol or when Production data is
allowed to change.

## Decision

- Metadata migration v7 stores Project-owned Table, Field, Relation, schema
  revision, migration-plan, backup, and idempotency records. Physical names are
  server-generated opaque identifiers (`t_<uuid>` and `c_<uuid>`) and are never
  accepted from the client. Display names remain editable.
- Phase 8 supports `INTEGER`, `REAL`, `TEXT`, `BOOLEAN`, `DATE`, `DATETIME`,
  `JSON`, and `BLOB`, including primary-key, auto-increment, nullable, unique,
  default, index, unit, and description metadata. Auto-increment is valid only
  for an integer primary key. A Relation references stable Table and Field IDs.
- Definition mutations are optimistic, idempotent, and atomic with one Project
  and schema-revision increment. Removing a definition changes Draft metadata;
  no runtime data is destroyed by that request.
- `GET /api/v1/projects/:projectId/schema` returns Draft definitions plus the
  independently measured Test and Production runtime states. The canonical
  Section 22.6 Table and Field routes are implemented. Relation CRUD is an
  additive extension under `/api/v1/projects/:projectId/relations` and
  `/api/v1/relations/:relationId`.
- `POST /api/v1/projects/:projectId/schema/plan` compares the immutable Draft
  snapshot with the actual Test runtime database. The server creates a durable,
  expiring plan bound to Project revision, schema revision, checksum, row
  counts, impact, and exact generated steps. Clients never submit SQL.
- `POST /api/v1/projects/:projectId/schema/apply` accepts only a plan ID,
  expected revisions, a destructive-confirmation flag, and an idempotency key.
  Stale, expired, consumed, cross-Project, or modified plans fail closed.
- Phase 8 applies schemas only to `test.sqlite`. `production.sqlite` remains
  unchanged until the later publish/migration phase, preventing Draft changes
  from leaking into Published Runtime data.
- Apply checkpoints the Test database, writes a verified backup under the
  managed backup namespace, builds a same-directory staging database from the
  server-owned schema, copies all compatible retained columns, checks row
  counts, foreign keys, and `quick_check`, then atomically replaces the Test
  database. Metadata finalization records the applied revision and checksums.
- An `APPLYING` journal is recovered at startup. If the replacement database
  contains the planned revision and checksum, metadata is finalized. Otherwise
  the verified backup is restored. A failed operation retains the backup and
  never advances the applied revision.
- Runtime databases keep only runtime metadata, schema state, user Tables,
  indexes, constraints, and rows. Editor display names, descriptions, history,
  plans, and audit data remain in the metadata database.
- Clone, export/import, trash/restore, and purge must preserve or remap schema
  metadata consistently with the existing Project storage lifecycle. A purge
  removes Project-owned schema metadata through foreign-key cascades.

## Consequences

Schema editing is approachable and does not expose SQL. Applying a schema costs
an additional database copy but gives a deterministic rollback point and keeps
Test and Production isolation explicit. Relations become durable metadata in
Phase 8 and are projected as graph connections in Phase 9.
