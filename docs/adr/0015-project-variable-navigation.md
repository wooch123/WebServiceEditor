# ADR 0015: Project Variable Navigation

Status: accepted

Date: 2026-08-16

## Context

Phase 14 must turn a Data Table row selection into a typed value, navigate to
another Page, and filter that Page's Chart. Browser Back/Forward and a copied
deep link must reproduce the same result. The browser must not send SQL,
physical table names, or physical field names, and Published Runtime must keep
using its immutable Project Definition Snapshot.

## Decision

- A Project Variable is durable Project metadata with a stable UUID, unique
  lower-case key, scalar type, scope, transport, optional default, revision,
  and sensitivity flag. Sensitive Variables may use `SESSION_STATE` only.
  Variable CRUD is revision checked and idempotent.
- A Data Table exposes one right-side `selection` output. Its selected value is
  read from the raw logical Field-ID row returned by its immutable READ
  Binding, never reconstructed from formatted cells.
- FILTER and NAVIGATE are durable Bindings. Both reference the same Variable,
  source Data Table, selected logical Field, and source READ Binding.
  FILTER additionally references a READY target READ Binding and logical
  target Field. NAVIGATE references an existing target Page and the Variable's
  transport. The server validates all Project, Page, Element, Binding, Field,
  type, and transport ownership before storing the canonical dependency.
- The Runtime snapshot stores the Variable Registry and derives action chains
  only from matching READY FILTER and NAVIGATE Bindings. Selecting a row sets
  the Variable and performs one React Router navigation. `URL_QUERY` uses the
  stable `v.<variable-key>` parameter; `SESSION_STATE` uses browser history
  state. Ordinary navigation preserves the current Variable state.
- Each READ execution receives only Variables declared for that exact Binding.
  The server rejects unknown parameters, validates scalar types, resolves
  defaults, and appends equality filters to the stored logical query before
  the existing prepared-statement compiler runs. Physical identifiers never
  cross the browser contract.
- Browser history is the navigation ledger. Back/Forward restores the prior
  Page and Variable transport state. A direct URL deep link parses the typed
  Variable, loads the target Page, and executes the same filtered READ without
  first visiting the source Page.

## Consequences

The Phase 14 vertical slice has one auditable path from selected raw row value
to Variable, Page route, and filtered Chart. The browser cannot widen the
query with undeclared parameters, formatted table labels cannot corrupt the
selected value, and Draft/Published snapshots remain isolated.
