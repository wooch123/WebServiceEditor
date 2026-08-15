import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CANONICAL_PHASE5_ROUTES,
  PHASE5_BROWSER_GEOMETRY_EVIDENCE_PATH,
  PHASE5_EVIDENCE_PATH,
  REQUIRED_ELEMENT_TABLES,
  REQUIRED_PHASE5_REQUIREMENTS,
  REQUIRED_PHASE5_TEST_CAPABILITIES,
  REQUIRED_RESIZE_HANDLES,
  extractRouteInventory,
  inspectCandidateProtocol,
  inspectCanonicalRouteContract,
  inspectElementSchema,
  inspectFrontendCanvasImplementation,
  inspectBrowserGeometryEvidence,
  inspectLayoutProtocol,
  inspectPhase5TestInventory,
  routeKey,
  validatePhase5,
} from "../../scripts/verify-phase5.mjs";

function sourceFile(path, source) {
  return { path, source };
}

const completeSchema = `
  export const LATEST_METADATA_SCHEMA_VERSION = 4;
  const canvasElementLayoutSchemaSql = \`
    CREATE UNIQUE INDEX pages_id_project_unique_idx ON pages(id, project_id);
    CREATE TABLE page_layout_revisions (
      page_id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL,
      desktop_revision INTEGER NOT NULL CHECK (desktop_revision >= 0),
      updated_at TEXT NOT NULL,
      FOREIGN KEY (page_id, project_id) REFERENCES pages(id, project_id)
    );
    CREATE TRIGGER pages_initialize_layout_revision
      AFTER INSERT ON pages
      BEGIN
        INSERT INTO page_layout_revisions (page_id, project_id, desktop_revision, updated_at)
        VALUES (NEW.id, NEW.project_id, 0, NEW.updated_at);
      END;
    CREATE TABLE elements (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL REFERENCES projects(id),
      page_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('text', 'button', 'container', 'kpi-card')),
      type_version INTEGER NOT NULL,
      name TEXT NOT NULL,
      props_json TEXT NOT NULL,
      style_json TEXT NOT NULL,
      events_json TEXT NOT NULL,
      locked INTEGER NOT NULL CHECK (locked IN (0, 1)),
      hidden INTEGER NOT NULL CHECK (hidden IN (0, 1)),
      revision INTEGER NOT NULL CHECK (revision >= 1),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      UNIQUE(id, page_id, project_id),
      FOREIGN KEY (page_id, project_id) REFERENCES pages(id, project_id)
    );
    CREATE TABLE element_layouts (
      element_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      page_id TEXT NOT NULL,
      breakpoint TEXT NOT NULL CHECK (breakpoint IN ('desktop', 'tablet', 'mobile')),
      x INTEGER NOT NULL CHECK (x >= 0),
      y INTEGER NOT NULL CHECK (y >= 0),
      w INTEGER NOT NULL CHECK (w >= 1),
      h INTEGER NOT NULL CHECK (h >= 1),
      min_w INTEGER NOT NULL,
      min_h INTEGER NOT NULL,
      max_w INTEGER NOT NULL,
      max_h INTEGER NOT NULL,
      PRIMARY KEY (element_id, breakpoint),
      CHECK (breakpoint != 'desktop' OR (max_w <= 24 AND x + w <= 24)),
      FOREIGN KEY (element_id, page_id, project_id)
        REFERENCES elements(id, page_id, project_id)
    );
    CREATE TABLE element_commands (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      page_id TEXT NOT NULL,
      element_id TEXT,
      command_type TEXT CHECK (command_type IN ('ADD', 'MOVE', 'RESIZE', 'LOCK', 'BATCH_LAYOUT', 'DELETE')),
      idempotency_key TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      before_json TEXT,
      after_json TEXT,
      response_status INTEGER NOT NULL CHECK (response_status BETWEEN 200 AND 499),
      response_json TEXT NOT NULL,
      before_layout_revision INTEGER NOT NULL,
      after_layout_revision INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(project_id, idempotency_key)
    );
  \`;
  const migration = { name: "canvas-element-layout-kernel", version: 4, sql: canvasElementLayoutSchemaSql };
  if (userVersion > LATEST_METADATA_SCHEMA_VERSION) throw new Error("Refusing unknown future metadata schema version");
  const migrate = database.transaction(() => migration); migrate.immediate();
`;

const completeCandidateStore = `
  export const PLACEMENT_CANDIDATE_TTL_MILLISECONDS = 15_000;
  export const PLACEMENT_CANDIDATE_CAPACITY = 512;
  export class PlacementCandidateStore {
    #clock = () => new Date(); #ttlMilliseconds = PLACEMENT_CANDIDATE_TTL_MILLISECONDS;
    #capacity = PLACEMENT_CANDIDATE_CAPACITY; #candidates = new Map<string, StoredPlacementCandidate>();
    create(input) {
      this.#purgeExpired(this.#clock().getTime());
      while (this.#candidates.size >= this.#capacity) this.#candidates.delete(this.#candidates.keys().next().value);
      const candidate = { ...input, candidateId: randomUUID(), projectId: input.projectId,
        pageId: input.pageId, elementType: input.elementType, sizeRule: input.sizeRule,
        canvasHeight: input.canvasHeight,
        projectRevision: input.projectRevision, layoutRevision: input.layoutRevision,
        expiresAt: new Date(this.#clock().getTime() + this.#ttlMilliseconds).toISOString(), consumedAt: null };
      this.#candidates.set(candidate.candidateId, candidate); return candidate;
    }
    consume(input) {
      const candidate = this.#candidates.get(input.candidateId);
      if (Date.parse(candidate.expiresAt) <= this.#clock().getTime()) { this.#candidates.delete(candidate.candidateId); throw new ApiError(409, "PLACEMENT_CANDIDATE_EXPIRED"); }
      if (candidate.projectId !== input.projectId || candidate.pageId !== input.pageId) throw new ApiError(409, "PLACEMENT_CANDIDATE_PAGE_MISMATCH");
      if (candidate.layoutRevision !== input.expectedLayoutRevision || candidate.projectRevision !== input.expectedProjectRevision) throw new ApiError(409, "PLACEMENT_CANDIDATE_STALE");
      if (!candidate.valid) throw new ApiError(409, "PLACEMENT_CANDIDATE_INVALID");
      candidate.consumedAt = this.#clock().toISOString(); return candidate;
    }
    #purgeExpired(now) { for (const [id, candidate] of this.#candidates) if (Date.parse(candidate.expiresAt) <= now) this.#candidates.delete(id); }
  }
`;

