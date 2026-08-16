# ADR 0023: Production schema publish and working showcase

Status: accepted

Date: 2026-08-16

## Context

Published Runtime mutations are intentionally isolated from Draft Preview and
Test data, but publishing previously copied only the immutable definition. A
Project whose schema had been applied to `test.sqlite` could therefore publish
working bindings while `production.sqlite` still lacked the corresponding
tables. The comprehensive showcase exposed this boundary: READ and CREATE
worked in Draft Preview but the same published action failed.

The public showcase must also remain repairable after normal Editor actions.
Deleting a generated Element must not cause an old idempotency response or an
inactive relationship position to prevent regeneration, backup, or republish.

## Decision

- Publishing first requires the current logical schema to be successfully
  applied to Test. The server then synchronizes the same schema revision to
  Production before writing the immutable Project version.
- Production deployment never copies Test rows. It rebuilds from the current
  Production database, carries forward only compatible Production rows, and
  preserves the Production mutation idempotency ledger.
- Deployment creates a verified Production backup and a fsynced recovery
  journal, builds a staging database, verifies integrity and row counts, swaps
  atomically, and only then finalizes Production schema metadata and audit
  evidence. Startup compensates an interrupted deployment from the verified
  backup.
- A failed Production deployment leaves the Project unpublished at the prior
  revision and restores both the Production file and metadata state. Retrying
  publish is safe.
- The feature showcase generator detects missing Elements and stale mutation
  mappings, creates new stable objects with state-derived idempotency keys,
  replaces only invalid Bindings, normalizes Test fixture rows, reruns layout,
  republishes, and verifies a new backup.
- Relationship exports omit positions owned by inactive Page, Element, or
  Table objects. The inactive records remain available to history and recovery
  but cannot leak into an active export topology.
- Relationship edges use the live React Flow endpoints while a Node moves, so
  the line remains attached without waiting for server routing. The server
  route preview continues to refine intermediate orthogonal bends. A separate
  semantic-token dash layer shows source-to-target direction and is disabled
  under reduced-motion preferences.

## Consequences

The public Runtime can execute the same reviewed schema and immutable bindings
that were tested in Draft Preview without sharing Test data. Production rows
survive compatible republish, interrupted swaps compensate, and the showcase
can repair a deleted workflow Element instead of replaying a stale command.
The relationship graph remains responsive during dragging while retaining the
server as the authority for persisted routes and positions.
