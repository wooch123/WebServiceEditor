import { createHash, randomUUID } from "node:crypto";

import {
  DRAFT_PREVIEW_CAPACITY,
  DRAFT_PREVIEW_TTL_MILLISECONDS,
  PROJECT_DEFINITION_SCHEMA_VERSION,
  type DraftPreviewDto,
  type DraftRuntimeNavigationDto,
  type DraftRuntimePageDto,
  type ElementEntryDto,
  type ExecuteBindingQueryRequest,
  type ProjectDefinitionSnapshotDto,
  type PublishedRuntimeDefinitionPageDto,
  type RuntimeBindingResultDto,
  type RuntimeNavigationDto,
} from "@webeditor/domain";

import { BindingQueryCompiler } from "../data-relationship/binding-query-compiler.js";
import { RelationshipRepository } from "../data-relationship/relationship-repository.js";
import { SchemaRepository } from "../data-schema/schema-repository.js";
import { ELEMENT_REGISTRY_CHECKSUM } from "../elements/element-registry.js";
import {
  elementDefinition,
  validateElementStoredState,
} from "../elements/element-registry.js";
import { ElementRepository } from "../elements/element-repository.js";
import { ApiError, assertApi } from "../errors.js";
import type { MetadataDatabase } from "../metadata/database.js";
import {
  PageRepository,
  type ProjectVersionRow,
} from "../pages/page-repository.js";
import { ProjectRepository } from "../projects/project-repository.js";
import type { ProjectStorage } from "../projects/project-storage.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface StoredDraftPreview {
  readonly previewId: string;
  readonly snapshot: ProjectDefinitionSnapshotDto;
  readonly definitionChecksum: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly createdAtMs: number;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

export function projectDefinitionChecksum(
  snapshot: ProjectDefinitionSnapshotDto,
): string {
  return createHash("sha256").update(stableJson(snapshot)).digest("hex");
}

function uuid(value: unknown, code: string, label: string): string {
  assertApi(
    typeof value === "string" && UUID_PATTERN.test(value),
    400,
    code,
    `${label} is invalid`,
  );
  return value;
}

function revisions(value: unknown): number {
  assertApi(
    Number.isSafeInteger(value) && (value as number) >= 0,
    400,
    "INVALID_EXPECTED_PROJECT_REVISION",
    "Project revision is invalid",
  );
  return value as number;
}

export class RuntimeDefinitionService {
  readonly pageRepository: PageRepository;
  readonly elementRepository: ElementRepository;
  readonly relationshipRepository: RelationshipRepository;
  readonly schemaRepository: SchemaRepository;
  readonly projectRepository: ProjectRepository;
  readonly queryCompiler: BindingQueryCompiler;
  readonly #previews = new Map<string, StoredDraftPreview>();

  constructor(
    readonly metadataDatabase: MetadataDatabase,
    readonly storage: ProjectStorage,
    readonly clock: () => Date = () => new Date(),
  ) {
    this.pageRepository = new PageRepository(metadataDatabase);
    this.elementRepository = new ElementRepository(metadataDatabase);
    this.relationshipRepository = new RelationshipRepository(metadataDatabase);
    this.schemaRepository = new SchemaRepository(metadataDatabase);
    this.projectRepository = new ProjectRepository(metadataDatabase);
    this.queryCompiler = new BindingQueryCompiler(metadataDatabase, storage);
  }

  buildSnapshot(
    projectId: string,
    sourceProjectRevision: number,
  ): ProjectDefinitionSnapshotDto {
    const project = this.#activeProject(projectId);
    return {
      definitionSchemaVersion: PROJECT_DEFINITION_SCHEMA_VERSION,
      projectId,
      sourceProjectRevision,
      themeId: project.theme_id,
      registryChecksum: ELEMENT_REGISTRY_CHECKSUM,
      pages: this.pageRepository
        .listActive(projectId)
        .map((page) => this.pageRepository.toPublishedPage(page)),
      elements: this.elementRepository.listActiveForProject(projectId),
      layoutRevisions: this.elementRepository.layoutRevisionSnapshot(projectId),
      bindings: this.relationshipRepository
        .listActive(projectId)
        .map((binding) => this.relationshipRepository.toDto(binding)),
      dataSchema: this.schemaRepository.exportDefinition(projectId),
    };
  }

