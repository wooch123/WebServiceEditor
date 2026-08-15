import { randomUUID } from "node:crypto";

import type {
  ElementSizeRule,
  ElementType,
  PlacementCandidateDto,
} from "@webeditor/domain";

import { ApiError, assertApi } from "../errors.js";

export const PLACEMENT_CANDIDATE_TTL_MILLISECONDS = 15_000;
export const PLACEMENT_CANDIDATE_CAPACITY = 512;

export interface StoredPlacementCandidate extends PlacementCandidateDto {
  readonly projectId: string;
  readonly canvasHeight: number;
  readonly sizeRule: ElementSizeRule;
  consumedAt: string | null;
}

export interface PlacementCandidateStoreOptions {
  readonly clock?: () => Date;
  readonly ttlMilliseconds?: number;
  readonly capacity?: number;
}

export class PlacementCandidateStore {
  readonly #clock: () => Date;
  readonly #ttlMilliseconds: number;
  readonly #capacity: number;
  readonly #candidates = new Map<string, StoredPlacementCandidate>();

  constructor(options: PlacementCandidateStoreOptions = {}) {
    this.#clock = options.clock ?? (() => new Date());
    this.#ttlMilliseconds =
      options.ttlMilliseconds ?? PLACEMENT_CANDIDATE_TTL_MILLISECONDS;
    this.#capacity = options.capacity ?? PLACEMENT_CANDIDATE_CAPACITY;
    if (this.#ttlMilliseconds <= 0 || this.#capacity <= 0) {
      throw new Error("Placement candidate store bounds must be positive");
    }
  }

  create(input: {
    readonly projectId: string;
    readonly pageId: string;
    readonly elementType: ElementType;
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
    readonly valid: boolean;
    readonly collisionResolved: boolean;
    readonly layoutRevision: number;
    readonly projectRevision: number;
    readonly canvasHeight: number;
    readonly sizeRule: ElementSizeRule;
  }): StoredPlacementCandidate {
    this.#purgeExpired(this.#clock().getTime());
    while (this.#candidates.size >= this.#capacity) {
      const oldest = this.#candidates.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.#candidates.delete(oldest);
    }
    const now = this.#clock();
    const candidate: StoredPlacementCandidate = {
      candidateId: randomUUID(),
      projectId: input.projectId,
      pageId: input.pageId,
      elementType: input.elementType,
      breakpoint: "desktop",
      x: input.x,
      y: input.y,
      w: input.w,
      h: input.h,
      valid: input.valid,
      collisionResolved: input.collisionResolved,
      layoutRevision: input.layoutRevision,
      projectRevision: input.projectRevision,
      canvasHeight: input.canvasHeight,
      expiresAt: new Date(now.getTime() + this.#ttlMilliseconds).toISOString(),
      sizeRule: { ...input.sizeRule },
      consumedAt: null,
    };
    this.#candidates.set(candidate.candidateId, candidate);
    return candidate;
  }

  consume(input: {
    readonly candidateId: unknown;
    readonly projectId: string;
    readonly pageId: string;
    readonly expectedLayoutRevision: number;
    readonly expectedProjectRevision: number;
  }): StoredPlacementCandidate {
    const now = this.#clock().getTime();
    const candidateId =
      typeof input.candidateId === "string" ? input.candidateId : undefined;
    const candidate =
      candidateId === undefined ? undefined : this.#candidates.get(candidateId);
    const candidateExpired =
      candidate !== undefined && Date.parse(candidate.expiresAt) <= now;
    this.#purgeExpired(now);
    assertApi(
      candidateId !== undefined &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          candidateId,
        ),
      400,
      "PLACEMENT_CANDIDATE_NOT_FOUND",
      "Placement candidate was not found",
    );
    assertApi(
      candidate !== undefined,
      404,
      "PLACEMENT_CANDIDATE_NOT_FOUND",
      "Placement candidate was not found",
    );
    assertApi(
      candidate.projectId === input.projectId &&
        candidate.pageId === input.pageId,
      409,
      "PLACEMENT_CANDIDATE_PAGE_MISMATCH",
      "Placement candidate belongs to another page",
    );
    if (candidateExpired) {
      throw new ApiError(
        409,
        "PLACEMENT_CANDIDATE_EXPIRED",
        "Placement candidate has expired",
      );
    }
    assertApi(
      candidate.consumedAt === null &&
        candidate.layoutRevision === input.expectedLayoutRevision &&
        candidate.projectRevision === input.expectedProjectRevision,
      409,
      "PLACEMENT_CANDIDATE_STALE",
      "Placement candidate is stale or already consumed",
    );
    assertApi(
      candidate.valid,
      409,
      "PLACEMENT_CANDIDATE_INVALID",
      "Placement candidate is not valid",
    );
    candidate.consumedAt = this.#clock().toISOString();
    return candidate;
  }

  release(candidateId: string): void {
    const candidate = this.#candidates.get(candidateId);
    if (candidate !== undefined) candidate.consumedAt = null;
  }

  get size(): number {
    return this.#candidates.size;
  }

  #purgeExpired(now: number): void {
    for (const [candidateId, candidate] of this.#candidates) {
      if (Date.parse(candidate.expiresAt) <= now) {
        this.#candidates.delete(candidateId);
      }
    }
  }
}

export function publicCandidate(
  candidate: StoredPlacementCandidate,
): PlacementCandidateDto {
  const {
    projectId: _projectId,
    canvasHeight: _canvasHeight,
    sizeRule: _sizeRule,
    consumedAt: _consumedAt,
    ...dto
  } = candidate;
  return dto;
}
