import type {
  DeletePageImpact,
  PageDto,
  PageType,
  PublishedNavigationPageDto,
  RuntimeNavigationDto,
} from "@webeditor/domain";
import type Database from "better-sqlite3";

import type { MetadataDatabase } from "../metadata/database.js";

export interface PageRow {
  readonly id: string;
  readonly project_id: string;
  readonly schema_version: number;
  readonly revision: number;
  readonly name: string;
  readonly route: string;
  readonly page_type: PageType;
  readonly icon_name: string;
  readonly icon_catalog_version: "1.31.0";
  readonly navigation_visible: 0 | 1;
  readonly navigation_group: string | null;
  readonly sort_order: number;
  readonly created_at: string;
  readonly updated_at: string;
  readonly deleted_at: string | null;
}

export interface PageCommandRow {
  readonly id: string;
  readonly project_id: string;
  readonly page_id: string;
  readonly command_type: "DELETE";
  readonly snapshot_json: string;
  readonly impact_json: string;
  readonly created_at: string;
  readonly undone_at: string | null;
}

export interface DefinitionOperationRow {
  readonly id: string;
  readonly project_id: string;
  readonly operation_type:
    "PAGE_CREATE" | "PAGE_REORDER" | "PAGE_DELETE" | "PAGE_UNDO" | "PUBLISH";
  readonly idempotency_key: string;
  readonly request_hash: string;
  readonly response_status: number;
  readonly response_json: string;
  readonly created_at: string;
}

export interface ProjectVersionRow {
  readonly id: string;
  readonly project_id: string;
  readonly schema_version: number;
  readonly sequence: number;
  readonly source_project_revision: number;
  readonly snapshot_json: string;
  readonly published_at: string;
}

export interface ProjectVersionSnapshot {
  readonly pages: readonly PublishedNavigationPageDto[];
  readonly elements?: readonly unknown[];
  readonly layoutRevisions?: readonly unknown[];
}

const pageColumns = `
  id, project_id, schema_version, revision, name, route, page_type,
  icon_name, icon_catalog_version, navigation_visible, navigation_group,
  sort_order, created_at, updated_at, deleted_at
`;

export class PageRepository {
  constructor(readonly metadataDatabase: MetadataDatabase) {}

  get connection(): Database.Database {
    return this.metadataDatabase.connection;
  }

  listActive(projectId: string): readonly PageRow[] {
    return this.connection
      .prepare(
        `SELECT ${pageColumns} FROM pages
         WHERE project_id = ? AND deleted_at IS NULL
         ORDER BY sort_order, id`,
      )
      .all(projectId) as readonly PageRow[];
  }

  listAll(projectId: string): readonly PageRow[] {
    return this.connection
      .prepare(
        `SELECT ${pageColumns} FROM pages
         WHERE project_id = ? ORDER BY deleted_at IS NOT NULL, sort_order, id`,
      )
      .all(projectId) as readonly PageRow[];
  }

  activeCount(projectId: string): number {
    const row = this.connection
      .prepare(
        "SELECT count(*) AS count FROM pages WHERE project_id = ? AND deleted_at IS NULL",
      )
      .get(projectId) as { readonly count: number };
    return row.count;
  }

  deleteOwnedDefinitions(projectId: string): void {
    this.connection
      .prepare("DELETE FROM project_definition_operations WHERE project_id = ?")
      .run(projectId);
    this.connection
      .prepare("DELETE FROM project_versions WHERE project_id = ?")
      .run(projectId);
    this.connection
      .prepare("DELETE FROM pages WHERE project_id = ?")
      .run(projectId);
  }

  definitionState(projectId: string): Record<string, unknown> {
    const commands = this.connection
      .prepare(
        `SELECT id, project_id, page_id, command_type, snapshot_json,
           impact_json, created_at, undone_at
         FROM page_commands WHERE project_id = ? ORDER BY created_at, id`,
      )
      .all(projectId);
    const versions = this.connection
      .prepare(
        `SELECT id, project_id, schema_version, sequence,
           source_project_revision, snapshot_json, published_at
         FROM project_versions WHERE project_id = ? ORDER BY sequence, id`,
      )
      .all(projectId);
    return {
      pages: this.listAll(projectId),
      commands,
      versions,
    };
  }

  get(pageId: string): PageRow | undefined {
    return this.connection
      .prepare(`SELECT ${pageColumns} FROM pages WHERE id = ?`)
      .get(pageId) as PageRow | undefined;
  }

