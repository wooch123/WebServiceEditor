import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CANONICAL_PHASE4_ROUTES,
  PHASE4_EVIDENCE_PATH,
  REQUIRED_DYNAMIC_ICON_NAMES,
  REQUIRED_PAGE_TABLES,
  REQUIRED_PHASE4_REQUIREMENTS,
  REQUIRED_PHASE4_TEST_CAPABILITIES,
  extractRouteInventory,
  inspectCanonicalRouteContract,
  inspectFrontendPageImplementation,
  inspectLucideImplementation,
  inspectPageProtocol,
  inspectPageSchema,
  inspectPhase4TestInventory,
  inspectRuntimeImplementation,
  loadLucideCatalog,
  routeKey,
  validatePhase4,
} from "../../scripts/verify-phase4.mjs";

function sourceFile(path, source) {
  return { path, source };
}

const completeSchema = `
  CREATE TABLE pages (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    schema_version INTEGER NOT NULL CHECK (schema_version = 1),
    revision INTEGER NOT NULL CHECK (revision >= 1),
    name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 99),
    route TEXT NOT NULL CHECK (length(route) < 200 AND substr(route, 1, 1) = '/'),
    page_type TEXT NOT NULL CHECK (page_type = 'blank'),
    icon_name TEXT NOT NULL,
    icon_catalog_version TEXT NOT NULL CHECK (icon_catalog_version = '1.31.0'),
    navigation_visible INTEGER NOT NULL CHECK (navigation_visible IN (0, 1)),
    navigation_group TEXT,
    sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  );
  CREATE UNIQUE INDEX pages_active_route_unique_idx
    ON pages(project_id, route COLLATE NOCASE) WHERE deleted_at IS NULL;
  CREATE UNIQUE INDEX pages_active_sort_order_unique_idx
    ON pages(project_id, sort_order) WHERE deleted_at IS NULL;

  CREATE TABLE page_commands (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL,
    page_id TEXT NOT NULL,
    command_type TEXT NOT NULL CHECK (command_type = 'DELETE'),
    snapshot_json TEXT NOT NULL,
    impact_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    undone_at TEXT
  );
  CREATE TABLE project_definition_operations (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL,
    operation_type TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    response_status INTEGER NOT NULL,
    response_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(project_id, idempotency_key)
  );
  CREATE TABLE project_versions (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL,
    schema_version INTEGER NOT NULL,
    sequence INTEGER NOT NULL,
    source_project_revision INTEGER NOT NULL,
    snapshot_json TEXT NOT NULL,
    published_at TEXT NOT NULL,
    UNIQUE(project_id, sequence)
  );
  CREATE TRIGGER project_versions_immutable_update
    BEFORE UPDATE ON project_versions BEGIN
      SELECT RAISE(ABORT, 'project_versions are immutable');
    END;
`;

const completeProtocol = `
  function canonicalRequestHash(body) {
    return createHash("sha256").update(JSON.stringify(body)).digest("hex");
  }
  function findOperation(idempotencyKey, requestHash) {
    const existingOperation = select("project_definition_operations", idempotencyKey);
    if (existingOperation && existingOperation.request_hash !== requestHash) {
      throw conflict(409, "request_hash mismatch");
    }
    if (existingOperation) return JSON.parse(existingOperation.response_json); // replay
  }
  function mutatePage(input) {
    const expectedRevision = input.expectedRevision;
    const expectedProjectRevision = input.expectedProjectRevision;
    if (expectedRevision !== page.revision || expectedProjectRevision !== project.revision) {
      throw conflict(409, "expected revision conflict");
    }
    const idempotencyKey = input.idempotencyKey;
    return { expectedRevision, expectedProjectRevision, idempotencyKey };
  }
  function createPage({ idempotencyKey, expectedProjectRevision }) {}
  function deletePage({ idempotencyKey, expectedProjectRevision }) {}
  function undoPage({ idempotencyKey, expectedProjectRevision }) {}
  function publishProject({ idempotencyKey, expectedProjectRevision }) {
    return database.transaction(() => {
      const hasVisibleNavigation = activePages.some((page) => page.navigationVisible);
      assertApi(hasVisibleNavigation, 422, "PUBLISH_NAVIGATION_HIDDEN");
      database.prepare("INSERT INTO project_versions(snapshot_json) VALUES (?)")
        .run(JSON.stringify(snapshot));
    });
  }
  function publishPlan() {
    const hasVisibleNavigation = activePages.some((page) => page.navigationVisible);
    const errors = hasVisibleNavigation ? [] : ["All Pages hidden"];
    return { errors: validatePublishErrors(errors) };
  }
  function reorderPages(input) {
    const idempotencyKey = input.idempotencyKey;
    const expectedProjectRevision = input.expectedProjectRevision;
    const requestedIds = new Set(input.pageIds);
    if (input.pageIds.length !== activePages.length ||
        !activePages.every((page) => requestedIds.has(page.id))) {
      throw conflict(409, "pageIds must be an exact permutation of activeIds");
    }
    return database.transaction(() => {
      database.prepare("UPDATE pages SET sort_order = sort_order + ?").run(1000);
      database.prepare("UPDATE pages SET sort_order = ?").run(0);
    });
  }
  function getRuntimeNavigation() {
    const row = database.prepare(
      "SELECT snapshot_json FROM project_versions ORDER BY sequence DESC LIMIT 1"
    ).get();
    return JSON.parse(row.snapshot_json);
  }
`;

