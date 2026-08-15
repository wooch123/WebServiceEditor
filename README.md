# WebEditor

WebEditor is a visual web-service builder for statistics professionals. It
combines page/layout composition, SQLite-backed data design, executable data
bindings, validation, and a separate published runtime.

## Workspace

- `apps/web`: React + Vite editor and runtime UI
- `apps/server`: Fastify API and local SQLite services
- `packages/domain`: canonical project model and invariants
- `docs`: immutable requirements, traceability, decisions, and phase status
- `scripts`: validation and release gates
- `artifacts`: generated verification evidence

The canonical source artifacts remain at the repository root and are protected
by the checksums in `webeditor_codex_spec_v3.sha256.txt`.
