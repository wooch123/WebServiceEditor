import { describe, expect, it } from "vitest";

import {
  additionalThemes,
  canonicalThemes,
  themes,
  themeToCssVariables,
} from "./theme";

describe("canonical WebEditor themes", () => {
  it("preserves 60 canonical themes and adds 60 unique selectable themes", () => {
    expect(canonicalThemes).toHaveLength(60);
    expect(additionalThemes).toHaveLength(60);
    expect(themes).toHaveLength(120);
    expect(new Set(themes.map((theme) => theme.id)).size).toBe(120);
    expect(new Set(themes.map((theme) => theme.tokenHash)).size).toBe(120);
    expect(themes.filter((theme) => theme.group === "dark")).toHaveLength(40);
    expect(themes.filter((theme) => theme.group === "gray")).toHaveLength(40);
    expect(themes.filter((theme) => theme.group === "light")).toHaveLength(40);
  });

  it("maps camel-case manifest tokens to shadcn-style CSS variables", () => {
    const theme = themes[0];
    expect(theme).toBeDefined();

    const variables = themeToCssVariables(theme!);

    expect(variables["--background"]).toBe(theme!.tokens.background);
    expect(variables["--card-foreground"]).toBe(theme!.tokens.cardForeground);
    expect(variables["--sidebar-primary-foreground"]).toBe(
      theme!.tokens.sidebarPrimaryForeground,
    );
    expect(variables["--chart-8"]).toBe(theme!.tokens.chart8);
  });

  it("maps all 6,240 preset token values to CSS variables", () => {
    const mappedValues = themes.flatMap((theme) =>
      Object.values(themeToCssVariables(theme)),
    );

    expect(mappedValues).toHaveLength(6_240);
    for (const theme of themes) {
      expect(Object.keys(themeToCssVariables(theme))).toHaveLength(52);
    }
  });
});
