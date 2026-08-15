import { describe, expect, it } from "vitest";

import { ApiError } from "../../src/errors.js";
import {
  PLACEMENT_CANDIDATE_CAPACITY,
  PLACEMENT_CANDIDATE_TTL_MILLISECONDS,
  PlacementCandidateStore,
  publicCandidate,
} from "../../src/elements/placement-candidate-store.js";

const projectId = "00000000-0000-4000-8000-000000000001";
const pageId = "00000000-0000-4000-8000-000000000002";
const sizeRule = {
  defaultW: 6,
  defaultH: 5,
  minW: 2,
  minH: 3,
  maxW: 24,
  maxH: 20,
};

function codeOf(operation: () => unknown): string | undefined {
  try {
    operation();
    return undefined;
  } catch (error) {
    return error instanceof ApiError ? error.code : undefined;
  }
}

describe("PlacementCandidateStore", () => {
  it("freezes the production TTL and capacity", () => {
    expect(PLACEMENT_CANDIDATE_TTL_MILLISECONDS).toBe(15_000);
    expect(PLACEMENT_CANDIDATE_CAPACITY).toBe(512);
  });

  it("consumes once and rejects cross-page reuse", () => {
    const store = new PlacementCandidateStore();
    const candidate = store.create({
      projectId,
      pageId,
      elementType: "text",
      x: 0,
      y: 0,
      w: 6,
      h: 5,
      valid: true,
      collisionResolved: false,
      layoutRevision: 2,
      projectRevision: 3,
      canvasHeight: 640,
      sizeRule,
    });
    expect(candidate.canvasHeight).toBe(640);
    expect(publicCandidate(candidate)).not.toHaveProperty("canvasHeight");
    expect(
      codeOf(() =>
        store.consume({
          candidateId: candidate.candidateId,
          projectId,
          pageId: "00000000-0000-4000-8000-000000000003",
          expectedLayoutRevision: 2,
          expectedProjectRevision: 3,
        }),
      ),
    ).toBe("PLACEMENT_CANDIDATE_PAGE_MISMATCH");
    store.consume({
      candidateId: candidate.candidateId,
      projectId,
      pageId,
      expectedLayoutRevision: 2,
      expectedProjectRevision: 3,
    });
    expect(
      codeOf(() =>
        store.consume({
          candidateId: candidate.candidateId,
          projectId,
          pageId,
          expectedLayoutRevision: 2,
          expectedProjectRevision: 3,
        }),
      ),
    ).toBe("PLACEMENT_CANDIDATE_STALE");
  });

  it("removes expired entries and evicts the oldest at capacity", () => {
    let now = Date.parse("2026-08-16T00:00:00.000Z");
    const store = new PlacementCandidateStore({
      clock: () => new Date(now),
      ttlMilliseconds: 10,
      capacity: 2,
    });
    const first = store.create({
      projectId,
      pageId,
      elementType: "text",
      x: 0,
      y: 0,
      w: 6,
      h: 5,
      valid: true,
      collisionResolved: false,
      layoutRevision: 0,
      projectRevision: 0,
      canvasHeight: 640,
      sizeRule,
    });
    now += 11;
    expect(
      codeOf(() =>
        store.consume({
          candidateId: first.candidateId,
          projectId,
          pageId,
          expectedLayoutRevision: 0,
          expectedProjectRevision: 0,
        }),
      ),
    ).toBe("PLACEMENT_CANDIDATE_EXPIRED");
    expect(store.size).toBe(0);

    const inputs = [0, 1, 2].map((x) =>
      store.create({
        projectId,
        pageId,
        elementType: "text",
        x,
        y: 0,
        w: 6,
        h: 5,
        valid: true,
        collisionResolved: false,
        layoutRevision: 0,
        projectRevision: 0,
        canvasHeight: 640,
        sizeRule,
      }),
    );
    expect(store.size).toBe(2);
    expect(
      codeOf(() =>
        store.consume({
          candidateId: inputs[0]?.candidateId,
          projectId,
          pageId,
          expectedLayoutRevision: 0,
          expectedProjectRevision: 0,
        }),
      ),
    ).toBe("PLACEMENT_CANDIDATE_NOT_FOUND");
  });

  it("purges other expired entries when consuming a live candidate", () => {
    let now = Date.parse("2026-08-16T00:00:00.000Z");
    const store = new PlacementCandidateStore({
      clock: () => new Date(now),
      ttlMilliseconds: 10,
      capacity: 3,
    });
    store.create({
      projectId,
      pageId,
      elementType: "text",
      x: 0,
      y: 0,
      w: 6,
      h: 5,
      valid: true,
      collisionResolved: false,
      layoutRevision: 0,
      projectRevision: 0,
      canvasHeight: 640,
      sizeRule,
    });
    now += 6;
    const live = store.create({
      projectId,
      pageId,
      elementType: "button",
      x: 6,
      y: 0,
      w: 4,
      h: 5,
      valid: true,
      collisionResolved: true,
      layoutRevision: 0,
      projectRevision: 0,
      canvasHeight: 640,
      sizeRule,
    });
    now += 5;

    store.consume({
      candidateId: live.candidateId,
      projectId,
      pageId,
      expectedLayoutRevision: 0,
      expectedProjectRevision: 0,
    });
    expect(store.size).toBe(1);
  });

  it("purges expired entries before rejecting a malformed consume request", () => {
    let now = Date.parse("2026-08-16T00:00:00.000Z");
    const store = new PlacementCandidateStore({
      clock: () => new Date(now),
      ttlMilliseconds: 10,
    });
    store.create({
      projectId,
      pageId,
      elementType: "text",
      x: 0,
      y: 0,
      w: 6,
      h: 5,
      valid: true,
      collisionResolved: false,
      layoutRevision: 0,
      projectRevision: 0,
      canvasHeight: 640,
      sizeRule,
    });
    now += 11;

    expect(
      codeOf(() =>
        store.consume({
          candidateId: "malformed",
          projectId,
          pageId,
          expectedLayoutRevision: 0,
          expectedProjectRevision: 0,
        }),
      ),
    ).toBe("PLACEMENT_CANDIDATE_NOT_FOUND");
    expect(store.size).toBe(0);
  });
});
