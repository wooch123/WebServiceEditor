import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PAGE_TYPES, type PageType } from "@webeditor/domain";

import stylesCss from "@/styles.css?raw";
import type { ProjectDto } from "@/services/projects-api";
import type { PageDto } from "@/services/pages-api";
import { DynamicLucideIcon, iconNameToDynamicName } from "./DynamicLucideIcon";
import { PAGE_TYPE_LABELS, PageManager } from "./PageManager";

const project: ProjectDto = {
  id: "project-pages",
  name: "페이지 테스트",
  slug: "pages",
  description: null,
  lifecycleStatus: "ACTIVE",
  status: "DRAFT",
  schemaVersion: 1,
  revision: 5,
  lifecycleRevision: 1,
  favorite: false,
  themeId: "light-clean-paper",
  createdAt: "2026-08-15T00:00:00.000Z",
  updatedAt: "2026-08-15T00:00:00.000Z",
  pageCount: 2,
  elementCount: 7,
  bindingCount: 3,
  tableCount: 1,
  assetCount: 0,
};

function page(id: string, name: string, sortOrder: number): PageDto {
  return {
    id,
    projectId: project.id,
    schemaVersion: 1,
    revision: 1,
    name,
    route: `/${id}`,
    pageType: "blank",
    iconName: "File",
    iconCatalogVersion: "1.31.0",
    navigationVisible: true,
    navigationGroup: null,
    sortOrder,
    deletedAt: null,
  };
}

