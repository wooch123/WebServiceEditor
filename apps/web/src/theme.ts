import type { CSSProperties } from "react";

import {
  additionalThemes,
  canonicalThemes,
  defaultTheme,
  themeToCssVariables as resolveThemeCssVariables,
  themes,
  type ThemeGroup,
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
