import { createHash, randomUUID } from "node:crypto";

import {
  DATA_RELATIONSHIP_SCHEMA_VERSION,
  RELATIONSHIP_BINDING_STATUSES,
  RELATIONSHIP_BINDING_TYPES,
  type BindingEndpointDto,
  type CreateRelationshipBindingRequest,
  type DataRelationshipGraphDto,
  type DeleteRelationshipBindingDto,
  type DeleteRelationshipBindingRequest,
  type PatchRelationshipBindingRequest,
  type PreviewRelationshipConnectionRequest,
  type RelationshipBindingDto,
  type RelationshipBindingMutationDto,
  type RelationshipBindingStatus,
  type RelationshipBindingType,
  type RelationshipConnectionPreviewDto,
  type RelationshipHistoryDto,
  type RelationshipHistoryMutationDto,
  type RelationshipHistoryMutationRequest,
  type RelationshipNodeDto,
  type RelationshipPortDto,
} from "@webeditor/domain";

import { ApiError, assertApi } from "../errors.js";
import { elementDefinition } from "../elements/element-registry.js";
import { ElementRepository } from "../elements/element-repository.js";
import type { MetadataDatabase } from "../metadata/database.js";
import { PageRepository } from "../pages/page-repository.js";
import { ProjectRepository } from "../projects/project-repository.js";
import { SchemaRepository } from "../data-schema/schema-repository.js";
import {
  RelationshipRepository,
  type BindingCommandRow,
} from "./relationship-repository.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const bindingTypeSet = new Set<string>(RELATIONSHIP_BINDING_TYPES);
const bindingStatusSet = new Set<string>(RELATIONSHIP_BINDING_STATUSES);
const FORBIDDEN_CONFIG_KEYS = new Set([
  "sql",
  "rawsql",
  "raw_sql",
  "javascript",
  "script",
  "code",
]);

interface StoredConnectionPreview extends RelationshipConnectionPreviewDto {
  readonly createdAtMs: number;
}

interface RelationshipContext {
  readonly graphRevision: number;
  readonly projectRevision: number;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

function requestHash(
  operation: string,
  scopeId: string,
  request: unknown,
): string {
  return createHash("sha256")
    .update(stableJson({ operation, scopeId, request }))
    .digest("hex");
}

function assertUuid(
  value: unknown,
  code: string,
  label: string,
): asserts value is string {
  assertApi(
    typeof value === "string" && UUID_PATTERN.test(value),
    400,
    code,
    `${label} is invalid`,
  );
}

function revision(value: unknown, code: string): number {
  assertApi(
    Number.isSafeInteger(value) && (value as number) >= 0,
    400,
    code,
    "Revision is invalid",
  );
  return value as number;
}

function idempotencyKey(value: unknown): string {
  assertApi(
    typeof value === "string" && value.length >= 8 && value.length <= 200,
    400,
    "INVALID_IDEMPOTENCY_KEY",
    "Idempotency key is invalid",
  );
  return value;
}

function safeConfiguration(
  value: unknown,
  label: string,
): Readonly<Record<string, unknown>> {
  assertApi(
    typeof value === "object" && value !== null && !Array.isArray(value),
    400,
    "INVALID_BINDING_CONFIGURATION",
    `${label} must be an object`,
  );
  const encoded = JSON.stringify(value);
  assertApi(
    encoded.length <= 64_000,
    400,
    "BINDING_CONFIGURATION_TOO_LARGE",
    `${label} is too large`,
  );
  const visit = (current: unknown, depth: number): void => {
    assertApi(
      depth <= 8,
      400,
      "BINDING_CONFIGURATION_TOO_DEEP",
      `${label} is too deeply nested`,
    );
    if (current === null || typeof current !== "object") return;
    if (Array.isArray(current)) {
      assertApi(
        current.length <= 500,
        400,
        "BINDING_CONFIGURATION_TOO_LARGE",
        `${label} contains too many items`,
      );
      for (const item of current) visit(item, depth + 1);
      return;
    }
    for (const [key, nested] of Object.entries(
      current as Record<string, unknown>,
    )) {
      assertApi(
        !FORBIDDEN_CONFIG_KEYS.has(key.toLocaleLowerCase()),
        400,
        "UNSAFE_BINDING_CONFIGURATION",
        `${label} cannot contain executable source`,
        { key },
      );
      visit(nested, depth + 1);
    }
  };
  visit(value, 0);
  return JSON.parse(encoded) as Readonly<Record<string, unknown>>;
}

function fieldValueType(type: string): string {
  if (type === "INTEGER" || type === "REAL") return "number";
  if (type === "BOOLEAN") return "boolean";
  if (type === "JSON") return "object";
  if (type === "BLOB") return "binary";
  return "string";
}

function valueTypesCompatible(source: string, target: string): boolean {
  if (source === target || source === "unknown" || target === "unknown")
    return true;
  if (
    target === "records" ||
    target === "record" ||
    target === "chart-series"
  ) {
    return true;
  }
  if (
    source === "number" &&
    ["numbers", "numeric-range", "chart-point"].includes(target)
  ) {
    return true;
  }
  if (source === "event" && target === "event") return true;
  return false;
}

function bindingRulesAllow(
  type: RelationshipBindingType,
  source: BindingEndpointDto,
  target: BindingEndpointDto,
): boolean {
  if (type === "CONTAINS") {
    return source.nodeType === "page" && target.nodeType === "element";
  }
  if (type === "READ") {
    return source.nodeType === "table" && target.nodeType === "element";
  }
  if (["CREATE", "UPDATE", "DELETE"].includes(type)) {
    return source.nodeType === "element" && target.nodeType === "table";
  }
  if (type === "FILTER") {
    return source.nodeType === "element" && target.nodeType === "element";
  }
  if (type === "NAVIGATE") {
    return (
      (source.nodeType === "page" || source.nodeType === "element") &&
      target.nodeType === "page"
    );
  }
  return (
    type === "RELATION" &&
    source.nodeType === "table" &&
    target.nodeType === "table"
  );
}

function storedCommandResult<T>(command: BindingCommandRow, hash: string): T {
  assertApi(
    command.request_hash === hash,
    409,
    "IDEMPOTENCY_PAYLOAD_CONFLICT",
    "Idempotency key was already used with a different payload",
  );
  return JSON.parse(command.response_json) as T;
}

export interface RelationshipServiceOptions {
  readonly metadataDatabase: MetadataDatabase;
  readonly clock?: () => Date;
}

export class RelationshipService {
  readonly repository: RelationshipRepository;
  readonly projectRepository: ProjectRepository;
  readonly pageRepository: PageRepository;
  readonly elementRepository: ElementRepository;
  readonly schemaRepository: SchemaRepository;
  readonly #clock: () => Date;
  readonly #previews = new Map<string, StoredConnectionPreview>();

