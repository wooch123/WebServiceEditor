import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ELEMENT_DEFINITIONS, ELEMENT_PROPERTY_TABS } from "@webeditor/domain";

import stylesCss from "@/styles.css?raw";
import type {
  ElementEntryDto,
  ElementType,
  PlacementCandidateDto,
  ResizeHandle,
} from "@/services/elements-api";
import {
  CanvasControls,
  ElementCanvas,
  ElementInspectorSummary,
  ELEMENT_RESIZE_HANDLES,
} from "./ElementCanvas";
import {
  ElementWorkspaceProvider,
  WorkspaceElementPalette,
} from "./ElementWorkspace";
import { gridToPixelRect, snapPlacementCell } from "./element-geometry";

interface ApiCall {
  path: string;
  method: string;
  body: Record<string, unknown>;
}

type MockElementChange =
  | { kind: "LOCK"; locked: boolean }
  | { kind: "MOVE"; x: number; y: number }
  | { kind: "RESIZE"; x: number; y: number; w: number; h: number };

const rules = Object.fromEntries(
  ELEMENT_DEFINITIONS.map((definition) => [
    definition.type,
    {
      name: definition.defaultName,
      props: definition.defaultProps,
      w: definition.layout.defaultW,
      h: definition.layout.defaultH,
      minW: definition.layout.minW,
      minH: definition.layout.minH,
      maxW: definition.layout.maxW,
      maxH: definition.layout.maxH,
    },
  ]),
) as unknown as Record<
  ElementType,
  {
    name: string;
    props: Readonly<Record<string, unknown>>;
    w: number;
    h: number;
    minW: number;
    minH: number;
    maxW: number;
    maxH: number;
  }
>;

function response(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function makeEntry(
  id: string,
  type: ElementType,
  layout: Partial<ElementEntryDto["layout"]> = {},
): ElementEntryDto {
  const rule = rules[type];
  return {
    element: {
      id,
      projectId: "project-1",
      pageId: "page-1",
      type,
      typeVersion: 1,
      name: `${rule.name} ${id}`,
      props: rule.props,
      style: {},
      events: [],
      locked: false,
      hidden: false,
      revision: 1,
    },
    layout: {
      elementId: id,
      breakpoint: "desktop",
      x: 0,
      y: 0,
      w: rule.w,
      h: rule.h,
      minW: rule.minW,
      minH: rule.minH,
      maxW: rule.maxW,
      maxH: rule.maxH,
      ...layout,
    },
  };
}

function overlaps(
  left: Pick<ElementEntryDto["layout"], "x" | "y" | "w" | "h">,
  right: Pick<ElementEntryDto["layout"], "x" | "y" | "w" | "h">,
) {
  return (
    left.x < right.x + right.w &&
    left.x + left.w > right.x &&
    left.y < right.y + right.h &&
    left.y + left.h > right.y
  );
}

function installElementApi(
  options: {
    entries?: ElementEntryDto[];
    candidateDelays?: number[];
    listDelayMs?: number;
    failFirstList?: boolean;
    conflictNextBatch?: boolean;
  } = {},
) {
  let entries = [...(options.entries ?? [])];
  let projectRevision = 10;
  let layoutRevision = 4;
  let listAttempts = 0;
  let candidateNumber = 0;
  let elementNumber = entries.length;
  let nextBatchErrorCode = options.conflictNextBatch
    ? "LAYOUT_REVISION_CONFLICT"
    : null;
  const candidates = new Map<string, PlacementCandidateDto>();
  const calls: ApiCall[] = [];
  const candidateIds: string[] = [];
  const createPlacementCandidateRequest = vi.fn();
  const commitFromPlacement = vi.fn();
  const persistCompleteBatch = vi.fn();
  const deleteElementRequest = vi.fn();

  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const rawUrl =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const path = new URL(rawUrl, "http://webeditor.local").pathname;
      const method = init.method?.toUpperCase() ?? "GET";
      const body =
        typeof init.body === "string"
          ? (JSON.parse(init.body) as Record<string, unknown>)
          : {};
      calls.push({ path, method, body });

      if (path === "/api/v1/elements/registry" && method === "GET") {
        return response({
          schemaVersion: 1,
          tabs: ELEMENT_PROPERTY_TABS,
          definitions: ELEMENT_DEFINITIONS,
          checksum: "test-registry",
        });
      }

      if (
        path === "/api/v1/projects/project-1/element-history" &&
        method === "GET"
      ) {
        return response({
          projectId: "project-1",
          canUndo: false,
          canRedo: false,
          undoCommand: null,
          redoCommand: null,
          commands: [],
        });
      }

      if (path === "/api/v1/pages/page-1/elements" && method === "GET") {
        listAttempts += 1;
        if (options.failFirstList && listAttempts === 1) {
          return response(
            { error: { code: "LOAD_FAILED", message: "읽기 실패" } },
            500,
          );
        }
        const responseLayoutRevision = layoutRevision;
        const responseProjectRevision = projectRevision;
        const responseEntries = entries;
        if (options.listDelayMs) {
          await new Promise((resolveDelay) =>
            window.setTimeout(resolveDelay, options.listDelayMs),
          );
        }
        return response({
          pageId: "page-1",
          breakpoint: "desktop",
          layoutRevision: responseLayoutRevision,
          projectRevision: responseProjectRevision,
          elements: responseEntries,
        });
      }

      if (
        path === "/api/v1/pages/page-1/placement-candidates" &&
        method === "POST"
      ) {
        createPlacementCandidateRequest(body);
        const index = candidateNumber++;
        const type = body.elementType as ElementType;
        const rule = rules[type];
        const pointer = body.pointer as {
          correctedCanvasX: number;
          correctedCanvasY: number;
        };
        const snapped = snapPlacementCell({
          ...pointer,
          canvasWidth: Number(body.canvasWidth),
          defaultW: rule.w,
        });
        const resolved = {
          x: snapped.column,
          y: snapped.row,
          w: rule.w,
          h: rule.h,
        };
        let collisionResolved = false;
        while (entries.some((entry) => overlaps(resolved, entry.layout))) {
          resolved.y += 1;
          collisionResolved = true;
        }
        const candidateId = `candidate-${index + 1}`;
        const valid =
          pointer.correctedCanvasX >= 0 &&
          pointer.correctedCanvasX <= Number(body.canvasWidth) &&
          pointer.correctedCanvasY >= 0 &&
          pointer.correctedCanvasY <= Number(body.canvasHeight);
        const candidate: PlacementCandidateDto = {
          candidateId,
          pageId: "page-1",
          elementType: type,
          breakpoint: "desktop",
          ...resolved,
          valid,
          collisionResolved,
          layoutRevision,
          projectRevision,
          expiresAt: new Date(Date.now() + 15_000).toISOString(),
        };
        candidates.set(candidateId, candidate);
        candidateIds.push(candidateId);
        const delay = options.candidateDelays?.[index] ?? 0;
        if (delay > 0) {
          await new Promise((resolveDelay) =>
            window.setTimeout(resolveDelay, delay),
          );
        }
        return response({ candidate });
      }

      if (
        path === "/api/v1/pages/page-1/elements/from-placement" &&
        method === "POST"
      ) {
        commitFromPlacement(body);
        const candidate = candidates.get(String(body.candidateId));
        if (!candidate) {
          return response(
            { error: { code: "CANDIDATE_NOT_FOUND", message: "후보 없음" } },
            404,
          );
        }
        const rule = rules[candidate.elementType];
        const id = `element-${++elementNumber}`;
        const entry = makeEntry(id, candidate.elementType, {
          x: candidate.x,
          y: candidate.y,
          w: candidate.w,
          h: candidate.h,
          minW: rule.minW,
          minH: rule.minH,
          maxW: rule.maxW,
          maxH: rule.maxH,
        });
        entries = [...entries, entry];
        layoutRevision += 1;
        projectRevision += 1;
        return response(
          {
            entry,
            layoutRevision,
            projectRevision,
            commandId: `command-placement-${id}`,
          },
          201,
        );
      }

      if (path === "/api/v1/elements/batch-layout" && method === "POST") {
        persistCompleteBatch(body);
        if (nextBatchErrorCode) {
          const code = nextBatchErrorCode;
          nextBatchErrorCode = null;
          return response(
            {
              error: {
                code,
                message:
                  code === "ELEMENT_COLLISION"
                    ? "element collision"
                    : "layout conflict",
              },
            },
            409,
          );
        }
        const items = body.items as Array<{
          elementId: string;
          x: number;
          y: number;
          w: number;
          h: number;
        }>;
        const byId = new Map(items.map((item) => [item.elementId, item]));
        entries = entries.map((entry) => {
          const item = byId.get(entry.element.id)!;
          const changed =
            item.x !== entry.layout.x ||
            item.y !== entry.layout.y ||
            item.w !== entry.layout.w ||
            item.h !== entry.layout.h;
          return {
            element: {
              ...entry.element,
              revision: entry.element.revision + (changed ? 1 : 0),
            },
            layout: { ...entry.layout, ...item },
          };
        });
        layoutRevision += 1;
        projectRevision += 1;
        return response({
          pageId: "page-1",
          mode: body.mode,
          entries,
          layoutRevision,
          projectRevision,
          commandId: `command-batch-${layoutRevision}`,
        });
      }

      const elementMatch = path.match(/^\/api\/v1\/elements\/([^/]+)$/);
      if (elementMatch && method === "GET") {
        const entry = entries.find(
          (candidate) => candidate.element.id === elementMatch[1],
        );
        const definition = ELEMENT_DEFINITIONS.find(
          (candidate) => candidate.type === entry?.element.type,
        );
        if (!entry || !definition) {
          return response(
            { error: { code: "ELEMENT_NOT_FOUND", message: "요소 없음" } },
            404,
          );
        }
        const ports = definition.bindingPorts.map((port) => ({
          portId: port.id,
          status: "UNCONNECTED",
          message: "미연결",
        }));
        return response({
          entry,
          definition,
          propertyValues: {},
          bindingStatus:
            ports.length === 0
              ? { status: "NOT_APPLICABLE", ports, message: "해당 없음" }
              : { status: "UNCONNECTED", ports, message: "미연결" },
          renderState: {
            state: ports.length === 0 ? "DATA" : "EMPTY",
            message: ports.length === 0 ? null : "미연결",
          },
        });
      }
      if (elementMatch && method === "PATCH") {
        const id = elementMatch[1]!;
        const change = body.change as MockElementChange;
        let changedEntry: ElementEntryDto | undefined;
        entries = entries.map((entry) => {
          if (entry.element.id !== id) return entry;
          const updatedEntry: ElementEntryDto = {
            element: {
              ...entry.element,
              revision: entry.element.revision + 1,
              ...(change.kind === "LOCK" ? { locked: change.locked } : {}),
            },
            layout: {
              ...entry.layout,
              ...(change.kind === "MOVE"
                ? { x: change.x, y: change.y }
                : change.kind === "RESIZE"
                  ? {
                      x: change.x,
                      y: change.y,
                      w: change.w,
                      h: change.h,
                    }
                  : {}),
            },
          };
          changedEntry = updatedEntry;
          return updatedEntry;
        });
        layoutRevision += 1;
        projectRevision += 1;
        return response({
          entry: changedEntry,
          layoutRevision,
          projectRevision,
          commandId: `command-patch-${id}`,
        });
      }

      if (elementMatch && method === "DELETE") {
        deleteElementRequest(body);
        const id = elementMatch[1]!;
        entries = entries.filter((entry) => entry.element.id !== id);
        layoutRevision += 1;
        projectRevision += 1;
        return response({
          deletedElementId: id,
          layoutRevision,
          projectRevision,
          commandId: `command-delete-${id}`,
        });
      }

      return response(
        { error: { code: "UNHANDLED", message: `${method} ${path}` } },
        500,
      );
    },
  );
  vi.stubGlobal("fetch", fetchMock);

  return {
    calls,
    candidateIds,
    createPlacementCandidateRequest,
    commitFromPlacement,
    persistCompleteBatch,
    deleteElementRequest,
    entries: () => entries,
    conflictNextBatch() {
      nextBatchErrorCode = "LAYOUT_REVISION_CONFLICT";
    },
    collisionNextBatch() {
      nextBatchErrorCode = "ELEMENT_COLLISION";
    },
  };
}

