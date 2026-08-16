import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ELEMENT_DEFINITIONS,
  ELEMENT_PROPERTY_TABS,
  type ElementEntryDto,
} from "@webeditor/domain";

import stylesCss from "@/styles.css?raw";
import { App } from "@/App";
import { PageManager } from "@/features/pages/PageManager";
import type { ProjectDto } from "@/services/projects-api";
import type { PageDto, RuntimePageDto } from "@/services/pages-api";
import { defaultTheme, themes } from "@/theme";

function runtimeThemeManifest(projectId: string) {
  return {
    schemaVersion: 1,
    projectId,
    version: 0,
    defaultThemeId: defaultTheme.id,
    publishedThemeRevisionId: null,
    publishedThemeId: null,
    resolvedThemeId: defaultTheme.id,
    resolvedThemeRevisionId: `preset:${defaultTheme.id}`,
    tokenHash: "a".repeat(64),
    tokens: defaultTheme.tokens,
    allowRuntimeThemeSelection: true,
    allowedThemeIds: themes.map(({ id }) => id),
    fallbackThemeId: defaultTheme.id,
    updatedAt: "2026-08-15T00:00:00Z",
  };
}

function registryPayload() {
  return {
    schemaVersion: 1,
    tabs: ELEMENT_PROPERTY_TABS,
    definitions: ELEMENT_DEFINITIONS,
    checksum: "runtime-test-registry",
  };
}

function publishedEntry(
  id: string,
  type: ElementEntryDto["element"]["type"],
  options: {
    props?: Readonly<Record<string, unknown>>;
    style?: Readonly<Record<string, unknown>>;
    hidden?: boolean;
  } = {},
): ElementEntryDto {
  const definition = ELEMENT_DEFINITIONS.find(
    (candidate) => candidate.type === type,
  )!;
  return {
    element: {
      id,
      projectId: "runtime-project",
      pageId: "page-0",
      type,
      typeVersion: 1,
      name: definition.defaultName,
      props: { ...definition.defaultProps, ...options.props },
      style: { ...definition.defaultStyle, ...options.style },
      events: [],
      locked: false,
      hidden: options.hidden ?? false,
      revision: 1,
    },
    layout: {
      elementId: id,
      breakpoint: "desktop",
      x: 0,
      y: id === "runtime-number" ? 6 : 0,
      w: definition.layout.defaultW,
      h: definition.layout.defaultH,
      minW: definition.layout.minW,
      minH: definition.layout.minH,
      maxW: definition.layout.maxW,
      maxH: definition.layout.maxH,
    },
  };
}

function runtimePagePayload({
  projectId,
  versionId,
  page,
  elements = [],
}: {
  projectId: string;
  versionId: string;
  page: RuntimePageDto;
  elements?: ElementEntryDto[];
}) {
  return {
    projectId,
    versionId,
    publishedAt: "2026-08-15T00:00:00Z",
    page,
    elements,
  };
}

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