  constructor(options: RelationshipServiceOptions) {
    this.repository = new RelationshipRepository(options.metadataDatabase);
    this.projectRepository = new ProjectRepository(options.metadataDatabase);
    this.pageRepository = new PageRepository(options.metadataDatabase);
    this.elementRepository = new ElementRepository(options.metadataDatabase);
    this.schemaRepository = new SchemaRepository(options.metadataDatabase);
    this.#clock = options.clock ?? (() => new Date());
    for (const project of this.projectRepository.listActive()) {
      this.graph(project.id);
    }
  }

  graph(projectId: string): DataRelationshipGraphDto {
    assertUuid(projectId, "INVALID_PROJECT_ID", "Project ID");
    const context = this.#context(projectId);
    const nodes = this.#nodes(projectId);
    const validPorts = new Set(
      nodes.flatMap((node) => node.ports.map(({ id }) => id)),
    );
    const bindings = this.repository.listActive(projectId);
    const renderableBindings = bindings.filter((binding) => {
      const sourceValid = validPorts.has(binding.source_port_id);
      const targetValid = validPorts.has(binding.target_port_id);
      if (sourceValid && targetValid) return true;
      const sourceState = this.repository.endpointObjectState({
        projectId,
        nodeType: binding.source_node_type,
        nodeId: binding.source_node_id,
        objectId: binding.source_object_id,
      });
      const targetState = this.repository.endpointObjectState({
        projectId,
        nodeType: binding.target_node_type,
        nodeId: binding.target_node_id,
        objectId: binding.target_object_id,
      });
      if (
        (!sourceValid && sourceState !== "inactive") ||
        (!targetValid && targetState !== "inactive")
      ) {
        throw new ApiError(
          503,
          "BINDING_TOPOLOGY_INVALID",
          "A Binding references a missing graph port",
          { bindingId: binding.id },
        );
      }
      return false;
    });
    return {
      schemaVersion: DATA_RELATIONSHIP_SCHEMA_VERSION,
      projectId,
      graphRevision: context.graphRevision,
      projectRevision: context.projectRevision,
      nodes,
      edges: renderableBindings.map((binding) =>
        this.repository.toDto(binding),
      ),
    };
  }

