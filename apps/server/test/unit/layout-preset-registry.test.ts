import { randomUUID } from "node:crypto";

import type { LayoutPresetDefinition } from "@webeditor/domain";
import { afterEach, describe, expect, it } from "vitest";

import { LayoutPresetService } from "../../src/elements/layout-preset-service.js";
import {
  layoutPresetDefinition,
  validateLayoutPresetDefinitionSnapshot,
} from "../../src/elements/layout-preset-registry.js";
import { MetadataDatabase } from "../../src/metadata/database.js";
import { PageRepository } from "../../src/pages/page-repository.js";
import { ProjectRepository } from "../../src/projects/project-repository.js";

const databases: MetadataDatabase[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function serviceFixture(): {
  readonly database: MetadataDatabase;
  readonly service: LayoutPresetService;
  readonly projectId: string;
  readonly pageId: string;
} {
  const database = new MetadataDatabase(":memory:");
  databases.push(database);
  const projectId = randomUUID();
  const pageId = randomUUID();
  const now = "2026-08-16T00:00:00.000Z";
  new ProjectRepository(database).insert({
    id: projectId,
    name: "Preset Unit",
    slug: `preset-unit-${projectId.slice(0, 8)}`,
    description: null,
    favorite: false,
    themeId: "light-clean-paper",
    now,
  });
  new PageRepository(database).insert({
    id: pageId,
    projectId,
    name: "Page",
    route: "/page",
    pageType: "blank",
    iconName: "File",
    sortOrder: 0,
    now,
  });
  return {
    database,
    service: new LayoutPresetService({ metadataDatabase: database }),
    projectId,
    pageId,
  };
}

describe("Layout Preset Registry and immutable snapshots", () => {
  it("rejects duplicate stable suggestedSchema table and field IDs plus executable fields", () => {
    const duplicateTable = structuredClone(
      layoutPresetDefinition("data-entry"),
    ) as LayoutPresetDefinition;
    const tables = duplicateTable.suggestedSchema?.tables;
    expect(tables).toBeDefined();
    (tables as unknown as unknown[]).push(structuredClone(tables?.[0]));
    expect(() =>
      validateLayoutPresetDefinitionSnapshot(duplicateTable),
    ).toThrow("Suggested table is invalid");

    const duplicateField = structuredClone(
      layoutPresetDefinition("data-entry"),
    ) as LayoutPresetDefinition;
    const fields = duplicateField.suggestedSchema?.tables[0]?.fields;
    expect(fields).toBeDefined();
    (fields as unknown as unknown[]).push(structuredClone(fields?.[0]));
    expect(() =>
      validateLayoutPresetDefinitionSnapshot(duplicateField),
    ).toThrow("Suggested field is invalid");

    const executable = structuredClone(
      layoutPresetDefinition("data-entry"),
    ) as LayoutPresetDefinition;
    const mutableSchema = executable.suggestedSchema as unknown as Record<
      string,
      unknown
    >;
    mutableSchema.sql = "DROP TABLE measurements";
    expect(() => validateLayoutPresetDefinitionSnapshot(executable)).toThrow(
      "Suggested schema fields are invalid",
    );
  });

  it("rejects server-owned coordinate snapshot tampering before any write", () => {
    const { database, service, projectId, pageId } = serviceFixture();
    const { preview } = service.preview(pageId, "blank-grid", {
      mode: "ADD",
      expectedLayoutRevision: 0,
      expectedProjectRevision: 1,
    });
    const stored = service.previewStore.consume({
      previewId: preview.previewId,
      projectId,
      pageId,
      presetId: "blank-grid",
      expectedLayoutRevision: 0,
      expectedProjectRevision: 1,
    });
    (stored as { coordinateChecksum: string }).coordinateChecksum = "0".repeat(
      64,
    );
    service.previewStore.release(preview.previewId);
    expect(() =>
      service.apply(pageId, "blank-grid", {
        previewId: preview.previewId,
        expectedLayoutRevision: 0,
        expectedProjectRevision: 1,
        idempotencyKey: `tampered-${randomUUID()}`,
      }),
    ).toThrow(
      expect.objectContaining({ code: "LAYOUT_PRESET_PREVIEW_TAMPERED" }),
    );
    expect(
      database.connection
        .prepare(
          `SELECT
             (SELECT count(*) FROM elements) AS elements,
             (SELECT count(*) FROM layout_preset_instances) AS instances`,
        )
        .get(),
    ).toEqual({ elements: 0, instances: 0 });
  });

  it("reads the exact stored v1 definition after a simulated future Registry checksum drift and fails closed on snapshot tamper", () => {
    const { database, service, pageId } = serviceFixture();
    const { preview } = service.preview(pageId, "blank-grid", {
      mode: "ADD",
      expectedLayoutRevision: 0,
      expectedProjectRevision: 1,
    });
    const applied = service.apply(pageId, "blank-grid", {
      previewId: preview.previewId,
      expectedLayoutRevision: 0,
      expectedProjectRevision: 1,
      idempotencyKey: `drift-${randomUUID()}`,
    });
    const historicalChecksum = "f".repeat(64);
    database.connection
      .prepare(
        "UPDATE layout_preset_instances SET registry_checksum = ? WHERE id = ?",
      )
      .run(historicalChecksum, applied.instance.id);
    const reloaded = new LayoutPresetService({ metadataDatabase: database });
    expect(reloaded.instances(pageId).instances[0]).toMatchObject({
      id: applied.instance.id,
      registryChecksum: historicalChecksum,
      presetSnapshot: applied.instance.presetSnapshot,
      coordinateChecksum: applied.coordinateChecksum,
    });

    const snapshot = structuredClone(
      applied.instance.presetSnapshot,
    ) as unknown as Record<string, unknown>;
    snapshot.unexpected = true;
    database.connection
      .prepare(
        "UPDATE layout_preset_instances SET preset_snapshot_json = ? WHERE id = ?",
      )
      .run(JSON.stringify(snapshot), applied.instance.id);
    expect(
      () => new LayoutPresetService({ metadataDatabase: database }),
    ).toThrow("snapshot fields are invalid");
  });
});
