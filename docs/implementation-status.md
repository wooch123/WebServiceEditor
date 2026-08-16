# Implementation status

Updated: 2026-08-16 (Asia/Seoul)

Overall state: `IN PROGRESS`

## Current phase

### PHASE 23 — Final Non-Windows Audit

State: `IN PROGRESS`

Scope:

- Re-run the complete source, requirement, canonical inventory, Theme,
  100-Project corpus, performance, security, recovery-design, and completion
  hygiene gates that can be executed outside Windows.
- Bind every generated report to its current SHA-256 and preserve a distinct
  scope-limited final audit report.
- Keep the release recommendation at `HOLD` and `releaseAllowed: false` while
  Windows install, reboot, service recovery, backup/restore, and rollback
  evidence is not run.

Current verified slice:

- Phase 0 source requirements, the exact 60 canonical Themes and 120 selectable
  Themes, Theme provenance, completion hygiene, the exact Phase 19 inventories,
  and Phase 21's 100/100 operational corpus remain passing.
- The seven non-Windows release reports are checksum-bound and evaluated by a
  separate final-audit formula. A passing result applies only to this declared
  non-Windows scope.
- The canonical final release builder remains unchanged and fail-closed. It
  cannot emit `RELEASE` or `OPERATIONALLY VERIFIED` without genuine Windows,
  recovery, and rollback reports.
- Windows deployment is not executed by user direction and is recorded as
  `NOT_RUN_BY_USER_DIRECTION`; it is not counted as passed or substituted with
  local evidence.
- The complete workspace regression passes: 85 server integration tests, 194
  web component tests, 166 validation tests, all unit suites, formatting,
  linting, type checking, and production builds.
- Local web, public HTTPS, and public Ready endpoints each return HTTP 200.
- The scoped Phase 23 gate passes 32/32 checks. The canonical release gate
  intentionally remains red with only the Windows deployment, recovery,
  rollback, and downstream final-report evidence absent.

Phase 23 non-Windows report:
`reports/release/non-windows-final-audit.json`.

Phase 23 scoped validation evidence:
`artifacts/phase23/non-windows-final-audit-validation.json`.

### PHASE 22 — Local Windows Production Deployment (Phase 22 retained implementation baseline)

State: `IMPLEMENTED`

Scope:

- Package the production web and server builds with reviewed Node, WinSW, and
  `cloudflared` binaries and a complete SHA-256 release manifest.
- Install reboot-safe Windows services with the Fastify origin bound only to
  `127.0.0.1`, mandatory authentication, ordered Tunnel startup, and automatic
  failure recovery.
- Schedule daily full online backups and weekly isolated restore drills, then
  require a post-install Windows reboot before operational evidence can pass.

Data risk: medium, guarded. The Windows installer writes service configuration
below `%ProgramData%\WebEditor` and installs two services and two scheduled
tasks. It does not delete Project storage or backup history. Restore drills copy
into isolated temporary storage and never replace live data.

Current implemented slice:

- The production release builder performs the complete workspace build,
  creates a production-only server deployment, bundles web assets and explicit
  reviewed binaries, and records every payload SHA-256, the source commit,
  clean-tree state, release identity, and supported metadata schema.
- WinSW service configuration provides automatic delayed startup, ordered TCP
  dependency, rolling logs, and three restart-on-failure steps.
- The installer stores mandatory authentication and origin settings in an
  ACL-restricted ProgramData directory, encrypts the administrator password
  with LocalMachine DPAPI, waits for local Ready, installs the official
  Cloudflare Tunnel service, and binds its dependency to `WebEditor`.
- Daily backup and weekly restore-drill tasks run as SYSTEM. Backup stops Tunnel
  then origin, snapshots metadata and every runtime SQLite file, and restores
  origin through Ready before Tunnel even after failure. SQLite online backup,
  checksum, integrity, and committed-WAL regression gates also pass.
- The deployment checker requires loopback-only listening, local Health/Ready,
  public HTTPS, automatic ordered services, passing recovery evidence, and a
  later Windows boot. Without that reboot it reports `PENDING_REBOOT` rather
  than manufacturing a passing result.
