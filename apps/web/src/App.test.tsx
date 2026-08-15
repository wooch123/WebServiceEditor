import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ProjectDto } from "./services/projects-api";
import { App } from "./App";
import stylesCss from "./styles.css?raw";

const originalFetch = globalThis.fetch;
const originalCreateObjectUrl = Object.getOwnPropertyDescriptor(
  URL,
  "createObjectURL",
);
const originalRevokeObjectUrl = Object.getOwnPropertyDescriptor(
  URL,
  "revokeObjectURL",
);

function project(id: string, overrides: Partial<ProjectDto> = {}): ProjectDto {
  return {
    id,
    name: "지역 건강지표 모니터",
    slug: "regional-health",
    description: "시군구별 만성질환과 의료 이용 변화를 추적합니다.",
    lifecycleStatus: "ACTIVE",
    status: "DRAFT",
    schemaVersion: 1,
    revision: 18,
    lifecycleRevision: 1,
    favorite: true,
    themeId: "light-clean-paper",
    createdAt: "2026-08-01T03:00:00.000Z",
    updatedAt: "2026-08-15T05:32:00.000Z",
    pageCount: 6,
    elementCount: 24,
    bindingCount: 8,
    tableCount: 4,
    assetCount: 2,
    counts: {
      pages: 6,
      elements: 24,
      bindings: 8,
      tables: 4,
      assets: 2,
    },
    ...overrides,
  };
}

const healthProject = project("project-health");
const spcProject = project("project-spc", {
  name: "품질 관리 SPC 센터",
  slug: "spc-center",
  description: "공정 능력과 이상 신호를 확인하는 운영 대시보드입니다.",
  favorite: false,
  themeId: "dark-polar-night",
  revision: 9,
  pageCount: 4,
  elementCount: 19,
  bindingCount: 7,
  tableCount: 3,
  assetCount: 1,
  updatedAt: "2026-08-14T09:05:00.000Z",
});
const recycledProject = project("project-survey", {
  name: "설문 분석 워크벤치",
  slug: "survey-workbench",
  description: "응답 데이터 정제와 교차 분석 작업 공간입니다.",
  lifecycleStatus: "TRASHED",
  favorite: false,
  revision: 4,
  lifecycleRevision: 2,
  themeId: "gray-cool-steel",
  deletedAt: "2026-08-13T04:00:00.000Z",
  deletedReason: "user-request",
  pageCount: 3,
  elementCount: 11,
  bindingCount: 5,
  tableCount: 2,
  assetCount: 3,
});
const secondRecycledProject = project("project-legacy", {
  name: "구형 통계 포털",
  slug: "legacy-statistics",
  description: "이관 전 통계 포털입니다.",
  lifecycleStatus: "TRASHED",
  favorite: false,
  revision: 7,
  lifecycleRevision: 3,
  deletedAt: "2026-08-12T03:00:00.000Z",
  deletedReason: "completed",
  pageCount: 2,
  elementCount: 7,
  bindingCount: 3,
  tableCount: 1,
  assetCount: 4,
});
const purgeFailedProject = project("project-purge-failed", {
  name: "삭제 재시도 프로젝트",
  slug: "purge-retry",
  description: "영구 삭제 재시도 대상",
  lifecycleStatus: "PURGE_FAILED",
  favorite: false,
  revision: 3,
  lifecycleRevision: 4,
  deletedAt: "2026-08-11T02:00:00.000Z",
  deletedReason: "completed",
});

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    statusText:
      status === 409 ? "Conflict" : status >= 500 ? "Server Error" : "OK",
    headers: { "content-type": "application/json" },
  });
}

interface MockApiOptions {
  active?: ProjectDto[];
  recycle?: ProjectDto[];
  failFirstProjectLoad?: boolean;
  conflictFirstTrash?: boolean;
  conflictFirstRestore?: boolean;
  requireCombinedRestoreIdentity?: boolean;
  failAfterCommittedTrash?: boolean;
}

