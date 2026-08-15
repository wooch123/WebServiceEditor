import type {
  RelationshipHistoryState,
  RelationshipLayoutCommandDto,
  RelationshipNodePositionDto,
  RelationshipNodeType,
  RelationshipViewportDto,
} from "@webeditor/domain";
import type Database from "better-sqlite3";

import type { MetadataDatabase } from "../metadata/database.js";

export interface RelationshipNodePositionRow {
  readonly project_id: string;
  readonly node_id: string;
  readonly node_type: RelationshipNodeType;
  readonly object_id: string;
  readonly x: number;
  readonly y: number;
  readonly pinned: 0 | 1;
  readonly revision: number;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface RelationshipViewportRow {
  readonly project_id: string;
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
  readonly revision: number;
  readonly updated_at: string;
}

export interface RelationshipLayoutCommandRow {
  readonly id: string;
  readonly project_id: string;
  readonly command_type: "MOVE_NODE" | "AUTO_LAYOUT";
  readonly idempotency_key: string;
  readonly request_hash: string;
  readonly before_json: string;
  readonly after_json: string;
  readonly response_status: number;
  readonly response_json: string;
  readonly before_graph_revision: number;
  readonly after_graph_revision: number;
  readonly history_state: RelationshipHistoryState;
  readonly history_sequence: number;
  readonly history_updated_at: string;
  readonly created_at: string;
}

export interface RelationshipLayoutHistoryOperationRow {
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

const commandColumns = `
  id, project_id, command_type, idempotency_key, request_hash,
  before_json, after_json, response_status, response_json,
  before_graph_revision, after_graph_revision, history_state,
  history_sequence, history_updated_at, created_at
`;

export class RelationshipLayoutRepository {
  constructor(readonly metadataDatabase: MetadataDatabase) {}

  get connection(): Database.Database {
    return this.metadataDatabase.connection;
  }

  positions(projectId: string): readonly RelationshipNodePositionRow[] {
    return this.connection
      .prepare(
        `SELECT * FROM relationship_node_positions
         WHERE project_id = ? ORDER BY node_id`,
      )
      .all(projectId) as readonly RelationshipNodePositionRow[];
  }

  position(
    projectId: string,
    nodeId: string,
  ): RelationshipNodePositionRow | undefined {
    return this.connection
      .prepare(
        `SELECT * FROM relationship_node_positions
         WHERE project_id = ? AND node_id = ?`,
      )
      .get(projectId, nodeId) as RelationshipNodePositionRow | undefined;
  }