function domRect(left: number, top: number, width: number, height: number) {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect;
}

function rectGeometry(rect: DOMRect) {
  return {
    bottom: rect.bottom,
    height: rect.height,
    left: rect.left,
    right: rect.right,
    top: rect.top,
    width: rect.width,
  };
}

function cssDeclaration(marker: string, property: string) {
  const markerIndex = stylesCss.indexOf(marker);
  if (markerIndex < 0) return "";
  const blockStart = stylesCss.indexOf("{", markerIndex);
  const blockEnd = stylesCss.indexOf("}", blockStart);
  if (blockStart < 0 || blockEnd < 0) return "";
  const block = stylesCss.slice(blockStart + 1, blockEnd);
  const escapedProperty = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (
    block
      .match(new RegExp(`(?:^|;)\\s*${escapedProperty}\\s*:\\s*([^;]+)`))?.[1]
      ?.trim() ?? ""
  );
}

function cssPixels(value: string, percentageBase = 100): number | null {
  const normalized = value.trim();
  const variable = normalized.match(/^var\((--[^,)]+)(?:,[^)]+)?\)$/)?.[1];
  if (variable) {
    return cssPixels(cssDeclaration(":root", variable), percentageBase);
  }
  if (normalized.endsWith("px")) return Number.parseFloat(normalized);
  if (normalized.endsWith("rem") || normalized.endsWith("em")) {
    return Number.parseFloat(normalized) * 16;
  }
  if (normalized.endsWith("%")) {
    return (Number.parseFloat(normalized) / 100) * percentageBase;
  }
  const numeric = Number.parseFloat(normalized);
  return Number.isFinite(numeric) ? numeric : null;
}

function inlinePosition(element: HTMLElement) {
  const translate = element.style.transform.match(
    /translate(?:3d)?\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px/,
  );
  return {
    left: translate
      ? Number(translate[1])
      : (cssPixels(element.style.left) ?? 0),
    top: translate ? Number(translate[2]) : (cssPixels(element.style.top) ?? 0),
  };
}

function installCanvasGeometry() {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      if (this.classList.contains("element-canvas-viewport")) {
        return domRect(250, 50, 1100, 850);
      }
      if (this.classList.contains("element-canvas-document")) {
        return domRect(300, 100, 960, 640);
      }
      const paletteItem = this.classList.contains("palette-item");
      const canvasControl =
        this.classList.contains("canvas-zoom-control") ||
        this.classList.contains("canvas-grid-toggle");
      const widthDeclaration = paletteItem
        ? cssDeclaration(".palette-grid .palette-item", "width")
        : canvasControl
          ? cssDeclaration(".canvas-zoom-control,", "width")
          : this.style.width;
      const heightDeclaration = paletteItem
        ? cssDeclaration(".palette-grid .palette-item", "height")
        : canvasControl
          ? cssDeclaration(".canvas-zoom-control,", "height")
          : this.style.height;
      const width =
        cssPixels(
          widthDeclaration,
          this.parentElement?.offsetWidth ?? this.offsetWidth,
        ) ?? this.offsetWidth;
      const height =
        cssPixels(
          heightDeclaration,
          this.parentElement?.offsetHeight ?? this.offsetHeight,
        ) ?? this.offsetHeight;
      const position = inlinePosition(this);
      const controlDirection = canvasControl
        ? cssDeclaration(".canvas-controls", "flex-direction")
        : "";
      const controlGap =
        cssPixels(cssDeclaration(".canvas-controls", "gap")) ?? 0;
      const controlIndex = this.classList.contains("canvas-grid-toggle")
        ? 1
        : 0;
      const canvasOrigin = this.closest(".element-canvas-document")
        ? { left: 300, top: 100 }
        : paletteItem
          ? { left: 20, top: 20 }
          : canvasControl
            ? {
                left:
                  controlDirection === "row"
                    ? controlIndex * (width + controlGap)
                    : 0,
                top:
                  controlDirection === "column"
                    ? controlIndex * (height + controlGap)
                    : 0,
              }
            : { left: 0, top: 0 };
      return domRect(
        canvasOrigin.left + position.left,
        canvasOrigin.top + position.top,
        width,
        height,
      );
    },
  );
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(
    function (this: HTMLElement) {
      if (this.classList.contains("element-canvas-document")) return 960;
      if (this.classList.contains("palette-grid")) return 240;
      return 100;
    },
  );
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(
    function (this: HTMLElement) {
      if (this.classList.contains("element-canvas-document")) return 640;
      if (this.classList.contains("palette-grid")) return 180;
      return 40;
    },
  );
  vi.spyOn(HTMLElement.prototype, "offsetLeft", "get").mockImplementation(
    function (this: HTMLElement) {
      return this.classList.contains("element-canvas-document") ? 50 : 0;
    },
  );
  vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(
    function (this: HTMLElement) {
      return this.classList.contains("element-canvas-document") ? 50 : 0;
    },
  );
}

