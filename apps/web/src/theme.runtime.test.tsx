import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import themeManifest from "../../../webeditor_theme_presets_v3.json";

import { App } from "./App";
import type { ProjectDto } from "./services/projects-api";
import {
  additionalThemes,
  canonicalThemes,
  themes,
  themeToCssVariables,
} from "./theme";

const originalFetch = globalThis.fetch;

function project(
  id: string,
  name: string,
  slug: string,
  themeId: string,
): ProjectDto {
  return {
    id,
    name,
    slug,
    description: `${name} 설명`,
    lifecycleStatus: "ACTIVE",
    status: "DRAFT",
    schemaVersion: 1,
    revision: 1,
    lifecycleRevision: 0,
    favorite: false,
    themeId,
    createdAt: "2026-08-15T00:00:00.000Z",
    updatedAt: "2026-08-15T00:00:00.000Z",
    pageCount: 3,
    elementCount: 12,
    bindingCount: 4,
    tableCount: 2,
    assetCount: 0,
  };
}

beforeEach(() => {
  let activeProjects = [
    project(
      "project-health",
      "지역 건강지표 모니터",
      "regional-health",
      "light-clean-paper",
    ),
    project(
      "project-spc",
      "품질 관리 SPC 센터",
      "spc-center",
      "dark-polar-night",
    ),
  ];

  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const rawUrl =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const pathname = new URL(rawUrl, "http://webeditor.local").pathname;
      const method = init.method?.toUpperCase() ?? "GET";

      if (pathname === "/api/v1/projects" && method === "GET") {
        return Response.json({ projects: activeProjects });
      }
      if (pathname === "/api/v1/recycle-bin/projects" && method === "GET") {
        return Response.json({ projects: [] });
      }
      if (pathname === "/api/v1/projects/project-spc" && method === "PATCH") {
        const body = JSON.parse(String(init.body)) as { themeId?: string };
        const current = activeProjects.find(
          (candidate) => candidate.id === "project-spc",
        )!;
        const updated = {
          ...current,
          themeId: body.themeId ?? current.themeId,
          revision: current.revision + 1,
        };
        activeProjects = activeProjects.map((candidate) =>
          candidate.id === updated.id ? updated : candidate,
        );
        return Response.json({ project: updated });
      }

      return Response.json(
        {
          error: {
            code: "UNHANDLED_TEST_ROUTE",
            message: `${method} ${pathname}`,
          },
        },
        { status: 500 },
      );
    },
  );

  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: fetchMock,
    writable: true,
  });
});

afterEach(() => {
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: originalFetch,
    writable: true,
  });
});

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
  it("keeps all 60 canonical source themes byte-exact and adds 60 presets", () => {
    expect(themeManifest.themes).toHaveLength(60);
    expect(canonicalThemes).toHaveLength(60);
    expect(additionalThemes).toHaveLength(60);
    expect(themes).toHaveLength(120);
    expect(JSON.stringify(canonicalThemes)).toBe(
      JSON.stringify(themeManifest.themes),
    );
    expect(canonicalTokenNames).toHaveLength(52);

    const groupCounts = themes.reduce(
      (counts, theme) => ({
        ...counts,
        [theme.group]: counts[theme.group] + 1,
      }),
      { dark: 0, gray: 0, light: 0 },
    );
    expect(groupCounts).toStrictEqual({ dark: 40, gray: 40, light: 40 });

    let mappedValueCount = 0;
    for (const runtimeTheme of themes) {
      const cssVariables = themeToCssVariables(runtimeTheme);
      expect(Object.keys(cssVariables), runtimeTheme.id).toHaveLength(52);
      mappedValueCount += Object.keys(cssVariables).length;
    }
    expect(mappedValueCount).toBe(6_240);

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

    const displaySettings = await screen.findByLabelText("화면 표시 설정");
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
    ).toStrictEqual(["다크40", "그레이40", "라이트40"]);

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
        themes
          .filter((theme) => theme.group === group)
          .map((theme) => theme.id),
      );
      expect(optionIds).toHaveLength(40);
    }
  });

  it("selects and applies every canonical and additional theme through the visible header control", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    const themeTrigger = await screen.findByRole("button", {
      name: /테마 선택/,
    });
    const app = container.querySelector<HTMLElement>(".webeditor-app");

    expect(app).not.toBeNull();
    if (!app) {
      return;
    }

    await user.click(themeTrigger);
    let currentGroup = "light";

    for (const sourceTheme of themes) {
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
  }, 60_000);

  it("uses and retains the selected project default while editing", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    const spcHeading = await screen.findByRole("heading", {
      name: "품질 관리 SPC 센터",
    });
    const spcCard = spcHeading.closest("article");

    expect(spcCard).not.toBeNull();
    await user.click(within(spcCard!).getByRole("button", { name: "열기" }));
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

    const reopenedCard = (
      await screen.findByRole("heading", { name: "품질 관리 SPC 센터" })
    ).closest("article");
    await user.click(
      within(reopenedCard!).getByRole("button", { name: "열기" }),
    );
    expect(container.querySelector(".webeditor-app")).toHaveAttribute(
      "data-theme-id",
      "dark-solarized-deep",
    );
  });
});
