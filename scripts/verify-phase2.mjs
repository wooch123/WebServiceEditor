import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  REPOSITORY_ROOT,
  Validation,
  finishVerification,
  isMainModule,
  sha256,
  unexpectedFailure,
  validateExactSet,
} from "./lib/verification.mjs";
import { validateThemes } from "./verify-themes.mjs";

const THEME_MANIFEST_PATH = "webeditor_theme_presets_v3.json";
const PACKAGED_THEME_MANIFEST_PATH =
  "packages/theme-core/src/presets/webeditor-theme-presets.v3.json";
const THEME_CORE_SOURCE_PATH = "packages/theme-core/src/theme.ts";
const WEB_THEME_ADAPTER_PATH = "apps/web/src/theme.ts";
const THEME_PICKER_SOURCE_PATH = "apps/web/src/ThemePicker.tsx";
const APP_SOURCE_PATH = "apps/web/src/App.tsx";

export const EXPECTED_THEME_FILE_SHA256 =
  "3c015925c48318b25ee1adb61021b924306f07c859efbbbb396bde4c69b2bb98";
export const EXPECTED_THEME_MANIFEST_SHA256 =
  "219f50d70b57fe7d94243a3b53dd9d5d061c10523ce1eaac4013bde338074272";
export const EXPECTED_THEME_GROUP_COUNTS = Object.freeze({
  dark: 20,
  gray: 20,
  light: 20,
});

// This is deliberately explicit. It pins the JSON-to-CSS contract independently
// from both the manifest and the application implementation, so a token rename,
// omission, or accidental alias cannot silently reduce runtime coverage.
export const TOKEN_TO_CSS_VARIABLE = Object.freeze({
  background: "--background",
  foreground: "--foreground",
  card: "--card",
  cardForeground: "--card-foreground",
  popover: "--popover",
  popoverForeground: "--popover-foreground",
  primary: "--primary",
  primaryForeground: "--primary-foreground",
  secondary: "--secondary",
  secondaryForeground: "--secondary-foreground",
  muted: "--muted",
  mutedForeground: "--muted-foreground",
  accent: "--accent",
  accentForeground: "--accent-foreground",
  destructive: "--destructive",
  destructiveForeground: "--destructive-foreground",
  border: "--border",
  input: "--input",
  ring: "--ring",
  sidebar: "--sidebar",
  sidebarForeground: "--sidebar-foreground",
  sidebarPrimary: "--sidebar-primary",
  sidebarPrimaryForeground: "--sidebar-primary-foreground",
  sidebarAccent: "--sidebar-accent",
  sidebarAccentForeground: "--sidebar-accent-foreground",
  sidebarBorder: "--sidebar-border",
  canvas: "--canvas",
  canvasGrid: "--canvas-grid",
  canvasGridStrong: "--canvas-grid-strong",
  selection: "--selection",
  selectionForeground: "--selection-foreground",
  node: "--node",
  nodeForeground: "--node-foreground",
  nodeBorder: "--node-border",
  edge: "--edge",
  edgeSelected: "--edge-selected",
  success: "--success",
  successForeground: "--success-foreground",
  warning: "--warning",
  warningForeground: "--warning-foreground",
  error: "--error",
  errorForeground: "--error-foreground",
  info: "--info",
  infoForeground: "--info-foreground",
  chart1: "--chart-1",
  chart2: "--chart-2",
  chart3: "--chart-3",
  chart4: "--chart-4",
  chart5: "--chart-5",
  chart6: "--chart-6",
  chart7: "--chart-7",
  chart8: "--chart-8",
});

export const REQUIRED_THEME_TOKENS = Object.freeze(
  Object.keys(TOKEN_TO_CSS_VARIABLE),
);
export const REQUIRED_CSS_VARIABLES = Object.freeze(
  Object.values(TOKEN_TO_CSS_VARIABLE),
);

export const COLOR_VISION_MODES = Object.freeze([
  "protanopia",
  "deuteranopia",
  "tritanopia",
]);

const COLOR_VISION_MATRICES = Object.freeze({
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
});

function clampColorChannel(value) {
  return Math.min(255, Math.max(0, Math.round(value)));
}

