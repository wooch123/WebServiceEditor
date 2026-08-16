import {
  Validation,
  finishVerification,
  isMainModule,
  readJson,
  readRepositoryFile,
  unexpectedFailure,
  validateExactSet,
} from "./lib/verification.mjs";

export const THEME_PROVENANCE_EVIDENCE =
  "artifacts/phase2/theme-provenance-license-validation.json";
const REVIEW_PATH = "docs/theme-reference-review.json";
const NOTICE_PATH = "docs/theme-reference-notices.md";
const EXTENSION_PATH =
  "packages/theme-core/src/presets/webeditor-theme-presets.extension.v1.json";
const ALLOWED_LICENSES = new Set(["MIT", "Apache-2.0"]);

export function inspectThemeProvenance({
  canonical,
  extension,
  review,
  notice,
}) {
  const catalogIds = Object.keys(canonical.referenceCatalog ?? {});
  const reviewedIds = (review.references ?? []).map(({ id }) => id);
  const reviewedById = new Map(
    (review.references ?? []).map((entry) => [entry.id, entry]),
  );
  const referencedIds = new Set(
    (canonical.themes ?? []).flatMap(({ referenceIds = [] }) => referenceIds),
  );
  const reviewEntriesValid = (review.references ?? []).every(
    (entry) =>
      entry.disposition === "APPROVED_ADAPTED_REFERENCE" &&
      entry.directCopy === false &&
      Array.isArray(entry.licenses) &&
      entry.licenses.length > 0 &&
      entry.licenses.every((license) => ALLOWED_LICENSES.has(license)) &&
      /^https:\/\/github\.com\//u.test(entry.licenseEvidenceUrl),
  );
  const canonicalThemesValid = (canonical.themes ?? []).every(
    (theme) =>
      theme.directCopy === false &&
      theme.licenseReviewStatus === "required-before-distribution" &&
      /adapted|adaptation|not a pixel-identical port/iu.test(
        `${theme.adaptation} ${theme.sourceUse}`,
      ) &&
      theme.referenceIds.every((id) => reviewedById.has(id)),
  );
  const additionalThemesValid =
    extension.themes?.length === 60 &&
    extension.themes.every(
      (theme) =>
        theme.directCopy === false &&
        theme.referenceIds.length === 0 &&
        /Original generated palette/iu.test(theme.sourceUse),
    ) &&
    review.additionalOriginalThemes?.count === 60 &&
    review.additionalOriginalThemes?.directCopy === false &&
    review.additionalOriginalThemes?.disposition === "APPROVED_ORIGINAL";
  const noticeComplete =
    catalogIds.every((id) => {
      const name = canonical.referenceCatalog[id]?.name;
      return typeof name === "string" && notice.includes(name);
    }) &&
    /do\s+not\s+claim\s+sponsorship/iu.test(notice) &&
    notice.includes("No third-party logo or source asset is shipped");

  return {
    reviewEnvelope:
      review.schemaVersion === 1 &&
      review.result === "PASS" &&
      review.decision === "APPROVED_FOR_ADAPTED_REFERENCE_WITH_NOTICE" &&
      review.directCopyAllowed === false &&
      review.sourceManifestStatus === "reviewed-by-this-record" &&
      review.thirdPartyNoticePath === NOTICE_PATH,
    catalogIds,
    reviewedIds,
    referencedIds: [...referencedIds].sort(),
    reviewEntriesValid,
    canonicalThemesValid,
    additionalThemesValid,
    noticeComplete,
  };
}

export async function validateThemeProvenance() {
  const validation = new Validation("Theme provenance and license review");
  const [canonical, extension, review, noticeBuffer] = await Promise.all([
    readJson("webeditor_theme_presets_v3.json"),
    readJson(EXTENSION_PATH),
    readJson(REVIEW_PATH),
    readRepositoryFile(NOTICE_PATH),
  ]);
  const inspection = inspectThemeProvenance({
    canonical,
    extension,
    review,
    notice: noticeBuffer.toString("utf8"),
  });
  validateExactSet(
    validation,
    inspection.reviewedIds,
    inspection.catalogIds,
    "Theme reference review inventory",
  );
  validation.check(
    inspection.referencedIds.every((id) => inspection.reviewedIds.includes(id)),
    "Every referenced canonical source has a review",
    { referencedIds: inspection.referencedIds },
  );
  for (const field of [
    "reviewEnvelope",
    "reviewEntriesValid",
    "canonicalThemesValid",
    "additionalThemesValid",
    "noticeComplete",
  ]) {
    validation.equal(inspection[field], true, `Theme provenance: ${field}`);
  }
  return validation.result({
    reviewPath: REVIEW_PATH,
    noticePath: NOTICE_PATH,
    canonicalThemeCount: canonical.themes?.length ?? 0,
    additionalThemeCount: extension.themes?.length ?? 0,
    referenceCount: inspection.catalogIds.length,
    decision: review.decision,
  });
}

async function main() {
  try {
    await finishVerification(
      THEME_PROVENANCE_EVIDENCE,
      await validateThemeProvenance(),
    );
  } catch (error) {
    await finishVerification(
      THEME_PROVENANCE_EVIDENCE,
      unexpectedFailure("Theme provenance and license review", error),
    );
  }
}

if (isMainModule(import.meta.url)) await main();
