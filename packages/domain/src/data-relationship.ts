export const DATA_RELATIONSHIP_SCHEMA_VERSION = 1 as const;
export const DATA_RELATIONSHIP_EXPORT_SCHEMA_VERSION = 2 as const;

export const RELATIONSHIP_NODE_TYPES = ["page", "element", "table"] as const;
export const RELATIONSHIP_BINDING_TYPES = [
  "CONTAINS",
  "READ",
  "CREATE",
  "UPDATE",
  "DELETE",
  "FILTER",
  "NAVIGATE",
  "RELATION",
] as const;
export const RELATIONSHIP_BINDING_STATUSES = ["READY", "DISABLED"] as const;
export const RELATIONSHIP_HISTORY_STATES = [
  "APPLIED",
  "UNDONE",
  "DISCARDED",
] as const;

export type RelationshipNodeType = (typeof RELATIONSHIP_NODE_TYPES)[number];
export type RelationshipBindingType =
  (typeof RELATIONSHIP_BINDING_TYPES)[number];
export type RelationshipBindingStatus =
  (typeof RELATIONSHIP_BINDING_STATUSES)[number];
export type RelationshipHistoryState =
  (typeof RELATIONSHIP_HISTORY_STATES)[number];

export interface RelationshipPortDto {
  readonly id: string;
  readonly nodeId: string;
  readonly objectId: string;
  readonly role: string;
  readonly label: string;
  readonly direction: "input" | "output";
  readonly side: "left" | "right";
  readonly valueType: string;
  readonly allowedBindingTypes: readonly RelationshipBindingType[];
  readonly maxConnections: number | null;
}

export interface RelationshipNodeDto {
  readonly id: string;
  readonly objectId: string;
  readonly type: RelationshipNodeType;
  readonly label: string;
  readonly subtitle: string;
  readonly iconName: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly pinned: boolean;
  readonly positionRevision: number;
  readonly ports: readonly RelationshipPortDto[];
}

export interface RelationshipNodePositionDto {
  readonly nodeId: string;
  readonly nodeType: RelationshipNodeType;
  readonly objectId: string;
  readonly x: number;
  readonly y: number;
  readonly pinned: boolean;
  readonly revision: number;
}

export interface RelationshipViewportDto {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
  readonly revision: number;
}

export interface RelationshipRoutePointDto {
  readonly x: number;
  readonly y: number;
}

export interface RelationshipEdgeRouteDto {
  readonly bindingId: string;
  readonly points: readonly RelationshipRoutePointDto[];
  readonly bendCount: number;
  readonly crossesNode: false;
}

export interface BindingEndpointDto {
  readonly nodeType: RelationshipNodeType;
  readonly nodeId: string;
  readonly objectId: string;
  readonly portId: string;
  readonly portRole: string;
  readonly direction: "input" | "output";
  readonly side: "left" | "right";
  readonly valueType: string;
}