const completeCandidateService = `
  const CANVAS_GRID = { columns: 24, rowHeight: 8, gap: 8, padding: 16 };
  function compactPlacement(candidate, existing) { while (candidate.y > 0 && !collision(existing, { ...candidate, y: candidate.y - 1 })) candidate.y -= 1; return candidate; }
  function createPlacementCandidate(input) {
    const definition = elementRegistry.getElementDefinition(input.elementType);
    const { defaultW, defaultH, minW, minH, maxW, maxH } = definition.sizeRule;
    const columnWidth = input.canvasWidth / CANVAS_GRID.columns;
    let x = Math.round(input.pointer.correctedCanvasX / columnWidth);
    let y = Math.round(input.pointer.correctedCanvasY / (CANVAS_GRID.rowHeight + CANVAS_GRID.gap));
    const w = defaultW; const h = defaultH;
    x = Math.max(0, Math.min(CANVAS_GRID.columns - w, x)); y = Math.max(0, y);
    let collisionResolved = false; let distance = 0;
    while (collision(existing, { x, y, w, h })) { distance += 1; y += 1; collisionResolved = true; }
    ({ x, y } = compactPlacement({ x, y, w, h }, existing));
    const candidatePixelBottom = CANVAS_GRID.padding + (y + h) * (CANVAS_GRID.rowHeight + CANVAS_GRID.gap);
    return candidates.create({ projectId, pageId, elementType: input.elementType, x, y, w, h, canvasHeight: request.canvasHeight,
      valid: correctedCanvasX >= 0 && correctedCanvasX <= request.canvasWidth && correctedCanvasY >= 0 && correctedCanvasY <= request.canvasHeight && candidatePixelBottom <= request.canvasHeight,
      collisionResolved, sizeRule: { defaultW, defaultH, minW, minH, maxW, maxH },
      projectRevision, layoutRevision, expiresAt });
  }
  function fromPlacement(input) {
    const existingOperation = repository.findOperation(input.idempotencyKey);
    if (existingOperation) return JSON.parse(existingOperation.response_json);
    const candidate = candidates.consume(input);
    if (candidate.expiresAt < now) throw new ApiError(409, "PLACEMENT_CANDIDATE_EXPIRED");
    const entry = repository.insert({ x: candidate.x, y: candidate.y, w: candidate.w, h: candidate.h });
    return entry;
  }
`;

const completeRoutes = CANONICAL_PHASE5_ROUTES.map(
  ({ method, path }) =>
    `server.${method.toLowerCase()}("${path}", async (request) => handler(request));`,
).join("\n");

const completeFromPlacementRoute = `
  server.post("/api/v1/pages/:pageId/elements/from-placement", async (request) => {
    const body = exactBody(request.body, ["candidateId", "expectedLayoutRevision", "expectedProjectRevision", "idempotencyKey"]);
    return service.fromPlacement(request.params.pageId, body);
  });
`;

const completePageManagerFrontend = `
  import { DndContext } from "@dnd-kit/core";
  function PageManager() { return <DndContext />; }
`;

const completeAppFrontend = `
  function App() {
    return <EditorSurface onProjectRevisionChange={(revision) => setSelectedProject((current) => current ? { ...current, revision: Math.max(current.revision, revision) } : current)} />;
  }
`;

const completeWorkspaceFrontend = `
  import { DndContext, DragOverlay, PointerSensor, KeyboardSensor } from "@dnd-kit/core";
  let candidateSequence = 0; let candidateCell = null;
  const applyRevisions = (nextProjectRevision, nextLayoutRevision) => { const current = revisionRef.current; revisionRef.current = { projectRevision: Math.max(current.projectRevision, nextProjectRevision), layoutRevision: Math.max(current.layoutRevision, nextLayoutRevision) }; };
  async function requestCandidate(pointer, options = {}) { const columnPitch = gridColumnWidth(canvasWidth) + GRID_GAP; const snappedColumn = Math.round((pointer.correctedCanvasX - CANVAS_PADDING) / columnPitch); const inBounds = pointer.correctedCanvasX >= 0 && pointer.correctedCanvasX <= canvasWidth && pointer.correctedCanvasY >= 0 && pointer.correctedCanvasY <= canvasHeight; const requestKey = [snappedColumn, inBounds, canvasHeight].join(":"); if (!options.force && cached?.requestKey === requestKey && Date.parse(cached.candidate.expiresAt) - Date.now() > minimumValidityMargin) return cached.candidate; const sequence = ++candidateSequence; const result = await createPlacementCandidate({ pointer, canvasHeight }); if (sequence !== candidateSequence) return null; setCandidate(result); return result; }
  function scheduleCandidate(pointer) { requestAnimationFrame(() => { if (candidateCell !== pointer.gridCell) requestCandidate(pointer); candidateCell = pointer.gridCell; }); }
  async function handleDragEnd(event) { const candidate = await requestCandidate(event.finalPointer); await createElementFromPlacement({ candidateId: candidate.candidateId, candidate }); }
  function handleFailure(reason) { if (reason.code === "ELEMENT_COLLISION") setError("엘리먼트 충돌"); else if (reason.status === 409) setError("변경 충돌"); }
  const removeSelectedElements = useCallback(async () => { if (entries.filter((entry) => selectedElementIds.has(entry.element.id)).some((entry) => entry.element.locked)) { setError("잠금 요소"); return; } await Promise.all(entries.filter((entry) => selectedElementIds.has(entry.element.id)).map((entry) => deleteElement(entry))); }, [entries, selectedElementIds]);
  function ElementWorkspace() {
    const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor));
    const [selectedElementIds, setSelectedElementIds] = useState(new Set()); const reducedMotion = useReducedMotion();
    function onKeyDown(event) { if (["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(event.key)) move(event.shiftKey ? 4 : 1); if (event.key === "Escape") clearSelection(); if (event.key === "Delete") removeSelectedElements(); }
    document.addEventListener("keydown", onKeyDown);
    return <DndContext sensors={sensors}><div data-testid="element-palette"><button data-testid="palette-item-text" aria-label="Text" tabIndex={0} /></div><DragOverlay><div data-testid="palette-drag-overlay" /></DragOverlay></DndContext>;
  }
`;

const completeCanvasFrontend = `
  import GridLayout from "react-grid-layout";
  import { noCompactor, verticalCompactor } from "react-grid-layout/core";
  function compactCompleteLayout(nextLayout) { return verticalCompactor.compact(nextLayout, 24); }
  function handleDragStop(nextLayout) { batchElementLayout({ mode: "COMPLETE", items: compactCompleteLayout(nextLayout) }); }
  function handleResizeStop(nextLayout) { batchElementLayout({ mode: "COMPLETE", items: compactCompleteLayout(nextLayout) }); }
  function handleKeyDown(event) { if (event.target !== event.currentTarget) return; if (event.key.startsWith("Arrow")) moveElement(); }
  function CandidatePlaceholder({ candidate }) { return <div role="group" data-testid="placement-placeholder" data-x={candidate.x} data-y={candidate.y} data-w={candidate.w} data-h={candidate.h} data-valid={candidate.valid} data-collision-resolved={candidate.collisionResolved} onKeyDown={(event) => { if (event.key === "Escape" || event.target === event.currentTarget) handleCandidateKeyDown(event); }}><div className="placement-placeholder-actions"><button>배치</button><button>취소</button></div></div>; }
  function ElementCanvas({ candidate, layout, locked, selectedElement }) {
    const resizeHandles = ["n","s","e","w","ne","nw","se","sw"];
    const isDraggable = !locked; const isResizable = !locked;
    setDroppableRef(canvasNode);
    return <GridLayout layout={layout} onDragStop={handleDragStop} onResizeStop={handleResizeStop} resizeHandles={resizeHandles} compactor={noCompactor}>
      <div data-testid="element-canvas" role="listbox" aria-multiselectable="true" />
      <CandidatePlaceholder candidate={candidate} />
      <div data-testid="placed-element-1" data-element-type="text" role="option" aria-selected={true} onKeyDown={handleKeyDown}><button className="element-delete-control" disabled={locked || mutating}>삭제</button></div>
      {resizeHandles.map((handle) => <button data-testid={\`resize-handle-\${handle}\`} />)}
      <span data-testid="resize-tooltip" />
    </GridLayout>;
  }
`;

const completeRendererFrontend = `
  function ElementRenderer({ element }) { return element.type === "button" ? <button>{element.name}</button> : <div>{element.name}</div>; }
`;

