import type {
  BindingEndpointDto,
  RelationshipBindingDto,
  RelationshipBindingStatus,
  RelationshipBindingType,
  RelationshipHistoryCommandDto,
  RelationshipBindingsExportDto,
  RelationshipNodeType,
} from "@webeditor/domain";
import type Database from "better-sqlite3";

import type { MetadataDatabase } from "../metadata/database.js";
import { RelationshipLayoutRepository } from "./relationship-layout-repository.js";

export interface BindingStateRow {
  readonly project_id: string;
  readonly graph_revision: number;
  readonly updated_at: string;
}

export interface BindingRow {
  readonly id: string;
  readonly project_id: string;
  readonly binding_type: RelationshipBindingType;
  readonly source_node_type: RelationshipNodeType;
  readonly source_object_id: string;
  readonly source_node_id: string;
  readonly source_port_id: string;
  readonly source_port_role: string;
  readonly source_side: "right";
  readonly source_direction: "output";
  readonly source_value_type: string;
  readonly target_node_type: RelationshipNodeType;
  readonly target_object_id: string;
  readonly target_node_id: string;
  readonly target_port_id: string;
  readonly target_port_role: string;
  readonly target_side: "left";
  readonly target_direction: "input";
  readonly target_value_type: string;
  readonly query_json: string;
  readonly mapping_json: string;
  readonly status: RelationshipBindingStatus;
  readonly revision: number;
  readonly created_at: string;
  readonly updated_at: string;
  readonly deleted_at: string | null;
}

export interface BindingCommandRow {
  readonly id: string;
  readonly project_id: string;
  readonly binding_id: string;
  readonly command_type: "CREATE_BINDING" | "UPDATE_BINDING" | "DELETE_BINDING";
  readonly idempotency_key: string;
  readonly request_hash: string;
  readonly before_json: string | null;
  readonly after_json: string | null;
  readonly response_status: number;
  readonly response_json: string;
  readonly before_graph_revision: number;
  readonly after_graph_revision: number;
  readonly history_state: "APPLIED" | "UNDONE" | "DISCARDED" | null;
  readonly history_sequence: number | null;
  readonly history_updated_at: string | null;
  readonly created_at: string;
}

export interface BindingHistoryOperationRow {
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

const bindingColumns = `
  id, project_id, binding_type,
  source_node_type, source_object_id, source_node_id, source_port_id,
  source_port_role, source_side, source_direction, source_value_type,
  target_node_type, target_object_id, target_node_id, target_port_id,
  target_port_role, target_side, target_direction, target_value_type,
  query_json, mapping_json, status, revision, created_at, updated_at, deleted_at
`;

const commandColumns = `
  id, project_id, binding_id, command_type, idempotency_key, request_hash,
  before_json, after_json, response_status, response_json,
  before_graph_revision, after_graph_revision, history_state,
  history_sequence, history_updated_at, created_at
`;

export class RelationshipRepository {
  readonly layoutRepository: RelationshipLayoutRepository;

  constructor(readonly metadataDatabase: MetadataDatabase) {
    this.layoutRepository = new RelationshipLayoutRepository(metadataDatabase);
  }

  get connection(): Database.Database {
    return this.metadataDatabase.connection;
  }

  state(projectId: string): BindingStateRow | undefined {
    return this.connection
      .prepare("SELECT * FROM project_binding_states WHERE project_id = ?")
      .get(projectId) as BindingStateRow | undefined;
  }

  activeCount(projectId: string): number {
    const row = this.connection
      .prepare(
        "SELECT count(*) AS count FROM bindings WHERE project_id = ? AND deleted_at IS NULL",
      )
      .get(projectId) as { readonly count: number };
    return row.count;
  }

