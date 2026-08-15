# Implementation status

Updated: 2026-08-15 (Asia/Seoul)

Overall state: `IN PROGRESS`

## Current phase

### PHASE 4 — Page Management and Published Navigation

State: `IN PROGRESS`

Scope:

- Persist Page metadata, ordering, icons, revisions, and draft deletion in each
  isolated Project.
- Replace the Editor's in-memory Page list with optimistic `/api/v1` contracts.
- Keep Published Runtime navigation on immutable snapshots so Draft changes do
  not leak before publish.

Data risk: medium. Page and publish work will use isolated temporary fixtures;
the workspace `data/` directory remains ignored.

Test plan:

- Verify Page create, rename, reorder, icon selection, delete, and Undo across
  refresh and server restart.
- Prove Pointer and Keyboard reorder persist one complete Page-ID permutation.
- Prove Draft changes do not alter Runtime navigation until a new immutable
  snapshot is published.
- Verify clone, export, import, trash, restore, and purge preserve or remove Page
  ownership as required.

## Phase ledger

| Phase | State       | Notes                                                         |
| ----- | ----------- | ------------------------------------------------------------- |
| 0     | VERIFIED    | 337 source/traceability checks and all bootstrap gates passed |
| 1     | VERIFIED    | 177 design-system checks, 61/61 gallery, browser QA passed    |
| 2     | VERIFIED    | 60 themes, 5,712 checks, browser 3,120/3,120, 60 baselines    |
| 3     | VERIFIED    | Persistent lifecycle, restart recovery, and browser QA passed |
| 4     | IN PROGRESS | Page management and immutable runtime navigation              |
| 5–23  | NOT STARTED | Must follow sequentially                                      |

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
- Manifest packaging: root and `packages/theme-core` copies have identical
  `3c015925…b2bb98` file SHA-256
- Real browser: 60/60 themes and 3,120/3,120 CSS token values applied exactly;
  console errors and warnings 0
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
