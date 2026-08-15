import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import stylesCss from "@/styles.css?raw";
import { App } from "@/App";
import { PageManager } from "@/features/pages/PageManager";
import type { ProjectDto } from "@/services/projects-api";
import type { PageDto, RuntimePageDto } from "@/services/pages-api";

function runtimePages(): RuntimePageDto[] {
  const pages = Array.from({ length: 31 }, (_, index) => ({
    id: `page-${index}`,
    name: `페이지 ${index + 1}`,
    route: `/page-${index + 1}`,
    sortOrder: index,
    iconName: index === 1 ? "Building2" : "File",
    iconCatalogVersion: "1.31.0" as const,
    navigationVisible: true,
    navigationGroup: index < 16 ? "개요" : "상세",
  }));
  pages[0] = {
    ...pages[0]!,
    name: "숨김 페이지",
    route: "/hidden",
    navigationVisible: false,
  };
  return pages.reverse();
}

function installRuntimeApi() {
  const calls: string[] = [];
  const pages = runtimePages();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input), "http://local").pathname;
      calls.push(path);
      if (path === "/api/v1/runtime/runtime-project/navigation") {
        return new Response(
          JSON.stringify({
            projectId: "runtime-project",
            versionId: "version-7",
            publishedAt: "2026-08-15T00:00:00Z",
            pages,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (path === "/api/v1/ui/icons/File") {
        return new Response(
          JSON.stringify({
            item: {
              name: "File",
              dynamicName: "file",
              categories: ["files"],
              keywords: [],
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (path === "/api/v1/ui/icons/Building2") {
        return new Response(
          JSON.stringify({
            item: {
              name: "Building2",
              dynamicName: "building-2",
              categories: ["buildings"],
              keywords: [],
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({ error: { code: "UNHANDLED", message: path } }),
        { status: 500, headers: { "content-type": "application/json" } },
      );
    }),
  );
  return { calls };
}

function installPublishTransitionApi() {
  const project: ProjectDto = {
    id: "publish-project",
    name: "게시 전환",
    slug: "publish-transition",
    description: null,
    lifecycleStatus: "ACTIVE",
    status: "DRAFT",
    schemaVersion: 1,
    revision: 1,
    lifecycleRevision: 0,
    favorite: false,
    themeId: "light-clean-paper",
    createdAt: "2026-08-15T00:00:00Z",
    updatedAt: "2026-08-15T00:00:00Z",
    pageCount: 1,
    elementCount: 0,
    bindingCount: 0,
    tableCount: 0,
    assetCount: 0,
  };
  const draftPage: PageDto = {
    id: "page-1",
    projectId: project.id,
    schemaVersion: 1,
    revision: 2,
    name: "초안 이름",
    route: "/page-1",
    pageType: "blank",
    iconName: "File",
    iconCatalogVersion: "1.31.0",
    navigationVisible: true,
    navigationGroup: null,
    sortOrder: 0,
    deletedAt: null,
  };
  let publishedName = "게시 이름";
  let projectRevision = 1;
  const calls: Array<{ path: string; method: string }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const path = new URL(String(input), "http://local").pathname;
      const method = init.method ?? "GET";
      calls.push({ path, method });
      if (path === "/api/v1/runtime/publish-project/navigation") {
        return Response.json({
          projectId: project.id,
          versionId: projectRevision === 1 ? "version-1" : "version-2",
          publishedAt: "2026-08-15T00:00:00Z",
          pages: [
            {
              id: draftPage.id,
              name: publishedName,
              route: draftPage.route,
              sortOrder: 0,
              iconName: "File",
              iconCatalogVersion: "1.31.0",
              navigationVisible: true,
              navigationGroup: null,
            },
          ],
        });
      }
      if (path === "/api/v1/projects/publish-project/pages") {
        return Response.json({
          pages: [draftPage],
          projectRevision,
          publishedVersionId: "version-1",
        });
      }
      if (path === "/api/v1/projects/publish-project/publish/plan") {
        return Response.json({
          plan: {
            projectId: project.id,
            projectRevision,
            pages: [draftPage],
            errors: [],
            warnings: [],
          },
        });
      }
      if (
        path === "/api/v1/projects/publish-project/publish" &&
        method === "POST"
      ) {
        publishedName = draftPage.name;
        projectRevision += 1;
        return Response.json({
          versionId: "version-2",
          publishedAt: "2026-08-15T00:01:00Z",
          projectRevision,
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
        { error: { code: "UNHANDLED", message: `${method} ${path}` } },
        { status: 500 },
      );
    }),
  );
  return { calls, project };
}

beforeEach(() => {
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
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState({}, "", "/");
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: 1024,
  });
});

describe("PublishedRuntime", () => {
  it("keeps draft navigation out of runtime until the publish control commits it", async () => {
    const { calls, project } = installPublishTransitionApi();
    const user = userEvent.setup();
    window.history.replaceState({}, "", "/runtime/publish-project/page-1");
    const runtimeBefore = render(<App />);
    expect(
      await screen.findByRole("heading", { name: "게시 이름" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("초안 이름")).not.toBeInTheDocument();
    expect(
      calls.filter(
        (call) => call.path === "/api/v1/projects/publish-project/pages",
      ),
    ).toHaveLength(0);
    runtimeBefore.unmount();

    const selectPage = vi.fn();
    const manager = render(
      <PageManager
        project={project}
        selectedPageId={null}
        onSelectPage={selectPage}
      />,
    );
    await screen.findByText("초안 이름", { selector: "strong" });
    await user.click(screen.getByRole("button", { name: "게시" }));
    const publishDialog = await screen.findByRole("alertdialog", {
      name: "게시",
    });
    await user.click(
      within(publishDialog).getByRole("button", { name: "게시" }),
    );
    await waitFor(() =>
      expect(
        calls.filter(
          (call) =>
            call.path === "/api/v1/projects/publish-project/publish" &&
            call.method === "POST",
        ),
      ).toHaveLength(1),
    );
    manager.unmount();

    render(<App />);
    expect(
      await screen.findByRole("heading", { name: "초안 이름" }),
    ).toBeInTheDocument();
  });

  it("uses published navigation only, resolves a hidden deep link, preserves order/icons, history, collapse, groups, and refresh", async () => {
    const { calls } = installRuntimeApi();
    window.history.replaceState({}, "", "/runtime/runtime-project/hidden");
    const user = userEvent.setup();
    const view = render(<App />);

    expect(
      await screen.findByRole("heading", { name: "숨김 페이지" }),
    ).toBeInTheDocument();
    const navigation = screen.getByRole("navigation", { name: "페이지 탐색" });
    expect(
      within(navigation).queryByRole("button", { name: "숨김 페이지" }),
    ).not.toBeInTheDocument();
    expect(
      within(navigation).getByRole("textbox", { name: "페이지 검색" }),
    ).toBeInTheDocument();
    expect(
      calls.filter(
        (path) => path.includes("/projects/") && path.endsWith("/pages"),
      ),
    ).toHaveLength(0);

    const visibleNames = within(navigation)
      .getAllByRole("button")
      .map((button) => button.textContent)
      .filter((text) => text?.startsWith("페이지 "));
    expect(visibleNames.slice(0, 3)).toEqual([
      "페이지 2",
      "페이지 3",
      "페이지 4",
    ]);
    await waitFor(() =>
      expect(
        calls.filter((path) => path === "/api/v1/ui/icons/Building2"),
      ).toHaveLength(1),
    );

    await user.click(
      within(navigation).getByRole("button", { name: "페이지 2" }),
    );
    expect(window.location.pathname).toBe("/runtime/runtime-project/page-2");
    expect(
      screen.getByRole("heading", { name: "페이지 2" }),
    ).toBeInTheDocument();
    window.history.back();
    await waitFor(() =>
      expect(window.location.pathname).toBe("/runtime/runtime-project/hidden"),
    );
    expect(
      await screen.findByRole("heading", { name: "숨김 페이지" }),
    ).toBeInTheDocument();
    window.history.forward();
    await waitFor(() =>
      expect(window.location.pathname).toBe("/runtime/runtime-project/page-2"),
    );
    expect(
      await screen.findByRole("heading", { name: "페이지 2" }),
    ).toBeInTheDocument();
    window.history.back();
    await waitFor(() =>
      expect(window.location.pathname).toBe("/runtime/runtime-project/hidden"),
    );

    await user.click(screen.getByRole("button", { name: "탐색 접기" }));
    expect(
      within(navigation).getByRole("button", { name: "페이지 2" }),
    ).toHaveAttribute("aria-label", "페이지 2");
    await user.click(screen.getByRole("button", { name: "탐색 펼치기" }));
    await user.click(within(navigation).getByRole("button", { name: /개요/ }));
    expect(
      within(navigation).queryByRole("button", { name: "페이지 2" }),
    ).not.toBeInTheDocument();

    expect(stylesCss).toMatch(
      /\.runtime-nav-item,\s*\.runtime-group-trigger[\s\S]*height:\s*var\(--control-height\)/,
    );
    expect(stylesCss).toMatch(
      /\.runtime-controls[\s\S]*height:\s*var\(--control-height\)/,
    );
    const layout = document.querySelector(".runtime-layout");
    const sidebar = document.querySelector(".runtime-sidebar");
    const runtimePage = document.querySelector(".runtime-page");
    expect(layout?.children[0]).toBe(sidebar);
    expect(layout?.children[1]).toBe(runtimePage);
    expect(stylesCss).toMatch(
      /\.runtime-layout\s*\{[\s\S]*grid-template-columns:\s*17rem minmax\(0, 1fr\)/,
    );
    expect(
      document.querySelector(".editor-left-panel"),
    ).not.toBeInTheDocument();

    view.unmount();
    render(<App />);
    expect(
      await screen.findByRole("heading", { name: "숨김 페이지" }),
    ).toBeInTheDocument();
    expect(
      calls.filter(
        (path) => path === "/api/v1/runtime/runtime-project/navigation",
      ),
    ).toHaveLength(2);
  });

  it("uses a labelled narrow-screen Drawer without rendering a desktop sidebar", async () => {
    installRuntimeApi();
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 390,
    });
    window.history.replaceState({}, "", "/runtime/runtime-project/page-2");
    const user = userEvent.setup();
    render(<App />);
    expect(
      await screen.findByRole("heading", { name: "페이지 2" }),
    ).toBeInTheDocument();
    const trigger = await screen.findByRole("button", { name: "탐색 열기" });
    expect(document.querySelector(".runtime-sidebar")).not.toBeInTheDocument();
    await user.click(trigger);
    const drawer = screen.getByRole("dialog", { name: "페이지" });
    expect(within(drawer).getByText("게시된 페이지")).toBeInTheDocument();
    expect(
      within(drawer).getByRole("navigation", { name: "페이지 탐색" }),
    ).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(trigger).toHaveFocus();
  });
});
