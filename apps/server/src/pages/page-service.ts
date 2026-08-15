import { createHash, randomUUID } from "node:crypto";

import {
  LUCIDE_ICON_CATALOG_VERSION,
  PUBLISH_VALIDATION_CODES,
  type CreatePageRequest,
  type DeletePageImpact,
  type DeletePageRequest,
  type ElementEntryDto,
  type IconCatalogItemDto,
  type PageDto,
  type PatchPageIconRequest,
  type PatchPageRequest,
  type PublishedRuntimePageDto,
  type PublishPlanDto,
  type PublishedNavigationPageDto,
  type ReorderPagesRequest,
  type RuntimeNavigationDto,
  type UndoPageCommandRequest,
} from "@webeditor/domain";

import { ApiError, assertApi } from "../errors.js";
import { LUCIDE_ICON_CATALOG } from "../icons/lucide-icon-catalog.generated.js";
import { ElementRepository } from "../elements/element-repository.js";
import {
  elementDefinition,
  validateElementStoredState,
} from "../elements/element-registry.js";
import type { MetadataDatabase } from "../metadata/database.js";
import {
  PageRepository,
  type DefinitionOperationRow,
  type PageRow,
} from "./page-repository.js";
import {
  ProjectRepository,
  type ProjectRow,
} from "../projects/project-repository.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROUTE_PATTERN =
  /^\/(?:[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*)?$/;
const ICON_PAGE_SIZE = 60;

const iconByName = new Map<string, IconCatalogItemDto>(
  LUCIDE_ICON_CATALOG.map((item) => [item.name, item]),
);
const iconCategories = [
  ...new Set(LUCIDE_ICON_CATALOG.flatMap((item) => item.categories)),
].sort();
const iconCategorySet = new Set<string>(iconCategories);

export interface PageServiceOptions {
  readonly metadataDatabase: MetadataDatabase;
  readonly clock?: () => Date;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
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

function operationHash(
  operation: DefinitionOperationRow["operation_type"],
  projectId: string,
  request: unknown,
): string {
  return createHash("sha256")
    .update(stableJson({ operation, projectId, request }))
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

function validateExpectedRevision(value: unknown, code: string): number {
  assertApi(
    Number.isInteger(value) && (value as number) >= 0,
    400,
    code,
    "Revision is invalid",
  );
  return value as number;
}

function validateIdempotencyKey(value: unknown): string {
  assertApi(
    typeof value === "string" && value.length >= 8 && value.length <= 200,
    400,
    "INVALID_IDEMPOTENCY_KEY",
    "Idempotency key is invalid",
  );
  return value;
}

function validatePageName(value: unknown): string {
  assertApi(
    typeof value === "string",
    400,
    "INVALID_PAGE_NAME",
    "Page name is required",
  );
  const name = value.trim();
  assertApi(
    name.length >= 1 && name.length <= 99,
    400,
    "INVALID_PAGE_NAME",
    "Page name must contain 1 to 99 characters",
  );
  return name;
}

function validateRoute(value: unknown): string {
  assertApi(
    typeof value === "string" &&
      value.length <= 200 &&
      ROUTE_PATTERN.test(value),
    400,
    "INVALID_PAGE_ROUTE",
    "Page route is invalid",
  );
  return value;
}

function validateNavigationGroup(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  assertApi(
    typeof value === "string" &&
      value.trim().length >= 1 &&
      value.trim().length <= 100,
    400,
    "INVALID_NAVIGATION_GROUP",
    "Navigation group is invalid",
  );
  return value.trim();
}

function isUniqueConstraint(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === "SQLITE_CONSTRAINT_UNIQUE"
  );
}

function publishValidation(
  pages: readonly PublishedNavigationPageDto[],
): Pick<PublishPlanDto, "errors" | "warnings"> {
  const allNavigationHidden =
    pages.length > 0 && !pages.some((page) => page.navigationVisible);
  return {
    errors: allNavigationHidden ? [PUBLISH_VALIDATION_CODES[0]] : [],
    warnings: pages.length === 0 ? ["No pages"] : [],
  };
}

export class PageService {
  readonly repository: PageRepository;
  readonly elementRepository: ElementRepository;
  readonly projectRepository: ProjectRepository;
  readonly #clock: () => Date;

  constructor(options: PageServiceOptions) {
    this.repository = new PageRepository(options.metadataDatabase);
    this.elementRepository = new ElementRepository(options.metadataDatabase);
    this.projectRepository = new ProjectRepository(options.metadataDatabase);
    this.#clock = options.clock ?? (() => new Date());
  }

  #now(): string {
    return this.#clock().toISOString();
  }

  list(projectId: string): {
    readonly pages: readonly PageDto[];
    readonly projectRevision: number;
    readonly publishedVersionId: string | null;
  } {
    assertUuid(projectId, "INVALID_PROJECT_ID", "Project ID");
    const project = this.#activeProject(projectId);
    return {
      pages: this.repository
        .listActive(projectId)
        .map((page) => this.repository.toDto(page)),
      projectRevision: project.revision,
      publishedVersionId: this.repository.latestVersion(projectId)?.id ?? null,
    };
  }

  create(
    projectId: string,
    request: CreatePageRequest,
  ): {
    readonly page: PageDto;
    readonly projectRevision: number;
  } {
    assertUuid(projectId, "INVALID_PROJECT_ID", "Project ID");
    assertApi(
      request.pageType === "blank",
      400,
      "INVALID_PAGE_TYPE",
      "Only blank pages are available",
    );
    const expectedProjectRevision = validateExpectedRevision(
      request.expectedProjectRevision,
      "INVALID_EXPECTED_PROJECT_REVISION",
    );
    const idempotencyKey = validateIdempotencyKey(request.idempotencyKey);
    const hash = operationHash("PAGE_CREATE", projectId, request);
    const replay = this.#replay<{
      readonly page: PageDto;
      readonly projectRevision: number;
    }>(projectId, idempotencyKey, hash);
    if (replay !== undefined) return replay;

    const name =
      request.name === undefined
        ? `Page ${this.repository.listActive(projectId).length + 1}`
        : validatePageName(request.name);
    const now = this.#now();
    return this.repository.metadataDatabase.transaction(() => {
      const project = this.#activeProject(projectId);
      this.#assertProjectRevision(project, expectedProjectRevision);
      const pages = this.repository.listActive(projectId);
      const route = this.#nextRoute(pages);
      const inserted = this.repository.insert({
        id: randomUUID(),
        projectId,
        name,
        route,
        pageType: "blank",
        iconName: "File",
        sortOrder: pages.length,
        now,
      });
      const projectRevision = this.#bumpProject(
        projectId,
        expectedProjectRevision,
        now,
      );
      const response = {
        page: this.repository.toDto(inserted),
        projectRevision,
      };
      this.#audit(
        "PAGE_CREATED",
        projectId,
        inserted.id,
        null,
        response.page,
        now,
      );
      this.repository.storeOperation({
        id: randomUUID(),
        projectId,
        type: "PAGE_CREATE",
        idempotencyKey,
        requestHash: hash,
        statusCode: 201,
        response,
        now,
      });
      return response;
    });
  }

  patch(
    pageId: string,
    request: PatchPageRequest,
  ): {
    readonly page: PageDto;
    readonly projectRevision: number;
  } {
    assertUuid(pageId, "INVALID_PAGE_ID", "Page ID");
    const expectedRevision = validateExpectedRevision(
      request.expectedRevision,
      "INVALID_EXPECTED_REVISION",
    );
    const expectedProjectRevision = validateExpectedRevision(
      request.expectedProjectRevision,
      "INVALID_EXPECTED_PROJECT_REVISION",
    );
    const current = this.#activePage(pageId);
    const name =
      request.name === undefined
        ? current.name
        : validatePageName(request.name);
    const route =
      request.route === undefined
        ? current.route
        : validateRoute(request.route);
    const navigationVisible =
      request.navigationVisible === undefined
        ? current.navigation_visible === 1
        : request.navigationVisible;
    assertApi(
      typeof navigationVisible === "boolean",
      400,
      "INVALID_NAVIGATION_VISIBILITY",
      "Navigation visibility is invalid",
    );
    const navigationGroup =
      request.navigationGroup === undefined
        ? current.navigation_group
        : validateNavigationGroup(request.navigationGroup);
    const now = this.#now();
    try {
      return this.repository.metadataDatabase.transaction(() => {
        const page = this.#activePage(pageId);
        const project = this.#activeProject(page.project_id);
        this.#assertPageRevision(page, expectedRevision, project.revision);
        this.#assertProjectRevision(project, expectedProjectRevision);
        const updated = this.repository.patch(pageId, expectedRevision, {
          name,
          route,
          navigationVisible,
          navigationGroup,
          now,
        });
        if (updated === undefined)
          throw this.#pageConflict(pageId, project.revision);
        const projectRevision = this.#bumpProject(
          project.id,
          expectedProjectRevision,
          now,
        );
        const response = {
          page: this.repository.toDto(updated),
          projectRevision,
        };
        this.#audit(
          "PAGE_UPDATED",
          project.id,
          page.id,
          this.repository.toDto(page),
          response.page,
          now,
        );
        return response;
      });
    } catch (error) {
      if (isUniqueConstraint(error)) {
        throw new ApiError(
          409,
          "PAGE_ROUTE_CONFLICT",
          "Page route already exists",
        );
      }
      throw error;
    }
  }

  patchIcon(
    pageId: string,
    request: PatchPageIconRequest,
  ): {
    readonly page: PageDto;
    readonly projectRevision: number;
  } {
    assertUuid(pageId, "INVALID_PAGE_ID", "Page ID");
    const expectedRevision = validateExpectedRevision(
      request.expectedRevision,
      "INVALID_EXPECTED_REVISION",
    );
    const expectedProjectRevision = validateExpectedRevision(
      request.expectedProjectRevision,
      "INVALID_EXPECTED_PROJECT_REVISION",
    );
    assertApi(
      request.iconCatalogVersion === LUCIDE_ICON_CATALOG_VERSION,
      400,
      "INVALID_ICON_CATALOG_VERSION",
      "Icon catalog version is invalid",
    );
    const icon = this.getIcon(request.iconName);
    const now = this.#now();
    return this.repository.metadataDatabase.transaction(() => {
      const page = this.#activePage(pageId);
      const project = this.#activeProject(page.project_id);
      this.#assertPageRevision(page, expectedRevision, project.revision);
      this.#assertProjectRevision(project, expectedProjectRevision);
      const updated = this.repository.patchIcon(
        pageId,
        expectedRevision,
        icon.name,
        now,
      );
      if (updated === undefined)
        throw this.#pageConflict(pageId, project.revision);
      const projectRevision = this.#bumpProject(
        project.id,
        expectedProjectRevision,
        now,
      );
      const response = {
        page: this.repository.toDto(updated),
        projectRevision,
      };
      this.#audit(
        "PAGE_ICON_UPDATED",
        project.id,
        page.id,
        this.repository.toDto(page),
        response.page,
        now,
      );
      return response;
    });
  }

  reorder(
    projectId: string,
    request: ReorderPagesRequest,
  ): {
    readonly pages: readonly PageDto[];
    readonly projectRevision: number;
  } {
    assertUuid(projectId, "INVALID_PROJECT_ID", "Project ID");
    const expectedProjectRevision = validateExpectedRevision(
      request.expectedProjectRevision,
      "INVALID_EXPECTED_PROJECT_REVISION",
    );
    const idempotencyKey = validateIdempotencyKey(request.idempotencyKey);
    assertApi(
      Array.isArray(request.pageIds) &&
        request.pageIds.every((id) => typeof id === "string"),
      400,
      "INVALID_PAGE_REORDER",
      "Page order is invalid",
    );
    const hash = operationHash("PAGE_REORDER", projectId, request);
    const replay = this.#replay<{
      readonly pages: readonly PageDto[];
      readonly projectRevision: number;
    }>(projectId, idempotencyKey, hash);
    if (replay !== undefined) return replay;
    const now = this.#now();
    return this.repository.metadataDatabase.transaction(() => {
      const project = this.#activeProject(projectId);
      this.#assertProjectRevision(project, expectedProjectRevision);
      const current = this.repository.listActive(projectId);
      const currentIds = new Set(current.map((page) => page.id));
      const requestedIds = new Set(request.pageIds);
      assertApi(
        request.pageIds.length === current.length &&
          requestedIds.size === request.pageIds.length &&
          request.pageIds.every(
            (id) => UUID_PATTERN.test(id) && currentIds.has(id),
          ),
        400,
        "INVALID_PAGE_REORDER",
        "Page order must contain every active page once",
      );
      const reordered = this.repository.reorder(
        projectId,
        request.pageIds,
        now,
      );
      const projectRevision = this.#bumpProject(
        projectId,
        expectedProjectRevision,
        now,
      );
      const response = {
        pages: reordered.map((page) => this.repository.toDto(page)),
        projectRevision,
      };
      this.#audit(
        "PAGES_REORDERED",
        projectId,
        projectId,
        current.map((page) => page.id),
        request.pageIds,
        now,
      );
      this.repository.storeOperation({
        id: randomUUID(),
        projectId,
        type: "PAGE_REORDER",
        idempotencyKey,
        requestHash: hash,
        statusCode: 200,
        response,
        now,
      });
      return response;
    });
  }

  delete(
    pageId: string,
    request: DeletePageRequest,
  ): {
    readonly commandId: string;
    readonly impact: DeletePageImpact;
    readonly projectRevision: number;
  } {
    assertUuid(pageId, "INVALID_PAGE_ID", "Page ID");
    const expectedRevision = validateExpectedRevision(
      request.expectedRevision,
      "INVALID_EXPECTED_REVISION",
    );
    const expectedProjectRevision = validateExpectedRevision(
      request.expectedProjectRevision,
      "INVALID_EXPECTED_PROJECT_REVISION",
    );
    const idempotencyKey = validateIdempotencyKey(request.idempotencyKey);
    assertApi(
      request.resolution === "DELETE_DEPENDENCIES",
      400,
      "INVALID_PAGE_DELETE_RESOLUTION",
      "Delete resolution is invalid",
    );
    if (request.reassignNavigationToPageId !== undefined) {
      assertUuid(
        request.reassignNavigationToPageId,
        "INVALID_REASSIGN_PAGE_ID",
        "Reassign page ID",
      );
      assertApi(
        request.reassignNavigationToPageId !== pageId,
        400,
        "INVALID_REASSIGN_PAGE_ID",
        "Reassign page must differ",
      );
    }
    const initial = this.repository.get(pageId);
    assertApi(
      initial !== undefined,
      404,
      "PAGE_NOT_FOUND",
      "Page was not found",
    );
    const projectId = initial.project_id;
    const hash = operationHash("PAGE_DELETE", projectId, {
      pageId,
      ...request,
    });
    const replay = this.#replay<{
      readonly commandId: string;
      readonly impact: DeletePageImpact;
      readonly projectRevision: number;
    }>(projectId, idempotencyKey, hash);
    if (replay !== undefined) return replay;
    this.#activeProject(projectId);
    const now = this.#now();
    return this.repository.metadataDatabase.transaction(() => {
      const page = this.#activePage(pageId);
      const project = this.#activeProject(page.project_id);
      this.#assertPageRevision(page, expectedRevision, project.revision);
      this.#assertProjectRevision(project, expectedProjectRevision);
      if (request.reassignNavigationToPageId !== undefined) {
        const target = this.#activePage(request.reassignNavigationToPageId);
        assertApi(
          target.project_id === project.id,
          400,
          "INVALID_REASSIGN_PAGE_ID",
          "Reassign page belongs to another project",
        );
      }
      const impact: DeletePageImpact = {
        elementCount: this.elementRepository.activeCountForPage(page.id),
        bindingCount: 0,
        navigationReferenceCount: 0,
        validationScenarioCount: 0,
        reassignNavigationToPageId: request.reassignNavigationToPageId ?? null,
      };
      const commandId = randomUUID();
      const before = this.repository.toDto(page);
      this.repository.createDeleteCommand({
        id: commandId,
        page: before,
        impact,
        now,
      });
      this.repository.tombstone(page, now);
      const projectRevision = this.#bumpProject(
        project.id,
        expectedProjectRevision,
        now,
      );
      const response = { commandId, impact, projectRevision };
      this.#audit("PAGE_DELETED", project.id, page.id, before, response, now);
      this.repository.storeOperation({
        id: randomUUID(),
        projectId: project.id,
        type: "PAGE_DELETE",
        idempotencyKey,
        requestHash: hash,
        statusCode: 200,
        response,
        now,
      });
      return response;
    });
  }

  deletePlan(
    pageId: string,
    request: {
      readonly expectedRevision: number;
      readonly expectedProjectRevision: number;
    },
  ): {
    readonly impact: DeletePageImpact;
    readonly allowedResolutions: readonly ["DELETE_DEPENDENCIES"];
  } {
    assertUuid(pageId, "INVALID_PAGE_ID", "Page ID");
    const expectedRevision = validateExpectedRevision(
      request.expectedRevision,
      "INVALID_EXPECTED_REVISION",
    );
    const expectedProjectRevision = validateExpectedRevision(
      request.expectedProjectRevision,
      "INVALID_EXPECTED_PROJECT_REVISION",
    );
    const page = this.#activePage(pageId);
    const project = this.#activeProject(page.project_id);
    this.#assertPageRevision(page, expectedRevision, project.revision);
    this.#assertProjectRevision(project, expectedProjectRevision);
    return {
      impact: {
        elementCount: this.elementRepository.activeCountForPage(page.id),
        bindingCount: 0,
        navigationReferenceCount: 0,
        validationScenarioCount: 0,
        reassignNavigationToPageId: null,
      },
      allowedResolutions: ["DELETE_DEPENDENCIES"],
    };
  }

  undo(
    projectId: string,
    commandId: string,
    request: UndoPageCommandRequest,
  ): {
    readonly page: PageDto;
    readonly projectRevision: number;
  } {
    assertUuid(projectId, "INVALID_PROJECT_ID", "Project ID");
    assertUuid(commandId, "INVALID_PAGE_COMMAND_ID", "Command ID");
    const expectedProjectRevision = validateExpectedRevision(
      request.expectedProjectRevision,
      "INVALID_EXPECTED_PROJECT_REVISION",
    );
    const idempotencyKey = validateIdempotencyKey(request.idempotencyKey);
    const hash = operationHash("PAGE_UNDO", projectId, {
      commandId,
      ...request,
    });
    const replay = this.#replay<{
      readonly page: PageDto;
      readonly projectRevision: number;
    }>(projectId, idempotencyKey, hash);
    if (replay !== undefined) return replay;
    const now = this.#now();
    try {
      return this.repository.metadataDatabase.transaction(() => {
        const project = this.#activeProject(projectId);
        this.#assertProjectRevision(project, expectedProjectRevision);
        const command = this.repository.getDeleteCommand(commandId, projectId);
        assertApi(
          command !== undefined,
          404,
          "PAGE_COMMAND_NOT_FOUND",
          "Page command was not found",
        );
        assertApi(
          command.undone_at === null,
          409,
          "PAGE_COMMAND_ALREADY_UNDONE",
          "Page command was already undone",
        );
        const restored = this.repository.restoreDeleted(command, now);
        const projectRevision = this.#bumpProject(
          projectId,
          expectedProjectRevision,
          now,
        );
        const response = {
          page: this.repository.toDto(restored),
          projectRevision,
        };
        this.#audit(
          "PAGE_DELETE_UNDONE",
          projectId,
          restored.id,
          null,
          response.page,
          now,
        );
        this.repository.storeOperation({
          id: randomUUID(),
          projectId,
          type: "PAGE_UNDO",
          idempotencyKey,
          requestHash: hash,
          statusCode: 200,
          response,
          now,
        });
        return response;
      });
    } catch (error) {
      if (isUniqueConstraint(error)) {
        throw new ApiError(
          409,
          "PAGE_RESTORE_CONFLICT",
          "Page route or order conflicts with an active page",
        );
      }
      throw error;
    }
  }

  publishPlan(
    projectId: string,
    expectedProjectRevision: unknown,
  ): {
    readonly plan: PublishPlanDto;
  } {
    assertUuid(projectId, "INVALID_PROJECT_ID", "Project ID");
    const expected = validateExpectedRevision(
      expectedProjectRevision,
      "INVALID_EXPECTED_PROJECT_REVISION",
    );
    const project = this.#activeProject(projectId);
    this.#assertProjectRevision(project, expected);
    const pages = this.repository
      .listActive(projectId)
      .map((page) => this.repository.toPublishedPage(page));
    const validation = publishValidation(pages);
    return {
      plan: {
        projectId,
        projectRevision: project.revision,
        pages,
        ...validation,
      },
    };
  }

  publish(
    projectId: string,
    request: {
      readonly expectedProjectRevision: number;
      readonly idempotencyKey: string;
    },
  ): {
    readonly versionId: string;
    readonly publishedAt: string;
    readonly projectRevision: number;
  } {
    assertUuid(projectId, "INVALID_PROJECT_ID", "Project ID");
    const expectedProjectRevision = validateExpectedRevision(
      request.expectedProjectRevision,
      "INVALID_EXPECTED_PROJECT_REVISION",
    );
    const idempotencyKey = validateIdempotencyKey(request.idempotencyKey);
    const hash = operationHash("PUBLISH", projectId, request);
    const replay = this.#replay<{
      readonly versionId: string;
      readonly publishedAt: string;
      readonly projectRevision: number;
    }>(projectId, idempotencyKey, hash);
    if (replay !== undefined) return replay;
    const now = this.#now();
    return this.repository.metadataDatabase.transaction(() => {
      const project = this.#activeProject(projectId);
      this.#assertProjectRevision(project, expectedProjectRevision);
      const pages = this.repository
        .listActive(projectId)
        .map((page) => this.repository.toPublishedPage(page));
      const validation = publishValidation(pages);
      assertApi(
        validation.errors.length === 0,
        422,
        "PUBLISH_ALL_NAVIGATION_HIDDEN",
        "Show at least one page in navigation",
        validation,
      );
      const projectRevision = this.#bumpProject(
        projectId,
        expectedProjectRevision,
        now,
        true,
      );
      const version = this.repository.insertVersion({
        id: randomUUID(),
        projectId,
        sourceProjectRevision: projectRevision,
        snapshot: {
          pages,
          elements: this.elementRepository.listActiveForProject(projectId),
          layoutRevisions:
            this.elementRepository.layoutRevisionSnapshot(projectId),
        },
        now,
      });
      const response = {
        versionId: version.id,
        publishedAt: version.published_at,
        projectRevision,
      };
      this.#audit(
        "PROJECT_PUBLISHED",
        projectId,
        version.id,
        null,
        response,
        now,
      );
      this.repository.storeOperation({
        id: randomUUID(),
        projectId,
        type: "PUBLISH",
        idempotencyKey,
        requestHash: hash,
        statusCode: 200,
        response,
        now,
      });
      return response;
    });
  }

  runtimeNavigation(projectId: string): RuntimeNavigationDto {
    assertUuid(projectId, "INVALID_PROJECT_ID", "Project ID");
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
    const version = this.repository.latestVersion(projectId);
    assertApi(
      version !== undefined,
      404,
      "PROJECT_NOT_PUBLISHED",
      "Project is not published",
    );
    return this.repository.toRuntimeNavigation(version);
  }

  runtimePage(projectId: string, pageId: string): PublishedRuntimePageDto {
    assertUuid(projectId, "INVALID_PROJECT_ID", "Project ID");
    assertUuid(pageId, "INVALID_PAGE_ID", "Page ID");
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
    const version = this.repository.latestVersion(projectId);
    assertApi(
      version !== undefined,
      404,
      "PROJECT_NOT_PUBLISHED",
      "Project is not published",
    );
    const snapshot = this.repository.versionSnapshot(version);
    const page = snapshot.pages.find((candidate) => candidate.id === pageId);
    assertApi(
      page !== undefined,
      404,
      "RUNTIME_PAGE_NOT_FOUND",
      "Published page was not found",
    );
    const elements = (snapshot.elements ?? [])
      .map((entry) => {
        assertApi(
          typeof entry === "object" && entry !== null && !Array.isArray(entry),
          500,
          "PUBLISHED_SNAPSHOT_INVALID",
          "Published Element snapshot is invalid",
        );
        const candidate = entry as {
          readonly element?: {
            readonly pageId?: unknown;
            readonly projectId?: unknown;
            readonly type?: unknown;
            readonly typeVersion?: unknown;
            readonly hidden?: unknown;
          };
        };
        assertApi(
          typeof candidate.element === "object" &&
            candidate.element !== null &&
            candidate.element.projectId === projectId &&
            candidate.element.typeVersion === 1 &&
            typeof candidate.element.hidden === "boolean",
          500,
          "PUBLISHED_SNAPSHOT_INVALID",
          "Published Element ownership is invalid",
        );
        const typedEntry = entry as ElementEntryDto;
        let state: ReturnType<typeof validateElementStoredState>;
        try {
          const definition = elementDefinition(candidate.element.type);
          state = validateElementStoredState(definition, {
            props: typedEntry.element.props,
            style: typedEntry.element.style,
            events: typedEntry.element.events,
          });
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
        return {
          ...typedEntry,
          element: {
            ...typedEntry.element,
            props: state.props,
            style: state.style,
            events: state.events,
          },
        };
      })
      .filter(
        (entry) => entry.element.pageId === pageId && !entry.element.hidden,
      );
    return {
      projectId,
      versionId: version.id,
      publishedAt: version.published_at,
      page,
      elements,
    };
  }

  listIcons(query: Record<string, unknown>): {
    readonly items: readonly IconCatalogItemDto[];
    readonly nextCursor: string | null;
    readonly categories: readonly string[];
  } {
    const search =
      typeof query.query === "string" ? query.query.trim().toLowerCase() : "";
    const category =
      typeof query.category === "string"
        ? query.category.trim().toLowerCase()
        : "";
    assertApi(
      search.length <= 120,
      400,
      "INVALID_ICON_QUERY",
      "Icon query is too long",
    );
    assertApi(
      category.length === 0 || iconCategorySet.has(category),
      400,
      "INVALID_ICON_CATEGORY",
      "Icon category is invalid",
    );
    const offset = this.#decodeCursor(query.cursor, search, category);
    const searchTerms = search.split(/\s+/).filter(Boolean);
    const matches = LUCIDE_ICON_CATALOG.filter((item) => {
      const searchable = [
        item.name.toLowerCase(),
        item.dynamicName,
        ...(item.keywords as readonly string[]),
      ].join(" ");
      return (
        (category.length === 0 ||
          (item.categories as readonly string[]).includes(category)) &&
        searchTerms.every((term) => searchable.includes(term))
      );
    });
    assertApi(
      offset <= matches.length,
      400,
      "INVALID_ICON_CURSOR",
      "Icon cursor is invalid",
    );
    const items = matches.slice(offset, offset + ICON_PAGE_SIZE);
    const nextOffset = offset + items.length;
    return {
      items,
      categories: iconCategories,
      nextCursor:
        nextOffset < matches.length
          ? Buffer.from(
              JSON.stringify({ v: 1, offset: nextOffset, search, category }),
            ).toString("base64url")
          : null,
    };
  }

  getIcon(iconName: unknown): IconCatalogItemDto {
    assertApi(
      typeof iconName === "string" && /^[A-Z][A-Za-z0-9]*$/.test(iconName),
      400,
      "INVALID_ICON_NAME",
      "Icon name is invalid",
    );
    const icon = iconByName.get(iconName);
    assertApi(icon !== undefined, 404, "ICON_NOT_FOUND", "Icon was not found");
    return icon;
  }

  #decodeCursor(value: unknown, search: string, category: string): number {
    if (value === undefined || value === "") return 0;
    assertApi(
      typeof value === "string" && value.length <= 500,
      400,
      "INVALID_ICON_CURSOR",
      "Icon cursor is invalid",
    );
    try {
      const cursor = JSON.parse(
        Buffer.from(value, "base64url").toString("utf8"),
      ) as Record<string, unknown>;
      assertApi(
        cursor.v === 1 &&
          Number.isInteger(cursor.offset) &&
          (cursor.offset as number) >= 0 &&
          cursor.search === search &&
          cursor.category === category,
        400,
        "INVALID_ICON_CURSOR",
        "Icon cursor is invalid",
      );
      return cursor.offset as number;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(400, "INVALID_ICON_CURSOR", "Icon cursor is invalid");
    }
  }

  #nextRoute(pages: readonly PageRow[]): string {
    const routes = new Set(pages.map((page) => page.route.toLowerCase()));
    let index = pages.length + 1;
    while (routes.has(`/page-${index}`)) index += 1;
    return `/page-${index}`;
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

  #activePage(pageId: string): PageRow {
    const page = this.repository.getActive(pageId);
    assertApi(page !== undefined, 404, "PAGE_NOT_FOUND", "Page was not found");
    return page;
  }

  #assertProjectRevision(project: ProjectRow, expected: number): void {
    if (project.revision !== expected) {
      throw new ApiError(
        409,
        "PROJECT_REVISION_CONFLICT",
        "Project revision is stale",
        {
          latest: this.projectRepository.toDto(project),
        },
      );
    }
  }

  #assertPageRevision(
    page: PageRow,
    expected: number,
    projectRevision: number,
  ): void {
    if (page.revision !== expected) {
      throw new ApiError(
        409,
        "PAGE_REVISION_CONFLICT",
        "Page revision is stale",
        {
          latest: this.repository.toDto(page),
          projectRevision,
        },
      );
    }
  }

  #pageConflict(pageId: string, projectRevision: number): ApiError {
    const latest = this.repository.get(pageId);
    return new ApiError(
      409,
      "PAGE_REVISION_CONFLICT",
      "Page revision is stale",
      {
        ...(latest === undefined
          ? {}
          : { latest: this.repository.toDto(latest) }),
        projectRevision,
      },
    );
  }

  #bumpProject(
    projectId: string,
    expectedRevision: number,
    now: string,
    published = false,
  ): number {
    const revision = this.repository.bumpProjectRevision(
      projectId,
      expectedRevision,
      now,
      published,
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

  #replay<T>(
    projectId: string,
    idempotencyKey: string,
    requestHash: string,
  ): T | undefined {
    const existing = this.repository.findOperation(projectId, idempotencyKey);
    if (existing === undefined) return undefined;
    assertApi(
      existing.request_hash === requestHash,
      409,
      "IDEMPOTENCY_PAYLOAD_CONFLICT",
      "Idempotency key has different input",
    );
    return JSON.parse(existing.response_json) as T;
  }

  #audit(
    action: string,
    projectId: string,
    objectId: string,
    before: unknown,
    after: unknown,
    now: string,
  ): void {
    this.repository.connection
      .prepare(
        `INSERT INTO audit_logs (
          id, project_id, action, object_type, object_id, before_json,
          after_json, correlation_id, created_at
        ) VALUES (?, ?, ?, 'page', ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        projectId,
        action,
        objectId,
        JSON.stringify(before),
        JSON.stringify(after),
        randomUUID(),
        now,
      );
  }
}