const completeApiFrontend = `
  const fromPlacement = "/api/v1/pages/id/elements/from-placement";
  function createElementFromPlacement(input) { return request(fromPlacement, { candidateId: input.candidateId, expectedLayoutRevision: input.expectedLayoutRevision, expectedProjectRevision: input.expectedProjectRevision, idempotencyKey: input.idempotencyKey }); }
  function listElements() { return request("/api/v1/pages/id/elements"); }
  function createPlacementCandidate(input) { return request("/api/v1/pages/id/placement-candidates", { pointer: input.pointer, canvasHeight: input.canvasHeight }); }
`;

function behavioralTestFixtures() {
  return [
    sourceFile(
      "packages/domain/test/element-contract.test.ts",
      `it("defines element layout", () => { expect(ELEMENT_DEFINITIONS).toHaveLength(4); });`,
    ),
    sourceFile(
      "apps/server/test/integration/element-layout.test.ts",
      `
        it("migrates SQLite user_version to schema version 4", () => { expect(database.pragma("user_version")).toBe(4); });
        it("seeds layoutRevision 0 after new Page create", async () => { const page = await createPage(); expect((await listElements(page.id)).layoutRevision).toBe(0); });
        it("keeps layoutRevision and canvas elements through import clone", async () => { const imported = await importProject(await exportProject()); const cloned = await clone(); expect(imported.page_layout_revisions).toEqual(cloned.page_layout_revisions); });
        it("enforces element_layouts ownership foreign key constraints", () => { expect(() => insertForeignElement()).toThrow(/SQLITE_CONSTRAINT/); });
        it("rejects non-integer geometry beyond 24 columns", () => { expect(() => insertLayout({ x: 24.5 })).toThrow(/SQLITE_CONSTRAINT/); });
        it("rejects stale layoutRevision with 409 conflict", async () => { expect((await staleLayout()).statusCode).toBe(409); });
        it("replays the same idempotency response", async () => { expect(await retrySameIdempotency()).toEqual(await originalResponse()); });
        it("replays successful delete twice with same idempotency key and same 200 response", async () => { const first = await deleteElement(key); const second = await deleteElement(key); expect(second).toEqual(first); });
        it("rolls back transient 500 with no command and same idempotency key retry succeeds 201", async () => { injectServerFailure(); expect(await firstAttempt()).toBe(500); expect(commandCount()).toBe(0); expect((await retrySameKey()).statusCode).toBe(201); });
        it("rejects idempotency payload mismatch with 409", async () => { expect((await differentIdempotencyPayload()).statusCode).toBe(409); });
        it("keeps placement-candidates out of SQLite", async () => { const before = database.total_changes; await createCandidate(); expect(database.total_changes).toBe(before); });
        it("rejects reused candidate under a second operation", async () => { expect((await secondCandidateConsume()).statusCode).toBe(409); });
        it("rejects expired candidate", async () => { clock.advance(15_000); expect((await expiredCandidate()).statusCode).toBe(409); });
        it("rejects stale candidate revision", async () => { expect((await staleCandidate()).statusCode).toBe(409); });
        it("rejects cross-page candidate ownership mismatch", async () => { expect((await candidateFromAnotherPage()).statusCode).toBe(409); });
        it("rejects tampered from-placement x geometry as unknown field", async () => { expect((await fromPlacement({ x: 9 })).statusCode).toBe(400); });
        it("snaps candidate to the 24 column grid", async () => { expect((await placementCandidate()).candidate).toMatchObject({ x: 4, y: 2, w: 6, h: 5 }); });
        it("clamps left right top bottom boundary", async () => { expect((await boundaryCandidate()).candidate.x).toBe(18); });
        it("returns clamped out-of-bounds candidate valid false and blocks from-placement commit", async () => { const candidate = await negativePointerCandidate(); expect(candidate.valid).toBe(false); expect((await fromPlacement(candidate.candidateId)).statusCode).toBe(409); });
        it("returns bottom plus one pixel canvasHeight candidate invalid and blocks from-placement commit", async () => { const candidate = await placementCandidate({ correctedCanvasY: canvasHeight + 1, canvasHeight }); expect(candidate.valid).toBe(false); expect((await fromPlacement(candidate.candidateId)).statusCode).toBe(409); });
        it("vertically compacts an empty pointer row 12 candidate to y 0", async () => { const candidate = await placementCandidate({ y: 12, empty: true }); expect(candidate).toMatchObject({ y: 0 }); });
        it("vertically compacts candidate immediately below an existing blocker", async () => { const candidate = await placementCandidate({ y: 12, blocker: { y: 0, h: 5 } }); expect(candidate).toMatchObject({ y: 5 }); });
        it("resolves collision to deterministic nearest slot", async () => { expect((await collisionCandidate()).candidate).toMatchObject({ collisionResolved: true, y: 5 }); });
        it("treats locked element as collision", async () => { expect((await lockedCollision()).candidate.collisionResolved).toBe(true); });
        it("commits exact candidate preview geometry", async () => { const candidate = await preview(); const created = await fromPlacement(candidate.candidateId); expect(created.entry.layout).toEqual({ x: candidate.x, y: candidate.y, w: candidate.w, h: candidate.h }); });
        it("commits preview geometry for every registered element type", async () => { for (const definition of ELEMENT_DEFINITIONS) { const candidate = await placementCandidate(definition.type); const created = await fromPlacement(candidate.candidateId); expect(created.entry.layout).toMatchObject({ x: candidate.x, y: candidate.y, w: candidate.w, h: candidate.h }); } });
        it("creates 20 elements and reloads them", async () => { await createTwentyElements(20); expect((await listElements()).elements).toHaveLength(20); });
        it("restores layouts after server restart", async () => { database.close(); const reopened = new MetadataDatabase(path); expect(await reopenedElements(reopened)).toEqual(beforeRestart); });
        it("clamps resize to minW minimum", async () => { expect((await resizeBelowMin()).layout.w).toBe(minW); });
        it("clamps resize to maxW maximum", async () => { expect((await resizeAboveMax()).layout.w).toBe(maxW); });
        it("rejects move or resize of locked element", async () => { expect((await moveLocked()).statusCode).toBe(409); });
        it("preserves element ownership through clone export import trash restore purge", async () => { const cloned = await clone(); const exported = await exportProject(); const imported = await importProject(exported); await trash(); await restore(); await purge(); expect(imported.elements[0].id).not.toEqual(cloned.elements[0].id); });
        it("keeps immutable publish snapshot isolated from draft element layout", async () => { const published = await publish(); await moveDraftElement(); expect(await publishedSnapshot()).toEqual(published); });
      `,
    ),
    sourceFile(
      "apps/server/test/unit/placement-candidate-store.test.ts",
      `
        it("bounds PlacementCandidateStore at capacity 512 and evicts", () => { for (let index=0; index<513; index++) store.create(item(index)); expect(store.size).toBe(512); });
        it("expires candidate after 15_000 ms clock", () => { clock.advance(15_000); expect(() => store.consume(candidate)).toThrow(/EXPIRED/); });
      `,
    ),
    sourceFile(
      "apps/web/src/features/elements/ElementCanvas.test.tsx",
      `
        it("places from Palette with PointerSensor and one DragOverlay", async () => { await pointer.drag(palette, canvas); expect(screen.getAllByTestId("palette-drag-overlay")).toHaveLength(1); });
        it("places from Palette with KeyboardSensor candidate", async () => { await keyboard.press("Enter"); expect(await screen.findByTestId("placement-placeholder")).toBeVisible(); });
        it("moves with controlled react-grid-layout onDragStop", async () => { GridLayout.onDragStop(layout); expect(updateElement).toHaveBeenCalledTimes(1); });
        it("persists RGL resize vertical compaction of 2 elements in one atomic COMPLETE batch and reload", async () => { fireEvent.mouseMove(document); await verticalCompactor.drag(twoElements); expect(batchElementLayout).toHaveBeenCalledTimes(1); expect((await listElements()).elements).toEqual(compactedElements); });
        it("commits final pointer after delayed out-of-order candidate race", async () => { const deferred = delayCandidateResponses(); await DragEnd(finalPointer); deferred.resolveReverse(); expect(fromPlacement).toHaveBeenLastCalledWith(finalCandidate); });
        it("coalesces many pointerMove pixels with requestAnimationFrame", async () => { await pointerMoveMany(100); expect(createPlacementCandidate).toHaveBeenCalledTimes(2); });
        it("uses server round across half-cell threshold where floor would share same cell", async () => { await pointerMove(0.49); await pointerMove(0.51); expect(createPlacementCandidate).toHaveBeenCalledTimes(2); });
        it("refreshes expired cache after stationary long drag 15_000 ms before final pointer drop commit", async () => { const oldCandidate = await dragOver(); clock.advance(15_000); fireEvent.pointerUp(document); await DragEnd(); expect(finalCandidate.candidateId).not.toEqual(oldCandidate.candidateId); expect(fromPlacement).toHaveBeenCalled(); });
        it("does not drop DragEnd final request while awaiting last candidate", async () => { const pending = DragEnd(finalPointer); await resolveLastCandidate(); await pending; expect(fromPlacement).toHaveBeenCalled(); });
        it("keeps fresh visible candidateId for drop in same final cell", async () => { const visibleCandidate = await dragOver(sameCell); await DragEnd(sameCell); expect(fromPlacement).toHaveBeenLastCalledWith(expect.objectContaining({ candidateId: visibleCandidate.candidateId })); });
        it("isolates Cancel Enter from candidate parent commit", async () => { await user.keyboard("{Enter}", cancelButton); expect(screen.getByTestId("placement-placeholder")).toBeVisible(); expect(fromPlacement).not.toHaveBeenCalled(); });
        it("cancels candidate placement when the focused child commit button receives Escape", async () => { commitButton.focus(); fireEvent.keyDown(commitButton, { key: "Escape" }); expect(screen.queryByTestId("placement-placeholder")).toBeNull(); expect(fromPlacement).toHaveBeenCalledTimes(0); });
        it("cancels keyboard placement when the Cancel action is pointer clicked", async () => { await user.click(cancelButton); expect(screen.queryByTestId("placement-placeholder")).not.toBeInTheDocument(); expect(fromPlacement).not.toHaveBeenCalled(); });
        it("commits keyboard placement when the 배치 action is pointer clicked", async () => { await user.click(commitButton); expect(fromPlacement).toHaveBeenCalledTimes(1); expect(screen.getByTestId("placed-element-1")).toBeInTheDocument(); });
        it("does not reuse a valid right edge candidate for one pixel outside in the same clamped cell", async () => { await pointer.drag(palette, rightEdge); expect(screen.getByTestId("placement-placeholder")).toHaveAttribute("data-valid", "true"); await pointer.move(rightEdgePlusOnePixel); expect(screen.getByTestId("placement-placeholder")).toHaveAttribute("data-valid", "false"); expect(createPlacementCandidate).toHaveBeenCalledTimes(2); expect(fromPlacement).not.toHaveBeenCalled(); });
        it("clears multi selection with global document Escape", async () => { selectTwoElements(); fireEvent.keyDown(document, { key: "Escape" }); expect(screen.queryAllByRole("option", { selected: true })).toHaveLength(0); });
        it("deletes 2 selected elements sequentially from global canvas Delete with revision chaining", async () => { const first = deferFirstDelete(); selectTwoElements(); fireEvent.keyDown(canvas, { key: "Delete" }); expect(deleteElement).toHaveBeenCalledTimes(1); first.resolve(); await waitForSecondDelete(); expect(deleteElement).toHaveBeenCalledTimes(2); expect(screen.queryAllByRole("option")).toHaveLength(0); });
        it("classifies 409 ELEMENT_COLLISION separately from 변경 충돌", async () => { rejectNext(new ElementsApiError("collision", { status: 409, code: "ELEMENT_COLLISION" })); await drop(); expect(alert).toHaveTextContent("엘리먼트 충돌"); expect(alert).not.toHaveTextContent("변경 충돌"); });
        it("blocks locked delete control before API", async () => { expect(lockedDeleteControl).toBeDisabled(); fireEvent.keyDown(lockedElement, { key: "Delete" }); expect(deleteElement).not.toHaveBeenCalled(); });
        it("blocks multi selected Delete containing locked element with no partial write and keeps 2 unchanged", async () => { selectTwoElements({ locked: true }); fireEvent.keyDown(document, { key: "Delete" }); expect(deleteElement).toHaveBeenCalledTimes(0); expect(screen.getAllByRole("option")).toHaveLength(2); });
        it("keeps delayed stale projectRevision read from lowering the newer monotonic revision", async () => { setProjectRevision(12); resolveDelayedProjectRevision(10); expect(currentProjectRevision()).toBe(12); });
        it("keeps delayed stale same-page layoutRevision read from lowering the newer revision used by the next write", async () => { setLayoutRevision(12); resolveDelayedPageLayoutRevision(10); await nextWrite(); expect(lastWrite()).toMatchObject({ expectedLayoutRevision: 12 }); });
        it("keyboard ArrowRight into occupied 2 element collision compacts pairwise without overlap in one COMPLETE batch", async () => { fireEvent.keyDown(firstElement, { key: "ArrowRight" }); expect(batchElementLayout).toHaveBeenCalledTimes(1); expect(lastBatch()).toMatchObject({ mode: "COMPLETE" }); expect(pairwiseOverlap(lastBatch().items)).toBe(false); });
        it("does not move the parent when a nested lock control is focused and receives ArrowRight", async () => { lockControl.focus(); fireEvent.keyDown(lockControl, { key: "ArrowRight" }); expect(batchElementLayout).toHaveBeenCalledTimes(0); expect(element).toHaveAttribute("data-x", "4"); });
        it("keeps persisted server layout y 12 transform and inspector data-y canonical with no mount save", () => { renderPersisted({ y: 12 }); expect(element.getBoundingClientRect().y).toBe(computedY(12)); expect(inspector).toHaveAttribute("data-y", "12"); expect(batchElementLayout).not.toHaveBeenCalled(); });
        it("keeps the element-canvas-viewport as both-axis overflow owner at 200% zoom without page scroll growth", () => { const baselinePage = document.body.scrollHeight; setZoom(2); expect(viewport.scrollWidth).toBeGreaterThan(viewport.clientWidth); expect(viewport.scrollHeight).toBeGreaterThan(viewport.clientHeight); scrollViewport({ left: 120, top: 180 }); expect(viewport.scrollLeft).toBeGreaterThan(0); expect(viewport.scrollTop).toBeGreaterThan(0); expect(document.body.scrollHeight).toBe(baselinePage); });
        it("measures exact placement-placeholder and placed-element geometry", () => { const preview = placeholder.getBoundingClientRect(); const placed = element.getBoundingClientRect(); expect(preview).toEqual(placed); });
        it("measures all 4 Palette sibling control geometry", () => { const rects = fourPaletteButtons.map((button) => button.getBoundingClientRect()); expect(rects.map((r) => [r.height, r.width])).toEqual([[40,120],[40,120],[40,120],[40,120]]); });
        it("measures Canvas sibling zoom and grid control geometry", () => { const rects = canvasSiblingControls.map((control) => control.getBoundingClientRect()); expect(rects.map((r) => [r.height, r.width])).toEqual([[32,120],[32,120]]); });
        it("removes overlay motion but keeps placeholder under reduced-motion", () => { setMedia("prefers-reduced-motion"); expect(screen.getByTestId("placement-placeholder")).toBeVisible(); });
        it("exposes accessible palette aria role and keyboard focus", async () => { expect(screen.getByRole("button", { name: /Text/ })).toHaveFocus(); });
        it("tabs focus across palette elements", async () => { await user.tab(); expect(screen.getByTestId("palette-item-text")).toHaveFocus(); });
        it("saves once after many drag pointerMove events", async () => { await pointerMoveMany(); expect(updateElement).toHaveBeenCalledTimes(1); });
        it("saves once after many resize pointerMove events", async () => { await resizePointerMoveMany(); expect(updateElement).toHaveBeenCalledTimes(1); });
        it("renders real persisted ElementRenderer after reload GET listElements", async () => { rerender(<ElementCanvas />); expect(await screen.findByTestId("placed-element-1")).toHaveTextContent("Text"); });
        it("selects element on pointer click", async () => { await user.click(element); expect(element).toHaveAttribute("data-selected", "true"); });
        it("moves ArrowRight one grid and Shift ArrowRight four grid", async () => { fireEvent.keyDown(canvas,{key:"ArrowRight"}); fireEvent.keyDown(canvas,{key:"ArrowRight",shiftKey:true}); expect(move).toHaveBeenCalledWith(4); });
        it("Escape cancels active Palette drag overlay without commit", () => { fireEvent.keyDown(document,{key:"Escape"}); expect(overlay).not.toBeInTheDocument(); expect(fromPlacement).not.toHaveBeenCalled(); });
        it("Escape cancels active RGL Canvas drag and rolls back original layout with no save", () => { fireEvent.keyDown(canvas,{key:"Escape"}); expect(element.layout).toEqual(originalLayout); expect(batchElementLayout).not.toHaveBeenCalled(); });
        it("Escape cancels active resize and rolls back original size with no save", () => { fireEvent.keyDown(resizeHandle,{key:"Escape"}); expect(element.layout).toEqual(originalLayout); expect(batchElementLayout).not.toHaveBeenCalled(); });
        it("Escape clears selected Element selection", () => { fireEvent.keyDown(element,{key:"Escape"}); expect(element).toHaveAttribute("aria-selected", "false"); });
        it("single selected Delete removes exactly one element", () => { fireEvent.keyDown(canvas,{key:"Delete"}); expect(deleteElement).toHaveBeenCalledTimes(1); });
        ${REQUIRED_RESIZE_HANDLES.map(
          (handle) =>
            `it("resizes with resize-handle-${handle}", async () => { await pointer.drag(screen.getByTestId("resize-handle-${handle}")); expect(updateElement).toHaveBeenCalledTimes(1); });`,
        ).join("\n")}
        ${[50, 75, 100, 125, 150, 200]
          .map(
            (zoom) =>
              `it("normalizes candidate at zoom ${zoom}%", () => { expect(candidateAtZoom(${zoom})).toEqual(expected); });`,
          )
          .join("\n")}
        it("corrects horizontal scrollLeft", () => { viewport.scrollLeft=80; expect(candidate()).toEqual(expected); });
        it("corrects vertical scrollTop", () => { viewport.scrollTop=80; expect(candidate()).toEqual(expected); });
        it("clips left right top bottom boundary", () => { expect(boundaryPreview()).toEqual(expected); });
        it("creates pointer placement candidate", () => { expect(pointerCandidate()).toEqual(expected); });
        it("creates keyboard placement candidate", () => { expect(keyboardCandidate()).toEqual(expected); });
      `,
    ),
  ];
}

