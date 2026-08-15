import type { CSSProperties } from "react";

import themeManifest from "../../../webeditor_theme_presets_v3.json";

export type ThemeGroup = "dark" | "gray" | "light";

export interface WebEditorTheme {
  id: string;
  name: string;
  group: ThemeGroup;
  referenceFamily: string;
  tokens: Record<string, string>;
}

interface ThemeManifest {
  themes: WebEditorTheme[];
}

export const themes = (themeManifest as ThemeManifest).themes;

function getDefaultTheme(): WebEditorTheme {
  const theme =
    themes.find((candidate) => candidate.id === "light-clean-paper") ??
    themes[0];

  if (!theme) {
    throw new Error("The canonical theme manifest contains no themes.");
  }

  return theme;
}

export const defaultTheme = getDefaultTheme();

function toCssTokenName(tokenName: string): string {
  return tokenName
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([a-zA-Z])(\d)/g, "$1-$2")
    .toLowerCase();
}

export function themeToCssVariables(
  theme: WebEditorTheme,
): CSSProperties & Record<`--${string}`, string> {
  const variables: Record<string, string> = {};

  for (const [tokenName, value] of Object.entries(theme.tokens)) {
    variables[`--${toCssTokenName(tokenName)}`] = value;
  }

  return variables as CSSProperties & Record<`--${string}`, string>;
}
