import { createHash, randomUUID } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";

import Database from "better-sqlite3";

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export interface OfflineBackupFileRecord {
  readonly path: string;
  readonly size: number;
  readonly sha256: string;
}

export interface OfflineBackupManifest {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly createdAt: string;
  readonly source: {
    readonly metadataDatabaseName: string;
    readonly storageRootName: string;
  };
  readonly files: readonly OfflineBackupFileRecord[];
  readonly fileCount: number;
  readonly totalBytes: number;
  readonly contentChecksum: string;
}

export interface OfflineBackupVerification {
  readonly result: "PASS";
  readonly backupId: string;
  readonly checkedAt: string;
  readonly fileCount: number;
  readonly totalBytes: number;
  readonly contentChecksum: string;
  readonly sqliteDatabaseCount: number;
}

export interface OfflineBackupOptions {
  readonly metadataDatabasePath: string;
  readonly storageRoot: string;
  readonly backupRoot: string;
  readonly now?: () => Date;
}

function sha256(input: Buffer | string): string {
  return createHash("sha256").update(input).digest("hex");
}

function portablePath(path: string): string {
  return path.split("\\").join("/");
}

function canonicalFileChecksum(
  records: readonly OfflineBackupFileRecord[],
): string {
  return sha256(
    JSON.stringify(
      [...records]
        .sort((left, right) => left.path.localeCompare(right.path))
        .map(({ path, size, sha256: checksum }) => ({
          path,
          sha256: checksum,
          size,
        })),
    ),
  );
}

function assertAbsoluteSafePath(name: string, path: string): string {
  if (!isAbsolute(path)) throw new Error(`${name} must be an absolute path`);
  const resolved = resolve(path);
  if (resolved === dirname(resolved)) {
    throw new Error(`${name} cannot be a filesystem root`);
  }
  return resolved;
}

function isInside(parent: string, candidate: string): boolean {
  const path = relative(parent, candidate);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

function assertWithin(parent: string, candidate: string, name: string): string {
  const resolvedParent = resolve(parent);
  const resolvedCandidate = resolve(candidate);
  if (
    resolvedCandidate === resolvedParent ||
    !isInside(resolvedParent, resolvedCandidate)
  ) {
    throw new Error(`${name} must be a child of its scoped root`);
  }
  return resolvedCandidate;
}

async function assertDirectoryWithoutLinks(root: string): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      throw new Error(`Backup source contains a symbolic link: ${entry.name}`);
    }
    if (entry.isDirectory()) {
      await assertDirectoryWithoutLinks(join(root, entry.name));
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(
        `Backup source contains an unsupported entry: ${entry.name}`,
      );
    }
  }
}

async function copyDirectory(
  source: string,
  destination: string,
): Promise<void> {
  await mkdir(destination, { recursive: true });
  const entries = await readdir(source, { withFileTypes: true });
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const sourcePath = join(source, entry.name);
    const destinationPath = join(destination, entry.name);
    if (entry.isDirectory()) {
      await copyDirectory(sourcePath, destinationPath);
    } else if (entry.isFile()) {
      await copyFile(sourcePath, destinationPath);
    } else {
      throw new Error(
        `Backup source contains an unsupported entry: ${entry.name}`,
      );
    }
  }
}

async function copyLiveDirectory(
  source: string,
  destination: string,
): Promise<void> {
  await mkdir(destination, { recursive: true });
  const entries = await readdir(source, { withFileTypes: true });
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const sourcePath = join(source, entry.name);
    const destinationPath = join(destination, entry.name);
    if (entry.isDirectory()) {
      await copyLiveDirectory(sourcePath, destinationPath);
    } else if (entry.isFile()) {
      if (/(?:\.sqlite|\.db)-(?:wal|shm|journal)$/iu.test(entry.name)) {
        continue;
      }
      if (/(?:\.sqlite|\.db)$/iu.test(entry.name)) {
        const database = new Database(sourcePath, {
          readonly: true,
          fileMustExist: true,
        });
        try {
          if (database.pragma("quick_check", { simple: true }) !== "ok") {
            throw new Error(`Live SQLite quick_check failed: ${sourcePath}`);
          }
          await database.backup(destinationPath);
        } finally {
          database.close();
        }
        normalizeBackupDatabase(destinationPath);
      } else {
        await copyFile(sourcePath, destinationPath);
      }
    } else {
      throw new Error(
        `Backup source contains an unsupported entry: ${entry.name}`,
      );
    }
  }
}