- A fail-closed rollback drill now verifies and stages a distinct prior release,
  creates a verified offline backup, checks live metadata read-only against the
  candidate schema, preserves the replaced and failed release trees, and
  restores origin Ready before Tunnel. It can create the final rollback report
  only after an actual Windows swap and HTTPS health check.
- A read-only drill against the current local production data backed up 19
  files (20,313,027 bytes) across 10 SQLite databases, verified checksum
  `bfd885a4784fe1acdae029dfe1bffff8583a072962daacc2b5025da7af2ab8c0`,
  and restored the payload in isolation with an exact checksum match.
- Windows operational execution was not run by user direction. Building,
  installing, rebooting, and exercising recovery on the target Windows PC
  therefore remain outside the completed implementation scope.
- Phase 23 preflight is already fail-closed: its report builder consumes exact
  checksums for exhaustive, corpus, Windows, recovery, and rollback evidence,
  and cannot emit a release recommendation while any operational report is
  missing. The Phase 23 non-Windows audit proceeds with an explicit `HOLD`,
  while the canonical full-release path remains blocked on those reports.

Phase 22 local recovery evidence:
`artifacts/phase22/local-backup-restore-drill.json`.

Phase 22 PowerShell parser evidence:
`artifacts/phase22/powershell-syntax-validation.json` — PowerShell 7.6.4,
8/8 scripts, zero parse errors.

### Phase 21 retained prerequisite baseline

State: `OPERATIONALLY VERIFIED`

Scope:

- Exercise every canonical Project through open, edit, save, reload, restart,
  Draft Preview, publish, Runtime, Test data, Theme, backup, recycle, and restore
  boundaries.
- Verify graph, CRUD, stress/recovery, Sentinel isolation, orphan scans, and a
  clone-only permanent purge without deleting the canonical Projects.
- Preserve immutable per-Project results and aggregate performance evidence.

Data risk: medium, isolated. Verification ran only in the dedicated Phase 20
Metadata/Runtime workspace after a real server restart. Destructive purge ran
against one disposable clone. Production Project storage was not used.

Current verified slice:

- All 100 Projects pass all required scenarios with zero failed, blocked,
  skipped, leaked Sentinel, orphan record/file, or critical-error counts.
- A different verifier instance proves the generated workspace was closed and
  reopened before verification.
- Project list, search/sort, open, autosave, preview, publish, Runtime, and
  restart measurements all remain below their canonical budgets.
- Backups, recycle-bin moves, restores, SQLite integrity checks, and one
  clone-only permanent purge all pass.
- A separate `기능 종합 샘플` Project generator provides 22 Pages, all 22
  Layout Presets, all 55 Element Types, every Page Type, 9 real Test tables,
  5,001 rows, five executable Relationship Bindings, a Published Runtime, and
  a verified backup for direct inspection. Its Test runtime proves real
  Create, Read, Update, and Delete execution against `Interactive Records`.
- The Page editor uses a fixed two-column left workspace: Page management is
  the leftmost vertical list and the Element Palette is the adjacent vertical
  list. All 55 Element cards render one per row. At 1280×720 the Page list is
  294px wide with `scrollWidth === clientWidth`, zero row overflow, and no
  document-level horizontal scroll.
- Relationship Auto Layout applies from one click without a Preview or
  confirmation dialog and returns to `저장됨` after persistence.

### Phase 20 retained prerequisite baseline

State: `OPERATIONALLY VERIFIED`

Phase 20 generated the exact canonical 100-Project corpus in an isolated
workspace with a checksummed manifest and exact inventory/scale coverage.

### Phase 19 retained prerequisite baseline

State: `EXHAUSTIVELY VERIFIED`

Scope:

- Reconcile the canonical 12 Page Types, 55 Element Types, 22 Layout Presets,
  11 Binding Types, 120 Themes, and complete action/route inventories.
- Preserve every previously verified Editor, Runtime, lifecycle, and security
  boundary while expanding the registries.
- Exercise each inventory entry with deterministic implementation, behavioral,
  and operational evidence before advancing to the 100-Project corpus phase.