const completeImportProtocol = `
  function parseImportPublishedVersions(version) {
    const pages = version.pages;
    assertApi(
      pages.length === 0 || pages.some((page) => page.navigationVisible),
      400,
      "INVALID_IMPORTED_VERSION_NAVIGATION",
    );
    return pages;
  }
`;

const completeFrontend = `
  import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, useSensor } from "@dnd-kit/core";
  import { SortableContext, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
  import { FileQuestion } from "lucide-react";
  import dynamicIconImports from "lucide-react/dynamicIconImports";
  import { listPages, createBlankPage, updatePage, reorderPages, deletePage,
    undoPageDelete, listIcons, getIcon } from "./services/pages-api";
  const [pages, setPages] = useState<PageDto[]>([]);
  listPages(projectId); createBlankPage(projectId); updatePage(page);
  reorderPages(projectId); deletePage(page); undoPageDelete(projectId, commandId);
  useSensor(PointerSensor); useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates });
  function iconNameToDynamicName(iconName) { return iconName.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase(); }
  const catalogNameCache = new Map();
  getIcon(iconName).then(({ item }) => catalogNameCache.set(iconName, item.dynamicName));
  rememberIconCatalogItem(item); loadIcon(resolvedName);
  const importer = dynamicIconImports[dynamicName];
  function rename(event) {
    if (event.key === "Enter") save();
    if (event.key === "Escape") cancel();
  }
  function Picker() {
    const virtualizer = useVirtualizer();
    virtualizer.getVirtualItems();
    listIcons({ query, category });
    const recentOnly = true; const RECENT_LIMIT = 12;
    if (["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Enter", "Escape"].includes(event.key)) choose();
    return <FileQuestion />;
  }
  function Manager() {
    return <DndContext><SortableContext><button onDoubleClick={rename} onBlur={save} />
      <Dialog>{elementCount}{bindingCount}{validationScenarioCount}</Dialog>
      <DragOverlay style={{ transform: "rotate(2deg) scale(1.02)", boxShadow: "0 8px 20px" }} />
    </SortableContext></DndContext>;
  }
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
`;

const completeGeometryCss = `
  .page-manager-actions { gap: var(--control-gap); }
  .page-manager-actions > [data-slot="button"] {
    height: var(--control-height); min-height: var(--control-height);
    padding-inline: var(--control-padding-inline); border-radius: var(--control-radius);
  }
  .page-drag-handle, .page-icon-trigger, .page-trash-button {
    width: var(--control-height); height: var(--control-height);
    min-height: var(--control-height); border-radius: var(--control-radius);
  }
  .icon-picker-tools { gap: var(--control-gap); }
  .icon-picker-tools > [data-slot="button"] {
    height: var(--control-height); min-height: var(--control-height);
    padding-inline: var(--control-padding-inline); border-radius: var(--control-radius);
  }
  [data-slot="dialog-footer"] > button,
  [data-slot="alert-dialog-footer"] > button {
    height: var(--control-height); min-height: var(--control-height);
    padding-inline: var(--control-padding-inline); border-radius: var(--control-radius);
  }
  <div data-slot="alert-dialog-footer" className="flex gap-2" />
`;