  bindings(projectId: string): {
    readonly projectId: string;
    readonly graphRevision: number;
    readonly projectRevision: number;
    readonly bindings: readonly RelationshipBindingDto[];
  } {
    const graph = this.graph(projectId);
    return {
      projectId,
      graphRevision: graph.graphRevision,
      projectRevision: graph.projectRevision,
      bindings: graph.edges,
    };
  }

  preview(
    projectId: string,
    request: PreviewRelationshipConnectionRequest,
  ): RelationshipConnectionPreviewDto {
    const sourcePortId = this.#portId(request.sourcePortId, "Source port ID");
    const targetPortId = this.#portId(request.targetPortId, "Target port ID");
    const context = this.#context(projectId);
    this.#assertRevisions(context, request);
    const graph = this.graph(projectId);
    const ports = new Map(
      graph.nodes.flatMap((node) =>
        node.ports.map((port) => [port.id, port] as const),
      ),
    );
    const sourcePort = ports.get(sourcePortId);
    const targetPort = ports.get(targetPortId);
    assertApi(
      sourcePort !== undefined && targetPort !== undefined,
      404,
      "RELATIONSHIP_PORT_NOT_FOUND",
      "Connection port was not found",
    );
    const source = this.#endpoint(sourcePort, graph.nodes);
    const target = this.#endpoint(targetPort, graph.nodes);
    const issues: string[] = [];
    if (source.direction !== "output" || source.side !== "right") {
      issues.push("SOURCE_MUST_BE_RIGHT_OUTPUT");
    }
    if (target.direction !== "input" || target.side !== "left") {
      issues.push("TARGET_MUST_BE_LEFT_INPUT");
    }
    if (source.portId === target.portId || source.nodeId === target.nodeId) {
      issues.push("SELF_CONNECTION_NOT_ALLOWED");
    }
    const intersected = sourcePort.allowedBindingTypes.filter(
      (type) =>
        targetPort.allowedBindingTypes.includes(type) &&
        bindingRulesAllow(type, source, target),
    );
    if (intersected.length === 0) issues.push("BINDING_TYPE_INCOMPATIBLE");
    const requiresValueCompatibility = intersected.some((type) =>
      ["READ", "FILTER", "RELATION"].includes(type),
    );
    if (
      requiresValueCompatibility &&
      !valueTypesCompatible(source.valueType, target.valueType)
    ) {
      issues.push("VALUE_TYPE_INCOMPATIBLE");
    }
    const active = graph.edges;
    if (
      active.some(
        (binding) =>
          binding.source.portId === source.portId &&
          binding.target.portId === target.portId,
      )
    ) {
      issues.push("BINDING_ALREADY_EXISTS");
    }
    if (
      targetPort.maxConnections !== null &&
      active.filter((binding) => binding.target.portId === target.portId)
        .length >= targetPort.maxConnections
    ) {
      issues.push("TARGET_CONNECTION_LIMIT");
    }
    const relationTypes = intersected.filter((type) => {
      if (type !== "RELATION") return true;
      return this.schemaRepository
        .relations(projectId)
        .some(
          (relation) =>
            relation.source_field_id === source.objectId &&
            relation.target_field_id === target.objectId,
        );
    });
    if (
      intersected.includes("RELATION") &&
      !relationTypes.includes("RELATION")
    ) {
      issues.push("SCHEMA_RELATION_REQUIRED");
    }
    const now = this.#clock();
    this.#purgeExpired(now.getTime());
    const preview: StoredConnectionPreview = {
      previewId: randomUUID(),
      projectId,
      source,
      target,
      compatible: issues.length === 0 && relationTypes.length > 0,
      allowedBindingTypes: issues.length === 0 ? relationTypes : [],
      issues,
      graphRevision: context.graphRevision,
      projectRevision: context.projectRevision,
      expiresAt: new Date(now.getTime() + 15_000).toISOString(),
      createdAtMs: now.getTime(),
    };
    this.#previews.set(preview.previewId, preview);
    while (this.#previews.size > 512) {
      const oldest = this.#previews.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.#previews.delete(oldest);
    }
    return this.#publicPreview(preview);
  }

