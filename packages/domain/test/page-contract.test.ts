import { describe, expect, expectTypeOf, it } from "vitest";

import {
  LUCIDE_ICON_CATALOG_VERSION,
  PAGE_SCHEMA_VERSION,
  PAGE_TYPES,
  PUBLISH_VALIDATION_CODES,
  type CreatePageRequest,
  type DeletePageRequest,
  type PageDto,
  type RuntimeNavigationDto,
} from "../src/index.js";

describe("page contracts", () => {
  it("exposes only the real Phase 4 page type and pinned icon catalog", () => {
    expect(PAGE_TYPES).toEqual(["blank"]);
    expect(PAGE_SCHEMA_VERSION).toBe(1);
    expect(LUCIDE_ICON_CATALOG_VERSION).toBe("1.31.0");
    expect(PUBLISH_VALIDATION_CODES).toEqual(["ALL_NAVIGATION_HIDDEN"]);
  });

  it("keeps optimistic project revisions and idempotency in mutations", () => {
    expectTypeOf<CreatePageRequest>().toHaveProperty("expectedProjectRevision");
    expectTypeOf<CreatePageRequest>().toHaveProperty("idempotencyKey");
    expectTypeOf<DeletePageRequest>().toHaveProperty("expectedRevision");
    expectTypeOf<DeletePageRequest>().toHaveProperty("expectedProjectRevision");
  });

  it("keeps draft tombstones out of published navigation DTOs", () => {
    expectTypeOf<PageDto>().toHaveProperty("deletedAt");
    expectTypeOf<RuntimeNavigationDto["pages"][number]>().not.toHaveProperty(
      "deletedAt",
    );
  });
});