describe("Phase 5 validation infrastructure", () => {
  it("validates the complete local Phase 5 implementation and evidence contract", async () => {
    const report = await validatePhase5();
    assert.equal(
      report.result,
      "PASS",
      JSON.stringify(report.failures, null, 2),
    );
    assert.equal(report.details.canonicalRouteCount, 7);
    assert.equal(report.details.registeredCanonicalRoutes, 7);
    assert.equal(report.details.requiredTableCount, 4);
    assert.equal(report.details.presentTableCount, 4);
    assert.deepEqual(
      report.details.requiredResizeHandles,
      REQUIRED_RESIZE_HANDLES,
    );
    assert.equal(report.details.phase4RegressionResult, "PASS");
    assert.equal(report.details.requiredEvidencePath, PHASE5_EVIDENCE_PATH);
    assert.equal(
      report.details.browserGeometryEvidencePath,
      PHASE5_BROWSER_GEOMETRY_EVIDENCE_PATH,
    );
    assert.ok(
      REQUIRED_PHASE5_TEST_CAPABILITIES.every(
        (capability) => report.details.testInventory.capabilities[capability],
      ),
    );
  });

  it("pins unique canonical inventories", () => {
    assert.equal(new Set(CANONICAL_PHASE5_ROUTES.map(routeKey)).size, 7);
    assert.equal(new Set(REQUIRED_PHASE5_REQUIREMENTS).size, 3);
    assert.equal(Object.keys(REQUIRED_ELEMENT_TABLES).length, 4);
    assert.equal(new Set(REQUIRED_RESIZE_HANDLES).size, 8);
    assert.equal(new Set(REQUIRED_PHASE5_TEST_CAPABILITIES).size, 44);
  });

  it("rejects unequal or non-operational browser geometry evidence", () => {
    const evidence = {
      result: "PASS",
      target: "isolated local browser session",
      url: "http://127.0.0.1:45174/",
      generatedAt: "2026-08-16T01:21:04+09:00",
      projectSiblingControlRects: [
        { width: 208, height: 48 },
        { width: 208, height: 48 },
      ],
      paletteSiblingRects: Array.from({ length: 4 }, () => ({
        width: 88.609375,
        height: 76,
      })),
      canvasSiblingControlRects: [
        { width: 96, height: 40 },
        { width: 96, height: 40 },
      ],
      zoomOverflowOwnership: {
        zoom: 2,
        viewportWidth: 1280,
        viewportHeight: 720,
        clientWidth: 640,
        scrollWidth: 1920,
        clientHeight: 460,
        scrollHeight: 1376,
        scrollLeftAfter: 120,
        scrollTopAfter: 180,
        pageScrollWidthBefore: 1280,
        pageScrollWidthAfter: 1280,
        pageScrollHeightBefore: 720,
        pageScrollHeightAfter: 720,
      },
      previewCommitGeometry: {
        candidate: {
          layout: { x: 0, y: 10, w: 6, h: 5 },
          canvasDocumentRelativeRect: {
            x: 17,
            y: 225,
            width: 226,
            height: 72,
          },
          valid: true,
        },
        committed: {
          layout: { x: 0, y: 10, w: 6, h: 5 },
          canvasDocumentRelativeRect: {
            x: 17,
            y: 225,
            width: 226,
            height: 72,
          },
        },
      },
    };
    assert.ok(
      Object.values(inspectBrowserGeometryEvidence(evidence)).every(Boolean),
    );

    const unequalSibling = globalThis.structuredClone(evidence);
    unequalSibling.paletteSiblingRects[3].height = 75;
    assert.equal(
      inspectBrowserGeometryEvidence(unequalSibling).paletteSiblingGeometry,
      false,
    );

    const layoutDrift = globalThis.structuredClone(evidence);
    layoutDrift.previewCommitGeometry.committed.layout.y = 9;
    assert.equal(
      inspectBrowserGeometryEvidence(layoutDrift).previewCommitLayoutExact,
      false,
    );

    const rectDrift = globalThis.structuredClone(evidence);
    rectDrift.previewCommitGeometry.committed.canvasDocumentRelativeRect.x = 18;
    assert.equal(
      inspectBrowserGeometryEvidence(rectDrift).previewCommitMeasuredRectExact,
      false,
    );

    const synthetic = globalThis.structuredClone(evidence);
    synthetic.target = "unit fixture";
    synthetic.url = "about:blank";
    assert.equal(
      inspectBrowserGeometryEvidence(synthetic).operationalPass,
      false,
    );

    const pageOwnsOverflow = globalThis.structuredClone(evidence);
    pageOwnsOverflow.zoomOverflowOwnership.scrollHeight =
      pageOwnsOverflow.zoomOverflowOwnership.clientHeight;
    assert.equal(
      inspectBrowserGeometryEvidence(pageOwnsOverflow)
        .bidirectionalViewportOverflow,
      false,
    );
  });

  it("extracts typed, object, and direct routes", () => {
    const routes = extractRouteInventory(`
      server.get("/api/v1/pages/:pageId/elements", handler);
      server.patch<{ Params: Params }>("/api/v1/elements/:elementId", handler);
      server.route({ method: "POST", url: "/api/v1/elements/batch-layout", handler });
    `);
    assert.deepEqual(routes.map(routeKey), [
      "GET /api/v1/pages/:pageId/elements",
      "PATCH /api/v1/elements/:elementId",
      "POST /api/v1/elements/batch-layout",
    ]);
  });

  it("rejects every missing or unexpected Phase 5 route", () => {
    for (const omitted of CANONICAL_PHASE5_ROUTES) {
      const inspection = inspectCanonicalRouteContract([
        sourceFile(
          "apps/server/src/routes/elements.ts",
          CANONICAL_PHASE5_ROUTES.filter((route) => route !== omitted)
            .map(
              ({ method, path }) =>
                `server.${method.toLowerCase()}("${path}", handler);`,
            )
            .join("\n"),
        ),
      ]);
      assert.deepEqual(inspection.missingRoutes.map(routeKey), [
        routeKey(omitted),
      ]);
    }
    const extra = inspectCanonicalRouteContract([
      sourceFile(
        "apps/server/src/routes/elements.ts",
        `${completeRoutes}\nserver.post("/api/v1/elements/recompute-drop", handler);`,
      ),
    ]);
    assert.deepEqual(extra.unexpectedRoutes.map(routeKey), [
      "POST /api/v1/elements/recompute-drop",
    ]);
  });

  it("rejects weakened SQLite v4 constraints and ownership", () => {
    const baseline = inspectElementSchema(completeSchema);
    assert.ok(
      Object.entries(baseline)
        .filter(([key]) => key !== "tables")
        .every(([, value]) => value === true),
      JSON.stringify(baseline, null, 2),
    );
    const mutations = [
      [
        "future version",
        completeSchema.replace(
          "userVersion > LATEST_METADATA_SCHEMA_VERSION",
          "false",
        ),
        "futureVersionFailClosed",
      ],
      [
        "page ownership",
        completeSchema.replace(
          "FOREIGN KEY (page_id, project_id) REFERENCES pages(id, project_id)",
          "",
        ),
        "pageLayoutOwnsProjectAndPage",
      ],
      [
        "element lock",
        completeSchema.replace("CHECK (locked IN (0, 1))", ""),
        "elementLockBoolean",
      ],
      [
        "desktop boundary",
        completeSchema.replace("x + w <= 24", "x + w <= 240"),
        "layoutGeometryConstrained",
      ],
      [
        "command idempotency",
        completeSchema.replace("UNIQUE(project_id, idempotency_key)", ""),
        "commandIdempotencyConstrained",
      ],
      [
        "5xx replay poison",
        completeSchema.replace(
          "response_status BETWEEN 200 AND 499",
          "response_status BETWEEN 200 AND 599",
        ),
        "commandResponseExcludesFiveHundreds",
      ],
      [
        "new Page trigger",
        completeSchema.replace(
          "CREATE TRIGGER pages_initialize_layout_revision",
          "CREATE TRIGGER unrelated_trigger",
        ),
        "newPagesSeedLayoutRevision",
      ],
    ];
    for (const [label, source, property] of mutations) {
      assert.equal(inspectElementSchema(source)[property], false, label);
    }
  });

  it("rejects unbounded, persistent, or non-expiring candidate stores", () => {
    const files = [
      sourceFile(
        "apps/server/src/elements/placement-candidate-store.ts",
        completeCandidateStore,
      ),
      sourceFile(
        "apps/server/src/elements/element-service.ts",
        completeCandidateService,
      ),
      sourceFile(
        "apps/server/src/routes/elements.ts",
        completeFromPlacementRoute,
      ),
    ];
    const baseline = inspectCandidateProtocol(files);
    for (const property of [
      "storeClass",
      "exactTtl",
      "exactCapacity",
      "boundedMap",
      "purgesExpired",
      "memoryOnly",
      "candidateBinding",
      "serverGridConstants",
      "serverOwnsCoordinateConversion",
      "serverOwnsRegistryLimits",
      "clampsBoundary",
      "outOfBoundsIsInvalid",
      "verticalBoundaryBound",
      "serverVerticalCompaction",
      "deterministicNearestCollision",
      "fromPlacementForbidsGeometry",
      "fromPlacementHasExpectedRevisions",
      "consumesOneTime",
      "replayBeforeConsume",
      "rejectsExpired",
      "rejectsStale",
      "rejectsCrossPage",
      "noCommitRecompute",
      "candidateResponseComplete",
    ]) {
      assert.equal(baseline[property], true, property);
    }
    const unbounded = files.map((file) => ({
      ...file,
      source: file.source.replace(
        "PLACEMENT_CANDIDATE_CAPACITY = 512",
        "PLACEMENT_CANDIDATE_CAPACITY = Infinity",
      ),
    }));
    assert.equal(inspectCandidateProtocol(unbounded).exactCapacity, false);
    const persistent = files.map((file) => ({
      ...file,
      source: file.source.replace(
        "export class PlacementCandidateStore",
        'database.prepare("INSERT INTO placement_candidates VALUES (?)"); export class PlacementCandidateStore',
      ),
    }));
    assert.equal(inspectCandidateProtocol(persistent).memoryOnly, false);
    const noPurge = files.map((file) => ({
      ...file,
      source: file.source
        .replaceAll(
          "this.#candidates.delete(candidate.candidateId)",
          "retain(candidate.candidateId)",
        )
        .replaceAll("this.#candidates.delete(id)", "retain(id)"),
    }));
    assert.equal(inspectCandidateProtocol(noPurge).purgesExpired, false);
    const geometryCommit = files.map((file) => ({
      ...file,
      source: file.source.replace(
        '"candidateId", "expectedLayoutRevision"',
        '"candidateId", "x", "expectedLayoutRevision"',
      ),
    }));
    assert.equal(
      inspectCandidateProtocol(geometryCommit).fromPlacementForbidsGeometry,
      false,
    );
    const alwaysValid = files.map((file) => ({
      ...file,
      source: file.source.replace(
        "valid: correctedCanvasX >= 0 && correctedCanvasX <= request.canvasWidth && correctedCanvasY >= 0",
        "valid: true",
      ),
    }));
    assert.equal(
      inspectCandidateProtocol(alwaysValid).outOfBoundsIsInvalid,
      false,
    );
    const noBottomBoundary = files.map((file) => ({
      ...file,
      source: file.source
        .replace(" && correctedCanvasY <= request.canvasHeight", "")
        .replace(" && candidatePixelBottom <= request.canvasHeight", ""),
    }));
    assert.equal(
      inspectCandidateProtocol(noBottomBoundary).verticalBoundaryBound,
      false,
    );
    const noVerticalCompaction = files.map((file) => ({
      ...file,
      source: file.source.replaceAll("compactPlacement", "preservePointerRow"),
    }));
    assert.equal(
      inspectCandidateProtocol(noVerticalCompaction).serverVerticalCompaction,
      false,
    );
  });

  it("rejects dnd/RGL ownership mixing and incomplete resize handles", () => {
    const files = [
      sourceFile(
        "apps/web/src/features/pages/PageManager.tsx",
        completePageManagerFrontend,
      ),
      sourceFile("apps/web/src/App.tsx", completeAppFrontend),
      sourceFile(
        "apps/web/src/features/elements/ElementWorkspace.tsx",
        completeWorkspaceFrontend,
      ),
      sourceFile(
        "apps/web/src/features/elements/ElementCanvas.tsx",
        completeCanvasFrontend,
      ),
      sourceFile(
        "apps/web/src/features/elements/ElementRenderer.tsx",
        completeRendererFrontend,
      ),
      sourceFile("apps/web/src/services/elements-api.ts", completeApiFrontend),
      sourceFile(
        "apps/web/src/styles.css",
        '.editor-workspace { height: calc(100vh - 10rem); min-height: 0; } .editor-main { min-height: 0; overflow: hidden; } .element-canvas-viewport { min-width: 0; min-height: 0; overflow: auto; } .element-canvas-zoom-shell { width: calc(960px * var(--canvas-zoom)); min-height: calc(640px * var(--canvas-zoom)); } .placement-placeholder { pointer-events: none; } .placement-placeholder[role="group"] { pointer-events: auto; } @media (prefers-reduced-motion: reduce) { .palette-drag-overlay { transform: none; } .placement-placeholder { opacity: .5; } }',
      ),
      sourceFile(
        "apps/web/package.json",
        '{"dependencies":{"react-grid-layout":"2.2.4"}}',
      ),
    ];
    const baseline = inspectFrontendCanvasImplementation(files);
    assert.equal(baseline.dndKitPaletteOnly, true);
    assert.equal(baseline.controlledReactGridLayout, true);
    assert.equal(baseline.reactGridLayoutV2, true);
    assert.equal(baseline.allEightResizeHandles, true);
    assert.equal(baseline.requiredTestIds, true);
    assert.equal(baseline.viewportOwnsBidirectionalOverflow, true);
    assert.equal(baseline.compactionPersistsCompleteLayout, true);
    assert.equal(baseline.candidateRequestsCoalesced, true);
    assert.equal(baseline.candidateKeyMatchesServerRounding, true);
    assert.equal(baseline.expiredCandidateCacheRefresh, true);
    assert.equal(baseline.validSelectionSemantics, true);
    assert.equal(baseline.singleDroppableRefRegistration, true);
    assert.equal(baseline.freshDropReusesVisibleCandidate, true);
    assert.equal(baseline.candidateKeyIncludesBounds, true);
    assert.equal(baseline.candidateControlKeysIsolated, true);
    assert.equal(baseline.distinguishesCollisionFromConcurrency, true);
    assert.equal(baseline.lockedDeletePreflight, true);
    assert.equal(baseline.monotonicProjectRevision, true);
    assert.equal(baseline.candidateActionsPointerEnabled, true);
    assert.equal(baseline.canonicalLayoutUncompactedOnRender, true);
    assert.equal(baseline.candidateRequestsMeasuredHeight, true);
    const mixed = files.map((file) => ({
      ...file,
      source: /ElementCanvas/u.test(file.path)
        ? `import { DndContext } from "@dnd-kit/core";\n${file.source}`
        : file.source,
    }));
    assert.equal(
      inspectFrontendCanvasImplementation(mixed).dndKitPaletteOnly,
      false,
    );
    const noKeyboardPlacement = files.map((file) => ({
      ...file,
      source: file.source.replaceAll("KeyboardSensor", "RemovedSensor"),
    }));
    assert.equal(
      inspectFrontendCanvasImplementation(noKeyboardPlacement)
        .dndKitPaletteOnly,
      false,
    );
    const legacyRgl = files.map((file) => ({
      ...file,
      source: file.source.replace(
        '"react-grid-layout":"2.2.4"',
        '"react-grid-layout":"1.5.2"',
      ),
    }));
    assert.equal(
      inspectFrontendCanvasImplementation(legacyRgl).reactGridLayoutV2,
      false,
    );
    const seven = files.map((file) => ({
      ...file,
      source: file.source.replace('"se","sw"', '"se"'),
    }));
    assert.equal(
      inspectFrontendCanvasImplementation(seven).allEightResizeHandles,
      false,
    );
    const singlePatch = files.map((file) => ({
      ...file,
      source: file.source.replaceAll("batchElementLayout", "updateElement"),
    }));
    assert.equal(
      inspectFrontendCanvasImplementation(singlePatch)
        .compactionPersistsCompleteLayout,
      false,
    );
    const perPixelRequests = files.map((file) => ({
      ...file,
      source: /ElementWorkspace/u.test(file.path)
        ? file.source
            .replace(
              "if (candidateCell !== pointer.gridCell) requestCandidate(pointer); candidateCell = pointer.gridCell;",
              "requestCandidate(pointer); candidateCell = pointer.gridCell;",
            )
            .replaceAll("requestAnimationFrame", "runImmediately")
        : file.source,
    }));
    assert.equal(
      inspectFrontendCanvasImplementation(perPixelRequests)
        .candidateRequestsCoalesced,
      false,
    );
    const flooredKey = files.map((file) => ({
      ...file,
      source: /ElementWorkspace/u.test(file.path)
        ? file.source.replace("Math.round", "Math.floor")
        : file.source,
    }));
    assert.equal(
      inspectFrontendCanvasImplementation(flooredKey)
        .candidateKeyMatchesServerRounding,
      false,
    );
    const immortalCache = files.map((file) => ({
      ...file,
      source: /ElementWorkspace/u.test(file.path)
        ? file.source
            .replace(
              "Date.parse(cached.candidate.expiresAt) - Date.now() > minimumValidityMargin",
              "true",
            )
            .replace(
              "requestCandidate(event.finalPointer, { force: true })",
              "requestCandidate(event.finalPointer)",
            )
        : file.source,
    }));
    assert.equal(
      inspectFrontendCanvasImplementation(immortalCache)
        .expiredCandidateCacheRefresh,
      false,
    );

    const forcedFreshDrop = files.map((file) => ({
      ...file,
      source: file.source.replace(
        "requestCandidate(event.finalPointer)",
        "requestCandidate(event.finalPointer, { force: true })",
      ),
    }));
    assert.equal(
      inspectFrontendCanvasImplementation(forcedFreshDrop)
        .freshDropReusesVisibleCandidate,
      false,
    );

    const noBoundsDiscriminator = files.map((file) => ({
      ...file,
      source: file.source.replace(
        "[snappedColumn, inBounds, canvasHeight]",
        "[snappedColumn]",
      ),
    }));
    assert.equal(
      inspectFrontendCanvasImplementation(noBoundsDiscriminator)
        .candidateKeyIncludesBounds,
      false,
    );

    const bubblingCandidateActions = files.map((file) => ({
      ...file,
      source: file.source.replace(
        'event.key === "Escape" || event.target === event.currentTarget',
        "true",
      ),
    }));
    assert.equal(
      inspectFrontendCanvasImplementation(bubblingCandidateActions)
        .candidateControlKeysIsolated,
      false,
    );

    const childEscapeDropped = files.map((file) => ({
      ...file,
      source: file.source.replace(
        'event.key === "Escape" || event.target === event.currentTarget',
        "event.target === event.currentTarget",
      ),
    }));
    assert.equal(
      inspectFrontendCanvasImplementation(childEscapeDropped)
        .candidateChildEscapeRouted,
      false,
    );

    const nestedArrowBubbles = files.map((file) => ({
      ...file,
      source: file.source.replace(
        "if (event.target !== event.currentTarget) return;",
        "",
      ),
    }));
    assert.equal(
      inspectFrontendCanvasImplementation(nestedArrowBubbles)
        .nestedControlKeyIsolation,
      false,
    );

    const regressingLayoutRevision = files.map((file) => ({
      ...file,
      source: file.source.replace(
        "Math.max(current.layoutRevision, nextLayoutRevision)",
        "nextLayoutRevision",
      ),
    }));
    assert.equal(
      inspectFrontendCanvasImplementation(regressingLayoutRevision)
        .monotonicPageLayoutRevision,
      false,
    );

    const unclickableCandidateActions = files.map((file) => ({
      ...file,
      source: file.source.replace(
        '.placement-placeholder[role="group"]',
        '.placement-placeholder[role="button"]',
      ),
    }));
    assert.equal(
      inspectFrontendCanvasImplementation(unclickableCandidateActions)
        .candidateActionsPointerEnabled,
      false,
    );

    const mountCompaction = files.map((file) => ({
      ...file,
      source: file.source.replace(
        "compactor={noCompactor}",
        "compactor={verticalCompactor}",
      ),
    }));
    assert.equal(
      inspectFrontendCanvasImplementation(mountCompaction)
        .canonicalLayoutUncompactedOnRender,
      false,
    );

    const pageOwnsVerticalOverflow = files.map((file) => ({
      ...file,
      source: file.source.replace(
        ".editor-main { min-height: 0; overflow: hidden; }",
        ".editor-main { min-height: auto; overflow: visible; }",
      ),
    }));
    assert.equal(
      inspectFrontendCanvasImplementation(pageOwnsVerticalOverflow)
        .viewportOwnsBidirectionalOverflow,
      false,
    );

    const genericConflict = files.map((file) => ({
      ...file,
      source: file.source.replace(
        'reason.code === "ELEMENT_COLLISION"',
        "reason.status === 409",
      ),
    }));
    assert.equal(
      inspectFrontendCanvasImplementation(genericConflict)
        .distinguishesCollisionFromConcurrency,
      false,
    );

    const unlockedDeleteControl = files.map((file) => ({
      ...file,
      source: file.source.replace(
        "disabled={locked || mutating}",
        "disabled={mutating}",
      ),
    }));
    assert.equal(
      inspectFrontendCanvasImplementation(unlockedDeleteControl)
        .lockedDeletePreflight,
      false,
    );

    const regressingRevision = files.map((file) => ({
      ...file,
      source: file.source.replace(
        "Math.max(current.revision, revision)",
        "revision",
      ),
    }));
    assert.equal(
      inspectFrontendCanvasImplementation(regressingRevision)
        .monotonicProjectRevision,
      false,
    );

    const widthOnlyCandidate = files.map((file) => ({
      ...file,
      source: /services\/elements-api/u.test(file.path)
        ? file.source.replace(", canvasHeight: input.canvasHeight", "")
        : file.source,
    }));
    assert.equal(
      inspectFrontendCanvasImplementation(widthOnlyCandidate)
        .candidateRequestsMeasuredHeight,
      false,
    );
  });

  it("rejects delete implementations that look up only active rows before replay", () => {
    const safe = sourceFile(
      "apps/server/src/elements/element-service.ts",
      `
        class ElementService {
          delete(elementId, request) {
            const element = this.repository.get(elementId);
            const replay = this.#replay(projectId, request.idempotencyKey, hash);
            if (replay) return replay;
            const active = this.#activeElement(elementId);
            return this.repository.tombstone(active.id);
          }
          batchLayout() {}
        }
      `,
    );
    assert.equal(
      inspectLayoutProtocol([safe]).deleteReplaysBeforeActiveLookup,
      true,
    );
    const unsafe = {
      ...safe,
      source: safe.source.replace(
        "const replay = this.#replay(projectId, request.idempotencyKey, hash);",
        "const activeBeforeReplay = this.#activeElement(elementId); const replay = this.#replay(projectId, request.idempotencyKey, hash);",
      ),
    };
    assert.equal(
      inspectLayoutProtocol([unsafe]).deleteReplaysBeforeActiveLookup,
      false,
    );
  });

  it("requires executable behavior and rejects keyword-only evidence", () => {
    const fixtures = behavioralTestFixtures();
    const baseline = inspectPhase5TestInventory(fixtures);
    for (const capability of REQUIRED_PHASE5_TEST_CAPABILITIES) {
      assert.equal(baseline.capabilities[capability], true, capability);
    }
    const keywordOnly = fixtures.map((file) => ({
      ...file,
      source: file.source
        .replaceAll(/\bit\s*\(/gu, "document(")
        .replaceAll(/\bexpect\s*\(/gu, "record("),
    }));
    const rejected = inspectPhase5TestInventory(keywordOnly);
    assert.deepEqual(rejected.behavioralPaths, []);
    assert.ok(
      REQUIRED_PHASE5_TEST_CAPABILITIES.every(
        (capability) => !rejected.capabilities[capability],
      ),
    );
  });

  it("recognizes executable parameterized handle tests", () => {
    const parameterized = sourceFile(
      "apps/web/src/features/elements/ElementCanvas.test.tsx",
      `
        const resizeCases = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];
        it.each(resizeCases)("persists resize-handle-%s", async (handle) => {
          await pointer.drag(screen.getByTestId(\`resize-handle-\${handle}\`));
          expect(batchElementLayout).toHaveBeenCalledTimes(1);
        });
      `,
    );
    assert.equal(
      inspectPhase5TestInventory([parameterized]).resizeHandleCoverage,
      true,
    );
    assert.equal(
      inspectPhase5TestInventory([
        {
          ...parameterized,
          source: parameterized.source.replace("expect(", "record("),
        },
      ]).resizeHandleCoverage,
      false,
    );
  });

  it("rejects unmeasured geometry and save-storm evidence", () => {
    const fixtures = behavioralTestFixtures();
    const noRect = fixtures.map((file) => ({
      ...file,
      source: file.source.replaceAll("getBoundingClientRect", "readLayout"),
    }));
    assert.equal(
      inspectPhase5TestInventory(noRect).capabilities[
        "measured-placeholder-and-control-geometry"
      ],
      false,
    );
    const hardCodedRectMock = fixtures.map((file) => ({
      ...file,
      source: /apps\/web\/src\//u.test(file.path)
        ? `vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({ width: 120, height: 40 }));\n${file.source}`
        : file.source,
    }));
    assert.equal(
      inspectPhase5TestInventory(hardCodedRectMock).capabilities[
        "measured-placeholder-and-control-geometry"
      ],
      false,
    );
    const noCount = fixtures.map((file) => ({
      ...file,
      source: file.source.replaceAll(
        "toHaveBeenCalledTimes(1)",
        "toHaveBeenCalled()",
      ),
    }));
    assert.equal(
      inspectPhase5TestInventory(noCount).capabilities[
        "single-save-after-drag-or-resize"
      ],
      false,
    );
    const pointerDownOnly = fixtures.map((file) => ({
      ...file,
      source: file.source
        .replaceAll("await pointer.drag", "fireEvent.pointerDown")
        .replaceAll("updateElement", "renderedHandle"),
    }));
    assert.equal(
      inspectPhase5TestInventory(pointerDownOnly).capabilities[
        "eight-resize-handles-minmax-and-lock"
      ],
      false,
    );
  });
});
