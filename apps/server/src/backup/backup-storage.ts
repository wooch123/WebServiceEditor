import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, sep } from "node:path";

import type { ProjectExportDto, ProjectExportFile } from "@webeditor/domain";

import { ApiError, assertApi } from "../errors.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export interface StoredProjectBackupManifest {
  readonly schemaVersion: 1;
  readonly backupId: string;
  readonly sourceProjectId: string;
  readonly sourceProjectName: string;
  readonly sourceProjectSlug: string;
  readonly sourceProjectRevision: number;
  readonly payloadChecksum: string;
  readonly contentChecksum: string;
  readonly fileCount: number;
  readonly totalBytes: number;
  readonly createdAt: string;
}

export interface VerifiedStoredProjectBackup {
  readonly manifest: StoredProjectBackupManifest;
  readonly export: ProjectExportDto;
  readonly relativePath: string;
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function contentChecksum(files: readonly ProjectExportFile[]): string {
  return sha256(
    JSON.stringify(
      [...files]
        .map(({ path, sha256: checksum }) => ({ path, sha256: checksum }))
        .sort((left, right) => left.path.localeCompare(right.path)),
    ),
  );
}

function decodedSize(file: ProjectExportFile): number {
  return Buffer.from(file.contentBase64, "base64").byteLength;
}

function assertIdentifier(value: string, field: string): void {
  assertApi(
    UUID_PATTERN.test(value),
    400,
    "INVALID_BACKUP_IDENTIFIER",
    `${field} must be a UUID`,
  );
}

function assertWithin(root: string, candidate: string): void {
  const fromRoot = relative(root, candidate);
  assertApi(
    fromRoot !== ".." &&
      !fromRoot.startsWith(`..${sep}`) &&
      !fromRoot.startsWith(sep),
    400,
    "BACKUP_PATH_ESCAPE",
    "Backup path escaped its managed root",
  );
}

export class BackupStorage {
  readonly root: string;
  readonly #realRoot: string;

  constructor(storageRoot: string) {
    this.root = join(storageRoot, "backups", "project-backups");
    mkdirSync(this.root, { recursive: true });
    this.#realRoot = realpathSync(this.root);
  }

  write(
    backupId: string,
    exportDto: ProjectExportDto,
    createdAt: string,
  ): VerifiedStoredProjectBackup {
    assertIdentifier(backupId, "backupId");
    assertIdentifier(exportDto.project.id, "sourceProjectId");
    const directory = this.#directory(exportDto.project.id, backupId);
    if (existsSync(directory)) {
      return this.read(exportDto.project.id, backupId);
    }
    mkdirSync(directory, { recursive: true });
    this.#assertDirectory(directory);

    const payload = JSON.stringify(exportDto);
    const manifest: StoredProjectBackupManifest = {
      schemaVersion: 1,
      backupId,
      sourceProjectId: exportDto.project.id,
      sourceProjectName: exportDto.project.name,
      sourceProjectSlug: exportDto.project.slug,
      sourceProjectRevision: exportDto.project.revision,
      payloadChecksum: sha256(payload),
      contentChecksum: contentChecksum(exportDto.files),
      fileCount: exportDto.files.length,
      totalBytes: exportDto.files.reduce(
        (total, file) => total + decodedSize(file),
        0,
      ),
      createdAt,
    };
    this.#atomicWrite(join(directory, "project-export.json"), payload);
    this.#atomicWrite(
      join(directory, "backup-manifest.json"),
      JSON.stringify(manifest),
    );
    return this.read(exportDto.project.id, backupId);
  }