export interface RelationshipBindingDto {
  readonly id: string;
  readonly projectId: string;
  readonly bindingType: RelationshipBindingType;
  readonly source: BindingEndpointDto;
  readonly target: BindingEndpointDto;
  readonly query: Readonly<Record<string, unknown>>;
  readonly mapping: Readonly<Record<string, unknown>>;
  readonly status: RelationshipBindingStatus;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface DataRelationshipGraphDto {
  readonly schemaVersion: typeof DATA_RELATIONSHIP_SCHEMA_VERSION;
  readonly projectId: string;
  readonly graphRevision: number;
  readonly projectRevision: number;
  readonly nodes: readonly RelationshipNodeDto[];
  /** Visual edges are the canonical Binding records, not a second model. */
  readonly edges: readonly RelationshipBindingDto[];
  /** Routes are derived geometry keyed by the canonical Binding ID. */
  readonly routes: readonly RelationshipEdgeRouteDto[];
  readonly viewport: RelationshipViewportDto;
}

export interface UpdateRelationshipNodePositionRequest {
  readonly x: number;
  readonly y: number;
  readonly pinned: boolean;
  readonly expectedPositionRevision: number;
  readonly expectedGraphRevision: number;
  readonly expectedProjectRevision: number;
  readonly idempotencyKey: string;
}

export interface RelationshipNodePositionMutationDto {
  readonly position: RelationshipNodePositionDto;
  readonly routes: readonly RelationshipEdgeRouteDto[];
  readonly graphRevision: number;
  readonly projectRevision: number;
  readonly commandId: string;
}

export interface UpdateRelationshipViewportRequest {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
  readonly expectedRevision: number;
}

export interface RelationshipRoutePreviewRequest {
  readonly positions: readonly RelationshipNodePositionDto[];
  readonly expectedGraphRevision: number;
  readonly expectedProjectRevision: number;
}

export interface RelationshipRoutePreviewDto {
  readonly projectId: string;
  readonly routes: readonly RelationshipEdgeRouteDto[];
  readonly graphRevision: number;
  readonly projectRevision: number;
}

export interface PreviewRelationshipAutoLayoutRequest {
  readonly action: "PREVIEW";
  readonly expectedGraphRevision: number;
  readonly expectedProjectRevision: number;
}

export interface ApplyRelationshipAutoLayoutRequest {
  readonly action: "APPLY";
  readonly previewId: string;
  readonly expectedGraphRevision: number;
  readonly expectedProjectRevision: number;
  readonly idempotencyKey: string;
}

export interface RelationshipAutoLayoutPreviewDto {
  readonly action: "PREVIEW";
  readonly previewId: string;
  readonly projectId: string;
  readonly positions: readonly RelationshipNodePositionDto[];
  readonly routes: readonly RelationshipEdgeRouteDto[];
  readonly crossingCountBefore: number;
  readonly crossingCountAfter: number;
  readonly graphRevision: number;
  readonly projectRevision: number;
  readonly expiresAt: string;
}

export interface RelationshipAutoLayoutApplyDto {
  readonly action: "APPLY";
  readonly projectId: string;
  readonly positions: readonly RelationshipNodePositionDto[];
  readonly routes: readonly RelationshipEdgeRouteDto[];
  readonly graphRevision: number;
  readonly projectRevision: number;
  readonly commandId: string;
}

export interface RelationshipLayoutCommandDto {
  readonly id: string;
  readonly commandType: "MOVE_NODE" | "AUTO_LAYOUT";
  readonly state: RelationshipHistoryState;
  readonly createdAt: string;
}

export interface RelationshipLayoutHistoryDto {
  readonly projectId: string;
  readonly graphRevision: number;
  readonly projectRevision: number;
  readonly undo: RelationshipLayoutCommandDto | null;
  readonly redo: RelationshipLayoutCommandDto | null;
}

export interface RelationshipLayoutHistoryMutationRequest {
  readonly expectedGraphRevision: number;
  readonly expectedProjectRevision: number;
  readonly expectedCommandId: string;
  readonly idempotencyKey: string;
}

export interface RelationshipLayoutHistoryMutationDto {
  readonly projectId: string;
  readonly operation: "UNDO" | "REDO";
  readonly commandId: string;
  readonly positions: readonly RelationshipNodePositionDto[];
  readonly routes: readonly RelationshipEdgeRouteDto[];
  readonly graphRevision: number;
  readonly projectRevision: number;
}

export interface PreviewRelationshipConnectionRequest {
  readonly sourcePortId: string;
  readonly targetPortId: string;
  readonly expectedGraphRevision: number;
  readonly expectedProjectRevision: number;
}

export interface RelationshipConnectionPreviewDto {
  readonly previewId: string;
  readonly projectId: string;
  readonly source: BindingEndpointDto;
  readonly target: BindingEndpointDto;
  readonly compatible: boolean;
  readonly allowedBindingTypes: readonly RelationshipBindingType[];
  readonly issues: readonly string[];
  readonly graphRevision: number;
  readonly projectRevision: number;
  readonly expiresAt: string;
}

export interface CreateRelationshipBindingRequest {
  readonly previewId: string;
  readonly bindingType: RelationshipBindingType;
  /** Required for READ. The server consumes the matching Wizard preview. */
  readonly queryPreviewId?: string;
  /** Required for CREATE, UPDATE, and DELETE. */
  readonly mutation?: import("./binding-query.js").ConfigureBindingMutationRequestDto;
  readonly expectedGraphRevision: number;
  readonly expectedProjectRevision: number;
  readonly idempotencyKey: string;
}

export interface PatchRelationshipBindingRequest {
  readonly expectedRevision: number;
  readonly expectedGraphRevision: number;
  readonly expectedProjectRevision: number;
  readonly idempotencyKey: string;
  readonly query?: Readonly<Record<string, unknown>>;
  readonly mapping?: Readonly<Record<string, unknown>>;
  readonly status?: RelationshipBindingStatus;
}

export interface DeleteRelationshipBindingRequest {
  readonly expectedRevision: number;
  readonly expectedGraphRevision: number;
  readonly expectedProjectRevision: number;
  readonly idempotencyKey: string;
}

export interface RelationshipBindingMutationDto {
  readonly binding: RelationshipBindingDto;
  readonly graphRevision: number;
  readonly projectRevision: number;
  readonly commandId: string;
}

export interface DeleteRelationshipBindingDto {
  readonly deletedBindingId: string;
  readonly graphRevision: number;
  readonly projectRevision: number;
  readonly commandId: string;
}

export interface RelationshipHistoryCommandDto {
  readonly id: string;
  readonly commandType: "CREATE_BINDING" | "UPDATE_BINDING" | "DELETE_BINDING";
  readonly bindingId: string;
  readonly state: RelationshipHistoryState;
  readonly createdAt: string;
}

export interface RelationshipHistoryDto {
  readonly projectId: string;
  readonly graphRevision: number;
  readonly projectRevision: number;
  readonly undo: RelationshipHistoryCommandDto | null;
  readonly redo: RelationshipHistoryCommandDto | null;
}

export interface RelationshipHistoryMutationRequest {
  readonly expectedGraphRevision: number;
  readonly expectedProjectRevision: number;
  readonly expectedCommandId: string;
  readonly idempotencyKey: string;
}

export interface RelationshipHistoryMutationDto {
  readonly projectId: string;
  readonly graphRevision: number;
  readonly projectRevision: number;
  readonly commandId: string;
  readonly operation: "UNDO" | "REDO";
  readonly binding: RelationshipBindingDto;
}

export interface RelationshipBindingsExportDto {
  readonly schemaVersion: 1 | typeof DATA_RELATIONSHIP_EXPORT_SCHEMA_VERSION;
  readonly graphRevision: number;
  readonly bindings: readonly RelationshipBindingDto[];
  readonly nodePositions?: readonly RelationshipNodePositionDto[];
  readonly viewport?: RelationshipViewportDto;
}
