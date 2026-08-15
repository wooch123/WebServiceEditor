import {
  Validation,
  finishVerification,
  isMainModule,
  isPlainObject,
  readJson,
  readRepositoryFile,
  sha256,
  unexpectedFailure,
  validateExactSet,
} from "./lib/verification.mjs";

const EXPECTED_FILE_SHA256 =
  "3c015925c48318b25ee1adb61021b924306f07c859efbbbb396bde4c69b2bb98";
const EXPECTED_MANIFEST_SHA256 =
  "219f50d70b57fe7d94243a3b53dd9d5d061c10523ce1eaac4013bde338074272";
const EXPECTED_GROUP_COUNTS = Object.freeze({ dark: 20, gray: 20, light: 20 });
const TEXT_CONTRAST_MINIMUM = 4.5;
const NON_TEXT_CONTRAST_MINIMUM = 3;
const RATIO_TOLERANCE = 0.011;

const REQUIRED_TOKENS = Object.freeze([
  "background",
  "foreground",
  "card",
  "cardForeground",
  "popover",
  "popoverForeground",
  "primary",
  "primaryForeground",
  "secondary",
  "secondaryForeground",
  "muted",
  "mutedForeground",
  "accent",
  "accentForeground",
  "destructive",
  "destructiveForeground",
  "border",
  "input",
  "ring",
  "sidebar",
  "sidebarForeground",
  "sidebarPrimary",
  "sidebarPrimaryForeground",
  "sidebarAccent",
  "sidebarAccentForeground",
  "sidebarBorder",
  "canvas",
  "canvasGrid",
  "canvasGridStrong",
  "selection",
  "selectionForeground",
  "node",
  "nodeForeground",
  "nodeBorder",
  "edge",
  "edgeSelected",
  "success",
  "successForeground",
  "warning",
  "warningForeground",
  "error",
  "errorForeground",
  "info",
  "infoForeground",
  "chart1",
  "chart2",
  "chart3",
  "chart4",
  "chart5",
  "chart6",
  "chart7",
  "chart8",
]);

const REQUIRED_QUALITY_KEYS = Object.freeze([
  "textBackground",
  "textCard",
  "textPopover",
  "textPrimary",
  "textAccent",
  "textMuted",
  "textSidebar",
  "textNode",
  "focusRing",
  "inputBoundary",
  "selectionBoundary",
  "successText",
  "warningText",
  "errorText",
  "infoText",
  "minChartBackground",
]);

const TEXT_PAIRS = Object.freeze([
  ["foreground", "background"],
  ["cardForeground", "card"],
  ["popoverForeground", "popover"],
  ["primaryForeground", "primary"],
  ["secondaryForeground", "secondary"],
  ["mutedForeground", "muted"],
  ["accentForeground", "accent"],
  ["destructiveForeground", "destructive"],
  ["sidebarForeground", "sidebar"],
  ["sidebarPrimaryForeground", "sidebarPrimary"],
  ["sidebarAccentForeground", "sidebarAccent"],
  ["selectionForeground", "selection"],
  ["nodeForeground", "node"],
  ["successForeground", "success"],
  ["warningForeground", "warning"],
  ["errorForeground", "error"],
  ["infoForeground", "info"],
]);

const QUALITY_PAIR_MAP = Object.freeze({
  textBackground: ["foreground", "background"],
  textCard: ["cardForeground", "card"],
  textPopover: ["popoverForeground", "popover"],
  textPrimary: ["primaryForeground", "primary"],
  textAccent: ["accentForeground", "accent"],
  textMuted: ["mutedForeground", "muted"],
  textSidebar: ["sidebarForeground", "sidebar"],
  textNode: ["nodeForeground", "node"],
  focusRing: ["ring", "background"],
  inputBoundary: ["input", "background"],
  selectionBoundary: ["selection", "background"],
  successText: ["successForeground", "success"],
  warningText: ["warningForeground", "warning"],
  errorText: ["errorForeground", "error"],
  infoText: ["infoForeground", "info"],
});

function linearizeSrgb(channel) {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex) {
  const red = Number.parseInt(hex.slice(1, 3), 16);
  const green = Number.parseInt(hex.slice(3, 5), 16);
  const blue = Number.parseInt(hex.slice(5, 7), 16);
  return (
    0.2126 * linearizeSrgb(red) +
    0.7152 * linearizeSrgb(green) +
    0.0722 * linearizeSrgb(blue)
  );
}

