import { describe, expect, it } from "vitest";

import { MetadataDatabase } from "../../src/metadata/database.js";
import { PageRepository } from "../../src/pages/page-repository.js";
import { ProjectRepository } from "../../src/projects/project-repository.js";

const now = "2026-08-16T00:00:00.000Z";
const firstProjectId = "00000000-0000-4000-8000-000000000001";
const firstPageId = "00000000-0000-4000-8000-000000000002";
const secondProjectId = "00000000-0000-4000-8000-000000000003";
const secondPageId = "00000000-0000-4000-8000-000000000004";
const elementId = "00000000-0000-4000-8000-000000000005";

function insertElement(
  database: MetadataDatabase,
  id: string,
  projectId: string,
  pageId: string,
): void {
  database.connection
    .prepare(
      `INSERT INTO elements (
         id, project_id, page_id, type, type_version, name, props_json,
         style_json, events_json, locked, hidden, revision, created_at,
         updated_at
       ) VALUES (?, ?, ?, 'text', 1, 'Text', '{}', '{}', '[]', 0, 0, 1, ?, ?)`,
    )
    .run(id, projectId, pageId, now, now);
}

function insertLayout(
  database: MetadataDatabase,
  input: {
    readonly elementId?: string;
    readonly projectId?: string;
    readonly pageId?: string;
    readonly x?: number;
    readonly w?: number;
    readonly maxW?: number;
  } = {},
): void {
  database.connection
    .prepare(
      `INSERT INTO element_layouts (
         element_id, project_id, page_id, breakpoint, x, y, w, h,
         min_w, min_h, max_w, max_h
       ) VALUES (?, ?, ?, 'desktop', ?, 0, ?, 5, 2, 3, ?, 20)`,
    )
    .run(
      input.elementId ?? elementId,
      input.projectId ?? firstProjectId,
      input.pageId ?? firstPageId,
      input.x ?? 0,
      input.w ?? 6,
      input.maxW ?? 24,
    );
}

describe("SQLite v5 Element constraints and ownership", () => {
  it("rejects cross-Project/Page ownership and non-integer or out-of-bound geometry", () => {
    const database = new MetadataDatabase(":memory:");
    const projects = new ProjectRepository(database);
    const pages = new PageRepository(database);
    try {
      for (const [projectId, name, slug] of [
        [firstProjectId, "First", "first"],
        [secondProjectId, "Second", "second"],
      ] as const) {
        projects.insert({
          id: projectId,
          name,
          slug,
          description: null,
          favorite: false,
          themeId: "light-clean-paper",
          now,
        });
      }
      pages.insert({
        id: firstPageId,
        projectId: firstProjectId,
        name: "First Page",
        route: "/first",
        pageType: "blank",
        iconName: "File",
        sortOrder: 0,
        now,
      });
      pages.insert({
        id: secondPageId,
        projectId: secondProjectId,
        name: "Second Page",
        route: "/second",
        pageType: "blank",
        iconName: "File",
        sortOrder: 0,
        now,
      });

      expect(() =>
        insertElement(
          database,
          "00000000-0000-4000-8000-000000000006",
          secondProjectId,
          firstPageId,
        ),
      ).toThrow(/constraint/iu);
      insertElement(database, elementId, firstProjectId, firstPageId);
      expect(() =>
        insertLayout(database, {
          projectId: secondProjectId,
          pageId: secondPageId,
        }),
      ).toThrow(/constraint/iu);
      expect(() => insertLayout(database, { x: 0.5 })).toThrow(/constraint/iu);
      expect(() => insertLayout(database, { x: 21, w: 4 })).toThrow(
        /constraint/iu,
      );
      expect(() => insertLayout(database, { maxW: 25 })).toThrow(
        /constraint/iu,
      );
      expect(database.connection.pragma("foreign_key_check")).toEqual([]);
    } finally {
      database.close();
    }
  });

  it("accepts deterministic 4xx command evidence but rejects 5xx and invalid JSON", () => {
    const database = new MetadataDatabase(":memory:");
    const projects = new ProjectRepository(database);
    const pages = new PageRepository(database);
    try {
      projects.insert({
        id: firstProjectId,
        name: "Commands",
        slug: "commands",
        description: null,
        favorite: false,
        themeId: "light-clean-paper",
        now,
      });
      pages.insert({
        id: firstPageId,
        projectId: firstProjectId,
        name: "Commands Page",
        route: "/commands",
        pageType: "blank",
        iconName: "File",
        sortOrder: 0,
        now,
      });
      insertElement(database, elementId, firstProjectId, firstPageId);
      insertLayout(database);
      const insertCommand = database.connection.prepare(
        `INSERT INTO element_commands (
           id, project_id, page_id, element_id, command_type,
           idempotency_key, request_hash, before_json, after_json,
           response_status, response_json, before_layout_revision,
           after_layout_revision, created_at
         ) VALUES (?, ?, ?, ?, 'MOVE', ?, 'hash', ?, '{}', ?, '{}', 0, 0, ?)`,
      );
      expect(() =>
        insertCommand.run(
          "00000000-0000-4000-8000-000000000007",
          firstProjectId,
          firstPageId,
          elementId,
          "server-5xx",
          null,
          500,
          now,
        ),
      ).toThrow(/constraint/iu);
      expect(() =>
        insertCommand.run(
          "00000000-0000-4000-8000-000000000008",
          firstProjectId,
          firstPageId,
          elementId,
          "invalid-json",
          "not-json",
          409,
          now,
        ),
      ).toThrow(/constraint/iu);
      expect(() =>
        insertCommand.run(
          "00000000-0000-4000-8000-000000000009",
          firstProjectId,
          firstPageId,
          elementId,
          "deterministic-4xx",
          null,
          409,
          now,
        ),
      ).not.toThrow();
      expect(
        database.connection
          .prepare(
            `SELECT history_state, history_sequence, history_updated_at
             FROM element_commands WHERE id = ?`,
          )
          .get("00000000-0000-4000-8000-000000000009"),
      ).toEqual({
        history_state: null,
        history_sequence: null,
        history_updated_at: null,
      });
    } finally {
      database.close();
    }
  });

  it("delegates Element type membership to the executable Registry while constraining history columns", () => {
    const database = new MetadataDatabase(":memory:");
    try {
      const elementSql = (
        database.connection
          .prepare(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'elements'",
          )
          .get() as { sql: string }
      ).sql;
      const commandSql = (
        database.connection
          .prepare(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'element_commands'",
          )
          .get() as { sql: string }
      ).sql;
      expect(elementSql).not.toMatch(/type\s+IN\s*\(/iu);
      expect(elementSql).toContain("length(type) BETWEEN 1 AND 120");
      expect(commandSql).toContain("'PROPERTIES'");
      expect(commandSql).toContain("history_sequence");
      expect(commandSql).toContain("'DISCARDED'");
    } finally {
      database.close();
    }
  });
});
