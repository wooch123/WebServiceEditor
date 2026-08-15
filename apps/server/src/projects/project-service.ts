import { createHash, randomUUID } from "node:crypto";

import type {
  CreateProjectRequest,
  PatchProjectRequest,
  ProjectCounts,
  ProjectDto,
  ProjectExportDto,
  ProjectExportFile,
  ProjectTombstoneDto,
  PurgePlanDto,
  PurgePlanRequest,
  PurgeProjectRequest,
  RestoreProjectRequest,
  TrashProjectRequest,
} from "@webeditor/domain";

import { ApiError, assertApi } from "../errors.js";
import type { MetadataDatabase } from "../metadata/database.js";
import {
  type LifecycleOperationRow,
  ProjectRepository,
  type ProjectRow,
  type TrashManifestRow,
} from "./project-repository.js";
import {
  type LifecycleFailureInjector,
  ProjectStorage,
  type StorageScanResult,
  type StorageSnapshot,
} from "./project-storage.js";

const PROJECT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const THEME_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PURGE_PLAN_TTL_MILLISECONDS = 5 * 60 * 1000;

export interface ProjectServiceOptions {
  readonly metadataDatabase: MetadataDatabase;
  readonly storageRoot: string;
  readonly failureInjector?: LifecycleFailureInjector;
  readonly clock?: () => Date;
}

export interface LifecycleBatchResult<T> {
  readonly projectId: string;
  readonly ok: boolean;
  readonly value?: T;
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly statusCode: number;
  };
}