export function simulateColorVision(color, mode) {
  if (!/^#[\dA-Fa-f]{6}$/u.test(color)) {
    throw new Error(`Expected a six-digit hex color, received ${color}.`);
  }
  const matrix = COLOR_VISION_MATRICES[mode];
  if (!matrix) {
    throw new Error(`Unknown color-vision mode: ${mode}.`);
  }
  const channels = [1, 3, 5].map((index) =>
    Number.parseInt(color.slice(index, index + 2), 16),
  );
  const converted = matrix.map((row) =>
    row.reduce(
      (sum, coefficient, index) => sum + coefficient * (channels[index] ?? 0),
      0,
    ),
  );

  return `#${converted
    .map((value) => clampColorChannel(value).toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase()}`;
}

function hexToLab(color) {
  const channels = [1, 3, 5]
    .map((index) => Number.parseInt(color.slice(index, index + 2), 16) / 255)
    .map((value) =>
      value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
    );
  const [red = 0, green = 0, blue = 0] = channels;
  const x = (red * 0.4124 + green * 0.3576 + blue * 0.1805) / 0.95047;
  const y = red * 0.2126 + green * 0.7152 + blue * 0.0722;
  const z = (red * 0.0193 + green * 0.1192 + blue * 0.9505) / 1.08883;
  const transform = (value) =>
    value > 0.008856 ? value ** (1 / 3) : 7.787 * value + 16 / 116;
  const fx = transform(x);
  const fy = transform(y);
  const fz = transform(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function deltaE76(left, right) {
  const leftLab = hexToLab(left);
  const rightLab = hexToLab(right);
  return Math.hypot(
    ...leftLab.map((value, index) => value - (rightLab[index] ?? 0)),
  );
}

export function themePerceptualDistance(left, right) {
  const identityTokens = ["background", "primary", "accent", "canvas"];
  return (
    Math.hypot(
      ...identityTokens.map((tokenName) =>
        deltaE76(left.tokens[tokenName], right.tokens[tokenName]),
      ),
    ) / Math.sqrt(identityTokens.length)
  );
}

export function toCssVariableName(tokenName) {
  return `--${tokenName
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([a-zA-Z])(\d)/g, "$1-$2")
    .toLowerCase()}`;
}

export function resolveThemeCssVariables(theme) {
  return Object.fromEntries(
    Object.entries(TOKEN_TO_CSS_VARIABLE).map(([tokenName, cssVariable]) => [
      cssVariable,
      theme?.tokens?.[tokenName],
    ]),
  );
}

function extractFunctionSource(source, functionName) {
  const signature = new RegExp(
    `(?:export\\s+)?function\\s+${functionName}\\s*\\(`,
    "u",
  );
  const match = signature.exec(source);
  if (!match) {
    return "";
  }

  const signatureTail = source.slice(match.index + match[0].length);
  const bodyOffset = signatureTail.search(
    /\{\s*(?:const|for|if|let|return|throw)\b/u,
  );
  if (bodyOffset < 0) {
    return "";
  }
  const openingBrace = match.index + match[0].length + bodyOffset;

  let depth = 0;
  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === "{") {
      depth += 1;
    } else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(match.index, index + 1);
      }
    }
  }

  return "";
}