function Harness() {
  const [projectRevision, setProjectRevision] = useState(10);
  const [layoutRevision, setLayoutRevision] = useState(4);
  return (
    <ElementWorkspaceProvider
      projectId="project-1"
      pageId="page-1"
      projectRevision={projectRevision}
      layoutRevision={layoutRevision}
      onProjectRevisionChange={setProjectRevision}
      onLayoutRevisionChange={(_pageId, revision) =>
        setLayoutRevision(revision)
      }
    >
      <WorkspaceElementPalette />
      <CanvasControls />
      <ElementCanvas />
      <ElementInspectorSummary />
      <output aria-label="프로젝트 리비전">{projectRevision}</output>
      <output aria-label="레이아웃 리비전">{layoutRevision}</output>
    </ElementWorkspaceProvider>
  );
}

function mutationCalls(calls: ApiCall[]) {
  return calls.filter(
    (call) =>
      call.path.endsWith("/from-placement") ||
      call.path === "/api/v1/elements/batch-layout" ||
      (call.path.startsWith("/api/v1/elements/") && call.method !== "GET"),
  );
}

const resizeInteractionCases: Array<{
  handle: ResizeHandle;
  deltaX: number;
  deltaY: number;
  expected: { x: number; y: number; w: number; h: number };
}> = [
  {
    handle: "n",
    deltaX: 0,
    deltaY: 16,
    expected: { x: 4, y: 0, w: 12, h: 11 },
  },
  {
    handle: "s",
    deltaX: 0,
    deltaY: 16,
    expected: { x: 4, y: 0, w: 12, h: 13 },
  },
  {
    handle: "e",
    deltaX: 40,
    deltaY: 0,
    expected: { x: 4, y: 0, w: 13, h: 12 },
  },
  {
    handle: "w",
    deltaX: 40,
    deltaY: 0,
    expected: { x: 5, y: 0, w: 11, h: 12 },
  },
  {
    handle: "ne",
    deltaX: 40,
    deltaY: 16,
    expected: { x: 4, y: 0, w: 13, h: 11 },
  },
  {
    handle: "nw",
    deltaX: 40,
    deltaY: 16,
    expected: { x: 5, y: 0, w: 11, h: 11 },
  },
  {
    handle: "se",
    deltaX: 40,
    deltaY: 16,
    expected: { x: 4, y: 0, w: 13, h: 13 },
  },
  {
    handle: "sw",
    deltaX: 40,
    deltaY: 16,
    expected: { x: 5, y: 0, w: 11, h: 13 },
  },
];

