import { createHash, randomUUID } from "node:crypto";

import {
  LAYOUT_PRESET_APPLY_MODES,
  type ApplyLayoutPresetDto,
  type ApplyLayoutPresetRequest,
  type ElementEntryDto,
  type LayoutPresetApplyMode,
  type LayoutPresetBindingPlaceholderDto,
  type LayoutPresetDefinition,
  type LayoutPresetInstanceDto,
  type LayoutPresetPreviewDto,
  type LayoutPresetProposedElementDto,
  type PreviewLayoutPresetRequest,
} from "@webeditor/domain";

import { ApiError, assertApi } from "../errors.js";
import type { MetadataDatabase } from "../metadata/database.js";
import { PageRepository, type PageRow } from "../pages/page-repository.js";
import {
  ProjectRepository,
  type ProjectRow,
} from "../projects/project-repository.js";
import type { ElementCommandRow } from "./element-repository.js";
import { LayoutPresetRepository } from "./layout-preset-repository.js";
import {
  elementDefinition,
  rectanglesOverlap,
  validateElementStoredState,
} from "./element-registry.js";
import {
  LayoutPresetPreviewStore,
  publicLayoutPresetPreview,
  type StoredLayoutPresetPreview,
} from "./layout-preset-preview-store.js";
import {
  LAYOUT_PRESET_REGISTRY_CHECKSUM,
  canonicalLayoutPresetJson,
  layoutPresetCoordinateChecksum,
  layoutPresetDefinition,
  layoutPresetRegistry,
} from "./layout-preset-registry.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const applyModes = new Set<string>(LAYOUT_PRESET_APPLY_MODES);

export type LayoutPresetFailurePoint = "element:preset-before-commit";
export type LayoutPresetFailureInjector = (
  point: LayoutPresetFailurePoint,
) => void;

export interface LayoutPresetServiceOptions {
  readonly metadataDatabase: MetadataDatabase;
  readonly clock?: () => Date;
  readonly previewStore?: LayoutPresetPreviewStore;
  readonly failureInjector?: LayoutPresetFailureInjector;
}

interface LayoutPresetPageContext {
  readonly page: PageRow;
  readonly project: ProjectRow;
  readonly layoutRevision: number;
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

function commandHash(
  operation: string,
  scopeId: string,
  request: unknown,
): string {
  return createHash("sha256")
    .update(canonicalLayoutPresetJson({ operation, scopeId, request }))
    .digest("hex");
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
      "LAYOUT_PRESET_COMMAND_REPLAY_INVALID",
      "Stored Layout Preset response is invalid",
    );
  }
  return new ApiError(
    command.response_status,
    error.code,
    error.message,
    error.details,
  );
}

export class LayoutPresetService {
  readonly repository: LayoutPresetRepository;
  readonly pageRepository: PageRepository;
  readonly projectRepository: ProjectRepository;
  readonly previewStore: LayoutPresetPreviewStore;
  readonly #clock: () => Date;
  readonly #failureInjector: LayoutPresetFailureInjector | undefined;

  constructor(options: LayoutPresetServiceOptions) {
    this.repository = new LayoutPresetRepository(options.metadataDatabase);
    this.pageRepository = new PageRepository(options.metadataDatabase);
    this.projectRepository = new ProjectRepository(options.metadataDatabase);
    this.previewStore =
      options.previewStore ??
      new LayoutPresetPreviewStore({
        ...(options.clock === undefined ? {} : { clock: options.clock }),
      });
    this.#clock = options.clock ?? (() => new Date());
    this.#failureInjector = options.failureInjector;
    this.repository.assertBindingPlaceholderTopology();
  }

