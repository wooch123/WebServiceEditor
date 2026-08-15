import { describe, expect, it } from "vitest";

import {
  DATA_RELATIONSHIP_SCHEMA_VERSION,
  RELATIONSHIP_BINDING_STATUSES,
  RELATIONSHIP_BINDING_TYPES,
  RELATIONSHIP_HISTORY_STATES,
  RELATIONSHIP_NODE_TYPES,
} from "../src/index.js";

describe("Data Relationship contract", () => {
  it("keeps the Phase 9 node, Binding, status, and history inventories exact", () => {
    expect(DATA_RELATIONSHIP_SCHEMA_VERSION).toBe(1);
    expect(RELATIONSHIP_NODE_TYPES).toEqual(["page", "element", "table"]);
    expect(RELATIONSHIP_BINDING_TYPES).toEqual([
      "CONTAINS",
      "READ",
      "CREATE",
      "UPDATE",
      "DELETE",
      "FILTER",
      "NAVIGATE",
      "RELATION",
    ]);
    expect(RELATIONSHIP_BINDING_STATUSES).toEqual(["READY", "DISABLED"]);
    expect(RELATIONSHIP_HISTORY_STATES).toEqual([
      "APPLIED",
      "UNDONE",
      "DISCARDED",
    ]);
  });
});
