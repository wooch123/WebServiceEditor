# Implementation status

Updated: 2026-08-16 (Asia/Seoul)

Overall state: `IN PROGRESS`

## Current phase

### PHASE 8 — Database Designer

State: `VERIFIED`

Scope:

- Create Table, Field, and Relation definitions through a GUI.
- Keep editable display names separate from server-owned physical identifiers.
- Apply an immutable migration plan only to the isolated Test runtime database.
- Verify backup, row count, foreign keys, integrity, and rollback.
- Preserve Production, clone/import, and Project lifecycle boundaries.

Data risk: high. Runtime schema replacement can destroy rows. Physical changes
require an impact plan, verified backup, explicit destructive confirmation,
staging database validation, and atomic replacement.

Test plan:

- Validate eight Field types, three templates, relation ownership, optimistic
  revisions, idempotency, and physical-name request rejection.
- Apply real SQLite schema changes while preserving compatible rows and the
  byte-identical Production database.
- Inject apply failures and restart interrupted journals from a verified backup.
- Verify clone, export/import, trash, restart, restore, and purge ownership.

## Phase ledger

| Phase | State       | Notes                                                         |
| ----- | ----------- | ------------------------------------------------------------- |
| 0     | VERIFIED    | 337 source/traceability checks and all bootstrap gates passed |
| 1     | VERIFIED    | 177 design-system checks, 61/61 gallery, browser QA passed    |
| 2     | VERIFIED    | 120 themes: 40 dark, 40 gray, 40 light                        |
| 3     | VERIFIED    | Persistent lifecycle, restart recovery, and browser QA passed |
| 4     | VERIFIED    | Page management and immutable runtime navigation              |
| 5     | VERIFIED    | Element placement, grid snapping, and eight-way resize        |
| 6     | VERIFIED    | Registry, Property Inspector, Runtime renderer, Undo/Redo     |
| 7     | VERIFIED    | Statistical Elements and real Layout Preset instances         |
| 8     | VERIFIED    | GUI schema design and isolated Test SQLite migration          |
| 9–23  | NOT STARTED | Must follow sequentially                                      |

## Phase 0 evidence

- Source/traceability: `artifacts/phase0/source-and-traceability.json` — 337/337
- Theme source audit: `artifacts/phase0/theme-manifest-validation.json` — 7,288/7,288
- Corpus source audit: `artifacts/phase0/corpus-manifest-validation.json` — 6,558/6,558
- Domain unit: 3/3; Web theme unit: 2/2; Server unit: 1/1
- Server integration: 1/1; Web component: 4/4
- Production build: Web, domain, and server PASS
- First meaningful preview: HTTP 200 at `http://127.0.0.1:5173/`

## Phase 1 evidence

- Design-system source: 61/61 shadcn UI modules plus `use-mobile` hook
- Internal gallery: 61/61 executable component families at
  `/internal/design-system`
- Static audit: `artifacts/phase1/design-system-validation.json` — 177/177
- Component tests: 9/9, including keyboard navigation, focus trapping, Escape,
  and focus return
- Browser QA: project home, all three editor steps, gallery, and console gate
  PASS
- Lucide-only product icon scan and required `[-] [12px] [+] [Theme]` order
  PASS

## Phase 2 evidence

- Canonical source audit: `artifacts/phase0/theme-manifest-validation.json` —
  7,288/7,288
- Runtime/package audit: `artifacts/phase2/theme-runtime-validation.json` —
  5,712/5,712
- Additive inventory audit: `artifacts/phase2/theme-extension-validation.json` —
  13,279/13,279
- Manifest packaging: root and `packages/theme-core` copies have identical
  `3c015925…b2bb98` file SHA-256
- Inventory: canonical 60 presets remain byte-identical; 60 additional original
  presets produce 120 selectable themes and exact 40/40/40 group counts
- Runtime tests: 120/120 themes and 6,240/6,240 CSS token values apply exactly
- Visual baseline: 60 unique PNG hashes in
  `artifacts/phase2/theme-screenshot-baseline.json`
- Color-vision simulation: all themes preserve at least 7/8 chart colors and
  4/4 status colors under protanopia, deuteranopia, and tritanopia matrices
- Perceptual duplicate gate: all 1,770 theme pairs pass; minimum CIE76 RMS is
  4.0576
- Theme revision lifecycle foundation and per-project default theme behavior:
  unit/component tests PASS

## Phase 3 evidence

- Static audit: `artifacts/phase3/project-lifecycle-validation.json` — 99/99
- Domain unit: 6/6; Server unit: 3/3; Server integration: 18/18
- Web component: 22/22; Validation suite: 31/31
- Full workspace format, lint, typecheck, test, and production build: PASS
- Browser QA at 419px: concise product copy; equal sibling-control geometry;
  create, trash, reload, restore, and server-restart persistence: PASS
- Independent rich restore probe: nested assets and custom rows in both runtime
  databases retained identical SHA-256 values after trash, restart, and restore
- Adversarial review: no remaining Phase 3 P0/P1 blocker

## Phase 4 evidence

- Static and behavioral audit: `artifacts/phase4/page-runtime-validation.json` —
  149/149
- Domain unit: 9/9; Server unit: 7/7; Server integration: 24/24
- Web unit/component: 35/35; Validation suite: 44/44
- Page create, rename, exact Pointer/Keyboard reorder, full Lucide picker,
  delete-plan, delete, same-ID Undo, restart persistence: PASS
- Immutable publish snapshots, Draft isolation, deep links, history navigation,
  responsive navigation, and republish: PASS
