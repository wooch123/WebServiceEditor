# ADR 0002: Canonical inventory sources

Status: accepted

## Decision

- The executable registries define Page, Layout, Element, Binding, and lifecycle
  inventories.
- `webeditor_theme_presets_v3.json` defines the exact 60 built-in themes.
- `webeditor_project_corpus_v3.json` defines the exact 100 verification projects.
- Section 22's `/api/v1` contract is canonical for lifecycle endpoints.
- The lifecycle enum includes `ACTIVE`, `TRASHING`, `TRASHED`, `RESTORING`,
  `PURGING`, `PURGE_FAILED`, and `PURGED`.

Generated inventory reports must flag any mismatch between prose counts,
registries, manifests, and tests rather than silently reducing coverage.
