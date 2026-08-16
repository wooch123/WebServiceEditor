import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { OfflineBackupService } from "../../src/deployment/offline-backup.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "webeditor-offline-backup-"));
  temporaryDirectories.push(root);
  const metadataDatabasePath = join(
    root,
    "live",
    "metadata",
    "webeditor.sqlite",
  );
  const storageRoot = join(root, "live", "projects");
  const backupRoot = join(root, "system-backups");
  await mkdir(join(storageRoot, "active", "project-a", "assets"), {
    recursive: true,
  });
  await mkdir(join(metadataDatabasePath, ".."), { recursive: true });
  const metadata = new Database(metadataDatabasePath);
  metadata.exec(
    "CREATE TABLE projects (id TEXT PRIMARY KEY); INSERT INTO projects VALUES ('project-a')",
  );
  metadata.close();
  for (const name of ["test.sqlite", "production.sqlite"]) {
    const runtime = new Database(
      join(storageRoot, "active", "project-a", name),
    );
    runtime.exec(
      "CREATE TABLE samples (value TEXT); INSERT INTO samples VALUES ('sentinel')",
    );
    runtime.close();
  }
  await writeFile(
    join(storageRoot, "active", "project-a", "assets", "nested.txt"),
    "asset-sentinel",
  );
  return { root, metadataDatabasePath, storageRoot, backupRoot };
}

describe("offline production backup", () => {
  it("creates, verifies, and drills an isolated full backup", async () => {
    const paths = await fixture();
    const service = new OfflineBackupService({
      ...paths,
      now: () => new Date("2026-08-16T00:00:00.000Z"),
    });
    const manifest = await service.create();
    const verification = await service.verify(manifest.id);
    const drill = await service.restoreDrill(manifest.id);

    expect(manifest.fileCount).toBe(4);
    expect(manifest.contentChecksum).toMatch(/^[a-f0-9]{64}$/u);
    expect(verification).toMatchObject({
      result: "PASS",
      backupId: manifest.id,
      sqliteDatabaseCount: 3,
    });
    expect(drill.contentChecksum).toBe(manifest.contentChecksum);
    expect(
      await readFile(
        join(paths.storageRoot, "active", "project-a", "assets", "nested.txt"),
        "utf8",
      ),
    ).toBe("asset-sentinel");
  });

  it("rejects tampering and symbolic links without changing live data", async () => {
    const paths = await fixture();
    const service = new OfflineBackupService(paths);
    const manifest = await service.create();
    await writeFile(
      join(
        paths.backupRoot,
        manifest.id,
        "payload",
        "projects",
        "active",
        "project-a",
        "assets",
        "nested.txt",
      ),
      "tampered",
    );
    await expect(service.verify(manifest.id)).rejects.toThrow(
      "inventory or checksum",
    );

    await symlink(
      join(paths.root, "outside"),
      join(paths.storageRoot, "active", "project-a", "assets", "link"),
    );
    await expect(service.create()).rejects.toThrow("symbolic link");
  });

  it("rejects recursive or filesystem-root backup targets", async () => {
    const paths = await fixture();
    expect(
      () =>
        new OfflineBackupService({
          ...paths,
          backupRoot: join(paths.storageRoot, "system-backups"),
        }),
    ).toThrow("isolated");
    expect(
      () =>
        new OfflineBackupService({
          ...paths,
          backupRoot: "/",
        }),
    ).toThrow("filesystem root");
  });

  it("captures committed WAL rows through SQLite online backup", async () => {
    const paths = await fixture();
    const runtimePath = join(
      paths.storageRoot,
      "active",
      "project-a",
      "test.sqlite",
    );
    const runtime = new Database(runtimePath);
    runtime.pragma("journal_mode = WAL");
    runtime.prepare("INSERT INTO samples VALUES (?)").run("wal-sentinel");

    const service = new OfflineBackupService(paths);
    const manifest = await service.create();
    runtime.close();
    await expect(service.verify(manifest.id)).resolves.toMatchObject({
      result: "PASS",
    });
    expect(
      manifest.files.some(({ path }) =>
        /(?:\.sqlite|\.db)-(?:wal|shm|journal)$/iu.test(path),
      ),
    ).toBe(false);
    const restored = new Database(
      join(
        paths.backupRoot,
        manifest.id,
        "payload",
        "projects",
        "active",
        "project-a",
        "test.sqlite",
      ),
      { readonly: true },
    );
    try {
      expect(
        (
          restored
            .prepare("SELECT value FROM samples ORDER BY rowid")
            .all() as readonly { readonly value: unknown }[]
        ).map(({ value }) => value),
      ).toEqual(["sentinel", "wal-sentinel"]);
    } finally {
      restored.close();
    }
  });
});