const completeRuntime = `
  import { getRuntimeNavigation } from "../../services/pages-api";
  function PublishedRuntime() {
    getRuntimeNavigation(projectId);
    const path = window.location.pathname;
    history.pushState({}, "", path);
    addEventListener("popstate", onHistory);
    const [collapsed] = useState(false);
    return <main className="published-runtime"><aside className="runtime-left-nav">
      <nav><a aria-current={selected ? "page" : undefined} /></nav>
    </aside><section /><Drawer open={mobile} /></main>;
  }
`;

function makeCatalog() {
  const names = Array.from({ length: 2000 }, (_, index) => `catalog-${index}`);
  names.push(...REQUIRED_DYNAMIC_ICON_NAMES);
  return {
    version: "1.31.0",
    declaredVersion: "1.31.0",
    names,
    icons: names.map((name) => ({
      name,
      dynamicName: name,
      aliases: [name],
    })),
  };
}

function generatedCatalogFile(catalog) {
  const items = catalog.icons.map((item) => ({
    name: item.name,
    dynamicName: item.dynamicName,
    categories: ["general"],
    keywords: item.aliases,
  }));
  return sourceFile(
    "apps/server/src/icons/lucide-icon-catalog.generated.ts",
    `export const LUCIDE_ICON_CATALOG = ${JSON.stringify(items)} as const;
     export const LUCIDE_DYNAMIC_ICON_NAMES = ${JSON.stringify(
       catalog.names,
     )} as const;`,
  );
}