function installRuntimeApi(elements: ElementEntryDto[] = []) {
  const calls: string[] = [];
  const pages = runtimePages();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input), "http://local").pathname;
      calls.push(path);
      if (path === "/api/v1/elements/registry") {
        return Response.json(registryPayload());
      }
      if (path === "/api/v1/runtime/runtime-project/theme-manifest") {
        return Response.json(runtimeThemeManifest("runtime-project"));
      }
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
      const runtimePageMatch = path.match(
        /^\/api\/v1\/runtime\/runtime-project\/pages\/(page-\d+)$/,
      );
      if (runtimePageMatch) {
        const page = pages.find(
          (candidate) => candidate.id === runtimePageMatch[1],
        );
        return page
          ? Response.json(
              runtimePagePayload({
                projectId: "runtime-project",
                versionId: "version-7",
                page,
                elements,
              }),
            )
          : Response.json(
              { error: { code: "PAGE_NOT_FOUND", message: "페이지 없음" } },
              { status: 404 },
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
      if (path === "/api/v1/elements/registry") {
        return Response.json(registryPayload());
      }
      if (path === "/api/v1/runtime/publish-project/theme-manifest") {
        return Response.json(runtimeThemeManifest("publish-project"));
      }
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
      if (path === "/api/v1/runtime/publish-project/pages/page-1") {
        const page: RuntimePageDto = {
          id: draftPage.id,
          name: publishedName,
          route: draftPage.route,
          sortOrder: 0,
          iconName: "File",
          iconCatalogVersion: "1.31.0",
          navigationVisible: true,
          navigationGroup: null,
        };
        return Response.json(
          runtimePagePayload({
            projectId: project.id,
            versionId: projectRevision === 1 ? "version-1" : "version-2",
            page,
          }),
        );
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
  it("renders only immutable published elements with runtime accessibility and visibility effects", async () => {
    installRuntimeApi([
      publishedEntry("runtime-text", "text", {
        props: { text: "게시 본문" },
      }),
      publishedEntry("runtime-number", "number-input", {
        props: {
          defaultValue: 0,
          disabled: true,
          required: true,
          minimum: 0,
          maximum: 10,
          step: 1,
          tooltip: "게시 범위",
          accessibilityLabel: "게시 수량",
        },
      }),
      publishedEntry("runtime-hidden", "button", {
        props: { label: "초안 누출" },
        hidden: true,
      }),
    ]);
    window.history.replaceState({}, "", "/runtime/runtime-project/hidden");
    render(<App />);

    expect(await screen.findByText("게시 본문")).toBeInTheDocument();
    const publishedRegion = screen.getByRole("region", {
      name: "게시 엘리먼트",
    });
    expect(within(publishedRegion).getAllByRole("region")).toHaveLength(2);
    const number = within(publishedRegion).getByRole("spinbutton", {
      name: "게시 수량",
    });
    expect(number).toHaveValue(0);
    expect(number).toBeDisabled();
    expect(number).toBeRequired();
    expect(number).toHaveAttribute("min", "0");
    expect(number).toHaveAttribute("max", "10");
    expect(number).toHaveAttribute("step", "1");
    expect(number).toHaveAttribute("title", "게시 범위");
    expect(screen.queryByText("초안 누출")).not.toBeInTheDocument();
  });

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
        within(navigation)
          .getByRole("button", { name: "페이지 2" })
          .querySelector("svg"),
      ).toBeInTheDocument(),
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

  it("renders Draft Preview from its immutable Test snapshot without calling Published routes", async () => {
    const calls: string[] = [];
    const page: RuntimePageDto = {
      id: "page-0",
      name: "초안 페이지",
      route: "/draft",
      sortOrder: 0,
      iconName: "File",
      iconCatalogVersion: "1.31.0",
      navigationVisible: true,
      navigationGroup: null,
    };
    const entry = publishedEntry("draft-table", "data-table", {
      props: { title: "초안 표" },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const path = new URL(String(input), "http://local").pathname;
        calls.push(path);
        if (path === "/api/v1/elements/registry") {
          return Response.json(registryPayload());
        }
        if (path === "/api/v1/runtime/runtime-project/theme-manifest") {
          return Response.json(runtimeThemeManifest("runtime-project"));
        }
        if (path === "/api/v1/draft-previews/preview-1/navigation") {
          return Response.json({
            projectId: "runtime-project",
            previewId: "preview-1",
            snapshotId: "preview-1",
            sourceProjectRevision: 8,
            themeId: "light-clean-paper",
            definitionChecksum: "a".repeat(64),
            registryChecksum: "b".repeat(64),
            createdAt: "2026-08-16T00:00:00Z",
            expiresAt: "2026-08-16T00:05:00Z",
            pages: [page],
          });
        }
        if (path === "/api/v1/draft-previews/preview-1/pages/page-0") {
          return Response.json({
            projectId: "runtime-project",
            previewId: "preview-1",
            snapshotId: "preview-1",
            sourceProjectRevision: 8,
            themeId: "light-clean-paper",
            definitionChecksum: "a".repeat(64),
            registryChecksum: "b".repeat(64),
            createdAt: "2026-08-16T00:00:00Z",
            expiresAt: "2026-08-16T00:05:00Z",
            page,
            elements: [entry],
            bindings: [
              {
                id: "binding-1",
                bindingType: "READ",
                status: "READY",
                target: { objectId: "draft-table" },
              },
            ],
          });
        }
        if (path === "/api/v1/draft-previews/preview-1/query/binding-1") {
          return Response.json({
            bindingId: "binding-1",
            projectId: "runtime-project",
            targetElementId: "draft-table",
            environment: "test",
            planChecksum: "c".repeat(64),
            snapshotId: "preview-1",
            definitionChecksum: "a".repeat(64),
            result: {
              columns: [],
              rows: [],
              rowCount: 2,
              truncated: false,
              renderState: "DATA",
              renderData: {
                columns: ["이름", "값"],
                rows: [
                  { 이름: "A", 값: 12 },
                  { 이름: "B", 값: 18 },
                ],
              },
            },
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
    window.history.replaceState(
      {},
      "",
      "/preview/runtime-project/preview-1/draft",
    );
    render(<App />);

    expect(await screen.findByText("미리보기")).toBeInTheDocument();
    const region = await screen.findByRole("region", {
      name: "초안 엘리먼트",
    });
    expect(await within(region).findByText("A")).toBeInTheDocument();
    expect(within(region).getByText("18")).toBeInTheDocument();
    expect(calls).toContain("/api/v1/draft-previews/preview-1/query/binding-1");
    expect(calls.some((path) => path.startsWith("/api/v1/runtime/"))).toBe(
      false,
    );
  });

  it("submits a Draft CREATE Binding, maps field errors, and refreshes the Data Table", async () => {
    const page: RuntimePageDto = {
      id: "page-0",
      name: "입력",
      route: "/form",
      sortOrder: 0,
      iconName: "File",
      iconCatalogVersion: "1.31.0",
      navigationVisible: true,
      navigationGroup: null,
    };
    const number = publishedEntry("number-1", "number-input", {
      props: { label: "값", accessibilityLabel: "값", defaultValue: null },
    });
    const button = publishedEntry("button-1", "button", {
      props: { label: "생성", accessibilityLabel: "생성" },
    });
    const table = publishedEntry("table-1", "data-table", {
      props: { title: "목록" },
    });
    let queryCount = 0;
    const mutationBodies: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input), "http://local").pathname;
        if (path === "/api/v1/elements/registry") {
          return Response.json(registryPayload());
        }
        if (path === "/api/v1/draft-previews/preview-1/navigation") {
          return Response.json({
            projectId: "runtime-project",
            previewId: "preview-1",
            snapshotId: "preview-1",
            sourceProjectRevision: 8,
            themeId: "light-clean-paper",
            definitionChecksum: "a".repeat(64),
            registryChecksum: "b".repeat(64),
            createdAt: "2026-08-16T00:00:00Z",
            expiresAt: "2026-08-16T00:05:00Z",
            pages: [page],
          });
        }
        if (path === "/api/v1/draft-previews/preview-1/pages/page-0") {
          return Response.json({
            projectId: "runtime-project",
            previewId: "preview-1",
            snapshotId: "preview-1",
            sourceProjectRevision: 8,
            themeId: "light-clean-paper",
            definitionChecksum: "a".repeat(64),
            registryChecksum: "b".repeat(64),
            createdAt: "2026-08-16T00:00:00Z",
            expiresAt: "2026-08-16T00:05:00Z",
            page,
            elements: [number, button, table],
            bindings: [
              {
                id: "create-binding",
                bindingType: "CREATE",
                status: "READY",
                source: { objectId: "button-1" },
                target: { objectId: "table-id" },
                mapping: {
                  fields: [
                    { fieldId: "value-field", inputElementId: "number-1" },
                  ],
                },
              },
              {
                id: "read-binding",
                bindingType: "READ",
                status: "READY",
                source: { objectId: "table-id" },
                target: { objectId: "table-1" },
              },
            ],
          });
        }
        if (path === "/api/v1/draft-previews/preview-1/query/read-binding") {
          queryCount += 1;
          return Response.json({
            bindingId: "read-binding",
            projectId: "runtime-project",
            targetElementId: "table-1",
            environment: "test",
            planChecksum: "c".repeat(64),
            snapshotId: "preview-1",
            definitionChecksum: "a".repeat(64),
            result: {
              columns: [],
              rows: [],
              rowCount: queryCount > 1 ? 1 : 0,
              truncated: false,
              renderState: queryCount > 1 ? "DATA" : "EMPTY",
              renderData:
                queryCount > 1
                  ? { columns: ["값"], rows: [{ 값: 12.5 }] }
                  : { columns: [], rows: [] },
            },
          });
        }
        if (path === "/api/v1/draft-previews/preview-1/create/create-binding") {
          const body = JSON.parse(String(init?.body)) as {
            values: Record<string, unknown>;
          };
          mutationBodies.push(body);
          if (body.values["number-1"] === null) {
            return Response.json(
              {
                error: {
                  code: "BINDING_MUTATION_VALIDATION_FAILED",
                  message: "입력 확인",
                  details: {
                    fieldErrors: [
                      {
                        inputElementId: "number-1",
                        message: "필수 값",
                      },
                    ],
                  },
                },
              },
              { status: 422 },
            );
          }
          return Response.json({
            bindingId: "create-binding",
            projectId: "runtime-project",
            operation: "CREATE",
            environment: "test",
            affectedRows: 1,
            insertedPrimaryKey: 1,
            refreshBindingIds: ["read-binding"],
            snapshotId: "preview-1",
            definitionChecksum: "a".repeat(64),
            commandId: "command-1",
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
    window.history.replaceState(
      {},
      "",
      "/preview/runtime-project/preview-1/form",
    );
    const user = userEvent.setup();
    render(<App />);

    const create = await screen.findByRole("button", { name: "생성" });
    await waitFor(() => expect(queryCount).toBe(1));
    await user.click(create);
    expect(await screen.findByRole("alert")).toHaveTextContent("필수 값");
    const input = screen.getByRole("spinbutton", { name: "값" });
    expect(input).toHaveAttribute("aria-invalid", "true");
    await user.type(input, "12.5");
    await user.click(create);
    expect(await screen.findByText("생성됨")).toBeInTheDocument();
    expect(await screen.findByText("12.5")).toBeInTheDocument();
    expect(queryCount).toBe(2);
    expect(mutationBodies).toHaveLength(2);
    expect(mutationBodies[1]).toMatchObject({
      values: { "number-1": 12.5 },
    });
    expect(screen.queryByText("필수 값")).not.toBeInTheDocument();
  });

  it("selects a Data Table row, navigates with a typed URL Variable, filters the target Chart, and restores browser history", async () => {
    const sourcePage: RuntimePageDto = {
      id: "page-source",
      name: "목록",
      route: "/lots",
      sortOrder: 0,
      iconName: "File",
      iconCatalogVersion: "1.31.0",
      navigationVisible: true,
      navigationGroup: null,
    };
    const targetPage: RuntimePageDto = {
      ...sourcePage,
      id: "page-target",
      name: "분석",
      route: "/analysis",
      sortOrder: 1,
    };
    const table = publishedEntry("table-element", "data-table", {
      props: { title: "Lot 목록" },
    });
    const chart = publishedEntry("chart-element", "histogram", {
      props: { title: "Lot 분포" },
    });
    const variable = {
      id: "00000000-0000-4000-8000-000000000014",
      projectId: "runtime-project",
      key: "selected_lot",
      name: "선택 Lot",
      valueType: "number",
      scope: "session",
      transport: "URL_QUERY",
      sensitive: false,
      defaultValue: null,
      revision: 1,
      createdAt: "2026-08-16T00:00:00Z",
      updatedAt: "2026-08-16T00:00:00Z",
    } as const;
    const actionChain = {
      sourceElementId: "table-element",
      variableId: variable.id,
      sourceFieldId: "field-lot",
      filter: {
        bindingId: "filter-binding",
        kind: "FILTER",
        variableId: variable.id,
        sourceElementId: "table-element",
        sourceFieldId: "field-lot",
        targetElementId: "chart-element",
        targetReadBindingId: "chart-read",
        targetFieldId: "field-lot",
        operator: "EQ",
      },
      navigation: {
        bindingId: "navigate-binding",
        kind: "NAVIGATE",
        variableId: variable.id,
        sourceElementId: "table-element",
        sourceFieldId: "field-lot",
        targetPageId: "page-target",
        transport: "URL_QUERY",
      },
    } as const;
    const queryBodies: Array<{
      path: string;
      parameters: Readonly<Record<string, unknown>>;
    }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input), "http://local").pathname;
        if (path === "/api/v1/elements/registry") {
          return Response.json(registryPayload());
        }
        if (path === "/api/v1/runtime/runtime-project/theme-manifest") {
          return Response.json(runtimeThemeManifest("runtime-project"));
        }
        if (path === "/api/v1/runtime/runtime-project/navigation") {
          return Response.json({
            projectId: "runtime-project",
            versionId: "version-14",
            snapshotId: "version-14",
            sourceProjectRevision: 14,
            themeId: "light-clean-paper",
            definitionChecksum: "a".repeat(64),
            registryChecksum: "b".repeat(64),
            createdAt: "2026-08-16T00:00:00Z",
            publishedAt: "2026-08-16T00:00:00Z",
            pages: [sourcePage, targetPage],
            variables: [variable],
          });
        }
        if (path === "/api/v1/runtime/runtime-project/pages/page-source") {
          return Response.json({
            projectId: "runtime-project",
            versionId: "version-14",
            snapshotId: "version-14",
            sourceProjectRevision: 14,
            themeId: "light-clean-paper",
            definitionChecksum: "a".repeat(64),
            registryChecksum: "b".repeat(64),
            createdAt: "2026-08-16T00:00:00Z",
            publishedAt: "2026-08-16T00:00:00Z",
            page: sourcePage,
            elements: [table],
            bindings: [
              {
                id: "table-read",
                bindingType: "READ",
                status: "READY",
                target: { objectId: "table-element" },
              },
            ],
            actionChains: [actionChain],
          });
        }
        if (path === "/api/v1/runtime/runtime-project/pages/page-target") {
          return Response.json({
            projectId: "runtime-project",
            versionId: "version-14",
            snapshotId: "version-14",
            sourceProjectRevision: 14,
            themeId: "light-clean-paper",
            definitionChecksum: "a".repeat(64),
            registryChecksum: "b".repeat(64),
            createdAt: "2026-08-16T00:00:00Z",
            publishedAt: "2026-08-16T00:00:00Z",
            page: targetPage,
            elements: [chart],
            bindings: [
              {
                id: "chart-read",
                bindingType: "READ",
                status: "READY",
                target: { objectId: "chart-element" },
              },
            ],
            actionChains: [actionChain],
          });
        }
        if (
          path === "/api/v1/runtime/runtime-project/query/table-read" ||
          path === "/api/v1/runtime/runtime-project/query/chart-read"
        ) {
          const body = JSON.parse(String(init?.body)) as {
            parameters: Readonly<Record<string, unknown>>;
          };
          queryBodies.push({ path, parameters: body.parameters });
          if (path.endsWith("table-read")) {
            return Response.json({
              bindingId: "table-read",
              projectId: "runtime-project",
              targetElementId: "table-element",
              environment: "production",
              planChecksum: "c".repeat(64),
              snapshotId: "version-14",
              definitionChecksum: "a".repeat(64),
              result: {
                columns: [],
                rows: [
                  { "field-lot": 1, "field-value": 10 },
                  { "field-lot": 2, "field-value": 20 },
                ],
                rowCount: 2,
                truncated: false,
                renderState: "DATA",
                renderData: {
                  columns: ["Lot", "값"],
                  rows: [
                    { Lot: 1, 값: 10 },
                    { Lot: 2, 값: 20 },
                  ],
                },
              },
            });
          }
          return Response.json({
            bindingId: "chart-read",
            projectId: "runtime-project",
            targetElementId: "chart-element",
            environment: "production",
            planChecksum: "d".repeat(64),
            snapshotId: "version-14",
            definitionChecksum: "a".repeat(64),
            result: {
              columns: [],
              rows: [{ "field-value": 20 }],
              rowCount: 1,
              truncated: false,
              renderState: "DATA",
              renderData: { values: [20] },
            },
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
    window.history.replaceState({}, "", "/runtime/runtime-project/lots");
    const user = userEvent.setup();
    const view = render(<App />);
    expect(
      await screen.findByRole("heading", { name: "목록" }),
    ).toBeInTheDocument();
    const rows = await screen.findAllByRole("row");
    await user.click(rows[2]!);
    await waitFor(() =>
      expect(window.location.pathname).toBe(
        "/runtime/runtime-project/analysis",
      ),
    );
    expect(window.location.search).toBe("?v.selected_lot=2");
    expect(
      await screen.findByRole("heading", { name: "분석" }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        queryBodies.find(({ path }) => path.endsWith("chart-read")),
      ).toEqual({
        path: "/api/v1/runtime/runtime-project/query/chart-read",
        parameters: { [variable.id]: 2 },
      }),
    );
    expect(
      queryBodies.find(({ path }) => path.endsWith("table-read"))?.parameters,
    ).toEqual({});

    window.history.back();
    await waitFor(() =>
      expect(window.location.pathname).toBe("/runtime/runtime-project/lots"),
    );
    expect(
      await screen.findByRole("heading", { name: "목록" }),
    ).toBeInTheDocument();
    expect(
      queryBodies
        .filter(({ path }) => path.endsWith("chart-read"))
        .every(({ parameters }) => parameters[variable.id] === 2),
    ).toBe(true);
    window.history.forward();
    await waitFor(() =>
      expect(window.location.pathname).toBe(
        "/runtime/runtime-project/analysis",
      ),
    );

    view.unmount();
    window.history.replaceState(
      {},
      "",
      "/runtime/runtime-project/analysis?v.selected_lot=2",
    );
    render(<App />);
    expect(
      await screen.findByRole("heading", { name: "분석" }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        queryBodies.filter(({ path }) => path.endsWith("chart-read")).at(-1),
      ).toEqual({
        path: "/api/v1/runtime/runtime-project/query/chart-read",
        parameters: { [variable.id]: 2 },
      }),
    );
  });
});