  createPreview(
    projectIdValue: unknown,
    expectedProjectRevisionValue: unknown,
  ): DraftPreviewDto {
    const projectId = uuid(projectIdValue, "INVALID_PROJECT_ID", "Project ID");
    const expectedProjectRevision = revisions(expectedProjectRevisionValue);
    const project = this.#activeProject(projectId);
    assertApi(
      project.revision === expectedProjectRevision,
      409,
      "PROJECT_REVISION_CONFLICT",
      "Project revision changed",
      { latestRevision: project.revision },
    );
    this.#purgeExpiredPreviews();
    const now = this.clock();
    const previewId = randomUUID();
    const snapshot = this.buildSnapshot(projectId, project.revision);
    const stored: StoredDraftPreview = {
      previewId,
      snapshot,
      definitionChecksum: projectDefinitionChecksum(snapshot),
      createdAt: now.toISOString(),
      expiresAt: new Date(
        now.getTime() + DRAFT_PREVIEW_TTL_MILLISECONDS,
      ).toISOString(),
      createdAtMs: now.getTime(),
    };
    this.#previews.set(previewId, stored);
    while (this.#previews.size > DRAFT_PREVIEW_CAPACITY) {
      const oldest = this.#previews.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.#previews.delete(oldest);
    }
    return {
      ...this.#metadata(stored),
      previewId,
      expiresAt: stored.expiresAt,
      defaultRoute:
        snapshot.pages.find((page) => page.navigationVisible)?.route ??
        snapshot.pages[0]?.route ??
        null,
    };
  }

  draftNavigation(previewIdValue: unknown): DraftRuntimeNavigationDto {
    const preview = this.#preview(previewIdValue);
    return {
      ...this.#metadata(preview),
      previewId: preview.previewId,
      expiresAt: preview.expiresAt,
      pages: preview.snapshot.pages,
    };
  }

  draftPage(
    previewIdValue: unknown,
    pageIdValue: unknown,
  ): DraftRuntimePageDto {
    const preview = this.#preview(previewIdValue);
    const pageId = uuid(pageIdValue, "INVALID_PAGE_ID", "Page ID");
    const page = preview.snapshot.pages.find((entry) => entry.id === pageId);
    assertApi(
      page !== undefined,
      404,
      "DRAFT_PREVIEW_PAGE_NOT_FOUND",
      "Draft Preview Page was not found",
    );
    return {
      ...this.#metadata(preview),
      previewId: preview.previewId,
      expiresAt: preview.expiresAt,
      page,
      elements: this.#pageElements(preview.snapshot, pageId),
      bindings: this.#pageBindings(preview.snapshot, pageId),
    };
  }

  publishedNavigation(projectIdValue: unknown): RuntimeNavigationDto & {
    readonly snapshotId: string;
    readonly sourceProjectRevision: number;
    readonly definitionChecksum: string;
    readonly registryChecksum: string;
    readonly themeId: string;
    readonly createdAt: string;
  } {
    const { version, snapshot, definitionChecksum } =
      this.#published(projectIdValue);
    return {
      projectId: snapshot.projectId,
      versionId: version.id,
      snapshotId: version.id,
      publishedAt: version.published_at,
      createdAt: version.published_at,
      sourceProjectRevision: snapshot.sourceProjectRevision,
      themeId: snapshot.themeId,
      definitionChecksum,
      registryChecksum: snapshot.registryChecksum,
      pages: snapshot.pages,
    };
  }

  publishedPage(
    projectIdValue: unknown,
    pageIdValue: unknown,
  ): PublishedRuntimeDefinitionPageDto {
    const { version, snapshot, definitionChecksum } =
      this.#published(projectIdValue);
    const pageId = uuid(pageIdValue, "INVALID_PAGE_ID", "Page ID");
    const page = snapshot.pages.find((entry) => entry.id === pageId);
    assertApi(
      page !== undefined,
      404,
      "RUNTIME_PAGE_NOT_FOUND",
      "Published Page was not found",
    );
    return {
      projectId: snapshot.projectId,
      snapshotId: version.id,
      versionId: version.id,
      sourceProjectRevision: snapshot.sourceProjectRevision,
      themeId: snapshot.themeId,
      definitionChecksum,
      registryChecksum: snapshot.registryChecksum,
      createdAt: version.published_at,
      publishedAt: version.published_at,
      page,
      elements: this.#pageElements(snapshot, pageId),
      bindings: this.#pageBindings(snapshot, pageId),
    };
  }