  getActive(pageId: string): PageRow | undefined {
    return this.connection
      .prepare(
        `SELECT ${pageColumns} FROM pages
         WHERE id = ? AND deleted_at IS NULL`,
      )
      .get(pageId) as PageRow | undefined;
  }

  insert(page: {
    readonly id: string;
    readonly projectId: string;
    readonly name: string;
    readonly route: string;
    readonly pageType: "blank";
    readonly iconName: string;
    readonly sortOrder: number;
    readonly now: string;
  }): PageRow {
    this.connection
      .prepare(
        `INSERT INTO pages (
          id, project_id, schema_version, revision, name, route, page_type,
          icon_name, icon_catalog_version, navigation_visible,
          navigation_group, sort_order, created_at, updated_at
        ) VALUES (?, ?, 1, 1, ?, ?, ?, ?, '1.31.0', 1, NULL, ?, ?, ?)`,
      )
      .run(
        page.id,
        page.projectId,
        page.name,
        page.route,
        page.pageType,
        page.iconName,
        page.sortOrder,
        page.now,
        page.now,
      );
    return this.getRequired(page.id);
  }

  insertImported(
    page: PageDto,
    projectId: string,
    pageId: string,
    now: string,
  ): PageRow {
    this.connection
      .prepare(
        `INSERT INTO pages (
          id, project_id, schema_version, revision, name, route, page_type,
          icon_name, icon_catalog_version, navigation_visible,
          navigation_group, sort_order, created_at, updated_at, deleted_at
        ) VALUES (?, ?, 1, 1, ?, ?, 'blank', ?, '1.31.0', ?, ?, ?, ?, ?, NULL)`,
      )
      .run(
        pageId,
        projectId,
        page.name,
        page.route,
        page.iconName,
        page.navigationVisible ? 1 : 0,
        page.navigationGroup,
        page.sortOrder,
        now,
        now,
      );
    return this.getRequired(pageId);
  }

  patch(
    pageId: string,
    expectedRevision: number,
    patch: {
      readonly name: string;
      readonly route: string;
      readonly navigationVisible: boolean;
      readonly navigationGroup: string | null;
      readonly now: string;
    },
  ): PageRow | undefined {
    const result = this.connection
      .prepare(
        `UPDATE pages SET name = ?, route = ?, navigation_visible = ?,
           navigation_group = ?, revision = revision + 1, updated_at = ?
         WHERE id = ? AND deleted_at IS NULL AND revision = ?`,
      )
      .run(
        patch.name,
        patch.route,
        patch.navigationVisible ? 1 : 0,
        patch.navigationGroup,
        patch.now,
        pageId,
        expectedRevision,
      );
    return result.changes === 1 ? this.getRequired(pageId) : undefined;
  }

  patchIcon(
    pageId: string,
    expectedRevision: number,
    iconName: string,
    now: string,
  ): PageRow | undefined {
    const result = this.connection
      .prepare(
        `UPDATE pages SET icon_name = ?, icon_catalog_version = '1.31.0',
           revision = revision + 1, updated_at = ?
         WHERE id = ? AND deleted_at IS NULL AND revision = ?`,
      )
      .run(iconName, now, pageId, expectedRevision);
    return result.changes === 1 ? this.getRequired(pageId) : undefined;
  }

  reorder(
    projectId: string,
    pageIds: readonly string[],
    now: string,
  ): readonly PageRow[] {
    this.connection
      .prepare(
        `UPDATE pages SET sort_order = sort_order + 1000000
         WHERE project_id = ? AND deleted_at IS NULL`,
      )
      .run(projectId);
    const update = this.connection.prepare(
      `UPDATE pages SET sort_order = ?, revision = revision + 1, updated_at = ?
       WHERE id = ? AND project_id = ? AND deleted_at IS NULL`,
    );
    for (const [sortOrder, pageId] of pageIds.entries()) {
      const result = update.run(sortOrder, now, pageId, projectId);
      if (result.changes !== 1) {
        throw new Error("Page reorder changed during its transaction");
      }
    }
    return this.listActive(projectId);
  }

