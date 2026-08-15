# WebEditor product specification

The canonical, exhaustive specification is
[`../webeditor_codex_spec_v3.txt`](../webeditor_codex_spec_v3.txt). This file is
the repository navigation index and does not replace it.

## First release

WebEditor is a single-user, locally hosted visual builder with four product
surfaces:

1. Project Home and Recycle Bin
2. Page/Layout Editor
3. Database and Binding Designer
4. Draft Preview and immutable Published Runtime

## Required vertical path

Create project → create/reorder/icon a page → place and resize elements → define
SQLite table/fields → connect directional ports → insert deterministic sample
data → render chart/table → perform CRUD → navigate with variables → publish →
choose a browser-local runtime theme → trash and fully restore the project.

## Canonical implementation decisions

- React + TypeScript + Vite SPA and a separate Node + Fastify API.
- Local SQLite metadata plus project-isolated test and production SQLite files.
- Stable UUIDs and generated physical SQL identifiers.
- Registry-driven elements, bindings, layouts, validation, and test inventory.
- `webeditor_theme_presets_v3.json` is the canonical built-in theme manifest.
- `webeditor_project_corpus_v3.json` is the canonical 100-project corpus.

Ambiguous inventory counts in prose are resolved by the canonical JSON
manifests and executable registries. The v1 API contract in specification
section 22 is canonical when lifecycle examples use alternate route spellings.
