import { describe, expect, it } from "vitest";

import { MetadataDatabase } from "../../src/metadata/database.js";

describe("MetadataDatabase", () => {
  it("applies the initial schema transactionally and reports readiness", () => {
    const database = new MetadataDatabase(":memory:");

    try {
      expect(database.assertReady()).toMatchObject({
        foreignKeysEnabled: true,
        integrity: "ok",
        schemaVersion: 3,
      });
    } finally {
      database.close();
    }
  });
});