Data risk: low. Metadata migration v16 adds a Project-owned Page Type assignment
table, backfills every existing Page as `blank`, and initializes new Pages with
the same safe default. Existing Page rows and Runtime databases remain
unchanged.

Test plan:

- Verify exact inventory counts, order, schema, cross-references, and runtime
  projection without weakening Phase 0–18 regression gates.
- Verify v15→v16 backfill, new-Page initialization, invalid Page Type rejection,
  restart readiness, and the actual HTTPS deployment.
- Keep graph movement responsive by bounding route previews, applying position
  responses directly, and avoiding a full graph reload after every drop.

Current verified slice:

- Relationship route previews are frame-coalesced, single-flight, and bounded
  to one request per 80 ms while a Node is moving.
- Node drop applies the server position and routed Edges directly; the server
  computes those routes from the already-loaded graph instead of performing a
  second graph read.
- Actual-domain empty-area drag returned in 18 ms, persisted after reload, and
  produced zero browser console errors at
  `https://webeditor.dove9999.com/`.
- Element selection no longer inherits the Grid library's absolute drag
  coordinates, so pointer jitter does not move the Element at 150% zoom.
- Resize controls ignore injected rotation/size styles and use consistent edge
  bars plus compact circular corner handles without covering the Element body.
- The exact 12 Page Type inventory now creates, lists, restarts, exports,
  imports, clones, deletes, and restores through the authoritative assignment
  table while preserving the legacy Page row constraint.
- The exact 11 Binding Type inventory is represented in the validation report
  with executable READ, CRUD, Parameter, and Navigation evidence; `read-one`
  now has a real single-row preview assertion.
- The Element Registry now contains all 55 canonical types. Heading,
  Divider, Image, Badge, Icon, Link, Spacer, Tabs, and Accordion have real,
  separate Editor and Published Runtime renderers, generated Property schemas,
  Registry persistence, and keyboard-accessible shadcn primitives. Text Input,
  Text Area, Select, Multi Select, Checkbox, Radio, Switch, Date Picker, Date
  Range, Slider, and File Upload add real typed form controls and output ports.
  List, Tree, Pagination, Search, Filter, and Detail View add bound data
  surfaces and controls. Heatmap, Distribution, Control, Pareto, Gauge, and
  Correlation Matrix add semantic-token statistical renderers without demo data
  in persisted definitions. Board, Comment, Chat, File List, Notification, Log
  Viewer, Menu, Breadcrumb, Page Link, Button Navigation, and Tabs Navigation
  complete the collaboration/navigation inventory with separate Editor and
  Published Runtime renderers and semantic shadcn structures.
- Workspace verification after this expansion passes 13 domain unit, 42 server
  unit, 83 server integration, 191 web component, and 126 validation tests,
  plus format, lint, typecheck, and production build gates.
- The Phase 19 pre-browser exhaustive gate passes 26/26 checks across 12 Page
  Types, 55 Element Types, 22 Layout Presets, 11 Binding Types, 120 Themes, 8
  Element actions, 7 lifecycle states, 37 traced requirements, 118 API routes,
  and 418 evidence-backed inventory records.
- Actual-domain QA confirms all 55 Palette entries, 12 Page Types, 22 Layout
  Presets, 120 Themes, mobile reachability, non-occluding resize handles,
  stable Element pointing, body-wide dragging, an unbounded vertical Canvas,
  conditional Relationship Edge details, maximized graph space, left-aligned
  Backup navigation, and an 18 ms Relationship Node drop response with zero
  console errors.

## Phase ledger

