# ADR 0017: Validation inventory and report ownership

Status: accepted
Date: 2026-08-16

## Context

The Editor had a decorative Validation step with hard-coded counts. It could not
detect broken persisted references, retain a report across restart, prove that
implemented inventory items had test evidence, or navigate from an error to the
affected object.

## Decision

- Metadata schema v13 stores immutable validation runs, normalized run items,
  and idempotent validation command responses. Existing v1–v12 SQL and
  checksums remain unchanged.
- The runtime feature inventory is generated from the Requirement, Validation
  Rule, Element, Layout Preset, Theme, Action, Binding, Field Type, Page Type,
  Lucide, actual Fastify API Route, and Project Lifecycle registries. Every
  verified item carries at least one automated test reference and run evidence.
- Fastify's `onRoute` registration boundary supplies the API inventory. The
  validator does not maintain a second hand-written route list.
- Full validation inspects active Page routes and icons, Element ownership and
  desktop layout bounds, Binding direction and object references, Test SQLite
  integrity and physical Table/Field parity, Theme policy references, and
  inventory evidence. Inventory-only validation executes the coverage gate
  without project data checks.
- Validation is read-only except for its own run, item, and command evidence.
  Requests use optimistic Project revisions and idempotency keys. Successful
  retries return the exact stored report.
- Results are `PASS`, `WARNING`, `FAIL`, or `BLOCKED`. Every issue includes a
  typed deep-link target for Project, Page, Element, Property Tab, Table, Field,
  Binding, Theme, or Runtime Route.
- The Editor report uses server results only. Clicking an issue switches to the
  relevant Page, Canvas object, schema, relationship graph, Theme control, or
  Runtime route. Same-level report actions share the established 40px control
  geometry.
- Phase 16 validates the current-build inventory. REQ-031 remains in progress
  until Phase 19 performs exhaustive release inventory verification.

## Consequences

Validation results survive refresh and server restart, project corruption is
shown as navigable evidence instead of a fabricated score, and adding a
Registry or API item automatically grows the inventory. Phase 19 can extend the
same storage and report contracts without replacing the Editor workflow.
