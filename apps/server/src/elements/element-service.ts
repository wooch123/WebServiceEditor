import { createHash, randomUUID } from "node:crypto";

import {
  BATCH_LAYOUT_MODES,
  CANVAS_GRID,
  type BatchLayoutItem,
  type BatchLayoutRequest,
  type CreateElementFromPlacementRequest,
  type CreateElementRequest,
  type CreatePlacementCandidateRequest,
  type DeleteElementRequest,
  type ElementEntryDto,
  type ElementListDto,
  type ElementMutationDto,
  type PatchElementRequest,
  type PlacementCandidateDto,
} from "@webeditor/domain";

import { ApiError, assertApi } from "../errors.js";
import type { MetadataDatabase } from "../metadata/database.js";
import { PageRepository, type PageRow } from "../pages/page-repository.js";
import {
  ProjectRepository,
  type ProjectRow,
} from "../projects/project-repository.js";
import {
  ElementRepository,
  type ElementCommandRow,
} from "./element-repository.js";
import {
  assertGridInteger,
  clampMove,
  elementDefinition,
  layoutLimits,
  normalizeResize,
  rectanglesOverlap,
  resizeHandle,
  type GridRectangle,
} from "./element-registry.js";
import {
  PlacementCandidateStore,
  publicCandidate,
} from "./placement-candidate-store.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const batchModeSet = new Set<string>(BATCH_LAYOUT_MODES);

export interface ElementServiceOptions {
  readonly metadataDatabase: MetadataDatabase;
  readonly clock?: () => Date;
  readonly candidateStore?: PlacementCandidateStore;
  readonly failureInjector?: ElementFailureInjector;
}

export type ElementFailurePoint = "element:add-before-command";
export type ElementFailureInjector = (point: ElementFailurePoint) => void;

interface ElementPageContext {
  readonly page: PageRow;
  readonly project: ProjectRow;
  readonly layoutRevision: number;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

function commandHash(
  operation: string,
  scopeId: string,
  request: unknown,
): string {
  return createHash("sha256")
    .update(stableJson({ operation, scopeId, request }))
    .digest("hex");
}

function assertUuid(
  value: unknown,
  code: string,
  label: string,
): asserts value is string {
  assertApi(
    typeof value === "string" && UUID_PATTERN.test(value),
    400,
    code,
    `${label} is invalid`,
  );
}

function expectedRevision(value: unknown, code: string): number {
  assertApi(
    Number.isSafeInteger(value) && (value as number) >= 0,
    400,
    code,
    "Revision is invalid",
  );
  return value as number;
}

function idempotencyKey(value: unknown): string {
  assertApi(
    typeof value === "string" && value.length >= 8 && value.length <= 200,
    400,
    "INVALID_IDEMPOTENCY_KEY",
    "Idempotency key is invalid",
  );
  return value;
}

function finiteNumber(value: unknown): number {
  assertApi(
    typeof value === "number" && Number.isFinite(value),
    400,
    "INVALID_CANVAS_POINTER",
    "Canvas pointer is invalid",
  );
  return value;
}

function apiErrorResponse(error: ApiError): Record<string, unknown> {
  return {
    error: {
      code: error.code,
      message: error.message,
      ...(error.details === undefined ? {} : { details: error.details }),
    },
  };
}

function toApiError(command: ElementCommandRow): ApiError {
  const response = JSON.parse(command.response_json) as {
    readonly error?: {
      readonly code?: unknown;
      readonly message?: unknown;
      readonly details?: unknown;
    };
  };
  const error = response.error;
  if (
    error === undefined ||
    typeof error.code !== "string" ||
    typeof error.message !== "string"
  ) {
    return new ApiError(
      command.response_status,
      "ELEMENT_COMMAND_REPLAY_INVALID",
      "Stored element command response is invalid",
    );
  }
  return new ApiError(
    command.response_status,
    error.code,
    error.message,
    error.details,
  );
}

export class ElementService {
  readonly repository: ElementRepository;
  readonly pageRepository: PageRepository;
  readonly projectRepository: ProjectRepository;
  readonly candidateStore: PlacementCandidateStore;
  readonly #clock: () => Date;
  readonly #failureInjector: ElementFailureInjector | undefined;

