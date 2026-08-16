# Implementation status

Updated: 2026-08-16 (Asia/Seoul)

Overall state: `IN PROGRESS`

## Current phase

### PHASE 9 — Data Relationship Canvas

State: `VERIFIED`

Scope:

- Project active Page, Element, Table, and Field metadata as graph nodes.
- Enforce left-input and right-output port direction before persistence.
- Create one durable Binding record from one server-owned connection preview.
- Render each visual Edge directly from its Binding identity.
- Preserve delete, Undo/Redo, clone/import, and Project lifecycle boundaries.

Data risk: medium. A malformed Binding can make the visual graph inconsistent.
Preview scope, optimistic revisions, SQLite direction constraints, topology
checks, and lifecycle-aware endpoint handling fail closed.

Test plan:

- Validate exact Page, Element, and Table node inventories and port sides.
- Reject reversed, stale, duplicate, incompatible, and orphaned connections.
- Prove Preview-to-Binding-to-visual-Edge identity is exactly one-to-one.
- Verify delete, Undo/Redo, restart, clone/import remap, trash, and restore.

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
| 9     | VERIFIED    | Directional ports and durable Binding-backed visual Edges     |
| 10–23 | NOT STARTED | Must follow sequentially                                      |

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

## Phase 9 evidence

- Static, behavioral, browser, and Phase 0–8 regression audit:
  `artifacts/phase9/data-relationship-canvas-validation.json`
- Metadata migration v8: Project graph revisions, Binding records, idempotent
  commands, and durable Binding history
- Domain unit: 12/12; Server unit: 36/36; Server integration: 63/63; Web:
  137/137
- Page, Element, and Table nodes expose deterministic left-input/right-output
  ports; SQLite rejects reversed and duplicate active endpoints
- Server-owned Preview creates one Binding and one labelled arrow Edge with the
  same stable ID; forbidden directions leave the Binding count unchanged
- Delete, Undo/Redo, restart, clone/import ID remap, trash, restore, soft endpoint
  deletion, and fail-closed orphan detection PASS
- Browser QA at 1280×720: three node types, twelve ports, equal four-action
  toolbar, equal mode controls, equal dialog actions, and exact Edge identity
- Browser QA at 419px: document width remains 419px, graph overflow stays local,
  and all four actions remain reachable at equal 395×40 geometry
- Project Home Backup label has the same left coordinate and alignment as all
  sibling navigation items

## Phase 10 evidence

- Static, behavioral, browser, and Phase 0–9 regression audit:
  `artifacts/phase10/orthogonal-auto-layout-validation.json`
- Metadata migration v9: Project-owned Node positions, pin state, viewport,
  idempotent layout commands, and durable layout Undo/Redo
- React Flow node interaction is lazy-loaded; ELK layered automatic layout
  remains server-side with fixed WEST/EAST port order
- Server-owned routes use only horizontal/vertical segments, 16px endpoint
  corridors, 12px Node clearance, and 8px rendered corner radius without Bezier
  paths
- Free Node movement, route preview, final position persistence, viewport,
  reload, clone/import remap, trash/restart/restore, and orphan rejection PASS
- Auto Layout uses a structured preview, preserves pinned Nodes, separates
  disconnected components, produces zero Node overlap, and applies as one
  undoable command
- Browser QA at 1280×720: five Nodes, three Binding-backed Edges, exact
  drag/reload coordinates, zero crossings after layout, equal four-action
  controls, equal dialog actions, and clean console PASS
- Browser QA at 419×800: document width remains 419px and all four layout
  actions remain reachable at equal 395×40 geometry

## Phase 11 evidence

- Static, behavioral, browser, and Phase 0–10 regression audit:
  `artifacts/phase11/safe-read-binding-engine-validation.json`
- Metadata migration v10: bounded READ query runs and crash-safe Test sample
  commands with exact idempotent response replay
- Server-owned LIST, SINGLE, AGGREGATE, and CHART_SERIES compilation accepts
  logical IDs only, binds all values, opens runtime SQLite read-only, and caps
  every result at 500 rows
- Binding query Preview is bound to Project, endpoint, mapping, revisions, and a
  15-second single-use candidate; raw SQL and physical identifiers never cross
  the browser contract
- Deterministic Test sample generation and reset leave Production SQLite
  byte-identical; same-row-count regeneration still rewrites corrupted values
- Canvas reads the actual Test binding result: Data Table renders 24 rows and
  Histogram renders 20 chart marks without frontend fixture data