  create(
    projectId: string,
    request: CreateRelationshipBindingRequest,
  ): RelationshipBindingMutationDto {
    assertUuid(projectId, "INVALID_PROJECT_ID", "Project ID");
    assertUuid(
      request.previewId,
      "INVALID_CONNECTION_PREVIEW_ID",
      "Preview ID",
    );
    const type = this.#bindingType(request.bindingType);
    const key = idempotencyKey(request.idempotencyKey);
    const hash = requestHash("CREATE_BINDING", projectId, request);
    const replay = this.repository.command(projectId, key);
    if (replay !== undefined) {
      return storedCommandResult<RelationshipBindingMutationDto>(replay, hash);
    }
    const preview = this.#consumePreview(request.previewId, projectId);
    assertApi(
      preview.compatible && preview.allowedBindingTypes.includes(type),
      409,
      "CONNECTION_PREVIEW_INVALID",
      "Connection preview is not compatible with the selected Binding type",
      { issues: preview.issues },
    );
    const context = this.#context(projectId);
    this.#assertRevisions(context, request);
    assertApi(
      preview.graphRevision === context.graphRevision &&
        preview.projectRevision === context.projectRevision,
      409,
      "CONNECTION_PREVIEW_STALE",
      "Connection preview is stale",
    );
    const now = this.#now();
    const bindingId = randomUUID();
    const commandId = randomUUID();
    return this.repository.metadataDatabase.transaction(() => {
      const currentGraph = this.graph(projectId);
      assertApi(
        !currentGraph.edges.some(
          (binding) =>
            binding.source.portId === preview.source.portId &&
            binding.target.portId === preview.target.portId,
        ),
        409,
        "BINDING_ALREADY_EXISTS",
        "The connection already has a Binding",
      );
      const row = this.repository.insertBinding({
        id: bindingId,
        projectId,
        bindingType: type,
        source: preview.source,
        target: preview.target,
        query: {
          source: {
            nodeType: preview.source.nodeType,
            objectId: preview.source.objectId,
            portRole: preview.source.portRole,
          },
        },
        mapping: {
          target: {
            nodeType: preview.target.nodeType,
            objectId: preview.target.objectId,
            portRole: preview.target.portRole,
          },
        },
        status: "READY",
        now,
      });
      const binding = this.repository.toDto(row);
      const revisions = this.repository.incrementRevisions(
        projectId,
        context.graphRevision,
        context.projectRevision,
        now,
      );
      assertApi(
        revisions !== null,
        409,
        "RELATIONSHIP_REVISION_CONFLICT",
        "Relationship graph changed before the Binding was created",
      );
      const response: RelationshipBindingMutationDto = {
        binding,
        ...revisions,
        commandId,
      };
      this.repository.discardRedo(projectId, now);
      this.repository.insertCommand({
        id: commandId,
        projectId,
        bindingId,
        commandType: "CREATE_BINDING",
        idempotencyKey: key,
        requestHash: hash,
        before: null,
        after: binding,
        responseStatus: 201,
        response,
        beforeGraphRevision: context.graphRevision,
        afterGraphRevision: revisions.graphRevision,
        historySequence: this.repository.nextHistorySequence(projectId),
        now,
      });
      return response;
    });
  }

