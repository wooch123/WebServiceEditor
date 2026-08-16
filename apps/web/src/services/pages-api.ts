export const LUCIDE_CATALOG_VERSION = "1.31.0" as const;

export interface PageDto {
  id: string;
  projectId: string;
  schemaVersion: number;
  revision: number;
  name: string;
  route: string;
  pageType: "blank";
  iconName: string;
  iconCatalogVersion: typeof LUCIDE_CATALOG_VERSION;
  navigationVisible: boolean;
  navigationGroup: string | null;
  sortOrder: number;
  deletedAt: string | null;
}

export interface IconCatalogItem {
  name: string;
  dynamicName: string;
  categories: string[];
  keywords: string[];
}

export interface DeleteImpact {
  elementCount: number;
  bindingCount: number;
  navigationReferenceCount: number;
  validationScenarioCount: number;
  reassignNavigationToPageId: string | null;
}

export interface PublishPlan {
  projectId: string;
  projectRevision: number;
  pages: RuntimePageDto[];
  errors: string[];
  warnings: string[];
}

export interface RuntimePageDto {
  id: string;
  name: string;
  route: string;
  sortOrder: number;
  iconName: string;
  iconCatalogVersion: typeof LUCIDE_CATALOG_VERSION;
  navigationVisible: boolean;
  navigationGroup: string | null;
}

export interface RuntimeNavigationDto {
  projectId: string;
  versionId: string;
  publishedAt: string;
  snapshotId?: string;
  sourceProjectRevision?: number;
  themeId?: string;
  definitionChecksum?: string;
  registryChecksum?: string;
  createdAt?: string;
  pages: RuntimePageDto[];
}

export interface DraftPreviewDto {
  projectId: string;
  previewId: string;
  snapshotId: string;
  sourceProjectRevision: number;
  themeId: string;
  definitionChecksum: string;
  registryChecksum: string;
  createdAt: string;
  expiresAt: string;
  defaultRoute: string | null;
}

export interface DraftRuntimeNavigationDto extends Omit<
  RuntimeNavigationDto,
  "versionId" | "publishedAt"
> {
  previewId: string;
  expiresAt: string;
}

interface ApiErrorEnvelope {
  error?: { code?: unknown; message?: unknown; details?: unknown };
}

export class PagesApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(
    message: string,
    options: { status: number; code?: string; details?: unknown },
  ) {
    super(message);
    this.name = "PagesApiError";
    this.status = options.status;
    this.code = options.code ?? "HTTP_ERROR";
    this.details = options.details;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  if (init.body !== undefined) headers.set("content-type", "application/json");
  const response = await fetch(path, { ...init, headers });
  if (!response.ok) {
    let envelope: ApiErrorEnvelope = {};
    try {
      envelope = (await response.json()) as ApiErrorEnvelope;
    } catch {
      // A status-based fallback is clearer than exposing an invalid body.
    }
    const error = envelope.error;
    throw new PagesApiError(
      typeof error?.message === "string" ? error.message : "요청 실패",
      {
        status: response.status,
        ...(typeof error?.code === "string" ? { code: error.code } : {}),
        ...(error?.details === undefined ? {} : { details: error.details }),
      },
    );
  }
  return (await response.json()) as T;
}

function idempotencyKey(scope: string): string {
  return `${scope}:${crypto.randomUUID()}`;
}

export function listPages(projectId: string) {
  return request<{
    pages: PageDto[];
    projectRevision: number;
    publishedVersionId: string | null;
  }>(`/api/v1/projects/${encodeURIComponent(projectId)}/pages`);
}

export function createBlankPage(projectId: string, projectRevision: number) {
  return request<{ page: PageDto; projectRevision: number }>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/pages`,
    {
      method: "POST",
      body: JSON.stringify({
        pageType: "blank",
        expectedProjectRevision: projectRevision,
        idempotencyKey: idempotencyKey(`page-create:${projectId}`),
      }),
    },
  );
}

export function updatePage(
  page: PageDto,
  projectRevision: number,
  changes: Partial<
    Pick<PageDto, "name" | "route" | "navigationVisible" | "navigationGroup">
  >,
) {
  return request<{ page: PageDto; projectRevision: number }>(
    `/api/v1/pages/${encodeURIComponent(page.id)}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        expectedRevision: page.revision,
        expectedProjectRevision: projectRevision,
        ...changes,
      }),
    },
  );
}

