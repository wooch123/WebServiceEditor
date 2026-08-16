import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  inspectCompletionHygiene,
  validateCompletionHygiene,
} from "../../scripts/verify-completion-hygiene.mjs";

const file = (path, source) => ({ path, source });

describe("Release completion hygiene", () => {
  it("passes the authoritative production and test inventories", async () => {
    const report = await validateCompletionHygiene();
    assert.equal(report.result, "PASS", JSON.stringify(report.failures));
  });

  it("accepts real placeholder properties without treating them as incomplete", () => {
    const inspection = inspectCompletionHygiene({
      productionFiles: [
        file(
          "Element.tsx",
          'return <input placeholder="검색" aria-label="검색" />;',
        ),
      ],
      testFiles: [file("Element.test.tsx", 'it("works", () => {});')],
    });
    assert.ok(Object.values(inspection).every((paths) => paths.length === 0));
  });

  it("rejects incomplete production markers and skipped tests", () => {
    const inspection = inspectCompletionHygiene({
      productionFiles: [
        file(
          "route.ts",
          "// TODO complete this\nreturn { code: 'NOT_IMPLEMENTED' };",
        ),
        file("View.tsx", "<Button onClick={() => {}}>Save</Button>"),
      ],
      testFiles: [file("route.test.ts", 'it.skip("later", () => {});')],
    });
    assert.deepEqual(inspection.commentMarkers, ["route.ts"]);
    assert.deepEqual(inspection.unsupportedRoutes, ["route.ts"]);
    assert.deepEqual(inspection.noOpUserActions, ["View.tsx"]);
    assert.deepEqual(inspection.skippedTests, ["route.test.ts"]);
  });
});