function installMockApi(options: MockApiOptions = {}) {
  let active = [...(options.active ?? [healthProject, spcProject])];
  let recycle = [...(options.recycle ?? [])];
  let projectLoadAttempts = 0;
  let trashAttempts = 0;
  let restoreAttempts = 0;

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
      const body =
        typeof init.body === "string"
          ? (JSON.parse(init.body) as Record<string, unknown>)
          : {};

      if (pathname === "/api/v1/projects" && method === "GET") {
        projectLoadAttempts += 1;
        if (options.failFirstProjectLoad && projectLoadAttempts === 1) {
          return jsonResponse(
            { error: { code: "LOAD_FAILED", message: "metadata unavailable" } },
            500,
          );
        }
        return jsonResponse({ projects: active });
      }

      if (pathname === "/api/v1/recycle-bin/projects" && method === "GET") {
        return jsonResponse({ projects: recycle });
      }

      if (pathname === "/api/v1/projects" && method === "POST") {
        const created = project("project-created", {
          name: String(body.name),
          slug: "new-statistics-service",
          description: String(body.description),
          favorite: false,
          themeId: String(body.themeId),
          revision: 1,
          pageCount: 0,
          elementCount: 0,
          tableCount: 0,
          updatedAt: "2026-08-15T06:00:00.000Z",
        });
        active = [created, ...active];
        return jsonResponse({ project: created }, 201);
      }

      if (pathname === "/api/v1/projects/import" && method === "POST") {
        const exportPayload = body.export as
          { project?: ProjectDto } | undefined;
        const source = exportPayload?.project ?? healthProject;
        const imported = project("project-imported", {
          ...source,
          id: "project-imported",
          name: String(body.name),
          slug: String(body.slug),
          lifecycleStatus: "ACTIVE",
          revision: 1,
          lifecycleRevision: 1,
          favorite: false,
          updatedAt: "2026-08-15T06:05:00.000Z",
        });
        active = [imported, ...active];
        return jsonResponse({ project: imported }, 201);
      }

      const projectId = pathname.startsWith("/api/v1/recycle-bin/projects/")
        ? (pathname.split("/")[5] ?? "")
        : (pathname.split("/")[4] ?? "");

      if (/^\/api\/v1\/projects\/[^/]+$/.test(pathname) && method === "PATCH") {
        const current = active.find((candidate) => candidate.id === projectId);
        if (!current) {
          return jsonResponse(
            { error: { code: "NOT_FOUND", message: "project not found" } },
            404,
          );
        }
        const updated = {
          ...current,
          ...(typeof body.favorite === "boolean"
            ? { favorite: body.favorite }
            : {}),
          ...(typeof body.themeId === "string"
            ? { themeId: body.themeId }
            : {}),
          revision: current.revision + 1,
        };
        active = active.map((candidate) =>
          candidate.id === projectId ? updated : candidate,
        );
        return jsonResponse({ project: updated });
      }

      if (pathname.endsWith("/clone") && method === "POST") {
        const current = active.find((candidate) => candidate.id === projectId);
        if (!current) return jsonResponse({}, 404);
        const clone = project(`${current.id}-copy`, {
          ...current,
          id: `${current.id}-copy`,
          name: `${current.name} 복사본`,
          slug: `${current.slug}-copy`,
          revision: 1,
          favorite: false,
        });
        active = [clone, ...active];
        return jsonResponse({ project: clone }, 201);
      }

      if (pathname.endsWith("/export") && method === "POST") {
        const current = active.find((candidate) => candidate.id === projectId);
        return new Response(
          JSON.stringify({
            export: {
              format: "webeditor-project-v1",
              project: current,
              manifest: {},
              files: [],
            },
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
              "content-disposition": `attachment; filename="${projectId}.json"`,
            },
          },
        );
      }

      if (pathname.endsWith("/trash") && method === "POST") {
        trashAttempts += 1;
        const current = active.find((candidate) => candidate.id === projectId);
        if (!current) return jsonResponse({}, 404);
        if (options.conflictFirstTrash && trashAttempts === 1) {
          return jsonResponse(
            {
              error: {
                code: "STALE_REVISION",
                message: "프로젝트가 다른 요청에서 변경되었습니다.",
              },
            },
            409,
          );
        }
        const trashed: ProjectDto = {
          ...current,
          lifecycleStatus: "TRASHED",
          lifecycleRevision: current.lifecycleRevision + 1,
          deletedAt: "2026-08-15T06:10:00.000Z",
          deletedReason: String(body.reason),
        };
        active = active.filter((candidate) => candidate.id !== projectId);
        recycle = [trashed, ...recycle];
        if (options.failAfterCommittedTrash && trashAttempts === 1) {
          return jsonResponse(
            {
              error: {
                code: "TRASH_RECOVERED_AFTER_FAILURE",
                message: "이동은 완료됐지만 응답에 실패했습니다.",
              },
            },
            500,
          );
        }
        return jsonResponse({ project: trashed });
      }

      if (pathname.endsWith("/restore") && method === "POST") {
        restoreAttempts += 1;
        const current = recycle.find((candidate) => candidate.id === projectId);
        if (!current) return jsonResponse({}, 404);
        if (options.conflictFirstRestore && restoreAttempts === 1) {
          return jsonResponse(
            {
              error: {
                code: "SLUG_CONFLICT",
                message: "Slug가 활성 프로젝트와 충돌합니다.",
                details: { slug: current.slug },
              },
            },
            409,
          );
        }
        if (
          options.requireCombinedRestoreIdentity &&
          (typeof body.name !== "string" ||
            body.name.trim() === "" ||
            body.name === current.name ||
            typeof body.slug !== "string" ||
            body.slug.trim() === "" ||
            body.slug === current.slug)
        ) {
          return jsonResponse(
            {
              error: {
                code: "NAME_AND_SLUG_CONFLICT",
                message: "이름과 Slug가 모두 충돌합니다.",
              },
            },
            409,
          );
        }
        const restored: ProjectDto = {
          ...current,
          lifecycleStatus: "ACTIVE",
          lifecycleRevision: current.lifecycleRevision + 1,
          ...(typeof body.name === "string" ? { name: body.name } : {}),
          ...(typeof body.slug === "string" ? { slug: body.slug } : {}),
        };
        delete restored.deletedAt;
        delete restored.deletedReason;
        recycle = recycle.filter((candidate) => candidate.id !== projectId);
        active = [restored, ...active];
        return jsonResponse({ project: restored });
      }

      if (
        pathname === "/api/v1/recycle-bin/projects/batch-restore" &&
        method === "POST"
      ) {
        const items = Array.isArray(body.items)
          ? (body.items as Record<string, unknown>[])
          : [];
        const results = items.map((item) => {
          const itemProjectId = String(item.projectId);
          const current = recycle.find(
            (candidate) => candidate.id === itemProjectId,
          );
          if (!current) {
            return {
              projectId: itemProjectId,
              ok: false,
              error: {
                code: "NOT_FOUND",
                message: "project not found",
                statusCode: 404,
              },
            };
          }
          const restored: ProjectDto = {
            ...current,
            lifecycleStatus: "ACTIVE",
            lifecycleRevision: current.lifecycleRevision + 1,
            deletedAt: null,
            deletedReason: null,
          };
          recycle = recycle.filter(
            (candidate) => candidate.id !== itemProjectId,
          );
          active = [restored, ...active];
          return { projectId: itemProjectId, ok: true, value: restored };
        });
        return jsonResponse({ results });
      }

      if (pathname.endsWith("/purge-plan") && method === "POST") {
        const current = recycle.find((candidate) => candidate.id === projectId);
        if (!current) return jsonResponse({}, 404);
        return jsonResponse({
          plan: {
            id: `purge-plan-${projectId}`,
            projectId,
            projectName: current.name,
            lifecycleRevision: current.lifecycleRevision,
            projectChecksum: "sha256:test",
            expiresAt: "2026-08-15T07:00:00.000Z",
            typedConfirmation: current.name,
            impact: {
              metadataRecordCount: 17,
              fileCount: 4,
              assetCount: 0,
              estimatedBytes: 4096,
              hasBackup: false,
              blockedReasons: [],
            },
          },
        });
      }

      if (
        /^\/api\/v1\/recycle-bin\/projects\/[^/]+$/.test(pathname) &&
        method === "DELETE"
      ) {
        recycle = recycle.filter((candidate) => candidate.id !== projectId);
        return jsonResponse({
          tombstone: {
            projectId,
            name: body.typedConfirmation,
            purgedAt: "2026-08-15T06:20:00.000Z",
          },
        });
      }

      if (
        pathname === "/api/v1/recycle-bin/projects/batch-purge" &&
        method === "POST"
      ) {
        const items = Array.isArray(body.items)
          ? (body.items as Record<string, unknown>[])
          : [];
        const results = items.map((item) => {
          const itemProjectId = String(item.projectId);
          const current = recycle.find(
            (candidate) => candidate.id === itemProjectId,
          );
          if (!current) {
            return {
              projectId: itemProjectId,
              ok: false,
              error: {
                code: "NOT_FOUND",
                message: "project not found",
                statusCode: 404,
              },
            };
          }
          recycle = recycle.filter(
            (candidate) => candidate.id !== itemProjectId,
          );
          return {
            projectId: itemProjectId,
            ok: true,
            value: {
              projectId: itemProjectId,
              projectName: current.name,
              purgedAt: "2026-08-15T06:30:00.000Z",
            },
          };
        });
        return jsonResponse({ results });
      }

      return jsonResponse(
        {
          error: {
            code: "UNHANDLED_TEST_ROUTE",
            message: `${method} ${pathname}`,
          },
        },
        500,
      );
    },
  );

  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: fetchMock,
  });

  return { fetchMock };
}

