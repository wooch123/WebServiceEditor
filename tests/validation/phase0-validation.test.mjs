import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  Validation,
  sha256,
  validateExactSet,
} from "../../scripts/lib/verification.mjs";
import { validateCorpus } from "../../scripts/verify-corpus.mjs";
import { validatePhase0 } from "../../scripts/verify-phase0.mjs";
import { validateThemes } from "../../scripts/verify-themes.mjs";

describe("Phase 0 validation infrastructure", () => {
  it("matches the pinned source and traceability baseline", async () => {
    const report = await validatePhase0();

    assert.equal(
      report.result,
      "PASS",
      JSON.stringify(report.failures, null, 2),
    );
    assert.equal(report.details.artifactCount, 5);
    assert.equal(report.details.traceabilityCount, 37);
  });

  it("recalculates and validates all theme manifest invariants", async () => {
    const report = await validateThemes();

    assert.equal(
      report.result,
      "PASS",
      JSON.stringify(report.failures, null, 2),
    );
    assert.equal(report.details.themeCount, 60);
    assert.equal(report.details.requiredTokenCount, 52);
    assert.equal(report.details.uniqueCanonicalTokenSets, 60);
  });

  it("validates the exact corpus and its foreign keys", async () => {
    const report = await validateCorpus();

    assert.equal(
      report.result,
      "PASS",
      JSON.stringify(report.failures, null, 2),
    );
    assert.equal(report.details.projectCount, 100);
    assert.equal(report.details.uniqueFingerprints, 100);
    assert.equal(report.details.coverage.themes, 60);
  });

  it("reports duplicate and missing set members deterministically", () => {
    const validation = new Validation("set fixture");
    validateExactSet(
      validation,
      ["alpha", "alpha"],
      ["alpha", "beta"],
      "fixture",
    );
    const report = validation.result();

    assert.equal(report.result, "FAIL");
    assert.equal(report.failureCount, 2);
    assert.deepEqual(
      report.failures.map((failure) => failure.message),
      [
        "fixture must not contain duplicates",
        "fixture is missing required values",
      ],
    );
    assert.equal(
      sha256("webeditor"),
      "219fb8a9c4fdf77c580fc8d81cf4cd5600e0c1754545c5418610b0ada140bbd3",
    );
  });
});
