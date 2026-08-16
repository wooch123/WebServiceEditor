# ADR 0016: Theme revision and runtime preference ownership

Status: accepted  
Date: 2026-08-16

## Context

An editor theme choice, a validated runtime default, an immutable published
page definition, and one browser's preferred theme have different owners and
failure boundaries. Updating `projects.theme_id` alone cannot provide safe
validation, rollback, runtime polling, or browser-local independence.

## Decision

- Metadata schema v12 stores immutable-token theme revisions, per-project
  runtime policy, published pointers, a monotonic runtime theme version, and
  idempotent command results. Existing v1–v11 SQL and checksums stay unchanged.
- A picker change creates a `DRAFT`. Validation checks the exact 52-token
  schema, hexadecimal values, required WCAG contrast pairs, and renderer smoke
  readiness. A failed validation becomes `INVALID` and never changes the
  published pointer.
- With auto apply enabled, a successful validation atomically supersedes the
  prior published revision and advances the runtime theme version. With auto
  apply disabled, the validated revision remains `VALID` until the explicit
  publish endpoint activates it. Rollback reactivates only a previously
  validated published revision.
- Theme revision activation is independent from immutable page/data versions.
  Runtime clients poll the small theme manifest every three seconds and swap
  only semantic CSS variables; the React page tree is not recreated.
- Runtime choice is stored under
  `webeditor.runtime.theme.v3.<projectId>`. The server never owns this browser
  preference. Storage failure falls back to session memory and is disclosed.
- Resolution order is allowed browser preference, published revision, project
  default preset, then the system fallback. Corrupt, removed, disallowed, or
  unknown preferences are deleted and fall back immediately.
- Published runtime content is not mounted until its initial manifest is
  available. The runtime root exposes `data-theme-id` and
  `data-theme-revision`, allowing the semantic token swap to complete before
  the content's first paint.
- The runtime picker projects only the allowed 120-theme inventory subset and
  includes `Project Default`. Editor and runtime picker ownership remain
  separate.

## Consequences

Theme deployment can be validated and rolled back without republishing pages.
Browser profiles remain independent, and policy removal safely invalidates an
old preference. Custom token editing can use the same revision API later
without changing runtime resolution or storage ownership.