function requestBody(call: unknown[]): Record<string, unknown> {
  const init = call[1] as RequestInit | undefined;
  return typeof init?.body === "string"
    ? (JSON.parse(init.body) as Record<string, unknown>)
    : {};
}

function expectSameComputedStyle(
  elements: Element[],
  properties: string[],
): void {
  const [first, ...rest] = elements;
  if (!first) throw new Error("비교할 컨트롤이 없습니다.");
  const expected = Object.fromEntries(
    properties.map((property) => [
      property,
      getComputedStyle(first).getPropertyValue(property),
    ]),
  );
  for (const [property, value] of Object.entries(expected)) {
    expect(value, `${property} 계산값`).not.toBe("");
  }
  for (const element of rest) {
    expect(
      Object.fromEntries(
        properties.map((property) => [
          property,
          getComputedStyle(element).getPropertyValue(property),
        ]),
      ),
    ).toEqual(expected);
  }
}

afterEach(() => {
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: originalFetch,
  });
  if (originalCreateObjectUrl) {
    Object.defineProperty(URL, "createObjectURL", originalCreateObjectUrl);
  } else {
    delete (URL as unknown as { createObjectURL?: unknown }).createObjectURL;
  }
  if (originalRevokeObjectUrl) {
    Object.defineProperty(URL, "revokeObjectURL", originalRevokeObjectUrl);
  } else {
    delete (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL;
  }
  vi.restoreAllMocks();
});