  patch(
    bindingId: string,
    request: PatchRelationshipBindingRequest,
  ): RelationshipBindingMutationDto {
    assertUuid(bindingId, "INVALID_BINDING_ID", "Binding ID");
    const key = idempotencyKey(request.idempotencyKey);
    const hash = requestHash("UPDATE_BINDING", bindingId, request);
    const anyBinding = this.repository.binding(bindingId);
    assertApi(
      anyBinding !== undefined,
      404,
      "BINDING_NOT_FOUND",
      "Binding was not found",
    );
    const replay = this.repository.command(anyBinding.project_id, key);
    if (replay !== undefined) {
      return storedCommandResult<RelationshipBindingMutationDto>(replay, hash);
    }
    const binding = this.repository.activeBinding(bindingId);
    assertApi(
      binding !== undefined,
      404,
      "BINDING_NOT_FOUND",
      "Binding was not found",
    );
    const expectedBindingRevision = revision(
      request.expectedRevision,
      "INVALID_BINDING_REVISION",
    );
    assertApi(
      binding.revision === expectedBindingRevision,
      409,
      "BINDING_REVISION_CONFLICT",
      "Binding revision changed",
      { latestRevision: binding.revision },
    );
    const context = this.#context(binding.project_id);
    this.#assertRevisions(context, request);
    const before = this.repository.toDto(binding);
    const query =
      request.query === undefined
        ? before.query
        : safeConfiguration(request.query, "Binding query");
    const mapping =
      request.mapping === undefined
        ? before.mapping
        : safeConfiguration(request.mapping, "Binding mapping");
    const status =
      request.status === undefined
        ? before.status
        : this.#bindingStatus(request.status);
    assertApi(
      request.query !== undefined ||
        request.mapping !== undefined ||
        request.status !== undefined,
      400,
      "EMPTY_BINDING_PATCH",
      "Binding patch has no changes",
    );
    const now = this.#now();
    const commandId = randomUUID();
    return this.repository.metadataDatabase.transaction(() => {
      const updated = this.repository.patchBinding(
        bindingId,
        binding.revision,
        {
          query,
          mapping,
          status,
          now,
        },
      );
      assertApi(
        updated !== undefined,
        409,
        "BINDING_REVISION_CONFLICT",
        "Binding revision changed",
      );
      const after = this.repository.toDto(updated);
      const revisions = this.repository.incrementRevisions(
        binding.project_id,
        context.graphRevision,
        context.projectRevision,
        now,
      );
      assertApi(
        revisions !== null,
        409,
        "RELATIONSHIP_REVISION_CONFLICT",
        "Relationship graph changed before the Binding was updated",
      );
      const response: RelationshipBindingMutationDto = {
        binding: after,
        ...revisions,
        commandId,
      };
      this.repository.discardRedo(binding.project_id, now);
      this.repository.insertCommand({
        id: commandId,
        projectId: binding.project_id,
        bindingId,
        commandType: "UPDATE_BINDING",
        idempotencyKey: key,
        requestHash: hash,
        before,
        after,
        responseStatus: 200,
        response,
        beforeGraphRevision: context.graphRevision,
        afterGraphRevision: revisions.graphRevision,
        historySequence: this.repository.nextHistorySequence(
          binding.project_id,
        ),
        now,
      });
      return response;
    });
  }

  delete(
    bindingId: string,
    request: DeleteRelationshipBindingRequest,
  ): DeleteRelationshipBindingDto {
    assertUuid(bindingId, "INVALID_BINDING_ID", "Binding ID");
    const anyBinding = this.repository.binding(bindingId);
    assertApi(
      anyBinding !== undefined,
      404,
      "BINDING_NOT_FOUND",
      "Binding was not found",
    );
    const key = idempotencyKey(request.idempotencyKey);
    const hash = requestHash("DELETE_BINDING", bindingId, request);
    const replay = this.repository.command(anyBinding.project_id, key);
    if (replay !== undefined) {
      return storedCommandResult<DeleteRelationshipBindingDto>(replay, hash);
    }
    const binding = this.repository.activeBinding(bindingId);
    assertApi(
      binding !== undefined,
      404,
      "BINDING_NOT_FOUND",
      "Binding was not found",
    );
    const expectedBindingRevision = revision(
      request.expectedRevision,
      "INVALID_BINDING_REVISION",
    );
    assertApi(
      binding.revision === expectedBindingRevision,
      409,
      "BINDING_REVISION_CONFLICT",
      "Binding revision changed",
    );
    const context = this.#context(binding.project_id);
    this.#assertRevisions(context, request);
    const before = this.repository.toDto(binding);
    const now = this.#now();
    const commandId = randomUUID();
    return this.repository.metadataDatabase.transaction(() => {
      this.repository.setDeleted(bindingId, now, now);
      const revisions = this.repository.incrementRevisions(
        binding.project_id,
        context.graphRevision,
        context.projectRevision,
        now,
      );
      assertApi(
        revisions !== null,
        409,
        "RELATIONSHIP_REVISION_CONFLICT",
        "Relationship graph changed before the Binding was deleted",
      );
      const response: DeleteRelationshipBindingDto = {
        deletedBindingId: bindingId,
        ...revisions,
        commandId,
      };
      this.repository.discardRedo(binding.project_id, now);
      this.repository.insertCommand({
        id: commandId,
        projectId: binding.project_id,
        bindingId,
        commandType: "DELETE_BINDING",
        idempotencyKey: key,
        requestHash: hash,
        before,
        after: null,
        responseStatus: 200,
        response,
        beforeGraphRevision: context.graphRevision,
        afterGraphRevision: revisions.graphRevision,
        historySequence: this.repository.nextHistorySequence(
          binding.project_id,
        ),
        now,
      });
      return response;
    });
  }

  history(projectId: string): RelationshipHistoryDto {
    const context = this.#context(projectId);
    const undo = this.repository.latestUndo(projectId);
    const redo = this.repository.nextRedo(projectId);
    return {
      projectId,
      ...context,
      undo: undo === undefined ? null : this.repository.commandSummary(undo),
      redo: redo === undefined ? null : this.repository.commandSummary(redo),
    };
  }