| Phase | State                  | Notes                                                         |
| ----- | ---------------------- | ------------------------------------------------------------- |
| 0     | VERIFIED               | 337 source/traceability checks and all bootstrap gates passed |
| 1     | VERIFIED               | 177 design-system checks, 61/61 gallery, browser QA passed    |
| 2     | VERIFIED               | 120 themes: 40 dark, 40 gray, 40 light                        |
| 3     | VERIFIED               | Persistent lifecycle, restart recovery, and browser QA passed |
| 4     | VERIFIED               | Page management and immutable runtime navigation              |
| 5     | VERIFIED               | Element placement, grid snapping, and eight-way resize        |
| 6     | VERIFIED               | Registry, Property Inspector, Runtime renderer, Undo/Redo     |
| 7     | VERIFIED               | Statistical Elements and real Layout Preset instances         |
| 8     | VERIFIED               | GUI schema design and isolated Test SQLite migration          |
| 9     | VERIFIED               | Directional ports and durable Binding-backed visual Edges     |
| 10    | VERIFIED               | Orthogonal routing and server-owned automatic layout          |
| 11    | VERIFIED               | Safe READ binding engine and deterministic Test data          |
| 12    | VERIFIED               | Immutable Published Runtime and isolated Draft Preview        |
| 13    | VERIFIED               | Transactional CRUD bindings and Runtime refresh               |
| 14    | VERIFIED               | Project variables and typed runtime navigation                |
| 15    | VERIFIED               | Validated Theme revisions and browser-local Runtime policy    |
| 16    | VERIFIED               | Validation registry, reports, and deep-link navigation        |
| 17    | VERIFIED               | Immutable backups, recovery drills, and restore-as-copy       |
| 18    | OPERATIONALLY VERIFIED | Accessibility, security, performance, actual domain           |
| 19    | EXHAUSTIVELY VERIFIED  | Exact canonical inventory and actual-domain UX QA passed      |
| 20    | OPERATIONALLY VERIFIED | Exact 100-Project isolated generation and manifest passed     |
| 21    | OPERATIONALLY VERIFIED | 100/100 operational scenarios and performance budgets passed  |
| 22    | IMPLEMENTED            | Windows package complete; operational execution not run       |
| 23    | IN PROGRESS            | Non-Windows final audit; canonical release remains HOLD       |

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
- Distribution provenance review covers all 17 canonical reference families,
  their MIT or Apache-2.0 evidence, the no-direct-copy boundary, attribution
  notice, and all 60 original extension themes. The review is preserved in
  `docs/theme-reference-review.json` and independently validated at
  `artifacts/phase2/theme-provenance-license-validation.json`.
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

## Phase 15 evidence

- Static, behavioral, browser, and Phase 0–14 regression audit:
  `artifacts/phase15/theme-revision-runtime-validation.json`
- Isolated browser evidence:
  `artifacts/phase15/browser-theme-revision-runtime-validation.json`
- Metadata migration v12 stores Project-owned Theme Revisions, Runtime Theme
  policy, monotonic manifest versions, and idempotent command responses
- Draft validation checks the exact 52-token schema, text and boundary
  contrast, and render readiness before publishing; failures preserve the last
  valid Runtime pointer
- Explicit publish, rollback, auto-apply, restart persistence, optimistic
  revisions, and all 120 immutable presets with exact 40/40/40 grouping PASS
- Published Runtime waits for the initial Theme Manifest before mounting,
  polls every three seconds, swaps semantic CSS variables without remounting
  Page content, and exposes Theme ID and revision diagnostics
- The exact Project-scoped preference key persists in the same browser profile;
  corrupt, removed, or disallowed choices fall back to Project Default
- Browser QA at 1280×720: Font and Theme controls are both 104×40px; Theme
  picker actions are both 202×40px; live revision polling and allowed-override
  persistence PASS
- Browser QA at 419×800: document width remains 419px, picker and header
  controls remain reachable, and picker actions are both 171.5×40px
- Browser console errors and required request failures: 0

## Phase 16 evidence

- Static, behavioral, browser, and Phase 15 regression audit:
  `artifacts/phase16/validation-system-inventory.json`
- Browser report QA:
  `artifacts/phase16/browser-validation-report.json`
- Metadata migration v13: immutable Validation Runs, normalized run items, and
  idempotent command responses
- Current-build inventory: 352/352 items with zero missing Test Reference and
  zero missing run evidence
- Requirement 37, Validation Rule 19, Element 12, Layout Preset 22, Theme 120,
  Binding, Field Type, Page Type, Lucide, actual Fastify Route, Action, and
  lifecycle inventories are generated from canonical sources
- Normal Project validation PASS; injected broken Page Route, Binding target,
  and Test DB physical Table are detected as three exact navigable issues