  endpointObjectState(input: {
    readonly projectId: string;
    readonly nodeType: RelationshipNodeType;
    readonly nodeId: string;
    readonly objectId: string;
  }): "active" | "inactive" | "missing" {
    const nodeObjectId = input.nodeId.slice(input.nodeId.indexOf(":") + 1);
    if (input.nodeType === "page") {
      const row = this.connection
        .prepare("SELECT deleted_at FROM pages WHERE id = ? AND project_id = ?")
        .get(nodeObjectId, input.projectId) as
        { readonly deleted_at: string | null } | undefined;
      if (row === undefined || input.objectId !== nodeObjectId)
        return "missing";
      return row.deleted_at === null ? "active" : "inactive";
    }
    if (input.nodeType === "element") {
      const row = this.connection
        .prepare(
          "SELECT deleted_at FROM elements WHERE id = ? AND project_id = ?",
        )
        .get(nodeObjectId, input.projectId) as
        { readonly deleted_at: string | null } | undefined;
      if (row === undefined || input.objectId !== nodeObjectId)
        return "missing";
      return row.deleted_at === null ? "active" : "inactive";
    }
    const table = this.connection
      .prepare(
        "SELECT deleted_at FROM data_tables WHERE id = ? AND project_id = ?",
      )
      .get(nodeObjectId, input.projectId) as
      { readonly deleted_at: string | null } | undefined;
    if (table === undefined) return "missing";
    if (table.deleted_at !== null) return "inactive";
    if (input.objectId === nodeObjectId) return "active";
    const field = this.connection
      .prepare(
        `SELECT deleted_at FROM data_fields
         WHERE id = ? AND table_id = ? AND project_id = ?`,
      )
      .get(input.objectId, nodeObjectId, input.projectId) as
      { readonly deleted_at: string | null } | undefined;
    if (field === undefined) return "missing";
    return field.deleted_at === null ? "active" : "inactive";
  }

  definitionState(projectId: string): Record<string, unknown> {
    const state = this.state(projectId);
    return {
      graphRevision: state?.graph_revision ?? 0,
      bindings: this.listAll(projectId),
      commands: this.connection
        .prepare(
          `SELECT ${commandColumns} FROM binding_commands
           WHERE project_id = ? ORDER BY history_sequence, created_at, id`,
        )
        .all(projectId),
      historyOperations: this.connection
        .prepare(
          `SELECT * FROM binding_history_operations
           WHERE project_id = ? ORDER BY created_at, id`,
        )
        .all(projectId),
      layout: this.layoutRepository.definitionState(projectId),
    };
  }

  deleteOwnedDefinitions(projectId: string): void {
    this.layoutRepository.deleteOwnedDefinitions(projectId);
    this.connection
      .prepare("DELETE FROM binding_history_operations WHERE project_id = ?")
      .run(projectId);
    this.connection
      .prepare("DELETE FROM binding_commands WHERE project_id = ?")
      .run(projectId);
    this.connection
      .prepare("DELETE FROM bindings WHERE project_id = ?")
      .run(projectId);
    this.connection
      .prepare("DELETE FROM project_binding_states WHERE project_id = ?")
      .run(projectId);
  }

  exportDefinition(projectId: string): RelationshipBindingsExportDto {
    const viewport = this.layoutRepository.viewport(projectId);
    return {
      schemaVersion: 2,
      graphRevision: this.state(projectId)?.graph_revision ?? 0,
      bindings: this.listActive(projectId).map((row) => this.toDto(row)),
      nodePositions: this.layoutRepository
        .positions(projectId)
        .filter(
          (row) =>
            this.endpointObjectState({
              projectId,
              nodeType: row.node_type,
              nodeId: row.node_id,
              objectId: row.object_id,
            }) === "active",
        )
        .map((row) => this.layoutRepository.positionDto(row)),
      ...(viewport === undefined
        ? {}
        : { viewport: this.layoutRepository.viewportDto(viewport) }),
    };
  }