function contrastRatio(first, second) {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  const lighter = Math.max(firstLuminance, secondLuminance);
  const darker = Math.min(firstLuminance, secondLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function canonicalTokenFingerprint(tokens) {
  const canonical = Object.entries(tokens).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  return sha256(JSON.stringify(canonical));
}

export async function validateThemes() {
  const validation = new Validation("Theme preset manifest");
  const source = await readRepositoryFile("webeditor_theme_presets_v3.json");
  validation.equal(
    sha256(source),
    EXPECTED_FILE_SHA256,
    "Theme source artifact SHA-256 matches",
  );

  const manifest = await readJson("webeditor_theme_presets_v3.json");
  validation.check(isPlainObject(manifest), "Theme manifest root is an object");
  validation.equal(
    manifest.schemaVersion,
    "3.0.0",
    "Theme schema version is 3.0.0",
  );
  validation.equal(
    manifest.manifestSha256,
    EXPECTED_MANIFEST_SHA256,
    "Theme manifest identity hash is pinned",
  );
  validation.equal(
    manifest.generationRule?.normalTextMinimumContrast,
    TEXT_CONTRAST_MINIMUM,
    "Generation rule text contrast cannot be weakened",
  );
  validation.equal(
    manifest.generationRule?.focusAndEssentialBoundaryMinimumContrast,
    NON_TEXT_CONTRAST_MINIMUM,
    "Generation rule non-text contrast cannot be weakened",
  );
  validation.equal(
    manifest.generationRule?.chartMarkMinimumContrastAgainstCanvas,
    NON_TEXT_CONTRAST_MINIMUM,
    "Generation rule chart contrast cannot be weakened",
  );
  validation.equal(
    manifest.qualityGates?.normalTextContrastMin,
    TEXT_CONTRAST_MINIMUM,
    "Quality gate text contrast is 4.5",
  );
  validation.equal(
    manifest.qualityGates?.nonTextContrastMin,
    NON_TEXT_CONTRAST_MINIMUM,
    "Quality gate non-text contrast is 3",
  );
  validation.equal(
    manifest.qualityGates?.uniqueTokenHashCount,
    60,
    "Quality gate requires 60 hashes",
  );

  const themes = Array.isArray(manifest.themes) ? manifest.themes : [];
  validation.check(Array.isArray(manifest.themes), "themes is an array");
  validation.equal(
    themes.length,
    60,
    "Theme manifest contains exactly 60 themes",
  );

  const actualGroups = Object.fromEntries(
    Object.keys(EXPECTED_GROUP_COUNTS).map((group) => [group, 0]),
  );
  const themeIds = [];
  const themeNames = [];
  const declaredTokenHashes = [];
  const computedTokenFingerprints = [];
  const recalculatedQuality = {};

  for (const [index, theme] of themes.entries()) {
    const label = theme?.id ?? `theme ${index + 1}`;
    validation.check(isPlainObject(theme), `${label} is an object`);
    validation.check(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(theme?.id ?? ""),
      `${label} has a stable ID`,
    );
    validation.check(
      typeof theme?.name === "string" && theme.name.trim().length > 0,
      `${label} has a name`,
    );
    validation.check(
      Object.hasOwn(EXPECTED_GROUP_COUNTS, theme?.group),
      `${label} has a valid group`,
      {
        group: theme?.group,
      },
    );
    if (Object.hasOwn(actualGroups, theme?.group)) {
      actualGroups[theme.group] += 1;
    }
    themeIds.push(theme?.id);
    themeNames.push(theme?.name);
    declaredTokenHashes.push(theme?.tokenHash);
    validation.check(
      /^[0-9a-f]{16}$/u.test(theme?.tokenHash ?? ""),
      `${label} tokenHash has 16 hex digits`,
    );
    validation.equal(
      theme?.directCopy,
      false,
      `${label} is an adaptation, not a direct copy`,
    );
    validation.check(
      Array.isArray(theme?.referenceIds) && theme.referenceIds.length > 0,
      `${label} declares at least one reference`,
    );
    for (const referenceId of theme?.referenceIds ?? []) {
      validation.check(
        Object.hasOwn(manifest.referenceCatalog ?? {}, referenceId),
        `${label} reference ${referenceId} exists in the catalog`,
      );
    }

    const tokens = isPlainObject(theme?.tokens) ? theme.tokens : {};
    validation.check(
      isPlainObject(theme?.tokens),
      `${label}.tokens is an object`,
    );
    validateExactSet(
      validation,
      Object.keys(tokens),
      REQUIRED_TOKENS,
      `${label} token keys`,
    );
    for (const tokenName of REQUIRED_TOKENS) {
      validation.check(
        /^#[0-9A-Fa-f]{6}$/u.test(tokens[tokenName] ?? ""),
        `${label}.${tokenName} is a six-digit sRGB hex color`,
        { value: tokens[tokenName] },
      );
    }
    if (Object.keys(tokens).length === REQUIRED_TOKENS.length) {
      computedTokenFingerprints.push(canonicalTokenFingerprint(tokens));
    }

    const quality = isPlainObject(theme?.quality) ? theme.quality : {};
    validation.check(
      isPlainObject(theme?.quality),
      `${label}.quality is an object`,
    );
    validateExactSet(
      validation,
      Object.keys(quality),
      REQUIRED_QUALITY_KEYS,
      `${label} quality keys`,
    );

    const validColors = REQUIRED_TOKENS.every((tokenName) =>
      /^#[0-9A-Fa-f]{6}$/u.test(tokens[tokenName] ?? ""),
    );
    if (!validColors) {
      continue;
    }

    for (const [foreground, background] of TEXT_PAIRS) {
      const ratio = contrastRatio(tokens[foreground], tokens[background]);
      validation.check(
        ratio + Number.EPSILON >= TEXT_CONTRAST_MINIMUM,
        `${label} ${foreground}/${background} text contrast is at least 4.5:1`,
        { ratio },
      );
    }

    const calculated = {};
    for (const [qualityName, [foreground, background]] of Object.entries(
      QUALITY_PAIR_MAP,
    )) {
      calculated[qualityName] = contrastRatio(
        tokens[foreground],
        tokens[background],
      );
    }
    calculated.minChartBackground = Math.min(
      ...Array.from({ length: 8 }, (_, chartIndex) =>
        contrastRatio(tokens[`chart${chartIndex + 1}`], tokens.canvas),
      ),
    );
    recalculatedQuality[label] = Object.fromEntries(
      Object.entries(calculated).map(([name, ratio]) => [
        name,
        Number(ratio.toFixed(2)),
      ]),
    );

    for (const [qualityName, calculatedRatio] of Object.entries(calculated)) {
      validation.check(
        typeof quality[qualityName] === "number" &&
          Number.isFinite(quality[qualityName]),
        `${label}.${qualityName} is a finite number`,
      );
      validation.check(
        Math.abs(
          (quality[qualityName] ?? 0) - Number(calculatedRatio.toFixed(2)),
        ) <= RATIO_TOLERANCE,
        `${label}.${qualityName} matches the recalculated WCAG ratio`,
        {
          declared: quality[qualityName],
          calculated: Number(calculatedRatio.toFixed(2)),
        },
      );
    }
    for (const qualityName of [
      "focusRing",
      "inputBoundary",
      "selectionBoundary",
      "minChartBackground",
    ]) {
      validation.check(
        calculated[qualityName] + Number.EPSILON >= NON_TEXT_CONTRAST_MINIMUM,
        `${label}.${qualityName} contrast is at least 3:1`,
        { ratio: calculated[qualityName] },
      );
    }
  }

  for (const [group, expectedCount] of Object.entries(EXPECTED_GROUP_COUNTS)) {
    validation.equal(
      actualGroups[group],
      expectedCount,
      `${group} contains exactly ${expectedCount} themes`,
    );
    validation.equal(
      manifest.qualityGates?.requiredGroups?.[group],
      expectedCount,
      `${group} declared count is pinned`,
    );
  }
  validateExactSet(validation, themeIds, themeIds, "Theme IDs");
  validation.equal(
    themeNames.length,
    new Set(themeNames).size,
    "Theme names are unique",
  );
  validation.equal(
    declaredTokenHashes.length,
    new Set(declaredTokenHashes).size,
    "Declared token hashes are unique",
  );
  validation.equal(
    computedTokenFingerprints.length,
    new Set(computedTokenFingerprints).size,
    "Canonical token sets are unique",
  );

  const minima = {};
  for (const qualityName of REQUIRED_QUALITY_KEYS) {
    const values = Object.values(recalculatedQuality).map(
      (quality) => quality[qualityName],
    );
    minima[qualityName] = values.length > 0 ? Math.min(...values) : null;
  }

  return validation.result({
    themeCount: themes.length,
    groupCounts: actualGroups,
    requiredTokenCount: REQUIRED_TOKENS.length,
    uniqueThemeIds: new Set(themeIds).size,
    uniqueDeclaredTokenHashes: new Set(declaredTokenHashes).size,
    uniqueCanonicalTokenSets: new Set(computedTokenFingerprints).size,
    recalculatedMinimums: minima,
  });
}

async function main() {
  try {
    await finishVerification(
      "artifacts/phase0/theme-manifest-validation.json",
      await validateThemes(),
    );
  } catch (error) {
    await finishVerification(
      "artifacts/phase0/theme-manifest-validation.json",
      unexpectedFailure("Theme preset manifest", error),
    );
  }
}

if (isMainModule(import.meta.url)) {
  await main();
}
