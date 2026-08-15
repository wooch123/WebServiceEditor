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
  LAYOUT_PRESET_DEFINITIONS,
  LAYOUT_PRESET_IDS,
  type ApplyLayoutPresetDto,
  type LayoutPresetApplyMode,
  type LayoutPresetDefinition,
  type LayoutPresetPreviewDto,
} from "@webeditor/domain";

import stylesCss from "@/styles.css?raw";
import { LayoutPresetBrowser } from "./LayoutPresetBrowser";

const coordinateChecksum = "a".repeat(64);
const registryChecksum = "b".repeat(64);

function definitionFor(type: (typeof ELEMENT_DEFINITIONS)[number]["type"]) {
  return ELEMENT_DEFINITIONS.find((definition) => definition.type === type)!;
}

function proposedElements(definition: LayoutPresetDefinition) {
  return [...definition.elements]
    .sort((left, right) => left.templateId.localeCompare(right.templateId))
    .map((template, index) => {
      const elementDefinition = definitionFor(template.elementType);
      const elementId = `${definition.id}-element-${index}`;
      return {
        templateId: template.templateId,
        entry: {
          element: {
            id: elementId,
            projectId: "project-1",
            pageId: "page-1",
            type: template.elementType,
            typeVersion: 1 as const,
            name: template.name,
            props: { ...elementDefinition.defaultProps, ...template.props },
            style: { ...elementDefinition.defaultStyle, ...template.style },
            events: [],
            locked: false,
            hidden: false,
            revision: 1,
          },
          layout: {
            elementId,
            breakpoint: "desktop" as const,
            ...template.layout,
            minW: elementDefinition.layout.minW,
            minH: elementDefinition.layout.minH,
            maxW: elementDefinition.layout.maxW,
            maxH: elementDefinition.layout.maxH,
          },
        },
      };
    });
}

function previewFor(
  definition: LayoutPresetDefinition,
  mode: LayoutPresetApplyMode,
): LayoutPresetPreviewDto {
  const proposed = proposedElements(definition);
  const elementIdByTemplate = new Map(
    proposed.map(({ templateId, entry }) => [templateId, entry.element.id]),
  );
  const bindingPlaceholders = definition.bindingPlaceholders.map(
    (placeholder) => ({
      elementId: elementIdByTemplate.get(placeholder.templateId)!,
      elementTypeVersion: 1 as const,
      templateId: placeholder.templateId,
      portId: placeholder.portId,
      status: "UNCONNECTED" as const,
    }),
  );
  return {
    previewId: `preview-${definition.id}-${mode}`,
    presetId: definition.id,
    presetVersion: 1,
    presetSnapshot: definition,
    registryChecksum,
    coordinateChecksum,
    pageId: "page-1",
    mode,
    existingElementCount: mode === "REPLACE" ? 2 : 0,
    createdElementCount: proposed.length,
    proposedElements: proposed,
    deletedElementIds: mode === "REPLACE" ? ["old-1", "old-2"] : [],
    suggestedSchema: definition.suggestedSchema,
    bindingPlaceholders,
    warnings: [
      ...bindingPlaceholders.map((placeholder) => ({
        code: "REQUIRED_BINDING_UNCONNECTED" as const,
        message: "미연결",
        elementId: placeholder.elementId,
        portId: placeholder.portId,
      })),
      ...(mode === "REPLACE"
        ? [
            {
              code: "REPLACE_EXISTING_ELEMENTS" as const,
              message: "교체",
              elementId: null,
              portId: null,
            },
          ]
        : []),
    ],
    layoutRevision: 4,
    projectRevision: 8,
    expiresAt: "2026-08-16T12:00:00.000Z",
  };
}