  #now(): string {
    return this.#clock().toISOString();
  }

  registry() {
    return layoutPresetRegistry();
  }

  registryDefinition(presetId: string) {
    return {
      definition: layoutPresetDefinition(presetId),
      registryChecksum: LAYOUT_PRESET_REGISTRY_CHECKSUM,
    };
  }

  instances(pageId: string): {
    readonly pageId: string;
    readonly instances: readonly LayoutPresetInstanceDto[];
  } {
    assertUuid(pageId, "INVALID_PAGE_ID", "Page ID");
    this.#pageContext(pageId);
    return {
      pageId,
      instances: this.repository.listLayoutPresetInstances(pageId),
    };
  }

  preview(
    pageId: string,
    presetId: string,
    request: PreviewLayoutPresetRequest,
  ): { readonly preview: LayoutPresetPreviewDto } {
    assertUuid(pageId, "INVALID_PAGE_ID", "Page ID");
    const definition = layoutPresetDefinition(presetId);
    const mode = request.mode;
    assertApi(
      typeof mode === "string" && applyModes.has(mode),
      400,
      "INVALID_LAYOUT_PRESET_MODE",
      "Layout Preset mode is invalid",
    );
    const expectedLayoutRevision = expectedRevision(
      request.expectedLayoutRevision,
      "INVALID_EXPECTED_LAYOUT_REVISION",
    );
    const expectedProjectRevision = expectedRevision(
      request.expectedProjectRevision,
      "INVALID_EXPECTED_PROJECT_REVISION",
    );
    const context = this.#pageContext(pageId);
    this.#assertWriteContext(context, {
      expectedLayoutRevision,
      expectedProjectRevision,
    });
    const existing = this.repository.listActive(pageId);
    if (mode === "REPLACE") this.#assertReplaceAllowed(existing);
    const offsetY =
      mode === "ADD"
        ? existing.reduce(
            (maximum, { layout }) => Math.max(maximum, layout.y + layout.h),
            0,
          )
        : 0;
    const proposedElements = definition.elements
      .map((template): LayoutPresetProposedElementDto => {
        const registryElement = elementDefinition(template.elementType);
        const state = validateElementStoredState(registryElement, {
          props: { ...registryElement.defaultProps, ...template.props },
          style: { ...registryElement.defaultStyle, ...template.style },
          events: registryElement.defaultEvents,
        });
        const elementId = randomUUID();
        return {
          templateId: template.templateId,
          entry: {
            element: {
              id: elementId,
              projectId: context.project.id,
              pageId,
              type: registryElement.type,
              typeVersion: registryElement.typeVersion,
              name: template.name,
              props: state.props,
              style: state.style,
              events: state.events,
              locked: false,
              hidden: false,
              revision: 1,
            },
            layout: {
              elementId,
              breakpoint: "desktop",
              x: template.layout.x,
              y: template.layout.y + offsetY,
              w: template.layout.w,
              h: template.layout.h,
              minW: registryElement.layout.minW,
              minH: registryElement.layout.minH,
              maxW: registryElement.layout.maxW,
              maxH: registryElement.layout.maxH,
            },
          },
        };
      })
      .sort((left, right) => left.templateId.localeCompare(right.templateId));
    this.#assertNoCollisions(
      mode === "ADD"
        ? [...existing, ...proposedElements.map(({ entry }) => entry)]
        : proposedElements.map(({ entry }) => entry),
    );
    const bindingPlaceholders = definition.bindingPlaceholders
      .map((placeholder) => {
        const proposed = proposedElements.find(
          ({ templateId }) => templateId === placeholder.templateId,
        ) as LayoutPresetProposedElementDto;
        return {
          elementId: proposed.entry.element.id,
          elementTypeVersion: proposed.entry.element.typeVersion,
          templateId: placeholder.templateId,
          portId: placeholder.portId,
          status: "UNCONNECTED" as const,
        };
      })
      .sort(
        (left, right) =>
          left.templateId.localeCompare(right.templateId) ||
          left.portId.localeCompare(right.portId),
      );
    const coordinateChecksum = layoutPresetCoordinateChecksum(proposedElements);
    const stored = this.previewStore.create({
      instanceId: randomUUID(),
      projectId: context.project.id,
      presetId: definition.id,
      presetVersion: definition.version,
      presetSnapshot: definition,
      registryChecksum: LAYOUT_PRESET_REGISTRY_CHECKSUM,
      coordinateChecksum,
      pageId,
      mode: mode as LayoutPresetApplyMode,
      existingElementCount: existing.length,
      proposedElements,
      deletedElementIds:
        mode === "REPLACE" ? existing.map(({ element }) => element.id) : [],
      suggestedSchema: definition.suggestedSchema,
      bindingPlaceholders,
      warnings: [
        ...(mode === "REPLACE" && existing.length > 0
          ? [
              {
                code: "REPLACE_EXISTING_ELEMENTS" as const,
                message: `${existing.length} elements will be replaced`,
                elementId: null,
                portId: null,
              },
            ]
          : []),
        ...bindingPlaceholders.map((placeholder) => ({
          code: "REQUIRED_BINDING_UNCONNECTED" as const,
          message: "Required input is not connected",
          elementId: placeholder.elementId,
          portId: placeholder.portId,
        })),
      ],
      layoutRevision: context.layoutRevision,
      projectRevision: context.project.revision,
    });
    return { preview: publicLayoutPresetPreview(stored) };
  }

  apply(
    pageId: string,
    presetId: string,
    request: ApplyLayoutPresetRequest,
  ): ApplyLayoutPresetDto {
    assertUuid(pageId, "INVALID_PAGE_ID", "Page ID");
    const definition = layoutPresetDefinition(presetId);
    const expectedLayoutRevision = expectedRevision(
      request.expectedLayoutRevision,
      "INVALID_EXPECTED_LAYOUT_REVISION",
    );
    const expectedProjectRevision = expectedRevision(
      request.expectedProjectRevision,
      "INVALID_EXPECTED_PROJECT_REVISION",
    );
    const key = idempotencyKey(request.idempotencyKey);
    const page = this.pageRepository.get(pageId);
    assertApi(page !== undefined, 404, "PAGE_NOT_FOUND", "Page was not found");
    const projectId = page.project_id;
    const hash = commandHash("PRESET_APPLY", `${pageId}:${presetId}`, request);
    const replay = this.#replay(projectId, key, hash);
    if (replay !== undefined) return replay;
    const context = this.#pageContext(pageId);

    let consumed: StoredLayoutPresetPreview | undefined;
    try {
      consumed = this.previewStore.consume({
        previewId: request.previewId,
        projectId: context.project.id,
        pageId,
        presetId: definition.id,
        expectedLayoutRevision,
        expectedProjectRevision,
      });
      this.#assertPreviewSnapshot(consumed, definition);
      return this.repository.metadataDatabase.transaction(() => {
        const liveContext = this.#pageContext(pageId);
        this.#assertWriteContext(liveContext, {
          expectedLayoutRevision,
          expectedProjectRevision,
        });
        const before = this.repository.listActive(pageId);
        this.#assertApplyImpact(consumed as StoredLayoutPresetPreview, before);
        if (consumed?.mode === "REPLACE") {
          this.#assertReplaceAllowed(before);
          for (const entry of before) {
            assertApi(
              this.repository.tombstone(
                entry.element.id,
                entry.element.revision,
                this.#now(),
              ),
              409,
              "LAYOUT_PRESET_ELEMENT_CONFLICT",
              "Page elements changed after preview",
            );
          }
        }
        for (const proposed of consumed?.proposedElements ?? []) {
          this.repository.insertPresetElement(proposed, this.#now());
        }
        const entries = this.repository.listActive(pageId);
        this.#assertNoCollisions(entries);
        const layoutRevision = this.#bumpLayout(
          pageId,
          liveContext.layoutRevision,
          this.#now(),
        );
        const projectRevision = this.#bumpProject(
          liveContext.project.id,
          liveContext.project.revision,
          this.#now(),
        );
        const commandId = randomUUID();
        const now = this.#now();
        const placeholders: readonly LayoutPresetBindingPlaceholderDto[] = (
          consumed?.bindingPlaceholders ?? []
        ).map((placeholder) => ({
          ...placeholder,
          instanceId: (consumed as StoredLayoutPresetPreview).instanceId,
        }));
        const provisionalInstance: LayoutPresetInstanceDto = {
          id: (consumed as StoredLayoutPresetPreview).instanceId,
          projectId: liveContext.project.id,
          pageId,
          presetId: definition.id,
          presetVersion: definition.version,
          presetSnapshot: definition,
          registryChecksum: LAYOUT_PRESET_REGISTRY_CHECKSUM,
          coordinateChecksum: (consumed as StoredLayoutPresetPreview)
            .coordinateChecksum,
          mode: (consumed as StoredLayoutPresetPreview).mode,
          state: "APPLIED",
          origin: "APPLY",
          commandId,
          elements: (
            consumed as StoredLayoutPresetPreview
          ).proposedElements.map(({ templateId, entry }) => ({
            templateId,
            elementId: entry.element.id,
          })),
          proposedElements: (consumed as StoredLayoutPresetPreview)
            .proposedElements,
          bindingPlaceholders: placeholders,
          createdAt: now,
          updatedAt: now,
        };
        const response: ApplyLayoutPresetDto = {
          instance: provisionalInstance,
          coordinateChecksum: provisionalInstance.coordinateChecksum,
          proposedElements: provisionalInstance.proposedElements,
          entries,
          createdElementIds: provisionalInstance.elements.map(
            ({ elementId }) => elementId,
          ),
          deletedElementIds: (consumed as StoredLayoutPresetPreview)
            .deletedElementIds,
          suggestedSchema: definition.suggestedSchema,
          bindingPlaceholders: placeholders,
          layoutRevision,
          projectRevision,
          commandId,
        };
        this.repository.storeCommand({
          id: commandId,
          projectId: liveContext.project.id,
          pageId,
          elementId: null,
          type: "PRESET_APPLY",
          idempotencyKey: key,
          requestHash: hash,
          before,
          after: entries,
          responseStatus: 201,
          response,
          beforeLayoutRevision: liveContext.layoutRevision,
          afterLayoutRevision: layoutRevision,
          now,
        });
        this.repository.insertLayoutPresetInstance({
          id: provisionalInstance.id,
          projectId: provisionalInstance.projectId,
          pageId,
          presetId: definition.id,
          presetVersion: definition.version,
          presetSnapshot: definition,
          registryChecksum: provisionalInstance.registryChecksum,
          coordinateChecksum: provisionalInstance.coordinateChecksum,
          mode: provisionalInstance.mode,
          state: "APPLIED",
          origin: "APPLY",
          commandId,
          now,
        });
        for (const proposed of provisionalInstance.proposedElements) {
          this.repository.insertLayoutPresetMembership(
            provisionalInstance.id,
            proposed,
          );
        }
        for (const placeholder of placeholders) {
          this.repository.insertLayoutPresetPlaceholder(
            placeholder,
            liveContext.project.id,
            pageId,
            now,
          );
        }
        this.repository.assertBindingPlaceholderTopology(
          liveContext.project.id,
        );
        const storedInstance = this.repository.getLayoutPresetInstance(
          provisionalInstance.id,
        );
        if (
          storedInstance === undefined ||
          canonicalLayoutPresetJson(storedInstance) !==
            canonicalLayoutPresetJson(provisionalInstance)
        ) {
          throw new Error("Stored Layout Preset instance changed during apply");
        }
        this.#audit(
          liveContext.project.id,
          provisionalInstance.id,
          before,
          response,
          now,
        );
        this.#failureInjector?.("element:preset-before-commit");
        return response;
      });
    } catch (error) {
      if (!(error instanceof ApiError) || error.statusCode >= 500) {
        if (consumed !== undefined) {
          this.previewStore.release(consumed.previewId);
        }
      }
      if (
        error instanceof ApiError &&
        error.statusCode >= 400 &&
        error.statusCode < 500 &&
        this.repository.findCommand(projectId, key) === undefined
      ) {
        const currentLayout = this.repository.layoutRevision(pageId);
        if (currentLayout !== undefined) {
          this.repository.metadataDatabase.transaction(() => {
            this.repository.storeCommand({
              id: randomUUID(),
              projectId,
              pageId,
              elementId: null,
              type: "PRESET_APPLY",
              idempotencyKey: key,
              requestHash: hash,
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
      throw error;
    }
  }

  #assertPreviewSnapshot(
    preview: StoredLayoutPresetPreview,
    definition: LayoutPresetDefinition,
  ): void {
    assertApi(
      preview.registryChecksum === LAYOUT_PRESET_REGISTRY_CHECKSUM &&
        preview.presetVersion === definition.version &&
        canonicalLayoutPresetJson(preview.presetSnapshot) ===
          canonicalLayoutPresetJson(definition) &&
        preview.proposedElements.length === definition.elements.length &&
        preview.coordinateChecksum ===
          layoutPresetCoordinateChecksum(preview.proposedElements),
      409,
      "LAYOUT_PRESET_PREVIEW_TAMPERED",
      "Layout Preset preview snapshot is invalid",
    );
    let offsetY: number | undefined;
    for (const template of definition.elements) {
      const proposed = preview.proposedElements.find(
        ({ templateId }) => templateId === template.templateId,
      );
      assertApi(
        proposed !== undefined,
        409,
        "LAYOUT_PRESET_PREVIEW_TAMPERED",
        "Layout Preset preview snapshot is invalid",
      );
      const registryElement = elementDefinition(template.elementType);
      const state = validateElementStoredState(registryElement, {
        props: { ...registryElement.defaultProps, ...template.props },
        style: { ...registryElement.defaultStyle, ...template.style },
        events: registryElement.defaultEvents,
      });
      const entry = proposed.entry;
      const proposedOffset = entry.layout.y - template.layout.y;
      offsetY ??= proposedOffset;
      assertApi(
        entry.element.type === template.elementType &&
          entry.element.typeVersion === registryElement.typeVersion &&
          entry.element.name === template.name &&
          entry.element.revision === 1 &&
          !entry.element.locked &&
          !entry.element.hidden &&
          entry.layout.elementId === entry.element.id &&
          entry.layout.breakpoint === "desktop" &&
          entry.layout.x === template.layout.x &&
          proposedOffset === offsetY &&
          entry.layout.w === template.layout.w &&
          entry.layout.h === template.layout.h &&
          entry.layout.minW === registryElement.layout.minW &&
          entry.layout.minH === registryElement.layout.minH &&
          entry.layout.maxW === registryElement.layout.maxW &&
          entry.layout.maxH === registryElement.layout.maxH &&
          canonicalLayoutPresetJson(entry.element.props) ===
            canonicalLayoutPresetJson(state.props) &&
          canonicalLayoutPresetJson(entry.element.style) ===
            canonicalLayoutPresetJson(state.style) &&
          canonicalLayoutPresetJson(entry.element.events) ===
            canonicalLayoutPresetJson(state.events),
        409,
        "LAYOUT_PRESET_PREVIEW_TAMPERED",
        "Layout Preset preview snapshot is invalid",
      );
    }
    assertApi(
      (preview.mode === "REPLACE" && offsetY === 0) ||
        (preview.mode === "ADD" && offsetY !== undefined && offsetY >= 0),
      409,
      "LAYOUT_PRESET_PREVIEW_TAMPERED",
      "Layout Preset preview snapshot is invalid",
    );
    const expectedPlaceholders = definition.bindingPlaceholders
      .map((placeholder) => {
        const proposed = preview.proposedElements.find(
          ({ templateId }) => templateId === placeholder.templateId,
        ) as LayoutPresetProposedElementDto;
        return {
          elementId: proposed.entry.element.id,
          elementTypeVersion: proposed.entry.element.typeVersion,
          templateId: placeholder.templateId,
          portId: placeholder.portId,
          status: "UNCONNECTED" as const,
        };
      })
      .sort(
        (left, right) =>
          left.templateId.localeCompare(right.templateId) ||
          left.portId.localeCompare(right.portId),
      );
    assertApi(
      canonicalLayoutPresetJson(preview.bindingPlaceholders) ===
        canonicalLayoutPresetJson(expectedPlaceholders),
      409,
      "LAYOUT_PRESET_PREVIEW_TAMPERED",
      "Layout Preset preview placeholder topology is invalid",
    );
  }

  #assertApplyImpact(
    preview: StoredLayoutPresetPreview,
    current: readonly ElementEntryDto[],
  ): void {
    const currentIds = current.map(({ element }) => element.id);
    assertApi(
      current.length === preview.existingElementCount &&
        (preview.mode === "ADD"
          ? preview.deletedElementIds.length === 0
          : canonicalLayoutPresetJson(currentIds) ===
            canonicalLayoutPresetJson(preview.deletedElementIds)),
      409,
      "LAYOUT_PRESET_PREVIEW_STALE",
      "Page elements changed after preview",
    );
    if (preview.mode === "ADD") {
      this.#assertNoCollisions([
        ...current,
        ...preview.proposedElements.map(({ entry }) => entry),
      ]);
    }
  }

  #assertReplaceAllowed(entries: readonly ElementEntryDto[]): void {
    const locked = entries
      .filter(({ element }) => element.locked)
      .map(({ element }) => element.id);
    assertApi(
      locked.length === 0,
      409,
      "LAYOUT_PRESET_LOCKED_ELEMENTS",
      "Locked elements cannot be replaced",
      { elementIds: locked },
    );
  }

  #assertNoCollisions(entries: readonly ElementEntryDto[]): void {
    for (let index = 0; index < entries.length; index += 1) {
      for (let other = index + 1; other < entries.length; other += 1) {
        assertApi(
          !rectanglesOverlap(
            (entries[index] as ElementEntryDto).layout,
            (entries[other] as ElementEntryDto).layout,
          ),
          409,
          "LAYOUT_PRESET_COLLISION",
          "Layout Preset elements overlap",
        );
      }
    }
  }

  #replay(
    projectId: string,
    key: string,
    hash: string,
  ): ApplyLayoutPresetDto | undefined {
    const command = this.repository.findCommand(projectId, key);
    if (command === undefined) return undefined;
    assertApi(
      command.request_hash === hash,
      409,
      "IDEMPOTENCY_PAYLOAD_CONFLICT",
      "Idempotency key has different input",
    );
    if (command.response_status >= 400) throw toApiError(command);
    return JSON.parse(command.response_json) as ApplyLayoutPresetDto;
  }

  #activeProject(projectId: string): ProjectRow {
    const project = this.projectRepository.get(projectId);
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
    return project;
  }

  #pageContext(pageId: string): LayoutPresetPageContext {
    const page = this.pageRepository.getActive(pageId);
    assertApi(page !== undefined, 404, "PAGE_NOT_FOUND", "Page was not found");
    const project = this.#activeProject(page.project_id);
    const layoutRevision = this.repository.layoutRevision(page.id);
    if (layoutRevision === undefined) {
      throw new Error(`Page ${page.id} is missing its layout revision`);
    }
    return { page, project, layoutRevision };
  }

  #assertWriteContext(
    context: LayoutPresetPageContext,
    expected: {
      readonly expectedLayoutRevision: number;
      readonly expectedProjectRevision: number;
    },
  ): void {
    assertApi(
      context.layoutRevision === expected.expectedLayoutRevision,
      409,
      "LAYOUT_REVISION_CONFLICT",
      "Layout revision is stale",
      { pageId: context.page.id, layoutRevision: context.layoutRevision },
    );
    assertApi(
      context.project.revision === expected.expectedProjectRevision,
      409,
      "PROJECT_REVISION_CONFLICT",
      "Project revision is stale",
      { latest: this.projectRepository.toDto(context.project) },
    );
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

  #audit(
    projectId: string,
    instanceId: string,
    before: unknown,
    after: unknown,
    now: string,
  ): void {
    this.repository.connection
      .prepare(
        `INSERT INTO audit_logs (
           id, project_id, action, object_type, object_id, before_json,
           after_json, correlation_id, created_at
         ) VALUES (?, ?, 'LAYOUT_PRESET_APPLIED', 'layout-preset-instance',
           ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        projectId,
        instanceId,
        JSON.stringify(before),
        JSON.stringify(after),
        randomUUID(),
        now,
      );
  }
}