  insertImportedDefinition(input: {
    readonly projectId: string;
    readonly source: RelationshipBindingsExportDto;
    readonly bindingIdMap: ReadonlyMap<string, string>;
    readonly pageIdMap: ReadonlyMap<string, string>;
    readonly elementIdMap: ReadonlyMap<string, string>;
    readonly tableIdMap: ReadonlyMap<string, string>;
    readonly fieldIdMap: ReadonlyMap<string, string>;
    readonly now: string;
  }): void {
    const remapObjectId = (objectId: string): string =>
      input.pageIdMap.get(objectId) ??
      input.elementIdMap.get(objectId) ??
      input.tableIdMap.get(objectId) ??
      input.fieldIdMap.get(objectId) ??
      objectId;
    const remapConfiguration = (value: unknown): unknown => {
      if (typeof value === "string") return remapObjectId(value);
      if (Array.isArray(value)) return value.map(remapConfiguration);
      if (value !== null && typeof value === "object") {
        return Object.fromEntries(
          Object.entries(value).map(([key, entry]) => [
            key,
            remapConfiguration(entry),
          ]),
        );
      }
      return value;
    };
    const remapEndpoint = (
      endpoint: BindingEndpointDto,
    ): BindingEndpointDto => {
      const objectId = remapObjectId(endpoint.objectId);
      const nodeObjectId = endpoint.nodeId.slice(
        endpoint.nodeId.indexOf(":") + 1,
      );
      const remappedNodeObjectId = remapObjectId(nodeObjectId);
      const nodeId = `${endpoint.nodeType}:${remappedNodeObjectId}`;
      const portRole =
        endpoint.portRole === `field-${endpoint.objectId}`
          ? `field-${objectId}`
          : endpoint.portRole;
      const portSuffix = endpoint.portId.slice(endpoint.objectId.length + 1);
      const remappedPortSuffix = portSuffix.startsWith(`${endpoint.portRole}:`)
        ? `${portRole}${portSuffix.slice(endpoint.portRole.length)}`
        : portSuffix;
      return {
        ...endpoint,
        nodeId,
        objectId,
        portId: endpoint.portId.startsWith(`${endpoint.objectId}:`)
          ? `${objectId}:${remappedPortSuffix}`
          : endpoint.portId,
        portRole,
      };
    };
    for (const binding of input.source.bindings) {
      this.insertBinding({
        id: input.bindingIdMap.get(binding.id) as string,
        projectId: input.projectId,
        bindingType: binding.bindingType,
        source: remapEndpoint(binding.source),
        target: remapEndpoint(binding.target),
        query: remapConfiguration(binding.query) as Record<string, unknown>,
        mapping: remapConfiguration(binding.mapping) as Record<string, unknown>,
        status: binding.status,
        now: input.now,
      });
    }
    for (const position of input.source.nodePositions ?? []) {
      const objectId = remapObjectId(position.objectId);
      const nodeObjectId = position.nodeId.slice(
        position.nodeId.indexOf(":") + 1,
      );
      const nodeId = `${position.nodeType}:${remapObjectId(nodeObjectId)}`;
      this.layoutRepository.insertImportedPosition(
        input.projectId,
        { ...position, nodeId, objectId },
        input.now,
      );
    }
    if (input.source.viewport !== undefined) {
      this.layoutRepository.insertImportedViewport(
        input.projectId,
        input.source.viewport,
        input.now,
      );
    }
    this.connection
      .prepare(
        `UPDATE project_binding_states SET graph_revision = ?, updated_at = ?
         WHERE project_id = ?`,
      )
      .run(input.source.graphRevision, input.now, input.projectId);
  }

  listActive(projectId: string): readonly BindingRow[] {
    return this.connection
      .prepare(
        `SELECT ${bindingColumns} FROM bindings
         WHERE project_id = ? AND deleted_at IS NULL ORDER BY created_at, id`,
      )
      .all(projectId) as readonly BindingRow[];
  }

  listAll(projectId: string): readonly BindingRow[] {
    return this.connection
      .prepare(
        `SELECT ${bindingColumns} FROM bindings
         WHERE project_id = ? ORDER BY created_at, id`,
      )
      .all(projectId) as readonly BindingRow[];
  }

  binding(bindingId: string): BindingRow | undefined {
    return this.connection
      .prepare(`SELECT ${bindingColumns} FROM bindings WHERE id = ?`)
      .get(bindingId) as BindingRow | undefined;
  }

  activeBinding(bindingId: string): BindingRow | undefined {
    return this.connection
      .prepare(
        `SELECT ${bindingColumns} FROM bindings
         WHERE id = ? AND deleted_at IS NULL`,
      )
      .get(bindingId) as BindingRow | undefined;
  }

  command(projectId: string, key: string): BindingCommandRow | undefined {
    return this.connection
      .prepare(
        `SELECT ${commandColumns} FROM binding_commands
         WHERE project_id = ? AND idempotency_key = ?`,
      )
      .get(projectId, key) as BindingCommandRow | undefined;
  }

  historyOperation(
    projectId: string,
    key: string,
  ): BindingHistoryOperationRow | undefined {
    return this.connection
      .prepare(
        `SELECT * FROM binding_history_operations
         WHERE project_id = ? AND idempotency_key = ?`,
      )
      .get(projectId, key) as BindingHistoryOperationRow | undefined;
  }

