# WebEditor working agreements

## Mission

Build a non-developer-friendly visual web-service builder for statistics
professionals. Do not report the product complete before operational
verification succeeds.

## Read before editing

1. `docs/00-source-requirements.md`
2. `docs/00a-added-requirements.md`
3. `docs/implementation-status.md`
4. `docs/requirement-traceability.json`
5. The closest nested `AGENTS.md`
6. Relevant ADR and feature specification

## Architecture invariants

- Keep editor and runtime renderers separate.
- Keep metadata, test-runtime, and production-runtime databases separate.
- Keep draft definitions, immutable published versions, and versioned theme
  revisions separate.
- Store bindings by stable IDs, never by display names.
- Input ports are left/target; output ports are right/source.
- A visual edge and its executable binding are one record.
- Drop preview and commit use the same placement candidate.
- Normal project deletion is soft deletion into the recycle bin.
- Project default theme and browser-local runtime preference are independent.
- Feature registries and test inventories move together.

## Delivery method

Work in phase order. Implement a coherent vertical slice, test it, preserve
evidence, update traceability and phase status, then proceed. Placeholder, mock,
disabled, skipped, or no-op behavior does not satisfy a requirement.

## Data safety

Schema and lifecycle changes require impact analysis, backup or compensation,
transaction boundaries, and integrity assertions. Never accept arbitrary SQL or
JavaScript from clients.

## Completion states

Use only `NOT STARTED`, `IN PROGRESS`, `BLOCKED`, `IMPLEMENTED`, `VERIFIED`,
`EXHAUSTIVELY VERIFIED`, `OPERATIONALLY VERIFIED`, or `RELEASED`.