  exists(sourceProjectId: string, backupId: string): boolean {
    assertIdentifier(sourceProjectId, "sourceProjectId");
    assertIdentifier(backupId, "backupId");
    return existsSync(this.#directory(sourceProjectId, backupId));
  }

  read(sourceProjectId: string, backupId: string): VerifiedStoredProjectBackup {
    assertIdentifier(sourceProjectId, "sourceProjectId");
    assertIdentifier(backupId, "backupId");
    const directory = this.#directory(sourceProjectId, backupId);
    this.#assertDirectory(directory);
    const payloadPath = join(directory, "project-export.json");
    const manifestPath = join(directory, "backup-manifest.json");
    this.#assertFile(payloadPath);
    this.#assertFile(manifestPath);
    const payload = readFileSync(payloadPath, "utf8");
    let manifest: StoredProjectBackupManifest;
    let exportDto: ProjectExportDto;
    try {
      manifest = JSON.parse(
        readFileSync(manifestPath, "utf8"),
      ) as StoredProjectBackupManifest;
      exportDto = JSON.parse(payload) as ProjectExportDto;
    } catch {
      throw new ApiError(
        409,
        "BACKUP_JSON_INVALID",
        "Backup manifest or payload is not valid JSON",
      );
    }
    this.#assertManifest(manifest, sourceProjectId, backupId);
    assertApi(
      exportDto.format === "webeditor-project-v1" &&
        exportDto.project?.id === sourceProjectId &&
        Array.isArray(exportDto.files) &&
        exportDto.files.length === manifest.fileCount,
      409,
      "BACKUP_PAYLOAD_INVALID",
      "Backup payload does not match its manifest",
    );
    assertApi(
      sha256(payload) === manifest.payloadChecksum,
      409,
      "BACKUP_PAYLOAD_CHECKSUM_MISMATCH",
      "Backup payload checksum does not match its manifest",
    );
    for (const file of exportDto.files) {
      assertApi(
        typeof file.path === "string" &&
          SHA256_PATTERN.test(file.sha256) &&
          typeof file.contentBase64 === "string" &&
          sha256(Buffer.from(file.contentBase64, "base64")) === file.sha256,
        409,
        "BACKUP_FILE_CHECKSUM_MISMATCH",
        "A backup file checksum is invalid",
        { path: file.path },
      );
    }
    assertApi(
      contentChecksum(exportDto.files) === manifest.contentChecksum &&
        exportDto.files.reduce(
          (total, file) => total + decodedSize(file),
          0,
        ) === manifest.totalBytes,
      409,
      "BACKUP_CONTENT_CHECKSUM_MISMATCH",
      "Backup content inventory does not match its manifest",
    );
    return {
      manifest,
      export: exportDto,
      relativePath: relative(dirname(dirname(this.root)), directory).replaceAll(
        sep,
        "/",
      ),
    };
  }

  #directory(sourceProjectId: string, backupId: string): string {
    const directory = join(this.root, sourceProjectId, backupId);
    assertWithin(this.root, directory);
    return directory;
  }

  #assertDirectory(path: string): void {
    assertApi(
      existsSync(path) && lstatSync(path).isDirectory(),
      409,
      "BACKUP_DIRECTORY_MISSING",
      "Backup directory is missing",
    );
    assertApi(
      !lstatSync(path).isSymbolicLink() &&
        (realpathSync(path) === this.#realRoot ||
          realpathSync(path).startsWith(`${this.#realRoot}${sep}`)),
      409,
      "BACKUP_DIRECTORY_UNTRUSTED",
      "Backup directory is outside the managed namespace",
    );
  }

  #assertFile(path: string): void {
    assertWithin(this.root, path);
    assertApi(
      existsSync(path) &&
        lstatSync(path).isFile() &&
        !lstatSync(path).isSymbolicLink(),
      409,
      "BACKUP_FILE_MISSING",
      "Backup file is missing or untrusted",
    );
  }

  #assertManifest(
    manifest: StoredProjectBackupManifest,
    sourceProjectId: string,
    backupId: string,
  ): void {
    assertApi(
      manifest.schemaVersion === 1 &&
        manifest.backupId === backupId &&
        manifest.sourceProjectId === sourceProjectId &&
        typeof manifest.sourceProjectName === "string" &&
        manifest.sourceProjectName.trim().length > 0 &&
        typeof manifest.sourceProjectSlug === "string" &&
        manifest.sourceProjectSlug.trim().length > 0 &&
        Number.isInteger(manifest.sourceProjectRevision) &&
        manifest.sourceProjectRevision >= 1 &&
        SHA256_PATTERN.test(manifest.payloadChecksum) &&
        SHA256_PATTERN.test(manifest.contentChecksum) &&
        Number.isInteger(manifest.fileCount) &&
        manifest.fileCount > 0 &&
        Number.isInteger(manifest.totalBytes) &&
        manifest.totalBytes >= 0 &&
        Number.isFinite(Date.parse(manifest.createdAt)),
      409,
      "BACKUP_MANIFEST_INVALID",
      "Backup manifest fields are invalid",
    );
  }

  #atomicWrite(path: string, content: string): void {
    assertWithin(this.root, path);
    const temporary = `${path}.tmp-${randomUUID()}`;
    writeFileSync(temporary, content, { encoding: "utf8", flag: "wx" });
    const file = openSync(temporary, "r");
    try {
      fsyncSync(file);
    } finally {
      closeSync(file);
    }
    renameSync(temporary, path);
    const parent = openSync(dirname(path), "r");
    try {
      fsyncSync(parent);
    } finally {
      closeSync(parent);
    }
  }
}
