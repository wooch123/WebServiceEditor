import { randomUUID } from "node:crypto";

import type {
  LayoutPresetApplyMode,
  LayoutPresetBindingPlaceholderDto,
  LayoutPresetDefinition,
  LayoutPresetId,
  LayoutPresetPreviewDto,
  LayoutPresetProposedElementDto,
  LayoutPresetSuggestedSchemaProposal,
  LayoutPresetWarningDto,
} from "@webeditor/domain";

import { ApiError, assertApi } from "../errors.js";

export const LAYOUT_PRESET_PREVIEW_TTL_MILLISECONDS = 5 * 60 * 1000;
export const LAYOUT_PRESET_PREVIEW_CAPACITY = 256;

export interface StoredLayoutPresetPreview extends LayoutPresetPreviewDto {
  readonly instanceId: string;
  readonly projectId: string;
  consumedAt: string | null;
}

export interface LayoutPresetPreviewStoreOptions {
  readonly clock?: () => Date;
  readonly ttlMilliseconds?: number;
  readonly capacity?: number;
}

export class LayoutPresetPreviewStore {
  readonly #clock: () => Date;
  readonly #ttlMilliseconds: number;
  readonly #capacity: number;
  readonly #previews = new Map<string, StoredLayoutPresetPreview>();

  constructor(options: LayoutPresetPreviewStoreOptions = {}) {
    this.#clock = options.clock ?? (() => new Date());
    this.#ttlMilliseconds =
      options.ttlMilliseconds ?? LAYOUT_PRESET_PREVIEW_TTL_MILLISECONDS;
    this.#capacity = options.capacity ?? LAYOUT_PRESET_PREVIEW_CAPACITY;
    if (this.#ttlMilliseconds <= 0 || this.#capacity <= 0) {
      throw new Error("Layout Preset candidate bounds must be positive");
    }
  }

  create(input: {
    readonly instanceId: string;
    readonly projectId: string;
    readonly presetId: LayoutPresetId;
    readonly presetVersion: 1;
    readonly presetSnapshot: LayoutPresetDefinition;
    readonly registryChecksum: string;
    readonly coordinateChecksum: string;
    readonly pageId: string;
    readonly mode: LayoutPresetApplyMode;
    readonly existingElementCount: number;
    readonly proposedElements: readonly LayoutPresetProposedElementDto[];
    readonly deletedElementIds: readonly string[];
    readonly suggestedSchema: LayoutPresetSuggestedSchemaProposal | null;
    readonly bindingPlaceholders: readonly Omit<
      LayoutPresetBindingPlaceholderDto,
      "instanceId"
    >[];
    readonly warnings: readonly LayoutPresetWarningDto[];
    readonly layoutRevision: number;
    readonly projectRevision: number;
  }): StoredLayoutPresetPreview {
    this.#purgeExpired(this.#clock().getTime());
    while (this.#previews.size >= this.#capacity) {
      const oldest = this.#previews.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.#previews.delete(oldest);
    }
    const now = this.#clock();
    const preview: StoredLayoutPresetPreview = {
      previewId: randomUUID(),
      instanceId: input.instanceId,
      projectId: input.projectId,
      presetId: input.presetId,
      presetVersion: input.presetVersion,
      presetSnapshot: input.presetSnapshot,
      registryChecksum: input.registryChecksum,
      coordinateChecksum: input.coordinateChecksum,
      pageId: input.pageId,
      mode: input.mode,
      existingElementCount: input.existingElementCount,
      createdElementCount: input.proposedElements.length,
      proposedElements: input.proposedElements,
      deletedElementIds: input.deletedElementIds,
      suggestedSchema: input.suggestedSchema,
      bindingPlaceholders: input.bindingPlaceholders,
      warnings: input.warnings,
      layoutRevision: input.layoutRevision,
      projectRevision: input.projectRevision,
      expiresAt: new Date(now.getTime() + this.#ttlMilliseconds).toISOString(),
      consumedAt: null,
    };
    this.#previews.set(preview.previewId, preview);
    return preview;
  }

  consume(input: {
    readonly previewId: unknown;
    readonly projectId: string;
    readonly pageId: string;
    readonly presetId: LayoutPresetId;
    readonly expectedLayoutRevision: number;
    readonly expectedProjectRevision: number;
  }): StoredLayoutPresetPreview {
    const now = this.#clock().getTime();
    const previewId =
      typeof input.previewId === "string" ? input.previewId : undefined;
    const candidate =
      previewId === undefined ? undefined : this.#previews.get(previewId);
    const expired =
      candidate !== undefined && Date.parse(candidate.expiresAt) <= now;
    this.#purgeExpired(now);
    assertApi(
      previewId !== undefined &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          previewId,
        ),
      400,
      "LAYOUT_PRESET_PREVIEW_NOT_FOUND",
      "Layout Preset preview was not found",
    );
    assertApi(
      candidate !== undefined,
      404,
      "LAYOUT_PRESET_PREVIEW_NOT_FOUND",
      "Layout Preset preview was not found",
    );
    assertApi(
      candidate.projectId === input.projectId &&
        candidate.pageId === input.pageId &&
        candidate.presetId === input.presetId,
      409,
      "LAYOUT_PRESET_PREVIEW_SCOPE_MISMATCH",
      "Layout Preset preview belongs to another scope",
    );
    if (expired) {
      throw new ApiError(
        409,
        "LAYOUT_PRESET_PREVIEW_EXPIRED",
        "Layout Preset preview has expired",
      );
    }
    assertApi(
      candidate.consumedAt === null &&
        candidate.layoutRevision === input.expectedLayoutRevision &&
        candidate.projectRevision === input.expectedProjectRevision,
      409,
      "LAYOUT_PRESET_PREVIEW_STALE",
      "Layout Preset preview is stale or already consumed",
    );
    candidate.consumedAt = this.#clock().toISOString();
    return candidate;
  }

  release(previewId: string): void {
    const candidate = this.#previews.get(previewId);
    if (candidate !== undefined) candidate.consumedAt = null;
  }

  get size(): number {
    return this.#previews.size;
  }

  #purgeExpired(now: number): void {
    for (const [previewId, candidate] of this.#previews) {
      if (Date.parse(candidate.expiresAt) <= now) {
        this.#previews.delete(previewId);
      }
    }
  }
}

export function publicLayoutPresetPreview(
  candidate: StoredLayoutPresetPreview,
): LayoutPresetPreviewDto {
  const {
    instanceId: _instanceId,
    projectId: _projectId,
    consumedAt: _consumedAt,
    ...preview
  } = candidate;
  return preview;
}