export function reorderPages(
  projectId: string,
  pageIds: string[],
  projectRevision: number,
) {
  return request<{ pages: PageDto[]; projectRevision: number }>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/pages/reorder`,
    {
      method: "POST",
      body: JSON.stringify({
        pageIds,
        expectedProjectRevision: projectRevision,
        idempotencyKey: idempotencyKey(`page-reorder:${projectId}`),
      }),
    },
  );
}

export function updatePageIcon(
  page: PageDto,
  projectRevision: number,
  iconName: string,
) {
  return request<{ page: PageDto; projectRevision: number }>(
    `/api/v1/pages/${encodeURIComponent(page.id)}/icon`,
    {
      method: "PATCH",
      body: JSON.stringify({
        iconName,
        iconCatalogVersion: LUCIDE_CATALOG_VERSION,
        expectedRevision: page.revision,
        expectedProjectRevision: projectRevision,
      }),
    },
  );
}

export function deletePage(page: PageDto, projectRevision: number) {
  return request<{
    commandId: string;
    impact: DeleteImpact;
    projectRevision: number;
  }>(`/api/v1/pages/${encodeURIComponent(page.id)}`, {
    method: "DELETE",
    body: JSON.stringify({
      expectedRevision: page.revision,
      expectedProjectRevision: projectRevision,
      idempotencyKey: idempotencyKey(`page-delete:${page.id}`),
      resolution: "DELETE_DEPENDENCIES",
    }),
  });
}

export function planPageDelete(page: PageDto, projectRevision: number) {
  return request<{
    impact: DeleteImpact;
    allowedResolutions: ["DELETE_DEPENDENCIES"];
  }>(`/api/v1/pages/${encodeURIComponent(page.id)}/delete-plan`, {
    method: "POST",
    body: JSON.stringify({
      expectedRevision: page.revision,
      expectedProjectRevision: projectRevision,
    }),
  });
}

export function undoPageDelete(
  projectId: string,
  commandId: string,
  projectRevision: number,
) {
  return request<{ page: PageDto; projectRevision: number }>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/pages/commands/${encodeURIComponent(commandId)}/undo`,
    {
      method: "POST",
      body: JSON.stringify({
        expectedProjectRevision: projectRevision,
        idempotencyKey: idempotencyKey(`page-undo:${commandId}`),
      }),
    },
  );
}

export function listIcons(input: {
  query?: string;
  category?: string;
  cursor?: string;
}) {
  const params = new URLSearchParams();
  if (input.query) params.set("query", input.query);
  if (input.category) params.set("category", input.category);
  if (input.cursor) params.set("cursor", input.cursor);
  return request<{
    items: IconCatalogItem[];
    nextCursor: string | null;
    categories: string[];
  }>(`/api/v1/ui/icons?${params.toString()}`);
}

export function getIcon(iconName: string) {
  return request<{ item: IconCatalogItem }>(
    `/api/v1/ui/icons/${encodeURIComponent(iconName)}`,
  );
}

export function planPublish(projectId: string, projectRevision: number) {
  return request<{ plan: PublishPlan }>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/publish/plan`,
    {
      method: "POST",
      body: JSON.stringify({ expectedProjectRevision: projectRevision }),
    },
  );
}

export function publishProject(projectId: string, projectRevision: number) {
  return request<{
    versionId: string;
    publishedAt: string;
    projectRevision: number;
  }>(`/api/v1/projects/${encodeURIComponent(projectId)}/publish`, {
    method: "POST",
    body: JSON.stringify({
      expectedProjectRevision: projectRevision,
      idempotencyKey: idempotencyKey(`publish:${projectId}`),
    }),
  });
}

export function getRuntimeNavigation(projectId: string) {
  return request<RuntimeNavigationDto>(
    `/api/v1/runtime/${encodeURIComponent(projectId)}/navigation`,
  );
}

export function createDraftPreview(
  projectId: string,
  expectedProjectRevision: number,
) {
  return request<DraftPreviewDto>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/draft-previews`,
    {
      method: "POST",
      body: JSON.stringify({ expectedProjectRevision }),
    },
  );
}

export function getDraftRuntimeNavigation(previewId: string) {
  return request<DraftRuntimeNavigationDto>(
    `/api/v1/draft-previews/${encodeURIComponent(previewId)}/navigation`,
  );
}