function behavioralTestFixtures() {
  return [
    sourceFile(
      "packages/domain/test/page-contract.test.ts",
      `it("has Page contracts", () => { expect(PAGE_TYPES).toEqual(["blank"]); });`,
    ),
    sourceFile(
      "apps/server/test/integration/page-management.test.ts",
      `
        it("enforces active constraints", async () => {
          database.prepare("INSERT INTO pages").run();
          expect(routeDuplicate).toBe("UNIQUE constraint failed: pages.project_id, pages.route");
          expect(orderDuplicate).toBe("UNIQUE constraint failed: pages.project_id, pages.sort_order");
          expect(() => database.prepare("duplicate active route and order").run()).toThrow();
        });
        it("replays optimistic operations", async () => {
          const expectedProjectRevision = 1; const idempotencyKey = "same";
          expect(replay).toEqual(response); expect(conflict.status).toBe(409);
        });
        it("reorders exact permutations atomically", async () => {
          await inject({ url: "/api/v1/projects/p/pages/reorder" });
          expect(duplicateMissingForeignPermutation).toBeRejected();
          expect(rollbackUnchangedAtomicTransaction).toEqual(before);
          expect(rows.map((row) => row.sort_order)).toEqual([0, 1]);
        });
        it("deletes and restores the same id", async () => {
          await inject({ method: "DELETE", url: "/api/v1/pages/page-id" });
          expect(elementCount + bindingCount).toBe(2);
          await inject({ url: "/commands/command-id/undo" });
          expect(restored.id).toBe(page.id); // same identifier
        });
        it("keeps draft out of immutable runtime snapshot", async () => {
          await inject({ url: "/publish/plan" });
          await inject({ url: "/runtime/p/navigation" });
          expect(unpublishedDraft).not.toEqual(immutablePublishedVersionSnapshot);
        });
        it("blocks publish when all Pages are hidden", async () => {
          await patchPage({ navigationVisible: false });
          const plan = await inject({ url: "/publish/plan" });
          expect(plan.errors.length).toBe(1);
          const rejected = await inject({ url: "/publish" });
          expect(rejected.statusCode).toBe(422);
          expect(project_versions).toEqual(unchangedVersions);
        });
        it("rejects an imported published version when all Pages are hidden", async () => {
          const publishedVersions = [{
            pages: [{ navigationVisible: false }, { navigationVisible: false }],
          }];
          const imported = await inject({ url: "/import", payload: { publishedVersions } });
          expect(imported.statusCode).toBe(400);
          expect(projectCount).toEqual(unchangedProjectCount);
        });
        it("remaps definitions through the complete Project lifecycle", async () => {
          const cloned = await inject({ url: "/clone" });
          const exported = await inject({ url: "/export" });
          const imported = await inject({ url: "/import", payload: exported });
          expect(imported.page.id).not.toEqual(cloned.page.id); // remap page id
          await inject({ url: "/trash" }); await inject({ url: "/restore" });
          await inject({ url: "/purge" });
          expect(project_versions_runtime).toBePreserved();
        });
      `,
    ),
    sourceFile(
      "apps/web/src/features/pages/PageManager.test.tsx",
      `
        it("persists real pages", async () => {
          render(<PageManager />); mockResolvedValue(listPagesResponse); await userEvent.click(button);
          expect(fetch).toHaveBeenCalled(); rerender(<PageManager />); expect(persisted).toBeVisible();
        });
        it("handles pointer and keyboard reorder once", async () => {
          await userEvent.pointer(pointerSequence); await userEvent.keyboard("{ArrowDown}");
          expect(reorder).toHaveBeenCalledTimes(1); expect(PointerSensor).toBeDefined(); expect(KeyboardSensor).toBeDefined();
        });
        it("renders one DragOverlay and removes rotation for reduced motion", () => {
          expect(screen.getAllByLabelText("drag overlay")).toHaveLength(1);
          expect(prefersReducedMotion).toBe(true);
          expect(reducedStyle.transform).toBe("scale(1.02)");
          expect(DragOverlay).toBeDefined();
        });
        it("keeps every same-level sibling control geometry aligned", () => {
          const rowSelectors = ["page-drag-handle", "page-icon-trigger", "page-trash-button"];
          const rowRects = rowSelectors.map((item) => element(item).getBoundingClientRect());
          expect(rowRects.map((rect) => rect.height)).toEqual([40, 40, 40]);
          expect(rowRects.map((rect) => rect.width)).toEqual([40, 40, 40]);
          const header = element("page-manager-actions 게시 빈 페이지 create").getBoundingClientRect();
          const picker = element("icon-picker-tools 최근 기본 default").getBoundingClientRect();
          const footer = element("dialog-footer 취소 삭제 confirm").getBoundingClientRect();
          expect([header.height, picker.height, footer.height]).toEqual([40, 40, 40]);
          expect(computed.minHeight).toEqual("40px");
          expect(computed.borderRadius).toEqual("8px");
          expect(computed.padding).toEqual("0 12px");
        });
        it("renames by double-click", async () => {
          await userEvent.dblClick(name); await userEvent.keyboard("{Enter}{Escape}"); fireEvent.blur(input);
          expect(update).toHaveBeenCalled();
        });
        it("uses virtual searchable icon picker", async () => {
          await userEvent.type(search, "chart"); await userEvent.selectOptions(category, "charts");
          await userEvent.click(screen.getByText("최근")); await userEvent.keyboard("{ArrowRight}{Enter}");
          expect(virtualCells.length).toBeLessThan(200); fireEvent.scroll(grid);
          expect(CatalogIcon120).toBeVisible();
          expect(getVirtualItems()).toBeDefined(); expect(FileQuestionFallback).toBeVisible();
          expect(Axis3dValidDynamicIcon).not.toBe(FileQuestionFallback);
        });
      `,
    ),
    sourceFile(
      "apps/web/src/features/runtime/PublishedRuntime.test.tsx",
      `
        it("renders published runtime navigation on the left", async () => {
          render(<PublishedRuntime />); const navRect = nav.getBoundingClientRect();
          expect(navRect.left).toBeLessThan(contentRect.left);
          history.pushState({}, "", "/apps/project/second"); dispatchEvent(new PopStateEvent("popstate"));
          await userEvent.click(collapse); expect(collapsed).toBe(true);
          expect(screen.getByText("Drawer mobile")).toBeVisible();
        });
      `,
    ),
  ];
}