function applyFor(preview: LayoutPresetPreviewDto): ApplyLayoutPresetDto {
  const entries = preview.proposedElements.map(({ entry }) => entry);
  const bindingPlaceholders = preview.bindingPlaceholders.map(
    (placeholder) => ({ ...placeholder, instanceId: "instance-1" }),
  );
  const instance = {
    id: "instance-1",
    projectId: "project-1",
    pageId: preview.pageId,
    presetId: preview.presetId,
    presetVersion: 1 as const,
    presetSnapshot: preview.presetSnapshot,
    registryChecksum,
    coordinateChecksum,
    mode: preview.mode,
    state: "APPLIED" as const,
    origin: "APPLY" as const,
    commandId: "command-1",
    elements: preview.proposedElements.map(({ templateId, entry }) => ({
      templateId,
      elementId: entry.element.id,
    })),
    proposedElements: preview.proposedElements,
    bindingPlaceholders,
    createdAt: "2026-08-16T11:00:00.000Z",
    updatedAt: "2026-08-16T11:00:00.000Z",
  };
  return {
    instance,
    coordinateChecksum,
    proposedElements: preview.proposedElements,
    entries,
    createdElementIds: entries.map((entry) => entry.element.id),
    deletedElementIds: preview.deletedElementIds,
    suggestedSchema: preview.suggestedSchema,
    bindingPlaceholders,
    layoutRevision: 5,
    projectRevision: 9,
    commandId: "command-1",
  };
}

interface ApiHarness {
  readonly previewRequests: Array<Record<string, unknown>>;
  readonly applyRequests: Array<Record<string, unknown>>;
  readonly previews: LayoutPresetPreviewDto[];
}

function installApi(
  options: {
    firstApply?: (result: ApplyLayoutPresetDto) => Promise<Response>;
    transformApply?: (result: ApplyLayoutPresetDto) => ApplyLayoutPresetDto;
  } = {},
): ApiHarness {
  const previewRequests: Array<Record<string, unknown>> = [];
  const applyRequests: Array<Record<string, unknown>> = [];
  const previews: LayoutPresetPreviewDto[] = [];
  let applyCount = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const path = new URL(String(input), "http://local").pathname;
      const method = init.method ?? "GET";
      if (path === "/api/v1/layout-presets" && method === "GET") {
        return Response.json({
          schemaVersion: 1,
          definitions: LAYOUT_PRESET_DEFINITIONS,
          checksum: registryChecksum,
        });
      }
      if (path.startsWith("/api/v1/ui/icons/")) {
        const name = decodeURIComponent(path.split("/").at(-1)!);
        return Response.json({
          item: {
            name,
            dynamicName: name.toLocaleLowerCase("en-US"),
            categories: [],
            keywords: [],
          },
        });
      }
      const match = path.match(
        /^\/api\/v1\/pages\/page-1\/layout-presets\/([^/]+)\/(preview|apply)$/,
      );
      if (match && method === "POST") {
        const presetId = decodeURIComponent(match[1]!);
        const definition = LAYOUT_PRESET_DEFINITIONS.find(
          (candidate) => candidate.id === presetId,
        )!;
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        if (match[2] === "preview") {
          previewRequests.push(body);
          const preview = previewFor(
            definition,
            body.mode as LayoutPresetApplyMode,
          );
          previews.push(preview);
          return Response.json({ preview });
        }
        applyRequests.push(body);
        const preview = previews.find(
          (candidate) => candidate.previewId === body.previewId,
        )!;
        const exactResult = applyFor(preview);
        const result = options.transformApply
          ? options.transformApply(exactResult)
          : exactResult;
        applyCount += 1;
        if (applyCount === 1 && options.firstApply) {
          return options.firstApply(result);
        }
        return Response.json(result);
      }
      return Response.json(
        { error: { code: "UNHANDLED", message: `${method} ${path}` } },
        { status: 500 },
      );
    }),
  );
  return { previewRequests, applyRequests, previews };
}