  tombstone(page: PageRow, deletedAt: string): PageRow {
    const result = this.connection
      .prepare(
        `UPDATE pages SET deleted_at = ?, revision = revision + 1, updated_at = ?
         WHERE id = ? AND deleted_at IS NULL AND revision = ?`,
      )
      .run(deletedAt, deletedAt, page.id, page.revision);
    if (result.changes !== 1) {
      throw new Error("Page changed during delete transaction");
    }
    this.connection
      .prepare(
        `UPDATE pages SET sort_order = sort_order + 1000000
         WHERE project_id = ? AND deleted_at IS NULL AND sort_order > ?`,
      )
      .run(page.project_id, page.sort_order);
    this.connection
      .prepare(
        `UPDATE pages SET sort_order = sort_order - 1000001
         WHERE project_id = ? AND deleted_at IS NULL AND sort_order > 1000000`,
      )
      .run(page.project_id);
    return this.getRequired(page.id);
  }

  createDeleteCommand(command: {
    readonly id: string;
    readonly page: PageDto;
    readonly impact: DeletePageImpact;
    readonly now: string;
  }): void {
    this.connection
      .prepare(
        `INSERT INTO page_commands (
          id, project_id, page_id, command_type, snapshot_json, impact_json,
          created_at
        ) VALUES (?, ?, ?, 'DELETE', ?, ?, ?)`,
      )
      .run(
        command.id,
        command.page.projectId,
        command.page.id,
        JSON.stringify(command.page),
        JSON.stringify(command.impact),
        command.now,
      );
  }

  getDeleteCommand(
    commandId: string,
    projectId: string,
  ): PageCommandRow | undefined {
    return this.connection
      .prepare(
        `SELECT id, project_id, page_id, command_type, snapshot_json,
           impact_json, created_at, undone_at
         FROM page_commands WHERE id = ? AND project_id = ?`,
      )
      .get(commandId, projectId) as PageCommandRow | undefined;
  }

  restoreDeleted(command: PageCommandRow, now: string): PageRow {
    const snapshot = JSON.parse(command.snapshot_json) as PageDto;
    this.connection
      .prepare(
        `UPDATE pages SET sort_order = sort_order + 1000000
         WHERE project_id = ? AND deleted_at IS NULL AND sort_order >= ?`,
      )
      .run(command.project_id, snapshot.sortOrder);
    this.connection
      .prepare(
        `UPDATE pages SET sort_order = sort_order - 999999
         WHERE project_id = ? AND deleted_at IS NULL AND sort_order >= 1000000`,
      )
      .run(command.project_id);
    const restored = this.connection
      .prepare(
        `UPDATE pages SET name = ?, route = ?, page_type = ?, icon_name = ?,
           icon_catalog_version = ?, navigation_visible = ?,
           navigation_group = ?, sort_order = ?, deleted_at = NULL,
           revision = revision + 1, updated_at = ?
         WHERE id = ? AND project_id = ? AND deleted_at IS NOT NULL`,
      )
      .run(
        snapshot.name,
        snapshot.route,
        snapshot.pageType,
        snapshot.iconName,
        snapshot.iconCatalogVersion,
        snapshot.navigationVisible ? 1 : 0,
        snapshot.navigationGroup,
        snapshot.sortOrder,
        now,
        command.page_id,
        command.project_id,
      );
    if (restored.changes !== 1) {
      throw new Error("Deleted page could not be restored");
    }
    this.connection
      .prepare(
        "UPDATE page_commands SET undone_at = ? WHERE id = ? AND undone_at IS NULL",
      )
      .run(now, command.id);
    return this.getRequired(command.page_id);
  }

  bumpProjectRevision(
    projectId: string,
    expectedRevision: number,
    now: string,
    published = false,
  ): number | undefined {
    const result = this.connection
      .prepare(
        `UPDATE projects SET revision = revision + 1, updated_at = ?,
           status = CASE WHEN ? = 1 THEN 'PUBLISHED' ELSE status END
         WHERE id = ? AND lifecycle_status = 'ACTIVE' AND revision = ?`,
      )
      .run(now, published ? 1 : 0, projectId, expectedRevision);
    return result.changes === 1 ? expectedRevision + 1 : undefined;
  }

  findOperation(
    projectId: string,
    idempotencyKey: string,
  ): DefinitionOperationRow | undefined {
    return this.connection
      .prepare(
        `SELECT id, project_id, operation_type, idempotency_key, request_hash,
           response_status, response_json, created_at
         FROM project_definition_operations
         WHERE project_id = ? AND idempotency_key = ?`,
      )
      .get(projectId, idempotencyKey) as DefinitionOperationRow | undefined;
  }