- Browser QA at 1280×720: query and dialog sibling actions retain equal
  geometry, and the statistical chart fills its Element surface
- Browser QA at 419×800: document width remains 419px, the Binding wizard is
  reachable, and both sibling action groups remain equal at 173.5×40px
- Browser console errors and required request failures: 0

## Phase 12 evidence

- Static, behavioral, browser, and Phase 0–11 regression audit:
  `artifacts/phase12/runtime-preview-validation.json`
- Isolated browser evidence:
  `artifacts/phase12/browser-runtime-preview-validation.json`
- Published Runtime reads immutable Project Definition Snapshots and Production
  data only; Draft Preview reads a five-minute server-owned Test snapshot
- Snapshot checksum binds pages, Elements, layouts, Bindings, schema, Registry,
  theme, and source Project revision
- Published navigation and deep links remain unchanged after Draft edits;
  preview navigation reflects the isolated Draft definition
- Preview creation is write-free and bounded to 128 in-memory snapshots; expiry,
  project/page mismatch, and stale snapshots fail closed
- Export/import preserves published snapshot semantics while remapping Project,
  Page, Element, Table, Field, Relation, and Binding identities
- Browser QA at 1280×720: Published and Draft names stay separated, navigation
  order/icons/deep links are exact, and Preview/Publish/Blank Page actions have
  equal 176.61×40px geometry
- Browser QA at 419×800: document width remains 419px, navigation and Draft
  Preview remain reachable, and all three sibling actions remain equal at
  392.61×40px
- Project Home import/create actions are equal at 208×48px; Backup and its four
  sibling navigation entries share the same 14.40px left coordinate and 39px
  height
- Browser console errors and required request failures: 0

## Phase 13 evidence

- Static, behavioral, browser, and Phase 0–12 regression audit:
  `artifacts/phase13/crud-binding-runtime-validation.json`
- Isolated browser evidence:
  `artifacts/phase13/browser-crud-binding-validation.json`
- CREATE, UPDATE, and DELETE Bindings store logical Table, Field, and Input
  Element IDs only; SQL and physical identifiers never cross the browser
  contract
- Draft Preview mutates only `test.sqlite`; Published Runtime uses only
  `production.sqlite` from the selected immutable definition snapshot
- Each row mutation and its replay record share one SQLite IMMEDIATE
  transaction; constraint, row, busy, and validation failures roll back
- Runtime validation errors map to their Number Input, pending actions are
  disabled, and successful writes refresh READY Data Table reads on the Page
- Real Test DB integration covers create→update→delete, exact replay, stale-row
  conflict, transaction rollback, Data Table refresh, and Production checksum
  isolation
- Browser QA at 1280×720: row counts 0→1→1→0, field-level validation,
  stale-row rollback, and three Data Table refreshes PASS; two inputs and three
  actions retain equal sibling geometry
- Browser QA at 419×800: document width remains 419px, Form and Data Table stay
  reachable, sibling geometry remains equal, and console errors are 0

## Phase 14 evidence

- Static, behavioral, browser, and Phase 0–13 regression audit:
  `artifacts/phase14/project-variable-navigation-validation.json`
- Isolated browser evidence:
  `artifacts/phase14/browser-project-variable-navigation-validation.json`
- Project Variable Registry with typed scalar values, revision checks,
  idempotent CRUD, unique active keys, and URL protection for sensitive values
- Data Table row selection uses raw logical Field-ID rows and drives one
  server-validated FILTER + NAVIGATE action chain
- Runtime READ accepts only the Variable declared for that exact Binding and
  compiles its equality filter through the existing prepared-statement path
- URL query and session-history transports support Page navigation,
  Back/Forward, reload, and direct deep links without browser SQL or physical
  identifiers
- Server integration covers selected value → target Page → one-row filtered
  Chart; component coverage includes row click, typed URL state, history, and
  direct deep-link restoration
- Browser QA at 1280×720: five relationship-toolbar controls share a 40px
  height and equal width; Variable dialog actions are both 172×40px
- Browser QA at 419×800: document width remains 419px, navigation and the
  filtered Chart remain reachable; console errors and failed requests are 0

## Phase 18 operational checkpoint

- Per user direction, Phase 18 includes an actual-domain deployment checkpoint
  so the user can open the service and verify behavior together. Credentials,
  tunnel tokens, and private keys remain outside the repository.

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

The Phase 18 actual-domain checkpoint requires access to the target Windows PC,
Cloudflare account/tunnel credentials, and DNS authority. Phase 22 retains the
final release-hardening and recovery audit after that shared operational check.
