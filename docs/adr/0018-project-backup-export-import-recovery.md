# ADR 0018: Project backup, export/import, and recovery ownership

Status: Accepted

## Context

Phase 17 requires a recoverable Project backup that preserves metadata, both
Runtime databases, Assets, Published Runtime state, and integrity evidence.
The existing recycle bin protects accidental deletion, but it is lifecycle
state for the same Project and is not an independent recovery copy.

## Decision

- A Project Backup is an immutable, server-managed snapshot stored outside the
  active and trash namespaces. A recycle-bin entry never counts as a backup.
- The snapshot payload is the canonical Project Export. The server writes an
  adjacent manifest with payload SHA-256, sorted file-inventory SHA-256, file
  count, byte count, source identity, source revision, and creation time.
- Backup creation requires an active Project revision and an idempotency key.
  Restore and verification have their own replay-safe command records.
- Restore creates a new active Project through the canonical Import path. It
  remaps Project-owned identities and never overwrites the source Project,
  whether that source is active or in the recycle bin.
- A read-only recovery drill validates the manifest, every embedded file, the
  export contract, and both Runtime databases. A failed drill marks the Backup
  invalid and prevents restore.
- Only metadata rows with status `VERIFIED` contribute to the purge impact
  plan. A directory name or partial filesystem copy is not backup evidence.
- Backup operations write durable audit records. Startup recovers pending
  commands from verified filesystem or audit evidence and readiness fails
  closed when a verified backup cannot be read.
- Browser clients call only the Backup API. They do not read files, databases,
  checksums, or infer backup validity locally.

## Consequences

- Trash, restore, purge, and backup can run without treating one another as
  interchangeable safety mechanisms.
- A successful restore is safe to inspect beside the source and can be removed
  independently through the normal recycle-bin lifecycle.
- Backup storage grows monotonically in Phase 17. Retention and remote backup
  targets are operational policies for later phases.
- Phase 18 remains the actual-domain checkpoint requested by the user. Local
  backup verification does not satisfy that deployment requirement.
