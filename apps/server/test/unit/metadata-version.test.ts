import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import {
  inspectMetadataVersion,
  supportedMetadataSchemaVersion,
} from "../../src/deployment/metadata-version.js";
import {
  LATEST_METADATA_SCHEMA_VERSION,
  MetadataDatabase,
} from "../../src/metadata/database.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function metadataFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "webeditor-metadata-version-"));
  temporaryDirectories.push(root);
  const path = join(root, "metadata.sqlite");
  new MetadataDatabase(path).close();
  return path;
}

function dataVersion(path: string): unknown {
  const database = new Database(path, { readonly: true });
  try {
    return database.pragma("data_version", { simple: true });
  } finally {
    database.close();
  }
}

describe("deployment metadata version inspection", () => {
  it("opens the production metadata database read-only and proves compatibility", async () => {
    const path = await metadataFixture();
    const before = dataVersion(path);
    const inspection = inspectMetadataVersion(path);
    const after = dataVersion(path);

    expect(inspection).toMatchObject({
      applicationIdValid: true,
      quickCheck: "ok",
      supportedSchemaVersion: LATEST_METADATA_SCHEMA_VERSION,
      userVersion: LATEST_METADATA_SCHEMA_VERSION,
    });
    expect(after).toBe(before);
    expect(supportedMetadataSchemaVersion()).toBe(
      LATEST_METADATA_SCHEMA_VERSION,
    );
  });

  it("rejects a database owned by another application", async () => {
    const root = await mkdtemp(join(tmpdir(), "webeditor-foreign-metadata-"));
    temporaryDirectories.push(root);
    const path = join(root, "metadata.sqlite");
    const database = new Database(path);
    database.pragma("application_id = 123");
    database.pragma("user_version = 1");
    database.close();
    expect(() => inspectMetadataVersion(path)).toThrow("application ID");
  });
});
