import type {
  BatchLayoutItem,
  ElementCommandSummaryDto,
  ElementCommandType,
  ElementDefinition,
  ElementDto,
  ElementEntryDto,
  ElementLayoutDto,
  ElementType,
} from "@webeditor/domain";
import type Database from "better-sqlite3";

import type { MetadataDatabase } from "../metadata/database.js";
import {
  elementDefinition,
  validateElementStoredState,
} from "./element-registry.js";

export interface ElementRow {
  readonly id: string;
  readonly project_id: string;
  readonly page_id: string;
  readonly type: ElementType;
  readonly type_version: 1;
  readonly name: string;
  readonly props_json: string;
  readonly style_json: string;
  readonly events_json: string;
  readonly locked: 0 | 1;
  readonly hidden: 0 | 1;
  readonly revision: number;
  readonly created_at: string;
  readonly updated_at: string;
  readonly deleted_at: string | null;
}

export interface ElementLayoutRow {
  readonly element_id: string;
  readonly project_id: string;
  readonly page_id: string;
  readonly breakpoint: "desktop";
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly min_w: number;
  readonly min_h: number;
  readonly max_w: number;
  readonly max_h: number;
}

export interface ElementCommandRow {
  readonly id: string;
  readonly project_id: string;
  readonly page_id: string;
  readonly element_id: string | null;
  readonly command_type: ElementCommandType;
  readonly idempotency_key: string;
  readonly request_hash: string;
  readonly before_json: string | null;
  readonly after_json: string | null;
  readonly response_status: number;
  readonly response_json: string;
  readonly before_layout_revision: number;
  readonly after_layout_revision: number;
  readonly history_state: "APPLIED" | "UNDONE" | "DISCARDED" | null;
  readonly history_sequence: number | null;
  readonly history_updated_at: string | null;
  readonly created_at: string;
}

export interface ElementHistoryOperationRow {
  readonly id: string;
  readonly project_id: string;
  readonly command_id: string | null;
  readonly requested_command_id: string;
  readonly operation_type: "UNDO" | "REDO";
  readonly idempotency_key: string;
  readonly request_hash: string;
  readonly response_status: number;
  readonly response_json: string;
  readonly created_at: string;
}

const elementColumns = `
  id, project_id, page_id, type, type_version, name, props_json, style_json,
  events_json, locked, hidden, revision, created_at, updated_at, deleted_at
`;
const layoutColumns = `
  element_id, project_id, page_id, breakpoint, x, y, w, h,
  min_w, min_h, max_w, max_h
`;
const commandColumns = `
  id, project_id, page_id, element_id, command_type, idempotency_key,
  request_hash, before_json, after_json, response_status, response_json,
  before_layout_revision, after_layout_revision, history_state,
  history_sequence, history_updated_at, created_at
`;

export class ElementRepository {
  constructor(readonly metadataDatabase: MetadataDatabase) {}

  get connection(): Database.Database {
    return this.metadataDatabase.connection;
  }

  layoutRevision(pageId: string): number | undefined {
    const row = this.connection
      .prepare(
        "SELECT desktop_revision FROM page_layout_revisions WHERE page_id = ?",
      )
      .get(pageId) as { readonly desktop_revision: number } | undefined;
    return row?.desktop_revision;
  }

  listActive(pageId: string): readonly ElementEntryDto[] {
    const rows = this.connection
      .prepare(
        `SELECT
           e.id, e.project_id, e.page_id, e.type, e.type_version, e.name,
           e.props_json, e.style_json, e.events_json, e.locked, e.hidden,
           e.revision, e.created_at, e.updated_at, e.deleted_at,
           l.element_id AS layout_element_id, l.breakpoint, l.x, l.y, l.w,
           l.h, l.min_w, l.min_h, l.max_w, l.max_h
         FROM elements e
         JOIN element_layouts l
           ON l.element_id = e.id AND l.breakpoint = 'desktop'
         WHERE e.page_id = ? AND e.deleted_at IS NULL
         ORDER BY l.y, l.x, e.created_at, e.id`,
      )
      .all(pageId) as readonly (ElementRow & {
      readonly layout_element_id: string;
      readonly breakpoint: "desktop";
      readonly x: number;
      readonly y: number;
      readonly w: number;
      readonly h: number;
      readonly min_w: number;
      readonly min_h: number;
      readonly max_w: number;
      readonly max_h: number;
    })[];
    return rows.map((row) => ({
      element: this.toElementDto(row),
      layout: {
        elementId: row.layout_element_id,
        breakpoint: row.breakpoint,
        x: row.x,
        y: row.y,
        w: row.w,
        h: row.h,
        minW: row.min_w,
        minH: row.min_h,
        maxW: row.max_w,
        maxH: row.max_h,
      },
    }));
  }