afterEach(async () => {
  fireEvent.pointerUp(document, { pointerId: 999, isPrimary: true });
  fireEvent.mouseUp(document, { button: 0 });
  cleanup();
  // dnd-kit intentionally keeps its capture-phase click guard for one short
  // tick after detach. Let that documented guard expire between test roots.
  await new Promise<void>((resolve) => window.setTimeout(resolve, 60));
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("ElementCanvas Phase 5 interaction", () => {
  it("measures placement-placeholder and placed-element DOMRect for keyboard preview and commit", async () => {
    const api = installElementApi();
    installCanvasGeometry();
    const user = userEvent.setup();
    render(<Harness />);
    await screen.findByText("빈 캔버스");

    await user.click(screen.getByTestId("palette-item-text"));
    let placeholder = await screen.findByTestId("placement-placeholder");
    expect(placeholder).toHaveAttribute("data-w", "6");
    expect(placeholder).toHaveAttribute("data-h", "5");
    expect(mutationCalls(api.calls)).toHaveLength(0);

    fireEvent.keyDown(placeholder, { key: "ArrowRight" });
    placeholder = await screen.findByTestId("placement-placeholder");
    await waitFor(() => expect(placeholder).toHaveAttribute("data-x", "1"));
    expect(mutationCalls(api.calls)).toHaveLength(0);
    const previewRect = placeholder.getBoundingClientRect();
    const previewGeometry = {
      x: placeholder.dataset.x,
      y: placeholder.dataset.y,
      w: placeholder.dataset.w,
      h: placeholder.dataset.h,
    };

    fireEvent.keyDown(placeholder, { key: "Enter" });
    const placed = await screen.findByRole("option", {
      name: /Text element-1/,
    });
    expect({
      x: placed.dataset.x,
      y: placed.dataset.y,
      w: placed.dataset.w,
      h: placed.dataset.h,
    }).toEqual(previewGeometry);
    expect(rectGeometry(placed.getBoundingClientRect())).toEqual(
      rectGeometry(previewRect),
    );

    const createCall = api.calls.find((call) =>
      call.path.endsWith("/from-placement"),
    )!;
    expect(Object.keys(createCall.body).sort()).toEqual([
      "candidateId",
      "expectedLayoutRevision",
      "expectedProjectRevision",
      "idempotencyKey",
    ]);
    expect(createCall.body.candidateId).toBe(api.candidateIds.at(-1));
    expect(
      screen.queryByTestId("placement-placeholder"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("palette-drag-overlay"),
    ).not.toBeInTheDocument();
  });

  it("isolates candidate cancel Enter and keeps pointer cancel and commit actions clickable with a created element", async () => {
    const api = installElementApi();
    installCanvasGeometry();
    const user = userEvent.setup();
    render(<Harness />);
    await screen.findByText("빈 캔버스");

    await user.click(screen.getByTestId("palette-item-text"));
    let placeholder = await screen.findByRole("group", {
      name: /Text 배치 후보/,
    });
    const cancel = within(placeholder).getByRole("button", { name: "취소" });
    cancel.focus();
    await user.keyboard("{Enter}");
    expect(screen.queryByTestId("placement-placeholder")).toBeNull();
    expect(mutationCalls(api.calls)).toHaveLength(0);
    expect(api.commitFromPlacement).toHaveBeenCalledTimes(0);

    await user.click(screen.getByTestId("palette-item-text"));
    placeholder = await screen.findByRole("group", {
      name: /Text 배치 후보/,
    });
    const commitAction = within(placeholder).getByRole("button", {
      name: "배치",
    });
    commitAction.focus();
    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("placement-placeholder")).toBeNull();
    expect(api.commitFromPlacement).toHaveBeenCalledTimes(0);

    await user.click(screen.getByTestId("palette-item-text"));
    placeholder = await screen.findByRole("group", {
      name: /Text 배치 후보/,
    });
    await user.click(within(placeholder).getByRole("button", { name: "취소" }));
    expect(screen.queryByTestId("placement-placeholder")).toBeNull();
    expect(api.commitFromPlacement).toHaveBeenCalledTimes(0);

    await user.click(screen.getByTestId("palette-item-text"));
    placeholder = await screen.findByRole("group", {
      name: /Text 배치 후보/,
    });
    await user.click(within(placeholder).getByRole("button", { name: "배치" }));
    const created = await screen.findByTestId("placed-element-element-1");
    expect(created).toBeVisible();
    expect(api.commitFromPlacement).toHaveBeenCalledTimes(1);
    expect(
      api.calls.filter((call) => call.path.endsWith("/from-placement")),
    ).toHaveLength(1);
    expect(stylesCss).toMatch(
      /\.placement-placeholder\[role="group"\]\s*\{\s*pointer-events:\s*auto;/,
    );
  });

  it("reuses the visible fresh candidate when pointer drop stays in its cell", async () => {
    const api = installElementApi();
    installCanvasGeometry();
    render(<Harness />);
    await screen.findByText("빈 캔버스");
    const paletteItem = screen.getByTestId("palette-item-button");

    fireEvent.pointerDown(paletteItem, {
      button: 0,
      clientX: 40,
      clientY: 40,
      pointerId: 31,
      isPrimary: true,
    });
    fireEvent.pointerMove(document, {
      clientX: 80,
      clientY: 80,
      pointerId: 31,
      isPrimary: true,
    });
    await screen.findByTestId("palette-drag-overlay");
    fireEvent.pointerMove(document, {
      clientX: 500,
      clientY: 260,
      pointerId: 31,
      isPrimary: true,
    });
    const placeholder = await screen.findByTestId("placement-placeholder");
    expect(placeholder).toHaveAttribute("data-valid", "true");
    const visibleCandidateId = api.candidateIds[0];

    fireEvent.pointerUp(document, {
      clientX: 500,
      clientY: 260,
      pointerId: 31,
      isPrimary: true,
    });
    await screen.findByTestId("placed-element-element-1");
    expect(
      api.calls.filter((call) => call.path.endsWith("placement-candidates")),
    ).toHaveLength(1);
    const commit = api.calls.find((call) =>
      call.path.endsWith("/from-placement"),
    )!;
    expect(commit.body.candidateId).toBe(visibleCandidateId);
  });

  it("refreshes a 15-second expired cache on final pointer DragEnd after a stationary drag and commits the fresh candidate", async () => {
    const candidateCreatedAt = Date.now();
    const api = installElementApi();
    installCanvasGeometry();
    render(<Harness />);
    await screen.findByText("빈 캔버스");
    const paletteItem = screen.getByTestId("palette-item-button");

    fireEvent.pointerDown(paletteItem, {
      button: 0,
      clientX: 40,
      clientY: 40,
      pointerId: 33,
      isPrimary: true,
    });
    fireEvent.pointerMove(document, {
      clientX: 80,
      clientY: 80,
      pointerId: 33,
      isPrimary: true,
    });
    await screen.findByTestId("palette-drag-overlay");
    fireEvent.pointerMove(document, {
      clientX: 500,
      clientY: 260,
      pointerId: 33,
      isPrimary: true,
    });
    await screen.findByTestId("placement-placeholder");
    expect(api.createPlacementCandidateRequest).toHaveBeenCalledTimes(1);
    expect(api.commitFromPlacement).toHaveBeenCalledTimes(0);

    vi.spyOn(Date, "now").mockReturnValue(candidateCreatedAt + 16_000);
    fireEvent.pointerUp(document, {
      clientX: 500,
      clientY: 260,
      pointerId: 33,
      isPrimary: true,
    });

    await screen.findByTestId("placed-element-element-1");
    expect(api.createPlacementCandidateRequest).toHaveBeenCalledTimes(2);
    expect(api.commitFromPlacement).toHaveBeenCalledTimes(1);
    const commit = api.calls.find((call) =>
      call.path.endsWith("/from-placement"),
    )!;
    expect(commit.body.candidateId).toBe("candidate-2");
  });

  it.each([
    {
      edge: "right",
      inside: { x: 1259, y: 260 },
      outside: { x: 1261, y: 260 },
    },
    { edge: "left", inside: { x: 301, y: 260 }, outside: { x: 299, y: 260 } },
    { edge: "top", inside: { x: 500, y: 101 }, outside: { x: 500, y: 99 } },
    { edge: "bottom", inside: { x: 500, y: 260 }, outside: { x: 500, y: 741 } },
  ])(
    "moves a pointer inside to one pixel outside, replaces valid with invalid placement-placeholder candidate, and blocks commit at the $edge boundary",
    async ({ inside, outside }) => {
      const api = installElementApi();
      installCanvasGeometry();
      render(<Harness />);
      await screen.findByText("빈 캔버스");
      const paletteItem = screen.getByTestId("palette-item-text");

      fireEvent.pointerDown(paletteItem, {
        button: 0,
        clientX: 40,
        clientY: 40,
        pointerId: 32,
        isPrimary: true,
      });
      fireEvent.pointerMove(document, {
        clientX: 80,
        clientY: 80,
        pointerId: 32,
        isPrimary: true,
      });
      await screen.findByTestId("palette-drag-overlay");
      fireEvent.pointerMove(document, {
        clientX: inside.x,
        clientY: inside.y,
        pointerId: 32,
        isPrimary: true,
      });
      await waitFor(() =>
        expect(screen.getByTestId("placement-placeholder")).toHaveAttribute(
          "data-valid",
          "true",
        ),
      );
      fireEvent.pointerMove(document, {
        clientX: outside.x,
        clientY: outside.y,
        pointerId: 32,
        isPrimary: true,
      });
      await waitFor(() =>
        expect(screen.getByTestId("placement-placeholder")).toHaveAttribute(
          "data-valid",
          "false",
        ),
      );
      expect(
        api.calls.filter((call) => call.path.endsWith("placement-candidates")),
      ).toHaveLength(2);
      expect(api.createPlacementCandidateRequest).toHaveBeenCalledTimes(2);

      fireEvent.pointerUp(document, {
        clientX: outside.x,
        clientY: outside.y,
        pointerId: 32,
        isPrimary: true,
      });
      await waitFor(() =>
        expect(screen.queryByTestId("placement-placeholder")).toBeNull(),
      );
      expect(
        api.calls.filter((call) => call.path.endsWith("/from-placement")),
      ).toHaveLength(0);
      expect(api.commitFromPlacement).toHaveBeenCalledTimes(0);
    },
  );

  it("commits the final pointer cell after delayed drag-over responses", async () => {
    const api = installElementApi({ candidateDelays: [45, 25, 1] });
    installCanvasGeometry();
    render(<Harness />);
    await screen.findByText("빈 캔버스");
    const paletteItem = screen.getByTestId("palette-item-button");

    fireEvent.pointerDown(paletteItem, {
      button: 0,
      clientX: 40,
      clientY: 40,
      pointerId: 1,
      isPrimary: true,
    });
    fireEvent.pointerMove(document, {
      clientX: 80,
      clientY: 80,
      pointerId: 1,
      isPrimary: true,
    });
    await screen.findByTestId("palette-drag-overlay");
    fireEvent.pointerMove(document, {
      clientX: 430,
      clientY: 220,
      pointerId: 1,
      isPrimary: true,
    });
    await waitFor(() =>
      expect(
        api.calls.filter((call) => call.path.endsWith("placement-candidates"))
          .length,
      ).toBeGreaterThan(0),
    );
    expect(mutationCalls(api.calls)).toHaveLength(0);
    fireEvent.pointerMove(document, {
      clientX: 690,
      clientY: 300,
      pointerId: 1,
      isPrimary: true,
    });
    fireEvent.pointerUp(document, {
      clientX: 690,
      clientY: 300,
      pointerId: 1,
      isPrimary: true,
    });

    await waitFor(() =>
      expect(
        api.calls.filter((call) => call.path.endsWith("/from-placement")),
      ).toHaveLength(1),
    );
    const createCall = api.calls.find((call) =>
      call.path.endsWith("/from-placement"),
    )!;
    expect(createCall.body.candidateId).toBe(api.candidateIds.at(-1));
    expect(
      api.calls.filter((call) => call.path.endsWith("/from-placement")),
    ).toHaveLength(1);
  });

  it("coalesces pointer moves that snap to one server grid cell", async () => {
    const api = installElementApi({ candidateDelays: [40] });
    installCanvasGeometry();
    render(<Harness />);
    await screen.findByText("빈 캔버스");
    const paletteItem = screen.getByTestId("palette-item-text");

    fireEvent.pointerDown(paletteItem, {
      button: 0,
      clientX: 40,
      clientY: 40,
      pointerId: 21,
      isPrimary: true,
    });
    fireEvent.pointerMove(document, {
      clientX: 80,
      clientY: 80,
      pointerId: 21,
      isPrimary: true,
    });
    await screen.findByTestId("palette-drag-overlay");
    for (const clientX of [380, 381, 382, 383]) {
      fireEvent.pointerMove(document, {
        clientX,
        clientY: 220,
        pointerId: 21,
        isPrimary: true,
      });
    }

    await screen.findByTestId("placement-placeholder");
    expect(
      api.calls.filter((call) => call.path.endsWith("placement-candidates")),
    ).toHaveLength(1);
    expect(mutationCalls(api.calls)).toHaveLength(0);
    fireEvent.keyDown(document, { key: "Escape", code: "Escape" });
    fireEvent.pointerUp(document, {
      clientX: 383,
      clientY: 220,
      pointerId: 21,
      isPrimary: true,
    });
  });

  it("requests distinct candidates across the server half-cell boundary", async () => {
    const api = installElementApi();
    installCanvasGeometry();
    render(<Harness />);
    await screen.findByText("빈 캔버스");
    const paletteItem = screen.getByTestId("palette-item-text");

    fireEvent.pointerDown(paletteItem, {
      button: 0,
      clientX: 40,
      clientY: 40,
      pointerId: 22,
      isPrimary: true,
    });
    fireEvent.pointerMove(document, {
      clientX: 80,
      clientY: 80,
      pointerId: 22,
      isPrimary: true,
    });
    await screen.findByTestId("palette-drag-overlay");
    fireEvent.pointerMove(document, {
      clientX: 374.49,
      clientY: 220,
      pointerId: 22,
      isPrimary: true,
    });
    let placeholder = await screen.findByTestId("placement-placeholder");
    expect(placeholder).toHaveAttribute("data-x", "1");
    fireEvent.pointerMove(document, {
      clientX: 374.5,
      clientY: 220,
      pointerId: 22,
      isPrimary: true,
    });
    await waitFor(() =>
      expect(
        api.calls.filter((call) => call.path.endsWith("placement-candidates")),
      ).toHaveLength(2),
    );
    placeholder = screen.getByTestId("placement-placeholder");
    await waitFor(() => expect(placeholder).toHaveAttribute("data-x", "2"));
    expect(mutationCalls(api.calls)).toHaveLength(0);
    fireEvent.keyDown(document, { key: "Escape", code: "Escape" });
    fireEvent.pointerUp(document, {
      clientX: 374.5,
      clientY: 220,
      pointerId: 22,
      isPrimary: true,
    });
  });

  it("refreshes an expired cached candidate on final keyboard drop commit", async () => {
    const candidateCreatedAfter = Date.now();
    const api = installElementApi();
    installCanvasGeometry();
    const user = userEvent.setup();
    render(<Harness />);
    await screen.findByText("빈 캔버스");

    await user.click(screen.getByTestId("palette-item-text"));
    const placeholder = await screen.findByTestId("placement-placeholder");
    expect(
      api.calls.filter((call) => call.path.endsWith("placement-candidates")),
    ).toHaveLength(1);
    vi.spyOn(Date, "now").mockReturnValue(candidateCreatedAfter + 16_000);
    fireEvent.keyDown(placeholder, { key: "Enter" });

    await screen.findByTestId("placed-element-element-1");
    expect(
      api.calls.filter((call) => call.path.endsWith("placement-candidates")),
    ).toHaveLength(2);
    const createCall = api.calls.find((call) =>
      call.path.endsWith("/from-placement"),
    )!;
    expect(createCall.body.candidateId).toBe("candidate-2");
  });

  it("persists a complete 21-item layout once and restores it on reload", async () => {
    const entries = Array.from({ length: 21 }, (_, index) =>
      makeEntry(`item-${index + 1}`, "text", {
        x: (index % 4) * 6,
        y: Math.floor(index / 4) * 6,
      }),
    );
    const api = installElementApi({ entries });
    installCanvasGeometry();
    const user = userEvent.setup();
    const firstView = render(<Harness />);
    const options = await within(
      screen.getByRole("listbox", { name: "배치 엘리먼트" }),
    ).findAllByRole("option");
    expect(options).toHaveLength(21);

    await user.click(options[0]!);
    await user.keyboard("{Control>}");
    await user.click(options[1]!);
    await user.keyboard("{/Control}");
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    expect(options[1]).toHaveAttribute("aria-selected", "true");
    fireEvent.pointerDown(screen.getByTestId("element-canvas"));
    expect(options[0]).toHaveAttribute("aria-selected", "false");

    options[0]!.focus();
    fireEvent.keyDown(options[0]!, { key: "ArrowRight" });
    await waitFor(() =>
      expect(
        api.calls.filter(
          (call) => call.path === "/api/v1/elements/batch-layout",
        ),
      ).toHaveLength(1),
    );
    const batch = api.calls.find(
      (call) => call.path === "/api/v1/elements/batch-layout",
    )!;
    expect(batch.body.mode).toBe("COMPLETE");
    const batchItems = batch.body.items as Array<Record<string, unknown>>;
    expect(batchItems).toHaveLength(21);
    expect(batchItems[0]).toMatchObject({
      elementId: "item-1",
      x: 1,
      expectedRevision: 1,
    });
    await waitFor(() =>
      expect(screen.getByTestId("placed-element-item-1")).toHaveAttribute(
        "data-x",
        "1",
      ),
    );

    firstView.unmount();
    render(<Harness />);
    expect(await screen.findByTestId("placed-element-item-1")).toHaveAttribute(
      "data-x",
      "1",
    );
    expect(api.entries()).toHaveLength(21);
  });

  it("moves by one or four grid cells with keyboard commands", async () => {
    const api = installElementApi({
      entries: [makeEntry("keyboard-target", "button", { x: 0, y: 0 })],
    });
    installCanvasGeometry();
    render(<Harness />);
    let option = await screen.findByTestId("placed-element-keyboard-target");

    option.focus();
    fireEvent.keyDown(option, { key: "ArrowRight" });
    await waitFor(() =>
      expect(
        api.calls.filter(
          (call) => call.path === "/api/v1/elements/batch-layout",
        ),
      ).toHaveLength(1),
    );
    option = screen.getByTestId("placed-element-keyboard-target");
    expect(option).toHaveAttribute("data-x", "1");

    fireEvent.keyDown(option, { key: "ArrowRight", shiftKey: true });
    await waitFor(() =>
      expect(
        api.calls.filter(
          (call) => call.path === "/api/v1/elements/batch-layout",
        ),
      ).toHaveLength(2),
    );
    expect(
      screen.getByTestId("placed-element-keyboard-target"),
    ).toHaveAttribute("data-x", "5");
    const batches = api.calls.filter(
      (call) => call.path === "/api/v1/elements/batch-layout",
    );
    expect(
      (batches[0]!.body.items as Array<Record<string, unknown>>)[0],
    ).toMatchObject({ x: 1 });
    expect(
      (batches[1]!.body.items as Array<Record<string, unknown>>)[0],
    ).toMatchObject({ x: 5 });
  });

  it("persists ArrowRight vertical compaction for two colliding elements in one COMPLETE atomic batch and reloads exactly", async () => {
    const original = [
      makeEntry("compact-a", "text", { x: 0, y: 0 }),
      makeEntry("compact-b", "text", { x: 6, y: 0 }),
    ];
    const api = installElementApi({ entries: original });
    installCanvasGeometry();
    const firstView = render(<Harness />);
    const moving = await screen.findByTestId("placed-element-compact-a");
    moving.focus();
    fireEvent.keyDown(moving, { key: "ArrowRight" });

    await waitFor(() =>
      expect(
        api.calls.filter(
          (call) => call.path === "/api/v1/elements/batch-layout",
        ),
      ).toHaveLength(1),
    );
    expect(api.persistCompleteBatch).toHaveBeenCalledTimes(1);
    const batch = api.calls.find(
      (call) => call.path === "/api/v1/elements/batch-layout",
    )!;
    expect(batch.body.mode).toBe("COMPLETE");
    const items = batch.body.items as Array<{
      elementId: string;
      x: number;
      y: number;
      w: number;
      h: number;
    }>;
    expect(items).toHaveLength(2);
    expect(
      items.filter((item, index) =>
        ["x", "y", "w", "h"].some(
          (key) =>
            item[key as keyof typeof item] !==
            original[index]!.layout[key as keyof ElementEntryDto["layout"]],
        ),
      ).length,
    ).toBeGreaterThanOrEqual(2);
    expect(overlaps(items[0]!, items[1]!)).toBe(false);

    firstView.unmount();
    render(<Harness />);
    for (const item of items) {
      const reloaded = await screen.findByTestId(
        `placed-element-${item.elementId}`,
      );
      expect(reloaded).toHaveAttribute("data-x", String(item.x));
      expect(reloaded).toHaveAttribute("data-y", String(item.y));
    }
  });

  it("persists an RGL resize with verticalCompactor for two sibling elements as one COMPLETE atomic batch and reloads exact coordinates", async () => {
    const original = [
      makeEntry("resize-compact-a", "container", { x: 0, y: 8 }),
      makeEntry("resize-compact-b", "text", { x: 0, y: 22 }),
    ];
    const api = installElementApi({ entries: original });
    installCanvasGeometry();
    const firstView = render(<Harness />);
    const moving = await screen.findByTestId("placed-element-resize-compact-a");
    fireEvent.pointerDown(moving);
    const handle = within(moving).getByTestId("resize-handle-s");

    fireEvent.mouseDown(handle, {
      button: 0,
      buttons: 1,
      clientX: 600,
      clientY: 400,
    });
    fireEvent.mouseMove(document, {
      buttons: 1,
      clientX: 600,
      clientY: 416,
    });
    fireEvent.mouseUp(document, {
      button: 0,
      clientX: 600,
      clientY: 416,
    });

    await waitFor(() =>
      expect(api.persistCompleteBatch).toHaveBeenCalledTimes(1),
    );
    const batch = api.calls.find(
      (call) => call.path === "/api/v1/elements/batch-layout",
    )!;
    expect(batch.body.mode).toBe("COMPLETE");
    const items = batch.body.items as Array<{
      elementId: string;
      x: number;
      y: number;
      w: number;
      h: number;
    }>;
    expect(items).toHaveLength(2);
    expect(items.map(({ y }) => y)).not.toEqual(
      original.map(({ layout }) => layout.y),
    );
    expect(
      items.every((item, index) => item.y !== original[index]!.layout.y),
    ).toBe(true);
    expect(overlaps(items[0]!, items[1]!)).toBe(false);

    firstView.unmount();
    render(<Harness />);
    for (const item of items) {
      const reloaded = await screen.findByTestId(
        `placed-element-${item.elementId}`,
      );
      expect({
        x: Number(reloaded.dataset.x),
        y: Number(reloaded.dataset.y),
        w: Number(reloaded.dataset.w),
        h: Number(reloaded.dataset.h),
      }).toEqual({ x: item.x, y: item.y, w: item.w, h: item.h });
    }
    expect(api.persistCompleteBatch).toHaveBeenCalledTimes(1);
  });

  it("renders a persisted y: 12 gap position exactly without mount-time compaction or save", async () => {
    const entry = makeEntry("persisted-gap", "text", { x: 4, y: 12 });
    const api = installElementApi({ entries: [entry] });
    installCanvasGeometry();
    render(<Harness />);

    const placed = await screen.findByTestId("placed-element-persisted-gap");
    const expected = gridToPixelRect(entry.layout, 960);
    expect(rectGeometry(placed.getBoundingClientRect())).toEqual({
      bottom: 100 + expected.top + expected.height,
      height: expected.height,
      left: 300 + expected.left,
      right: 300 + expected.left + expected.width,
      top: 100 + expected.top,
      width: expected.width,
    });
    expect(placed).toHaveAttribute("data-y", "12");
    expect(mutationCalls(api.calls)).toHaveLength(0);
    expect(api.persistCompleteBatch).toHaveBeenCalledTimes(0);
  });

  it("does not bubble ArrowRight from a nested lock control into the placed element move", async () => {
    const api = installElementApi({
      entries: [makeEntry("nested-control", "text", { x: 3, y: 2 })],
    });
    installCanvasGeometry();
    render(<Harness />);
    const placed = await screen.findByTestId("placed-element-nested-control");
    fireEvent.pointerDown(placed);
    const lockControl = within(placed).getByRole("button", { name: "잠금" });
    lockControl.focus();
    fireEvent.keyDown(lockControl, { key: "ArrowRight" });

    expect(api.persistCompleteBatch).toHaveBeenCalledTimes(0);
    expect(placed).toHaveAttribute("data-x", "3");
  });

  it("keeps a same-page delayed stale GET from lowering the latest layoutRevision used by the next write", async () => {
    const api = installElementApi({ listDelayMs: 40 });
    installCanvasGeometry();
    const onLayoutRevisionChange = vi.fn();
    const view = render(
      <ElementWorkspaceProvider
        projectId="project-1"
        pageId="page-1"
        projectRevision={10}
        layoutRevision={4}
        onProjectRevisionChange={vi.fn()}
        onLayoutRevisionChange={onLayoutRevisionChange}
      >
        <WorkspaceElementPalette />
        <ElementCanvas />
      </ElementWorkspaceProvider>,
    );
    view.rerender(
      <ElementWorkspaceProvider
        projectId="project-1"
        pageId="page-1"
        projectRevision={10}
        layoutRevision={9}
        onProjectRevisionChange={vi.fn()}
        onLayoutRevisionChange={onLayoutRevisionChange}
      >
        <WorkspaceElementPalette />
        <ElementCanvas />
      </ElementWorkspaceProvider>,
    );

    await screen.findByText("빈 캔버스");
    const user = userEvent.setup();
    await user.click(screen.getByTestId("palette-item-text"));
    const placeholder = await screen.findByTestId("placement-placeholder");
    fireEvent.keyDown(placeholder, { key: "Enter" });
    await screen.findByTestId("placed-element-element-1");

    const candidateRequest = api.calls.find((call) =>
      call.path.endsWith("/placement-candidates"),
    )!;
    const write = api.calls.find((call) =>
      call.path.endsWith("/from-placement"),
    )!;
    expect(candidateRequest.body.expectedLayoutRevision).toBe(9);
    expect(write.body.expectedLayoutRevision).toBe(9);
    expect(onLayoutRevisionChange).toHaveBeenCalledWith("page-1", 9);
  });

  it("handles global Escape and sequential multi-selection Delete once", async () => {
    const api = installElementApi({
      entries: [
        makeEntry("multi-a", "text", { x: 0, y: 0 }),
        makeEntry("multi-b", "button", { x: 8, y: 0 }),
      ],
    });
    installCanvasGeometry();
    const user = userEvent.setup();
    render(<Harness />);
    const first = await screen.findByTestId("placed-element-multi-a");
    const second = screen.getByTestId("placed-element-multi-b");
    await user.click(first);
    await user.keyboard("{Control>}");
    await user.click(second);
    await user.keyboard("{/Control}");
    expect(first).toHaveAttribute("aria-selected", "true");
    expect(second).toHaveAttribute("aria-selected", "true");

    const zoom = screen.getByRole("combobox", { name: "캔버스 배율" });
    zoom.focus();
    fireEvent.keyDown(zoom, { key: "Escape" });
    expect(first).toHaveAttribute("aria-selected", "false");
    expect(second).toHaveAttribute("aria-selected", "false");
    expect(mutationCalls(api.calls)).toHaveLength(0);

    await user.click(first);
    await user.keyboard("{Control>}");
    await user.click(second);
    await user.keyboard("{/Control}");
    zoom.focus();
    fireEvent.keyDown(zoom, { key: "Delete" });
    await waitFor(() =>
      expect(
        api.calls.filter(
          (call) =>
            call.method === "DELETE" &&
            call.path.startsWith("/api/v1/elements/"),
        ),
      ).toHaveLength(2),
    );
    expect(api.deleteElementRequest).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId("placed-element-multi-a")).toBeNull();
    expect(screen.queryByTestId("placed-element-multi-b")).toBeNull();
    const deletes = api.calls.filter(
      (call) =>
        call.method === "DELETE" && call.path.startsWith("/api/v1/elements/"),
    );
    expect(deletes.map((call) => call.body.expectedProjectRevision)).toEqual([
      10, 11,
    ]);
  });

  it("sends one DELETE request for a single selected element", async () => {
    const api = installElementApi({
      entries: [makeEntry("single-delete", "text")],
    });
    installCanvasGeometry();
    const user = userEvent.setup();
    render(<Harness />);
    const selected = await screen.findByTestId("placed-element-single-delete");
    await user.click(selected);

    const grid = screen.getByRole("button", { name: "그리드" });
    grid.focus();
    fireEvent.keyDown(grid, { key: "Delete" });
    await waitFor(() =>
      expect(api.deleteElementRequest).toHaveBeenCalledTimes(1),
    );
    expect(screen.queryByTestId("placed-element-single-delete")).toBeNull();
  });

  it("blocks Delete for two selected elements when one is locked before any partial request and keeps both unchanged", async () => {
    const unlockedLockedEntry = makeEntry("locked-delete", "text", {
      x: 8,
      y: 0,
    });
    const locked: ElementEntryDto = {
      ...unlockedLockedEntry,
      element: { ...unlockedLockedEntry.element, locked: true },
    };
    const api = installElementApi({
      entries: [makeEntry("unlocked-delete", "text"), locked],
    });
    installCanvasGeometry();
    const user = userEvent.setup();
    render(<Harness />);
    const unlocked = await screen.findByTestId(
      "placed-element-unlocked-delete",
    );
    const lockedOption = screen.getByTestId("placed-element-locked-delete");
    await user.click(unlocked);
    await user.keyboard("{Control>}");
    await user.click(lockedOption);
    await user.keyboard("{/Control}");
    expect(
      within(lockedOption).getByRole("button", {
        name: "Text locked-delete 삭제",
      }),
    ).toBeDisabled();

    const grid = screen.getByRole("button", { name: "그리드" });
    grid.focus();
    fireEvent.keyDown(grid, { key: "Delete" });
    expect(await screen.findByRole("alert")).toHaveTextContent("잠금 요소");
    expect(api.calls.filter((call) => call.method === "DELETE")).toHaveLength(
      0,
    );
    expect(api.deleteElementRequest).toHaveBeenCalledTimes(0);
    expect(
      within(
        screen.getByRole("listbox", { name: "배치 엘리먼트" }),
      ).getAllByRole("option"),
    ).toHaveLength(2);
    expect(unlocked).toBeInTheDocument();
    expect(lockedOption).toBeInTheDocument();
  });

  it("labels element collision separately and restores optimistic geometry", async () => {
    const api = installElementApi({
      entries: [makeEntry("collision-target", "button", { x: 2, y: 0 })],
    });
    api.collisionNextBatch();
    installCanvasGeometry();
    render(<Harness />);
    const option = await screen.findByTestId("placed-element-collision-target");
    option.focus();
    fireEvent.keyDown(option, { key: "ArrowRight" });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("요소 충돌");
    expect(alert).not.toHaveTextContent("변경 충돌");
    expect(
      screen.getByTestId("placed-element-collision-target"),
    ).toHaveAttribute("data-x", "2");
    expect(
      api.calls.filter((call) => call.path === "/api/v1/elements/batch-layout"),
    ).toHaveLength(1);
  });

  it("selects, locks, blocks locked movement, and reloads after a conflict", async () => {
    const api = installElementApi({
      entries: [makeEntry("locked-target", "kpi-card", { x: 2, y: 3 })],
    });
    installCanvasGeometry();
    const user = userEvent.setup();
    render(<Harness />);
    const option = await screen.findByRole("option", {
      name: /KPI Card locked-target/,
    });
    fireEvent.pointerDown(option);
    await user.click(within(option).getByRole("button", { name: "잠금" }));
    await waitFor(() =>
      expect(
        within(screen.getByTestId("placed-element-locked-target")).getByRole(
          "button",
          { name: "잠금 해제" },
        ),
      ).toBeInTheDocument(),
    );
    const batchesBefore = api.calls.filter(
      (call) => call.path === "/api/v1/elements/batch-layout",
    ).length;
    fireEvent.keyDown(screen.getByTestId("placed-element-locked-target"), {
      key: "ArrowRight",
    });
    expect(
      api.calls.filter((call) => call.path === "/api/v1/elements/batch-layout"),
    ).toHaveLength(batchesBefore);

    await user.click(
      within(screen.getByTestId("placed-element-locked-target")).getByRole(
        "button",
        { name: "잠금 해제" },
      ),
    );
    api.conflictNextBatch();
    const unlocked = await screen.findByRole("option", {
      name: /KPI Card locked-target/,
    });
    unlocked.focus();
    fireEvent.keyDown(unlocked, { key: "ArrowRight" });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "변경 충돌 · 최신 상태",
    );
    expect(screen.getByTestId("placed-element-locked-target")).toHaveAttribute(
      "data-x",
      "2",
    );
  });

  it("renders all eight resize handles and compact resize affordances", async () => {
    installElementApi({
      entries: [makeEntry("resize-target", "container", { x: 2, y: 2 })],
    });
    installCanvasGeometry();
    render(<Harness />);
    const option = await screen.findByRole("option", {
      name: /Container resize-target/,
    });
    fireEvent.pointerDown(option);
    for (const handle of ELEMENT_RESIZE_HANDLES) {
      const control = await screen.findByTestId(`resize-handle-${handle}`);
      expect(control).toHaveAttribute("data-resize-handle", handle);
    }
    expect(ELEMENT_RESIZE_HANDLES).toEqual([
      "n",
      "s",
      "e",
      "w",
      "ne",
      "nw",
      "se",
      "sw",
    ]);
    expect(stylesCss).toContain(".element-resize-tooltip");
    expect(stylesCss).toContain(
      '.element-renderer[data-render-mode="compact"]',
    );
  });

  it.each(resizeInteractionCases)(
    "persists one exact RGL COMPLETE batch on mouseMove for the $handle resize handle",
    async ({ handle, deltaX, deltaY, expected }) => {
      const api = installElementApi({
        entries: [
          makeEntry(`resize-${handle}`, "container", {
            x: 4,
            y: 0,
            w: 12,
            h: 12,
          }),
        ],
      });
      installCanvasGeometry();
      render(<Harness />);
      await screen.findByTestId(`placed-element-resize-${handle}`);
      const control = screen.getByTestId(`resize-handle-${handle}`);

      fireEvent.mouseDown(control, {
        button: 0,
        buttons: 1,
        clientX: 600,
        clientY: 400,
      });
      fireEvent.mouseMove(document, {
        buttons: 1,
        clientX: 600 + deltaX,
        clientY: 400 + deltaY,
      });
      const tooltip = await screen.findByTestId("resize-tooltip");
      expect(tooltip).toHaveAttribute("data-handle", handle);
      fireEvent.mouseUp(document, {
        button: 0,
        clientX: 600 + deltaX,
        clientY: 400 + deltaY,
      });

      await waitFor(() =>
        expect(
          api.calls.filter(
            (call) => call.path === "/api/v1/elements/batch-layout",
          ),
        ).toHaveLength(1),
      );
      expect(mutationCalls(api.calls)).toHaveLength(1);
      expect(api.persistCompleteBatch).toHaveBeenCalledTimes(1);
      const batchCall = api.calls.find(
        (call) => call.path === "/api/v1/elements/batch-layout",
      )!;
      expect(batchCall.body.mode).toBe("COMPLETE");
      expect(
        (batchCall.body.items as Array<Record<string, unknown>>)[0],
      ).toMatchObject(expected);
      expect(api.entries()[0]!.layout).toMatchObject(expected);
    },
  );

  it("cancels palette drag and selection with Escape without saving", async () => {
    const api = installElementApi({
      entries: [makeEntry("escape-target", "text", { x: 2, y: 2 })],
    });
    installCanvasGeometry();
    render(<Harness />);
    const option = await screen.findByTestId("placed-element-escape-target");

    fireEvent.pointerDown(option);
    expect(option).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(option, { key: "Escape" });
    expect(option).toHaveAttribute("aria-selected", "false");

    const paletteItem = screen.getByTestId("palette-item-button");
    fireEvent.pointerDown(paletteItem, {
      button: 0,
      clientX: 40,
      clientY: 40,
      pointerId: 12,
      isPrimary: true,
    });
    fireEvent.pointerMove(document, {
      clientX: 80,
      clientY: 80,
      pointerId: 12,
      isPrimary: true,
    });
    await screen.findByTestId("palette-drag-overlay");
    fireEvent.pointerMove(document, {
      clientX: 500,
      clientY: 260,
      pointerId: 12,
      isPrimary: true,
    });
    await screen.findByTestId("placement-placeholder");

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() =>
      expect(
        screen.queryByTestId("palette-drag-overlay"),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.queryByTestId("placement-placeholder"),
    ).not.toBeInTheDocument();
    fireEvent.pointerUp(document, {
      clientX: 500,
      clientY: 260,
      pointerId: 12,
      isPrimary: true,
    });
    expect(mutationCalls(api.calls)).toHaveLength(0);
  });

  it("rolls back active RGL drag and resize on Escape without saving", async () => {
    const api = installElementApi({
      entries: [makeEntry("rgl-escape-target", "container", { x: 2, y: 2 })],
    });
    installCanvasGeometry();
    render(<Harness />);
    let option = await screen.findByTestId("placed-element-rgl-escape-target");
    const dragInstance = option;
    const originalTransform = option.style.transform;

    fireEvent.mouseDown(
      within(option).getByRole("button", {
        name: "Container rgl-escape-target 이동",
      }),
      { button: 0, buttons: 1, clientX: 410, clientY: 220 },
    );
    fireEvent.mouseMove(document, {
      buttons: 1,
      clientX: 580,
      clientY: 300,
    });
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.mouseUp(document, { button: 0, clientX: 580, clientY: 300 });
    option = await screen.findByTestId("placed-element-rgl-escape-target");
    expect(option).not.toBe(dragInstance);
    expect(option).not.toHaveClass("react-draggable-dragging");
    expect(option.style.transform).toBe(originalTransform);
    expect(mutationCalls(api.calls)).toHaveLength(0);

    const resizeInstance = option;
    const resizeHandle = screen.getByTestId("resize-handle-se");
    fireEvent.mouseDown(resizeHandle, {
      button: 0,
      buttons: 1,
      clientX: 620,
      clientY: 420,
    });
    fireEvent.mouseMove(document, {
      buttons: 1,
      clientX: 700,
      clientY: 500,
    });
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.mouseUp(document, { button: 0, clientX: 700, clientY: 500 });
    option = await screen.findByTestId("placed-element-rgl-escape-target");
    expect(option).not.toBe(resizeInstance);
    expect(screen.queryByTestId("resize-tooltip")).not.toBeInTheDocument();
    expect(option.style.transform).toBe(originalTransform);
    expect(option).toHaveAttribute("data-w", "12");
    expect(option).toHaveAttribute("data-h", "12");
    expect(mutationCalls(api.calls)).toHaveLength(0);
  });

  it("measures all six palette items and canvas zoom-grid sibling control geometry with getBoundingClientRect", async () => {
    installElementApi();
    installCanvasGeometry();
    const user = userEvent.setup();
    render(<Harness />);
    await screen.findByText("빈 캔버스");
    const zoom = screen.getByRole("combobox", { name: "캔버스 배율" });
    expect(
      within(zoom)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["50%", "75%", "100%", "125%", "150%", "200%"]);
    await user.selectOptions(zoom, "0.5");
    expect(screen.getByTestId("element-canvas")).toHaveAttribute(
      "data-zoom",
      "0.5",
    );
    const grid = screen.getByRole("button", { name: "그리드" });
    fireEvent.click(grid);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "그리드" })).toHaveAttribute(
        "aria-pressed",
        "false",
      ),
    );

    const paletteItems = ELEMENT_DEFINITIONS.map((definition) =>
      screen.getByTestId(`palette-item-${definition.type}`),
    );
    expect(paletteItems).toHaveLength(6);
    expect(new Set(paletteItems.map((item) => item.dataset.size))).toEqual(
      new Set(["default"]),
    );
    const paletteRects = paletteItems.map((item) =>
      rectGeometry(item.getBoundingClientRect()),
    );
    expect(new Set(paletteRects.map(({ width }) => width)).size).toBe(1);
    expect(new Set(paletteRects.map(({ height }) => height)).size).toBe(1);
    expect(paletteRects[0]!.width).toBeGreaterThan(0);
    expect(paletteRects[0]!.height).toBe(
      cssPixels(cssDeclaration(".palette-grid .palette-item", "height")),
    );
    const zoomRect = zoom.closest("label")!.getBoundingClientRect();
    const gridRect = grid.getBoundingClientRect();
    expect({ width: zoomRect.width, height: zoomRect.height }).toEqual({
      width: gridRect.width,
      height: gridRect.height,
    });
    expect(gridRect.top).toBe(zoomRect.top);
    expect(gridRect.left).toBeGreaterThanOrEqual(zoomRect.right);
    expect(zoomRect.width).toBe(
      cssPixels(cssDeclaration(".canvas-zoom-control,", "width")),
    );
    expect(zoomRect.height).toBe(
      cssPixels(cssDeclaration(".canvas-zoom-control,", "height")),
    );
    expect(stylesCss).toMatch(
      /\.palette-grid \.palette-item\s*\{[\s\S]*height:\s*4\.75rem;[\s\S]*min-height:\s*4\.75rem;[\s\S]*padding:\s*0\.65rem;[\s\S]*border-radius:\s*var\(--control-radius\);/,
    );
    expect(stylesCss).toMatch(
      /\.canvas-zoom-control,[\s\S]*\.canvas-grid-toggle\s*\{[\s\S]*height:\s*var\(--control-height\);[\s\S]*min-height:\s*var\(--control-height\);[\s\S]*border-radius:\s*var\(--control-radius\);/,
    );
    expect(stylesCss).toMatch(
      /\.canvas-controls\s*\{[^}]*flex-direction:\s*row;[^}]*flex-wrap:\s*nowrap;/s,
    );
    expect(stylesCss).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.palette-drag-overlay\s*\{[\s\S]*transform:\s*none;[\s\S]*\.placement-placeholder/,
    );
    expect(stylesCss).toMatch(
      /@media \(max-width: 767px\)[\s\S]*\.element-canvas-zoom-shell\s*\{[\s\S]*margin:\s*1\.5rem;/,
    );
  });

  it("shows loading failure and retries the page-specific list", async () => {
    const api = installElementApi({ failFirstList: true });
    installCanvasGeometry();
    const user = userEvent.setup();
    render(<Harness />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("읽기 실패");
    await user.click(within(alert).getByRole("button", { name: "재시도" }));
    expect(await screen.findByText("빈 캔버스")).toBeInTheDocument();
    expect(
      api.calls.filter(
        (call) =>
          call.path === "/api/v1/pages/page-1/elements" &&
          call.method === "GET",
      ),
    ).toHaveLength(2);
  });

  it("sends scroll- and zoom-corrected pointer coordinates", async () => {
    const api = installElementApi();
    installCanvasGeometry();
    const user = userEvent.setup();
    render(<Harness />);
    await screen.findByText("빈 캔버스");
    await user.selectOptions(
      screen.getByRole("combobox", { name: "캔버스 배율" }),
      "2",
    );
    const viewport = screen.getByTestId("element-canvas");
    Object.defineProperty(viewport, "scrollLeft", {
      configurable: true,
      value: 80,
    });
    Object.defineProperty(viewport, "scrollTop", {
      configurable: true,
      value: 48,
    });
    const paletteItem = screen.getByTestId("palette-item-text");
    fireEvent.pointerDown(paletteItem, {
      button: 0,
      clientX: 40,
      clientY: 40,
      pointerId: 8,
      isPrimary: true,
    });
    fireEvent.pointerMove(document, {
      clientX: 80,
      clientY: 80,
      pointerId: 8,
      isPrimary: true,
    });
    await screen.findByTestId("palette-drag-overlay");
    fireEvent.pointerMove(document, {
      clientX: 500,
      clientY: 260,
      pointerId: 8,
      isPrimary: true,
    });
    await waitFor(() =>
      expect(
        api.calls.find((call) => call.path.endsWith("placement-candidates")),
      ).toBeDefined(),
    );
    const candidateCall = api.calls.find((call) =>
      call.path.endsWith("placement-candidates"),
    )!;
    expect(candidateCall.body).toMatchObject({
      canvasWidth: 960,
      canvasHeight: 640,
    });
    expect(candidateCall.body.pointer).toEqual({
      rawCanvasX: 250,
      rawCanvasY: 210,
      correctedCanvasX: 140,
      correctedCanvasY: 104,
    });
    fireEvent.pointerCancel(document, {
      pointerId: 8,
      isPrimary: true,
    });
  });
});
