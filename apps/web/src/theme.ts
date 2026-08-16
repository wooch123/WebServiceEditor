import type { CSSProperties } from "react";

import {
  additionalThemes,
  canonicalThemes,
  defaultTheme,
  themeTokenToCssVariable,
  themeToCssVariables as resolveThemeCssVariables,
  themes,
  type ThemeGroup,
  type ThemeTokens,
  type WebEditorTheme,
} from "@webeditor/theme-core";

export {
  additionalThemes,
  canonicalThemes,
  defaultTheme,
  themes,
  type ThemeGroup,
  type WebEditorTheme,
};

export function themeToCssVariables(
  theme: WebEditorTheme,
): CSSProperties & Record<`--${string}`, string> {
  return resolveThemeCssVariables(theme) as CSSProperties &
    Record<`--${string}`, string>;
}

export function themeTokensToCssVariables(
  tokens: ThemeTokens,
): CSSProperties & Record<`--${string}`, string> {
  return Object.fromEntries(
    Object.entries(tokens).map(([name, value]) => [
      themeTokenToCssVariable(name as keyof ThemeTokens),
      value,
    ]),
  ) as CSSProperties & Record<`--${string}`, string>;
}