  listActiveForProject(projectId: string): readonly ElementEntryDto[] {
    const pageIds = this.connection
      .prepare(
        `SELECT id FROM pages
         WHERE project_id = ? AND deleted_at IS NULL ORDER BY sort_order, id`,
      )
      .all(projectId) as readonly { readonly id: string }[];
    return pageIds.flatMap(({ id }) => this.listActive(id));
  }

  activeCountForProject(projectId: string): number {
    const row = this.connection
      .prepare(
        `SELECT count(*) AS count FROM elements e
         JOIN pages p ON p.id = e.page_id
         WHERE e.project_id = ? AND e.deleted_at IS NULL AND p.deleted_at IS NULL`,
      )
      .get(projectId) as { readonly count: number };
    return row.count;
  }

  activeCountForPage(pageId: string): number {
    const row = this.connection
      .prepare(
        "SELECT count(*) AS count FROM elements WHERE page_id = ? AND deleted_at IS NULL",
      )
      .get(pageId) as { readonly count: number };
    return row.count;
  }

  get(elementId: string): ElementRow | undefined {
    return this.connection
      .prepare(`SELECT ${elementColumns} FROM elements WHERE id = ?`)
      .get(elementId) as ElementRow | undefined;
  }

  getActive(elementId: string): ElementRow | undefined {
    return this.connection
      .prepare(
        `SELECT ${elementColumns} FROM elements
         WHERE id = ? AND deleted_at IS NULL`,
      )
      .get(elementId) as ElementRow | undefined;
  }

  getLayout(elementId: string): ElementLayoutRow | undefined {
    return this.connection
      .prepare(
        `SELECT ${layoutColumns} FROM element_layouts
         WHERE element_id = ? AND breakpoint = 'desktop'`,
      )
      .get(elementId) as ElementLayoutRow | undefined;
  }

  getEntry(elementId: string): ElementEntryDto | undefined {
    const element = this.getActive(elementId);
    const layout = this.getLayout(elementId);
    if (element === undefined || layout === undefined) return undefined;
    return {
      element: this.toElementDto(element),
      layout: this.toLayoutDto(layout),
    };
  }