  latestUndo(projectId: string): BindingCommandRow | undefined {
    return this.connection
      .prepare(
        `SELECT ${commandColumns} FROM binding_commands
         WHERE project_id = ? AND history_state = 'APPLIED'
         ORDER BY history_sequence DESC, id DESC LIMIT 1`,
      )
      .get(projectId) as BindingCommandRow | undefined;
  }

  nextRedo(projectId: string): BindingCommandRow | undefined {
    return this.connection
      .prepare(
        `SELECT ${commandColumns} FROM binding_commands
         WHERE project_id = ? AND history_state = 'UNDONE'
         ORDER BY history_sequence, id LIMIT 1`,
      )
      .get(projectId) as BindingCommandRow | undefined;
  }

  nextHistorySequence(projectId: string): number {
    const row = this.connection
      .prepare(
        `SELECT coalesce(max(history_sequence), 0) + 1 AS sequence
         FROM binding_commands WHERE project_id = ?`,
      )
      .get(projectId) as { readonly sequence: number };
    return row.sequence;
  }

  discardRedo(projectId: string, now: string): void {
    this.connection
      .prepare(
        `UPDATE binding_commands
         SET history_state = 'DISCARDED', history_updated_at = ?
         WHERE project_id = ? AND history_state = 'UNDONE'`,
      )
      .run(now, projectId);
  }

  incrementRevisions(
    projectId: string,
    expectedGraphRevision: number,
    expectedProjectRevision: number,
    now: string,
  ): {
    readonly graphRevision: number;
    readonly projectRevision: number;
  } | null {
    const graph = this.connection
      .prepare(
        `UPDATE project_binding_states
         SET graph_revision = graph_revision + 1, updated_at = ?
         WHERE project_id = ? AND graph_revision = ?
         RETURNING graph_revision`,
      )
      .get(now, projectId, expectedGraphRevision) as
      { readonly graph_revision: number } | undefined;
    if (graph === undefined) return null;
    const project = this.connection
      .prepare(
        `UPDATE projects SET revision = revision + 1, updated_at = ?
         WHERE id = ? AND revision = ? AND lifecycle_status = 'ACTIVE'
         RETURNING revision`,
      )
      .get(now, projectId, expectedProjectRevision) as
      { readonly revision: number } | undefined;
    if (project === undefined) return null;
    return {
      graphRevision: graph.graph_revision,
      projectRevision: project.revision,
    };
  }

  insertBinding(input: {
    readonly id: string;
    readonly projectId: string;
    readonly bindingType: RelationshipBindingType;
    readonly source: BindingEndpointDto;
    readonly target: BindingEndpointDto;
    readonly query: Readonly<Record<string, unknown>>;
    readonly mapping: Readonly<Record<string, unknown>>;
    readonly status: RelationshipBindingStatus;
    readonly now: string;
  }): BindingRow {
    this.connection
      .prepare(
        `INSERT INTO bindings (
          id, project_id, binding_type,
          source_node_type, source_object_id, source_node_id, source_port_id,
          source_port_role, source_side, source_direction, source_value_type,
          target_node_type, target_object_id, target_node_id, target_port_id,
          target_port_role, target_side, target_direction, target_value_type,
          query_json, mapping_json, status, revision, created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, 'right', 'output', ?,
          ?, ?, ?, ?, ?, 'left', 'input', ?, ?, ?, ?, 1, ?, ?
        )`,
      )
      .run(
        input.id,
        input.projectId,
        input.bindingType,
        input.source.nodeType,
        input.source.objectId,
        input.source.nodeId,
        input.source.portId,
        input.source.portRole,
        input.source.valueType,
        input.target.nodeType,
        input.target.objectId,
        input.target.nodeId,
        input.target.portId,
        input.target.portRole,
        input.target.valueType,
        JSON.stringify(input.query),
        JSON.stringify(input.mapping),
        input.status,
        input.now,
        input.now,
      );
    return this.binding(input.id) as BindingRow;
  }

