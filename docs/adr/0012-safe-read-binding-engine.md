# ADR 0012: Safe READ Binding compiler and preview boundary

Status: accepted

Date: 2026-08-16

## Context

Phase 11 turns a visual READ Edge into an executable Test SQLite query. The
source specification forbids SQL from clients, requires a Binding Wizard with
real sample output before persistence, and keeps Test and Production databases
separate. Phase 12 will extend immutable Published snapshots; Phase 11 must not
make Draft definitions appear published.

## Decision

- A READ connection is two server-owned previews. The existing connection
  preview fixes endpoints and direction. A bounded 15-second query preview then
  fixes the logical query, target mapping, compiled plan checksum, revisions,
  and real Test database result. READ creation consumes both IDs. No permanent
  Binding or Edge exists while the Wizard is open.
- Clients send only stable Table/Field IDs, a closed query mode, closed filter
  operators, closed sort directions, a closed aggregate function, a row limit,
  and a closed render mapping. Unknown keys and raw SQL, expressions,
  JavaScript, identifiers, or executable source are rejected.
- The compiler resolves physical Table/Field identifiers exclusively from
  metadata, validates that every Field belongs to the source Table, quotes only
  canonical `t_<32 hex>` and `c_<32 hex>` identifiers, and parameter-binds every
  user value. Preview databases open read-only with `query_only=ON`; query
  execution has a 500-row hard ceiling.
- Phase 11 supports LIST, SINGLE, FILTER, SORT, CHART_SERIES, and aggregate
  COUNT/SUM/AVG/MIN/MAX/MEDIAN/STDDEV/VARIANCE. Statistical transforms are
  deterministic application-layer projections over bounded results.
- Sample generation is a separate explicit Test-only command. It uses
  deterministic typed values, is idempotent, and never opens Production. Reset
  is also Test-only. These commands are not general Runtime CRUD.
- `POST /api/v1/bindings/:bindingId/preview` executes a persisted READ Binding
  against Test. `POST /api/v1/runtime/:projectId/query/:bindingId` executes only
  against Production and never accepts SQL. Published-snapshot ownership is
  completed in Phase 12; until then the Editor uses only the Test preview API.
- Editor renderers receive query results separately from Element definition
  props. Query rows are never persisted into Element props or Layout Presets.
  Table, KPI, Histogram, Series, Scatter, Box, and Summary projections share
  the same bounded result DTO.

## Consequences

The visual READ Edge, stored Binding query, compiled plan, preview sample, and
rendered Element can be compared by stable IDs and checksum. Canceling the
Wizard leaves no Binding, arbitrary SQL has no request surface, and Test sample
operations cannot mutate Production.