async function fileRecords(
  root: string,
): Promise<readonly OfflineBackupFileRecord[]> {
  const records: OfflineBackupFileRecord[] = [];
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile()) {
        const contents = await readFile(path);
        records.push({
          path: portablePath(relative(root, path)),
          size: contents.byteLength,
          sha256: sha256(contents),
        });
      } else {
        throw new Error(
          `Backup payload contains an unsupported entry: ${entry.name}`,
        );
      }
    }
  };
  await visit(root);
  return records.sort((left, right) => left.path.localeCompare(right.path));
}

function assertSqliteIntegrity(databasePath: string): void {
  const database = new Database(databasePath, { readonly: true });
  try {
    if (database.pragma("quick_check", { simple: true }) !== "ok") {
      throw new Error(`SQLite quick_check failed: ${databasePath}`);
    }
    const foreignKeyFailures = database.pragma(
      "foreign_key_check",
    ) as unknown[];
    if (foreignKeyFailures.length > 0) {
      throw new Error(`SQLite foreign_key_check failed: ${databasePath}`);
    }
  } finally {
    database.close();
  }
}

function normalizeBackupDatabase(databasePath: string): void {
  const database = new Database(databasePath);
  try {
    database.pragma("wal_checkpoint(TRUNCATE)");
    database.pragma("journal_mode = DELETE");
    database.pragma("synchronous = FULL");
    if (database.pragma("quick_check", { simple: true }) !== "ok") {
      throw new Error(`Backup SQLite quick_check failed: ${databasePath}`);
    }
  } finally {
    database.close();
  }
}

async function verifySqliteFiles(
  payloadRoot: string,
  records: readonly OfflineBackupFileRecord[],
): Promise<number> {
  const sqliteRecords = records.filter(({ path }) =>
    /(?:\.sqlite|\.db)$/iu.test(path),
  );
  for (const record of sqliteRecords) {
    assertSqliteIntegrity(join(payloadRoot, ...record.path.split("/")));
  }
  return sqliteRecords.length;
}

function parseManifest(value: unknown): OfflineBackupManifest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Offline backup manifest must be an object");
  }
  const manifest = value as Partial<OfflineBackupManifest>;
  if (
    manifest.schemaVersion !== 1 ||
    typeof manifest.id !== "string" ||
    typeof manifest.createdAt !== "string" ||
    !Array.isArray(manifest.files) ||
    !Number.isInteger(manifest.fileCount) ||
    !Number.isInteger(manifest.totalBytes) ||
    typeof manifest.contentChecksum !== "string" ||
    !SHA256_PATTERN.test(manifest.contentChecksum)
  ) {
    throw new Error("Offline backup manifest is invalid");
  }
  for (const record of manifest.files) {
    if (
      typeof record !== "object" ||
      record === null ||
      typeof record.path !== "string" ||
      record.path.startsWith("/") ||
      record.path.split("/").includes("..") ||
      !Number.isInteger(record.size) ||
      record.size < 0 ||
      typeof record.sha256 !== "string" ||
      !SHA256_PATTERN.test(record.sha256)
    ) {
      throw new Error(
        "Offline backup manifest contains an invalid file record",
      );
    }
  }
  return manifest as OfflineBackupManifest;
}

export class OfflineBackupService {
  readonly metadataDatabasePath: string;
  readonly storageRoot: string;
  readonly backupRoot: string;
  readonly now: () => Date;

  constructor(options: OfflineBackupOptions) {
    this.metadataDatabasePath = assertAbsoluteSafePath(
      "Metadata database path",
      options.metadataDatabasePath,
    );
    this.storageRoot = assertAbsoluteSafePath(
      "Storage root",
      options.storageRoot,
    );
    this.backupRoot = assertAbsoluteSafePath("Backup root", options.backupRoot);
    if (
      isInside(this.storageRoot, this.backupRoot) ||
      isInside(this.backupRoot, this.storageRoot) ||
      isInside(dirname(this.metadataDatabasePath), this.backupRoot)
    ) {
      throw new Error("System backup root must be isolated from live storage");
    }
    this.now = options.now ?? (() => new Date());
  }