- Validation Run replay is byte-identical and the latest report survives a
  browser reload and server-backed re-open
- Clicking `PAGE_ROUTE_INVALID` returns to the Page step with the target Page
  selected
- Browser QA at 1280×720: Validation actions are both 96×40px; Project Home
  Backup and its four peer navigation items share the same 192.203×39px bounds
  and exact label alignment
- Browser QA at 419×800: document width remains 419px, the report stays
  reachable, and Validation actions are both 185.5×40px
- Browser console errors and required request failures: 0

## Phase 17 evidence

- Static, behavioral, browser, and Phase 16 regression audit:
  `artifacts/phase17/backup-export-import-recovery-validation.json`
- Isolated browser recovery evidence:
  `artifacts/phase17/browser-backup-recovery-validation.json`
- Metadata migration v14 stores immutable Backup inventory, replay-safe Backup
  commands, and durable restore/drill runs
- The backup manifest binds the canonical Project Export to payload and sorted
  file-inventory SHA-256 values, exact file count, byte count, source identity,
  and source revision
- Backup creation, verification, and restore are server-owned and idempotent;
  deterministic failures replay while transient failures remain retryable
- Restore creates a new active Project through canonical Import and never
  overwrites the source, including when the source remains in the recycle bin
- Both Runtime SQLite databases, nested Assets, Published navigation, and
  sentinel data survive backup, restart, trash, and restore
- Tampered snapshots become `INVALID`, block restore, and make readiness fail
  closed while verified snapshot metadata drives purge impact evidence
- Project Home exposes concise Backup, Verify, and Restore actions with shared
  sibling geometry; mobile tables own their horizontal overflow
- Browser console errors and required request failures: 0

## Phase 18 evidence

- Static, behavioral, browser, actual-domain, and Phase 17 regression audit:
  `artifacts/phase18/accessibility-security-performance-validation.json`
- Actual HTTPS browser evidence:
  `artifacts/phase18/browser-security-performance-validation.json`
- Metadata migration v15 stores Argon2id administrator accounts, hashed opaque
  sessions, CSRF digests, and authentication audit events
- Public API requires authentication; mutations additionally require the exact
  HTTPS Origin and matching cookie/header CSRF token
- Session cookies are `__Host-`, Secure, HttpOnly, and SameSite Strict; login is
  limited to five attempts per minute
- CSP, HSTS, frame denial, no-sniff, and no-referrer headers are active at the
  Cloudflare-served actual domain
- Accessible login axe violations: 0; visible unlabeled controls: 0; reduced
  motion and all 120 contrast/color-vision checked themes remain active
- Isolated 100-Project measurement: list 51.73ms, search/sort 40.05ms, server
  list p95 51.56ms; all Chapter 27 thresholds pass
- Actual domain first Project display 544ms and Editor open 291ms
- `https://webeditor.dove9999.com/` returns HTTP 200 through an active named
  tunnel; credentials and tunnel secrets remain outside the repository
- Browser console errors and required request failures: 0

## Phase 19 evidence

- Exhaustive source, runtime, browser, and Phase 0–18 regression audit:
  `artifacts/phase19/exhaustive-inventory-validation.json`
- Actual HTTPS browser evidence:
  `artifacts/phase19/browser-exhaustive-inventory-validation.json`
- Exact operational inventory: 12 Page Types, 55 Element Types, 22 Layout
  Presets, 11 Binding Types, 120 Themes, 8 Element actions, 7 lifecycle states,
  37 traced requirements, 118 API routes, and 418 evidence records
- Palette category totals are exact: Basic 12, Input 12, Data 7, Statistics 13,
  Collaboration 6, and Navigation 5; all sibling cards are 88.609×76px
- Editor and Published Runtime use separate real renderers for all 55 Elements
- Actual-domain interaction QA confirms non-occluding edge/corner resize
  controls, body-wide Element dragging, stable click pointing, unlimited
  vertical Canvas growth, conditional Edge details, and maximized Relationship
  workspace
- Relationship Node drop returned in 18ms and persisted through the real API;
  its server request completed in 1.95ms