  historyMutation(
    projectId: string,
    operation: "UNDO" | "REDO",
    request: RelationshipHistoryMutationRequest,
  ): RelationshipHistoryMutationDto {
    assertUuid(projectId, "INVALID_PROJECT_ID", "Project ID");
    assertUuid(
      request.expectedCommandId,
      "INVALID_BINDING_COMMAND_ID",
      "Command ID",
    );
    const key = idempotencyKey(request.idempotencyKey);
    const hash = requestHash(`BINDING_${operation}`, projectId, request);
    const replay = this.repository.historyOperation(projectId, key);
    if (replay !== undefined) {
      assertApi(
        replay.request_hash === hash,
        409,
        "IDEMPOTENCY_PAYLOAD_CONFLICT",
        "Idempotency key was already used with a different payload",
      );
      return JSON.parse(replay.response_json) as RelationshipHistoryMutationDto;
    }
    const context = this.#context(projectId);
    this.#assertRevisions(context, request);
    const command =
      operation === "UNDO"
        ? this.repository.latestUndo(projectId)
        : this.repository.nextRedo(projectId);
    assertApi(
      command !== undefined && command.id === request.expectedCommandId,
      409,
      "BINDING_HISTORY_CONFLICT",
      `${operation} command changed`,
      { latestCommandId: command?.id ?? null },
    );
    const before =
      command.before_json === null
        ? null
        : (JSON.parse(command.before_json) as RelationshipBindingDto);
    const after =
      command.after_json === null
        ? null
        : (JSON.parse(command.after_json) as RelationshipBindingDto);
    const now = this.#now();
    return this.repository.metadataDatabase.transaction(() => {
      let row;
      if (operation === "UNDO") {
        if (command.command_type === "CREATE_BINDING") {
          this.repository.setDeleted(command.binding_id, now, now);
          row = this.repository.binding(command.binding_id);
        } else if (command.command_type === "DELETE_BINDING") {
          assertApi(
            before !== null,
            503,
            "BINDING_HISTORY_INVALID",
            "Delete snapshot is missing",
          );
          row = this.repository.applySnapshot(before, true, now);
        } else {
          assertApi(
            before !== null,
            503,
            "BINDING_HISTORY_INVALID",
            "Update snapshot is missing",
          );
          row = this.repository.applySnapshot(before, true, now);
        }
        this.repository.setHistoryState(command.id, "UNDONE", now);
      } else {
        if (command.command_type === "DELETE_BINDING") {
          this.repository.setDeleted(command.binding_id, now, now);
          row = this.repository.binding(command.binding_id);
        } else {
          assertApi(
            after !== null,
            503,
            "BINDING_HISTORY_INVALID",
            "Binding snapshot is missing",
          );
          row = this.repository.applySnapshot(after, true, now);
        }
        this.repository.setHistoryState(command.id, "APPLIED", now);
      }
      assertApi(
        row !== undefined,
        503,
        "BINDING_HISTORY_INVALID",
        "Binding is missing",
      );
      const revisions = this.repository.incrementRevisions(
        projectId,
        context.graphRevision,
        context.projectRevision,
        now,
      );
      assertApi(
        revisions !== null,
        409,
        "RELATIONSHIP_REVISION_CONFLICT",
        "Relationship graph changed before history was applied",
      );
      const response: RelationshipHistoryMutationDto = {
        projectId,
        ...revisions,
        commandId: command.id,
        operation,
        binding: this.repository.toDto(row),
      };
      this.repository.insertHistoryOperation({
        id: randomUUID(),
        projectId,
        commandId: command.id,
        requestedCommandId: request.expectedCommandId,
        operationType: operation,
        idempotencyKey: key,
        requestHash: hash,
        response,
        now,
      });
      return response;
    });
  }

  #context(projectId: string): RelationshipContext {
    assertUuid(projectId, "INVALID_PROJECT_ID", "Project ID");
    const project = this.projectRepository.get(projectId);
    assertApi(
      project !== undefined,
      404,
      "PROJECT_NOT_FOUND",
      "Project was not found",
    );
    assertApi(
      project.lifecycle_status === "ACTIVE",
      409,
      "PROJECT_NOT_ACTIVE",
      "Relationship graph is available only for active Projects",
    );
    const state = this.repository.state(projectId);
    assertApi(
      state !== undefined,
      503,
      "BINDING_STATE_MISSING",
      "Project Binding state is missing",
    );
    return {
      graphRevision: state.graph_revision,
      projectRevision: project.revision,
    };
  }