  storeOperation(operation: {
    readonly id: string;
    readonly projectId: string;
    readonly type: DefinitionOperationRow["operation_type"];
    readonly idempotencyKey: string;
    readonly requestHash: string;
    readonly statusCode: number;
    readonly response: unknown;
    readonly now: string;
  }): void {
    this.connection
      .prepare(
        `INSERT INTO project_definition_operations (
          id, project_id, operation_type, idempotency_key, request_hash,
          response_status, response_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        operation.id,
        operation.projectId,
        operation.type,
        operation.idempotencyKey,
        operation.requestHash,
        operation.statusCode,
        JSON.stringify(operation.response),
        operation.now,
      );
  }

  latestVersion(projectId: string): ProjectVersionRow | undefined {
    return this.connection
      .prepare(
        `SELECT id, project_id, schema_version, sequence,
           source_project_revision, snapshot_json, published_at
         FROM project_versions WHERE project_id = ?
         ORDER BY sequence DESC LIMIT 1`,
      )
      .get(projectId) as ProjectVersionRow | undefined;
  }

  listVersions(projectId: string): readonly ProjectVersionRow[] {
    return this.connection
      .prepare(
        `SELECT id, project_id, schema_version, sequence,
           source_project_revision, snapshot_json, published_at
         FROM project_versions WHERE project_id = ?
         ORDER BY sequence, id`,
      )
      .all(projectId) as readonly ProjectVersionRow[];
  }

  insertVersion(version: {
    readonly id: string;
    readonly projectId: string;
    readonly sourceProjectRevision: number;
    readonly snapshot: ProjectVersionSnapshot;
    readonly now: string;
  }): ProjectVersionRow {
    const latest = this.latestVersion(version.projectId);
    const sequence = (latest?.sequence ?? 0) + 1;
    this.connection
      .prepare(
        `INSERT INTO project_versions (
          id, project_id, schema_version, sequence, source_project_revision,
          snapshot_json, published_at
        ) VALUES (?, ?, 1, ?, ?, ?, ?)`,
      )
      .run(
        version.id,
        version.projectId,
        sequence,
        version.sourceProjectRevision,
        JSON.stringify(version.snapshot),
        version.now,
      );
    return this.latestVersion(version.projectId) as ProjectVersionRow;
  }

  insertImportedVersion(version: {
    readonly id: string;
    readonly projectId: string;
    readonly sequence: number;
    readonly sourceProjectRevision: number;
    readonly snapshot: ProjectVersionSnapshot;
    readonly publishedAt: string;
  }): void {
    this.connection
      .prepare(
        `INSERT INTO project_versions (
          id, project_id, schema_version, sequence, source_project_revision,
          snapshot_json, published_at
        ) VALUES (?, ?, 1, ?, ?, ?, ?)`,
      )
      .run(
        version.id,
        version.projectId,
        version.sequence,
        version.sourceProjectRevision,
        JSON.stringify(version.snapshot),
        version.publishedAt,
      );
  }

  markProjectPublished(projectId: string): void {
    this.connection
      .prepare("UPDATE projects SET status = 'PUBLISHED' WHERE id = ?")
      .run(projectId);
  }

  toDto(row: PageRow): PageDto {
    return {
      id: row.id,
      projectId: row.project_id,
      schemaVersion: row.schema_version,
      revision: row.revision,
      name: row.name,
      route: row.route,
      pageType: row.page_type,
      iconName: row.icon_name,
      iconCatalogVersion: row.icon_catalog_version,
      navigationVisible: row.navigation_visible === 1,
      navigationGroup: row.navigation_group,
      sortOrder: row.sort_order,
      deletedAt: row.deleted_at,
    };
  }

  toPublishedPage(row: PageRow): PublishedNavigationPageDto {
    const page = this.toDto(row);
    return {
      id: page.id,
      name: page.name,
      route: page.route,
      sortOrder: page.sortOrder,
      iconName: page.iconName,
      iconCatalogVersion: page.iconCatalogVersion,
      navigationVisible: page.navigationVisible,
      navigationGroup: page.navigationGroup,
    };
  }

  toRuntimeNavigation(version: ProjectVersionRow): RuntimeNavigationDto {
    const snapshot = this.versionSnapshot(version);
    return {
      projectId: version.project_id,
      versionId: version.id,
      publishedAt: version.published_at,
      pages: snapshot.pages,
    };
  }

  versionSnapshot(version: ProjectVersionRow): ProjectVersionSnapshot {
    return JSON.parse(version.snapshot_json) as ProjectVersionSnapshot;
  }

  getRequired(pageId: string): PageRow {
    const row = this.get(pageId);
    if (row === undefined) {
      throw new Error(`Page ${pageId} disappeared during a transaction`);
    }
    return row;
  }
}