  applyPosition(
    projectId: string,
    target: Omit<RelationshipNodePositionDto, "revision">,
    now: string,
    expectedRevision?: number,
  ): RelationshipNodePositionRow | undefined {
    const current = this.position(projectId, target.nodeId);
    if (current === undefined) {
      if (expectedRevision !== undefined && expectedRevision !== 0)
        return undefined;
      this.connection
        .prepare(
          `INSERT INTO relationship_node_positions (
             project_id, node_id, node_type, object_id, x, y, pinned,
             revision, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        )
        .run(
          projectId,
          target.nodeId,
          target.nodeType,
          target.objectId,
          target.x,
          target.y,
          target.pinned ? 1 : 0,
          now,
          now,
        );
      return this.position(projectId, target.nodeId);
    }
    if (
      expectedRevision !== undefined &&
      current.revision !== expectedRevision
    ) {
      return undefined;
    }
    const result = this.connection
      .prepare(
        `UPDATE relationship_node_positions SET
           node_type = ?, object_id = ?, x = ?, y = ?, pinned = ?,
           revision = revision + 1, updated_at = ?
         WHERE project_id = ? AND node_id = ? AND revision = ?`,
      )
      .run(
        target.nodeType,
        target.objectId,
        target.x,
        target.y,
        target.pinned ? 1 : 0,
        now,
        projectId,
        target.nodeId,
        current.revision,
      );
    return result.changes === 1
      ? this.position(projectId, target.nodeId)
      : undefined;
  }

  applyPositionSnapshot(
    projectId: string,
    positions: readonly RelationshipNodePositionDto[],
    now: string,
  ): readonly RelationshipNodePositionDto[] {
    return positions.map(({ revision: _revision, ...position }) => {
      const row = this.applyPosition(projectId, position, now);
      if (row === undefined)
        throw new Error("Relationship position write failed");
      return this.positionDto(row);
    });
  }

  viewport(projectId: string): RelationshipViewportRow | undefined {
    return this.connection
      .prepare(
        "SELECT * FROM project_relationship_viewports WHERE project_id = ?",
      )
      .get(projectId) as RelationshipViewportRow | undefined;
  }

  updateViewport(
    projectId: string,
    expectedRevision: number,
    viewport: Pick<RelationshipViewportDto, "x" | "y" | "zoom">,
    now: string,
  ): RelationshipViewportRow | undefined {
    const result = this.connection
      .prepare(
        `UPDATE project_relationship_viewports SET
           x = ?, y = ?, zoom = ?, revision = revision + 1, updated_at = ?
         WHERE project_id = ? AND revision = ?`,
      )
      .run(
        viewport.x,
        viewport.y,
        viewport.zoom,
        now,
        projectId,
        expectedRevision,
      );
    return result.changes === 1 ? this.viewport(projectId) : undefined;
  }

  insertImportedPosition(
    projectId: string,
    position: RelationshipNodePositionDto,
    now: string,
  ): void {
    this.connection
      .prepare(
        `INSERT INTO relationship_node_positions (
           project_id, node_id, node_type, object_id, x, y, pinned,
           revision, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        projectId,
        position.nodeId,
        position.nodeType,
        position.objectId,
        position.x,
        position.y,
        position.pinned ? 1 : 0,
        position.revision,
        now,
        now,
      );
  }

  insertImportedViewport(
    projectId: string,
    viewport: RelationshipViewportDto,
    now: string,
  ): void {
    this.connection
      .prepare(
        `UPDATE project_relationship_viewports SET
           x = ?, y = ?, zoom = ?, revision = ?, updated_at = ?
         WHERE project_id = ?`,
      )
      .run(
        viewport.x,
        viewport.y,
        viewport.zoom,
        viewport.revision,
        now,
        projectId,
      );
  }

  definitionState(projectId: string): Record<string, unknown> {
    return {
      positions: this.positions(projectId),
      viewport: this.viewport(projectId) ?? null,
      commands: this.connection
        .prepare(
          `SELECT ${commandColumns} FROM relationship_layout_commands
           WHERE project_id = ? ORDER BY history_sequence, created_at, id`,
        )
        .all(projectId),
      historyOperations: this.connection
        .prepare(
          `SELECT * FROM relationship_layout_history_operations
           WHERE project_id = ? ORDER BY created_at, id`,
        )
        .all(projectId),
    };
  }

  command(
    projectId: string,
    idempotencyKey: string,
  ): RelationshipLayoutCommandRow | undefined {
    return this.connection
      .prepare(
        `SELECT ${commandColumns} FROM relationship_layout_commands
         WHERE project_id = ? AND idempotency_key = ?`,
      )
      .get(projectId, idempotencyKey) as
      RelationshipLayoutCommandRow | undefined;
  }

  commandById(
    projectId: string,
    commandId: string,
  ): RelationshipLayoutCommandRow | undefined {
    return this.connection
      .prepare(
        `SELECT ${commandColumns} FROM relationship_layout_commands
         WHERE project_id = ? AND id = ?`,
      )
      .get(projectId, commandId) as RelationshipLayoutCommandRow | undefined;
  }

  latestUndo(projectId: string): RelationshipLayoutCommandRow | undefined {
    return this.connection
      .prepare(
        `SELECT ${commandColumns} FROM relationship_layout_commands
         WHERE project_id = ? AND history_state = 'APPLIED'
         ORDER BY history_sequence DESC, id DESC LIMIT 1`,
      )
      .get(projectId) as RelationshipLayoutCommandRow | undefined;
  }

  nextRedo(projectId: string): RelationshipLayoutCommandRow | undefined {
    return this.connection
      .prepare(
        `SELECT ${commandColumns} FROM relationship_layout_commands
         WHERE project_id = ? AND history_state = 'UNDONE'
         ORDER BY history_sequence, id LIMIT 1`,
      )
      .get(projectId) as RelationshipLayoutCommandRow | undefined;
  }

  nextHistorySequence(projectId: string): number {
    const row = this.connection
      .prepare(
        `SELECT coalesce(max(history_sequence), 0) + 1 AS sequence
         FROM relationship_layout_commands WHERE project_id = ?`,
      )
      .get(projectId) as { readonly sequence: number };
    return row.sequence;
  }

  discardRedo(projectId: string, now: string): void {
    this.connection
      .prepare(
        `UPDATE relationship_layout_commands
         SET history_state = 'DISCARDED', history_updated_at = ?
         WHERE project_id = ? AND history_state = 'UNDONE'`,
      )
      .run(now, projectId);
  }

  insertCommand(input: {
    readonly id: string;
    readonly projectId: string;
    readonly commandType: RelationshipLayoutCommandRow["command_type"];
    readonly idempotencyKey: string;
    readonly requestHash: string;
    readonly before: readonly RelationshipNodePositionDto[];
    readonly after: readonly RelationshipNodePositionDto[];
    readonly responseStatus: number;
    readonly response: unknown;
    readonly beforeGraphRevision: number;
    readonly afterGraphRevision: number;
    readonly now: string;
  }): void {
    this.connection
      .prepare(
        `INSERT INTO relationship_layout_commands (
           id, project_id, command_type, idempotency_key, request_hash,
           before_json, after_json, response_status, response_json,
           before_graph_revision, after_graph_revision, history_state,
           history_sequence, history_updated_at, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'APPLIED', ?, ?, ?)`,
      )
      .run(
        input.id,
        input.projectId,
        input.commandType,
        input.idempotencyKey,
        input.requestHash,
        JSON.stringify(input.before),
        JSON.stringify(input.after),
        input.responseStatus,
        JSON.stringify(input.response),
        input.beforeGraphRevision,
        input.afterGraphRevision,
        this.nextHistorySequence(input.projectId),
        input.now,
        input.now,
      );
  }

  setHistoryState(
    commandId: string,
    state: "APPLIED" | "UNDONE",
    now: string,
  ): void {
    this.connection
      .prepare(
        `UPDATE relationship_layout_commands
         SET history_state = ?, history_updated_at = ? WHERE id = ?`,
      )
      .run(state, now, commandId);
  }

  historyOperation(
    projectId: string,
    key: string,
  ): RelationshipLayoutHistoryOperationRow | undefined {
    return this.connection
      .prepare(
        `SELECT * FROM relationship_layout_history_operations
         WHERE project_id = ? AND idempotency_key = ?`,
      )
      .get(projectId, key) as RelationshipLayoutHistoryOperationRow | undefined;
  }

  insertHistoryOperation(input: {
    readonly id: string;
    readonly projectId: string;
    readonly commandId: string;
    readonly requestedCommandId: string;
    readonly operationType: "UNDO" | "REDO";
    readonly idempotencyKey: string;
    readonly requestHash: string;
    readonly response: unknown;
    readonly now: string;
  }): void {
    this.connection
      .prepare(
        `INSERT INTO relationship_layout_history_operations (
           id, project_id, command_id, requested_command_id, operation_type,
           idempotency_key, request_hash, response_status, response_json,
           created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 200, ?, ?)`,
      )
      .run(
        input.id,
        input.projectId,
        input.commandId,
        input.requestedCommandId,
        input.operationType,
        input.idempotencyKey,
        input.requestHash,
        JSON.stringify(input.response),
        input.now,
      );
  }

  deleteOwnedDefinitions(projectId: string): void {
    this.connection
      .prepare(
        "DELETE FROM relationship_layout_history_operations WHERE project_id = ?",
      )
      .run(projectId);
    this.connection
      .prepare("DELETE FROM relationship_layout_commands WHERE project_id = ?")
      .run(projectId);
    this.connection
      .prepare("DELETE FROM relationship_node_positions WHERE project_id = ?")
      .run(projectId);
    this.connection
      .prepare(
        "DELETE FROM project_relationship_viewports WHERE project_id = ?",
      )
      .run(projectId);
  }

  positionDto(row: RelationshipNodePositionRow): RelationshipNodePositionDto {
    return {
      nodeId: row.node_id,
      nodeType: row.node_type,
      objectId: row.object_id,
      x: row.x,
      y: row.y,
      pinned: row.pinned === 1,
      revision: row.revision,
    };
  }

  viewportDto(row: RelationshipViewportRow): RelationshipViewportDto {
    return {
      x: row.x,
      y: row.y,
      zoom: row.zoom,
      revision: row.revision,
    };
  }

  commandSummary(
    row: RelationshipLayoutCommandRow,
  ): RelationshipLayoutCommandDto {
    return {
      id: row.id,
      commandType: row.command_type,
      state: row.history_state,
      createdAt: row.created_at,
    };
  }
}
