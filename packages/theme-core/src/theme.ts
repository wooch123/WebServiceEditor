import themeManifestSource from "./presets/webeditor-theme-presets.v3.json" with { type: "json" };
import additionalThemeManifestSource from "./presets/webeditor-theme-presets.extension.v1.json" with { type: "json" };

export const THEME_GROUPS = ["dark", "gray", "light"] as const;

export type ThemeGroup = (typeof THEME_GROUPS)[number];

export const THEME_TOKEN_NAMES = [
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
] as const;

export type ThemeTokenName = (typeof THEME_TOKEN_NAMES)[number];
export type ThemeTokens = Readonly<Record<ThemeTokenName, string>>;

export interface ThemeQualityMetrics {
  readonly textBackground: number;
  readonly textCard: number;
  readonly textPopover: number;
  readonly textPrimary: number;
  readonly textAccent: number;
  readonly textMuted: number;
  readonly textSidebar: number;
  readonly textNode: number;
  readonly focusRing: number;
  readonly inputBoundary: number;
  readonly selectionBoundary: number;
  readonly successText: number;
  readonly warningText: number;
  readonly errorText: number;
  readonly infoText: number;
  readonly minChartBackground: number;
}

export interface WebEditorTheme {
  readonly id: string;
  readonly name: string;
  readonly group: ThemeGroup;
  readonly referenceFamily: string;
  readonly adaptation: string;
  readonly tokens: ThemeTokens;
  readonly quality: ThemeQualityMetrics;
  readonly tokenHash: string;
  readonly referenceIds: readonly string[];
  readonly sourceUse: string;
  readonly directCopy: false;
  readonly licenseReviewStatus: "required-before-distribution";
}

export interface ThemeManifest {
  readonly schemaVersion: "3.0.0";
  readonly generatedFor: string;
  readonly generatedAt: string;
  readonly themes: readonly WebEditorTheme[];
  readonly manifestSha256: string;
}

export interface AdditionalThemeManifest {
  readonly schemaVersion: "1.0.0";
  readonly generatedFor: string;
  readonly generatedAt: string;
  readonly themes: readonly WebEditorTheme[];
  readonly manifestSha256: string;
}

export const themeManifest = themeManifestSource as unknown as ThemeManifest;
export const canonicalThemes = themeManifest.themes;
export const additionalThemeManifest =
  additionalThemeManifestSource as unknown as AdditionalThemeManifest;
export const additionalThemes = additionalThemeManifest.themes;
export const themes = [...canonicalThemes, ...additionalThemes] as const;

export const defaultTheme = (() => {
  const candidate =
    themes.find((theme) => theme.id === "light-clean-paper") ?? themes[0];

  if (!candidate) {
    throw new Error("The canonical theme manifest contains no themes.");
  }

  return candidate;
})();

export function themeTokenToCssVariable(tokenName: ThemeTokenName): string {
  return `--${tokenName
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([a-zA-Z])(\d)/g, "$1-$2")
    .toLowerCase()}`;
}

export function themeToCssVariables(
  theme: WebEditorTheme,
): Readonly<Record<`--${string}`, string>> {
  return Object.fromEntries(
    THEME_TOKEN_NAMES.map((tokenName) => [
      themeTokenToCssVariable(tokenName),
      theme.tokens[tokenName],
    ]),
  ) as Readonly<Record<`--${string}`, string>>;
}

export function findTheme(themeId: string): WebEditorTheme | undefined {
  return themes.find((theme) => theme.id === themeId);
}