  insert(input: {
    readonly id: string;
    readonly projectId: string;
    readonly pageId: string;
    readonly definition: ElementDefinition;
    readonly x: number;
    readonly y: number;
    readonly now: string;
  }): ElementEntryDto {
    const { definition } = input;
    this.connection
      .prepare(
        `INSERT INTO elements (
           id, project_id, page_id, type, type_version, name, props_json,
           style_json, events_json, locked, hidden, revision, created_at,
           updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 1, ?, ?)`,
      )
      .run(
        input.id,
        input.projectId,
        input.pageId,
        definition.type,
        definition.typeVersion,
        definition.defaultName,
        JSON.stringify(definition.defaultProps),
        JSON.stringify(definition.defaultStyle),
        JSON.stringify(definition.defaultEvents),
        input.now,
        input.now,
      );
    this.connection
      .prepare(
        `INSERT INTO element_layouts (
           element_id, project_id, page_id, breakpoint, x, y, w, h,
           min_w, min_h, max_w, max_h
         ) VALUES (?, ?, ?, 'desktop', ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.projectId,
        input.pageId,
        input.x,
        input.y,
        definition.layout.defaultW,
        definition.layout.defaultH,
        definition.layout.minW,
        definition.layout.minH,
        definition.layout.maxW,
        definition.layout.maxH,
      );
    return this.getEntry(input.id) as ElementEntryDto;
  }

  insertImported(input: {
    readonly entry: ElementEntryDto;
    readonly id: string;
    readonly pageId: string;
    readonly projectId: string;
    readonly now: string;
  }): void {
    const { element, layout } = input.entry;
    this.connection
      .prepare(
        `INSERT INTO elements (
           id, project_id, page_id, type, type_version, name, props_json,
           style_json, events_json, locked, hidden, revision, created_at,
           updated_at
         ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(
        input.id,
        input.projectId,
        input.pageId,
        element.type,
        element.name,
        JSON.stringify(element.props),
        JSON.stringify(element.style),
        JSON.stringify(element.events),
        element.locked ? 1 : 0,
        element.hidden ? 1 : 0,
        input.now,
        input.now,
      );
    this.connection
      .prepare(
        `INSERT INTO element_layouts (
           element_id, project_id, page_id, breakpoint, x, y, w, h,
           min_w, min_h, max_w, max_h
         ) VALUES (?, ?, ?, 'desktop', ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.projectId,
        input.pageId,
        layout.x,
        layout.y,
        layout.w,
        layout.h,
        layout.minW,
        layout.minH,
        layout.maxW,
        layout.maxH,
      );
  }

  setImportedLayoutRevision(
    pageId: string,
    revision: number,
    now: string,
  ): void {
    this.connection
      .prepare(
        `UPDATE page_layout_revisions
         SET desktop_revision = ?, updated_at = ? WHERE page_id = ?`,
      )
      .run(revision, now, pageId);
  }

  updateLayout(
    elementId: string,
    expectedRevision: number,
    layout: {
      readonly x: number;
      readonly y: number;
      readonly w: number;
      readonly h: number;
    },
    now: string,
  ): ElementEntryDto | undefined {
    const changed = this.connection
      .prepare(
        `UPDATE elements SET revision = revision + 1, updated_at = ?
         WHERE id = ? AND revision = ? AND deleted_at IS NULL`,
      )
      .run(now, elementId, expectedRevision);
    if (changed.changes !== 1) return undefined;
    this.connection
      .prepare(
        `UPDATE element_layouts SET x = ?, y = ?, w = ?, h = ?
         WHERE element_id = ? AND breakpoint = 'desktop'`,
      )
      .run(layout.x, layout.y, layout.w, layout.h, elementId);
    return this.getEntry(elementId);
  }

  setLocked(
    elementId: string,
    expectedRevision: number,
    locked: boolean,
    now: string,
  ): ElementEntryDto | undefined {
    const changed = this.connection
      .prepare(
        `UPDATE elements SET locked = ?, revision = revision + 1, updated_at = ?
         WHERE id = ? AND revision = ? AND deleted_at IS NULL`,
      )
      .run(locked ? 1 : 0, now, elementId, expectedRevision);
    return changed.changes === 1 ? this.getEntry(elementId) : undefined;
  }

  updateProperties(
    elementId: string,
    expectedRevision: number,
    value: {
      readonly name: string;
      readonly props: Readonly<Record<string, unknown>>;
      readonly style: Readonly<Record<string, unknown>>;
      readonly locked: boolean;
      readonly hidden: boolean;
    },
    now: string,
  ): ElementEntryDto | undefined {
    const changed = this.connection
      .prepare(
        `UPDATE elements
         SET name = ?, props_json = ?, style_json = ?, locked = ?, hidden = ?,
             revision = revision + 1, updated_at = ?
         WHERE id = ? AND revision = ? AND deleted_at IS NULL`,
      )
      .run(
        value.name,
        JSON.stringify(value.props),
        JSON.stringify(value.style),
        value.locked ? 1 : 0,
        value.hidden ? 1 : 0,
        now,
        elementId,
        expectedRevision,
      );
    return changed.changes === 1 ? this.getEntry(elementId) : undefined;
  }

  applyHistoryEntry(
    snapshot: ElementEntryDto,
    shouldBeActive: boolean,
    now: string,
  ): ElementEntryDto | undefined {
    const current = this.get(snapshot.element.id);
    if (current === undefined) return undefined;
    const changed = this.connection
      .prepare(
        `UPDATE elements
         SET name = ?, props_json = ?, style_json = ?, events_json = ?,
             locked = ?, hidden = ?, deleted_at = ?, revision = revision + 1,
             updated_at = ?
         WHERE id = ? AND revision = ?`,
      )
      .run(
        snapshot.element.name,
        JSON.stringify(snapshot.element.props),
        JSON.stringify(snapshot.element.style),
        JSON.stringify(snapshot.element.events),
        snapshot.element.locked ? 1 : 0,
        snapshot.element.hidden ? 1 : 0,
        shouldBeActive ? null : now,
        now,
        snapshot.element.id,
        current.revision,
      );
    if (changed.changes !== 1) return undefined;
    this.connection
      .prepare(
        `UPDATE element_layouts
         SET x = ?, y = ?, w = ?, h = ?, min_w = ?, min_h = ?,
             max_w = ?, max_h = ?
         WHERE element_id = ? AND breakpoint = 'desktop'`,
      )
      .run(
        snapshot.layout.x,
        snapshot.layout.y,
        snapshot.layout.w,
        snapshot.layout.h,
        snapshot.layout.minW,
        snapshot.layout.minH,
        snapshot.layout.maxW,
        snapshot.layout.maxH,
        snapshot.element.id,
      );
    return shouldBeActive ? this.getEntry(snapshot.element.id) : undefined;
  }

  updateBatch(items: readonly BatchLayoutItem[], now: string): void {
    const updateElement = this.connection.prepare(
      `UPDATE elements SET revision = revision + 1, updated_at = ?
       WHERE id = ? AND revision = ? AND deleted_at IS NULL`,
    );
    const updateLayout = this.connection.prepare(
      `UPDATE element_layouts SET x = ?, y = ?, w = ?, h = ?
       WHERE element_id = ? AND breakpoint = 'desktop'`,
    );
    for (const item of items) {
      if (
        updateElement.run(now, item.elementId, item.expectedRevision)
          .changes !== 1
      ) {
        throw new Error("Element batch changed during its transaction");
      }
      updateLayout.run(item.x, item.y, item.w, item.h, item.elementId);
    }
  }

  tombstone(elementId: string, expectedRevision: number, now: string): boolean {
    return (
      this.connection
        .prepare(
          `UPDATE elements SET deleted_at = ?, revision = revision + 1,
             updated_at = ?
           WHERE id = ? AND revision = ? AND deleted_at IS NULL`,
        )
        .run(now, now, elementId, expectedRevision).changes === 1
    );
  }

  bumpLayoutRevision(
    pageId: string,
    expectedRevision: number,
    now: string,
  ): number | undefined {
    const result = this.connection
      .prepare(
        `UPDATE page_layout_revisions
         SET desktop_revision = desktop_revision + 1, updated_at = ?
         WHERE page_id = ? AND desktop_revision = ?`,
      )
      .run(now, pageId, expectedRevision);
    return result.changes === 1 ? expectedRevision + 1 : undefined;
  }

  bumpProjectRevision(
    projectId: string,
    expectedRevision: number,
    now: string,
  ): number | undefined {
    const result = this.connection
      .prepare(
        `UPDATE projects SET revision = revision + 1, updated_at = ?
         WHERE id = ? AND lifecycle_status = 'ACTIVE' AND revision = ?`,
      )
      .run(now, projectId, expectedRevision);
    return result.changes === 1 ? expectedRevision + 1 : undefined;
  }

  findCommand(
    projectId: string,
    idempotencyKey: string,
  ): ElementCommandRow | undefined {
    return this.connection
      .prepare(
        `SELECT ${commandColumns}
         FROM element_commands WHERE project_id = ? AND idempotency_key = ?`,
      )
      .get(projectId, idempotencyKey) as ElementCommandRow | undefined;
  }

  storeCommand(command: {
    readonly id: string;
    readonly projectId: string;
    readonly pageId: string;
    readonly elementId: string | null;
    readonly type: ElementCommandRow["command_type"];
    readonly idempotencyKey: string;
    readonly requestHash: string;
    readonly before: unknown;
    readonly after: unknown;
    readonly responseStatus: number;
    readonly response: unknown;
    readonly beforeLayoutRevision: number;
    readonly afterLayoutRevision: number;
    readonly now: string;
  }): void {
    const successful =
      command.responseStatus >= 200 && command.responseStatus < 300;
    let historySequence: number | null = null;
    if (successful) {
      this.connection
        .prepare(
          `UPDATE element_commands
           SET history_state = 'DISCARDED', history_updated_at = ?
           WHERE project_id = ? AND history_state = 'UNDONE'`,
        )
        .run(command.now, command.projectId);
      const row = this.connection
        .prepare(
          `SELECT coalesce(max(history_sequence), 0) + 1 AS next_sequence
           FROM element_commands WHERE project_id = ?`,
        )
        .get(command.projectId) as { readonly next_sequence: number };
      historySequence = row.next_sequence;
    }
    this.connection
      .prepare(
        `INSERT INTO element_commands (
           id, project_id, page_id, element_id, command_type,
           idempotency_key, request_hash, before_json, after_json,
           response_status, response_json, before_layout_revision,
           after_layout_revision, history_state, history_sequence,
           history_updated_at, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        command.id,
        command.projectId,
        command.pageId,
        command.elementId,
        command.type,
        command.idempotencyKey,
        command.requestHash,
        command.before === null ? null : JSON.stringify(command.before),
        command.after === null ? null : JSON.stringify(command.after),
        command.responseStatus,
        JSON.stringify(command.response),
        command.beforeLayoutRevision,
        command.afterLayoutRevision,
        successful ? "APPLIED" : null,
        historySequence,
        successful ? command.now : null,
        command.now,
      );
  }

  listHistory(projectId: string): readonly ElementCommandRow[] {
    return this.connection
      .prepare(
        `SELECT ${commandColumns} FROM element_commands
         WHERE project_id = ? AND history_state IS NOT NULL
         ORDER BY history_sequence`,
      )
      .all(projectId) as readonly ElementCommandRow[];
  }

  undoCommand(projectId: string): ElementCommandRow | undefined {
    return this.connection
      .prepare(
        `SELECT ${commandColumns} FROM element_commands
         WHERE project_id = ? AND history_state = 'APPLIED'
         ORDER BY history_sequence DESC LIMIT 1`,
      )
      .get(projectId) as ElementCommandRow | undefined;
  }

  redoCommand(projectId: string): ElementCommandRow | undefined {
    const cursor = this.connection
      .prepare(
        `SELECT coalesce(max(history_sequence), 0) AS cursor
         FROM element_commands
         WHERE project_id = ? AND history_state = 'APPLIED'`,
      )
      .get(projectId) as { readonly cursor: number };
    return this.connection
      .prepare(
        `SELECT ${commandColumns} FROM element_commands
         WHERE project_id = ? AND history_state = 'UNDONE'
           AND history_sequence > ?
         ORDER BY history_sequence LIMIT 1`,
      )
      .get(projectId, cursor.cursor) as ElementCommandRow | undefined;
  }

  setHistoryState(
    commandId: string,
    expectedState: "APPLIED" | "UNDONE",
    nextState: "APPLIED" | "UNDONE",
    now: string,
  ): boolean {
    return (
      this.connection
        .prepare(
          `UPDATE element_commands SET history_state = ?, history_updated_at = ?
           WHERE id = ? AND history_state = ?`,
        )
        .run(nextState, now, commandId, expectedState).changes === 1
    );
  }

  toCommandSummary(row: ElementCommandRow): ElementCommandSummaryDto {
    if (row.history_state === null || row.history_sequence === null) {
      throw new Error(`Command ${row.id} is not part of Element history`);
    }
    return {
      id: row.id,
      pageId: row.page_id,
      elementId: row.element_id,
      type: row.command_type,
      state: row.history_state,
      sequence: row.history_sequence,
      createdAt: row.created_at,
    };
  }

  findHistoryOperation(
    projectId: string,
    idempotencyKey: string,
  ): ElementHistoryOperationRow | undefined {
    return this.connection
      .prepare(
        `SELECT id, project_id, command_id, requested_command_id,
           operation_type, idempotency_key, request_hash, response_status,
           response_json, created_at
         FROM element_history_operations
         WHERE project_id = ? AND idempotency_key = ?`,
      )
      .get(projectId, idempotencyKey) as ElementHistoryOperationRow | undefined;
  }

  storeHistoryOperation(operation: {
    readonly id: string;
    readonly projectId: string;
    readonly commandId: string | null;
    readonly requestedCommandId: string;
    readonly type: "UNDO" | "REDO";
    readonly idempotencyKey: string;
    readonly requestHash: string;
    readonly responseStatus: number;
    readonly response: unknown;
    readonly now: string;
  }): void {
    this.connection
      .prepare(
        `INSERT INTO element_history_operations (
           id, project_id, command_id, requested_command_id, operation_type,
           idempotency_key, request_hash, response_status, response_json,
           created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        operation.id,
        operation.projectId,
        operation.commandId,
        operation.requestedCommandId,
        operation.type,
        operation.idempotencyKey,
        operation.requestHash,
        operation.responseStatus,
        JSON.stringify(operation.response),
        operation.now,
      );
  }

  definitionState(projectId: string): Record<string, unknown> {
    const layoutRevisions = this.connection
      .prepare(
        `SELECT page_id, project_id, desktop_revision, updated_at
         FROM page_layout_revisions WHERE project_id = ? ORDER BY page_id`,
      )
      .all(projectId);
    const elements = this.connection
      .prepare(
        `SELECT ${elementColumns} FROM elements
         WHERE project_id = ? ORDER BY page_id, created_at, id`,
      )
      .all(projectId);
    const layouts = this.connection
      .prepare(
        `SELECT ${layoutColumns} FROM element_layouts
         WHERE project_id = ? ORDER BY page_id, breakpoint, y, x, element_id`,
      )
      .all(projectId);
    const commands = this.connection
      .prepare(
        `SELECT ${commandColumns}
         FROM element_commands WHERE project_id = ? ORDER BY created_at, id`,
      )
      .all(projectId);
    const historyOperations = this.connection
      .prepare(
        `SELECT id, project_id, command_id, requested_command_id,
           operation_type, idempotency_key, request_hash, response_status,
           response_json, created_at
         FROM element_history_operations
         WHERE project_id = ? ORDER BY created_at, id`,
      )
      .all(projectId);
    return { layoutRevisions, elements, layouts, commands, historyOperations };
  }

  layoutRevisionSnapshot(projectId: string): readonly {
    readonly pageId: string;
    readonly breakpoint: "desktop";
    readonly revision: number;
  }[] {
    return (
      this.connection
        .prepare(
          `SELECT r.page_id, r.desktop_revision
           FROM page_layout_revisions r
           JOIN pages p ON p.id = r.page_id
           WHERE r.project_id = ? AND p.deleted_at IS NULL ORDER BY r.page_id`,
        )
        .all(projectId) as readonly {
        readonly page_id: string;
        readonly desktop_revision: number;
      }[]
    ).map((row) => ({
      pageId: row.page_id,
      breakpoint: "desktop",
      revision: row.desktop_revision,
    }));
  }

  toElementDto(row: ElementRow): ElementDto {
    const definition = elementDefinition(row.type);
    if (row.type_version !== definition.typeVersion) {
      throw new Error(`Element ${row.id} has an unsupported type version`);
    }
    const state = validateElementStoredState(definition, {
      props: JSON.parse(row.props_json),
      style: JSON.parse(row.style_json),
      events: JSON.parse(row.events_json),
    });
    return {
      id: row.id,
      projectId: row.project_id,
      pageId: row.page_id,
      type: row.type,
      typeVersion: row.type_version,
      name: row.name,
      props: state.props,
      style: state.style,
      events: state.events,
      locked: row.locked === 1,
      hidden: row.hidden === 1,
      revision: row.revision,
    };
  }

  toLayoutDto(row: ElementLayoutRow): ElementLayoutDto {
    return {
      elementId: row.element_id,
      breakpoint: row.breakpoint,
      x: row.x,
      y: row.y,
      w: row.w,
      h: row.h,
      minW: row.min_w,
      minH: row.min_h,
      maxW: row.max_w,
      maxH: row.max_h,
    };
  }
}
