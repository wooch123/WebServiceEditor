import { describe, expect, it } from "vitest";

import { themes, themeToCssVariables } from "./theme";

describe("canonical WebEditor themes", () => {
  it("exposes the exact 20/20/20 manifest groups", () => {
    expect(themes).toHaveLength(60);
    expect(themes.filter((theme) => theme.group === "dark")).toHaveLength(20);
    expect(themes.filter((theme) => theme.group === "gray")).toHaveLength(20);
    expect(themes.filter((theme) => theme.group === "light")).toHaveLength(20);
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
});