function response(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function installPageApi(
  options: { largeIconCatalog?: boolean; deletePlanDelayMs?: number } = {},
) {
  let pages = [page("first", "첫 페이지", 0), page("second", "둘째 페이지", 1)];
  let revision = project.revision;
  const iconItems = [
    {
      name: "File",
      dynamicName: "file",
      categories: ["files"],
      keywords: ["page"],
    },
    {
      name: "ChartBar",
      dynamicName: "chart-bar",
      categories: ["charts"],
      keywords: ["chart"],
    },
    ...(options.largeIconCatalog
      ? Array.from({ length: 198 }, (_, index) => ({
          name: `CatalogIcon${String(index + 2).padStart(3, "0")}`,
          dynamicName: "file",
          categories: ["files"],
          keywords: ["catalog"],
        }))
      : []),
  ];
  const deleted = new Map<string, PageDto>();
  let deletePlanFailures = 0;
  const calls: Array<{
    path: string;
    method: string;
    body: Record<string, unknown>;
  }> = [];
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const path = new URL(String(input), "http://local").pathname;
      const url = new URL(String(input), "http://local");
      const method = init.method ?? "GET";
      const body =
        typeof init.body === "string"
          ? (JSON.parse(init.body) as Record<string, unknown>)
          : {};
      calls.push({ path: `${path}${url.search}`, method, body });

      if (path.endsWith("/pages") && method === "GET")
        return response({
          pages,
          projectRevision: revision,
          publishedVersionId: "v1",
        });
      if (path.endsWith("/pages") && method === "POST") {
        revision += 1;
        const pageType = body.pageType as PageType;
        const created = {
          ...page(
            `created-${pages.length + 1}`,
            `Page ${pages.length + 1}`,
            pages.length,
          ),
          pageType,
        };
        pages = [...pages, created];
        return response({ page: created, projectRevision: revision }, 201);
      }
      if (/\/api\/v1\/pages\/[^/]+$/.test(path) && method === "PATCH") {
        const id = path.split("/").at(-1)!;
        revision += 1;
        pages = pages.map((item) =>
          item.id === id
            ? ({ ...item, ...body, revision: item.revision + 1 } as PageDto)
            : item,
        );
        return response({
          page: pages.find((item) => item.id === id),
          projectRevision: revision,
        });
      }
      if (path.endsWith("/reorder") && method === "POST") {
        revision += 1;
        const ids = body.pageIds as string[];
        pages = ids.map((id, index) => ({
          ...pages.find((item) => item.id === id)!,
          sortOrder: index,
          revision: pages.find((item) => item.id === id)!.revision + 1,
        }));
        return response({ pages, projectRevision: revision });
      }
      if (path.endsWith("/icon") && method === "PATCH") {
        const id = path.split("/").at(-2)!;
        revision += 1;
        pages = pages.map((item) =>
          item.id === id
            ? {
                ...item,
                iconName: String(body.iconName),
                revision: item.revision + 1,
              }
            : item,
        );
        return response({
          page: pages.find((item) => item.id === id),
          projectRevision: revision,
        });
      }
      if (path.endsWith("/delete-plan") && method === "POST") {
        await new Promise((resolve) =>
          window.setTimeout(resolve, options.deletePlanDelayMs ?? 30),
        );
        if (deletePlanFailures > 0) {
          deletePlanFailures -= 1;
          return response(
            {
              error: {
                code: "PROJECT_REVISION_CONFLICT",
                message: "영향 실패",
              },
            },
            409,
          );
        }
        return response({
          impact: {
            elementCount: 4,
            bindingCount: 2,
            navigationReferenceCount: 3,
            validationScenarioCount: 1,
            reassignNavigationToPageId: null,
          },
          allowedResolutions: ["DELETE_DEPENDENCIES"],
        });
      }
      if (/\/api\/v1\/pages\/[^/]+$/.test(path) && method === "DELETE") {
        const id = path.split("/").at(-1)!;
        const target = pages.find((item) => item.id === id)!;
        deleted.set("delete-command", target);
        pages = pages.filter((item) => item.id !== id);
        revision += 1;
        return response({
          commandId: "delete-command",
          impact: {
            elementCount: 4,
            bindingCount: 2,
            navigationReferenceCount: 3,
            validationScenarioCount: 1,
            reassignNavigationToPageId: null,
          },
          projectRevision: revision,
        });
      }
      if (path.endsWith("/undo") && method === "POST") {
        const restored = deleted.get("delete-command")!;
        pages = [...pages, restored].sort((a, b) => a.sortOrder - b.sortOrder);
        revision += 1;
        return response({ page: restored, projectRevision: revision });
      }
      if (path === "/api/v1/ui/icons" && url.searchParams.get("cursor"))
        return response({
          items: [
            {
              name: "Circle",
              dynamicName: "circle",
              categories: ["shapes"],
              keywords: ["round"],
            },
          ],
          nextCursor: null,
          categories: ["charts", "files", "medical"],
        });
      if (path === "/api/v1/ui/icons")
        return response({
          items: iconItems,
          nextCursor: "cursor-2",
          categories: ["charts", "files", "medical"],
        });
      if (path === "/api/v1/ui/icons/File")
        return response({
          item: {
            name: "File",
            dynamicName: "file",
            categories: ["files"],
            keywords: ["page"],
          },
        });
      if (path === "/api/v1/ui/icons/ArrowDown01")
        return response({
          item: {
            name: "ArrowDown01",
            dynamicName: "arrow-down-0-1",
            categories: ["arrows"],
            keywords: ["down", "zero", "one"],
          },
        });
      if (path.includes("/publish/plan"))
        return response({
          plan: {
            projectId: project.id,
            projectRevision: revision,
            pages,
            errors: [],
            warnings: [],
          },
        });
      if (path.endsWith("/draft-previews") && method === "POST")
        return response({
          projectId: project.id,
          previewId: "preview-1",
          snapshotId: "preview-1",
          sourceProjectRevision: revision,
          themeId: "light-clean-paper",
          definitionChecksum: "a".repeat(64),
          registryChecksum: "b".repeat(64),
          createdAt: "2026-08-16T00:00:00Z",
          expiresAt: "2026-08-16T00:05:00Z",
          defaultRoute: "/first",
        });
      if (path.endsWith("/publish"))
        return response({
          versionId: "v2",
          publishedAt: "2026-08-15T00:00:00Z",
          projectRevision: ++revision,
        });
      return response(
        { error: { code: "UNHANDLED", message: `${method} ${path}` } },
        500,
      );
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return {
    calls,
    failNextDeletePlan() {
      deletePlanFailures += 1;
    },
  };
}

function Harness({
  onOpenDraftPreview,
}: {
  onOpenDraftPreview?: (url: string) => void;
} = {}) {
  const [selected, setSelected] = useState<PageDto | null>(null);
  const [currentProject, setCurrentProject] = useState(project);
  return (
    <>
      <output aria-label="프로젝트 리비전">{currentProject.revision}</output>
      <PageManager
        project={currentProject}
        selectedPageId={selected?.id ?? null}
        onSelectPage={setSelected}
        {...(onOpenDraftPreview ? { onOpenDraftPreview } : {})}
        onProjectRevisionChange={(revision) =>
          setCurrentProject((value) => ({ ...value, revision }))
        }
      />
    </>
  );
}

function pageNameButton(name: string): HTMLButtonElement {
  return screen.getByText(name, { selector: "strong" }).closest("button")!;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("PageManager behavior", () => {
  it("shows all twelve Page Types and creates the selected server-owned type", async () => {
    const { calls } = installPageApi();
    const user = userEvent.setup();
    render(<Harness />);
    await screen.findByText("첫 페이지", { selector: "strong" });

    await user.click(screen.getByRole("button", { name: "페이지 추가" }));
    const items = await screen.findAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual(
      PAGE_TYPES.map((pageType) => PAGE_TYPE_LABELS[pageType]),
    );
    await user.click(
      screen.getByRole("menuitem", {
        name: PAGE_TYPE_LABELS.dashboard,
      }),
    );

    await screen.findByText(PAGE_TYPE_LABELS.dashboard, {
      selector: '[data-slot="badge"]',
    });
    expect(
      calls.find(
        ({ path, method }) => path.endsWith("/pages") && method === "POST",
      )?.body,
    ).toMatchObject({ pageType: "dashboard", expectedProjectRevision: 5 });
  });

  it("creates a server-owned Draft Preview and opens its isolated route", async () => {
    const { calls } = installPageApi();
    const onOpenDraftPreview = vi.fn();
    const user = userEvent.setup();
    render(<Harness onOpenDraftPreview={onOpenDraftPreview} />);

    await user.click(await screen.findByRole("button", { name: "미리보기" }));
    await waitFor(() => expect(onOpenDraftPreview).toHaveBeenCalledTimes(1));
    expect(onOpenDraftPreview).toHaveBeenCalledWith(
      "/preview/project-pages/preview-1/",
    );
    expect(
      calls.find((call) => call.path.endsWith("/draft-previews")),
    ).toMatchObject({
      method: "POST",
      body: { expectedProjectRevision: 5 },
    });
  });
  it("renames on Enter and blur, cancels on Escape, and keeps the route", async () => {
    const { calls } = installPageApi();
    const user = userEvent.setup();
    render(<Harness />);
    await screen.findByText("첫 페이지", { selector: "strong" });
    const first = pageNameButton("첫 페이지");
    await user.dblClick(first);
    let input = screen.getByRole("textbox", { name: "페이지 이름" });
    await user.clear(input);
    await user.type(input, "Enter 이름{Enter}");
    await screen.findByText("Enter 이름", { selector: "strong" });
    expect(pageNameButton("Enter 이름")).toHaveTextContent("/first");

    await user.dblClick(pageNameButton("Enter 이름"));
    input = screen.getByRole("textbox", { name: "페이지 이름" });
    await user.clear(input);
    await user.type(input, "Blur 이름");
    await user.tab();
    await screen.findByText("Blur 이름", { selector: "strong" });

    await user.dblClick(pageNameButton("Blur 이름"));
    input = screen.getByRole("textbox", { name: "페이지 이름" });
    await user.clear(input);
    await user.type(input, "취소 이름{Escape}");
    expect(pageNameButton("Blur 이름")).toBeInTheDocument();
    expect(
      calls.filter(
        (call) => call.method === "PATCH" && !call.path.endsWith("/icon"),
      ),
    ).toHaveLength(2);
    expect(screen.getByLabelText("프로젝트 리비전")).toHaveTextContent("7");

    await user.click(screen.getByRole("button", { name: "게시" }));
    await waitFor(() =>
      expect(
        calls.find((call) => call.path.endsWith("/publish/plan"))?.body
          .expectedProjectRevision,
      ).toBe(7),
    );
  });

  it("keyboard reorders with one overlay and one complete permutation request", async () => {
    const { calls } = installPageApi();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        const id =
          this.closest?.("[data-page-id]")?.getAttribute("data-page-id");
        const top = id === "second" ? 60 : 0;
        return {
          x: 0,
          y: top,
          top,
          left: 0,
          right: 240,
          bottom: top + 48,
          width: 240,
          height: 48,
          toJSON: () => ({}),
        } as DOMRect;
      },
    );
    render(<Harness />);
    const handle = await screen.findByRole("button", {
      name: "첫 페이지 순서 이동",
    });
    handle.focus();
    fireEvent.keyDown(handle, { key: " ", code: "Space" });
    expect(screen.getAllByLabelText("첫 페이지 이동 중")).toHaveLength(1);
    await new Promise((resolve) => window.setTimeout(resolve, 40));
    fireEvent.keyDown(handle, { key: "ArrowDown", code: "ArrowDown" });
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    fireEvent.keyDown(handle, { key: " ", code: "Space" });
    await waitFor(() =>
      expect(
        calls.filter((call) => call.path.endsWith("/reorder")),
      ).toHaveLength(1),
    );
    expect(
      calls.find((call) => call.path.endsWith("/reorder"))?.body.pageIds,
    ).toEqual(["second", "first"]);
    await new Promise((resolve) => window.setTimeout(resolve, 60));
  });

  it("pointer reorder sends one permutation request per drop", async () => {
    const { calls } = installPageApi();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        const id =
          this.closest?.("[data-page-id]")?.getAttribute("data-page-id");
        const top = id === "second" ? 60 : 0;
        return {
          x: 0,
          y: top,
          top,
          left: 0,
          right: 240,
          bottom: top + 48,
          width: 240,
          height: 48,
          toJSON: () => ({}),
        } as DOMRect;
      },
    );
    render(<Harness />);
    const handle = await screen.findByRole("button", {
      name: "첫 페이지 순서 이동",
    });
    fireEvent.pointerDown(handle, {
      button: 0,
      clientX: 10,
      clientY: 10,
      pointerId: 1,
      isPrimary: true,
    });
    fireEvent.pointerMove(document, {
      clientX: 10,
      clientY: 30,
      pointerId: 1,
      isPrimary: true,
    });
    await screen.findByLabelText("첫 페이지 이동 중");
    await new Promise((resolve) => window.setTimeout(resolve, 40));
    fireEvent.pointerMove(document, {
      clientX: 10,
      clientY: 110,
      pointerId: 1,
      isPrimary: true,
    });
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    fireEvent.pointerUp(document, {
      clientX: 10,
      clientY: 110,
      pointerId: 1,
      isPrimary: true,
    });
    await waitFor(() =>
      expect(
        calls.filter((call) => call.path.endsWith("/reorder")),
      ).toHaveLength(1),
    );
    expect(
      calls.find((call) => call.path.endsWith("/reorder"))?.body.pageIds,
    ).toEqual(["second", "first"]);
    await new Promise((resolve) => window.setTimeout(resolve, 60));
  });

  it("loads page-specific delete impact, cancels safely, then undo restores the same ID", async () => {
    const { calls } = installPageApi({ deletePlanDelayMs: 200 });
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(
      await screen.findByRole("button", { name: "첫 페이지 삭제" }),
    );
    let dialog = await screen.findByRole("alertdialog", {
      name: "페이지 삭제",
    });
    expect(within(dialog).getByRole("button", { name: "삭제" })).toBeDisabled();
    await within(dialog).findByText("4");
    expect(within(dialog).getByText("3")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "취소" }));
    expect(calls.filter((call) => call.method === "DELETE")).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "첫 페이지 삭제" }));
    dialog = screen.getByRole("alertdialog", { name: "페이지 삭제" });
    await waitFor(() =>
      expect(
        within(dialog).getByRole("button", { name: "삭제" }),
      ).toBeEnabled(),
    );
    await user.click(within(dialog).getByRole("button", { name: "삭제" }));
    expect(
      await screen.findByRole("button", { name: "삭제 취소" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("첫 페이지")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "삭제 취소" }));
    await screen.findByText("첫 페이지", { selector: "strong" });
    expect(pageNameButton("첫 페이지")).toHaveTextContent("/first");
    expect(
      calls.some((call) => call.path.includes("delete-command/undo")),
    ).toBe(true);
  });

  it("blocks delete while impact fails or the loaded plan becomes stale", async () => {
    const api = installPageApi();
    api.failNextDeletePlan();
    const user = userEvent.setup();
    const selectPage = vi.fn();
    const view = render(
      <PageManager
        project={project}
        selectedPageId={null}
        onSelectPage={selectPage}
      />,
    );
    await user.click(
      await screen.findByRole("button", { name: "첫 페이지 삭제" }),
    );
    let dialog = await screen.findByRole("alertdialog", {
      name: "페이지 삭제",
    });
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "영향 실패",
    );
    expect(within(dialog).getByRole("button", { name: "삭제" })).toBeDisabled();
    await user.click(within(dialog).getByRole("button", { name: "재시도" }));
    await waitFor(() =>
      expect(
        within(dialog).getByRole("button", { name: "삭제" }),
      ).toBeEnabled(),
    );

    view.rerender(
      <PageManager
        project={{ ...project, revision: project.revision + 1 }}
        selectedPageId={null}
        onSelectPage={selectPage}
      />,
    );
    dialog = screen.getByRole("alertdialog", { name: "페이지 삭제" });
    await waitFor(() =>
      expect(
        within(dialog).getByRole("button", { name: "삭제" }),
      ).toBeDisabled(),
    );
  });

  it("searches/categories/cursors/selects icons by keyboard, persists recent, cancels with focus return, and falls back", async () => {
    const { calls } = installPageApi({ largeIconCatalog: true });
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(
      function (this: HTMLElement) {
        return this.classList.contains("icon-virtual-grid") ? 420 : 0;
      },
    );
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(
      function (this: HTMLElement) {
        return this.classList.contains("icon-virtual-grid") ? 264 : 0;
      },
    );
    const user = userEvent.setup();
    const pageView = render(<Harness />);
    const trigger = (
      await screen.findAllByRole("button", {
        name: "File 아이콘 변경",
      })
    )[0]!;
    await user.click(trigger);
    const search = screen.getByRole("textbox", { name: "아이콘 검색" });
    expect(
      await screen.findByRole("option", { name: "medical" }),
    ).toBeInTheDocument();
    const grid = screen.getByRole("grid", { name: "Lucide 아이콘" });
    const initialCells = within(grid).getAllByRole("gridcell");
    expect(initialCells.length).toBeGreaterThan(0);
    expect(initialCells.length).toBeLessThan(200);
    expect(
      within(grid).getByRole("gridcell", { name: "File" }),
    ).toHaveAttribute("aria-pressed", "true");
    const previewSize = screen.getByRole("slider");
    fireEvent.change(previewSize, { target: { value: "32" } });
    expect(
      screen.getByText("32px", { selector: "output" }),
    ).toBeInTheDocument();
    grid.scrollTop = 1_320;
    fireEvent.scroll(grid);
    expect(
      await within(grid).findByRole("gridcell", { name: "CatalogIcon120" }),
    ).toBeInTheDocument();
    expect(
      within(grid).queryByRole("gridcell", { name: "File" }),
    ).not.toBeInTheDocument();
    grid.scrollTop = 0;
    fireEvent.scroll(grid);
    await within(grid).findByRole("gridcell", { name: "File" });
    await user.type(search, "chart");
    await waitFor(() =>
      expect(calls.some((call) => call.path.includes("query=chart"))).toBe(
        true,
      ),
    );
    await user.selectOptions(
      screen.getByRole("combobox", { name: "아이콘 카테고리" }),
      "charts",
    );
    await waitFor(() =>
      expect(calls.some((call) => call.path.includes("category=charts"))).toBe(
        true,
      ),
    );
    await user.click(screen.getByRole("button", { name: "더 보기" }));
    expect(calls.some((call) => call.path.includes("cursor=cursor-2"))).toBe(
      true,
    );
    search.focus();
    const firstActiveDescendant = search.getAttribute("aria-activedescendant");
    await user.keyboard("{ArrowRight}");
    expect(search).toHaveFocus();
    expect(search).not.toHaveAttribute(
      "aria-activedescendant",
      firstActiveDescendant,
    );
    const activeCell = within(grid).getByRole("gridcell", {
      name: "ChartBar",
    });
    expect(search).toHaveAttribute("aria-activedescendant", activeCell.id);
    await user.keyboard("{Enter}");
    const changedTriggers = await screen.findAllByRole("button", {
      name: "ChartBar 아이콘 변경",
    });
    expect(changedTriggers[0]).toHaveFocus();
    expect(localStorage.getItem("webeditor:recent-page-icons")).toContain(
      "ChartBar",
    );

    pageView.unmount();
    const reloadedView = render(<Harness />);
    const reloadedTrigger = (
      await screen.findAllByRole("button", {
        name: "ChartBar 아이콘 변경",
      })
    )[0]!;
    await user.click(reloadedTrigger);
    await user.click(screen.getByRole("button", { name: "최근" }));
    expect(
      await screen.findByRole("gridcell", { name: "ChartBar" }),
    ).toHaveAttribute("aria-pressed", "true");
    await user.keyboard("{Escape}");
    expect(reloadedTrigger).toHaveFocus();

    reloadedView.rerender(
      <>
        <DynamicLucideIcon iconName="ArrowDown01" />
        <DynamicLucideIcon iconName="ArrowDown01" />
      </>,
    );
    await waitFor(() =>
      expect(document.querySelectorAll(".lucide-arrow-down-0-1")).toHaveLength(
        2,
      ),
    );
    expect(
      calls.filter((call) => call.path === "/api/v1/ui/icons/ArrowDown01"),
    ).toHaveLength(1);

    reloadedView.rerender(
      <DynamicLucideIcon iconName="DefinitelyMissingIcon" />,
    );
    expect(
      await screen.findByTitle("아이콘 오류: DefinitelyMissingIcon"),
    ).toBeInTheDocument();
    expect(iconNameToDynamicName("Building2")).toBe("building-2");
    expect(iconNameToDynamicName("ArrowDown01")).toBe("arrow-down-01");
    expect(iconNameToDynamicName("Axis3d")).toBe("axis-3d");
  });

  it("keeps every sibling control group on shared geometry tokens", async () => {
    installPageApi();
    const user = userEvent.setup();
    render(<Harness />);

    const publish = await screen.findByRole("button", { name: "게시" });
    const add = screen.getByRole("button", { name: "페이지 추가" });
    const preview = screen.getByRole("button", { name: "미리보기" });
    expect(publish).toHaveAttribute("data-size", add.dataset.size);
    expect(preview).toHaveAttribute("data-size", add.dataset.size);
    const actionGroup = publish.closest<HTMLElement>(".page-manager-actions")!;
    expect(actionGroup).toContainElement(add);
    expect(actionGroup).toContainElement(preview);
    expect(stylesCss).toMatch(
      /\.page-manager-actions\s*\{[^}]*display:\s*flex;[^}]*width:\s*100%;[^}]*align-items:\s*center;/s,
    );
    expect(stylesCss).toMatch(
      /\.page-manager-heading\s+\.page-manager-actions\s*\{[^}]*flex-direction:\s*row;/s,
    );
    expect(stylesCss).toMatch(
      /\.page-manager-actions\s*>\s*\*\s*\{[^}]*min-width:\s*0;[^}]*flex:\s*1\s+1\s+0;/s,
    );
    expect(stylesCss).toMatch(
      /\.page-manager-actions\s*>\s*\[data-slot="button"\],[\s\S]*\.page-manager-actions\s*>\s*\[data-slot="dropdown-menu-trigger"\]\s*\{[^}]*width:\s*auto;[^}]*min-width:\s*0;/s,
    );
    const actionWidth = 4.5 * 16;
    const actionHeight = 2.5 * 16;
    const actionRect = (top: number) =>
      ({
        x: 0,
        y: top,
        top,
        left: 0,
        right: actionWidth,
        bottom: top + actionHeight,
        width: actionWidth,
        height: actionHeight,
        toJSON: () => ({}),
      }) as DOMRect;
    vi.spyOn(preview, "getBoundingClientRect").mockReturnValue(actionRect(0));
    vi.spyOn(publish, "getBoundingClientRect").mockReturnValue(actionRect(0));
    vi.spyOn(add, "getBoundingClientRect").mockReturnValue(actionRect(0));
    const previewRect = preview.getBoundingClientRect();
    const publishRect = publish.getBoundingClientRect();
    const addRect = add.getBoundingClientRect();
    expect({ width: previewRect.width, height: previewRect.height }).toEqual({
      width: addRect.width,
      height: addRect.height,
    });
    expect({ width: publishRect.width, height: publishRect.height }).toEqual({
      width: addRect.width,
      height: addRect.height,
    });
    expect(publishRect.width).toBeGreaterThan(0);

    const drag = screen.getByRole("button", {
      name: "첫 페이지 순서 이동",
    });
    const icon = screen.getAllByRole("button", {
      name: "File 아이콘 변경",
    })[0]!;
    const trash = screen.getByRole("button", { name: "첫 페이지 삭제" });
    expect([drag.dataset.size, icon.dataset.size, trash.dataset.size]).toEqual([
      "icon-sm",
      "icon-sm",
      "icon-sm",
    ]);

    await user.click(icon);
    const recent = screen.getByRole("button", { name: "최근" });
    const defaultIcon = screen.getByRole("button", { name: "기본" });
    expect(recent).toHaveAttribute("data-size", defaultIcon.dataset.size);
    await user.keyboard("{Escape}");

    await user.click(trash);
    const dialog = await screen.findByRole("alertdialog", {
      name: "페이지 삭제",
    });
    const cancel = within(dialog).getByRole("button", { name: "취소" });
    const confirm = within(dialog).getByRole("button", { name: "삭제" });
    expect(cancel).toHaveAttribute("data-size", confirm.dataset.size);

    expect(stylesCss).toMatch(
      /\.page-manager-actions > \[data-slot="dropdown-menu-trigger"\][\s\S]*height:\s*var\(--control-height\)[\s\S]*padding-inline:\s*var\(--control-padding-inline\)[\s\S]*border-radius:\s*var\(--control-radius\)/,
    );
    expect(stylesCss).toMatch(
      /\.page-drag-handle,\s*\.page-icon-trigger,\s*\.page-trash-button[\s\S]*width:\s*var\(--control-height\)[\s\S]*height:\s*var\(--control-height\)/,
    );
    expect(stylesCss).toMatch(
      /\.icon-picker-tools > \[data-slot="button"\][\s\S]*height:\s*var\(--control-height\)[\s\S]*border-radius:\s*var\(--control-radius\)/,
    );
    expect(stylesCss).toMatch(
      /\[data-slot="alert-dialog-footer"\] > button[\s\S]*height:\s*var\(--control-height\)[\s\S]*padding-inline:\s*var\(--control-padding-inline\)[\s\S]*border-radius:\s*var\(--control-radius\)/,
    );
    expect(stylesCss).toMatch(
      /\.page-drag-overlay[\s\S]*transform:\s*rotate\(2deg\) scale\(1\.02\)[\s\S]*@media \(prefers-reduced-motion: reduce\)[\s\S]*\.page-drag-overlay[\s\S]*transform:\s*scale\(1\.02\)/,
    );
  });
});
