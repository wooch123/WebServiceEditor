import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  COLOR_VISION_MODES,
  EXPECTED_THEME_FILE_SHA256,
  EXPECTED_THEME_GROUP_COUNTS,
  REQUIRED_CSS_VARIABLES,
  REQUIRED_THEME_TOKENS,
  TOKEN_TO_CSS_VARIABLE,
  deltaE76,
  extractThemeTokenInventory,
  inspectThemeAppSource,
  inspectThemePickerSource,
  inspectThemeResolverSource,
  inspectWebThemeAdapterSource,
  resolveThemeCssVariables,
  simulateColorVision,
  themePerceptualDistance,
  toCssVariableName,
  validatePhase2,
} from "../../scripts/verify-phase2.mjs";

describe("Phase 2 canonical theme validation infrastructure", () => {
  it("validates every canonical theme and every runtime CSS variable", async () => {
    const report = await validatePhase2();

    assert.equal(
      report.result,
      "PASS",
      JSON.stringify(report.failures, null, 2),
    );
    assert.equal(report.details.canonicalManifest.result, "PASS");
    assert.equal(report.details.canonicalManifest.checks, 7288);
    assert.equal(report.details.themeCount, 60);
    assert.deepEqual(report.details.groupCounts, EXPECTED_THEME_GROUP_COUNTS);
    assert.equal(report.details.semanticTokenCount, 52);
    assert.equal(report.details.cssVariableCountPerTheme, 52);
    assert.equal(report.details.resolvedCssVariableCount, 3120);
    assert.equal(
      report.details.perceptualDistance.comparedThemePairCount,
      1770,
    );
    assert.ok(report.details.perceptualDistance.minimum > 3);
    assert.ok(
      Object.values(report.details.colorVisionSummary).every(
        (summary) =>
          summary.minimumChartColorCount >= 7 &&
          summary.minimumStatusColorCount === 4,
      ),
    );
    assert.equal(report.details.coreTokenInventoryCount, 52);
    assert.equal(
      report.details.manifestPreservation.fileSha256,
      EXPECTED_THEME_FILE_SHA256,
    );
    assert.ok(Object.values(report.details.resolverInspection).every(Boolean));
    assert.ok(
      Object.values(report.details.webAdapterInspection).every(Boolean),
    );
    assert.ok(
      Object.entries(report.details.themePickerInspection)
        .filter(([name]) => name !== "mappedGroups")
        .every(([, passed]) => passed),
    );
    assert.ok(Object.values(report.details.appInspection).every(Boolean));
  });

  it("generates deterministic color-vision simulations", () => {
    assert.deepEqual(COLOR_VISION_MODES, [
      "protanopia",
      "deuteranopia",
      "tritanopia",
    ]);
    for (const mode of COLOR_VISION_MODES) {
      assert.match(simulateColorVision("#3366CC", mode), /^#[\dA-F]{6}$/u);
    }
    assert.throws(
      () => simulateColorVision("blue", "protanopia"),
      /six-digit hex/u,
    );
  });

  it("measures perceptual distance independently of token hashes", () => {
    assert.equal(deltaE76("#FFFFFF", "#FFFFFF"), 0);
    assert.ok(deltaE76("#000000", "#FFFFFF") > 90);
    const left = {
      tokens: {
        background: "#000000",
        primary: "#112233",
        accent: "#445566",
        canvas: "#778899",
      },
    };
    const right = {
      tokens: {
        background: "#FFFFFF",
        primary: "#EEDDCC",
        accent: "#BBAA99",
        canvas: "#887766",
      },
    };
    assert.ok(themePerceptualDistance(left, right) > 0);
  });

  it("pins exactly 52 one-to-one semantic CSS variable names", () => {
    assert.equal(REQUIRED_THEME_TOKENS.length, 52);
    assert.equal(REQUIRED_CSS_VARIABLES.length, 52);
    assert.equal(new Set(REQUIRED_THEME_TOKENS).size, 52);
    assert.equal(new Set(REQUIRED_CSS_VARIABLES).size, 52);
    assert.equal(Object.keys(TOKEN_TO_CSS_VARIABLE).length, 52);

    for (const [tokenName, cssVariable] of Object.entries(
      TOKEN_TO_CSS_VARIABLE,
    )) {
      assert.equal(toCssVariableName(tokenName), cssVariable);
    }
    assert.equal(toCssVariableName("cardForeground"), "--card-foreground");
    assert.equal(toCssVariableName("chart8"), "--chart-8");
  });

  it("preserves token values without color or case conversion", () => {
    const tokens = Object.fromEntries(
      REQUIRED_THEME_TOKENS.map((tokenName, index) => [
        tokenName,
        `fixture-${String(index).padStart(2, "0")}`,
      ]),
    );
    const variables = resolveThemeCssVariables({ tokens });

    assert.equal(Object.keys(variables).length, 52);
    for (const [tokenName, cssVariable] of Object.entries(
      TOKEN_TO_CSS_VARIABLE,
    )) {
      assert.equal(variables[cssVariable], tokens[tokenName]);
    }
  });

  it("detects the complete resolver and rejects truncated implementations", () => {
    const completeSource = `
      import themeManifestSource from "./presets/webeditor-theme-presets.v3.json" with { type: "json" };
      export const THEME_TOKEN_NAMES = ["background", "chart8"] as const;
      export const themeManifest = themeManifestSource as unknown as ThemeManifest;
      export const themes = themeManifest.themes;
      export const defaultTheme = (() => {
        return themes.find((theme) => theme.id === "light-clean-paper") ?? themes[0];
      })();
      export function themeTokenToCssVariable(tokenName: string): string {
        return tokenName
          .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
          .replace(/([a-zA-Z])(\\d)/g, "$1-$2")
          .toLowerCase();
      }
      export function themeToCssVariables(theme: Theme) {
        return Object.fromEntries(
          THEME_TOKEN_NAMES.map((tokenName) => [
            themeTokenToCssVariable(tokenName),
            theme.tokens[tokenName],
          ]),
        ) as Readonly<Record<\`--\${string}\`, string>>;
      }
    `;
    assert.ok(
      Object.values(inspectThemeResolverSource(completeSource)).every(Boolean),
    );

    const truncatedSource = completeSource
      .replace(
        "export const themes = themeManifest.themes;",
        "export const themes = themeManifest.themes.slice(0, 20);",
      )
      .replace(
        "THEME_TOKEN_NAMES.map((tokenName)",
        "THEME_TOKEN_NAMES.slice(0, 12).map((tokenName)",
      );
    const truncated = inspectThemeResolverSource(truncatedSource);
    assert.equal(truncated.exposesCompleteManifestArray, false);
    assert.equal(truncated.iteratesPinnedTokenInventory, false);
    assert.deepEqual(extractThemeTokenInventory(completeSource), [
      "background",
      "chart8",
    ]);
  });

  it("requires the web adapter to delegate to the canonical core", () => {
    const completeSource = `
      import {
        defaultTheme,
        themeToCssVariables as resolveThemeCssVariables,
        themes,
        type ThemeGroup,
      } from "@webeditor/theme-core";
      export { defaultTheme, themes, type ThemeGroup };
      export function themeToCssVariables(theme: WebEditorTheme) {
        return resolveThemeCssVariables(theme) as CSSProperties &
          Record<\`--\${string}\`, string>;
      }
    `;
    assert.ok(
      Object.values(inspectWebThemeAdapterSource(completeSource)).every(
        Boolean,
      ),
    );
    assert.equal(
      inspectWebThemeAdapterSource(
        completeSource.replace(
          "resolveThemeCssVariables(theme)",
          "{ '--background': theme.tokens.background }",
        ),
      ).delegatesWithoutTokenConversion,
      false,
    );
  });

  it("detects complete picker inventory and rejects truncation", () => {
    const completeSource = `
      import { defaultTheme, themes, type ThemeGroup, type WebEditorTheme } from "@/theme";
      const themeGroups = [
        { id: "dark", label: "Dark" },
        { id: "gray", label: "Gray" },
        { id: "light", label: "Light" },
      ];
      const currentTheme = themes.find((theme) => theme.id === themeId) ?? defaultTheme;
      const visibleThemes = useMemo(() => {
        return themes.filter((theme) => theme.group === group && true);
      }, [group]);
      const content = visibleThemes.map((theme) => theme.id);
    `;
    assert.deepEqual(inspectThemePickerSource(completeSource), {
      importsCanonicalInventory: true,
      resolvesCurrentTheme: true,
      filtersCompleteGroupInventory: true,
      rendersEveryVisibleTheme: true,
      mappedGroups: ["dark", "gray", "light"],
    });

    const truncated = inspectThemePickerSource(
      completeSource.replace(
        "themes.filter((theme)",
        "themes.slice(0, 5).filter((theme)",
      ),
    );
    assert.equal(truncated.filtersCompleteGroupInventory, false);
  });

  it("detects the complete application selection and application path", () => {
    const completeSource = `
      import { ThemePicker } from "./ThemePicker";
      import { defaultTheme, themes, themeToCssVariables } from "./theme";
      function HeaderControls() {
        return <ThemePicker themeId={themeId} onThemeChange={onThemeChange} />;
      }
      function ProductApp() {
        const selectedTheme = themes.find((theme) => theme.id === themeId) ?? defaultTheme;
        const style = { ...themeToCssVariables(selectedTheme) };
        return <div data-theme-id={selectedTheme.id} style={style} />;
      }
    `;
    assert.deepEqual(inspectThemeAppSource(completeSource), {
      importsCompleteResolver: true,
      importsThemePicker: true,
      resolvesSelectedTheme: true,
      appliesSelectedTheme: true,
      exposesResolvedThemeId: true,
      delegatesThemeSelection: true,
    });
  });
});