  constructor(options: ElementServiceOptions) {
    this.repository = new ElementRepository(options.metadataDatabase);
    this.pageRepository = new PageRepository(options.metadataDatabase);
    this.projectRepository = new ProjectRepository(options.metadataDatabase);
    this.#clock = options.clock ?? (() => new Date());
    this.#failureInjector = options.failureInjector;
    this.candidateStore =
      options.candidateStore ??
      new PlacementCandidateStore({ clock: this.#clock });
  }

  #now(): string {
    return this.#clock().toISOString();
  }

  list(pageId: string): ElementListDto {
    assertUuid(pageId, "INVALID_PAGE_ID", "Page ID");
    const { page, project, layoutRevision } = this.#pageContext(pageId);
    return {
      pageId: page.id,
      breakpoint: "desktop",
      layoutRevision,
      projectRevision: project.revision,
      elements: this.repository.listActive(page.id),
    };
  }

  placementCandidate(
    pageId: string,
    request: CreatePlacementCandidateRequest,
  ): { readonly candidate: PlacementCandidateDto } {
    assertUuid(pageId, "INVALID_PAGE_ID", "Page ID");
    const definition = elementDefinition(request.elementType);
    const expectedLayoutRevision = expectedRevision(
      request.expectedLayoutRevision,
      "INVALID_EXPECTED_LAYOUT_REVISION",
    );
    const expectedProjectRevision = expectedRevision(
      request.expectedProjectRevision,
      "INVALID_EXPECTED_PROJECT_REVISION",
    );
    assertApi(
      typeof request.pointer === "object" && request.pointer !== null,
      400,
      "INVALID_CANVAS_POINTER",
      "Canvas pointer is invalid",
    );
    finiteNumber(request.pointer.rawCanvasX);
    finiteNumber(request.pointer.rawCanvasY);
    const correctedCanvasX = finiteNumber(request.pointer.correctedCanvasX);
    const correctedCanvasY = finiteNumber(request.pointer.correctedCanvasY);
    assertApi(
      typeof request.canvasWidth === "number" &&
        Number.isFinite(request.canvasWidth) &&
        request.canvasWidth >= 240 &&
        request.canvasWidth <= 100_000,
      400,
      "INVALID_CANVAS_WIDTH",
      "Canvas width is invalid",
    );
    assertApi(
      typeof request.canvasHeight === "number" &&
        Number.isFinite(request.canvasHeight) &&
        request.canvasHeight >= 240 &&
        request.canvasHeight <= 100_000,
      400,
      "INVALID_CANVAS_HEIGHT",
      "Canvas height is invalid",
    );

    const { page, project, layoutRevision } = this.#pageContext(pageId);
    this.#assertLayoutRevision(layoutRevision, expectedLayoutRevision, page.id);
    this.#assertProjectRevision(project, expectedProjectRevision);
    const strideX =
      (request.canvasWidth -
        CANVAS_GRID.padding * 2 -
        CANVAS_GRID.gap * (CANVAS_GRID.columns - 1)) /
        CANVAS_GRID.columns +
      CANVAS_GRID.gap;
    const strideY = CANVAS_GRID.rowHeight + CANVAS_GRID.gap;
    const initial = clampMove(
      Math.round((correctedCanvasX - CANVAS_GRID.padding) / strideX),
      Math.round((correctedCanvasY - CANVAS_GRID.padding) / strideY),
      { w: definition.layout.defaultW, h: definition.layout.defaultH },
    );
    const existing = this.repository
      .listActive(page.id)
      .map(({ layout }) => layout);
    const resolved = this.#nearestFree(initial, existing);
    const compacted = this.#compactVertically(resolved, existing);
    const candidatePixelBottom = this.#candidatePixelBottom(compacted);
    const candidate = this.candidateStore.create({
      projectId: project.id,
      pageId: page.id,
      elementType: definition.type,
      ...compacted,
      valid:
        correctedCanvasX >= 0 &&
        correctedCanvasX <= request.canvasWidth &&
        correctedCanvasY >= 0 &&
        correctedCanvasY <= request.canvasHeight &&
        candidatePixelBottom <= request.canvasHeight,
      collisionResolved: compacted.x !== initial.x || compacted.y !== initial.y,
      layoutRevision,
      projectRevision: project.revision,
      canvasHeight: request.canvasHeight,
      sizeRule: definition.layout,
    });
    return { candidate: publicCandidate(candidate) };
  }

  create(pageId: string, request: CreateElementRequest): ElementMutationDto {
    assertUuid(pageId, "INVALID_PAGE_ID", "Page ID");
    const definition = elementDefinition(request.elementType);
    const validated = this.#validateWriteRevisions(request);
    const key = idempotencyKey(request.idempotencyKey);
    const context = this.#pageContext(pageId);
    const hash = commandHash("ADD", pageId, request);
    const replay = this.#replay<ElementMutationDto>(
      context.project.id,
      key,
      hash,
    );
    if (replay !== undefined) return replay;
    const rectangle = this.#nearestFree(
      {
        x: 0,
        y: 0,
        w: definition.layout.defaultW,
        h: definition.layout.defaultH,
      },
      this.repository.listActive(pageId).map(({ layout }) => layout),
    );
    return this.#recordFailure(
      context,
      { type: "ADD", key, hash, elementId: null },
      () =>
        this.#insert(
          context,
          validated,
          key,
          hash,
          definition.type,
          rectangle,
          "ADD",
        ),
    );
  }

  createFromPlacement(
    pageId: string,
    request: CreateElementFromPlacementRequest,
  ): ElementMutationDto {
    assertUuid(pageId, "INVALID_PAGE_ID", "Page ID");
    const validated = this.#validateWriteRevisions(request);
    const key = idempotencyKey(request.idempotencyKey);
    const context = this.#pageContext(pageId);
    const hash = commandHash("ADD_FROM_PLACEMENT", pageId, request);
    const replay = this.#replay<ElementMutationDto>(
      context.project.id,
      key,
      hash,
    );
    if (replay !== undefined) return replay;
    let consumedCandidateId: string | undefined;
    return this.#recordFailure(
      context,
      { type: "ADD", key, hash, elementId: null },
      () => {
        this.#assertWriteContext(context, validated);
        const candidate = this.candidateStore.consume({
          candidateId: request.candidateId,
          projectId: context.project.id,
          pageId,
          expectedLayoutRevision: validated.expectedLayoutRevision,
          expectedProjectRevision: validated.expectedProjectRevision,
        });
        consumedCandidateId = candidate.candidateId;
        const definition = elementDefinition(candidate.elementType);
        assertApi(
          stableJson(definition.layout) === stableJson(candidate.sizeRule),
          409,
          "PLACEMENT_CANDIDATE_STALE",
          "Element defaults changed after preview",
        );
        assertApi(
          this.#candidatePixelBottom(candidate) <= candidate.canvasHeight,
          409,
          "PLACEMENT_CANDIDATE_INVALID",
          "Placement candidate is outside the Canvas boundary",
        );
        try {
          return this.#insert(
            context,
            validated,
            key,
            hash,
            definition.type,
            candidate,
            "ADD",
          );
        } catch (error) {
          this.candidateStore.release(candidate.candidateId);
          consumedCandidateId = undefined;
          throw error;
        }
      },
      () => {
        if (consumedCandidateId !== undefined) {
          this.candidateStore.release(consumedCandidateId);
        }
      },
    );
  }

  patch(elementId: string, request: PatchElementRequest): ElementMutationDto {
    assertUuid(elementId, "INVALID_ELEMENT_ID", "Element ID");
    const expectedElementRevision = expectedRevision(
      request.expectedRevision,
      "INVALID_EXPECTED_REVISION",
    );
    const validated = this.#validateWriteRevisions(request);
    const key = idempotencyKey(request.idempotencyKey);
    const element = this.repository.get(elementId);
    assertApi(
      element !== undefined,
      404,
      "ELEMENT_NOT_FOUND",
      "Element was not found",
    );
    const context = this.#pageContext(element.page_id);
    const hash = commandHash("PATCH_ELEMENT", elementId, request);
    const replay = this.#replay<ElementMutationDto>(
      context.project.id,
      key,
      hash,
    );
    if (replay !== undefined) return replay;
    assertApi(
      element.deleted_at === null,
      404,
      "ELEMENT_NOT_FOUND",
      "Element was not found",
    );
    const kind = request.change?.kind;
    assertApi(
      kind === "MOVE" || kind === "RESIZE" || kind === "LOCK",
      400,
      "INVALID_ELEMENT_CHANGE",
      "Element change is invalid",
    );
    const commandType = kind as "MOVE" | "RESIZE" | "LOCK";
    return this.#recordFailure(
      context,
      { type: commandType, key, hash, elementId },
      () =>
        this.repository.metadataDatabase.transaction(() => {
          const current = this.#activeElement(elementId);
          const liveContext = this.#pageContext(current.page_id);
          this.#assertWriteContext(liveContext, validated);
          this.#assertElementRevision(
            current.revision,
            expectedElementRevision,
            elementId,
          );
          const before = this.repository.getEntry(elementId) as ElementEntryDto;
          let entry: ElementEntryDto | undefined;
          let layoutRevision = liveContext.layoutRevision;
          if (kind === "LOCK") {
            assertApi(
              typeof request.change.locked === "boolean",
              400,
              "INVALID_ELEMENT_CHANGE",
              "Element lock state is invalid",
            );
            entry = this.repository.setLocked(
              elementId,
              expectedElementRevision,
              request.change.locked,
              this.#now(),
            );
          } else {
            assertApi(
              current.locked === 0,
              409,
              "ELEMENT_LOCKED",
              "Locked element cannot move or resize",
            );
            const currentLayout = before.layout;
            const rectangle =
              kind === "MOVE"
                ? clampMove(request.change.x, request.change.y, {
                    w: currentLayout.w,
                    h: currentLayout.h,
                  })
                : normalizeResize(
                    currentLayout,
                    layoutLimits(currentLayout),
                    resizeHandle(request.change.handle),
                    {
                      x: request.change.x,
                      y: request.change.y,
                      w: request.change.w,
                      h: request.change.h,
                    },
                  );
            this.#assertNoCollision(
              rectangle,
              this.repository
                .listActive(current.page_id)
                .filter(({ element: candidate }) => candidate.id !== elementId)
                .map(({ layout }) => layout),
            );
            entry = this.repository.updateLayout(
              elementId,
              expectedElementRevision,
              rectangle,
              this.#now(),
            );
            layoutRevision = this.#bumpLayout(
              current.page_id,
              liveContext.layoutRevision,
              this.#now(),
            );
          }
          assertApi(
            entry !== undefined,
            409,
            "ELEMENT_REVISION_CONFLICT",
            "Element revision is stale",
          );
          const projectRevision = this.#bumpProject(
            liveContext.project.id,
            liveContext.project.revision,
            this.#now(),
          );
          const response: ElementMutationDto = {
            entry,
            layoutRevision,
            projectRevision,
            commandId: randomUUID(),
          };
          this.repository.storeCommand({
            id: response.commandId,
            projectId: liveContext.project.id,
            pageId: current.page_id,
            elementId,
            type: commandType,
            idempotencyKey: key,
            requestHash: hash,
            before,
            after: entry,
            responseStatus: 200,
            response,
            beforeLayoutRevision: liveContext.layoutRevision,
            afterLayoutRevision: layoutRevision,
            now: this.#now(),
          });
          this.#audit(
            commandType,
            liveContext.project.id,
            elementId,
            before,
            entry,
          );
          return response;
        }),
    );
  }

  delete(
    elementId: string,
    request: DeleteElementRequest,
  ): {
    readonly deletedElementId: string;
    readonly layoutRevision: number;
    readonly projectRevision: number;
    readonly commandId: string;
  } {
    assertUuid(elementId, "INVALID_ELEMENT_ID", "Element ID");
    const expectedElementRevision = expectedRevision(
      request.expectedRevision,
      "INVALID_EXPECTED_REVISION",
    );
    const validated = this.#validateWriteRevisions(request);
    const key = idempotencyKey(request.idempotencyKey);
    const element = this.repository.get(elementId);
    assertApi(
      element !== undefined,
      404,
      "ELEMENT_NOT_FOUND",
      "Element was not found",
    );
    const context = this.#pageContext(element.page_id);
    const hash = commandHash("DELETE_ELEMENT", elementId, request);
    const replay = this.#replay<{
      readonly deletedElementId: string;
      readonly layoutRevision: number;
      readonly projectRevision: number;
      readonly commandId: string;
    }>(context.project.id, key, hash);
    if (replay !== undefined) return replay;
    assertApi(
      element.deleted_at === null,
      404,
      "ELEMENT_NOT_FOUND",
      "Element was not found",
    );
    return this.#recordFailure(
      context,
      { type: "DELETE", key, hash, elementId },
      () =>
        this.repository.metadataDatabase.transaction(() => {
          const current = this.#activeElement(elementId);
          const liveContext = this.#pageContext(current.page_id);
          this.#assertWriteContext(liveContext, validated);
          this.#assertElementRevision(
            current.revision,
            expectedElementRevision,
            elementId,
          );
          assertApi(
            current.locked === 0,
            409,
            "ELEMENT_LOCKED",
            "Locked element cannot be deleted",
          );
          const before = this.repository.getEntry(elementId) as ElementEntryDto;
          assertApi(
            this.repository.tombstone(
              elementId,
              expectedElementRevision,
              this.#now(),
            ),
            409,
            "ELEMENT_REVISION_CONFLICT",
            "Element revision is stale",
          );
          const layoutRevision = this.#bumpLayout(
            current.page_id,
            liveContext.layoutRevision,
            this.#now(),
          );
          const projectRevision = this.#bumpProject(
            liveContext.project.id,
            liveContext.project.revision,
            this.#now(),
          );
          const response = {
            deletedElementId: elementId,
            layoutRevision,
            projectRevision,
            commandId: randomUUID(),
          };
          this.repository.storeCommand({
            id: response.commandId,
            projectId: liveContext.project.id,
            pageId: current.page_id,
            elementId,
            type: "DELETE",
            idempotencyKey: key,
            requestHash: hash,
            before,
            after: null,
            responseStatus: 200,
            response,
            beforeLayoutRevision: liveContext.layoutRevision,
            afterLayoutRevision: layoutRevision,
            now: this.#now(),
          });
          this.#audit(
            "DELETE",
            liveContext.project.id,
            elementId,
            before,
            response,
          );
          return response;
        }),
    );
  }

  batchLayout(request: BatchLayoutRequest): {
    readonly pageId: string;
    readonly mode: "COMPLETE" | "PARTIAL";
    readonly entries: readonly ElementEntryDto[];
    readonly layoutRevision: number;
    readonly projectRevision: number;
    readonly commandId: string;
  } {
    assertUuid(request.pageId, "INVALID_PAGE_ID", "Page ID");
    const validated = this.#validateWriteRevisions(request);
    const key = idempotencyKey(request.idempotencyKey);
    assertApi(
      typeof request.mode === "string" && batchModeSet.has(request.mode),
      400,
      "INVALID_BATCH_LAYOUT",
      "Batch layout mode is invalid",
    );
    assertApi(
      Array.isArray(request.items) && request.items.length > 0,
      400,
      "INVALID_BATCH_LAYOUT",
      "Batch layout must contain at least one item",
    );
    const context = this.#pageContext(request.pageId);
    const hash = commandHash("BATCH_LAYOUT", request.pageId, request);
    const replay = this.#replay<{
      readonly pageId: string;
      readonly mode: "COMPLETE" | "PARTIAL";
      readonly entries: readonly ElementEntryDto[];
      readonly layoutRevision: number;
      readonly projectRevision: number;
      readonly commandId: string;
    }>(context.project.id, key, hash);
    if (replay !== undefined) return replay;
    return this.#recordFailure(
      context,
      { type: "BATCH_LAYOUT", key, hash, elementId: null },
      () =>
        this.repository.metadataDatabase.transaction(() => {
          const liveContext = this.#pageContext(request.pageId);
          this.#assertWriteContext(liveContext, validated);
          const before = this.repository.listActive(request.pageId);
          const byId = new Map(
            before.map((entry) => [entry.element.id, entry]),
          );
          const seen = new Set<string>();
          const normalizedItems = request.items.map(
            (item, index): BatchLayoutItem => {
              assertApi(
                typeof item === "object" && item !== null,
                400,
                "INVALID_BATCH_LAYOUT",
                "Batch layout item is invalid",
                { index },
              );
              assertUuid(item.elementId, "INVALID_BATCH_LAYOUT", "Element ID");
              assertApi(
                !seen.has(item.elementId) && byId.has(item.elementId),
                400,
                "INVALID_BATCH_LAYOUT",
                "Batch layout contains an unknown or duplicate element",
                { index, elementId: item.elementId },
              );
              seen.add(item.elementId);
              const expected = expectedRevision(
                item.expectedRevision,
                "INVALID_BATCH_LAYOUT",
              );
              const current = byId.get(item.elementId) as ElementEntryDto;
              this.#assertElementRevision(
                current.element.revision,
                expected,
                current.element.id,
              );
              const rectangle = {
                x: assertGridInteger(item.x),
                y: assertGridInteger(item.y),
                w: assertGridInteger(item.w),
                h: assertGridInteger(item.h),
              };
              this.#assertWithinLimits(rectangle, current.layout);
              const changed =
                rectangle.x !== current.layout.x ||
                rectangle.y !== current.layout.y ||
                rectangle.w !== current.layout.w ||
                rectangle.h !== current.layout.h;
              assertApi(
                !changed || !current.element.locked,
                409,
                "ELEMENT_LOCKED",
                "Locked element cannot change layout",
                { elementId: current.element.id },
              );
              return {
                elementId: item.elementId,
                expectedRevision: expected,
                ...rectangle,
              };
            },
          );
          if (request.mode === "COMPLETE") {
            assertApi(
              seen.size === before.length,
              400,
              "BATCH_LAYOUT_INCOMPLETE",
              "Complete batch must contain every active element exactly once",
            );
          }
          const proposed = before.map((entry) => {
            const update = normalizedItems.find(
              (item) => item.elementId === entry.element.id,
            );
            return update === undefined
              ? entry.layout
              : { ...entry.layout, ...update };
          });
          this.#assertPairwiseNoCollision(proposed);
          const changedItems = normalizedItems.filter((item) => {
            const current = byId.get(item.elementId) as ElementEntryDto;
            return (
              item.x !== current.layout.x ||
              item.y !== current.layout.y ||
              item.w !== current.layout.w ||
              item.h !== current.layout.h
            );
          });
          if (changedItems.length > 0) {
            this.repository.updateBatch(changedItems, this.#now());
          }
          const layoutRevision = this.#bumpLayout(
            request.pageId,
            liveContext.layoutRevision,
            this.#now(),
          );
          const projectRevision = this.#bumpProject(
            liveContext.project.id,
            liveContext.project.revision,
            this.#now(),
          );
          const response = {
            pageId: request.pageId,
            mode: request.mode,
            entries: this.repository.listActive(request.pageId),
            layoutRevision,
            projectRevision,
            commandId: randomUUID(),
          };
          this.repository.storeCommand({
            id: response.commandId,
            projectId: liveContext.project.id,
            pageId: request.pageId,
            elementId: null,
            type: "BATCH_LAYOUT",
            idempotencyKey: key,
            requestHash: hash,
            before,
            after: response.entries,
            responseStatus: 200,
            response,
            beforeLayoutRevision: liveContext.layoutRevision,
            afterLayoutRevision: layoutRevision,
            now: this.#now(),
          });
          this.#audit(
            "BATCH_LAYOUT",
            liveContext.project.id,
            request.pageId,
            before,
            response.entries,
          );
          return response;
        }),
    );
  }

  #insert(
    context: ElementPageContext,
    expected: {
      readonly expectedLayoutRevision: number;
      readonly expectedProjectRevision: number;
    },
    key: string,
    hash: string,
    type: "text" | "button" | "container" | "kpi-card",
    rectangle: GridRectangle,
    commandType: "ADD",
  ): ElementMutationDto {
    return this.repository.metadataDatabase.transaction(() => {
      const liveContext = this.#pageContext(context.page.id);
      this.#assertWriteContext(liveContext, expected);
      this.#assertNoCollision(
        rectangle,
        this.repository.listActive(context.page.id).map(({ layout }) => layout),
      );
      const entry = this.repository.insert({
        id: randomUUID(),
        projectId: liveContext.project.id,
        pageId: context.page.id,
        definition: elementDefinition(type),
        x: rectangle.x,
        y: rectangle.y,
        now: this.#now(),
      });
      const layoutRevision = this.#bumpLayout(
        context.page.id,
        liveContext.layoutRevision,
        this.#now(),
      );
      const projectRevision = this.#bumpProject(
        liveContext.project.id,
        liveContext.project.revision,
        this.#now(),
      );
      const response: ElementMutationDto = {
        entry,
        layoutRevision,
        projectRevision,
        commandId: randomUUID(),
      };
      this.#failureInjector?.("element:add-before-command");
      this.repository.storeCommand({
        id: response.commandId,
        projectId: liveContext.project.id,
        pageId: context.page.id,
        elementId: entry.element.id,
        type: commandType,
        idempotencyKey: key,
        requestHash: hash,
        before: null,
        after: entry,
        responseStatus: 201,
        response,
        beforeLayoutRevision: liveContext.layoutRevision,
        afterLayoutRevision: layoutRevision,
        now: this.#now(),
      });
      this.#audit("ADD", liveContext.project.id, entry.element.id, null, entry);
      return response;
    });
  }

  #validateWriteRevisions(request: {
    readonly expectedLayoutRevision: unknown;
    readonly expectedProjectRevision: unknown;
  }): {
    readonly expectedLayoutRevision: number;
    readonly expectedProjectRevision: number;
  } {
    return {
      expectedLayoutRevision: expectedRevision(
        request.expectedLayoutRevision,
        "INVALID_EXPECTED_LAYOUT_REVISION",
      ),
      expectedProjectRevision: expectedRevision(
        request.expectedProjectRevision,
        "INVALID_EXPECTED_PROJECT_REVISION",
      ),
    };
  }

  #pageContext(pageId: string): ElementPageContext {
    const page = this.pageRepository.getActive(pageId);
    assertApi(page !== undefined, 404, "PAGE_NOT_FOUND", "Page was not found");
    const project = this.projectRepository.get(page.project_id);
    assertApi(
      project !== undefined,
      404,
      "PROJECT_NOT_FOUND",
      "Project was not found",
    );
    assertApi(
      project.lifecycle_status === "ACTIVE",
      409,
      "PROJECT_NOT_ACTIVE",
      "Project is not active",
    );
    const layoutRevision = this.repository.layoutRevision(page.id);
    if (layoutRevision === undefined) {
      throw new Error(`Page ${page.id} is missing its layout revision`);
    }
    return { page, project, layoutRevision };
  }

  #activeElement(elementId: string) {
    const element = this.repository.getActive(elementId);
    assertApi(
      element !== undefined,
      404,
      "ELEMENT_NOT_FOUND",
      "Element was not found",
    );
    return element;
  }

  #assertWriteContext(
    context: ElementPageContext,
    expected: {
      readonly expectedLayoutRevision: number;
      readonly expectedProjectRevision: number;
    },
  ): void {
    this.#assertLayoutRevision(
      context.layoutRevision,
      expected.expectedLayoutRevision,
      context.page.id,
    );
    this.#assertProjectRevision(
      context.project,
      expected.expectedProjectRevision,
    );
  }

  #assertLayoutRevision(
    actual: number,
    expected: number,
    pageId: string,
  ): void {
    if (actual !== expected) {
      throw new ApiError(
        409,
        "LAYOUT_REVISION_CONFLICT",
        "Layout revision is stale",
        {
          pageId,
          layoutRevision: actual,
        },
      );
    }
  }

  #assertProjectRevision(project: ProjectRow, expected: number): void {
    if (project.revision !== expected) {
      throw new ApiError(
        409,
        "PROJECT_REVISION_CONFLICT",
        "Project revision is stale",
        { latest: this.projectRepository.toDto(project) },
      );
    }
  }

  #assertElementRevision(
    actual: number,
    expected: number,
    elementId: string,
  ): void {
    if (actual !== expected) {
      throw new ApiError(
        409,
        "ELEMENT_REVISION_CONFLICT",
        "Element revision is stale",
        { elementId, revision: actual },
      );
    }
  }

  #bumpLayout(pageId: string, expected: number, now: string): number {
    const revision = this.repository.bumpLayoutRevision(pageId, expected, now);
    if (revision === undefined) {
      throw new ApiError(
        409,
        "LAYOUT_REVISION_CONFLICT",
        "Layout revision is stale",
      );
    }
    return revision;
  }

  #bumpProject(projectId: string, expected: number, now: string): number {
    const revision = this.repository.bumpProjectRevision(
      projectId,
      expected,
      now,
    );
    if (revision === undefined) {
      throw new ApiError(
        409,
        "PROJECT_REVISION_CONFLICT",
        "Project revision is stale",
      );
    }
    return revision;
  }

  #nearestFree(
    initial: GridRectangle,
    existing: readonly GridRectangle[],
  ): GridRectangle {
    if (!existing.some((rectangle) => rectanglesOverlap(initial, rectangle))) {
      return initial;
    }
    const candidates: GridRectangle[] = [];
    for (let x = 0; x <= CANVAS_GRID.columns - initial.w; x += 1) {
      const containing = this.#forbiddenVerticalIntervals(
        x,
        initial.w,
        initial.h,
        existing,
      ).find(
        (interval) => interval.start <= initial.y && initial.y <= interval.end,
      );
      if (containing === undefined) {
        candidates.push({ ...initial, x });
        continue;
      }
      if (containing.start > 0) {
        candidates.push({ ...initial, x, y: containing.start - 1 });
      }
      candidates.push({ ...initial, x, y: containing.end + 1 });
    }
    candidates.sort((left, right) => {
      const leftDistance =
        Math.abs(left.x - initial.x) + Math.abs(left.y - initial.y);
      const rightDistance =
        Math.abs(right.x - initial.x) + Math.abs(right.y - initial.y);
      return (
        leftDistance - rightDistance || left.y - right.y || left.x - right.x
      );
    });
    return candidates[0] as GridRectangle;
  }

  #forbiddenVerticalIntervals(
    x: number,
    w: number,
    h: number,
    existing: readonly GridRectangle[],
  ): { start: number; end: number }[] {
    const forbidden = existing
      .filter(
        (rectangle) => x < rectangle.x + rectangle.w && x + w > rectangle.x,
      )
      .map((rectangle) => ({
        start: Math.max(0, rectangle.y - h + 1),
        end: rectangle.y + rectangle.h - 1,
      }))
      .sort((left, right) => left.start - right.start || left.end - right.end);
    const merged: { start: number; end: number }[] = [];
    for (const interval of forbidden) {
      const previous = merged.at(-1);
      if (previous === undefined || interval.start > previous.end + 1) {
        merged.push({ ...interval });
      } else {
        previous.end = Math.max(previous.end, interval.end);
      }
    }
    return merged;
  }

  #compactVertically(
    rectangle: GridRectangle,
    existing: readonly GridRectangle[],
  ): GridRectangle {
    const blockingInterval = this.#forbiddenVerticalIntervals(
      rectangle.x,
      rectangle.w,
      rectangle.h,
      existing,
    )
      .filter((interval) => interval.end < rectangle.y)
      .at(-1);
    return {
      ...rectangle,
      y: blockingInterval === undefined ? 0 : blockingInterval.end + 1,
    };
  }

  #candidatePixelBottom(rectangle: GridRectangle): number {
    const verticalStride = CANVAS_GRID.rowHeight + CANVAS_GRID.gap;
    const elementPixelHeight =
      rectangle.h * CANVAS_GRID.rowHeight + (rectangle.h - 1) * CANVAS_GRID.gap;
    return (
      CANVAS_GRID.padding +
      rectangle.y * verticalStride +
      elementPixelHeight +
      CANVAS_GRID.padding
    );
  }

  #assertNoCollision(
    rectangle: GridRectangle,
    existing: readonly GridRectangle[],
  ): void {
    assertApi(
      !existing.some((other) => rectanglesOverlap(rectangle, other)),
      409,
      "ELEMENT_COLLISION",
      "Element layout collides with another element",
    );
  }

  #assertPairwiseNoCollision(layouts: readonly GridRectangle[]): void {
    for (let index = 0; index < layouts.length; index += 1) {
      for (
        let otherIndex = index + 1;
        otherIndex < layouts.length;
        otherIndex += 1
      ) {
        assertApi(
          !rectanglesOverlap(
            layouts[index] as GridRectangle,
            layouts[otherIndex] as GridRectangle,
          ),
          409,
          "ELEMENT_COLLISION",
          "Batch layout contains overlapping elements",
        );
      }
    }
  }

  #assertWithinLimits(
    rectangle: GridRectangle,
    limits: Pick<ElementEntryDto["layout"], "minW" | "minH" | "maxW" | "maxH">,
  ): void {
    assertApi(
      rectangle.x >= 0 &&
        rectangle.y >= 0 &&
        rectangle.w >= limits.minW &&
        rectangle.w <= limits.maxW &&
        rectangle.h >= limits.minH &&
        rectangle.h <= limits.maxH &&
        rectangle.x + rectangle.w <= CANVAS_GRID.columns,
      400,
      "INVALID_ELEMENT_LAYOUT",
      "Element layout is outside its limits",
    );
  }

  #replay<T>(projectId: string, key: string, hash: string): T | undefined {
    const command = this.repository.findCommand(projectId, key);
    if (command === undefined) return undefined;
    assertApi(
      command.request_hash === hash,
      409,
      "IDEMPOTENCY_PAYLOAD_CONFLICT",
      "Idempotency key has different input",
    );
    if (command.response_status >= 400) throw toApiError(command);
    return JSON.parse(command.response_json) as T;
  }

  #recordFailure<T>(
    context: ElementPageContext,
    command: {
      readonly type: ElementCommandRow["command_type"];
      readonly key: string;
      readonly hash: string;
      readonly elementId: string | null;
    },
    operation: () => T,
    compensate?: () => void,
  ): T {
    try {
      return operation();
    } catch (error) {
      compensate?.();
      if (
        error instanceof ApiError &&
        error.statusCode >= 400 &&
        error.statusCode < 500
      ) {
        const existing = this.repository.findCommand(
          context.project.id,
          command.key,
        );
        if (existing === undefined) {
          const currentLayout = this.repository.layoutRevision(context.page.id);
          if (currentLayout !== undefined) {
            this.repository.metadataDatabase.transaction(() => {
              this.repository.storeCommand({
                id: randomUUID(),
                projectId: context.project.id,
                pageId: context.page.id,
                elementId: command.elementId,
                type: command.type,
                idempotencyKey: command.key,
                requestHash: command.hash,
                before: null,
                after: null,
                responseStatus: error.statusCode,
                response: apiErrorResponse(error),
                beforeLayoutRevision: currentLayout,
                afterLayoutRevision: currentLayout,
                now: this.#now(),
              });
            });
          }
        }
      }
      throw error;
    }
  }

  #audit(
    action: string,
    projectId: string,
    objectId: string,
    before: unknown,
    after: unknown,
  ): void {
    const now = this.#now();
    this.repository.connection
      .prepare(
        `INSERT INTO audit_logs (
           id, project_id, action, object_type, object_id, before_json,
           after_json, correlation_id, created_at
         ) VALUES (?, ?, ?, 'element', ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        projectId,
        `ELEMENT_${action}`,
        objectId,
        JSON.stringify(before),
        JSON.stringify(after),
        randomUUID(),
        now,
      );
  }
}