- All-hidden navigation is blocked for direct publish and imported published
  snapshots; rejected operations leave revisions, versions, metadata, and
  storage unchanged
- Browser QA: numeric Lucide rendering, published Runtime, 120-theme picker, and
  equal sibling-control geometry: PASS
- Full workspace format, lint, typecheck, unit, integration, component,
  validation, and production build: PASS

## Phase 5 evidence

- Static, behavioral, and operational audit:
  `artifacts/phase5/element-layout-validation.json` — 191/191
- Domain unit: 11/11; Server unit: 27/27; Server integration: 34/34
- Web unit/component: 86/86; Phase 0–4 regression: PASS
- Server-issued placement candidates own snapping, nearest-free collision
  resolution, vertical compaction, four-edge validity, and preview/commit
  geometry
- Candidate cache is bounded to 512 entries and 15 seconds; stale, expired,
  reused, cross-Page, invalid, and revision-mismatched candidates fail closed
- Pointer and keyboard placement, 24-column movement, lock, single/multi delete,
  eight resize handles, atomic COMPLETE compaction, reload, and restart: PASS
- Browser QA at 1280×720: preview/commit rectangles exact; Project actions,
  Palette items, Page actions, and Canvas controls have equal sibling geometry
- Browser QA at 200%: Canvas owns 1920×1376 overflow inside an 836×527 viewport,
  both scroll offsets are positive, and the 1280×720 document remains unchanged
- Responsive QA at 419px: document width remains 419px and Editor workspace
  retains internal scrolling
- Full workspace format, lint, typecheck, unit, integration, component,
  validation, and production build: PASS

## Phase 6 evidence

- Static, behavioral, and browser audit:
  `artifacts/phase6/element-registry-inspector-validation.json`
- Deterministic Registry: 6 Element types, 190 Property fields, six canonical
  tabs, and checksum `d4846ac7…785d6f`
- Domain unit: 11/11; Server unit: 31/31; Server integration: 44/44
- Web unit/component: 102/102; Phase 0–5 regression: PASS
- Property drafts debounce, blur-flush, retry, and acknowledge only after the
  server response; stale Page and revision responses cannot overwrite current UI
- Durable project-scoped Undo/Redo survives restart, preserves IDs, invalidates
  abandoned Redo branches, and excludes failed commands
- Published Runtime renders immutable Element snapshots; Draft edits remain
  isolated until republish and hidden Elements remain omitted
- Browser QA at 1280×720: Inspector is right of Canvas; six tabs, Inspector
  actions, and Undo/Redo controls retain equal sibling geometry
- Browser QA at 419px: document width remains bounded and the stacked Inspector
  is reachable through the Editor workspace scroll owner
- Full workspace format, lint, typecheck, unit, integration, component,
  validation, and production build: PASS

## Phase 7 evidence

- Static, behavioral, and browser audit:
  `artifacts/phase7/statistical-elements-layout-presets-validation.json` —
  136/136
- Element Registry: existing six types plus Line, Bar, Histogram, Scatter,
  Box, and Summary Statistics; exact 12-type contract PASS
- Layout Presets: all 22 corpus IDs in canonical order with deterministic
  structural previews, coordinates, and SHA-256 evidence
- Domain unit: 11/11; Server unit: 35/35; Server integration: 53/53
- Web unit/component: 128/128; Phase 0–6 regression: PASS
- ADD and REPLACE preserve exact preview coordinates, durable instance
  provenance, binding placeholders, idempotency, and atomic Undo/Redo
- Browser QA at 1280×720: equal sibling controls, structured preview without
  images, reload persistence, replace impact confirmation, and immutable
  Runtime until republish PASS
- Browser QA at 419px: document width remains 419px and all Preset mode,
  action, and impact controls remain reachable with equal sibling geometry
- Full workspace format, lint, typecheck, unit, integration, component,
  validation, and production build: PASS

## Phase 8 evidence

- Static, behavioral, browser, and Phase 0–7 regression audit:
  `artifacts/phase8/database-designer-validation.json` — 39/39
- Metadata migration v7: Project schema state, Tables, Fields, Relations,
  migration plans, verified backups, and idempotency commands
- Eight Field types and three Table templates; display names remain editable
  while `t_<32 hex>` and `c_<32 hex>` physical names remain server-owned
- Server unit: 35/35; Server integration: 58/58; Phase 8 lifecycle: 5/5
- Real Test SQLite apply preserves compatible rows, checks foreign keys and
  `quick_check`, and leaves Production byte-identical
- Failure injection and startup recovery restore verified backups without
  advancing the applied schema revision
- Clone and import remap metadata IDs while preserving physical names and rows;
  trash/restart/restore preserves them and purge removes owned schema metadata
- Browser QA at 1280×720: equal Table/Relation/Plan, Field, and dialog controls;
  display-name edits preserve physical names; relationship and Test apply PASS
- Browser QA at 419px: document width remains 419px, same-level controls retain
  equal geometry, and the Field grid owns horizontal overflow

## Deferred operational hardening

- Sudden power-loss durability for directory rename/delete requires mount-backed
  testing in a later recovery phase; Phase 3 proves process interruption and
  startup recovery, not full operational power-loss certification.
- Backup availability should eventually require a verified backup marker rather
  than any child directory.
- Metadata startup must fail closed on unknown future migration versions before
  backward-compatible release testing.
- Runtime metadata singleton and lifecycle-status constraints will be tightened
  with the relevant database schema phases.

## Known external blockers

Phase 22 requires access to the target Windows PC, Cloudflare account/tunnel
credentials, and DNS authority. These are not needed for earlier phases.
