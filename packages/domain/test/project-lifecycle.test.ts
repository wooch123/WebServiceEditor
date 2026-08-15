import { describe, expect, it } from "vitest";

import {
  PROJECT_LIFECYCLE_STATUSES,
  canTransitionProjectLifecycle,
  isProjectLifecycleStatus,
} from "../src/index.js";

describe("project lifecycle", () => {
  it("keeps the canonical lifecycle inventory, including purge recovery", () => {
    expect(PROJECT_LIFECYCLE_STATUSES).toEqual([
      "ACTIVE",
      "TRASHING",
      "TRASHED",
      "RESTORING",
      "PURGING",
      "PURGE_FAILED",
      "PURGED",
    ]);
  });

  it("recognizes only canonical lifecycle values", () => {
    expect(isProjectLifecycleStatus("ACTIVE")).toBe(true);
    expect(isProjectLifecycleStatus("DELETED")).toBe(false);
    expect(isProjectLifecycleStatus(null)).toBe(false);
  });

  it("allows recovery transitions but keeps PURGED terminal", () => {
    expect(canTransitionProjectLifecycle("TRASHING", "ACTIVE")).toBe(true);
    expect(canTransitionProjectLifecycle("PURGING", "PURGE_FAILED")).toBe(true);
    expect(canTransitionProjectLifecycle("PURGE_FAILED", "PURGING")).toBe(true);
    expect(canTransitionProjectLifecycle("PURGED", "ACTIVE")).toBe(false);
  });
});
