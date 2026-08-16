import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ELEMENT_DEFINITIONS, ELEMENT_PROPERTY_TABS } from "@webeditor/domain";
import type { RuntimeThemeManifest } from "@webeditor/theme-core";

import { App } from "@/App";
import { defaultTheme, themes } from "@/theme";
import {
  RUNTIME_THEME_PREFERENCE_PREFIX,
  clearRuntimeThemePreference,
  readRuntimeThemePreference,
  resolveRuntimeTheme,
  writeRuntimeThemePreference,
} from "./runtime-theme";

const projectId = "runtime-theme-project";
const pageId = "runtime-theme-page";

function theme(themeId: string) {
  return themes.find(({ id }) => id === themeId)!;
}

function manifest(
  themeId: string,
  version: number,
  allowedThemeIds: readonly string[],
): RuntimeThemeManifest {
  const selected = theme(themeId);
  return {
    schemaVersion: 1,
    projectId,
    version,
    defaultThemeId: selected.id,
    publishedThemeRevisionId: `revision-${version}`,
    publishedThemeId: selected.id,
    resolvedThemeId: selected.id,
    resolvedThemeRevisionId: `revision-${version}`,
    tokenHash: "a".repeat(64),
    tokens: selected.tokens,
    allowRuntimeThemeSelection: true,
    allowedThemeIds,
    fallbackThemeId: defaultTheme.id,
    updatedAt: `2026-08-16T00:00:0${version}.000Z`,
  };
}

beforeEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.webeditorThemeId;
  delete document.documentElement.dataset.webeditorThemeRevision;
  window.history.replaceState({}, "", `/runtime/${projectId}/page`);
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.webeditorThemeId;
  delete document.documentElement.dataset.webeditorThemeRevision;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState({}, "", "/");
});