  executeDraftBinding(
    previewIdValue: unknown,
    bindingIdValue: unknown,
    request: ExecuteBindingQueryRequest,
  ): RuntimeBindingResultDto {
    const preview = this.#preview(previewIdValue);
    return this.#execute(
      preview.snapshot,
      preview.previewId,
      preview.definitionChecksum,
      bindingIdValue,
      "test",
      request,
    );
  }

  executePublishedBinding(
    projectIdValue: unknown,
    bindingIdValue: unknown,
    request: ExecuteBindingQueryRequest,
  ): RuntimeBindingResultDto {
    const { version, snapshot, definitionChecksum } =
      this.#published(projectIdValue);
    return this.#execute(
      snapshot,
      version.id,
      definitionChecksum,
      bindingIdValue,
      "production",
      request,
    );
  }

  #execute(
    snapshot: ProjectDefinitionSnapshotDto,
    snapshotId: string,
    definitionChecksum: string,
    bindingIdValue: unknown,
    environment: "test" | "production",
    request: ExecuteBindingQueryRequest,
  ): RuntimeBindingResultDto {
    const bindingId = uuid(bindingIdValue, "INVALID_BINDING_ID", "Binding ID");
    const parameters = request.parameters ?? {};
    assertApi(
      typeof parameters === "object" &&
        parameters !== null &&
        !Array.isArray(parameters) &&
        Object.keys(parameters).length === 0,
      400,
      "UNSUPPORTED_BINDING_PARAMETER",
      "This READ Binding does not declare Runtime parameters",
    );
    const binding = snapshot.bindings.find((entry) => entry.id === bindingId);
    assertApi(
      binding?.bindingType === "READ",
      404,
      "SNAPSHOT_BINDING_NOT_FOUND",
      "The Runtime snapshot does not contain this READ Binding",
    );
    assertApi(
      binding.status === "READY",
      409,
      "BINDING_DISABLED",
      "Binding is disabled in this Runtime snapshot",
    );
    const compiled = this.queryCompiler.compileStored(
      snapshot.projectId,
      binding.source,
      binding.target,
      binding.query,
      binding.mapping,
      snapshot.dataSchema,
    );
    const expectedAppliedRevision =
      environment === "test"
        ? snapshot.dataSchema.testAppliedRevision
        : snapshot.dataSchema.productionAppliedRevision;
    const result = this.queryCompiler.execute(
      snapshot.projectId,
      environment,
      compiled,
      expectedAppliedRevision,
    );
    this.metadataDatabase.connection
      .prepare(
        `INSERT INTO binding_query_runs (
           id, project_id, binding_id, environment, plan_checksum, row_count,
           truncated, render_state, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        snapshot.projectId,
        binding.id,
        environment,
        compiled.planChecksum,
        result.rowCount,
        result.truncated ? 1 : 0,
        result.renderState,
        this.clock().toISOString(),
      );
    return {
      bindingId: binding.id,
      projectId: snapshot.projectId,
      targetElementId: binding.target.objectId,
      environment,
      planChecksum: compiled.planChecksum,
      result,
      snapshotId,
      definitionChecksum,
    };
  }

  #published(projectIdValue: unknown): {
    readonly version: ProjectVersionRow;
    readonly snapshot: ProjectDefinitionSnapshotDto;
    readonly definitionChecksum: string;
  } {
    const projectId = uuid(projectIdValue, "INVALID_PROJECT_ID", "Project ID");
    this.#activeProject(projectId);
    const version = this.pageRepository.latestVersion(projectId);
    assertApi(
      version !== undefined,
      404,
      "PROJECT_NOT_PUBLISHED",
      "Project is not published",
    );
    const snapshot = this.#normalizeSnapshot(version);
    return {
      version,
      snapshot,
      definitionChecksum: projectDefinitionChecksum(snapshot),
    };
  }

  #normalizeSnapshot(version: ProjectVersionRow): ProjectDefinitionSnapshotDto {
    const value = this.pageRepository.versionSnapshot(version);
    if (
      "definitionSchemaVersion" in value &&
      value.definitionSchemaVersion === PROJECT_DEFINITION_SCHEMA_VERSION
    ) {
      assertApi(
        value.projectId === version.project_id &&
          value.sourceProjectRevision === version.source_project_revision &&
          typeof value.themeId === "string" &&
          /^[0-9a-f]{64}$/u.test(value.registryChecksum) &&
          Array.isArray(value.pages) &&
          Array.isArray(value.elements) &&
          Array.isArray(value.bindings) &&
          typeof value.dataSchema === "object" &&
          value.dataSchema !== null,
        500,
        "PUBLISHED_SNAPSHOT_INVALID",
        "Published Project Definition is invalid",
      );
      return value;
    }
    return {
      definitionSchemaVersion: PROJECT_DEFINITION_SCHEMA_VERSION,
      projectId: version.project_id,
      sourceProjectRevision: version.source_project_revision,
      themeId: this.#activeProject(version.project_id).theme_id,
      registryChecksum: ELEMENT_REGISTRY_CHECKSUM,
      pages: value.pages,
      elements: value.elements ?? [],
      layoutRevisions: value.layoutRevisions ?? [],
      bindings: [],
      dataSchema: this.schemaRepository.exportDefinition(version.project_id),
    };
  }

  #preview(previewIdValue: unknown): StoredDraftPreview {
    const previewId = uuid(
      previewIdValue,
      "INVALID_DRAFT_PREVIEW_ID",
      "Draft Preview ID",
    );
    this.#purgeExpiredPreviews();
    const preview = this.#previews.get(previewId);
    assertApi(
      preview !== undefined,
      404,
      "DRAFT_PREVIEW_NOT_FOUND",
      "Draft Preview was not found or expired",
    );
    this.#activeProject(preview.snapshot.projectId);
    return preview;
  }

  #purgeExpiredPreviews(): void {
    const now = this.clock().getTime();
    for (const [id, preview] of this.#previews) {
      if (preview.createdAtMs + DRAFT_PREVIEW_TTL_MILLISECONDS <= now) {
        this.#previews.delete(id);
      }
    }
  }

  #metadata(preview: StoredDraftPreview) {
    return {
      projectId: preview.snapshot.projectId,
      snapshotId: preview.previewId,
      sourceProjectRevision: preview.snapshot.sourceProjectRevision,
      themeId: preview.snapshot.themeId,
      definitionChecksum: preview.definitionChecksum,
      registryChecksum: preview.snapshot.registryChecksum,
      createdAt: preview.createdAt,
    };
  }

  #pageElements(snapshot: ProjectDefinitionSnapshotDto, pageId: string) {
    return snapshot.elements
      .map((entry) => this.#normalizeElement(entry, snapshot.projectId))
      .filter(
        (entry) => entry.element.pageId === pageId && !entry.element.hidden,
      );
  }

  #normalizeElement(
    entry: ElementEntryDto,
    projectId: string,
  ): ElementEntryDto {
    assertApi(
      entry.element.projectId === projectId &&
        entry.element.typeVersion === 1 &&
        typeof entry.element.hidden === "boolean",
      500,
      "PUBLISHED_SNAPSHOT_INVALID",
      "Published Element ownership is invalid",
    );
    try {
      const definition = elementDefinition(entry.element.type);
      const state = validateElementStoredState(definition, {
        props: entry.element.props,
        style: entry.element.style,
        events: entry.element.events,
      });
      return {
        ...entry,
        element: {
          ...entry.element,
          props: state.props,
          style: state.style,
          events: state.events,
        },
      };
    } catch (error) {
      if (error instanceof ApiError && error.statusCode === 400) {
        throw new ApiError(
          500,
          "PUBLISHED_SNAPSHOT_INVALID",
          "Published Element Registry state is invalid",
        );
      }
      throw error;
    }
  }

  #pageBindings(snapshot: ProjectDefinitionSnapshotDto, pageId: string) {
    const elementIds = new Set(
      snapshot.elements
        .filter((entry) => entry.element.pageId === pageId)
        .map((entry) => entry.element.id),
    );
    return snapshot.bindings.filter(
      (binding) =>
        binding.target.nodeType === "element" &&
        elementIds.has(binding.target.objectId),
    );
  }

  #activeProject(projectId: string) {
    const project = this.projectRepository.get(projectId);
    assertApi(
      project !== undefined,
      404,
      "PROJECT_NOT_FOUND",
      "Project was not found",
    );
    if (project.lifecycle_status !== "ACTIVE") {
      throw new ApiError(409, "PROJECT_NOT_ACTIVE", "Project is not active");
    }
    return project;
  }
}