  async create(): Promise<OfflineBackupManifest> {
    const metadataStatus = await stat(this.metadataDatabasePath);
    const storageStatus = await stat(this.storageRoot);
    if (!metadataStatus.isFile() || !storageStatus.isDirectory()) {
      throw new Error("Live metadata and storage must exist before backup");
    }
    await assertDirectoryWithoutLinks(this.storageRoot);
    await mkdir(this.backupRoot, { recursive: true });
    const now = this.now();
    const id = `${now.toISOString().replaceAll(":", "-")}-${randomUUID()}`;
    const stagingPath = assertWithin(
      this.backupRoot,
      join(this.backupRoot, `.incoming-${id}`),
      "Backup staging path",
    );
    const destinationRoot = assertWithin(
      this.backupRoot,
      join(this.backupRoot, id),
      "Backup destination path",
    );
    const payloadRoot = assertWithin(
      stagingPath,
      join(stagingPath, "payload"),
      "Backup payload path",
    );
    try {
      await mkdir(join(payloadRoot, "metadata"), { recursive: true });
      await mkdir(payloadRoot, { recursive: true });
      const metadataDestination = join(
        payloadRoot,
        "metadata",
        basename(this.metadataDatabasePath),
      );
      const metadata = new Database(this.metadataDatabasePath, {
        readonly: true,
      });
      try {
        if (metadata.pragma("quick_check", { simple: true }) !== "ok") {
          throw new Error("Live metadata SQLite quick_check failed");
        }
        await metadata.backup(metadataDestination);
      } finally {
        metadata.close();
      }
      normalizeBackupDatabase(metadataDestination);
      await copyLiveDirectory(this.storageRoot, join(payloadRoot, "projects"));
      const files = await fileRecords(payloadRoot);
      await verifySqliteFiles(payloadRoot, files);
      const manifest: OfflineBackupManifest = {
        schemaVersion: 1,
        id,
        createdAt: now.toISOString(),
        source: {
          metadataDatabaseName: basename(this.metadataDatabasePath),
          storageRootName: basename(this.storageRoot),
        },
        files,
        fileCount: files.length,
        totalBytes: files.reduce((total, file) => total + file.size, 0),
        contentChecksum: canonicalFileChecksum(files),
      };
      await writeFile(
        join(stagingPath, "manifest.json"),
        `${JSON.stringify(manifest, null, 2)}\n`,
        { encoding: "utf8", flag: "wx" },
      );
      await rename(stagingPath, destinationRoot);
      return manifest;
    } catch (error) {
      await rm(stagingPath, { force: true, recursive: true });
      throw error;
    }
  }

  async verify(backupId: string): Promise<OfflineBackupVerification> {
    if (!/^[A-Za-z0-9._:-]+$/u.test(backupId)) {
      throw new Error("Backup ID is invalid");
    }
    const backupDirectory = assertWithin(
      this.backupRoot,
      join(this.backupRoot, backupId),
      "Backup directory",
    );
    const manifest = parseManifest(
      JSON.parse(
        await readFile(join(backupDirectory, "manifest.json"), "utf8"),
      ),
    );
    if (manifest.id !== backupId)
      throw new Error("Backup ID does not match manifest");
    const payloadRoot = join(backupDirectory, "payload");
    await assertDirectoryWithoutLinks(payloadRoot);
    const files = await fileRecords(payloadRoot);
    if (JSON.stringify(files) !== JSON.stringify(manifest.files)) {
      throw new Error("Backup file inventory or checksum does not match");
    }
    const checksum = canonicalFileChecksum(files);
    if (checksum !== manifest.contentChecksum) {
      throw new Error("Backup content checksum does not match");
    }
    if (
      files.length !== manifest.fileCount ||
      files.reduce((total, file) => total + file.size, 0) !==
        manifest.totalBytes
    ) {
      throw new Error("Backup aggregate counts do not match");
    }
    const sqliteDatabaseCount = await verifySqliteFiles(payloadRoot, files);
    return {
      result: "PASS",
      backupId,
      checkedAt: this.now().toISOString(),
      fileCount: manifest.fileCount,
      totalBytes: manifest.totalBytes,
      contentChecksum: manifest.contentChecksum,
      sqliteDatabaseCount,
    };
  }

  async restoreDrill(backupId: string): Promise<OfflineBackupVerification> {
    const sourceVerification = await this.verify(backupId);
    const stagingPath = assertWithin(
      tmpdir(),
      await mkdtemp(join(tmpdir(), "webeditor-restore-drill-")),
      "Restore drill staging path",
    );
    try {
      const sourcePayload = assertWithin(
        this.backupRoot,
        join(this.backupRoot, backupId, "payload"),
        "Restore drill source payload",
      );
      const restoredPayload = assertWithin(
        stagingPath,
        join(stagingPath, "payload"),
        "Restore drill destination payload",
      );
      await copyDirectory(sourcePayload, restoredPayload);
      const records = await fileRecords(restoredPayload);
      if (
        canonicalFileChecksum(records) !== sourceVerification.contentChecksum
      ) {
        throw new Error(
          "Restored payload checksum does not match source backup",
        );
      }
      const sqliteDatabaseCount = await verifySqliteFiles(
        restoredPayload,
        records,
      );
      return {
        ...sourceVerification,
        checkedAt: this.now().toISOString(),
        sqliteDatabaseCount,
      };
    } finally {
      await rm(stagingPath, { force: true, recursive: true });
    }
  }
}