  patchBinding(
    bindingId: string,
    expectedRevision: number,
    change: {
      readonly query: Readonly<Record<string, unknown>>;
      readonly mapping: Readonly<Record<string, unknown>>;
      readonly status: RelationshipBindingStatus;
      readonly now: string;
    },
  ): BindingRow | undefined {
    this.connection
      .prepare(
        `UPDATE bindings SET query_json = ?, mapping_json = ?, status = ?,
           revision = revision + 1, updated_at = ?
         WHERE id = ? AND deleted_at IS NULL AND revision = ?`,
      )
      .run(
        JSON.stringify(change.query),
        JSON.stringify(change.mapping),
        change.status,
        change.now,
        bindingId,
        expectedRevision,
      );
    return this.activeBinding(bindingId);
  }

  setDeleted(bindingId: string, deletedAt: string | null, now: string): void {
    this.connection
      .prepare(
        `UPDATE bindings SET deleted_at = ?, updated_at = ? WHERE id = ?`,
      )
      .run(deletedAt, now, bindingId);
  }

  applySnapshot(
    snapshot: RelationshipBindingDto,
    active: boolean,
    now: string,
  ): BindingRow {
    this.connection
      .prepare(
        `UPDATE bindings SET
           binding_type = ?, query_json = ?, mapping_json = ?, status = ?,
           revision = revision + 1, updated_at = ?, deleted_at = ?
         WHERE id = ? AND project_id = ?`,
      )
      .run(
        snapshot.bindingType,
        JSON.stringify(snapshot.query),
        JSON.stringify(snapshot.mapping),
        snapshot.status,
        now,
        active ? null : now,
        snapshot.id,
        snapshot.projectId,
      );
    return this.binding(snapshot.id) as BindingRow;
  }

  insertCommand(input: {
    readonly id: string;
    readonly projectId: string;
    readonly bindingId: string;
    readonly commandType: BindingCommandRow["command_type"];
    readonly idempotencyKey: string;
    readonly requestHash: string;
    readonly before: RelationshipBindingDto | null;
    readonly after: RelationshipBindingDto | null;
    readonly responseStatus: number;
    readonly response: unknown;
    readonly beforeGraphRevision: number;
    readonly afterGraphRevision: number;
    readonly historySequence: number;
    readonly now: string;
  }): void {
    this.connection
      .prepare(
        `INSERT INTO binding_commands (
          id, project_id, binding_id, command_type, idempotency_key,
          request_hash, before_json, after_json, response_status, response_json,
          before_graph_revision, after_graph_revision, history_state,
          history_sequence, history_updated_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'APPLIED', ?, ?, ?)`,
      )
      .run(
        input.id,
        input.projectId,
        input.bindingId,
        input.commandType,
        input.idempotencyKey,
        input.requestHash,
        input.before === null ? null : JSON.stringify(input.before),
        input.after === null ? null : JSON.stringify(input.after),
        input.responseStatus,
        JSON.stringify(input.response),
        input.beforeGraphRevision,
        input.afterGraphRevision,
        input.historySequence,
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
        `UPDATE binding_commands SET history_state = ?, history_updated_at = ?
         WHERE id = ?`,
      )
      .run(state, now, commandId);
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
        `INSERT INTO binding_history_operations (
          id, project_id, command_id, requested_command_id, operation_type,
          idempotency_key, request_hash, response_status, response_json, created_at
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

  toDto(row: BindingRow): RelationshipBindingDto {
    return {
      id: row.id,
      projectId: row.project_id,
      bindingType: row.binding_type,
      source: {
        nodeType: row.source_node_type,
        nodeId: row.source_node_id,
        objectId: row.source_object_id,
        portId: row.source_port_id,
        portRole: row.source_port_role,
        direction: row.source_direction,
        side: row.source_side,
        valueType: row.source_value_type,
      },
      target: {
        nodeType: row.target_node_type,
        nodeId: row.target_node_id,
        objectId: row.target_object_id,
        portId: row.target_port_id,
        portRole: row.target_port_role,
        direction: row.target_direction,
        side: row.target_side,
        valueType: row.target_value_type,
      },
      query: JSON.parse(row.query_json) as Record<string, unknown>,
      mapping: JSON.parse(row.mapping_json) as Record<string, unknown>,
      status: row.status,
      revision: row.revision,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  commandSummary(row: BindingCommandRow): RelationshipHistoryCommandDto {
    if (row.history_state === null) {
      throw new Error("Binding history command state is missing");
    }
    return {
      id: row.id,
      commandType: row.command_type,
      bindingId: row.binding_id,
      state: row.history_state,
      createdAt: row.created_at,
    };
  }
}