interface ImportableProjectExport {
  readonly project: {
    readonly name: string;
    readonly slug: string;
    readonly description: string | null;
    readonly themeId: string;
  };
  readonly files: readonly ProjectExportFile[];
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

function requestHash(
  operation: string,
  projectId: string,
  request: unknown,
): string {
  return createHash("sha256")
    .update(stableJson({ operation, projectId, request }))
    .digest("hex");
}

function slugify(name: string): string {
  const slug = name
    .normalize("NFKD")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return slug || `project-${randomUUID().slice(0, 8)}`;
}

function validateName(value: unknown): string {
  assertApi(
    typeof value === "string",
    400,
    "INVALID_NAME",
    "Project name is required",
  );
  const name = value.trim();
  assertApi(
    name.length > 0 && name.length <= 120,
    400,
    "INVALID_NAME",
    "Project name must contain 1 to 120 characters",
  );
  return name;
}

function validateSlug(value: unknown): string {
  assertApi(
    typeof value === "string",
    400,
    "INVALID_SLUG",
    "Project slug is required",
  );
  const slug = value.trim().toLocaleLowerCase();
  assertApi(
    slug.length <= 80 && SLUG_PATTERN.test(slug),
    400,
    "INVALID_SLUG",
    "Project slug must contain lowercase letters, numbers, and single hyphens",
  );
  return slug;
}

function validateDescription(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  assertApi(
    typeof value === "string" && value.length <= 2_000,
    400,
    "INVALID_DESCRIPTION",
    "Project description must not exceed 2000 characters",
  );
  return value;
}

function validateThemeId(value: unknown): string {
  assertApi(
    typeof value === "string" &&
      value.length <= 100 &&
      THEME_ID_PATTERN.test(value),
    400,
    "INVALID_THEME_ID",
    "Project theme ID is invalid",
  );
  return value;
}

function assertProjectId(projectId: string): void {
  assertApi(
    PROJECT_ID_PATTERN.test(projectId),
    400,
    "INVALID_PROJECT_ID",
    "Project ID must be a UUID",
  );
}

function canonicalPortablePath(path: string): string {
  return path.normalize("NFC").toLocaleLowerCase("en-US");
}

function assertSafeImportPath(path: string, index: number): void {
  const segments = path.split("/");
  assertApi(
    path.length > 0 &&
      path === path.replaceAll("\\", "/") &&
      !path.startsWith("/") &&
      !/^[A-Za-z]:/.test(path) &&
      !path.includes("\0") &&
      segments.every(
        (segment) =>
          segment.length > 0 &&
          segment !== "." &&
          segment !== ".." &&
          !/[<>:"|?*]/u.test(segment) &&
          ![...segment].some((character) => character.charCodeAt(0) <= 31) &&
          !segment.endsWith(".") &&
          !segment.endsWith(" "),
      ),
    400,
    "UNSAFE_STORAGE_PATH",
    "Project storage path is not safe",
    { index, path },
  );
  assertApi(
    path === "project-manifest.json" ||
      path === "test.sqlite" ||
      path === "production.sqlite" ||
      path.startsWith("assets/"),
    400,
    "IMPORT_FILE_NOT_ALLOWED",
    "Project export contains a file outside the allowed project layout",
    { index, path },
  );
}

export class ProjectService {
  readonly repository: ProjectRepository;
  readonly storage: ProjectStorage;
  readonly #clock: () => Date;

  constructor(options: ProjectServiceOptions) {
    this.repository = new ProjectRepository(options.metadataDatabase);
    this.storage = new ProjectStorage(
      options.storageRoot,
      options.failureInjector,
    );
    this.#clock = options.clock ?? (() => new Date());
    this.recoverStagedProjectCreations();
    this.recoverPendingOperations();
    this.finalizeCompletedPurgeCleanups();
    this.assertStorageIntegrity();
    this.reconcileStorageManifests();
    this.assertStorageIntegrity();
  }

  #now(): string {
    return this.#clock().toISOString();
  }

  listActive(): readonly ProjectDto[] {
    return this.repository.listActive().map((row) => this.#dto(row, "active"));
  }

  getActive(projectId: string): ProjectDto {
    assertProjectId(projectId);
    const row = this.#getRow(projectId);
    assertApi(
      row.lifecycle_status === "ACTIVE",
      404,
      "PROJECT_NOT_ACTIVE",
      "Project is not available in the active workspace",
    );
    return this.#dto(row, "active");
  }

  listRecycleBin(): readonly ProjectDto[] {
    return this.repository
      .listRecycleBin()
      .map((row) => this.#dto(row, "trash"));
  }

  getRecycleBinProject(projectId: string): ProjectDto {
    assertProjectId(projectId);
    const row = this.#getRow(projectId);
    assertApi(
      row.lifecycle_status === "TRASHED" ||
        row.lifecycle_status === "PURGE_FAILED",
      404,
      "PROJECT_NOT_IN_RECYCLE_BIN",
      "Project is not in the recycle bin",
    );
    return this.#dto(row, "trash");
  }

  create(request: CreateProjectRequest): ProjectDto {
    const id = randomUUID();
    const name = validateName(request.name);
    const slug = validateSlug(request.slug ?? slugify(name));
    const description = validateDescription(request.description);
    const favorite = request.favorite ?? false;
    assertApi(
      typeof favorite === "boolean",
      400,
      "INVALID_FAVORITE",
      "Favorite must be boolean",
    );
    const themeId = validateThemeId(request.themeId ?? "light-clean-paper");
    this.#assertNoConflicts(name, slug);
    const now = this.#now();

    this.storage.stageProject(id, { name, slug, themeId });
    let row: ProjectRow;
    try {
      row = this.repository.metadataDatabase.transaction(() => {
        const inserted = this.repository.insert({
          id,
          name,
          slug,
          description,
          favorite,
          themeId,
          now,
        });
        this.repository.writeAudit({
          projectId: id,
          action: "PROJECT_CREATED",
          before: null,
          after: this.repository.toDto(inserted),
          correlationId: randomUUID(),
          now,
        });
        return inserted;
      });
    } catch (error) {
      this.storage.discardStagedProject(id);
      throw error;
    }
    try {
      this.storage.commitStagedProject(id);
    } catch {
      this.recoverStagedProjectCreations();
    }
    return this.#dto(row, "active");
  }

  patch(projectId: string, request: PatchProjectRequest): ProjectDto {
    assertProjectId(projectId);
    assertApi(
      Number.isInteger(request.expectedRevision) &&
        request.expectedRevision >= 0,
      400,
      "INVALID_EXPECTED_REVISION",
      "expectedRevision must be a non-negative integer",
    );
    const current = this.#getRow(projectId);
    assertApi(
      current.lifecycle_status === "ACTIVE",
      409,
      "PROJECT_NOT_ACTIVE",
      "Only active projects can be updated",
    );
    if (current.revision !== request.expectedRevision) {
      throw new ApiError(
        409,
        "REVISION_CONFLICT",
        "Project revision is stale",
        {
          latest: this.#dto(current, "active"),
        },
      );
    }
    const name =
      request.name === undefined ? current.name : validateName(request.name);
    const slug =
      request.slug === undefined ? current.slug : validateSlug(request.slug);
    const description =
      request.description === undefined
        ? current.description
        : validateDescription(request.description);
    const favorite = request.favorite ?? current.favorite === 1;
    assertApi(
      typeof favorite === "boolean",
      400,
      "INVALID_FAVORITE",
      "Favorite must be boolean",
    );
    const themeId =
      request.themeId === undefined
        ? current.theme_id
        : validateThemeId(request.themeId);
    this.#assertNoConflicts(name, slug, projectId);
    const now = this.#now();

    this.storage.updateProjectManifest(projectId, { name, slug, themeId });
    try {
      const updated = this.repository.metadataDatabase.transaction(() => {
        const row = this.repository.patch(projectId, request.expectedRevision, {
          name,
          slug,
          description,
          favorite,
          themeId,
          now,
        });
        if (row === undefined) {
          const latest = this.#getRow(projectId);
          throw new ApiError(
            409,
            "REVISION_CONFLICT",
            "Project revision is stale",
            {
              latest: this.repository.toDto(latest),
            },
          );
        }
        this.repository.writeAudit({
          projectId,
          action: "PROJECT_UPDATED",
          before: this.repository.toDto(current),
          after: this.repository.toDto(row),
          correlationId: randomUUID(),
          now,
        });
        return row;
      });
      return this.#dto(updated, "active");
    } catch (error) {
      this.storage.updateProjectManifest(projectId, {
        name: current.name,
        slug: current.slug,
        themeId: current.theme_id,
      });
      throw error;
    }
  }

  clone(
    projectId: string,
    request: { readonly name?: string; readonly slug?: string } = {},
  ): ProjectDto {
    const source = this.getActive(projectId);
    const name = validateName(request.name ?? `${source.name} Copy`);
    const slug = validateSlug(
      request.slug ?? `${source.slug}-copy-${randomUUID().slice(0, 6)}`,
    );
    this.#assertNoConflicts(name, slug);
    const exportDto = this.export(projectId);
    return this.#importExport(
      exportDto,
      { name, slug },
      "PROJECT_CLONED",
      projectId,
    );
  }

  export(projectId: string): ProjectExportDto {
    const project = this.getActive(projectId);
    const files = this.storage.exportFiles(projectId);
    const manifestFile = files.find(
      (file) => file.path === "project-manifest.json",
    );
    assertApi(
      manifestFile !== undefined,
      409,
      "PROJECT_MANIFEST_MISSING",
      "Project manifest is missing",
    );
    const manifest = JSON.parse(
      Buffer.from(manifestFile.contentBase64, "base64").toString("utf8"),
    ) as Record<string, unknown>;
    return { format: "webeditor-project-v1", project, manifest, files };
  }

  import(
    untrustedExport: unknown,
    overrides: { readonly name?: string; readonly slug?: string } = {},
  ): ProjectDto {
    const exportDto = this.#parseProjectExport(untrustedExport);
    const name = validateName(overrides.name ?? exportDto.project.name);
    const slug = validateSlug(
      overrides.slug ??
        `${exportDto.project.slug}-import-${randomUUID().slice(0, 6)}`,
    );
    return this.#importExport(exportDto, { name, slug }, "PROJECT_IMPORTED");
  }

  #importExport(
    exportDto: ImportableProjectExport,
    project: { readonly name: string; readonly slug: string },
    auditAction: string,
    sourceProjectId?: string,
  ): ProjectDto {
    this.#assertNoConflicts(project.name, project.slug);
    const id = randomUUID();
    const themeId = validateThemeId(exportDto.project.themeId);
    this.storage.stageFromExport(id, { ...project, themeId }, exportDto.files);
    const now = this.#now();
    let row: ProjectRow;
    try {
      row = this.repository.metadataDatabase.transaction(() => {
        const inserted = this.repository.insert({
          id,
          name: project.name,
          slug: project.slug,
          description: exportDto.project.description,
          favorite: false,
          themeId,
          now,
        });
        this.repository.writeAudit({
          projectId: id,
          action: auditAction,
          before: sourceProjectId === undefined ? null : { sourceProjectId },
          after: this.repository.toDto(inserted),
          correlationId: randomUUID(),
          now,
        });
        return inserted;
      });
    } catch (error) {
      this.storage.discardStagedProject(id);
      throw error;
    }
    try {
      this.storage.commitStagedProject(id);
    } catch {
      this.recoverStagedProjectCreations();
    }
    return this.#dto(row, "active");
  }

  #parseProjectExport(value: unknown): ImportableProjectExport {
    assertApi(
      typeof value === "object" && value !== null && !Array.isArray(value),
      400,
      "INVALID_PROJECT_EXPORT",
      "Project export must be a JSON object",
    );
    const record = value as Record<string, unknown>;
    assertApi(
      record.format === "webeditor-project-v1",
      400,
      "UNSUPPORTED_EXPORT_FORMAT",
      "Project export format is not supported",
    );
    assertApi(
      typeof record.project === "object" && record.project !== null,
      400,
      "INVALID_PROJECT_EXPORT",
      "Project export metadata is required",
    );
    const project = record.project as Record<string, unknown>;
    const parsedProject = {
      name: validateName(project.name),
      slug: validateSlug(project.slug),
      description: validateDescription(project.description),
      themeId: validateThemeId(project.themeId),
    };
    assertApi(
      Array.isArray(record.files) &&
        record.files.length > 0 &&
        record.files.length <= 5_000,
      400,
      "INVALID_PROJECT_EXPORT_FILES",
      "Project export must contain 1 to 5000 files",
    );
    const seenPaths = new Set<string>();
    const portablePaths = new Map<string, string>();
    const files = record.files.map((value, index): ProjectExportFile => {
      assertApi(
        typeof value === "object" && value !== null && !Array.isArray(value),
        400,
        "INVALID_PROJECT_EXPORT_FILE",
        "Each project export file must be an object",
        { index },
      );
      const file = value as Record<string, unknown>;
      assertApi(
        typeof file.path === "string" &&
          typeof file.sha256 === "string" &&
          /^[0-9a-f]{64}$/i.test(file.sha256) &&
          typeof file.contentBase64 === "string" &&
          /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
            file.contentBase64,
          ),
        400,
        "INVALID_PROJECT_EXPORT_FILE",
        "Project export file fields are invalid",
        { index },
      );
      assertSafeImportPath(file.path, index);
      assertApi(
        !seenPaths.has(file.path),
        400,
        "DUPLICATE_PROJECT_EXPORT_PATH",
        "Project export contains a duplicate file path",
        { path: file.path },
      );
      seenPaths.add(file.path);
      const portablePath = canonicalPortablePath(file.path);
      const collidingPath = portablePaths.get(portablePath);
      assertApi(
        collidingPath === undefined,
        400,
        "PORTABLE_PROJECT_EXPORT_PATH_COLLISION",
        "Project export contains paths that collide on a portable filesystem",
        { path: file.path, collidingPath },
      );
      portablePaths.set(portablePath, file.path);
      return {
        path: file.path,
        sha256: file.sha256.toLocaleLowerCase(),
        contentBase64: file.contentBase64,
      };
    });
    for (const [portablePath, originalPath] of portablePaths) {
      let separator = portablePath.lastIndexOf("/");
      while (separator >= 0) {
        const parentPath = portablePath.slice(0, separator);
        const collidingPath = portablePaths.get(parentPath);
        assertApi(
          collidingPath === undefined,
          400,
          "PROJECT_EXPORT_FILE_DIRECTORY_CONFLICT",
          "Project export uses the same portable path as both a file and directory",
          { path: originalPath, collidingPath },
        );
        separator = parentPath.lastIndexOf("/");
      }
    }
    for (const requiredPath of [
      "project-manifest.json",
      "test.sqlite",
      "production.sqlite",
    ]) {
      assertApi(
        seenPaths.has(requiredPath),
        400,
        "PROJECT_EXPORT_FILE_MISSING",
        `Project export is missing ${requiredPath}`,
      );
    }
    const manifest = files.find(
      (file) => file.path === "project-manifest.json",
    );
    try {
      const parsedManifest = JSON.parse(
        Buffer.from(manifest?.contentBase64 ?? "", "base64").toString("utf8"),
      );
      assertApi(
        typeof parsedManifest === "object" && parsedManifest !== null,
        400,
        "INVALID_PROJECT_MANIFEST",
        "Imported project manifest must be a JSON object",
      );
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      throw new ApiError(
        400,
        "INVALID_PROJECT_MANIFEST",
        "Imported project manifest is invalid",
      );
    }
    return { project: parsedProject, files };
  }

  trash(projectId: string, request: TrashProjectRequest): ProjectDto {
    assertProjectId(projectId);
    this.#validateTrashRequest(request);
    const hash = requestHash("TRASH", projectId, request);
    const replay = this.#idempotencyReplay<ProjectDto>(
      projectId,
      request.idempotencyKey,
      hash,
    );
    if (replay !== undefined) {
      return replay;
    }

    const before = this.#getRow(projectId);
    assertApi(
      before.lifecycle_status === "ACTIVE",
      409,
      "INVALID_LIFECYCLE_STATE",
      "Only an active project can be moved to the recycle bin",
    );
    if (before.revision !== request.expectedRevision) {
      throw new ApiError(
        409,
        "REVISION_CONFLICT",
        "Project revision is stale",
        {
          latest: this.#dto(before, "active"),
        },
      );
    }
    if (
      request.expectedLifecycleRevision !== undefined &&
      before.lifecycle_revision !== request.expectedLifecycleRevision
    ) {
      throw this.#lifecycleConflict(before, "active");
    }

    const snapshot = this.storage.snapshot("active", projectId);
    const operationId = randomUUID();
    const auditId = randomUUID();
    const now = this.#now();
    const reason = request.reason?.trim() || "user-request";
    const manifest = this.#trashManifest(
      before,
      snapshot,
      operationId,
      auditId,
      now,
      reason,
    );
    this.repository.metadataDatabase.transaction(() => {
      this.repository.beginOperation({
        id: operationId,
        projectId,
        type: "TRASH",
        from: "ACTIVE",
        to: "TRASHED",
        idempotencyKey: request.idempotencyKey,
        requestHash: hash,
        storageFrom: `active/${projectId}`,
        storageTo: `trash/${projectId}`,
        now,
      });
      this.repository.createOutbox(
        operationId,
        projectId,
        "PROJECT_TRASH_REQUESTED",
        manifest,
        now,
      );
      this.repository.putTrashManifest({
        project_id: projectId,
        operation_id: operationId,
        original_slug: before.slug,
        original_storage_path: `active/${projectId}`,
        trash_storage_path: `trash/${projectId}`,
        project_checksum: snapshot.checksum,
        test_db_checksum: snapshot.testDatabaseChecksum,
        production_db_checksum: snapshot.productionDatabaseChecksum,
        asset_count: snapshot.assetCount,
        deleted_at: now,
        manifest_json: JSON.stringify(manifest),
      });
      const transitioned = this.repository.transition(
        projectId,
        ["ACTIVE"],
        "TRASHING",
        before.lifecycle_revision,
        now,
        { reason },
      );
      assertApi(
        transitioned !== undefined,
        409,
        "LIFECYCLE_REVISION_CONFLICT",
        "Project lifecycle changed before trash could begin",
      );
    });

    try {
      this.storage.moveActiveToTrash(projectId);
      this.storage.writeTrashManifest(projectId, manifest);
      this.storage.triggerFailure("audit:before-write");
      return this.#finalizeTrash(operationId, auditId);
    } catch (error) {
      const recovered = this.#attemptImmediateRecovery<ProjectDto>(operationId);
      if (recovered !== undefined) {
        return recovered;
      }
      throw error;
    }
  }

  restore(projectId: string, request: RestoreProjectRequest): ProjectDto {
    assertProjectId(projectId);
    this.#validateRestoreRequest(request);
    const hash = requestHash("RESTORE", projectId, request);
    const replay = this.#idempotencyReplay<ProjectDto>(
      projectId,
      request.idempotencyKey,
      hash,
    );
    if (replay !== undefined) {
      return replay;
    }
    const before = this.#getRow(projectId);
    assertApi(
      before.lifecycle_status === "TRASHED",
      409,
      "INVALID_LIFECYCLE_STATE",
      "Only a trashed project can be restored",
    );
    if (before.lifecycle_revision !== request.expectedLifecycleRevision) {
      throw this.#lifecycleConflict(before, "trash");
    }

    const desired = this.#resolveRestoreIdentity(before, request);
    const manifest = this.#getTrashManifest(projectId);
    const snapshot = this.storage.snapshot("trash", projectId);
    this.#assertSnapshotMatchesManifest(snapshot, manifest);
    const operationId = randomUUID();
    const now = this.#now();
    this.repository.metadataDatabase.transaction(() => {
      this.repository.beginOperation({
        id: operationId,
        projectId,
        type: "RESTORE",
        from: "TRASHED",
        to: "ACTIVE",
        idempotencyKey: request.idempotencyKey,
        requestHash: hash,
        storageFrom: `trash/${projectId}`,
        storageTo: `active/${projectId}`,
        now,
      });
      this.repository.createOutbox(
        operationId,
        projectId,
        "PROJECT_RESTORE_REQUESTED",
        { desired, checksum: snapshot.checksum },
        now,
      );
      if (desired.name !== before.name || desired.slug !== before.slug) {
        const identityUpdated = this.repository.updateIdentityDuringRestore(
          projectId,
          before.revision,
          { ...desired, now },
        );
        assertApi(
          identityUpdated !== undefined,
          409,
          "RESTORE_IDENTITY_CONFLICT",
          "Restore identity could not be reserved",
        );
      }
      const transitioned = this.repository.transition(
        projectId,
        ["TRASHED"],
        "RESTORING",
        before.lifecycle_revision,
        now,
      );
      assertApi(
        transitioned !== undefined,
        409,
        "LIFECYCLE_REVISION_CONFLICT",
        "Project lifecycle changed before restore could begin",
      );
    });

    try {
      this.storage.moveTrashToActive(projectId);
      this.storage.updateProjectManifest(projectId, {
        name: desired.name,
        slug: desired.slug,
        themeId: before.theme_id,
      });
      const restoredSnapshot = this.storage.snapshot("active", projectId);
      assertApi(
        restoredSnapshot.testDatabaseChecksum === manifest.test_db_checksum &&
          restoredSnapshot.productionDatabaseChecksum ===
            manifest.production_db_checksum,
        409,
        "RESTORE_DATABASE_CHECKSUM_MISMATCH",
        "Restored runtime database checksums do not match the trash manifest",
      );
      this.storage.triggerFailure("audit:before-write");
      return this.#finalizeRestore(operationId, before, manifest, desired);
    } catch (error) {
      const recovered = this.#attemptImmediateRecovery<ProjectDto>(operationId);
      if (recovered !== undefined) {
        return recovered;
      }
      throw error;
    }
  }

  createPurgePlan(projectId: string, request: PurgePlanRequest): PurgePlanDto {
    assertProjectId(projectId);
    assertApi(
      Number.isInteger(request.expectedLifecycleRevision) &&
        request.expectedLifecycleRevision >= 0,
      400,
      "INVALID_EXPECTED_LIFECYCLE_REVISION",
      "expectedLifecycleRevision must be a non-negative integer",
    );
    const project = this.#getRow(projectId);
    assertApi(
      project.lifecycle_status === "TRASHED" ||
        project.lifecycle_status === "PURGE_FAILED",
      409,
      "PURGE_REQUIRES_RECYCLE_BIN",
      "Permanent purge is available only from the recycle bin",
    );
    if (project.lifecycle_revision !== request.expectedLifecycleRevision) {
      throw this.#lifecycleConflict(project, "trash");
    }
    const manifest = this.#getTrashManifest(projectId);
    const snapshot = this.storage.snapshot("trash", projectId);
    this.#assertSnapshotMatchesManifest(snapshot, manifest);
    const createdAt = this.#clock();
    const plan: PurgePlanDto = {
      id: randomUUID(),
      projectId,
      projectName: project.name,
      lifecycleRevision: project.lifecycle_revision,
      projectChecksum: snapshot.checksum,
      expiresAt: new Date(
        createdAt.getTime() + PURGE_PLAN_TTL_MILLISECONDS,
      ).toISOString(),
      typedConfirmation: project.name,
      impact: {
        metadataRecordCount: this.repository.metadataRecordCount(projectId),
        fileCount: snapshot.fileCount + 1,
        assetCount: snapshot.assetCount,
        estimatedBytes: snapshot.totalBytes + statManifestBytes(manifest),
        hasBackup: this.storage.hasBackup(projectId),
        blockedReasons: [],
      },
    };
    this.repository.putPurgePlan(plan, createdAt.toISOString());
    return plan;
  }

  purge(projectId: string, request: PurgeProjectRequest): ProjectTombstoneDto {
    assertProjectId(projectId);
    this.#validatePurgeRequest(request);
    const hash = requestHash("PURGE", projectId, request);
    const replay = this.#idempotencyReplay<ProjectTombstoneDto>(
      projectId,
      request.idempotencyKey,
      hash,
    );
    if (replay !== undefined) {
      return replay;
    }
    const before = this.#getRow(projectId);
    assertApi(
      before.lifecycle_status === "TRASHED" ||
        before.lifecycle_status === "PURGE_FAILED",
      409,
      "PURGE_REQUIRES_RECYCLE_BIN",
      "Permanent purge is available only from the recycle bin",
    );
    if (before.lifecycle_revision !== request.expectedLifecycleRevision) {
      throw this.#lifecycleConflict(before, "trash");
    }
    const plan = this.repository.getPurgePlan(request.purgePlanId);
    assertApi(
      plan !== undefined,
      409,
      "PURGE_PLAN_INVALID",
      "Purge plan is missing or consumed",
    );
    assertApi(
      plan.projectId === projectId,
      409,
      "PURGE_PLAN_PROJECT_MISMATCH",
      "Purge plan belongs to another project",
    );
    assertApi(
      Date.parse(plan.expiresAt) > this.#clock().getTime(),
      409,
      "PURGE_PLAN_EXPIRED",
      "Purge plan has expired",
    );
    assertApi(
      plan.lifecycleRevision === before.lifecycle_revision,
      409,
      "PURGE_PLAN_REVISION_MISMATCH",
      "Project lifecycle changed after the purge plan was created",
    );
    assertApi(
      request.typedConfirmation === before.name &&
        request.typedConfirmation === plan.typedConfirmation,
      400,
      "PURGE_CONFIRMATION_MISMATCH",
      "Typed confirmation must exactly match the project name",
    );
    const snapshot = this.storage.snapshot("trash", projectId);
    assertApi(
      snapshot.checksum === plan.projectChecksum,
      409,
      "PURGE_PLAN_CHECKSUM_MISMATCH",
      "Project storage changed after the purge plan was created",
    );

    const operationId = randomUUID();
    const startedAt = this.#now();
    const purging = this.repository.metadataDatabase.transaction(() => {
      this.repository.beginOperation({
        id: operationId,
        projectId,
        type: "PURGE",
        from: before.lifecycle_status,
        to: "PURGED",
        idempotencyKey: request.idempotencyKey,
        requestHash: hash,
        storageFrom: `trash/${projectId}`,
        storageTo: null,
        now: startedAt,
      });
      this.repository.createOutbox(
        operationId,
        projectId,
        "PROJECT_PURGE_REQUESTED",
        { planId: plan.id, checksum: snapshot.checksum },
        startedAt,
      );
      const transitioned = this.repository.transition(
        projectId,
        [before.lifecycle_status],
        "PURGING",
        before.lifecycle_revision,
        startedAt,
      );
      assertApi(
        transitioned !== undefined,
        409,
        "LIFECYCLE_REVISION_CONFLICT",
        "Project lifecycle changed before purge could begin",
      );
      return transitioned;
    });

    let tombstone: ProjectTombstoneDto;
    try {
      this.storage.preparePurge(
        projectId,
        operationId,
        plan.id,
        request.backupBeforePurge,
      );
      this.storage.triggerFailure("audit:before-write");
      const completedAt = this.#now();
      tombstone = {
        projectId,
        projectName: before.name,
        projectChecksum: snapshot.checksum,
        purgedAt: completedAt,
        backupRetained: request.backupBeforePurge,
      };
      this.repository.metadataDatabase.transaction(() => {
        const purged = this.repository.transition(
          projectId,
          ["PURGING"],
          "PURGED",
          purging.lifecycle_revision,
          completedAt,
        );
        assertApi(
          purged !== undefined,
          409,
          "PURGE_FINALIZE_CONFLICT",
          "Purge could not be finalized",
        );
        this.repository.setPurgeTombstone(projectId, snapshot.checksum);
        this.repository.putTombstone(tombstone, operationId, plan.id);
        this.repository.removeTrashManifest(projectId);
        this.repository.consumePurgePlan(plan.id, completedAt);
        this.repository.writeAudit({
          projectId,
          action: "PROJECT_PURGED",
          before: this.repository.toDto(before),
          after: tombstone,
          correlationId: operationId,
          now: completedAt,
        });
        this.repository.completeOperation(
          operationId,
          200,
          tombstone,
          completedAt,
        );
      });
    } catch (error) {
      const failureAt = this.#now();
      if (this.storage.hasPreparedPurge(operationId)) {
        this.storage.compensatePreparedPurge(projectId, operationId);
      } else if (
        this.storage.exists("trash", projectId) &&
        this.storage.hasPurgeRecoveryArtifacts(operationId)
      ) {
        this.storage.discardUnverifiedPurgeRecovery(operationId);
      }
      this.repository.metadataDatabase.transaction(() => {
        const current = this.repository.getRequired(projectId);
        if (current.lifecycle_status === "PURGING") {
          this.repository.transition(
            projectId,
            ["PURGING"],
            "PURGE_FAILED",
            current.lifecycle_revision,
            failureAt,
          );
        }
        this.repository.failOperation(operationId, error, failureAt);
        this.repository.writeAudit({
          projectId,
          action: "PROJECT_PURGE_FAILED",
          before: this.repository.toDto(before),
          after: { recoverable: this.storage.exists("trash", projectId) },
          correlationId: operationId,
          now: failureAt,
        });
      });
      throw error;
    }
    try {
      this.storage.commitPreparedPurge(
        projectId,
        operationId,
        plan.id,
        request.backupBeforePurge,
      );
    } catch {
      // PURGED metadata is authoritative. The durable recovery copy remains
      // available and startup cleanup retries without resurrecting the project.
    }
    return tombstone;
  }

  batchRestore(
    items: readonly ({ readonly projectId: string } & RestoreProjectRequest)[],
  ): readonly LifecycleBatchResult<ProjectDto>[] {
    return items.map((item) =>
      this.#batch(item.projectId, () => this.restore(item.projectId, item)),
    );
  }

  batchPurge(
    items: readonly ({ readonly projectId: string } & PurgeProjectRequest)[],
  ): readonly LifecycleBatchResult<ProjectTombstoneDto>[] {
    return items.map((item) =>
      this.#batch(item.projectId, () => this.purge(item.projectId, item)),
    );
  }

  #batch<T>(projectId: string, operation: () => T): LifecycleBatchResult<T> {
    try {
      return { projectId, ok: true, value: operation() };
    } catch (error) {
      const apiError =
        error instanceof ApiError
          ? error
          : new ApiError(500, "INTERNAL_ERROR", "Lifecycle operation failed");
      return {
        projectId,
        ok: false,
        error: {
          code: apiError.code,
          message: apiError.message,
          statusCode: apiError.statusCode,
        },
      };
    }
  }

  recoverPendingOperations(): void {
    for (const operation of this.repository.pendingOperations()) {
      this.#recoverOperation(operation);
    }
  }

  recoverStagedProjectCreations(): void {
    this.storage.recoverStagedProjects(
      new Set(this.repository.listActive().map((project) => project.id)),
    );
  }

  #attemptImmediateRecovery<T>(operationId: string): T | undefined {
    let operation = this.#getOperationById(operationId);
    if (operation.status === "PENDING") {
      try {
        this.#recoverOperation(operation);
      } catch {
        // The durable journal remains PENDING; readiness reports 503 until the
        // next startup recovery succeeds.
      }
      operation = this.#getOperationById(operationId);
    }
    return operation.status === "COMPLETED" && operation.response_json !== null
      ? (JSON.parse(operation.response_json) as T)
      : undefined;
  }

  finalizeCompletedPurgeCleanups(): void {
    for (const cleanup of this.repository.completedPurgeCleanups()) {
      if (!this.storage.hasPurgeRecoveryArtifacts(cleanup.operationId)) {
        continue;
      }
      const detail = JSON.parse(cleanup.detailJson) as {
        readonly backupRetained?: unknown;
        readonly purgePlanId?: unknown;
      };
      assertApi(
        typeof detail.backupRetained === "boolean" &&
          typeof detail.purgePlanId === "string" &&
          PROJECT_ID_PATTERN.test(detail.purgePlanId),
        503,
        "PURGE_CLEANUP_METADATA_INVALID",
        "Completed purge cleanup metadata is invalid",
      );
      this.storage.commitPreparedPurge(
        cleanup.projectId,
        cleanup.operationId,
        detail.purgePlanId,
        detail.backupRetained,
      );
    }
  }

  reconcileStorageManifests(): void {
    for (const project of this.repository.listActive()) {
      this.storage.updateProjectManifest(project.id, {
        name: project.name,
        slug: project.slug,
        themeId: project.theme_id,
      });
    }
    for (const project of this.repository.listRecycleBin()) {
      const manifest = this.repository.getTrashManifest(project.id);
      assertApi(
        manifest !== undefined,
        503,
        "TRASH_MANIFEST_MISSING",
        "Recycle-bin project metadata is missing its trash manifest",
      );
      this.storage.writeTrashManifest(
        project.id,
        JSON.parse(manifest.manifest_json) as Record<string, unknown>,
      );
    }
  }

  #recoverOperation(operation: LifecycleOperationRow): void {
    const project = this.repository.getRequired(operation.project_id);
    const activeExists = this.storage.exists("active", project.id);
    const trashExists = this.storage.exists("trash", project.id);
    const now = this.#now();

    if (
      operation.operation_type === "TRASH" &&
      project.lifecycle_status === "TRASHING"
    ) {
      if (trashExists && !activeExists) {
        const manifest = this.#getTrashManifest(project.id);
        const snapshot = this.storage.snapshot("trash", project.id);
        this.#assertSnapshotMatchesManifest(snapshot, manifest);
        this.storage.writeTrashManifest(
          project.id,
          JSON.parse(manifest.manifest_json) as Record<string, unknown>,
        );
        const parsedManifest = JSON.parse(manifest.manifest_json) as {
          readonly auditEventId?: unknown;
        };
        const auditId =
          typeof parsedManifest.auditEventId === "string"
            ? parsedManifest.auditEventId
            : randomUUID();
        this.#finalizeTrash(operation.id, auditId);
        return;
      }
      if (activeExists && !trashExists) {
        this.repository.metadataDatabase.transaction(() => {
          const recovered = this.repository.transition(
            project.id,
            ["TRASHING"],
            "ACTIVE",
            project.lifecycle_revision,
            now,
          );
          assertApi(
            recovered !== undefined,
            503,
            "TRASH_COMPENSATION_CONFLICT",
            "Interrupted trash could not be compensated",
          );
          this.repository.removeTrashManifest(project.id);
          this.repository.failOperation(
            operation.id,
            new Error("Trash was compensated on startup"),
            now,
          );
          this.repository.writeAudit({
            projectId: project.id,
            action: "PROJECT_TRASH_COMPENSATED",
            before: this.repository.toDto(project),
            after: this.repository.toDto(recovered),
            correlationId: operation.id,
            now,
          });
        });
        return;
      }
      if (activeExists && trashExists) {
        const manifest = this.#getTrashManifest(project.id);
        let destinationIsValid = false;
        try {
          const destination = this.storage.snapshot("trash", project.id);
          this.#assertSnapshotMatchesManifest(destination, manifest);
          destinationIsValid = true;
        } catch {
          // A partial cross-volume destination must never replace its source.
        }
        if (destinationIsValid) {
          this.storage.discardCompensatedCopy("active", project.id);
          this.storage.writeTrashManifest(
            project.id,
            JSON.parse(manifest.manifest_json) as Record<string, unknown>,
          );
          const parsedManifest = JSON.parse(manifest.manifest_json) as {
            readonly auditEventId?: unknown;
          };
          const auditId =
            typeof parsedManifest.auditEventId === "string"
              ? parsedManifest.auditEventId
              : randomUUID();
          this.#finalizeTrash(operation.id, auditId);
          return;
        }
        const source = this.storage.snapshot("active", project.id);
        this.#assertSnapshotMatchesManifest(source, manifest);
        this.storage.discardCompensatedCopy("trash", project.id);
        this.repository.metadataDatabase.transaction(() => {
          const recovered = this.repository.transition(
            project.id,
            ["TRASHING"],
            "ACTIVE",
            project.lifecycle_revision,
            now,
          );
          assertApi(
            recovered !== undefined,
            503,
            "TRASH_COMPENSATION_CONFLICT",
            "Duplicate trash copy could not be compensated",
          );
          this.repository.removeTrashManifest(project.id);
          this.repository.failOperation(
            operation.id,
            new Error("Duplicate trash copy compensated"),
            now,
          );
          this.repository.writeAudit({
            projectId: project.id,
            action: "PROJECT_TRASH_COMPENSATED",
            before: this.repository.toDto(project),
            after: this.repository.toDto(recovered),
            correlationId: operation.id,
            now,
          });
        });
        return;
      }
    }

    if (
      operation.operation_type === "RESTORE" &&
      project.lifecycle_status === "RESTORING"
    ) {
      if (activeExists && !trashExists) {
        const manifest = this.#getTrashManifest(project.id);
        const desired = this.#restoreDesiredForOperation(operation.id, project);
        this.storage.removeActiveTrashManifestFile(project.id);
        this.storage.updateProjectManifest(project.id, {
          ...desired,
          themeId: project.theme_id,
        });
        const snapshot = this.storage.snapshot("active", project.id);
        this.#assertRestoredSnapshotMatchesManifest(snapshot, manifest);
        this.#finalizeRestore(operation.id, project, manifest, desired);
        return;
      }
      if (trashExists && !activeExists) {
        const manifest = this.#getTrashManifest(project.id);
        const originalIdentity = this.#originalIdentityFromManifest(manifest);
        this.repository.metadataDatabase.transaction(() => {
          const compensated = this.repository.restoreIdentityAfterFailedRestore(
            project.id,
            { ...originalIdentity, now },
          );
          const recovered = this.repository.transition(
            project.id,
            ["RESTORING"],
            "TRASHED",
            compensated.lifecycle_revision,
            now,
          );
          assertApi(
            recovered !== undefined,
            503,
            "RESTORE_COMPENSATION_CONFLICT",
            "Interrupted restore could not be compensated",
          );
          this.repository.failOperation(
            operation.id,
            new Error("Restore was compensated on startup"),
            now,
          );
          this.repository.writeAudit({
            projectId: project.id,
            action: "PROJECT_RESTORE_COMPENSATED",
            before: this.repository.toDto(project),
            after: this.repository.toDto(recovered),
            correlationId: operation.id,
            now,
          });
        });
        return;
      }
      if (activeExists && trashExists) {
        const manifest = this.#getTrashManifest(project.id);
        const desired = this.#restoreDesiredForOperation(operation.id, project);
        let destinationIsValid = false;
        try {
          this.storage.removeActiveTrashManifestFile(project.id);
          this.storage.updateProjectManifest(project.id, {
            ...desired,
            themeId: project.theme_id,
          });
          const destination = this.storage.snapshot("active", project.id);
          this.#assertRestoredSnapshotMatchesManifest(destination, manifest);
          destinationIsValid = true;
        } catch {
          // A partial cross-volume destination must never replace its source.
        }
        if (destinationIsValid) {
          this.storage.discardCompensatedCopy("trash", project.id);
          this.#finalizeRestore(operation.id, project, manifest, desired);
          return;
        }
        const source = this.storage.snapshot("trash", project.id);
        this.#assertSnapshotMatchesManifest(source, manifest);
        this.storage.discardCompensatedCopy("active", project.id);
        this.storage.writeTrashManifest(
          project.id,
          JSON.parse(manifest.manifest_json) as Record<string, unknown>,
        );
        const originalIdentity = this.#originalIdentityFromManifest(manifest);
        this.repository.metadataDatabase.transaction(() => {
          const compensated = this.repository.restoreIdentityAfterFailedRestore(
            project.id,
            { ...originalIdentity, now },
          );
          const recovered = this.repository.transition(
            project.id,
            ["RESTORING"],
            "TRASHED",
            compensated.lifecycle_revision,
            now,
          );
          assertApi(
            recovered !== undefined,
            503,
            "RESTORE_COMPENSATION_CONFLICT",
            "Duplicate active copy could not be compensated",
          );
          this.repository.failOperation(
            operation.id,
            new Error("Duplicate active copy compensated"),
            now,
          );
          this.repository.writeAudit({
            projectId: project.id,
            action: "PROJECT_RESTORE_COMPENSATED",
            before: this.repository.toDto(project),
            after: this.repository.toDto(recovered),
            correlationId: operation.id,
            now,
          });
        });
        return;
      }
    }

    if (
      operation.operation_type === "PURGE" &&
      project.lifecycle_status === "PURGING"
    ) {
      if (!trashExists && this.storage.hasPreparedPurge(operation.id)) {
        this.storage.compensatePreparedPurge(project.id, operation.id);
        this.repository.metadataDatabase.transaction(() => {
          const recovered = this.repository.transition(
            project.id,
            ["PURGING"],
            "PURGE_FAILED",
            project.lifecycle_revision,
            now,
          );
          assertApi(
            recovered !== undefined,
            503,
            "PURGE_COMPENSATION_CONFLICT",
            "Interrupted purge could not be marked recoverable",
          );
          this.repository.failOperation(
            operation.id,
            new Error("Interrupted purge was compensated on startup"),
            now,
          );
          this.repository.writeAudit({
            projectId: project.id,
            action: "PROJECT_PURGE_COMPENSATED",
            before: this.repository.toDto(project),
            after: this.repository.toDto(recovered),
            correlationId: operation.id,
            now,
          });
        });
        return;
      }
      if (trashExists) {
        if (this.storage.hasPreparedPurge(operation.id)) {
          this.storage.compensatePreparedPurge(project.id, operation.id);
        } else if (this.storage.hasPurgeRecoveryArtifacts(operation.id)) {
          this.storage.discardUnverifiedPurgeRecovery(operation.id);
        }
        this.repository.metadataDatabase.transaction(() => {
          const recovered = this.repository.transition(
            project.id,
            ["PURGING"],
            "PURGE_FAILED",
            project.lifecycle_revision,
            now,
          );
          assertApi(
            recovered !== undefined,
            503,
            "PURGE_COMPENSATION_CONFLICT",
            "Interrupted purge could not be marked recoverable",
          );
          this.repository.failOperation(
            operation.id,
            new Error("Interrupted purge recovered for retry"),
            now,
          );
          this.repository.writeAudit({
            projectId: project.id,
            action: "PROJECT_PURGE_COMPENSATED",
            before: this.repository.toDto(project),
            after: this.repository.toDto(recovered),
            correlationId: operation.id,
            now,
          });
        });
        return;
      }
    }

    throw new ApiError(
      503,
      "LIFECYCLE_RECOVERY_FAILED",
      "A pending lifecycle operation could not be recovered consistently",
      { operationId: operation.id, projectId: project.id },
    );
  }

  scanStorage(): StorageScanResult {
    return this.storage.scan(this.repository.listKnownProjectIds());
  }

  assertStorageIntegrity(): StorageScanResult {
    this.storage.assertWritable();
    const scan = this.scanStorage();
    assertApi(
      scan.dualLocationProjectIds.length === 0 &&
        scan.orphanActiveProjectIds.length === 0 &&
        scan.orphanTrashProjectIds.length === 0,
      503,
      "STORAGE_INTEGRITY_FAILED",
      "Project storage contains dual-location or orphan directories",
      scan,
    );
    for (const project of this.repository.listActive()) {
      this.storage.snapshot("active", project.id);
    }
    for (const project of this.repository.listRecycleBin()) {
      this.storage.snapshot("trash", project.id);
    }
    return scan;
  }

  assertReady(): StorageScanResult {
    this.recoverStagedProjectCreations();
    const pendingOperations = this.repository.pendingOperations();
    assertApi(
      pendingOperations.length === 0,
      503,
      "LIFECYCLE_RECOVERY_REQUIRED",
      "Pending project lifecycle operations require recovery",
      { operationIds: pendingOperations.map((operation) => operation.id) },
    );
    this.finalizeCompletedPurgeCleanups();
    return this.assertStorageIntegrity();
  }

  #finalizeTrash(operationId: string, auditId: string): ProjectDto {
    const operation = this.#getOperationById(operationId);
    const before = this.repository.getRequired(operation.project_id);
    const now = this.#now();
    return this.repository.metadataDatabase.transaction(() => {
      const trashed = this.repository.transition(
        before.id,
        ["TRASHING"],
        "TRASHED",
        before.lifecycle_revision,
        now,
      );
      assertApi(
        trashed !== undefined,
        409,
        "TRASH_FINALIZE_CONFLICT",
        "Trash could not be finalized",
      );
      const dto = this.#dto(trashed, "trash");
      this.repository.writeAudit({
        id: auditId,
        projectId: before.id,
        action: "PROJECT_TRASHED",
        before: this.repository.toDto(before),
        after: dto,
        correlationId: operationId,
        now,
      });
      this.repository.completeOperation(operationId, 200, dto, now);
      return dto;
    });
  }

  #finalizeRestore(
    operationId: string,
    before: ProjectRow,
    manifest: TrashManifestRow,
    desired: { readonly name: string; readonly slug: string },
  ): ProjectDto {
    let current = this.repository.getRequired(before.id);
    const now = this.#now();
    return this.repository.metadataDatabase.transaction(() => {
      if (current.name !== desired.name || current.slug !== desired.slug) {
        const identityUpdated = this.repository.updateIdentityDuringRestore(
          current.id,
          current.revision,
          { ...desired, now },
        );
        assertApi(
          identityUpdated !== undefined,
          409,
          "RESTORE_IDENTITY_CONFLICT",
          "Restore identity could not be applied",
        );
        current = identityUpdated;
      }
      const active = this.repository.transition(
        current.id,
        ["RESTORING"],
        "ACTIVE",
        current.lifecycle_revision,
        now,
      );
      assertApi(
        active !== undefined,
        409,
        "RESTORE_FINALIZE_CONFLICT",
        "Restore could not be finalized",
      );
      const dto = this.#dto(active, "active");
      this.repository.removeTrashManifest(active.id);
      this.repository.writeAudit({
        projectId: active.id,
        action: "PROJECT_RESTORED",
        before: this.repository.toDto(before, {
          pages: 0,
          elements: 0,
          bindings: 0,
          tables: 0,
          assets: manifest.asset_count,
        }),
        after: dto,
        correlationId: operationId,
        now,
      });
      this.repository.completeOperation(operationId, 200, dto, now);
      return dto;
    });
  }

  #restoreDesiredForOperation(
    operationId: string,
    project: ProjectRow,
  ): { readonly name: string; readonly slug: string } {
    const payload = this.repository.getOutboxPayload(operationId) as
      { readonly desired?: unknown } | undefined;
    const desired = payload?.desired;
    if (typeof desired !== "object" || desired === null) {
      return { name: project.name, slug: project.slug };
    }
    const record = desired as Record<string, unknown>;
    return {
      name: validateName(record.name),
      slug: validateSlug(record.slug),
    };
  }

  #originalIdentityFromManifest(manifest: TrashManifestRow): {
    readonly name: string;
    readonly slug: string;
    readonly revision: number;
  } {
    const detail = JSON.parse(manifest.manifest_json) as Record<
      string,
      unknown
    >;
    assertApi(
      Number.isInteger(detail.projectRevision) &&
        typeof detail.displayName === "string" &&
        typeof detail.originalSlug === "string",
      503,
      "TRASH_MANIFEST_IDENTITY_INVALID",
      "Trash manifest identity metadata is invalid",
    );
    return {
      name: validateName(detail.displayName),
      slug: validateSlug(detail.originalSlug),
      revision: detail.projectRevision as number,
    };
  }

  #getOperationById(operationId: string): LifecycleOperationRow {
    const operation = this.repository.connection
      .prepare(
        `SELECT id, project_id, operation_type, from_status, to_status,
          idempotency_key, request_hash, storage_from, storage_to, status,
          response_status, response_json, error_json, started_at, completed_at
         FROM project_lifecycle_operations WHERE id = ?`,
      )
      .get(operationId) as LifecycleOperationRow | undefined;
    if (operation === undefined) {
      throw new Error(`Lifecycle operation ${operationId} is missing`);
    }
    return operation;
  }

  #idempotencyReplay<T>(
    projectId: string,
    idempotencyKey: string,
    hash: string,
  ): T | undefined {
    const existing = this.repository.findOperation(projectId, idempotencyKey);
    if (existing === undefined) {
      return undefined;
    }
    assertApi(
      existing.request_hash === hash,
      409,
      "IDEMPOTENCY_PAYLOAD_CONFLICT",
      "Idempotency key was already used with a different payload",
    );
    if (
      existing.status === "FAILED" &&
      existing.response_status !== null &&
      existing.response_json !== null
    ) {
      const stored = JSON.parse(existing.response_json) as {
        readonly error?: {
          readonly code?: unknown;
          readonly message?: unknown;
          readonly details?: unknown;
        };
      };
      assertApi(
        typeof stored.error?.code === "string" &&
          typeof stored.error.message === "string",
        409,
        "IDEMPOTENCY_RESPONSE_INVALID",
        "The stored idempotency response is invalid",
        { operationId: existing.id },
      );
      throw new ApiError(
        existing.response_status,
        stored.error.code,
        stored.error.message,
        stored.error.details,
      );
    }
    assertApi(
      existing.status === "COMPLETED" && existing.response_json !== null,
      409,
      "IDEMPOTENCY_OPERATION_INCOMPLETE",
      "The prior lifecycle operation did not complete and requires recovery",
      { operationId: existing.id, status: existing.status },
    );
    return JSON.parse(existing.response_json) as T;
  }

  #getRow(projectId: string): ProjectRow {
    const row = this.repository.get(projectId);
    assertApi(
      row !== undefined,
      404,
      "PROJECT_NOT_FOUND",
      "Project was not found",
    );
    return row;
  }

  #dto(row: ProjectRow, namespace: "active" | "trash"): ProjectDto {
    const counts: ProjectCounts = {
      pages: 0,
      elements: 0,
      bindings: 0,
      tables: 0,
      assets:
        namespace === "active"
          ? this.storage.snapshot("active", row.id).assetCount
          : (this.repository.getTrashManifest(row.id)?.asset_count ?? 0),
    };
    return this.repository.toDto(row, counts);
  }

  #assertNoConflicts(
    name: string,
    slug: string,
    excludingProjectId?: string,
  ): void {
    const conflicts = this.repository.hasActiveNameOrSlug(
      name,
      slug,
      excludingProjectId,
    );
    assertApi(
      !conflicts.nameConflict && !conflicts.slugConflict,
      409,
      "PROJECT_IDENTITY_CONFLICT",
      "An active project already uses this name or slug",
      conflicts,
    );
  }

  #lifecycleConflict(row: ProjectRow, namespace: "active" | "trash"): ApiError {
    return new ApiError(
      409,
      "LIFECYCLE_REVISION_CONFLICT",
      "Project lifecycle revision is stale",
      { latest: this.#dto(row, namespace) },
    );
  }

  #validateTrashRequest(request: TrashProjectRequest): void {
    assertApi(
      Number.isInteger(request.expectedRevision) &&
        request.expectedRevision >= 0,
      400,
      "INVALID_EXPECTED_REVISION",
      "expectedRevision must be a non-negative integer",
    );
    if (request.expectedLifecycleRevision !== undefined) {
      assertApi(
        Number.isInteger(request.expectedLifecycleRevision) &&
          request.expectedLifecycleRevision >= 0,
        400,
        "INVALID_EXPECTED_LIFECYCLE_REVISION",
        "expectedLifecycleRevision must be a non-negative integer",
      );
    }
    this.#validateIdempotencyKey(request.idempotencyKey);
    assertApi(
      request.reason === undefined ||
        (typeof request.reason === "string" && request.reason.length <= 500),
      400,
      "INVALID_TRASH_REASON",
      "Trash reason must not exceed 500 characters",
    );
  }

  #validateRestoreRequest(request: RestoreProjectRequest): void {
    assertApi(
      Number.isInteger(request.expectedLifecycleRevision) &&
        request.expectedLifecycleRevision >= 0,
      400,
      "INVALID_EXPECTED_LIFECYCLE_REVISION",
      "expectedLifecycleRevision must be a non-negative integer",
    );
    this.#validateIdempotencyKey(request.idempotencyKey);
    assertApi(
      request.conflictResolution === "KEEP_ORIGINAL" ||
        request.conflictResolution === "RENAME" ||
        request.conflictResolution === "NEW_SLUG",
      400,
      "INVALID_CONFLICT_RESOLUTION",
      "Restore conflict resolution is invalid",
    );
  }

  #validatePurgeRequest(request: PurgeProjectRequest): void {
    assertApi(
      PROJECT_ID_PATTERN.test(request.purgePlanId),
      400,
      "INVALID_PURGE_PLAN_ID",
      "Purge plan ID must be a UUID",
    );
    assertApi(
      Number.isInteger(request.expectedLifecycleRevision) &&
        request.expectedLifecycleRevision >= 0,
      400,
      "INVALID_EXPECTED_LIFECYCLE_REVISION",
      "expectedLifecycleRevision must be a non-negative integer",
    );
    assertApi(
      typeof request.typedConfirmation === "string",
      400,
      "INVALID_PURGE_CONFIRMATION",
      "Typed purge confirmation is required",
    );
    assertApi(
      typeof request.backupBeforePurge === "boolean",
      400,
      "INVALID_BACKUP_OPTION",
      "backupBeforePurge must be boolean",
    );
    this.#validateIdempotencyKey(request.idempotencyKey);
  }

  #validateIdempotencyKey(value: unknown): asserts value is string {
    assertApi(
      typeof value === "string" && value.length >= 8 && value.length <= 200,
      400,
      "INVALID_IDEMPOTENCY_KEY",
      "idempotencyKey must contain 8 to 200 characters",
    );
  }

  #resolveRestoreIdentity(
    project: ProjectRow,
    request: RestoreProjectRequest,
  ): { readonly name: string; readonly slug: string } {
    let name = project.name;
    let slug = project.slug;
    if (request.conflictResolution === "RENAME") {
      assertApi(
        request.name !== undefined,
        400,
        "RESTORE_NAME_REQUIRED",
        "Rename requires name",
      );
      name = validateName(request.name);
      if (request.slug !== undefined) {
        slug = validateSlug(request.slug);
      }
    } else if (request.conflictResolution === "NEW_SLUG") {
      assertApi(
        request.slug !== undefined,
        400,
        "RESTORE_SLUG_REQUIRED",
        "New slug requires slug",
      );
      slug = validateSlug(request.slug);
      if (request.name !== undefined) {
        name = validateName(request.name);
      }
    } else {
      assertApi(
        request.name === undefined && request.slug === undefined,
        400,
        "KEEP_ORIGINAL_HAS_OVERRIDES",
        "KEEP_ORIGINAL does not accept name or slug overrides",
      );
    }
    this.#assertNoConflicts(name, slug, project.id);
    return { name, slug };
  }

  #getTrashManifest(projectId: string): TrashManifestRow {
    const manifest = this.repository.getTrashManifest(projectId);
    assertApi(
      manifest !== undefined,
      409,
      "TRASH_MANIFEST_MISSING",
      "Trash manifest is missing",
    );
    return manifest;
  }

  #assertSnapshotMatchesManifest(
    snapshot: StorageSnapshot,
    manifest: TrashManifestRow,
  ): void {
    assertApi(
      snapshot.checksum === manifest.project_checksum &&
        snapshot.testDatabaseChecksum === manifest.test_db_checksum &&
        snapshot.productionDatabaseChecksum === manifest.production_db_checksum,
      409,
      "TRASH_MANIFEST_CHECKSUM_MISMATCH",
      "Project storage no longer matches its trash manifest",
    );
  }

  #assertRestoredSnapshotMatchesManifest(
    snapshot: StorageSnapshot,
    manifest: TrashManifestRow,
  ): void {
    const manifestDetail = JSON.parse(manifest.manifest_json) as {
      readonly files?: readonly {
        readonly path?: unknown;
        readonly sha256?: unknown;
      }[];
    };
    const expectedAssets = (manifestDetail.files ?? [])
      .filter(
        (file) =>
          typeof file.path === "string" &&
          file.path.startsWith("assets/") &&
          typeof file.sha256 === "string",
      )
      .map((file) => [file.path as string, file.sha256 as string] as const)
      .sort(([left], [right]) => left.localeCompare(right));
    const actualAssets = snapshot.files
      .filter((file) => file.path.startsWith("assets/"))
      .map((file) => [file.path, file.sha256] as const)
      .sort(([left], [right]) => left.localeCompare(right));
    assertApi(
      snapshot.testDatabaseChecksum === manifest.test_db_checksum &&
        snapshot.productionDatabaseChecksum ===
          manifest.production_db_checksum &&
        stableJson(actualAssets) === stableJson(expectedAssets),
      409,
      "RESTORE_CHECKSUM_MISMATCH",
      "Restored runtime data or assets do not match the trash manifest",
    );
  }

  #trashManifest(
    project: ProjectRow,
    snapshot: StorageSnapshot,
    operationId: string,
    auditEventId: string,
    deletedAt: string,
    reason: string,
  ): Record<string, unknown> {
    return {
      manifestVersion: 1,
      operationId,
      projectId: project.id,
      displayName: project.name,
      originalSlug: project.slug,
      originalActivePath: `active/${project.id}`,
      trashPath: `trash/${project.id}`,
      deletedAt,
      deletedBy: "local-admin",
      deletedReason: reason,
      projectRevision: project.revision,
      lifecycleRevision: project.lifecycle_revision,
      publishedRevision: null,
      themeRevision: project.theme_id,
      pageCount: 0,
      elementCount: 0,
      bindingCount: 0,
      tableCount: 0,
      runtimeRowCount: 0,
      assetCount: snapshot.assetCount,
      files: snapshot.files,
      databaseFiles: snapshot.files.filter((file) =>
        file.path.endsWith(".sqlite"),
      ),
      checksums: {
        project: snapshot.checksum,
        testDatabase: snapshot.testDatabaseChecksum,
        productionDatabase: snapshot.productionDatabaseChecksum,
      },
      auditEventId,
    };
  }
}

function statManifestBytes(manifest: TrashManifestRow): number {
  return Buffer.byteLength(manifest.manifest_json, "utf8");
}
