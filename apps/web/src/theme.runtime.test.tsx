import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import themeManifest from "../../../webeditor_theme_presets_v3.json";

import { App } from "./App";
import { themes, themeToCssVariables } from "./theme";

const canonicalTokenToCssVariable = {
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
} as const;

type CanonicalTokenName = keyof typeof canonicalTokenToCssVariable;

const canonicalTokenNames = Object.keys(
  canonicalTokenToCssVariable,
) as CanonicalTokenName[];

describe("canonical theme runtime", () => {
  it("keeps the 60-theme inventory, 20/20/20 groups, and all 52 source values exact", () => {
    expect(themeManifest.themes).toHaveLength(60);
    expect(themes).toHaveLength(60);
    expect(themes.map((theme) => theme.id)).toStrictEqual(
      themeManifest.themes.map((theme) => theme.id),
    );
    expect(canonicalTokenNames).toHaveLength(52);

    const groupCounts = themes.reduce(
      (counts, theme) => ({
        ...counts,
        [theme.group]: counts[theme.group] + 1,
      }),
      { dark: 0, gray: 0, light: 0 },
    );
    expect(groupCounts).toStrictEqual({ dark: 20, gray: 20, light: 20 });

    for (const sourceTheme of themeManifest.themes) {
      const runtimeTheme = themes.find((theme) => theme.id === sourceTheme.id);
      expect(runtimeTheme, sourceTheme.id).toBeDefined();
      if (!runtimeTheme) {
        continue;
      }

      expect(
        Object.keys(sourceTheme.tokens).sort(),
        sourceTheme.id,
      ).toStrictEqual([...canonicalTokenNames].sort());

      const cssVariables = themeToCssVariables(runtimeTheme);
      expect(Object.keys(cssVariables).sort(), sourceTheme.id).toStrictEqual(
        Object.values(canonicalTokenToCssVariable).sort(),
      );

      for (const tokenName of canonicalTokenNames) {
        const cssVariable = canonicalTokenToCssVariable[tokenName];
        expect(
          cssVariables[cssVariable],
          `${sourceTheme.id}:${tokenName}`,
        ).toBe(sourceTheme.tokens[tokenName]);
      }
    }
  });

  it("exposes the exact grouped inventory after the required font controls", async () => {
    const user = userEvent.setup();
    render(<App />);

    const displaySettings = screen.getByLabelText("화면 표시 설정");
    const minus = within(displaySettings).getByRole("button", {
      name: "글꼴 크기 줄이기",
    });
    const size = within(displaySettings).getByRole("status", {
      name: "현재 글꼴 크기",
    });
    const plus = within(displaySettings).getByRole("button", {
      name: "글꼴 크기 늘리기",
    });
    const themeTrigger = within(displaySettings).getByRole("button", {
      name: /테마 선택/,
    });

    expect(size).toHaveTextContent("12px");
    expect(
      minus.compareDocumentPosition(size) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      size.compareDocumentPosition(plus) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      plus.compareDocumentPosition(themeTrigger) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    await user.click(themeTrigger);
    expect(
      screen.getAllByRole("tab").map((tab) => tab.textContent),
    ).toStrictEqual(["다크20", "그레이20", "라이트20"]);

    for (const [group, label] of [
      ["dark", "다크"],
      ["gray", "그레이"],
      ["light", "라이트"],
    ] as const) {
      await user.click(screen.getByRole("tab", { name: new RegExp(label) }));
      const listbox = screen.getByRole("listbox", {
        name: `${label} 테마`,
      });
      const optionIds = within(listbox)
        .getAllByRole("option")
        .map((option) => option.getAttribute("data-theme-id"));
      expect(optionIds).toStrictEqual(
        themeManifest.themes
          .filter((theme) => theme.group === group)
          .map((theme) => theme.id),
      );
    }
  });

  it("selects and applies every canonical theme through the visible header control", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    const themeTrigger = screen.getByRole("button", { name: /테마 선택/ });
    const app = container.querySelector<HTMLElement>(".webeditor-app");

    expect(app).not.toBeNull();
    if (!app) {
      return;
    }

    await user.click(themeTrigger);
    let currentGroup = "light";

    for (const sourceTheme of themeManifest.themes) {
      if (sourceTheme.group !== currentGroup) {
        currentGroup = sourceTheme.group;
        const groupLabel =
          currentGroup === "dark"
            ? "다크"
            : currentGroup === "gray"
              ? "그레이"
              : "라이트";
        await user.click(
          screen.getByRole("tab", { name: new RegExp(groupLabel) }),
        );
      }
      const option = screen.getByRole("option", {
        name: `${sourceTheme.name} 테마 적용`,
      });
      await user.click(option);

      expect(option, sourceTheme.id).toHaveAttribute("aria-selected", "true");
      expect(app, sourceTheme.id).toHaveAttribute(
        "data-theme-id",
        sourceTheme.id,
      );

      for (const tokenName of canonicalTokenNames) {
        const cssVariable = canonicalTokenToCssVariable[tokenName];
        expect(
          app.style.getPropertyValue(cssVariable),
          `${sourceTheme.id}:${cssVariable}`,
        ).toBe(sourceTheme.tokens[tokenName]);
      }
    }
  }, 30_000);

  it("uses and retains the selected project default while editing", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    const spcHeading = screen.getByRole("heading", {
      name: "품질 관리 SPC 센터",
    });
    const spcCard = spcHeading.closest("article");

    expect(spcCard).not.toBeNull();
    await user.click(
      within(spcCard!).getByRole("button", { name: "편집 열기" }),
    );
    expect(container.querySelector(".webeditor-app")).toHaveAttribute(
      "data-theme-id",
      "dark-polar-night",
    );

    await user.click(screen.getByRole("button", { name: /테마 선택/ }));
    await user.click(
      screen.getByRole("option", {
        name: "Solarized Deep 테마 적용",
      }),
    );
    await user.click(screen.getByRole("button", { name: "적용" }));
    await user.click(screen.getByRole("button", { name: "프로젝트 홈으로" }));

    const reopenedCard = screen
      .getByRole("heading", { name: "품질 관리 SPC 센터" })
      .closest("article");
    await user.click(
      within(reopenedCard!).getByRole("button", { name: "편집 열기" }),
    );
    expect(container.querySelector(".webeditor-app")).toHaveAttribute(
      "data-theme-id",
      "dark-solarized-deep",
    );
  });
});
