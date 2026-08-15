# ADR 0004: Project lifecycle protocol and storage safety

Status: accepted

Date: 2026-08-15

## Context

The specification requires Project soft deletion across SQLite metadata and a
real filesystem, while several sections use different revision names and purge
routes. A database transaction cannot atomically include an operating-system
directory move, so restart-safe journal and compensation rules must be fixed
before implementation.

## Decision

- Section 22's `/api/v1` routes are canonical. Permanent purge uses a
  `purge-plan` followed by `DELETE /api/v1/recycle-bin/projects/:projectId`.
- Project definition `revision` and `lifecycleRevision` are independent
  monotonic integers. The canonical trash request keeps `expectedRevision` and
  may also send `expectedLifecycleRevision`; restore and purge require
  `expectedLifecycleRevision`.
- Every lifecycle command requires an idempotency key. The stored request hash,
  status code, and response are replayed for the same payload; reusing a key for
  a different payload is a conflict.
- Development storage is rooted at `data/active/<projectId>` and
  `data/trash/<projectId>`. The root is configurable for isolated tests and the
  future Windows ProgramData deployment.
- File manifests use sorted POSIX relative paths and SHA-256 file-byte hashes.
  Symlinks, traversal, and the self-referential trash manifest are rejected.
- A lifecycle operation and preallocated audit ID are journaled before file
  work. A final SQLite transaction records the manifest, audit event, outbox
  event, status, and operation completion. Startup recovery runs before ready.
- Restore preserves the Project ID and file bytes. Display-name conflicts may
  be explicitly renamed; slug or path collisions are never overwritten.
- A purge plan expires after five minutes and is bound to Project ID,
  lifecycle revision, project checksum, and exact project-name confirmation.
  Purge is unavailable for active projects. A requested backup is completed
  before destructive removal.
- A purged Project leaves a tombstone and audit record; its ID is never reused.

## Consequences

Lifecycle operations require more metadata and fault-injection tests, but they
can be replayed or compensated after a process interruption. The UI can surface
definition conflicts separately from lifecycle conflicts. Physical deletion is
an explicit recycle-bin workflow and cannot be reached through an active
project card.