- At 419px, document width remains 419px and both Palette and Inspector are
  scroll-reachable; Backup and all peer navigation items share identical
  192.203×39px bounds with left-aligned labels
- Browser console errors and required request failures: 0

## Phase 20 evidence

- Deterministic generation audit and Phase 19 regression:
  `artifacts/phase20/project-corpus-generation-validation.json`
- Checksummed 100-Project manifest:
  `artifacts/phase20/project-corpus-manifest.json`
- Isolated operational run record:
  `artifacts/phase20/corpus-generation-run.json`
- One real isolated run generated 100/100 Projects with category counts
  10/20/20/15/15/10/5/5 and 100 unique Project, Runtime, and structure
  Sentinels
- Exact scale totals: 916 Pages, 6,225 Elements, 6,170 relationship Nodes,
  701 Tables, and 416,900 Runtime rows
- Exact coverage: 60 Themes, 12 Page Types, 22 Layout Presets, 55 Element Types,
  and 11 Binding Types
- Manifest SHA-256:
  `0524b4223a7fe71fe5edcb57741dbf0440370b86be2ee4d2e919f7fb6b25d422`
- Actual HTTPS regression: persistent Home Theme, full-width 1248×391
  Relationship node area at 1280×720, 24px-aligned auto layout, overlap 0,
  stable body drag, independently separated Page/Element panels, and a
  bottom-left 192×112 MiniMap whose click navigation updates the live graph
  viewport; console errors 0

## Phase 21 evidence

- Operational verification audit and Phase 20 regression:
  `artifacts/phase21/project-corpus-operational-validation.json`
- Immutable 100-Project scenario results:
  `artifacts/phase21/project-corpus-results.json`
- Aggregate latency, storage, and memory evidence:
  `artifacts/phase21/project-corpus-performance.json`
- Isolated post-restart run record:
  `artifacts/phase21/corpus-verification-run.json`
- Result: 100 PASS, 0 failed, 0 blocked, 0 skipped, 0 Sentinel leaks, 0 orphan
  records/files, 0 critical errors, and 1 clone-only permanent purge
- Maximum measured times: list 107.088ms, search/sort 0.063ms, open 7.761ms,
  autosave 5.958ms, preview 12.374ms, publish 8.537ms, Runtime 8.962ms, and
  restart readiness 102.856ms; all required budgets pass
- Verification SHA-256:
  `6ffe9c6fb1e2e0d88d55b5374fa222a23063a17de6ea3cda36593e9baee195dd`
- `기능 종합 샘플` is generated separately from the corpus and is idempotent,
  published, backed up, and intended for direct human inspection. It contains
  22 Pages, 148 Elements, 9 Tables, 5,001 Test rows, and five executable
  Bindings spanning `CONTAINS`, `CREATE`, `READ`, `UPDATE`, and `DELETE`.
- Actual-domain Relationship QA on that sample renders all 179 Page, Element,
  and Table Nodes in both the graph and MiniMap. Auto Layout produces ordered
  Page → Element → DB zones in a 5,076×2,812 overview (1.805:1), keeps every
  top-left coordinate on the 24px grid, and exposes the current viewport as a
  distinct MiniMap focus rectangle.
- Actual-domain Editor QA confirms Page and Element management as adjacent
  vertical columns. The Page list measures 294×294 client/scroll width with
  zero row overflow; the Element Palette measures 202×202 client/scroll width,
  renders all 55 cards at one 183.141px column, and keeps both document client
  and scroll width at 1280px. Auto Layout opens no dialog and saves directly.

## Deferred operational hardening

- Sudden power-loss durability for directory rename/delete requires mount-backed
  testing in a later recovery phase; Phase 3 proves process interruption and
  startup recovery, not full operational power-loss certification.
- Metadata startup must fail closed on unknown future migration versions before
  backward-compatible release testing.
- Runtime metadata singleton and lifecycle-status constraints will be tightened
  with the relevant database schema phases.

## Known external blockers

None for the current local and actual-domain environment. Windows operational
deployment was not run by user direction; the canonical release gate remains
on `HOLD` until its deployment, recovery, and rollback evidence exists.