  #assertRevisions(
    context: RelationshipContext,
    request: {
      readonly expectedGraphRevision: unknown;
      readonly expectedProjectRevision: unknown;
    },
  ): void {
    const expectedGraphRevision = revision(
      request.expectedGraphRevision,
      "INVALID_GRAPH_REVISION",
    );
    const expectedProjectRevision = revision(
      request.expectedProjectRevision,
      "INVALID_PROJECT_REVISION",
    );
    assertApi(
      context.graphRevision === expectedGraphRevision,
      409,
      "GRAPH_REVISION_CONFLICT",
      "Relationship graph revision changed",
      { latestRevision: context.graphRevision },
    );
    assertApi(
      context.projectRevision === expectedProjectRevision,
      409,
      "PROJECT_REVISION_CONFLICT",
      "Project revision changed",
      { latestRevision: context.projectRevision },
    );
  }

  #nodes(projectId: string): readonly RelationshipNodeDto[] {
    const pages = this.pageRepository.listActive(projectId);
    const elements = this.elementRepository.listActiveForProject(projectId);
    const schema = this.schemaRepository.exportDefinition(projectId);
    const pageNodes = pages.map((page, index): RelationshipNodeDto => {
      const nodeId = `page:${page.id}`;
      const ports: RelationshipPortDto[] = [
        this.#port({
          nodeId,
          objectId: page.id,
          role: "navigation",
          label: "Navigation",
          direction: "input",
          valueType: "page",
          allowedBindingTypes: ["NAVIGATE"],
          maxConnections: null,
          index: 0,
        }),
        this.#port({
          nodeId,
          objectId: page.id,
          role: "contains",
          label: "Contains",
          direction: "output",
          valueType: "page",
          allowedBindingTypes: ["CONTAINS"],
          maxConnections: null,
          index: 0,
        }),
        this.#port({
          nodeId,
          objectId: page.id,
          role: "navigation",
          label: "Navigate",
          direction: "output",
          valueType: "page",
          allowedBindingTypes: ["NAVIGATE"],
          maxConnections: null,
          index: 1,
        }),
      ];
      return {
        id: nodeId,
        objectId: page.id,
        type: "page",
        label: page.name,
        subtitle: page.route,
        iconName: page.icon_name,
        x: 40,
        y: 40 + index * 180,
        width: 240,
        height: 128,
        ports,
      };
    });
    const elementNodes = elements.map((entry, index): RelationshipNodeDto => {
      const nodeId = `element:${entry.element.id}`;
      const definition = elementDefinition(entry.element.type);
      const ports: RelationshipPortDto[] = [
        this.#port({
          nodeId,
          objectId: entry.element.id,
          role: "contains",
          label: "Page",
          direction: "input",
          valueType: "page",
          allowedBindingTypes: ["CONTAINS"],
          maxConnections: 1,
          index: 0,
        }),
      ];
      definition.bindingPorts.forEach((definitionPort, portIndex) => {
        ports.push(
          this.#port({
            nodeId,
            objectId: entry.element.id,
            role: definitionPort.id,
            label: definitionPort.label,
            direction: definitionPort.direction,
            valueType: definitionPort.valueType,
            allowedBindingTypes:
              definitionPort.direction === "input"
                ? ["READ", "FILTER"]
                : definitionPort.valueType === "event"
                  ? ["CREATE", "UPDATE", "DELETE", "NAVIGATE"]
                  : ["FILTER", "NAVIGATE"],
            maxConnections: definitionPort.maxConnections,
            index: portIndex + 1,
          }),
        );
      });
      return {
        id: nodeId,
        objectId: entry.element.id,
        type: "element",
        label: entry.element.name,
        subtitle: `${definition.label} · ${pages.find(({ id }) => id === entry.element.pageId)?.name ?? "Page"}`,
        iconName: definition.iconName,
        x: 380,
        y: 40 + index * 180,
        width: 260,
        height: Math.max(128, 88 + ports.length * 28),
        ports,
      };
    });
    const tableNodes = schema.tables.map(
      (table, index): RelationshipNodeDto => {
        const nodeId = `table:${table.id}`;
        const ports: RelationshipPortDto[] = [
          this.#port({
            nodeId,
            objectId: table.id,
            role: "record",
            label: "Record",
            direction: "input",
            valueType: "record",
            allowedBindingTypes: ["CREATE", "UPDATE", "DELETE"],
            maxConnections: null,
            index: 0,
          }),
        ];
        table.fields.forEach((field, fieldIndex) => {
          ports.push(
            this.#port({
              nodeId,
              objectId: field.id,
              role: `field-${field.id}`,
              label: field.displayName,
              direction: "input",
              valueType: fieldValueType(field.type),
              allowedBindingTypes: ["RELATION"],
              maxConnections: null,
              index: fieldIndex + 1,
            }),
            this.#port({
              nodeId,
              objectId: field.id,
              role: `field-${field.id}`,
              label: field.displayName,
              direction: "output",
              valueType: fieldValueType(field.type),
              allowedBindingTypes: ["READ", "RELATION"],
              maxConnections: null,
              index: fieldIndex + 1,
            }),
          );
        });
        return {
          id: nodeId,
          objectId: table.id,
          type: "table",
          label: table.displayName,
          subtitle: table.physicalName,
          iconName: "Table2",
          x: 760,
          y: 40 + index * 220,
          width: 300,
          height: Math.max(128, 88 + (table.fields.length + 1) * 30),
          ports,
        };
      },
    );
    return [...pageNodes, ...elementNodes, ...tableNodes];
  }

  #port(input: {
    readonly nodeId: string;
    readonly objectId: string;
    readonly role: string;
    readonly label: string;
    readonly direction: "input" | "output";
    readonly valueType: string;
    readonly allowedBindingTypes: readonly RelationshipBindingType[];
    readonly maxConnections: number | null;
    readonly index: number;
  }): RelationshipPortDto {
    return {
      id: `${input.objectId}:${input.role}:${input.direction}:${input.index}`,
      nodeId: input.nodeId,
      objectId: input.objectId,
      role: input.role,
      label: input.label,
      direction: input.direction,
      side: input.direction === "input" ? "left" : "right",
      valueType: input.valueType,
      allowedBindingTypes: input.allowedBindingTypes,
      maxConnections: input.maxConnections,
    };
  }

  #endpoint(
    port: RelationshipPortDto,
    nodes: readonly RelationshipNodeDto[],
  ): BindingEndpointDto {
    const node = nodes.find(({ id }) => id === port.nodeId);
    if (node === undefined) throw new Error("Graph port node is missing");
    return {
      nodeType: node.type,
      nodeId: node.id,
      objectId: port.objectId,
      portId: port.id,
      portRole: port.role,
      direction: port.direction,
      side: port.side,
      valueType: port.valueType,
    };
  }

  #bindingType(value: unknown): RelationshipBindingType {
    assertApi(
      typeof value === "string" && bindingTypeSet.has(value),
      400,
      "INVALID_BINDING_TYPE",
      "Binding type is invalid",
    );
    return value as RelationshipBindingType;
  }

  #bindingStatus(value: unknown): RelationshipBindingStatus {
    assertApi(
      typeof value === "string" && bindingStatusSet.has(value),
      400,
      "INVALID_BINDING_STATUS",
      "Binding status is invalid",
    );
    return value as RelationshipBindingStatus;
  }

  #portId(value: unknown, label: string): string {
    assertApi(
      typeof value === "string" && value.length >= 8 && value.length <= 240,
      400,
      "INVALID_RELATIONSHIP_PORT_ID",
      `${label} is invalid`,
    );
    return value;
  }

  #consumePreview(
    previewId: string,
    projectId: string,
  ): StoredConnectionPreview {
    const now = this.#clock().getTime();
    this.#purgeExpired(now);
    const preview = this.#previews.get(previewId);
    assertApi(
      preview !== undefined,
      409,
      "CONNECTION_PREVIEW_NOT_FOUND",
      "Connection preview was not found or expired",
    );
    assertApi(
      preview.projectId === projectId,
      409,
      "CONNECTION_PREVIEW_PROJECT_MISMATCH",
      "Connection preview belongs to another Project",
    );
    this.#previews.delete(previewId);
    return preview;
  }

  #purgeExpired(now: number): void {
    for (const [id, preview] of this.#previews) {
      if (preview.createdAtMs + 15_000 <= now) this.#previews.delete(id);
    }
  }

  #publicPreview(
    preview: StoredConnectionPreview,
  ): RelationshipConnectionPreviewDto {
    const { createdAtMs: _createdAtMs, ...publicPreview } = preview;
    return publicPreview;
  }

  #now(): string {
    return this.#clock().toISOString();
  }
}
