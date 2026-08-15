import {
  Validation,
  finishVerification,
  isMainModule,
  readJson,
  readRepositoryFile,
  sha256,
  unexpectedFailure,
  validateExactSet,
} from "./lib/verification.mjs";
import { validateThemes } from "./verify-themes.mjs";
import {
  simulateColorVision,
  themePerceptualDistance,
} from "./verify-phase2.mjs";

const EXTENSION_PATH =
  "packages/theme-core/src/presets/webeditor-theme-presets.extension.v1.json";
const PACKAGED_CANONICAL_PATH =
  "packages/theme-core/src/presets/webeditor-theme-presets.v3.json";
const TOKEN_NAMES = [
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
];
const QUALITY_PAIRS = {
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
};
const EXTRA_TEXT_PAIRS = [
  ["secondaryForeground", "secondary"],
  ["destructiveForeground", "destructive"],
  ["sidebarPrimaryForeground", "sidebarPrimary"],
  ["sidebarAccentForeground", "sidebarAccent"],
  ["selectionForeground", "selection"],
];

function linearize(channel) {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(hex) {
  const channels = [1, 3, 5].map((index) =>
    Number.parseInt(hex.slice(index, index + 2), 16),
  );
  return (
    0.2126 * linearize(channels[0]) +
    0.7152 * linearize(channels[1]) +
    0.0722 * linearize(channels[2])
  );
}

function contrast(first, second) {
  const firstLuminance = luminance(first);
  const secondLuminance = luminance(second);
  const brighter = Math.max(firstLuminance, secondLuminance);
  const darker = Math.min(firstLuminance, secondLuminance);
  return (brighter + 0.05) / (darker + 0.05);
}

export async function validateThemeExtension() {
  const validation = new Validation("Theme inventory extension");
  const canonicalReport = await validateThemes();
  validation.equal(
    canonicalReport.result,
    "PASS",
    "The canonical 60-theme source remains byte-pinned and valid",
  );

  const [rootCanonicalSource, packagedCanonicalSource] = await Promise.all([
    readRepositoryFile("webeditor_theme_presets_v3.json"),
    readRepositoryFile(PACKAGED_CANONICAL_PATH),
  ]);
  validation.equal(
    sha256(packagedCanonicalSource),
    sha256(rootCanonicalSource),
    "The packaged canonical manifest remains byte-identical to the source",
  );

  const canonical = await readJson("webeditor_theme_presets_v3.json");
  const extension = await readJson(EXTENSION_PATH);
  validation.equal(
    extension.schemaVersion,
    "1.0.0",
    "Extension schema is pinned",
  );
  validation.equal(
    extension.qualityGates?.normalTextContrastMin,
    4.5,
    "Extension text contrast gate is 4.5",
  );
  validation.equal(
    extension.qualityGates?.nonTextContrastMin,
    3,
    "Extension non-text contrast gate is 3",
  );
  validation.equal(extension.themes?.length, 60, "Exactly 60 themes are added");
  validation.equal(
    extension.manifestSha256,
    sha256(JSON.stringify(extension.themes)),
    "Extension manifest SHA-256 matches its ordered theme payload",
  );

  const canonicalThemes = Array.isArray(canonical.themes)
    ? canonical.themes
    : [];
  const additionalThemes = Array.isArray(extension.themes)
    ? extension.themes
    : [];
  const allThemes = [...canonicalThemes, ...additionalThemes];
  validation.equal(
    allThemes.length,
    120,
    "The selectable inventory totals 120 themes",
  );
  for (const group of ["dark", "gray", "light"]) {
    validation.equal(
      additionalThemes.filter((theme) => theme.group === group).length,
      20,
      `${group} adds exactly 20 themes`,
    );
    validation.equal(
      allThemes.filter((theme) => theme.group === group).length,
      40,
      `${group} exposes exactly 40 themes`,
    );
  }

  const ids = allThemes.map((theme) => theme.id);
  const names = allThemes.map((theme) => theme.name);
  const tokenPayloads = allThemes.map((theme) => JSON.stringify(theme.tokens));
  validation.equal(
    ids.length,
    new Set(ids).size,
    "All 120 theme IDs are unique",
  );
  validation.equal(
    names.length,
    new Set(names).size,
    "All 120 theme names are unique",
  );
  validation.equal(
    tokenPayloads.length,
    new Set(tokenPayloads).size,
    "All 120 token palettes are unique",
  );

  let cssValueCount = 0;
  const minima = {};
  for (const [index, theme] of additionalThemes.entries()) {
    const label = theme?.id ?? `extension theme ${index + 1}`;
    validation.check(
      /^(dark|gray|light)-studio-[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(
        theme?.id ?? "",
      ),
      `${label} has an extension-scoped stable ID`,
    );
    validation.equal(theme?.directCopy, false, `${label} is not a direct copy`);
    validation.equal(
      theme?.licenseReviewStatus,
      "required-before-distribution",
      `${label} keeps the distribution review gate`,
    );
    validateExactSet(
      validation,
      Object.keys(theme?.tokens ?? {}),
      TOKEN_NAMES,
      `${label} semantic token keys`,
    );
    for (const tokenName of TOKEN_NAMES) {
      validation.check(
        /^#[0-9A-F]{6}$/u.test(theme?.tokens?.[tokenName] ?? ""),
        `${label}.${tokenName} is uppercase #RRGGBB`,
      );
      cssValueCount += 1;
    }
    validation.equal(
      theme?.tokenHash,
      sha256(JSON.stringify(theme?.tokens)),
      `${label} token SHA-256 matches the emitted palette`,
    );

    const calculated = Object.fromEntries(
      Object.entries(QUALITY_PAIRS).map(
        ([qualityName, [foreground, background]]) => [
          qualityName,
          contrast(theme.tokens[foreground], theme.tokens[background]),
        ],
      ),
    );
    calculated.minChartBackground = Math.min(
      ...Array.from({ length: 8 }, (_, chartIndex) =>
        contrast(theme.tokens[`chart${chartIndex + 1}`], theme.tokens.canvas),
      ),
    );
    for (const [qualityName, ratio] of Object.entries(calculated)) {
      validation.equal(
        theme.quality?.[qualityName],
        Number(ratio.toFixed(2)),
        `${label}.${qualityName} matches recalculated WCAG contrast`,
      );
      minima[qualityName] = Math.min(minima[qualityName] ?? Infinity, ratio);
    }
    for (const qualityName of [
      "textBackground",
      "textCard",
      "textPopover",
      "textPrimary",
      "textAccent",
      "textMuted",
      "textSidebar",
      "textNode",
      "successText",
      "warningText",
      "errorText",
      "infoText",
    ]) {
      validation.check(
        calculated[qualityName] >= 4.5,
        `${label}.${qualityName} is at least 4.5:1`,
      );
    }
    for (const qualityName of [
      "focusRing",
      "inputBoundary",
      "selectionBoundary",
      "minChartBackground",
    ]) {
      validation.check(
        calculated[qualityName] >= 3,
        `${label}.${qualityName} is at least 3:1`,
      );
    }
    for (const [foreground, background] of EXTRA_TEXT_PAIRS) {
      validation.check(
        contrast(theme.tokens[foreground], theme.tokens[background]) >= 4.5,
        `${label} ${foreground}/${background} is at least 4.5:1`,
      );
    }
    for (const mode of ["protanopia", "deuteranopia", "tritanopia"]) {
      const simulatedCharts = new Set(
        Array.from({ length: 8 }, (_, chartIndex) =>
          simulateColorVision(theme.tokens[`chart${chartIndex + 1}`], mode),
        ),
      );
      const simulatedStatuses = new Set(
        ["success", "warning", "error", "info"].map((tokenName) =>
          simulateColorVision(theme.tokens[tokenName], mode),
        ),
      );
      validation.check(
        simulatedCharts.size >= 7,
        `${label} retains at least 7 chart colors under ${mode}`,
      );
      validation.equal(
        simulatedStatuses.size,
        4,
        `${label} retains all status colors under ${mode}`,
      );
    }
  }
  validation.equal(
    cssValueCount,
    60 * 52,
    "All 3,120 added CSS token values validate",
  );

  let minimumPerceptualDistance = Infinity;
  let closestThemePair = [];
  let comparedThemePairCount = 0;
  for (let leftIndex = 0; leftIndex < allThemes.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < allThemes.length;
      rightIndex += 1
    ) {
      const left = allThemes[leftIndex];
      const right = allThemes[rightIndex];
      const distance = themePerceptualDistance(left, right);
      comparedThemePairCount += 1;
      if (distance < minimumPerceptualDistance) {
        minimumPerceptualDistance = distance;
        closestThemePair = [left.id, right.id];
      }
      validation.check(
        distance > 3,
        `${left.id} and ${right.id} remain perceptually distinct`,
      );
    }
  }

  const themeCoreSource = String(
    await readRepositoryFile("packages/theme-core/src/theme.ts"),
  );
  validation.check(
    themeCoreSource.includes("...canonicalThemes, ...additionalThemes"),
    "Theme Core combines canonical and additional inventories without mutation",
  );

  return validation.result({
    canonicalThemeCount: canonicalThemes.length,
    additionalThemeCount: additionalThemes.length,
    selectableThemeCount: allThemes.length,
    groupCounts: Object.fromEntries(
      ["dark", "gray", "light"].map((group) => [
        group,
        allThemes.filter((theme) => theme.group === group).length,
      ]),
    ),
    addedCssTokenValues: cssValueCount,
    perceptualDistance: {
      algorithm: "CIE76 RMS over background, primary, accent, and canvas",
      comparedThemePairCount,
      minimum: Number(minimumPerceptualDistance.toFixed(4)),
      closestThemePair,
    },
    recalculatedMinimums: Object.fromEntries(
      Object.entries(minima).map(([name, ratio]) => [
        name,
        Number(ratio.toFixed(4)),
      ]),
    ),
  });
}

async function main() {
  try {
    await finishVerification(
      "artifacts/phase2/theme-extension-validation.json",
      await validateThemeExtension(),
    );
  } catch (error) {
    await finishVerification(
      "artifacts/phase2/theme-extension-validation.json",
      unexpectedFailure("Theme inventory extension", error),
    );
  }
}

if (isMainModule(import.meta.url)) await main();