function renderBrowser(onApplied = vi.fn()) {
  return render(
    <LayoutPresetBrowser
      pageId="page-1"
      definitions={ELEMENT_DEFINITIONS}
      captureRevision={() => ({
        pageId: "page-1",
        layoutRevision: 4,
        projectRevision: 8,
      })}
      onApplied={onApplied}
    />,
  );
}

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe(target: Element) {
        this.callback(
          [
            {
              target,
              contentRect: { width: 480, height: 240 },
            } as ResizeObserverEntry,
          ],
          this as unknown as ResizeObserver,
        );
      }
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Phase 7 LayoutPresetBrowser", () => {
  it("projects all 22 registry presets into a structured live coordinate preview without screenshot images", async () => {
    installApi();
    const user = userEvent.setup();
    renderBrowser();
    await user.click(screen.getByRole("button", { name: "프리셋" }));
    const dialog = await screen.findByRole("dialog", { name: "프리셋" });
    const options = await within(dialog).findAllByRole("option");
    expect(options).toHaveLength(22);
    expect(options.map((option) => option.dataset.presetId)).toEqual([
      ...LAYOUT_PRESET_IDS,
    ]);

    const firstDefinition = LAYOUT_PRESET_DEFINITIONS[0]!;
    await user.click(
      within(dialog).getByRole("option", {
        name: new RegExp(firstDefinition.name),
      }),
    );
    const preview = await within(dialog).findByRole("region", {
      name: "실시간 레이아웃 미리보기",
    });
    const items = preview.querySelectorAll<HTMLElement>(
      ".layout-preset-preview-item",
    );
    expect(items).toHaveLength(firstDefinition.elementCount);
    expect([...items].map((item) => item.dataset.templateId)).toEqual(
      proposedElements(firstDefinition).map(({ templateId }) => templateId),
    );
    for (const proposed of proposedElements(firstDefinition)) {
      const item = preview.querySelector<HTMLElement>(
        `[data-template-id="${proposed.templateId}"]`,
      )!;
      expect(item.dataset.x).toBe(String(proposed.entry.layout.x));
      expect(item.dataset.y).toBe(String(proposed.entry.layout.y));
      expect(item.dataset.w).toBe(String(proposed.entry.layout.w));
      expect(item.dataset.h).toBe(String(proposed.entry.layout.h));
    }
    expect(preview.querySelector("img")).not.toBeInTheDocument();
    expect(preview.querySelector(".element-renderer")).toBeInTheDocument();
    expect(
      preview.querySelectorAll(".layout-preset-binding-warning").length,
    ).toBe(firstDefinition.bindingPlaceholders.length);
  });

  it("requires preview before add and applies the exact server snapshot", async () => {
    const api = installApi({
      transformApply: (result) => {
        const proposed = result.entries[0]!;
        const existingElementId = "existing-element";
        return {
          ...result,
          entries: [
            {
              ...proposed,
              element: {
                ...proposed.element,
                id: existingElementId,
                name: "Existing",
              },
              layout: {
                ...proposed.layout,
                elementId: existingElementId,
                y: proposed.layout.y + proposed.layout.h,
              },
            },
            ...result.entries,
          ],
        };
      },
    });
    const onApplied = vi.fn();
    const user = userEvent.setup();
    renderBrowser(onApplied);
    await user.click(screen.getByRole("button", { name: "프리셋" }));
    const dialog = await screen.findByRole("dialog", { name: "프리셋" });
    const apply = within(dialog).getByRole("button", { name: "적용" });
    expect(apply).toBeDisabled();

    const definition = LAYOUT_PRESET_DEFINITIONS[1]!;
    expect(definition.id).toBe("blank-grid");
    expect(definition.elementCount).toBeGreaterThan(0);
    await user.click(
      within(dialog).getByRole("option", { name: new RegExp(definition.name) }),
    );
    await within(dialog).findByRole("region", {
      name: "실시간 레이아웃 미리보기",
    });
    expect(apply).toBeEnabled();
    await user.click(apply);

    await waitFor(() => expect(onApplied).toHaveBeenCalledTimes(1));
    expect(api.previewRequests).toEqual([
      {
        mode: "ADD",
        expectedLayoutRevision: 4,
        expectedProjectRevision: 8,
      },
    ]);
    expect(api.applyRequests).toHaveLength(1);
    expect(api.applyRequests[0]).toMatchObject({
      previewId: `preview-${definition.id}-ADD`,
      expectedLayoutRevision: 4,
      expectedProjectRevision: 8,
    });
    expect(api.applyRequests[0]!.idempotencyKey).toMatch(
      new RegExp(`^layout-preset:page-1:${definition.id}:`),
    );
    const applied = onApplied.mock.calls[0]![0] as ApplyLayoutPresetDto;
    expect(applied.entries).toHaveLength(definition.elementCount + 1);
    expect(applied.coordinateChecksum).toBe(coordinateChecksum);
    expect(applied.instance.coordinateChecksum).toBe(coordinateChecksum);
    expect(applied.proposedElements).toEqual(api.previews[0]!.proposedElements);
    const trigger = screen.getByRole("button", { name: "프리셋" });
    expect(trigger).toHaveAttribute(
      "data-preview-coordinate-checksum",
      coordinateChecksum,
    );
    expect(trigger).toHaveAttribute(
      "data-applied-coordinate-checksum",
      coordinateChecksum,
    );
    expect(trigger).toHaveAttribute(
      "data-instance-coordinate-checksum",
      coordinateChecksum,
    );
  });

  it("requires impact confirmation before replace", async () => {
    const api = installApi();
    const onApplied = vi.fn();
    const user = userEvent.setup();
    renderBrowser(onApplied);
    await user.click(screen.getByRole("button", { name: "프리셋" }));
    const dialog = await screen.findByRole("dialog", { name: "프리셋" });
    const definition = LAYOUT_PRESET_DEFINITIONS[2]!;
    await user.click(
      within(dialog).getByRole("option", { name: new RegExp(definition.name) }),
    );
    await within(dialog).findByRole("region", {
      name: "실시간 레이아웃 미리보기",
    });
    await user.click(within(dialog).getByLabelText("교체"));
    await waitFor(() =>
      expect(api.previewRequests.at(-1)?.mode).toBe("REPLACE"),
    );
    await user.click(within(dialog).getByRole("button", { name: "적용" }));
    expect(api.applyRequests).toHaveLength(0);
    const confirmation = screen.getByRole("alertdialog", { name: "교체" });
    expect(confirmation).toHaveTextContent("기존 2개 삭제 · 신규");
    await user.click(
      within(confirmation).getByRole("button", { name: "교체" }),
    );
    await waitFor(() => expect(onApplied).toHaveBeenCalledTimes(1));
    expect(api.applyRequests).toHaveLength(1);
    expect(
      (onApplied.mock.calls[0]![0] as ApplyLayoutPresetDto).instance.mode,
    ).toBe("REPLACE");
  });

  it("rejects tampered templateId coordinates before applied Canvas mutation", async () => {
    installApi({
      transformApply: (result) => ({
        ...result,
        entries: result.entries.map((entry, index) =>
          index === 0
            ? {
                ...entry,
                layout: { ...entry.layout, x: entry.layout.x + 1 },
              }
            : entry,
        ),
      }),
    });
    const onApplied = vi.fn();
    const user = userEvent.setup();
    renderBrowser(onApplied);
    await user.click(screen.getByRole("button", { name: "프리셋" }));
    const dialog = await screen.findByRole("dialog", { name: "프리셋" });
    await user.click(within(dialog).getAllByRole("option")[0]!);
    const preview = await within(dialog).findByRole("region", {
      name: "실시간 레이아웃 미리보기",
    });
    expect(preview).toHaveAttribute(
      "data-preview-coordinate-checksum",
      coordinateChecksum,
    );
    await user.click(within(dialog).getByRole("button", { name: "적용" }));
    expect(
      await within(dialog).findByText("적용 좌표 불일치"),
    ).toBeInTheDocument();
    expect(onApplied).not.toHaveBeenCalled();
    expect(preview).toBeInTheDocument();
    expect(
      document.querySelector(".layout-preset-trigger"),
    ).not.toHaveAttribute("data-applied-coordinate-checksum");
  });

  it("retains one idempotency key across a lost response and blocks close while apply is in flight", async () => {
    let resolveFirstApply!: (response: Response) => void;
    const firstApply = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFirstApply = resolve;
        }),
    );
    const api = installApi({ firstApply });
    const onApplied = vi.fn();
    const user = userEvent.setup();
    renderBrowser(onApplied);
    await user.click(screen.getByRole("button", { name: "프리셋" }));
    const dialog = await screen.findByRole("dialog", { name: "프리셋" });
    await user.click(within(dialog).getAllByRole("option")[0]!);
    await within(dialog).findByRole("region", {
      name: "실시간 레이아웃 미리보기",
    });
    await user.click(within(dialog).getByRole("button", { name: "적용" }));
    expect(await within(dialog).findByText("적용 중")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "취소" })).toBeDisabled();
    expect(within(dialog).getByLabelText("프리셋 검색")).toBeDisabled();
    expect(within(dialog).getByLabelText("추가")).toBeDisabled();
    expect(within(dialog).getByLabelText("교체")).toBeDisabled();
    expect(within(dialog).getAllByRole("option")[1]).toBeDisabled();
    expect(api.previewRequests).toHaveLength(1);
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "프리셋" })).toBeInTheDocument();

    resolveFirstApply(
      Response.json(
        { error: { code: "LOST_RESPONSE", message: "응답 유실" } },
        { status: 503 },
      ),
    );
    expect(await within(dialog).findByText("응답 유실")).toBeInTheDocument();
    const retry = within(dialog).getByRole("button", { name: "적용" });
    await waitFor(() => expect(retry).toBeEnabled());
    await user.click(retry);
    await waitFor(() => expect(api.applyRequests).toHaveLength(2));
    await waitFor(() => expect(onApplied).toHaveBeenCalledTimes(1));
    expect(api.applyRequests).toHaveLength(2);
    expect(api.applyRequests[0]!.idempotencyKey).toBe(
      api.applyRequests[1]!.idempotencyKey,
    );
    expect(onApplied.mock.calls[0]![0].commandId).toBe("command-1");
  });

  it("keeps REPLACE confirmation open and cancel disabled during in-flight apply", async () => {
    let resolveApply!: () => void;
    const api = installApi({
      firstApply: (result) =>
        new Promise<Response>((resolve) => {
          resolveApply = () => resolve(Response.json(result));
        }),
    });
    const onApplied = vi.fn();
    const user = userEvent.setup();
    renderBrowser(onApplied);
    await user.click(screen.getByRole("button", { name: "프리셋" }));
    const dialog = await screen.findByRole("dialog", { name: "프리셋" });
    await user.click(within(dialog).getAllByRole("option")[0]!);
    await within(dialog).findByRole("region", {
      name: "실시간 레이아웃 미리보기",
    });
    await user.click(within(dialog).getByLabelText("교체"));
    await waitFor(() =>
      expect(api.previewRequests.at(-1)?.mode).toBe("REPLACE"),
    );
    await user.click(within(dialog).getByRole("button", { name: "적용" }));
    const confirmation = screen.getByRole("alertdialog", { name: "교체" });
    await user.click(
      within(confirmation).getByRole("button", { name: "교체" }),
    );
    expect(
      within(confirmation).getByRole("button", { name: "취소" }),
    ).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(
      screen.getByRole("alertdialog", { name: "교체" }),
    ).toBeInTheDocument();
    resolveApply();
    await waitFor(() => expect(onApplied).toHaveBeenCalledTimes(1));
    expect(api.applyRequests).toHaveLength(1);
  });

  it("keeps equal sibling geometry and 419px reachability", () => {
    expect(stylesCss).toMatch(
      /\.layout-preset-modes \[data-slot="toggle-group-item"\][\s\S]*width:\s*100%;[\s\S]*height:\s*var\(--control-height\);[\s\S]*min-height:\s*var\(--control-height\)/,
    );
    expect(stylesCss).toMatch(
      /\.layout-preset-actions \[data-slot="button"\],[\s\S]*\.layout-preset-replace-actions \[data-slot="button"\][\s\S]*width:\s*100%;[\s\S]*height:\s*var\(--control-height\)/,
    );
    expect(stylesCss).toMatch(
      /@media \(max-width: 720px\)[\s\S]*\.layout-preset-dialog\s*\{[\s\S]*width:\s*calc\(100vw - 1rem\);[\s\S]*height:\s*calc\(100dvh - 1rem\)/,
    );
    expect(stylesCss).toMatch(
      /\.layout-preset-browser\s*\{[\s\S]*flex-direction:\s*column;[\s\S]*overflow-y:\s*auto[\s\S]*\.layout-preset-preview\s*\{[\s\S]*max-width:\s*100%;[\s\S]*overflow:\s*auto/,
    );
    expect(stylesCss).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.layout-preset-dialog[\s\S]*animation:\s*none !important/,
    );
  });
});
