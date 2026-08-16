export const PAGE_SCHEMA_VERSION = 1 as const;
export const LUCIDE_ICON_CATALOG_VERSION = "1.31.0" as const;
export const PAGE_TYPES = ["blank"] as const;
export const PUBLISH_VALIDATION_CODES = ["ALL_NAVIGATION_HIDDEN"] as const;

export type PageType = (typeof PAGE_TYPES)[number];
export type PublishValidationCode = (typeof PUBLISH_VALIDATION_CODES)[number];

export interface PageDto {
  readonly id: string;
  readonly projectId: string;
  readonly schemaVersion: number;
  readonly revision: number;
  readonly name: string;
  readonly route: string;
  readonly pageType: PageType;
  readonly iconName: string;
  readonly iconCatalogVersion: typeof LUCIDE_ICON_CATALOG_VERSION;
  readonly navigationVisible: boolean;
  readonly navigationGroup: string | null;
  readonly sortOrder: number;
  readonly deletedAt: string | null;
}

export interface CreatePageRequest {
  readonly name?: string;
  readonly pageType: "blank";
  readonly expectedProjectRevision: number;
  readonly idempotencyKey: string;
}

export interface PatchPageRequest {
  readonly expectedRevision: number;
  readonly expectedProjectRevision: number;
  readonly name?: string;
  readonly route?: string;
  readonly navigationVisible?: boolean;
  readonly navigationGroup?: string | null;
}

export interface ReorderPagesRequest {
  readonly pageIds: readonly string[];
  readonly expectedProjectRevision: number;
  readonly idempotencyKey: string;
}

export interface PatchPageIconRequest {
  readonly iconName: string;
  readonly iconCatalogVersion: typeof LUCIDE_ICON_CATALOG_VERSION;
  readonly expectedRevision: number;
  readonly expectedProjectRevision: number;
}

export interface DeletePageImpact {
  readonly elementCount: number;
  readonly bindingCount: number;
  readonly navigationReferenceCount: number;
  readonly validationScenarioCount: number;
  readonly reassignNavigationToPageId: string | null;
}

export interface DeletePageRequest {
  readonly expectedRevision: number;
  readonly expectedProjectRevision: number;
  readonly idempotencyKey: string;
  readonly resolution: "DELETE_DEPENDENCIES";
  readonly reassignNavigationToPageId?: string;
}

export interface UndoPageCommandRequest {
  readonly expectedProjectRevision: number;
  readonly idempotencyKey: string;
}

export interface IconCatalogItemDto {
  readonly name: string;
  readonly dynamicName: string;
  readonly categories: readonly string[];
  readonly keywords: readonly string[];
}

export interface PublishedNavigationPageDto {
  readonly id: string;
  readonly name: string;
  readonly route: string;
  readonly sortOrder: number;
  readonly iconName: string;
  readonly iconCatalogVersion: typeof LUCIDE_ICON_CATALOG_VERSION;
  readonly navigationVisible: boolean;
  readonly navigationGroup: string | null;
}

export interface RuntimeNavigationDto {
  readonly projectId: string;
  readonly versionId: string;
  readonly publishedAt: string;
  readonly pages: readonly PublishedNavigationPageDto[];
  readonly variables?: readonly import("./project-variable.js").ProjectVariableDto[];
}

export interface PublishPlanDto {
  readonly projectId: string;
  readonly projectRevision: number;
  readonly pages: readonly PublishedNavigationPageDto[];
  readonly errors: readonly PublishValidationCode[];
  readonly warnings: readonly string[];
}