describe("Runtime Theme preference", () => {
  it("stores preferences by Project, rejects corrupt/disallowed values, and keeps profiles independent", () => {
    const first = writeRuntimeThemePreference(projectId, "light-clean-paper");
    expect(first.persisted).toBe(true);
    expect(readRuntimeThemePreference(projectId)).toEqual(first.preference);
    expect(readRuntimeThemePreference("another-project")).toBeNull();
    expect(
      window.localStorage.getItem(
        `${RUNTIME_THEME_PREFERENCE_PREFIX}${projectId}`,
      ),
    ).toBe(JSON.stringify(first.preference));

    const allowed = manifest("dark-github", 1, [
      "dark-github",
      "light-clean-paper",
    ]);
    expect(resolveRuntimeTheme(allowed, first.preference)).toMatchObject({
      themeId: "light-clean-paper",
      userOverrideActive: true,
    });
    const removed = manifest("dark-github", 2, ["dark-github"]);
    expect(resolveRuntimeTheme(removed, first.preference)).toMatchObject({
      themeId: "dark-github",
      userOverrideActive: false,
    });

    window.localStorage.setItem(
      `${RUNTIME_THEME_PREFERENCE_PREFIX}${projectId}`,
      "{broken",
    );
    expect(readRuntimeThemePreference(projectId)).toBeNull();
    expect(clearRuntimeThemePreference(projectId)).toBe(true);
  });

  it("keeps published content unmounted until the initial Theme Manifest resolves", async () => {
    let resolveManifest!: (value: Response) => void;
    const pendingManifest = new Promise<Response>((resolve) => {
      resolveManifest = resolve;
    });
    vi.spyOn(window, "setInterval").mockReturnValue(
      15 as unknown as ReturnType<typeof setInterval>,
    );
    vi.spyOn(window, "clearInterval").mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const path = new URL(String(input), "http://local").pathname;
        if (path === `/api/v1/runtime/${projectId}/theme-manifest`) {
          return pendingManifest;
        }
        if (path === `/api/v1/runtime/${projectId}/navigation`) {
          return Promise.resolve(
            Response.json({
              projectId,
              versionId: "definition-1",
              publishedAt: "2026-08-16T00:00:00.000Z",
              pages: [],
            }),
          );
        }
        if (path === "/api/v1/elements/registry") {
          return Promise.resolve(
            Response.json({
              schemaVersion: 1,
              tabs: ELEMENT_PROPERTY_TABS,
              definitions: ELEMENT_DEFINITIONS,
              checksum: "runtime-theme-registry",
            }),
          );
        }
        return Promise.resolve(
          Response.json(
            { error: { code: "UNHANDLED", message: path } },
            { status: 500 },
          ),
        );
      }),
    );

    const { container } = render(<App />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(container.querySelector(".runtime-app")).toBeNull();
    expect(screen.getByRole("status")).toBeInTheDocument();

    resolveManifest(Response.json(manifest("dark-github", 1, ["dark-github"])));
    await waitFor(() =>
      expect(container.querySelector(".runtime-app")).toHaveAttribute(
        "data-theme-id",
        "dark-github",
      ),
    );
  });

  it("polls a validated revision without remounting, retains an allowed override, then falls back when removed", async () => {
    const user = userEvent.setup();
    let currentManifest = manifest("dark-github", 1, [
      "dark-github",
      "light-clean-paper",
    ]);
    let poll: (() => void) | undefined;
    vi.spyOn(window, "setInterval").mockImplementation((handler, delay) => {
      if (typeof handler === "function" && delay === 3_000) poll = handler;
      return 15 as unknown as ReturnType<typeof setInterval>;
    });
    vi.spyOn(window, "clearInterval").mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const path = new URL(String(input), "http://local").pathname;
        if (path === `/api/v1/runtime/${projectId}/theme-manifest`) {
          return Response.json(currentManifest);
        }
        if (path === `/api/v1/runtime/${projectId}/navigation`) {
          return Response.json({
            projectId,
            versionId: "definition-1",
            publishedAt: "2026-08-16T00:00:00.000Z",
            pages: [
              {
                id: pageId,
                name: "테마 페이지",
                route: "/page",
                sortOrder: 0,
                iconName: "File",
                iconCatalogVersion: "1.31.0",
                navigationVisible: true,
                navigationGroup: null,
              },
            ],
          });
        }
        if (path === `/api/v1/runtime/${projectId}/pages/${pageId}`) {
          return Response.json({
            projectId,
            versionId: "definition-1",
            publishedAt: "2026-08-16T00:00:00.000Z",
            page: {
              id: pageId,
              name: "테마 페이지",
              route: "/page",
              sortOrder: 0,
              iconName: "File",
              iconCatalogVersion: "1.31.0",
              navigationVisible: true,
              navigationGroup: null,
            },
            elements: [],
          });
        }
        if (path === "/api/v1/elements/registry") {
          return Response.json({
            schemaVersion: 1,
            tabs: ELEMENT_PROPERTY_TABS,
            definitions: ELEMENT_DEFINITIONS,
            checksum: "runtime-theme-registry",
          });
        }
        if (path === "/api/v1/ui/icons/File") {
          return Response.json({
            item: {
              name: "File",
              dynamicName: "file",
              categories: ["files"],
              keywords: [],
            },
          });
        }
        return Response.json(
          { error: { code: "UNHANDLED", message: path } },
          { status: 500 },
        );
      }),
    );

    const { container } = render(<App />);
    expect(
      await screen.findByRole("heading", { name: "테마 페이지" }),
    ).toBeInTheDocument();
    const runtimeRoot = container.querySelector<HTMLElement>(".runtime-app")!;
    const runtimePage = container.querySelector<HTMLElement>(".runtime-page")!;
    expect(runtimeRoot).toHaveAttribute("data-theme-id", "dark-github");
    expect(runtimeRoot).toHaveAttribute("data-theme-revision", "revision-1");
    expect(document.documentElement.dataset.webeditorThemeId).toBe(
      "dark-github",
    );

    await user.click(screen.getByRole("button", { name: /테마 선택/ }));
    expect(
      screen.getByRole("option", { name: "프로젝트 기본값 사용" }),
    ).toHaveAttribute("aria-selected", "true");
    await user.click(screen.getByRole("tab", { name: /라이트/ }));
    const allowedList = screen.getByRole("listbox", { name: "라이트 테마" });
    expect(within(allowedList).getAllByRole("option")).toHaveLength(2);
    await user.click(
      within(allowedList).getByRole("option", {
        name: "Clean Paper 테마 적용",
      }),
    );
    expect(runtimeRoot).toHaveAttribute("data-theme-id", "light-clean-paper");
    expect(screen.getByText("사용자 테마")).toBeInTheDocument();

    currentManifest = manifest("dark-polar-night", 2, [
      "dark-polar-night",
      "light-clean-paper",
    ]);
    await act(async () => {
      poll?.();
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(runtimeRoot).toHaveAttribute("data-theme-id", "light-clean-paper"),
    );
    expect(container.querySelector(".runtime-page")).toBe(runtimePage);

    currentManifest = manifest("dark-polar-night", 3, ["dark-polar-night"]);
    await act(async () => {
      poll?.();
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(runtimeRoot).toHaveAttribute("data-theme-id", "dark-polar-night"),
    );
    expect(
      window.localStorage.getItem(
        `${RUNTIME_THEME_PREFERENCE_PREFIX}${projectId}`,
      ),
    ).toBeNull();
    expect(screen.queryByText("사용자 테마")).not.toBeInTheDocument();
  });
});