describe("Phase 4 page/runtime validation infrastructure", () => {
  it("validates the complete local Phase 4 implementation and evidence contract", async () => {
    const report = await validatePhase4();
    assert.equal(
      report.result,
      "PASS",
      JSON.stringify(report.failures, null, 2),
    );
    assert.equal(report.details.canonicalRouteCount, 12);
    assert.equal(report.details.registeredCanonicalRoutes, 12);
    assert.equal(
      report.details.requiredTableCount,
      Object.keys(REQUIRED_PAGE_TABLES).length,
    );
    assert.equal(report.details.presentTableCount, 4);
    assert.equal(report.details.lucideCatalogVersion, "1.31.0");
    assert.equal(report.details.lucideDeclaredVersion, "1.31.0");
    assert.equal(report.details.lucideCatalogSize, 2025);
    assert.equal(report.details.lucideUniqueIconCount, 1767);
    assert.equal(report.details.phase3RegressionResult, "PASS");
    assert.equal(report.details.requiredEvidencePath, PHASE4_EVIDENCE_PATH);
    assert.ok(
      REQUIRED_PHASE4_TEST_CAPABILITIES.every(
        (capability) => report.details.testInventory.capabilities[capability],
      ),
    );
  });

  it("pins unique canonical route, requirement, schema, and icon inventories", async () => {
    assert.equal(new Set(CANONICAL_PHASE4_ROUTES.map(routeKey)).size, 12);
    assert.equal(new Set(REQUIRED_PHASE4_REQUIREMENTS).size, 7);
    assert.equal(Object.keys(REQUIRED_PAGE_TABLES).length, 4);
    const catalog = await loadLucideCatalog();
    assert.equal(catalog.version, "1.31.0");
    assert.equal(catalog.declaredVersion, "1.31.0");
    assert.equal(catalog.names.length, 2025);
    assert.equal(catalog.icons.length, 1767);
    assert.ok(
      REQUIRED_DYNAMIC_ICON_NAMES.every((name) => catalog.names.includes(name)),
    );
  });

  it("extracts shorthand, generic, object, descriptor, and prefixed routes", () => {
    const routes = extractRouteInventory(`
      server.get("/api/v1/ui/icons", handler);
      server.patch<{ Params: Params }>("/api/v1/pages/:pageId", handler);
      server.route({ method: "POST", url: "/api/v1/projects/:projectId/publish", handler });
      const route = { method: "DELETE", path: "/api/v1/pages/:pageId" };
    `);
    assert.deepEqual(routes.map(routeKey), [
      "DELETE /api/v1/pages/:pageId",
      "GET /api/v1/ui/icons",
      "PATCH /api/v1/pages/:pageId",
      "POST /api/v1/projects/:projectId/publish",
    ]);
    const prefixed = inspectCanonicalRouteContract([
      sourceFile(
        "apps/server/src/routes/pages.ts",
        `server.get("/projects/:projectId/pages", handler);`,
      ),
      sourceFile(
        "apps/server/src/app.ts",
        `server.register(pageRoutes, { prefix: "/api/v1" });`,
      ),
    ]);
    assert.ok(
      prefixed.actualRoutes.some(
        (route) => routeKey(route) === "GET /api/v1/projects/:projectId/pages",
      ),
    );
  });

  it("deterministically rejects every missing canonical route", () => {
    for (const omitted of CANONICAL_PHASE4_ROUTES) {
      const source = CANONICAL_PHASE4_ROUTES.filter(
        (route) => route !== omitted,
      )
        .map(
          ({ method, path }) =>
            `server.${method.toLowerCase()}("${path}", handler);`,
        )
        .join("\n");
      const inspection = inspectCanonicalRouteContract([
        sourceFile("apps/server/src/routes/pages.ts", source),
      ]);
      assert.deepEqual(inspection.missingRoutes.map(routeKey), [
        routeKey(omitted),
      ]);
    }
  });

  it("deterministically rejects weakened active Page SQLite constraints", () => {
    const baseline = inspectPageSchema(completeSchema);
    assert.equal(baseline.activeRouteUniqueIndex, true);
    assert.equal(baseline.activeOrderUniqueIndex, true);
    assert.equal(baseline.immutablePublishedVersions, true);

    const mutations = [
      [
        "route collation",
        completeSchema.replace(" route COLLATE NOCASE", " route"),
        "activeRouteUniqueIndex",
      ],
      [
        "active route predicate",
        completeSchema.replace("WHERE deleted_at IS NULL;", ";"),
        "activeRouteUniqueIndex",
      ],
      [
        "active order predicate",
        completeSchema.replace(/WHERE deleted_at IS NULL;/gu, ";"),
        "activeOrderUniqueIndex",
      ],
      [
        "revision check",
        completeSchema.replace("CHECK (revision >= 1)", ""),
        "pageRevisionConstraint",
      ],
      [
        "immutable trigger",
        completeSchema.replace(
          "BEFORE UPDATE ON project_versions",
          "AFTER INSERT ON project_versions",
        ),
        "immutablePublishedVersions",
      ],
    ];
    for (const [label, source, property] of mutations) {
      assert.equal(inspectPageSchema(source)[property], false, label);
    }
  });

  it("deterministically rejects non-exact or non-atomic reorder implementations", () => {
    const baseline = inspectPageProtocol([
      sourceFile("apps/server/src/pages/service.ts", completeProtocol),
      sourceFile("apps/server/src/projects/service.ts", completeImportProtocol),
    ]);
    assert.equal(baseline.exactReorderPermutation, true);
    assert.equal(baseline.atomicReorderTransaction, true);
    assert.equal(baseline.collisionSafeReorder, true);

    assert.equal(
      inspectPageProtocol([
        sourceFile(
          "apps/server/src/pages/service.ts",
          completeProtocol.replace("new Set(input.pageIds)", "input.pageIds"),
        ),
      ]).exactReorderPermutation,
      false,
    );
    assert.equal(
      inspectPageProtocol([
        sourceFile(
          "apps/server/src/pages/service.ts",
          completeProtocol.replaceAll("database.transaction(() =>", "(() =>"),
        ),
      ]).atomicReorderTransaction,
      false,
    );
    assert.equal(
      inspectPageProtocol([
        sourceFile(
          "apps/server/src/pages/service.ts",
          completeProtocol.replace(
            'database.prepare("UPDATE pages SET sort_order = sort_order + ?").run(1000);',
            "",
          ),
        ),
      ]).collisionSafeReorder,
      false,
    );
  });

  it("deterministically rejects idempotency replay and published-snapshot shortcuts", () => {
    const baseline = inspectPageProtocol([
      sourceFile("apps/server/src/pages/service.ts", completeProtocol),
      sourceFile("apps/server/src/projects/service.ts", completeImportProtocol),
    ]);
    assert.equal(baseline.replaysStoredResponse, true);
    assert.equal(baseline.rejectsIdempotencyMismatch, true);
    assert.equal(baseline.runtimeReadsPublishedSnapshot, true);
    assert.equal(baseline.runtimeAvoidsDraftPages, true);
    assert.equal(baseline.publishPlanBlocksAllHiddenNavigation, true);
    assert.equal(baseline.publishBlocksAllHiddenNavigation, true);
    assert.equal(baseline.importRejectsAllHiddenPublishedNavigation, true);

    const noReplay = completeProtocol.replace(
      "if (existingOperation) return JSON.parse(existingOperation.response_json); // replay",
      "",
    );
    assert.equal(
      inspectPageProtocol([sourceFile("service.ts", noReplay)])
        .replaysStoredResponse,
      false,
    );
    const draftRuntime = completeProtocol.replace(
      '"SELECT snapshot_json FROM project_versions ORDER BY sequence DESC LIMIT 1"',
      '"SELECT * FROM pages ORDER BY sort_order"',
    );
    const draftInspection = inspectPageProtocol([
      sourceFile("service.ts", draftRuntime),
    ]);
    assert.equal(draftInspection.runtimeReadsPublishedSnapshot, false);
    assert.equal(draftInspection.runtimeAvoidsDraftPages, false);

    const unguardedPublish = completeProtocol
      .replace(
        '      assertApi(hasVisibleNavigation, 422, "PUBLISH_NAVIGATION_HIDDEN");\n',
        "",
      )
      .replace(
        "    return { errors: validatePublishErrors(errors) };",
        "    return { errors: [] };",
      );
    const unguardedInspection = inspectPageProtocol([
      sourceFile("service.ts", unguardedPublish),
    ]);
    assert.equal(
      unguardedInspection.publishPlanBlocksAllHiddenNavigation,
      false,
    );
    assert.equal(unguardedInspection.publishBlocksAllHiddenNavigation, false);

    const importBypass = completeImportProtocol.replace(
      "      pages.length === 0 || pages.some((page) => page.navigationVisible),",
      "      true,",
    );
    assert.equal(
      inspectPageProtocol([
        sourceFile("pages-service.ts", completeProtocol),
        sourceFile("project-service.ts", importBypass),
      ]).importRejectsAllHiddenPublishedNavigation,
      false,
    );
  });

  it("deterministically rejects tiny or eagerly loaded Lucide catalogs", () => {
    const catalog = makeCatalog();
    const generatedCatalog = generatedCatalogFile(catalog);
    const baseline = inspectLucideImplementation(
      [sourceFile("DynamicLucideIcon.tsx", completeFrontend), generatedCatalog],
      catalog,
    );
    assert.equal(baseline.fullCatalogPresent, true);
    assert.equal(baseline.generatedCatalogExact, true);
    assert.equal(baseline.usesDynamicImports, true);
    assert.equal(baseline.mapsStoredNameToDynamicName, true);
    assert.equal(baseline.eagerWholeCatalog, false);
    assert.equal(baseline.loadsEverySvg, false);
    assert.equal(
      inspectLucideImplementation(
        [
          sourceFile("DynamicLucideIcon.tsx", completeFrontend),
          generatedCatalog,
        ],
        { ...catalog, declaredVersion: "^1.31.0" },
      ).pinnedVersion,
      false,
    );

    const incompleteGenerated = inspectLucideImplementation(
      [
        sourceFile("DynamicLucideIcon.tsx", completeFrontend),
        generatedCatalogFile({
          ...catalog,
          icons: catalog.icons.slice(1),
        }),
      ],
      catalog,
    );
    assert.equal(incompleteGenerated.generatedCatalogExact, false);
    const wrongDynamicName = inspectLucideImplementation(
      [
        sourceFile("DynamicLucideIcon.tsx", completeFrontend),
        {
          ...generatedCatalog,
          source: generatedCatalog.source.replace(
            '"dynamicName":"catalog-0"',
            '"dynamicName":"catalog-wrong"',
          ),
        },
      ],
      catalog,
    );
    assert.equal(wrongDynamicName.generatedCatalogExact, false);
    assert.ok(wrongDynamicName.invalidGeneratedMappings.length > 0);
    const noDetailMapping = inspectLucideImplementation(
      [
        sourceFile(
          "DynamicLucideIcon.tsx",
          completeFrontend.replace("getIcon(iconName)", "guessIcon(iconName)"),
        ),
        generatedCatalog,
      ],
      catalog,
    );
    assert.equal(noDetailMapping.mapsStoredNameToDynamicName, false);

    const tiny = inspectLucideImplementation(
      [
        sourceFile(
          "IconPicker.tsx",
          `${completeFrontend}\nconst iconOptions = ["File", "House"];`,
        ),
      ],
      catalog,
    );
    assert.equal(tiny.tinyFixedCatalog, true);
    const eager = inspectLucideImplementation(
      [
        sourceFile(
          "Icon.tsx",
          `import * as LucideIcons from "lucide-react"; ${completeFrontend}`,
        ),
      ],
      catalog,
    );
    assert.equal(eager.eagerWholeCatalog, true);
    const allPayloads = inspectLucideImplementation(
      [
        sourceFile(
          "Icon.tsx",
          `${completeFrontend}\nObject.values(dynamicIconImports).map((importer) => importer());`,
        ),
      ],
      catalog,
    );
    assert.equal(allPayloads.loadsEverySvg, true);
  });

  it("deterministically rejects hardcoded Pages, missing sensors, duplicate overlays, and rename shortcuts", () => {
    const baseline = inspectFrontendPageImplementation([
      sourceFile(
        "apps/web/src/features/pages/PageManager.tsx",
        `${completeFrontend}\n${completeGeometryCss}`,
      ),
    ]);
    assert.deepEqual(baseline.hardcodedInitialPages, []);
    assert.equal(baseline.hasPointerSensor, true);
    assert.equal(baseline.hasKeyboardSensor, true);
    assert.equal(baseline.overlayCount, 1);
    assert.equal(baseline.doubleClickRename, true);
    assert.equal(baseline.sameLevelRowGeometry, true);
    assert.equal(baseline.sameLevelHeaderGeometry, true);
    assert.equal(baseline.sameLevelPickerGeometry, true);
    assert.equal(baseline.sameLevelDialogGeometry, true);

    const splitRowGeometry = inspectFrontendPageImplementation([
      sourceFile(
        "PageManager.tsx",
        `${completeFrontend}\n${completeGeometryCss.replace(
          ".page-icon-trigger",
          ".unrelated-icon-trigger",
        )}`,
      ),
    ]);
    assert.equal(splitRowGeometry.sameLevelRowGeometry, false);

    const hardcoded = inspectFrontendPageImplementation([
      sourceFile(
        "PageManager.tsx",
        `${completeFrontend}\nconst initialPages = [{ id: "fake" }];`,
      ),
    ]);
    assert.deepEqual(hardcoded.hardcodedInitialPages, ["initialPages"]);
    const duplicate = inspectFrontendPageImplementation([
      sourceFile(
        "PageManager.tsx",
        completeFrontend.replace(
          "</SortableContext>",
          "<DragOverlay /></SortableContext>",
        ),
      ),
    ]);
    assert.equal(duplicate.overlayCount, 2);
    const clickRename = inspectFrontendPageImplementation([
      sourceFile(
        "PageManager.tsx",
        completeFrontend.replace("onDoubleClick", "onClick"),
      ),
    ]);
    assert.equal(clickRename.doubleClickRename, false);
  });

  it("deterministically rejects runtime Draft leakage and missing history/Drawer behavior", () => {
    const baseline = inspectRuntimeImplementation([
      sourceFile(
        "apps/web/src/features/runtime/PublishedRuntime.tsx",
        completeRuntime,
      ),
    ]);
    assert.ok(Object.values(baseline).every(Boolean));

    const draft = inspectRuntimeImplementation([
      sourceFile(
        "apps/web/src/features/runtime/PublishedRuntime.tsx",
        `${completeRuntime}\nlistPages(projectId);`,
      ),
    ]);
    assert.equal(draft.readsPublishedNavigation, false);
    assert.equal(draft.avoidsDraftApi, false);
    const noHistory = inspectRuntimeImplementation([
      sourceFile(
        "apps/web/src/features/runtime/PublishedRuntime.tsx",
        completeRuntime.replace('history.pushState({}, "", path);', ""),
      ),
    ]);
    assert.equal(noHistory.historyNavigation, false);
    const noDrawer = inspectRuntimeImplementation([
      sourceFile(
        "apps/web/src/features/runtime/PublishedRuntime.tsx",
        completeRuntime.replace("<Drawer open={mobile} />", ""),
      ),
    ]);
    assert.equal(noDrawer.mobileDrawer, false);
  });

  it("requires executable behavioral tests and rejects keyword-only evidence", () => {
    const fixtures = behavioralTestFixtures();
    const baseline = inspectPhase4TestInventory(fixtures);
    for (const capability of REQUIRED_PHASE4_TEST_CAPABILITIES) {
      assert.equal(baseline.capabilities[capability], true, capability);
    }

    const keywordOnly = fixtures.map((file) => ({
      ...file,
      source: file.source
        .replaceAll(/\bit\s*\(/gu, "document(")
        .replaceAll(/\bexpect\s*\(/gu, "record("),
    }));
    const rejected = inspectPhase4TestInventory(keywordOnly);
    assert.deepEqual(rejected.behavioralPaths, []);
    assert.ok(
      REQUIRED_PHASE4_TEST_CAPABILITIES.every(
        (capability) => !rejected.capabilities[capability],
      ),
    );

    const noVirtualScroll = fixtures.map((file) => ({
      ...file,
      source: file.source.replaceAll("fireEvent.scroll", "observeScroll"),
    }));
    assert.equal(
      inspectPhase4TestInventory(noVirtualScroll).capabilities[
        "virtual-icon-picker-keyboard-and-fallback"
      ],
      false,
    );
    const noLifecycleRestore = fixtures.map((file) => ({
      ...file,
      source: file.source.replaceAll('url: "/restore"', 'url: "/recover"'),
    }));
    assert.equal(
      inspectPhase4TestInventory(noLifecycleRestore).capabilities[
        "page-lifecycle-clone-export-import-trash-restore-purge"
      ],
      false,
    );
    const noAllHiddenPublishBlock = fixtures.map((file) => ({
      ...file,
      source: file.source.replaceAll(
        "expect(rejected.statusCode).toBe(422);",
        "record(rejected.statusCode);",
      ),
    }));
    assert.equal(
      inspectPhase4TestInventory(noAllHiddenPublishBlock).capabilities[
        "publish-blocks-all-hidden-navigation"
      ],
      false,
    );
    const noAllHiddenImportBlock = fixtures.map((file) => ({
      ...file,
      source: file.source.replaceAll(
        "expect(imported.statusCode).toBe(400);",
        "record(imported.statusCode);",
      ),
    }));
    assert.equal(
      inspectPhase4TestInventory(noAllHiddenImportBlock).capabilities[
        "import-rejects-all-hidden-published-navigation"
      ],
      false,
    );
  });

  it("deterministically rejects geometry evidence without a measured rectangle", () => {
    const fixtures = behavioralTestFixtures();
    assert.equal(
      inspectPhase4TestInventory(fixtures).capabilities[
        "single-overlay-and-reduced-motion"
      ],
      true,
    );
    assert.equal(
      inspectPhase4TestInventory(fixtures).capabilities[
        "same-level-sibling-geometry"
      ],
      true,
    );
    const mutated = fixtures.map((file) => ({
      ...file,
      source: file.source.replaceAll("getBoundingClientRect", "readLayout"),
    }));
    assert.equal(
      inspectPhase4TestInventory(mutated).capabilities[
        "same-level-sibling-geometry"
      ],
      false,
    );
  });
});