describe("WebEditor persistent project home", () => {
  it("loads both server lists, preserves control order, searches, and opens the editor", async () => {
    const { fetchMock } = installMockApi();
    const user = userEvent.setup();
    const { container } = render(<App />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    expect(
      await screen.findByRole("heading", { name: "지역 건강지표 모니터" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: "프로젝트" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("PROJECT HOME")).not.toBeInTheDocument();
    expect(
      screen.queryByText("분석을 서비스로 이어가세요"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("3단계 제작 흐름")).not.toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([url]) => url === "/api/v1/projects"),
    ).toBe(true);
    expect(
      fetchMock.mock.calls.some(
        ([url]) => url === "/api/v1/recycle-bin/projects",
      ),
    ).toBe(true);

    const minus = screen.getByRole("button", { name: "글꼴 크기 줄이기" });
    const size = screen.getByRole("status", { name: "현재 글꼴 크기" });
    const plus = screen.getByRole("button", { name: "글꼴 크기 늘리기" });
    const theme = screen.getByRole("button", { name: /테마 선택/ });
    expect(
      minus.compareDocumentPosition(size) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      size.compareDocumentPosition(plus) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      plus.compareDocumentPosition(theme) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    await user.type(screen.getByPlaceholderText("이름·설명·Slug 검색"), "SPC");
    expect(
      screen.queryByRole("heading", { name: "지역 건강지표 모니터" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "열기" }));

    expect(
      screen.getByRole("navigation", { name: "제작 단계" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("페이지 캔버스")).toBeInTheDocument();
    expect(container.querySelector(".webeditor-app")).toHaveAttribute(
      "data-theme-id",
      "dark-polar-night",
    );
    const editorHeaderControls = [
      screen.getByRole("button", { name: "프로젝트 홈으로" }),
      screen.getByRole("button", { name: "저장됨" }),
      screen.getByRole("button", { name: /테마 선택/ }),
      container.querySelector(".font-size-control")!,
    ];
    expectSameComputedStyle(editorHeaderControls, [
      "height",
      "min-height",
      "align-items",
    ]);
    expectSameComputedStyle(
      [editorHeaderControls[1]!, editorHeaderControls[2]!],
      ["padding-left", "padding-right"],
    );
  });

  it("shows a load error and retries the real list endpoints", async () => {
    const { fetchMock } = installMockApi({ failFirstProjectLoad: true });
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByText("불러오기 실패")).toBeInTheDocument();
    expect(screen.getByText("metadata unavailable")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(
      await screen.findByRole("heading", { name: "지역 건강지표 모니터" }),
    ).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.filter(([url]) => url === "/api/v1/projects"),
    ).toHaveLength(2);
  });

  it("keeps sibling controls on shared rendered geometry", async () => {
    installMockApi({
      active: [healthProject],
      recycle: [recycledProject],
    });
    const user = userEvent.setup();
    const { container } = render(<App />);
    await screen.findByRole("heading", { name: healthProject.name });

    const importButton = screen.getByRole("button", {
      name: "프로젝트 가져오기",
    });
    const createButton = screen.getByRole("button", { name: "새 프로젝트" });
    expectSameComputedStyle(
      [importButton, createButton],
      [
        "width",
        "height",
        "min-width",
        "min-height",
        "padding-left",
        "padding-right",
        "font-weight",
        "align-items",
      ],
    );
    expect(importButton).toHaveClass("project-entry-button");
    expect(createButton).toHaveClass("project-entry-button");
    expect(getComputedStyle(importButton).minWidth).not.toBe("");
    expect(stylesCss).toContain("--control-height: 2.5rem;");
    expect(stylesCss).toContain("--control-height-large: 3rem;");
    expect(stylesCss).toContain("--control-gap: 0.5rem;");
    expect(stylesCss).toContain("--control-radius: 0.7rem;");
    expect(stylesCss).toMatch(
      /\.project-entry-button\s*\{[^}]*gap:\s*var\(--control-gap\);[^}]*border-radius:\s*var\(--control-radius\);/s,
    );
    expect(stylesCss).toMatch(
      /\.selection-actions > button,[\s\S]*?\[data-slot="alert-dialog-footer"\] > button\s*\{[^}]*height:\s*var\(--control-height\);[^}]*gap:\s*var\(--control-gap\);[^}]*border-radius:\s*var\(--control-radius\);/,
    );

    const search = screen
      .getByPlaceholderText("이름·설명·Slug 검색")
      .closest("label");
    const sort = screen.getByRole("combobox", { name: "프로젝트 정렬" });
    expect(search).not.toBeNull();
    expectSameComputedStyle(
      [search!, sort],
      ["height", "padding-left", "padding-right"],
    );

    const projectActionButtons = Array.from(
      screen
        .getByRole("heading", { name: healthProject.name })
        .closest("article")!
        .querySelectorAll(".project-actions > button"),
    );
    expect(projectActionButtons).toHaveLength(4);
    expectSameComputedStyle(projectActionButtons, [
      "height",
      "min-height",
      "align-items",
    ]);

    await user.click(screen.getByRole("button", { name: /테마 선택/ }));
    const themePicker = await screen.findByLabelText("테마 선택기");
    const themeActionButtons = [
      within(themePicker).getByRole("button", { name: "되돌리기" }),
      within(themePicker).getByRole("button", { name: "적용" }),
    ];
    expectSameComputedStyle(themeActionButtons, [
      "height",
      "min-height",
      "padding-left",
      "padding-right",
      "align-items",
    ]);
    await user.click(themeActionButtons[1]!);

    const navigation = screen.getByRole("navigation", { name: "프로젝트 홈" });
    await user.click(within(navigation).getByRole("button", { name: /^백업/ }));
    const backupButtons = Array.from(
      container.querySelectorAll(
        ".backup-card [data-slot='card-footer'] button",
      ),
    );
    expect(backupButtons).toHaveLength(2);
    expectSameComputedStyle(backupButtons, [
      "height",
      "min-height",
      "padding-left",
      "padding-right",
    ]);

    await user.click(
      within(navigation).getByRole("button", { name: /^휴지통/ }),
    );
    await user.click(
      screen.getByRole("checkbox", { name: `${recycledProject.name} 선택` }),
    );
    const selectionButtons = Array.from(
      container.querySelectorAll(".selection-actions > button"),
    );
    expect(selectionButtons).toHaveLength(2);
    expectSameComputedStyle(selectionButtons, [
      "height",
      "min-height",
      "padding-left",
      "padding-right",
    ]);

    await user.click(screen.getByRole("button", { name: "복원" }));
    const restoreDialog = screen.getByRole("dialog", { name: "복원" });
    const footerButtons = Array.from(
      restoreDialog.querySelectorAll("[data-slot='dialog-footer'] > button"),
    );
    expect(footerButtons).toHaveLength(2);
    expectSameComputedStyle(footerButtons, [
      "height",
      "min-height",
      "padding-left",
      "padding-right",
    ]);
  });

  it("creates, favorites, clones, and exports through the API transport", async () => {
    const { fetchMock } = installMockApi({ active: [healthProject] });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: healthProject.name });

    await user.click(screen.getByRole("button", { name: "새 프로젝트" }));
    await user.type(screen.getByLabelText("프로젝트 이름"), "새 통계 서비스");
    await user.type(screen.getByLabelText("설명"), "실제 API로 만든 프로젝트");
    await user.click(screen.getByRole("button", { name: "만들기" }));
    expect(
      await screen.findByRole("heading", { name: "새 통계 서비스" }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", {
        name: `${healthProject.name} 즐겨찾기 해제`,
      }),
    );
    expect(
      await screen.findByRole("button", {
        name: `${healthProject.name} 즐겨찾기 추가`,
      }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: `${healthProject.name} 복제` }),
    );
    expect(
      await screen.findByRole("heading", {
        name: `${healthProject.name} 복사본`,
      }),
    ).toBeInTheDocument();

    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:webeditor-export"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await user.click(
      screen.getByRole("button", { name: `${healthProject.name} 내보내기` }),
    );

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            url === `/api/v1/projects/${healthProject.id}/export` &&
            (init as RequestInit).method === "POST",
        ),
      ).toBe(true);
    });
    const createCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        url === "/api/v1/projects" && (init as RequestInit).method === "POST",
    );
    expect(requestBody(createCall ?? [])).toMatchObject({
      name: "새 통계 서비스",
      description: "실제 API로 만든 프로젝트",
      themeId: "light-clean-paper",
    });
  });

  it("validates an export file and imports it with explicit identity overrides", async () => {
    const { fetchMock } = installMockApi({ active: [] });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("프로젝트 없음");

    await user.click(screen.getByRole("button", { name: "프로젝트 가져오기" }));
    const exportFile = new File(
      [
        JSON.stringify({
          export: {
            format: "webeditor-project-v1",
            project: healthProject,
            manifest: { manifestVersion: 1 },
            files: [],
          },
        }),
      ],
      "health-project.json",
      { type: "application/json" },
    );
    await user.upload(screen.getByLabelText("프로젝트 JSON"), exportFile);

    const nameInput = await screen.findByLabelText("새 프로젝트 이름");
    expect(nameInput).toHaveValue(`${healthProject.name} 가져오기`);
    await user.clear(nameInput);
    await user.type(nameInput, "가져온 건강지표");
    await user.click(screen.getByRole("button", { name: "가져오기" }));

    expect(
      await screen.findByRole("heading", { name: "가져온 건강지표" }),
    ).toBeInTheDocument();
    const importCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        url === "/api/v1/projects/import" &&
        (init as RequestInit).method === "POST",
    );
    expect(requestBody(importCall ?? [])).toMatchObject({
      export: { format: "webeditor-project-v1" },
      name: "가져온 건강지표",
      slug: `${healthProject.slug}-import`,
    });
  });

  it("batch restores selected recycle projects without overwriting conflicts and returns focus on Escape", async () => {
    const { fetchMock } = installMockApi({
      active: [],
      recycle: [recycledProject, secondRecycledProject],
    });
    const user = userEvent.setup();
    render(<App />);
    const navigation = await screen.findByRole("navigation", {
      name: "프로젝트 홈",
    });
    await user.click(
      within(navigation).getByRole("button", { name: /^휴지통/ }),
    );
    await user.click(
      screen.getByRole("checkbox", { name: "표시된 프로젝트 모두 선택" }),
    );

    const trigger = screen.getByRole("button", { name: "선택 복원" });
    await user.click(trigger);
    expect(
      screen.getByRole("dialog", { name: "선택 복원" }),
    ).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(trigger).toHaveFocus();

    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "복원" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "선택 복원" }),
      ).not.toBeInTheDocument(),
    );

    const batchCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        url === "/api/v1/recycle-bin/projects/batch-restore" &&
        (init as RequestInit).method === "POST",
    );
    const body = requestBody(batchCall ?? []);
    expect(body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          projectId: recycledProject.id,
          expectedLifecycleRevision: recycledProject.lifecycleRevision,
          conflictResolution: "KEEP_ORIGINAL",
        }),
        expect.objectContaining({
          projectId: secondRecycledProject.id,
          expectedLifecycleRevision: secondRecycledProject.lifecycleRevision,
          conflictResolution: "KEEP_ORIGINAL",
        }),
      ]),
    );
  });

  it("batch purges only after a plan and exact confirmation for every selected project", async () => {
    const { fetchMock } = installMockApi({
      active: [],
      recycle: [recycledProject, secondRecycledProject],
    });
    const user = userEvent.setup();
    render(<App />);
    const navigation = await screen.findByRole("navigation", {
      name: "프로젝트 홈",
    });
    await user.click(
      within(navigation).getByRole("button", { name: /^휴지통/ }),
    );
    await user.click(
      screen.getByRole("checkbox", { name: "표시된 프로젝트 모두 선택" }),
    );

    const trigger = screen.getByRole("button", { name: "선택 영구 삭제" });
    await user.click(trigger);
    let dialog = screen.getByRole("alertdialog", {
      name: "선택 영구 삭제",
    });
    const action = within(dialog).getByRole("button", {
      name: "영구 삭제",
    });
    expect(action).toBeDisabled();
    expect(
      fetchMock.mock.calls.some(
        ([url]) => url === "/api/v1/recycle-bin/projects/batch-purge",
      ),
    ).toBe(false);
    await within(dialog).findByLabelText(
      `“${secondRecycledProject.name}” 정확히 입력`,
    );
    await user.keyboard("{Escape}");
    expect(trigger).toHaveFocus();

    await user.click(trigger);
    dialog = screen.getByRole("alertdialog", {
      name: "선택 영구 삭제",
    });
    await user.type(
      await within(dialog).findByLabelText(
        `“${recycledProject.name}” 정확히 입력`,
      ),
      recycledProject.name,
    );
    await user.type(
      within(dialog).getByLabelText(
        `“${secondRecycledProject.name}” 정확히 입력`,
      ),
      secondRecycledProject.name,
    );
    await user.click(
      within(dialog).getByRole("checkbox", {
        name: "삭제 전 프로젝트별 백업",
      }),
    );
    await user.click(
      within(dialog).getByRole("button", {
        name: "영구 삭제",
      }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("alertdialog", {
          name: "선택 영구 삭제",
        }),
      ).not.toBeInTheDocument(),
    );

    const batchCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        url === "/api/v1/recycle-bin/projects/batch-purge" &&
        (init as RequestInit).method === "POST",
    );
    const body = requestBody(batchCall ?? []);
    expect(body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          projectId: recycledProject.id,
          purgePlanId: `purge-plan-${recycledProject.id}`,
          typedConfirmation: recycledProject.name,
          backupBeforePurge: false,
        }),
        expect.objectContaining({
          projectId: secondRecycledProject.id,
          purgePlanId: `purge-plan-${secondRecycledProject.id}`,
          typedConfirmation: secondRecycledProject.name,
          backupBeforePurge: false,
        }),
      ]),
    );
  });

  it("keeps soft trash behind an impact dialog, returns focus, and exposes stale conflicts", async () => {
    const { fetchMock } = installMockApi({
      active: [healthProject],
      conflictFirstTrash: true,
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: healthProject.name });

    const trigger = screen.getByRole("button", {
      name: `${healthProject.name} 휴지통으로 이동`,
    });
    await user.click(trigger);
    let dialog = screen.getByRole("alertdialog", {
      name: "휴지통 이동",
    });
    const trashFooterButtons = Array.from(
      dialog.querySelectorAll("[data-slot='alert-dialog-footer'] > button"),
    );
    expect(trashFooterButtons).toHaveLength(2);
    expectSameComputedStyle(trashFooterButtons, [
      "height",
      "min-height",
      "padding-left",
      "padding-right",
    ]);
    expect(within(dialog).getByText("6")).toBeInTheDocument();
    expect(within(dialog).getByText("24")).toBeInTheDocument();
    expect(within(dialog).getByText("4")).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          url === `/api/v1/projects/${healthProject.id}` &&
          (init as RequestInit).method === "DELETE",
      ),
    ).toBe(false);

    await user.keyboard("{Escape}");
    expect(trigger).toHaveFocus();

    await user.click(trigger);
    dialog = screen.getByRole("alertdialog", {
      name: "휴지통 이동",
    });
    await user.click(within(dialog).getByRole("button", { name: "이동" }));
    expect(await screen.findByText("서버 상태 충돌")).toBeInTheDocument();
    expect(dialog).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "이동" }));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());

    const navigation = screen.getByRole("navigation", { name: "프로젝트 홈" });
    await user.click(
      within(navigation).getByRole("button", { name: /^휴지통/ }),
    );
    expect(
      await screen.findByRole("heading", { name: healthProject.name }),
    ).toBeInTheDocument();

    const trashCalls = fetchMock.mock.calls.filter(
      ([url, init]) =>
        url === `/api/v1/projects/${healthProject.id}/trash` &&
        (init as RequestInit).method === "POST",
    );
    expect(trashCalls).toHaveLength(2);
    expect(requestBody(trashCalls[1] ?? [])).toMatchObject({
      expectedRevision: healthProject.revision,
      expectedLifecycleRevision: healthProject.lifecycleRevision,
      reason: "user-request",
    });
  });

  it("offers purge retry but no restore for PURGE_FAILED projects", async () => {
    installMockApi({ active: [], recycle: [purgeFailedProject] });
    const user = userEvent.setup();
    render(<App />);
    const navigation = await screen.findByRole("navigation", {
      name: "프로젝트 홈",
    });
    await user.click(
      within(navigation).getByRole("button", { name: /^휴지통/ }),
    );

    expect(
      await screen.findByRole("heading", { name: purgeFailedProject.name }),
    ).toBeInTheDocument();
    expect(screen.getByText("영구 삭제 실패")).toBeInTheDocument();
    expect(screen.getByText("영구 삭제 재시도만 가능")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "복원" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "영구 삭제" })).toBeEnabled();

    await user.click(
      screen.getByRole("checkbox", { name: `${purgeFailedProject.name} 선택` }),
    );
    expect(screen.getByRole("button", { name: "선택 복원" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "선택 영구 삭제" }),
    ).toBeEnabled();
  });

  it("reloads both lists when trash commits but the server returns an error", async () => {
    const { fetchMock } = installMockApi({
      active: [healthProject],
      recycle: [],
      failAfterCommittedTrash: true,
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: healthProject.name });

    await user.click(
      screen.getByRole("button", {
        name: `${healthProject.name} 휴지통으로 이동`,
      }),
    );
    await user.click(
      within(
        screen.getByRole("alertdialog", { name: "휴지통 이동" }),
      ).getByRole("button", { name: "이동" }),
    );

    expect(
      await screen.findByText("이동은 완료됐지만 응답에 실패했습니다."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("alertdialog", { name: "휴지통 이동" }),
    ).not.toBeInTheDocument();
    const navigation = screen.getByRole("navigation", { name: "프로젝트 홈" });
    await user.click(
      within(navigation).getByRole("button", { name: /^휴지통/ }),
    );
    expect(
      await screen.findByRole("heading", { name: healthProject.name }),
    ).toBeInTheDocument();

    expect(
      fetchMock.mock.calls.filter(([url]) => url === "/api/v1/projects"),
    ).toHaveLength(2);
    expect(
      fetchMock.mock.calls.filter(
        ([url]) => url === "/api/v1/recycle-bin/projects",
      ),
    ).toHaveLength(2);
    expect(
      fetchMock.mock.calls.filter(
        ([url, init]) =>
          url === `/api/v1/projects/${healthProject.id}/trash` &&
          (init as RequestInit).method === "POST",
      ),
    ).toHaveLength(1);
  });

  it("requires an explicit restore conflict strategy and preserves trigger focus", async () => {
    const { fetchMock } = installMockApi({
      active: [],
      recycle: [recycledProject],
      conflictFirstRestore: true,
    });
    const user = userEvent.setup();
    render(<App />);
    const navigation = await screen.findByRole("navigation", {
      name: "프로젝트 홈",
    });
    await user.click(
      within(navigation).getByRole("button", { name: /^휴지통/ }),
    );
    await screen.findByRole("heading", { name: recycledProject.name });

    await user.click(screen.getByRole("button", { name: "상세" }));
    const detailDialog = screen.getByRole("dialog", {
      name: recycledProject.name,
    });
    expect(
      within(detailDialog).getByText(`/${recycledProject.slug}`),
    ).toBeInTheDocument();
    expect(
      within(detailDialog).getByText(recycledProject.deletedReason ?? ""),
    ).toBeInTheDocument();
    expect(within(detailDialog).getByText(/페이지 3/)).toHaveTextContent(
      "페이지 3 · 엘리먼트 11 · 바인딩 5 · 테이블 2 · 에셋 3",
    );
    expect(within(detailDialog).getByText(/무기한/)).toBeInTheDocument();
    await user.click(
      within(detailDialog).getByRole("button", { name: "확인" }),
    );

    const trigger = screen.getByRole("button", { name: "복원" });
    await user.click(trigger);
    expect(screen.getByRole("dialog", { name: "복원" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(trigger).toHaveFocus();

    await user.click(trigger);
    await user.selectOptions(screen.getByLabelText("충돌 처리"), "NEW_SLUG");
    const slug = screen.getByLabelText("새 Slug");
    await user.clear(slug);
    await user.type(slug, "survey-workbench-restored");
    await user.click(screen.getByRole("button", { name: "복원" }));

    expect(
      await screen.findByText("Slug가 활성 프로젝트와 충돌합니다."),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "복원" }));
    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "복원" }),
      ).not.toBeInTheDocument();
    });

    const restoreCalls = fetchMock.mock.calls.filter(
      ([url, init]) =>
        url === `/api/v1/recycle-bin/projects/${recycledProject.id}/restore` &&
        (init as RequestInit).method === "POST",
    );
    expect(restoreCalls).toHaveLength(2);
    expect(requestBody(restoreCalls[1] ?? [])).toMatchObject({
      expectedLifecycleRevision: recycledProject.lifecycleRevision,
      conflictResolution: "NEW_SLUG",
      name: `${recycledProject.name} 복원본`,
      slug: "survey-workbench-restored",
    });
  });

  it("restores dual identity conflicts with a new name and Slug together", async () => {
    const { fetchMock } = installMockApi({
      active: [
        project("project-conflict", {
          name: recycledProject.name,
          slug: recycledProject.slug,
        }),
      ],
      recycle: [recycledProject],
      requireCombinedRestoreIdentity: true,
    });
    const user = userEvent.setup();
    render(<App />);
    const navigation = await screen.findByRole("navigation", {
      name: "프로젝트 홈",
    });
    await user.click(
      within(navigation).getByRole("button", { name: /^휴지통/ }),
    );
    await screen.findByRole("heading", { name: recycledProject.name });

    await user.click(screen.getByRole("button", { name: "복원" }));
    await user.selectOptions(screen.getByLabelText("충돌 처리"), "NEW_SLUG");
    const nameInput = screen.getByLabelText("새 프로젝트 이름");
    const slugInput = screen.getByLabelText("새 Slug");
    expect(nameInput.className).toBe(slugInput.className);
    await user.clear(nameInput);
    await user.type(nameInput, "설문 분석 복원본");
    await user.clear(slugInput);
    await user.type(slugInput, "survey-workbench-restored");
    await user.click(screen.getByRole("button", { name: "복원" }));

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "복원" }),
      ).not.toBeInTheDocument(),
    );
    await user.click(
      within(navigation).getByRole("button", { name: /^활성 프로젝트/ }),
    );
    expect(
      await screen.findByRole("heading", { name: "설문 분석 복원본" }),
    ).toBeInTheDocument();

    const restoreCalls = fetchMock.mock.calls.filter(
      ([url, init]) =>
        url === `/api/v1/recycle-bin/projects/${recycledProject.id}/restore` &&
        (init as RequestInit).method === "POST",
    );
    expect(restoreCalls).toHaveLength(1);
    expect(requestBody(restoreCalls[0] ?? [])).toMatchObject({
      expectedLifecycleRevision: recycledProject.lifecycleRevision,
      conflictResolution: "NEW_SLUG",
      name: "설문 분석 복원본",
      slug: "survey-workbench-restored",
    });
  });

  it("offers purge only in the recycle bin and requires plan, exact name, and backup choice", async () => {
    const { fetchMock } = installMockApi({
      active: [healthProject],
      recycle: [recycledProject],
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: healthProject.name });
    expect(
      screen.queryByRole("button", { name: "영구 삭제" }),
    ).not.toBeInTheDocument();

    const navigation = screen.getByRole("navigation", { name: "프로젝트 홈" });
    await user.click(
      within(navigation).getByRole("button", { name: /^휴지통/ }),
    );
    const trigger = await screen.findByRole("button", { name: "영구 삭제" });
    await user.click(trigger);
    let dialog = screen.getByRole("alertdialog", {
      name: "영구 삭제",
    });
    const purgeAction = within(dialog).getByRole("button", {
      name: "영구 삭제",
    });
    expect(purgeAction).toBeDisabled();
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          url ===
            `/api/v1/recycle-bin/projects/${recycledProject.id}/purge-plan` &&
          (init as RequestInit).method === "POST",
      ),
    ).toBe(true);
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          url === `/api/v1/recycle-bin/projects/${recycledProject.id}` &&
          (init as RequestInit).method === "DELETE",
      ),
    ).toBe(false);

    await screen.findByText("17");
    await user.keyboard("{Escape}");
    expect(trigger).toHaveFocus();

    await user.click(trigger);
    dialog = screen.getByRole("alertdialog", {
      name: "영구 삭제",
    });
    await screen.findByText("17");
    await user.type(
      within(dialog).getByLabelText("프로젝트 이름 정확히 입력"),
      recycledProject.name,
    );
    await user.click(
      within(dialog).getByRole("checkbox", {
        name: "삭제 전 백업",
      }),
    );
    await user.click(within(dialog).getByRole("button", { name: "영구 삭제" }));

    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: recycledProject.name }),
      ).not.toBeInTheDocument(),
    );
    const purgeCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        url === `/api/v1/recycle-bin/projects/${recycledProject.id}` &&
        (init as RequestInit).method === "DELETE",
    );
    expect(requestBody(purgeCall ?? [])).toMatchObject({
      purgePlanId: `purge-plan-${recycledProject.id}`,
      expectedLifecycleRevision: recycledProject.lifecycleRevision,
      typedConfirmation: recycledProject.name,
      backupBeforePurge: false,
    });
  });
});
