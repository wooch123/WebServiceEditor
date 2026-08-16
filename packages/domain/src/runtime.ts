import type { BindingExecutionDto } from "./binding-query.js";
import type { DataSchemaExportDto } from "./data-schema.js";
import type { RelationshipBindingDto } from "./data-relationship.js";
import type { ElementEntryDto } from "./element.js";
import type { PublishedNavigationPageDto } from "./page.js";

export const PROJECT_DEFINITION_SCHEMA_VERSION = 1 as const;
export const DRAFT_PREVIEW_TTL_MILLISECONDS = 5 * 60 * 1000;
export const DRAFT_PREVIEW_CAPACITY = 128;

export interface ProjectDefinitionSnapshotDto {
  readonly definitionSchemaVersion: typeof PROJECT_DEFINITION_SCHEMA_VERSION;
  readonly projectId: string;
  readonly sourceProjectRevision: number;
  readonly themeId: string;
  readonly registryChecksum: string;
  readonly pages: readonly PublishedNavigationPageDto[];
  readonly elements: readonly ElementEntryDto[];
  readonly layoutRevisions: readonly unknown[];
  readonly bindings: readonly RelationshipBindingDto[];
  readonly dataSchema: DataSchemaExportDto;
}

export interface RuntimeSnapshotMetadataDto {
  readonly projectId: string;
  readonly snapshotId: string;
  readonly sourceProjectRevision: number;
  readonly themeId: string;
  readonly definitionChecksum: string;
  readonly registryChecksum: string;
  readonly createdAt: string;
}

export interface DraftPreviewDto extends RuntimeSnapshotMetadataDto {
  readonly previewId: string;
  readonly expiresAt: string;
  readonly defaultRoute: string | null;
}

export interface DraftRuntimeNavigationDto extends RuntimeSnapshotMetadataDto {
  readonly previewId: string;
  readonly expiresAt: string;
  readonly pages: readonly PublishedNavigationPageDto[];
}

export interface DraftRuntimePageDto extends RuntimeSnapshotMetadataDto {
  readonly previewId: string;
  readonly expiresAt: string;
  readonly page: PublishedNavigationPageDto;
  readonly elements: readonly ElementEntryDto[];
  readonly bindings: readonly RelationshipBindingDto[];
}

export interface PublishedRuntimeDefinitionPageDto extends RuntimeSnapshotMetadataDto {
  readonly versionId: string;
  readonly publishedAt: string;
  readonly page: PublishedNavigationPageDto;
  readonly elements: readonly ElementEntryDto[];
  readonly bindings: readonly RelationshipBindingDto[];
}

export interface RuntimeBindingResultDto extends BindingExecutionDto {
  readonly snapshotId: string;
  readonly definitionChecksum: string;
}
