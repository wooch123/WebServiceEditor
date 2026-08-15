import { createHash, randomUUID } from "node:crypto";
import {
  cpSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

import Database from "better-sqlite3";

import { ApiError, assertApi } from "../errors.js";

const PROJECT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INTERRUPTED_MOVE_STAGING_PATTERN =
  /^\.incoming-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ATOMIC_WRITE_STAGING_PATTERN =
  /^\.webeditor-atomic-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tmp$/i;
const CREATION_VERIFICATION_MARKER_PATTERN =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.verified$/i;
export const PROJECT_IMPORT_DECODED_LIMIT_BYTES = 64 * 1024 * 1024;

export type LifecycleFailurePoint =
  | "create:before-promote"
  | "trash:before-move"
  | "trash:after-move"
  | "restore:before-move"
  | "restore:after-move"
  | "storage:before-rename"
  | "storage:during-cross-volume-copy"
  | "storage:after-cross-volume-promote"
  | "storage:before-atomic-file-rename"
  | "purge:before-recovery-verification"
  | "purge:after-runtime-databases"
  | "purge:before-finalize"
  | "purge:commit-recovery"
  | "audit:before-write";

export type LifecycleFailureInjector = (point: LifecycleFailurePoint) => void;

export interface StorageFileEntry {
  readonly path: string;
  readonly sha256: string;
  readonly size: number;
}

export interface StorageSnapshot {
  readonly checksum: string;
  readonly files: readonly StorageFileEntry[];
  readonly fileCount: number;
  readonly assetCount: number;
  readonly totalBytes: number;
  readonly testDatabaseChecksum: string;
  readonly productionDatabaseChecksum: string;
}

export interface StorageScanResult {
  readonly activeProjectIds: readonly string[];
  readonly trashProjectIds: readonly string[];
  readonly dualLocationProjectIds: readonly string[];
  readonly orphanActiveProjectIds: readonly string[];
  readonly orphanTrashProjectIds: readonly string[];
}

export interface ExportedStorageFile {
  readonly path: string;
  readonly sha256: string;
  readonly contentBase64: string;
}

function sha256(content: Buffer | string): string {
  return createHash("sha256").update(content).digest("hex");
}

function validateProjectId(projectId: string): void {
  assertApi(
    PROJECT_ID_PATTERN.test(projectId),
    400,
    "INVALID_PROJECT_ID",
    "Project ID must be a UUID",
  );
}

function assertSafeRelativePath(path: string): void {
  const normalized = path.replaceAll("\\", "/");
  assertApi(
    path === normalized &&
      !isAbsolute(path) &&
      !normalized.startsWith("/") &&
      normalized.length > 0 &&
      !normalized.includes("\0") &&
      normalized
        .split("/")
        .every(
          (segment) => segment !== "." && segment !== ".." && segment !== "",
        ),
    400,
    "UNSAFE_STORAGE_PATH",
    "Project storage path is not safe",
  );
}

function assertWithin(root: string, candidate: string): void {
  const fromRoot = relative(root, candidate);
  assertApi(
    fromRoot !== ".." &&
      !fromRoot.startsWith(`..${sep}`) &&
      !isAbsolute(fromRoot),
    400,
    "STORAGE_PATH_ESCAPE",
    "Project storage path escaped its configured root",
  );
}

function createRuntimeDatabase(
  databasePath: string,
  projectId: string,
  environment: "test" | "production",
): void {
  const database = new Database(databasePath);
  try {
    database.pragma("journal_mode = DELETE");
    database.pragma("synchronous = FULL");
    database.exec(`
      CREATE TABLE webeditor_runtime_metadata (
        project_id TEXT NOT NULL,
        environment TEXT NOT NULL CHECK (environment IN ('test', 'production')),
        sentinel TEXT NOT NULL
      );
    `);
    database
      .prepare(
        `INSERT INTO webeditor_runtime_metadata
          (project_id, environment, sentinel) VALUES (?, ?, ?)`,
      )
      .run(projectId, environment, `${projectId}:${environment}:v1`);
    if (database.pragma("quick_check", { simple: true }) !== "ok") {
      throw new Error(`Failed to initialize ${environment} runtime database`);
    }
  } finally {
    database.close();
  }
}

export class ProjectStorage {
  readonly root: string;
  readonly activeRoot: string;
  readonly trashRoot: string;
  readonly backupsRoot: string;
  readonly recoveryRoot: string;
  readonly stagingRoot: string;
  readonly creationRoot: string;
  readonly #realRoot: string;

  constructor(
    configuredRoot: string,
    readonly failureInjector?: LifecycleFailureInjector,
  ) {
    this.root = resolve(configuredRoot);
    if (existsSync(this.root)) {
      const rootStats = lstatSync(this.root);
      assertApi(
        rootStats.isDirectory() && !rootStats.isSymbolicLink(),
        409,
        "UNSAFE_STORAGE_ROOT",
        "Configured project storage root must be a real directory",
      );
    }
    mkdirSync(this.root, { recursive: true });
    this.#realRoot = realpathSync(this.root);
    this.activeRoot = join(this.root, "active");
    this.trashRoot = join(this.root, "trash");
    this.backupsRoot = join(this.root, "backups");
    this.recoveryRoot = join(this.root, ".lifecycle-recovery");
    this.stagingRoot = join(this.root, ".purge-staging");
    this.creationRoot = join(this.root, ".project-creation-staging");
    for (const directory of [
      this.activeRoot,
      this.trashRoot,
      this.backupsRoot,
      this.recoveryRoot,
      this.stagingRoot,
      this.creationRoot,
    ]) {
      if (existsSync(directory)) {
        const stats = lstatSync(directory);
        assertApi(
          stats.isDirectory() && !stats.isSymbolicLink(),
          409,
          "UNSAFE_STORAGE_NAMESPACE",
          "Project storage namespaces must be real directories",
        );
      }
      mkdirSync(directory, { recursive: true });
      assertWithin(this.root, directory);
      this.#assertTrustedDirectory(directory, this.#realRoot);
    }
    this.#cleanupInterruptedAtomicWrites();
    this.#cleanupInterruptedMoveStaging();
  }

  triggerFailure(point: LifecycleFailurePoint): void {
    this.failureInjector?.(point);
  }

  activePath(projectId: string): string {
    return this.#projectPath(this.activeRoot, projectId);
  }

  trashPath(projectId: string): string {
    return this.#projectPath(this.trashRoot, projectId);
  }

  creationPath(projectId: string): string {
    return this.#projectPath(this.creationRoot, projectId);
  }

  #projectPath(namespaceRoot: string, projectId: string): string {
    this.#assertTrustedDirectory(namespaceRoot, this.#realRoot);
    validateProjectId(projectId);
    const path = join(namespaceRoot, projectId);
    assertWithin(namespaceRoot, path);
    return path;
  }

  stageProject(
    projectId: string,
    project: {
      readonly name: string;
      readonly slug: string;
      readonly themeId: string;
    },
  ): void {
    const activePath = this.activePath(projectId);
    const creationPath = this.creationPath(projectId);
    const verificationMarkerPath =
      this.#creationVerificationMarkerPath(projectId);
    assertApi(
      !existsSync(activePath) &&
        !existsSync(this.trashPath(projectId)) &&
        !existsSync(creationPath) &&
        !existsSync(verificationMarkerPath),
      409,
      "PROJECT_STORAGE_EXISTS",
      "Project storage already exists",
    );

    try {
      mkdirSync(creationPath, { recursive: false });
      this.#assertProjectDirectory(creationPath, this.creationRoot);
      mkdirSync(join(creationPath, "assets"), { recursive: false });
      createRuntimeDatabase(
        join(creationPath, "test.sqlite"),
        projectId,
        "test",
      );
      createRuntimeDatabase(
        join(creationPath, "production.sqlite"),
        projectId,
        "production",
      );
      this.#atomicWriteFile(
        join(creationPath, "project-manifest.json"),
        `${JSON.stringify(
          {
            manifestVersion: 1,
            projectId,
            name: project.name,
            slug: project.slug,
            themeId: project.themeId,
            runtimeDatabases: ["test.sqlite", "production.sqlite"],
            assetDirectory: "assets",
          },
          null,
          2,
        )}\n`,
      );
      this.assertDatabaseIntegrity(
        join(creationPath, "test.sqlite"),
        projectId,
        "test",
      );
      this.assertDatabaseIntegrity(
        join(creationPath, "production.sqlite"),
        projectId,
        "production",
      );
      this.#atomicWriteFile(
        verificationMarkerPath,
        this.rawSnapshot(creationPath),
      );
    } catch (error) {
      rmSync(creationPath, { force: true, recursive: true });
      rmSync(verificationMarkerPath, { force: true });
      throw error;
    }
  }

  updateProjectManifest(
    projectId: string,
    project: {
      readonly name: string;
      readonly slug: string;
      readonly themeId: string;
    },
  ): void {
    const projectPath = this.activePath(projectId);
    this.#assertProjectDirectory(projectPath, this.activeRoot);
    this.#updateProjectManifestAt(projectPath, projectId, project);
  }

  #updateProjectManifestAt(
    projectPath: string,
    projectId: string,
    project: {
      readonly name: string;
      readonly slug: string;
      readonly themeId: string;
    },
  ): void {
    const manifestPath = join(projectPath, "project-manifest.json");
    let current: Record<string, unknown> = {};
    let currentIsValid = false;
    try {
      const parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as unknown;
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        !Array.isArray(parsed)
      ) {
        current = parsed as Record<string, unknown>;
        currentIsValid = true;
      }
    } catch {
      // Metadata is authoritative; an interrupted manifest write is regenerated.
    }
    if (
      currentIsValid &&
      current.projectId === projectId &&
      current.name === project.name &&
      current.slug === project.slug &&
      current.themeId === project.themeId &&
      current.manifestVersion === 1 &&
      Array.isArray(current.runtimeDatabases) &&
      current.runtimeDatabases.length === 2 &&
      current.runtimeDatabases[0] === "test.sqlite" &&
      current.runtimeDatabases[1] === "production.sqlite" &&
      current.assetDirectory === "assets"
    ) {
      return;
    }
    const nextManifest: Record<string, unknown> = {
      manifestVersion: 1,
      projectId,
      name: project.name,
      slug: project.slug,
      themeId: project.themeId,
      runtimeDatabases: ["test.sqlite", "production.sqlite"],
      assetDirectory: "assets",
      ...current,
    };
    nextManifest.manifestVersion = 1;
    nextManifest.projectId = projectId;
    nextManifest.name = project.name;
    nextManifest.slug = project.slug;
    nextManifest.themeId = project.themeId;
    nextManifest.runtimeDatabases = ["test.sqlite", "production.sqlite"];
    nextManifest.assetDirectory = "assets";
    this.#atomicWriteFile(
      manifestPath,
      `${JSON.stringify(nextManifest, null, 2)}\n`,
    );
  }

  snapshot(namespace: "active" | "trash", projectId: string): StorageSnapshot {
    const projectPath =
      namespace === "active"
        ? this.activePath(projectId)
        : this.trashPath(projectId);
    assertApi(
      existsSync(projectPath),
      409,
      "PROJECT_STORAGE_MISSING",
      "Project storage is missing",
    );
    this.#assertProjectDirectory(
      projectPath,
      namespace === "active" ? this.activeRoot : this.trashRoot,
    );

    const files: StorageFileEntry[] = [];
    const visit = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true }).sort(
        (a, b) => a.name.localeCompare(b.name),
      )) {
        const absolutePath = join(directory, entry.name);
        const relativePath = relative(projectPath, absolutePath).replaceAll(
          sep,
          "/",
        );
        assertSafeRelativePath(relativePath);
        const stats = lstatSync(absolutePath);
        assertApi(
          !stats.isSymbolicLink(),
          409,
          "SYMLINK_NOT_ALLOWED",
          "Symbolic links are not allowed in project storage",
          { path: relativePath },
        );
        if (stats.isDirectory()) {
          visit(absolutePath);
        } else if (stats.isFile() && relativePath !== "trash-manifest.json") {
          const content = readFileSync(absolutePath);
          files.push({
            path: relativePath,
            sha256: sha256(content),
            size: stats.size,
          });
        } else if (!stats.isFile()) {
          throw new ApiError(
            409,
            "UNSUPPORTED_STORAGE_ENTRY",
            "Project storage contains an unsupported entry",
            { path: relativePath },
          );
        }
      }
    };
    visit(projectPath);
    files.sort((a, b) => a.path.localeCompare(b.path));

    const checksum = sha256(
      files
        .map((file) => `${file.path}\0${file.sha256}\0${file.size}\n`)
        .join(""),
    );
    const fileByPath = new Map(files.map((file) => [file.path, file]));
    const testDatabase = fileByPath.get("test.sqlite");
    const productionDatabase = fileByPath.get("production.sqlite");
    assertApi(
      testDatabase !== undefined && productionDatabase !== undefined,
      409,
      "RUNTIME_DATABASE_MISSING",
      "Both test and production runtime databases are required",
    );
    this.assertDatabaseIntegrity(
      join(projectPath, "test.sqlite"),
      projectId,
      "test",
    );
    this.assertDatabaseIntegrity(
      join(projectPath, "production.sqlite"),
      projectId,
      "production",
    );

    return {
      checksum,
      files,
      fileCount: files.length,
      assetCount: files.filter((file) => file.path.startsWith("assets/"))
        .length,
      totalBytes: files.reduce((total, file) => total + file.size, 0),
      testDatabaseChecksum: testDatabase.sha256,
      productionDatabaseChecksum: productionDatabase.sha256,
    };
  }

  assertDatabaseIntegrity(
    path: string,
    projectId: string,
    environment: "test" | "production",
  ): void {
    const database = new Database(path, {
      readonly: true,
      fileMustExist: true,
    });
    try {
      assertApi(
        database.pragma("quick_check", { simple: true }) === "ok",
        409,
        "RUNTIME_DATABASE_CORRUPT",
        `${environment} runtime database integrity check failed`,
      );
      const metadata = database
        .prepare(
          "SELECT project_id, environment FROM webeditor_runtime_metadata LIMIT 1",
        )
        .get() as
        | { readonly project_id: string; readonly environment: string }
        | undefined;
      assertApi(
        metadata?.project_id === projectId &&
          metadata.environment === environment,
        409,
        "RUNTIME_DATABASE_OWNERSHIP_MISMATCH",
        `${environment} runtime database belongs to another project`,
      );
    } finally {
      database.close();
    }
  }

  writeTrashManifest(
    projectId: string,
    manifest: Record<string, unknown>,
  ): void {
    const projectPath = this.trashPath(projectId);
    this.#assertProjectDirectory(projectPath, this.trashRoot);
    this.#atomicWriteFile(
      join(projectPath, "trash-manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
  }

  moveActiveToTrash(projectId: string): void {
    this.triggerFailure("trash:before-move");
    this.moveDirectory(this.activePath(projectId), this.trashPath(projectId));
    this.triggerFailure("trash:after-move");
  }

  moveTrashToActive(projectId: string): void {
    this.triggerFailure("restore:before-move");
    this.moveDirectory(this.trashPath(projectId), this.activePath(projectId));
    this.removeActiveTrashManifestFile(projectId);
    this.triggerFailure("restore:after-move");
  }

  moveDirectory(source: string, destination: string): void {
    assertWithin(this.root, source);
    assertWithin(this.root, destination);
    assertApi(
      existsSync(source),
      409,
      "STORAGE_SOURCE_MISSING",
      "Storage source is missing",
    );
    assertApi(
      !existsSync(destination),
      409,
      "STORAGE_DESTINATION_EXISTS",
      "Storage destination already exists",
    );
    this.#assertProjectDirectory(source, dirname(source));
    this.#assertTrustedDirectory(dirname(destination), this.#realRoot);

    try {
      this.triggerFailure("storage:before-rename");
      renameSync(source, destination);
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? (error as { readonly code?: unknown }).code
          : undefined;
      if (code !== "EXDEV") {
        throw error;
      }
      this.assertTreeHasNoSymlinks(source);
      const destinationRoot = dirname(destination);
      const copyStaging = join(
        destinationRoot,
        `.incoming-${basename(destination)}-${randomUUID()}`,
      );
      assertWithin(destinationRoot, copyStaging);
      assertApi(
        !existsSync(copyStaging),
        409,
        "STORAGE_MOVE_STAGING_COLLISION",
        "Cross-volume move staging already exists",
      );
      try {
        cpSync(source, copyStaging, { errorOnExist: true, recursive: true });
        this.triggerFailure("storage:during-cross-volume-copy");
        const sourceFiles = this.rawSnapshot(source);
        const destinationFiles = this.rawSnapshot(copyStaging);
        if (sourceFiles !== destinationFiles) {
          throw new Error("Cross-volume project copy checksum mismatch", {
            cause: error,
          });
        }
        renameSync(copyStaging, destination);
      } catch (copyError) {
        rmSync(copyStaging, { force: true, recursive: true });
        throw new Error("Cross-volume project move copy failed safely", {
          cause: copyError,
        });
      }
      this.triggerFailure("storage:after-cross-volume-promote");
      rmSync(source, { force: false, recursive: true });
    }
  }

  preparePurge(
    projectId: string,
    operationId: string,
    planId: string,
    backupBeforePurge: boolean,
  ): void {
    validateProjectId(operationId);
    validateProjectId(planId);
    const trashPath = this.trashPath(projectId);
    const snapshotBefore = this.snapshot("trash", projectId);
    const recoveryPath = join(this.recoveryRoot, operationId);
    const stagingPath = join(this.stagingRoot, operationId);
    const verificationMarkerPath =
      this.#purgeVerificationMarkerPath(operationId);
    assertWithin(this.root, recoveryPath);
    assertWithin(this.root, stagingPath);
    assertApi(
      !existsSync(recoveryPath) &&
        !existsSync(stagingPath) &&
        !existsSync(verificationMarkerPath),
      409,
      "PURGE_RECOVERY_COLLISION",
      "Purge recovery storage already exists",
    );
    mkdirSync(dirname(recoveryPath), { recursive: true });
    this.assertTreeHasNoSymlinks(trashPath);
    try {
      cpSync(trashPath, recoveryPath, { errorOnExist: true, recursive: true });
      this.triggerFailure("purge:before-recovery-verification");
      const sourceChecksum = this.rawSnapshot(trashPath);
      assertApi(
        sourceChecksum === this.rawSnapshot(recoveryPath),
        500,
        "PURGE_RECOVERY_CHECKSUM_MISMATCH",
        "Purge recovery snapshot did not match the source",
      );
      this.#atomicWriteFile(verificationMarkerPath, sourceChecksum);
      if (backupBeforePurge) {
        this.#createRetainedPurgeBackup(
          projectId,
          operationId,
          planId,
          sourceChecksum,
        );
      }
    } catch (error) {
      rmSync(recoveryPath, { force: true, recursive: true });
      rmSync(verificationMarkerPath, { force: true });
      throw error;
    }

    try {
      this.moveDirectory(trashPath, stagingPath);
      rmSync(join(stagingPath, "test.sqlite"), { force: true });
      rmSync(join(stagingPath, "production.sqlite"), { force: true });
      this.triggerFailure("purge:after-runtime-databases");
      rmSync(stagingPath, { force: false, recursive: true });
      this.triggerFailure("purge:before-finalize");
    } catch (error) {
      this.compensatePreparedPurge(projectId, operationId);
      assertApi(
        this.snapshot("trash", projectId).checksum === snapshotBefore.checksum,
        500,
        "PURGE_COMPENSATION_FAILED",
        "Purge compensation did not restore the original checksum",
      );
      throw error;
    }
  }

  compensatePreparedPurge(projectId: string, operationId: string): void {
    validateProjectId(operationId);
    const trashPath = this.trashPath(projectId);
    const recoveryPath = join(this.recoveryRoot, operationId);
    const stagingPath = join(this.stagingRoot, operationId);
    const verificationMarkerPath =
      this.#purgeVerificationMarkerPath(operationId);
    assertWithin(this.root, recoveryPath);
    assertWithin(this.root, stagingPath);
    const verifiedChecksum = this.#verifiedPurgeRecoveryChecksum(operationId);
    assertApi(
      verifiedChecksum !== undefined,
      500,
      "PURGE_RECOVERY_NOT_VERIFIED",
      "Purge recovery copy is missing or unverified",
    );
    rmSync(stagingPath, { force: true, recursive: true });
    if (existsSync(trashPath)) {
      if (this.rawSnapshot(trashPath) === verifiedChecksum) {
        rmSync(recoveryPath, { force: false, recursive: true });
        rmSync(verificationMarkerPath, { force: true });
        return;
      }
      rmSync(trashPath, { force: false, recursive: true });
    }
    try {
      cpSync(recoveryPath, trashPath, { errorOnExist: true, recursive: true });
    } catch (error) {
      throw new Error("Verified purge recovery could not be restored", {
        cause: error,
      });
    }
    assertApi(
      this.rawSnapshot(trashPath) === verifiedChecksum,
      500,
      "PURGE_COMPENSATION_FAILED",
      "Purge compensation did not restore the recovery snapshot",
    );
    this.snapshot("trash", projectId);
    rmSync(recoveryPath, { force: false, recursive: true });
    rmSync(verificationMarkerPath, { force: true });
  }

  commitPreparedPurge(
    projectId: string,
    operationId: string,
    planId: string,
    backupBeforePurge: boolean,
  ): void {
    validateProjectId(operationId);
    validateProjectId(planId);
    const recoveryPath = join(this.recoveryRoot, operationId);
    const verificationMarkerPath =
      this.#purgeVerificationMarkerPath(operationId);
    assertWithin(this.root, recoveryPath);
    if (!existsSync(recoveryPath)) {
      rmSync(verificationMarkerPath, { force: true });
      return;
    }
    assertApi(
      this.#verifiedPurgeRecoveryChecksum(operationId) !== undefined,
      500,
      "PURGE_RECOVERY_NOT_VERIFIED",
      "Purge recovery copy is not verified",
    );
    this.triggerFailure("purge:commit-recovery");
    if (backupBeforePurge) {
      const projectBackupRoot = join(this.backupsRoot, projectId);
      const backupPath = join(projectBackupRoot, planId);
      assertWithin(this.root, backupPath);
      this.#assertTrustedDirectory(projectBackupRoot, this.backupsRoot);
      this.#assertProjectDirectory(backupPath, projectBackupRoot);
      assertApi(
        existsSync(backupPath) &&
          this.rawSnapshot(backupPath) ===
            this.#verifiedPurgeRecoveryChecksum(operationId),
        500,
        "PURGE_BACKUP_NOT_RETAINED",
        "Requested purge backup was not retained before deletion",
      );
      rmSync(recoveryPath, { force: false, recursive: true });
    } else {
      rmSync(recoveryPath, { force: false, recursive: true });
    }
    rmSync(verificationMarkerPath, { force: true });
  }

  hasPreparedPurge(operationId: string): boolean {
    validateProjectId(operationId);
    return this.#verifiedPurgeRecoveryChecksum(operationId) !== undefined;
  }

  hasPurgeRecoveryArtifacts(operationId: string): boolean {
    validateProjectId(operationId);
    return (
      existsSync(join(this.recoveryRoot, operationId)) ||
      existsSync(join(this.stagingRoot, operationId)) ||
      existsSync(this.#purgeVerificationMarkerPath(operationId))
    );
  }

  discardUnverifiedPurgeRecovery(operationId: string): void {
    validateProjectId(operationId);
    assertApi(
      !this.hasPreparedPurge(operationId),
      500,
      "VERIFIED_PURGE_RECOVERY_DISCARD_BLOCKED",
      "Verified purge recovery cannot be discarded as an unverified copy",
    );
    rmSync(join(this.recoveryRoot, operationId), {
      force: true,
      recursive: true,
    });
    rmSync(join(this.stagingRoot, operationId), {
      force: true,
      recursive: true,
    });
    rmSync(this.#purgeVerificationMarkerPath(operationId), { force: true });
  }

  exportFiles(projectId: string): readonly ExportedStorageFile[] {
    const snapshot = this.snapshot("active", projectId);
    const root = this.activePath(projectId);
    return snapshot.files.map((file) => ({
      path: file.path,
      sha256: file.sha256,
      contentBase64: readFileSync(join(root, file.path)).toString("base64"),
    }));
  }

  stageFromExport(
    projectId: string,
    project: {
      readonly name: string;
      readonly slug: string;
      readonly themeId: string;
    },
    files: readonly ExportedStorageFile[],
  ): void {
    const destination = this.creationPath(projectId);
    const verificationMarkerPath =
      this.#creationVerificationMarkerPath(projectId);
    assertApi(
      !existsSync(destination) &&
        !existsSync(this.activePath(projectId)) &&
        !existsSync(this.trashPath(projectId)) &&
        !existsSync(verificationMarkerPath),
      409,
      "PROJECT_STORAGE_EXISTS",
      "Project storage already exists",
    );
    assertApi(
      files.length > 0,
      400,
      "EMPTY_IMPORT",
      "Project export has no files",
    );
    let totalBytes = 0;
    try {
      mkdirSync(destination, { recursive: false });
      this.#assertProjectDirectory(destination, this.creationRoot);
      for (const file of files) {
        assertSafeRelativePath(file.path);
        assertApi(
          file.path === "project-manifest.json" ||
            file.path === "test.sqlite" ||
            file.path === "production.sqlite" ||
            file.path.startsWith("assets/"),
          400,
          "IMPORT_FILE_NOT_ALLOWED",
          "Project export contains a file outside the allowed project layout",
          { path: file.path },
        );
        const content = Buffer.from(file.contentBase64, "base64");
        totalBytes += content.byteLength;
        assertApi(
          totalBytes <= PROJECT_IMPORT_DECODED_LIMIT_BYTES,
          413,
          "IMPORT_TOO_LARGE",
          "Project export exceeds the import size limit",
        );
        assertApi(
          sha256(content) === file.sha256,
          400,
          "IMPORT_CHECKSUM_MISMATCH",
          "Project export file checksum does not match",
          { path: file.path },
        );
        const outputPath = join(destination, file.path);
        assertWithin(destination, outputPath);
        mkdirSync(dirname(outputPath), { recursive: true });
        writeFileSync(outputPath, content, { flag: "wx" });
      }

      for (const environment of ["test", "production"] as const) {
        const database = new Database(
          join(destination, `${environment}.sqlite`),
        );
        try {
          database
            .prepare(
              "UPDATE webeditor_runtime_metadata SET project_id = ?, sentinel = ?",
            )
            .run(projectId, `${projectId}:${environment}:v1`);
        } finally {
          database.close();
        }
      }
      this.#updateProjectManifestAt(destination, projectId, project);
      this.assertDatabaseIntegrity(
        join(destination, "test.sqlite"),
        projectId,
        "test",
      );
      this.assertDatabaseIntegrity(
        join(destination, "production.sqlite"),
        projectId,
        "production",
      );
      this.#atomicWriteFile(
        verificationMarkerPath,
        this.rawSnapshot(destination),
      );
    } catch (error) {
      rmSync(destination, { force: true, recursive: true });
      rmSync(verificationMarkerPath, { force: true });
      throw error;
    }
  }

  commitStagedProject(
    projectId: string,
    injectFailure = true,
  ): StorageSnapshot {
    const source = this.creationPath(projectId);
    const destination = this.activePath(projectId);
    const verificationMarkerPath =
      this.#creationVerificationMarkerPath(projectId);
    const expectedChecksum = this.#creationVerificationChecksum(projectId);
    assertApi(
      existsSync(source) && expectedChecksum !== undefined,
      503,
      "PROJECT_CREATION_STAGING_MISSING",
      "Staged project storage or its verification marker is missing",
    );
    assertApi(
      !existsSync(destination) && !existsSync(this.trashPath(projectId)),
      503,
      "PROJECT_CREATION_DESTINATION_EXISTS",
      "Staged project cannot be promoted over existing storage",
    );
    this.#assertProjectDirectory(source, this.creationRoot);
    this.#assertTrustedDirectory(this.activeRoot, this.#realRoot);
    assertApi(
      this.rawSnapshot(source) === expectedChecksum,
      503,
      "PROJECT_CREATION_STAGING_CHECKSUM_MISMATCH",
      "Staged project storage no longer matches its verification marker",
    );
    if (injectFailure) {
      this.triggerFailure("create:before-promote");
    }
    this.moveDirectory(source, destination);
    const snapshot = this.snapshot("active", projectId);
    assertApi(
      this.rawSnapshot(destination) === expectedChecksum,
      503,
      "PROJECT_CREATION_PROMOTION_CHECKSUM_MISMATCH",
      "Promoted project storage no longer matches its verification marker",
    );
    rmSync(verificationMarkerPath, { force: true });
    return snapshot;
  }

  recoverStagedProjects(activeProjectIds: ReadonlySet<string>): void {
    this.#assertTrustedDirectory(this.creationRoot, this.#realRoot);
    const stagedProjectIds = new Set<string>();
    const markerProjectIds = new Set<string>();
    for (const entry of readdirSync(this.creationRoot, {
      withFileTypes: true,
    })) {
      assertApi(
        !entry.isSymbolicLink(),
        503,
        "INVALID_PROJECT_CREATION_STAGING",
        "Project creation staging cannot contain symbolic links",
      );
      if (entry.isDirectory() && PROJECT_ID_PATTERN.test(entry.name)) {
        stagedProjectIds.add(entry.name);
        continue;
      }
      const markerMatch = CREATION_VERIFICATION_MARKER_PATTERN.exec(entry.name);
      if (entry.isFile() && markerMatch?.[1] !== undefined) {
        markerProjectIds.add(markerMatch[1]);
        continue;
      }
      throw new ApiError(
        503,
        "INVALID_PROJECT_CREATION_STAGING",
        "Project creation staging contains an unexpected entry",
      );
    }
    const projectIds = new Set([...stagedProjectIds, ...markerProjectIds]);
    for (const projectId of [...projectIds].sort()) {
      const stagingPath = this.creationPath(projectId);
      const verificationMarkerPath =
        this.#creationVerificationMarkerPath(projectId);
      if (!activeProjectIds.has(projectId)) {
        rmSync(stagingPath, { force: true, recursive: true });
        rmSync(verificationMarkerPath, { force: true });
        continue;
      }
      const activePath = this.activePath(projectId);
      const expectedChecksum = this.#creationVerificationChecksum(projectId);
      assertApi(
        expectedChecksum !== undefined,
        503,
        "PROJECT_CREATION_VERIFICATION_MISSING",
        "Committed staged project is missing its verification marker",
      );
      assertApi(
        !existsSync(this.trashPath(projectId)),
        503,
        "PROJECT_CREATION_TRASH_CONFLICT",
        "Staged active project conflicts with recycle-bin storage",
      );
      let activeIsValid = false;
      if (existsSync(activePath)) {
        try {
          this.snapshot("active", projectId);
          activeIsValid = this.rawSnapshot(activePath) === expectedChecksum;
        } catch {
          // A partially promoted destination cannot be authoritative.
        }
      }
      if (activeIsValid) {
        rmSync(stagingPath, { force: true, recursive: true });
        rmSync(verificationMarkerPath, { force: true });
        continue;
      }
      assertApi(
        existsSync(stagingPath),
        503,
        "PROJECT_CREATION_RECOVERY_SOURCE_MISSING",
        "Neither a verified active project nor its staged source is available",
      );
      this.#assertProjectDirectory(stagingPath, this.creationRoot);
      assertApi(
        this.rawSnapshot(stagingPath) === expectedChecksum,
        503,
        "PROJECT_CREATION_RECOVERY_SOURCE_INVALID",
        "Staged project recovery source does not match its checksum",
      );
      if (existsSync(activePath)) {
        rmSync(activePath, { force: false, recursive: true });
      }
      this.commitStagedProject(projectId, false);
    }
  }

  scan(knownProjectIds: ReadonlySet<string>): StorageScanResult {
    const listIds = (root: string): string[] => {
      this.#assertTrustedDirectory(root, this.#realRoot);
      return readdirSync(root, { withFileTypes: true })
        .filter((entry) => {
          assertApi(
            !entry.isSymbolicLink(),
            409,
            "SYMLINK_NOT_ALLOWED",
            "Symbolic links are not allowed in project storage namespaces",
          );
          return entry.isDirectory() && PROJECT_ID_PATTERN.test(entry.name);
        })
        .map((entry) => entry.name)
        .sort();
    };
    const activeProjectIds = listIds(this.activeRoot);
    const trashProjectIds = listIds(this.trashRoot);
    const activeSet = new Set(activeProjectIds);
    return {
      activeProjectIds,
      trashProjectIds,
      dualLocationProjectIds: trashProjectIds.filter((id) => activeSet.has(id)),
      orphanActiveProjectIds: activeProjectIds.filter(
        (id) => !knownProjectIds.has(id),
      ),
      orphanTrashProjectIds: trashProjectIds.filter(
        (id) => !knownProjectIds.has(id),
      ),
    };
  }

  exists(namespace: "active" | "trash", projectId: string): boolean {
    return existsSync(
      namespace === "active"
        ? this.activePath(projectId)
        : this.trashPath(projectId),
    );
  }

  hasBackup(projectId: string): boolean {
    const projectBackupRoot = join(this.backupsRoot, projectId);
    if (existsSync(projectBackupRoot)) {
      this.#assertTrustedDirectory(projectBackupRoot, this.backupsRoot);
    }
    return (
      existsSync(projectBackupRoot) &&
      readdirSync(projectBackupRoot, { withFileTypes: true }).some((entry) =>
        entry.isDirectory(),
      )
    );
  }

  assertWritable(): void {
    for (const directory of [
      this.activeRoot,
      this.trashRoot,
      this.backupsRoot,
      this.recoveryRoot,
      this.stagingRoot,
      this.creationRoot,
    ]) {
      const probe = join(directory, `.write-probe-${randomUUID()}`);
      assertWithin(directory, probe);
      try {
        writeFileSync(probe, "webeditor-readiness", {
          encoding: "utf8",
          flag: "wx",
        });
      } finally {
        rmSync(probe, { force: true });
      }
    }
  }

  removeTrashManifestFile(projectId: string): void {
    rmSync(join(this.trashPath(projectId), "trash-manifest.json"), {
      force: true,
    });
  }

  removeActiveTrashManifestFile(projectId: string): void {
    rmSync(join(this.activePath(projectId), "trash-manifest.json"), {
      force: true,
    });
  }

  discardStagedProject(projectId: string): void {
    rmSync(this.creationPath(projectId), { force: true, recursive: true });
    rmSync(this.#creationVerificationMarkerPath(projectId), { force: true });
  }

  discardCompensatedCopy(
    namespace: "active" | "trash",
    projectId: string,
  ): void {
    const path =
      namespace === "active"
        ? this.activePath(projectId)
        : this.trashPath(projectId);
    rmSync(path, { force: false, recursive: true });
  }

  #rawFiles(root: string): readonly StorageFileEntry[] {
    const files: StorageFileEntry[] = [];
    const visit = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true }).sort(
        (a, b) => a.name.localeCompare(b.name),
      )) {
        const path = join(directory, entry.name);
        const stats = lstatSync(path);
        if (stats.isSymbolicLink()) {
          throw new ApiError(
            409,
            "SYMLINK_NOT_ALLOWED",
            "Symbolic links are not allowed",
          );
        }
        if (stats.isDirectory()) {
          visit(path);
        } else if (stats.isFile()) {
          const filePath = relative(root, path).replaceAll(sep, "/");
          assertSafeRelativePath(filePath);
          files.push({
            path: filePath,
            sha256: sha256(readFileSync(path)),
            size: stats.size,
          });
        }
      }
    };
    visit(root);
    return files.sort((a, b) => a.path.localeCompare(b.path));
  }

  rawSnapshot(root: string): string {
    this.#assertTrustedDirectory(root, this.#realRoot);
    return sha256(
      this.#rawFiles(root)
        .map((file) => `${file.path}\0${file.sha256}\0${file.size}\n`)
        .join(""),
    );
  }

  assertTreeHasNoSymlinks(root: string): void {
    this.#rawFiles(root);
  }

  #creationVerificationMarkerPath(projectId: string): string {
    validateProjectId(projectId);
    const path = join(this.creationRoot, `${projectId}.verified`);
    assertWithin(this.creationRoot, path);
    return path;
  }

  #creationVerificationChecksum(projectId: string): string | undefined {
    const markerPath = this.#creationVerificationMarkerPath(projectId);
    if (!existsSync(markerPath)) {
      return undefined;
    }
    const stats = lstatSync(markerPath);
    assertApi(
      stats.isFile() && !stats.isSymbolicLink(),
      503,
      "PROJECT_CREATION_VERIFICATION_INVALID",
      "Project creation verification marker must be a regular file",
    );
    const expectedChecksum = readFileSync(markerPath, "utf8");
    assertApi(
      /^[0-9a-f]{64}$/.test(expectedChecksum),
      503,
      "PROJECT_CREATION_VERIFICATION_INVALID",
      "Project creation verification checksum is invalid",
    );
    return expectedChecksum;
  }

  #purgeVerificationMarkerPath(operationId: string): string {
    validateProjectId(operationId);
    const path = join(this.recoveryRoot, `${operationId}.verified`);
    assertWithin(this.recoveryRoot, path);
    return path;
  }

  #verifiedPurgeRecoveryChecksum(operationId: string): string | undefined {
    const recoveryPath = join(this.recoveryRoot, operationId);
    const markerPath = this.#purgeVerificationMarkerPath(operationId);
    if (!existsSync(recoveryPath) || !existsSync(markerPath)) {
      return undefined;
    }
    const expected = readFileSync(markerPath, "utf8");
    if (!/^[0-9a-f]{64}$/.test(expected)) {
      return undefined;
    }
    return this.rawSnapshot(recoveryPath) === expected ? expected : undefined;
  }

  #createRetainedPurgeBackup(
    projectId: string,
    operationId: string,
    planId: string,
    expectedChecksum: string,
  ): void {
    const recoveryPath = join(this.recoveryRoot, operationId);
    const projectBackupRoot = join(this.backupsRoot, projectId);
    const backupPath = join(projectBackupRoot, planId);
    assertWithin(this.backupsRoot, backupPath);
    this.#ensureManagedDirectory(projectBackupRoot, this.backupsRoot);
    assertApi(
      !existsSync(backupPath),
      409,
      "PURGE_BACKUP_COLLISION",
      "Purge backup destination already exists",
    );
    try {
      cpSync(recoveryPath, backupPath, {
        errorOnExist: true,
        recursive: true,
      });
      assertApi(
        this.rawSnapshot(backupPath) === expectedChecksum,
        500,
        "PURGE_BACKUP_CHECKSUM_MISMATCH",
        "Requested purge backup checksum does not match the source",
      );
    } catch (error) {
      rmSync(backupPath, { force: true, recursive: true });
      throw error;
    }
  }

  #atomicWriteFile(destination: string, content: string): void {
    const destinationParent = dirname(destination);
    this.#assertTrustedDirectory(destinationParent, this.#realRoot);
    assertWithin(destinationParent, destination);
    if (existsSync(destination)) {
      const destinationStats = lstatSync(destination);
      assertApi(
        destinationStats.isFile() && !destinationStats.isSymbolicLink(),
        409,
        "SYMLINK_NOT_ALLOWED",
        "Manifest destinations must be regular files",
      );
    }
    const stagingPath = join(
      destinationParent,
      `.webeditor-atomic-${randomUUID()}.tmp`,
    );
    assertWithin(destinationParent, stagingPath);
    let descriptor: number | undefined;
    let directoryDescriptor: number | undefined;
    try {
      descriptor = openSync(stagingPath, "wx", 0o600);
      writeFileSync(descriptor, content, "utf8");
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = undefined;
      this.triggerFailure("storage:before-atomic-file-rename");
      renameSync(stagingPath, destination);
      directoryDescriptor = openSync(destinationParent, "r");
      fsyncSync(directoryDescriptor);
      closeSync(directoryDescriptor);
      directoryDescriptor = undefined;
    } finally {
      if (descriptor !== undefined) {
        closeSync(descriptor);
      }
      if (directoryDescriptor !== undefined) {
        closeSync(directoryDescriptor);
      }
      rmSync(stagingPath, { force: true });
    }
  }

  #cleanupInterruptedAtomicWrites(): void {
    const cleanupDirectory = (directory: string): void => {
      this.#assertTrustedDirectory(directory, this.#realRoot);
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (!ATOMIC_WRITE_STAGING_PATTERN.test(entry.name)) {
          continue;
        }
        const stagingPath = join(directory, entry.name);
        const stats = lstatSync(stagingPath);
        assertApi(
          entry.isFile() && stats.isFile() && !stats.isSymbolicLink(),
          409,
          "SYMLINK_NOT_ALLOWED",
          "Interrupted atomic writes must be regular files",
        );
        rmSync(stagingPath, { force: false });
      }
    };

    cleanupDirectory(this.recoveryRoot);
    cleanupDirectory(this.creationRoot);
    for (const namespaceRoot of [
      this.activeRoot,
      this.trashRoot,
      this.creationRoot,
    ]) {
      for (const entry of readdirSync(namespaceRoot, {
        withFileTypes: true,
      })) {
        if (entry.isDirectory() && PROJECT_ID_PATTERN.test(entry.name)) {
          cleanupDirectory(join(namespaceRoot, entry.name));
        }
      }
    }
  }

  #cleanupInterruptedMoveStaging(): void {
    for (const namespaceRoot of [
      this.activeRoot,
      this.trashRoot,
      this.stagingRoot,
    ]) {
      this.#assertTrustedDirectory(namespaceRoot, this.#realRoot);
      for (const entry of readdirSync(namespaceRoot, {
        withFileTypes: true,
      })) {
        assertApi(
          !entry.isSymbolicLink(),
          409,
          "SYMLINK_NOT_ALLOWED",
          "Managed move namespaces cannot contain symbolic links",
        );
        if (!INTERRUPTED_MOVE_STAGING_PATTERN.test(entry.name)) {
          assertApi(
            entry.isDirectory() && PROJECT_ID_PATTERN.test(entry.name),
            409,
            "UNEXPECTED_STORAGE_ENTRY",
            "Managed move namespace contains an unexpected entry",
          );
          continue;
        }
        const stagingPath = join(namespaceRoot, entry.name);
        const stats = lstatSync(stagingPath);
        assertApi(
          entry.isDirectory() &&
            stats.isDirectory() &&
            !entry.isSymbolicLink() &&
            !stats.isSymbolicLink(),
          409,
          "SYMLINK_NOT_ALLOWED",
          "Interrupted move staging must be a real directory",
        );
        this.#assertTrustedDirectory(stagingPath, realpathSync(namespaceRoot));
        rmSync(stagingPath, { force: false, recursive: true });
      }
    }
  }

  #assertTrustedDirectory(directory: string, trustedRoot: string): void {
    const stats = lstatSync(directory);
    assertApi(
      stats.isDirectory() && !stats.isSymbolicLink(),
      409,
      "SYMLINK_NOT_ALLOWED",
      "Managed storage directories cannot be symbolic links",
    );
    const realDirectory = realpathSync(directory);
    const realTrustedRoot = realpathSync(trustedRoot);
    assertWithin(realTrustedRoot, realDirectory);
  }

  #assertProjectDirectory(directory: string, namespaceRoot: string): void {
    this.#assertTrustedDirectory(namespaceRoot, this.#realRoot);
    this.#assertTrustedDirectory(directory, realpathSync(namespaceRoot));
  }

  #ensureManagedDirectory(directory: string, namespaceRoot: string): void {
    this.#assertTrustedDirectory(namespaceRoot, this.#realRoot);
    if (!existsSync(directory)) {
      mkdirSync(directory, { recursive: false });
    }
    this.#assertTrustedDirectory(directory, realpathSync(namespaceRoot));
  }
}
