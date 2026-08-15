import { describe, expect, it } from "vitest";

import {
  COLOR_VISION_MODES,
  THEME_REVISION_STATUSES,
  THEME_TOKEN_NAMES,
  canTransitionThemeRevision,
  createDraftThemeRevision,
  defaultTheme,
  simulateColorVision,
  themeToCssVariables,
  themes,
} from "../src/index.js";

describe("canonical theme core", () => {
  it("loads the exact manifest inventory and semantic token contract", () => {
    expect(themes).toHaveLength(60);
    expect(THEME_TOKEN_NAMES).toHaveLength(52);
    expect(new Set(themes.map((theme) => theme.tokenHash))).toHaveLength(60);
    expect(themeToCssVariables(defaultTheme)).toHaveProperty(
      "--chart-8",
      defaultTheme.tokens.chart8,
    );
  });

  it("models the guarded theme revision lifecycle", () => {
    expect(THEME_REVISION_STATUSES).toEqual([
      "DRAFT",
      "VALIDATING",
      "VALID",
      "INVALID",
      "PUBLISHED",
      "SUPERSEDED",
    ]);
    expect(canTransitionThemeRevision("DRAFT", "VALIDATING")).toBe(true);
    expect(canTransitionThemeRevision("INVALID", "PUBLISHED")).toBe(false);

    expect(
      createDraftThemeRevision({
        id: "theme-revision-1",
        projectId: "project-1",
        presetId: defaultTheme.id,
        tokenHash: defaultTheme.tokenHash,
        tokens: defaultTheme.tokens,
        createdAt: "2026-08-15T00:00:00.000Z",
      }).status,
    ).toBe("DRAFT");
  });

  it("produces deterministic color-vision simulation previews", () => {
    expect(COLOR_VISION_MODES).toHaveLength(4);
    expect(simulateColorVision("#3366CC", "normal")).toBe("#3366CC");
    expect(simulateColorVision("#3366CC", "deuteranopia")).toMatch(
      /^#[\dA-F]{6}$/u,
    );
    expect(() => simulateColorVision("blue", "protanopia")).toThrow(
      /six-digit hex/u,
    );
  });
});
