import assert from "node:assert/strict";
import test from "node:test";

import { validateThemeExtension } from "../../scripts/verify-theme-extension.mjs";

test("theme extension preserves the canonical source and exposes 40 presets per group", async () => {
  const report = await validateThemeExtension();

  assert.equal(report.result, "PASS", JSON.stringify(report.failures, null, 2));
  assert.equal(report.details.canonicalThemeCount, 60);
  assert.equal(report.details.additionalThemeCount, 60);
  assert.equal(report.details.selectableThemeCount, 120);
  assert.deepEqual(report.details.groupCounts, {
    dark: 40,
    gray: 40,
    light: 40,
  });
  assert.equal(report.details.addedCssTokenValues, 3_120);
});
