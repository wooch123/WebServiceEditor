import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  inspectThemeProvenance,
  validateThemeProvenance,
} from "../../scripts/verify-theme-provenance.mjs";

const canonical = {
  referenceCatalog: {
    nord: { name: "Nord" },
    mixed: { name: "Mixed accessibility references" },
  },
  themes: [
    {
      adaptation: "Adapted semantic roles",
      sourceUse: "Reference principles adapted; not a pixel-identical port.",
      directCopy: false,
      licenseReviewStatus: "required-before-distribution",
      referenceIds: ["nord", "mixed"],
    },
  ],
};
const extension = {
  themes: Array.from({ length: 60 }, (_, index) => ({
    id: `original-${index}`,
    directCopy: false,
    referenceIds: [],
    sourceUse: "Original generated palette; no values copied.",
  })),
};
const review = {
  schemaVersion: 1,
  result: "PASS",
  decision: "APPROVED_FOR_ADAPTED_REFERENCE_WITH_NOTICE",
  directCopyAllowed: false,
  sourceManifestStatus: "reviewed-by-this-record",
  thirdPartyNoticePath: "docs/theme-reference-notices.md",
  references: ["nord", "mixed"].map((id) => ({
    id,
    licenses: id === "mixed" ? ["MIT", "Apache-2.0"] : ["MIT"],
    licenseEvidenceUrl: "https://github.com/official/source",
    disposition: "APPROVED_ADAPTED_REFERENCE",
    directCopy: false,
  })),
  additionalOriginalThemes: {
    count: 60,
    directCopy: false,
    disposition: "APPROVED_ORIGINAL",
  },
};
const notice =
  "Nord Mixed accessibility references do not claim sponsorship. No third-party logo or source asset is shipped.";

describe("Theme provenance validation", () => {
  it("passes the authoritative repository review", async () => {
    const result = await validateThemeProvenance();
    assert.equal(result.result, "PASS", JSON.stringify(result.failures));
  });

  it("accepts the complete adapted-reference and original-theme boundary", () => {
    const result = inspectThemeProvenance({
      canonical,
      extension,
      review,
      notice,
    });
    for (const field of [
      "reviewEnvelope",
      "reviewEntriesValid",
      "canonicalThemesValid",
      "additionalThemesValid",
      "noticeComplete",
    ]) {
      assert.equal(result[field], true, field);
    }
  });

  it("rejects missing references, copied values, and unsupported licenses", () => {
    const missing = globalThis.structuredClone(review);
    missing.references.pop();
    assert.equal(
      inspectThemeProvenance({ canonical, extension, review: missing, notice })
        .canonicalThemesValid,
      false,
    );

    const copied = globalThis.structuredClone(extension);
    copied.themes[0].directCopy = true;
    assert.equal(
      inspectThemeProvenance({ canonical, extension: copied, review, notice })
        .additionalThemesValid,
      false,
    );

    const unsupported = globalThis.structuredClone(review);
    unsupported.references[0].licenses = ["UNKNOWN"];
    assert.equal(
      inspectThemeProvenance({
        canonical,
        extension,
        review: unsupported,
        notice,
      }).reviewEntriesValid,
      false,
    );
  });
});
