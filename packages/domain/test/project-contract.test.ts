import { describe, expect, expectTypeOf, it } from "vitest";

import {
  PROJECT_STATUSES,
  RESTORE_CONFLICT_RESOLUTIONS,
  type ProjectDto,
  type RestoreProjectRequest,
} from "../src/index.js";

describe("project contracts", () => {
  it("keeps the project and restore policy inventories explicit", () => {
    expect(PROJECT_STATUSES).toEqual(["DRAFT", "PUBLISHED"]);
    expect(RESTORE_CONFLICT_RESOLUTIONS).toEqual([
      "KEEP_ORIGINAL",
      "RENAME",
      "NEW_SLUG",
    ]);
  });

  it("does not expose server storage paths in the public DTO", () => {
    expectTypeOf<ProjectDto>().not.toHaveProperty("currentStoragePath");
    expectTypeOf<ProjectDto>().not.toHaveProperty("trashStoragePath");
    expectTypeOf<ProjectDto>().toHaveProperty("lifecycleRevision");
    expectTypeOf<ProjectDto>().toHaveProperty("counts");
  });

  it("requires lifecycle concurrency and idempotency for restore", () => {
    expectTypeOf<RestoreProjectRequest>().toHaveProperty(
      "expectedLifecycleRevision",
    );
    expectTypeOf<RestoreProjectRequest>().toHaveProperty("idempotencyKey");
  });
});