export function inspectThemeResolverSource(source) {
  const normalizerSource = extractFunctionSource(
    source,
    "themeTokenToCssVariable",
  );
  const resolverSource = extractFunctionSource(source, "themeToCssVariables");
  const compactResolver = resolverSource.replace(/\s+/gu, " ");

  return {
    importsPackagedManifest:
      /import\s+themeManifestSource\s+from\s+["']\.\/presets\/webeditor-theme-presets\.v3\.json["']\s+with\s*\{\s*type:\s*["']json["']\s*,?\s*\}\s*;/u.test(
        source,
      ),
    exposesCompleteManifestArray:
      /export\s+const\s+themeManifest\s*=\s*themeManifestSource\s+as\s+unknown\s+as\s+ThemeManifest\s*;[\s\S]*?export\s+const\s+themes\s*=\s*themeManifest\.themes\s*;/u.test(
        source,
      ) ||
      (/export\s+const\s+canonicalThemes\s*=\s*themeManifest\.themes\s*;/u.test(
        source,
      ) &&
        /export\s+const\s+additionalThemes\s*=\s*additionalThemeManifest\.themes\s*;/u.test(
          source,
        ) &&
        /export\s+const\s+themes\s*=\s*\[\.\.\.canonicalThemes,\s*\.\.\.additionalThemes\]\s*as\s+const\s*;/u.test(
          source,
        )),
    resolvesDefaultFromCompleteArray:
      /themes\.find\(\s*\(theme\)\s*=>\s*theme\.id\s*===\s*["']light-clean-paper["']\s*\)\s*\?\?\s*themes\[0\]/su.test(
        source,
      ),
    normalizesCamelCase: normalizerSource.includes(
      '.replace(/([a-z0-9])([A-Z])/g, "$1-$2")',
    ),
    separatesNumericSuffixes: normalizerSource.includes(
      '.replace(/([a-zA-Z])(\\d)/g, "$1-$2")',
    ),
    lowercasesNames: normalizerSource.includes(".toLowerCase()"),
    iteratesPinnedTokenInventory: compactResolver.includes(
      "THEME_TOKEN_NAMES.map((tokenName) => [",
    ),
    mapsEachTokenName:
      /themeTokenToCssVariable\(tokenName\)\s*,\s*theme\.tokens\[tokenName\]/su.test(
        resolverSource,
      ),
    returnsResolvedVariables:
      /return\s+Object\.fromEntries\([\s\S]*\)\s+as\s+Readonly<\s*Record<`--\$\{string\}`,\s*string>\s*>\s*;/u.test(
        resolverSource,
      ),
  };
}

export function extractThemeTokenInventory(source) {
  const body =
    /export\s+const\s+THEME_TOKEN_NAMES\s*=\s*\[(?<body>[\s\S]*?)\]\s*as\s+const\s*;/u.exec(
      source,
    )?.groups?.body ?? "";
  return [...body.matchAll(/["']([^"']+)["']/gu)].map((match) => match[1]);
}

export function inspectWebThemeAdapterSource(source) {
  const coreImport =
    /import\s*\{(?<imports>[^{}]*)\}\s*from\s*["']@webeditor\/theme-core["']\s*;/u.exec(
      source,
    )?.groups?.imports ?? "";
  const importedNames = new Set(
    coreImport
      .split(",")
      .map((name) => name.replace(/\btype\s+/gu, "").trim())
      .filter(Boolean),
  );

  return {
    importsCanonicalCore:
      importedNames.has("defaultTheme") &&
      importedNames.has("themes") &&
      importedNames.has("themeToCssVariables as resolveThemeCssVariables"),
    reexportsCanonicalInventory:
      /export\s*\{[^{}]*\bdefaultTheme\b[^{}]*\bthemes\b[^{}]*\}/su.test(
        source,
      ),
    delegatesWithoutTokenConversion:
      /return\s+resolveThemeCssVariables\(theme\)\s+as\s+CSSProperties\s*&\s*Record<`--\$\{string\}`,\s*string>\s*;/u.test(
        source,
      ),
  };
}

export function inspectThemePickerSource(source) {
  const themeImport =
    /import\s*\{(?<imports>[^{}]*)\}\s*from\s*["']@\/theme["']\s*;/u.exec(
      source,
    )?.groups?.imports ?? "";
  const importedNames = new Set(
    themeImport
      .split(",")
      .map((name) => name.replace(/\btype\s+/gu, "").trim())
      .filter(Boolean),
  );
  const mappedGroups = [
    ...source.matchAll(/\bid:\s*["'](dark|gray|light)["']/gu),
  ].map((match) => match[1]);

  return {
    importsCanonicalInventory:
      importedNames.has("defaultTheme") &&
      importedNames.has("themes") &&
      importedNames.has("ThemeGroup") &&
      importedNames.has("WebEditorTheme"),
    resolvesCurrentTheme:
      /themes\.find\(\s*\(theme\)\s*=>\s*theme\.id\s*===\s*themeId\s*\)\s*\?\?\s*defaultTheme/u.test(
        source,
      ),
    filtersCompleteGroupInventory:
      /return\s+themes\.filter\(\s*\(theme\)\s*=>\s*theme\.group\s*===\s*group\s*&&/su.test(
        source,
      ) && !source.includes(".slice("),
    rendersEveryVisibleTheme: /visibleThemes\.map\(\s*\(theme\)\s*=>/su.test(
      source,
    ),
    mappedGroups,
  };
}

export function inspectThemeAppSource(source) {
  const themeImport =
    /import\s*\{(?<imports>[^{}]*)\}\s*from\s*["']\.\/theme["']\s*;/u.exec(
      source,
    )?.groups?.imports ?? "";
  const importedNames = new Set(
    themeImport
      .split(",")
      .map((name) => name.replace(/\btype\s+/gu, "").trim())
      .filter(Boolean),
  );

  return {
    importsCompleteResolver:
      importedNames.has("defaultTheme") &&
      importedNames.has("themes") &&
      importedNames.has("themeToCssVariables"),
    importsThemePicker:
      /import\s*\{\s*ThemePicker\s*\}\s*from\s*["']\.\/ThemePicker["']\s*;/u.test(
        source,
      ),
    resolvesSelectedTheme:
      /themes\.find\(\s*\(theme\)\s*=>\s*theme\.id\s*===\s*themeId\s*\)\s*\?\?\s*defaultTheme/u.test(
        source,
      ),
    appliesSelectedTheme: /\.\.\.themeToCssVariables\(selectedTheme\)/u.test(
      source,
    ),
    exposesResolvedThemeId: /data-theme-id=\{selectedTheme\.id\}/u.test(source),
    delegatesThemeSelection:
      /<ThemePicker\s+themeId=\{themeId\}\s+onThemeChange=\{onThemeChange\}\s*\/>/u.test(
        source,
      ),
  };
}

async function readRequiredText(repositoryRoot, relativePath, validation) {
  try {
    const source = await readFile(
      resolve(repositoryRoot, relativePath),
      "utf8",
    );
    validation.check(source.length > 0, `${relativePath} is non-empty`);
    return source;
  } catch (error) {
    validation.check(false, `${relativePath} can be read`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return "";
  }
}

function parseRequiredJson(source, relativePath, validation) {
  try {
    return JSON.parse(source.replace(/^\uFEFF/u, ""));
  } catch (error) {
    validation.check(false, `${relativePath} contains valid JSON`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return {};
  }
}

export async function validatePhase2({
  repositoryRoot = REPOSITORY_ROOT,
} = {}) {
  const validation = new Validation("Phase 2 canonical theme runtime");

  const canonicalManifestReport = await validateThemes();
  validation.equal(
    canonicalManifestReport.result,
    "PASS",
    "The exhaustive canonical theme audit passes",
  );

  const manifestSource = await readRequiredText(
    repositoryRoot,
    THEME_MANIFEST_PATH,
    validation,
  );
  validation.equal(
    sha256(manifestSource),
    EXPECTED_THEME_FILE_SHA256,
    "The canonical theme artifact is preserved byte-for-byte",
  );
  const manifest = parseRequiredJson(
    manifestSource,
    THEME_MANIFEST_PATH,
    validation,
  );
  validation.equal(
    manifest.manifestSha256,
    EXPECTED_THEME_MANIFEST_SHA256,
    "The canonical theme manifest identity remains pinned",
  );
  const packagedManifestSource = await readRequiredText(
    repositoryRoot,
    PACKAGED_THEME_MANIFEST_PATH,
    validation,
  );
  validation.equal(
    packagedManifestSource,
    manifestSource,
    "The packaged theme manifest preserves every source byte",
  );
  validation.equal(
    sha256(packagedManifestSource),
    EXPECTED_THEME_FILE_SHA256,
    "The packaged theme manifest has the pinned source SHA-256",
  );

  const themes = Array.isArray(manifest.themes) ? manifest.themes : [];
  validation.check(Array.isArray(manifest.themes), "themes is an array");
  validation.equal(themes.length, 60, "Exactly 60 canonical themes resolve");

  const groupCounts = Object.fromEntries(
    Object.keys(EXPECTED_THEME_GROUP_COUNTS).map((group) => [
      group,
      themes.filter((theme) => theme?.group === group).length,
    ]),
  );
  for (const [group, expectedCount] of Object.entries(
    EXPECTED_THEME_GROUP_COUNTS,
  )) {
    validation.equal(
      groupCounts[group],
      expectedCount,
      `${group} resolves all ${expectedCount} canonical themes`,
    );
  }

  validation.equal(
    REQUIRED_THEME_TOKENS.length,
    52,
    "The runtime token contract contains exactly 52 semantic tokens",
  );
  validation.equal(
    REQUIRED_CSS_VARIABLES.length,
    52,
    "The runtime CSS contract contains exactly 52 variables",
  );
  validateExactSet(
    validation,
    REQUIRED_CSS_VARIABLES,
    [...new Set(REQUIRED_CSS_VARIABLES)],
    "Runtime CSS variable names",
  );
  for (const [tokenName, cssVariable] of Object.entries(
    TOKEN_TO_CSS_VARIABLE,
  )) {
    validation.equal(
      toCssVariableName(tokenName),
      cssVariable,
      `${tokenName} maps to ${cssVariable}`,
    );
  }

  let resolvedCssVariableCount = 0;
  for (const [index, theme] of themes.entries()) {
    const label = theme?.id ?? `theme ${index + 1}`;
    const tokens =
      theme?.tokens !== null && typeof theme?.tokens === "object"
        ? theme.tokens
        : {};
    validateExactSet(
      validation,
      Object.keys(tokens),
      REQUIRED_THEME_TOKENS,
      `${label} runtime token keys`,
    );

    const variables = resolveThemeCssVariables(theme);
    validateExactSet(
      validation,
      Object.keys(variables),
      REQUIRED_CSS_VARIABLES,
      `${label} resolved CSS variables`,
    );
    for (const [tokenName, cssVariable] of Object.entries(
      TOKEN_TO_CSS_VARIABLE,
    )) {
      validation.equal(
        variables[cssVariable],
        tokens[tokenName],
        `${label} preserves ${tokenName} as ${cssVariable}`,
      );
      resolvedCssVariableCount += 1;
    }
  }
  validation.equal(
    resolvedCssVariableCount,
    60 * 52,
    "All 3,120 canonical theme values resolve without conversion",
  );

  const colorVisionSummary = Object.fromEntries(
    COLOR_VISION_MODES.map((mode) => [
      mode,
      { minimumChartColorCount: 8, minimumStatusColorCount: 4 },
    ]),
  );
  const chartTokenNames = Array.from(
    { length: 8 },
    (_, index) => `chart${index + 1}`,
  );
  const statusTokenNames = ["success", "warning", "error", "info"];
  for (const theme of themes) {
    for (const mode of COLOR_VISION_MODES) {
      const simulatedChartColors = new Set(
        chartTokenNames.map((tokenName) =>
          simulateColorVision(theme.tokens[tokenName], mode),
        ),
      );
      const simulatedStatusColors = new Set(
        statusTokenNames.map((tokenName) =>
          simulateColorVision(theme.tokens[tokenName], mode),
        ),
      );
      validation.check(
        simulatedChartColors.size >= 7,
        `${theme.id} retains at least 7 chart colors under ${mode}`,
      );
      validation.equal(
        simulatedStatusColors.size,
        4,
        `${theme.id} retains all 4 status colors under ${mode}`,
      );
      colorVisionSummary[mode].minimumChartColorCount = Math.min(
        colorVisionSummary[mode].minimumChartColorCount,
        simulatedChartColors.size,
      );
      colorVisionSummary[mode].minimumStatusColorCount = Math.min(
        colorVisionSummary[mode].minimumStatusColorCount,
        simulatedStatusColors.size,
      );
    }
  }

  let minimumPerceptualDistance = Number.POSITIVE_INFINITY;
  let closestThemePair = [];
  let comparedThemePairCount = 0;
  for (let leftIndex = 0; leftIndex < themes.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < themes.length;
      rightIndex += 1
    ) {
      const leftTheme = themes[leftIndex];
      const rightTheme = themes[rightIndex];
      if (!leftTheme || !rightTheme) continue;
      const distance = themePerceptualDistance(leftTheme, rightTheme);
      comparedThemePairCount += 1;
      validation.check(
        distance > 3,
        `${leftTheme.id} and ${rightTheme.id} are perceptually distinct`,
        { distance },
      );
      if (distance < minimumPerceptualDistance) {
        minimumPerceptualDistance = distance;
        closestThemePair = [leftTheme.id, rightTheme.id];
      }
    }
  }

  const themeCoreSource = await readRequiredText(
    repositoryRoot,
    THEME_CORE_SOURCE_PATH,
    validation,
  );
  const coreTokenInventory = extractThemeTokenInventory(themeCoreSource);
  validateExactSet(
    validation,
    coreTokenInventory,
    REQUIRED_THEME_TOKENS,
    "Theme core semantic-token inventory",
  );
  const resolverInspection = inspectThemeResolverSource(themeCoreSource);
  for (const [checkName, passed] of Object.entries(resolverInspection)) {
    validation.check(passed, `Theme core resolver: ${checkName}`);
  }

  const webThemeAdapterSource = await readRequiredText(
    repositoryRoot,
    WEB_THEME_ADAPTER_PATH,
    validation,
  );
  const webAdapterInspection = inspectWebThemeAdapterSource(
    webThemeAdapterSource,
  );
  for (const [checkName, passed] of Object.entries(webAdapterInspection)) {
    validation.check(passed, `Web theme adapter: ${checkName}`);
  }

  const themePickerSource = await readRequiredText(
    repositoryRoot,
    THEME_PICKER_SOURCE_PATH,
    validation,
  );
  const themePickerInspection = inspectThemePickerSource(themePickerSource);
  for (const [checkName, passed] of Object.entries(themePickerInspection)) {
    if (checkName !== "mappedGroups") {
      validation.check(passed, `Application theme picker: ${checkName}`);
    }
  }
  validateExactSet(
    validation,
    themePickerInspection.mappedGroups,
    Object.keys(EXPECTED_THEME_GROUP_COUNTS),
    "Application theme picker groups",
  );

  const appSource = await readRequiredText(
    repositoryRoot,
    APP_SOURCE_PATH,
    validation,
  );
  const appInspection = inspectThemeAppSource(appSource);
  for (const [checkName, passed] of Object.entries(appInspection)) {
    validation.check(passed, `Application theme surface: ${checkName}`);
  }

  return validation.result({
    canonicalManifest: {
      result: canonicalManifestReport.result,
      checks: canonicalManifestReport.checks,
      failureCount: canonicalManifestReport.failureCount,
    },
    manifestPreservation: {
      fileSha256: sha256(manifestSource),
      packagedFileSha256: sha256(packagedManifestSource),
      manifestSha256: manifest.manifestSha256 ?? null,
    },
    themeCount: themes.length,
    groupCounts,
    semanticTokenCount: REQUIRED_THEME_TOKENS.length,
    cssVariableCountPerTheme: REQUIRED_CSS_VARIABLES.length,
    resolvedCssVariableCount,
    colorVisionSummary,
    perceptualDistance: {
      algorithm: "CIE76 RMS over background, primary, accent, and canvas",
      comparedThemePairCount,
      minimum: minimumPerceptualDistance,
      closestThemePair,
    },
    coreTokenInventoryCount: coreTokenInventory.length,
    resolverInspection,
    webAdapterInspection,
    themePickerInspection,
    appInspection,
  });
}

async function main() {
  try {
    await finishVerification(
      "artifacts/phase2/theme-runtime-validation.json",
      await validatePhase2(),
    );
  } catch (error) {
    await finishVerification(
      "artifacts/phase2/theme-runtime-validation.json",
      unexpectedFailure("Phase 2 canonical theme runtime", error),
    );
  }
}

if (isMainModule(import.meta.url)) {
  await main();
}
