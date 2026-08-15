# Implementation status

Updated: 2026-08-16 (Asia/Seoul)

Overall state: `IN PROGRESS`

## Current phase

### PHASE 6 — Element Registry and Property Inspector

State: `VERIFIED`

Scope:

- Replace duplicated Element metadata with a deterministic Registry contract.
- Generate the right Property Inspector from persisted Property Schema.
- Add real input and data-display Elements with truthful binding/render states.
- Add durable command history with Undo/Redo and Redo-branch invalidation.
- Render immutable published Element snapshots separately from the Editor.

Data risk: high. Migration v5 extends Element constraints and durable command
history. All writes require optimistic revisions and idempotency, and all
fixtures remain isolated from the workspace `data/` directory.

Test plan:

- Generate Palette, Inspector, Inventory, Editor, and Runtime coverage from
  every Registry entry and Property field.
- Verify every Property saves, debounces, flushes, retries, reloads, and survives
  server restart without stale revision loss.
- Verify all Element command types Undo/Redo exactly, discard a Redo branch on a
  new edit, and preserve monotonic revisions and idempotent replay.
- Prove Published Runtime reads immutable snapshots and never leaks Draft edits.
- Verify clone, export, import, trash, restore, purge, checksum, and publish keep
  Registry values and history ownership consistent.

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
| 7–23  | NOT STARTED | Must follow sequentially                                      |

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
