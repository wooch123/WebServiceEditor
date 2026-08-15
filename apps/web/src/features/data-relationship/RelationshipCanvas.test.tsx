import type {
  DataRelationshipGraphDto,
  RelationshipBindingDto,
  RelationshipHistoryDto,
  RelationshipNodeDto,
  RelationshipPortDto,
} from "@webeditor/domain";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RelationshipCanvas } from "./RelationshipCanvas";

const projectId = "00000000-0000-4000-8000-000000000901";
const pageId = "00000000-0000-4000-8000-000000000902";
const elementId = "00000000-0000-4000-8000-000000000903";
const tableId = "00000000-0000-4000-8000-000000000904";
const fieldId = "00000000-0000-4000-8000-000000000905";
const bindingId = "00000000-0000-4000-8000-000000000906";
const commandId = "00000000-0000-4000-8000-000000000907";
const previewId = "00000000-0000-4000-8000-000000000908";

function port(
  nodeId: string,
  objectId: string,
  role: string,
  label: string,
  direction: "input" | "output",
  allowedBindingTypes: RelationshipPortDto["allowedBindingTypes"],
  index: number,
): RelationshipPortDto {
  return {
    id: `${objectId}:${role}:${direction}:${index}`,
    nodeId,
    objectId,
    role,
    label,
    direction,
    side: direction === "input" ? "left" : "right",
    valueType: direction === "input" ? "records" : "number",
    allowedBindingTypes,
    maxConnections: direction === "input" ? 1 : null,
  };
}

const pageNode: RelationshipNodeDto = {
  id: `page:${pageId}`,
  objectId: pageId,
  type: "page",
  label: "분석",
  subtitle: "/analysis",
  iconName: "FileText",
  x: 40,
  y: 40,
  width: 240,
  height: 128,
  ports: [
    port(
      `page:${pageId}`,
      pageId,
      "navigation",
      "Navigation",
      "input",
      ["NAVIGATE"],
      0,
    ),
    port(
      `page:${pageId}`,
      pageId,
      "contains",
      "Contains",
      "output",
      ["CONTAINS"],
      0,
    ),
  ],
};

const elementNode: RelationshipNodeDto = {
  id: `element:${elementId}`,
  objectId: elementId,
  type: "element",
  label: "표",
  subtitle: "Data Table · 분석",
  iconName: "Table2",
  x: 380,
  y: 40,
  width: 260,
  height: 146,
  ports: [
    port(
      `element:${elementId}`,
      elementId,
      "contains",
      "Page",
      "input",
      ["CONTAINS"],
      0,
    ),
    port(
      `element:${elementId}`,
      elementId,
      "rows",
      "Rows",
      "input",
      ["READ", "FILTER"],
      1,
    ),
  ],
};

const tableNode: RelationshipNodeDto = {
  id: `table:${tableId}`,
  objectId: tableId,
  type: "table",
  label: "측정값",
  subtitle: "t_00000000000000000000000000000000",
  iconName: "Table2",
  x: 760,
  y: 40,
  width: 300,
  height: 146,
  ports: [
    port(
      `table:${tableId}`,
      tableId,
      "record",
      "Record",
      "input",
      ["CREATE", "UPDATE", "DELETE"],
      0,
    ),
    port(
      `table:${tableId}`,
      fieldId,
      `field-${fieldId}`,
      "ID",
      "output",
      ["READ", "RELATION"],
      1,
    ),
  ],
};

function binding(revision = 1): RelationshipBindingDto {
  const source = tableNode.ports[1] as RelationshipPortDto;
  const target = elementNode.ports[1] as RelationshipPortDto;
  return {
    id: bindingId,
    projectId,
    bindingType: "READ",
    source: {
      nodeType: "table",
      nodeId: tableNode.id,
      objectId: source.objectId,
      portId: source.id,
      portRole: source.role,
      direction: "output",
      side: "right",
      valueType: source.valueType,
    },
    target: {
      nodeType: "element",
      nodeId: elementNode.id,
      objectId: target.objectId,
      portId: target.id,
      portRole: target.role,
      direction: "input",
      side: "left",
      valueType: target.valueType,
    },
    query: { source: { objectId: fieldId } },
    mapping: { target: { objectId: elementId } },
    status: "READY",
    revision,
    createdAt: "2026-08-16T00:00:00.000Z",
    updatedAt: "2026-08-16T00:00:00.000Z",
  };
}

function graph(
  edges: readonly RelationshipBindingDto[] = [],
): DataRelationshipGraphDto {
  return {
    schemaVersion: 1,
    projectId,
    graphRevision: edges.length,
    projectRevision: 4 + edges.length,
    nodes: [pageNode, elementNode, tableNode],
    edges,
  };
}

function history(
  currentGraph: DataRelationshipGraphDto,
  undo = false,
): RelationshipHistoryDto {
  return {
    projectId,
    graphRevision: currentGraph.graphRevision,
    projectRevision: currentGraph.projectRevision,
    undo: undo
      ? {
          id: commandId,
          commandType: "CREATE_BINDING",
          bindingId,
          state: "APPLIED",
          createdAt: "2026-08-16T00:00:00.000Z",
        }
      : null,
    redo: null,
  };
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe(target: Element) {
        const callback = (
          this as unknown as { callback?: ResizeObserverCallback }
        ).callback;
        callback?.(
          [
            {
              target,
              contentRect: target.getBoundingClientRect(),
              borderBoxSize: [{ inlineSize: 320, blockSize: 240 }],
              contentBoxSize: [{ inlineSize: 320, blockSize: 240 }],
              devicePixelContentBoxSize: [{ inlineSize: 320, blockSize: 240 }],
            } as ResizeObserverEntry,
          ],
          this as unknown as ResizeObserver,
        );
      }
      unobserve() {}
      disconnect() {}
      constructor(callback: ResizeObserverCallback) {
        (this as unknown as { callback: ResizeObserverCallback }).callback =
          callback;
      }
    },
  );
});

describe("RelationshipCanvas", () => {
  it("renders Page, Element, and Table nodes with strict side/direction ports and equal sibling controls", async () => {
    const current = graph();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/relationship-graph")) return response(current);
        if (url.endsWith("/binding-history")) return response(history(current));
        return response({ error: { code: "NOT_FOUND", message: "없음" } }, 404);
      }),
    );
    render(
      <RelationshipCanvas
        projectId={projectId}
        projectRevision={4}
        onProjectRevisionChange={vi.fn()}
      />,
    );
    expect(await screen.findByText("분석")).toBeInTheDocument();
    expect(screen.getByText("표")).toBeInTheDocument();
    expect(screen.getByText("측정값")).toBeInTheDocument();

    const inputs = document.querySelectorAll(
      '[data-direction="input"][data-side="left"]',
    );
    const outputs = document.querySelectorAll(
      '[data-direction="output"][data-side="right"]',
    );
    expect(inputs.length).toBeGreaterThan(0);
    expect(outputs.length).toBeGreaterThan(0);
    expect(
      document.querySelectorAll('[data-direction="input"][data-side="right"]'),
    ).toHaveLength(0);
    expect(
      document.querySelectorAll('[data-direction="output"][data-side="left"]'),
    ).toHaveLength(0);

    const toolbar = document.querySelector(
      ".relationship-toolbar-actions",
    ) as HTMLElement;
    const controls = within(toolbar).getAllByRole("button");
    expect(controls).toHaveLength(4);
    expect(
      controls.every((control) => control.className === controls[0]?.className),
    ).toBe(true);
  });

  it("creates a visual Edge only from the exact server preview and keeps its Binding record 1:1", async () => {
    let current = graph();
    const calls: Array<{ url: string; method: string; body: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        const body = init?.body ? JSON.parse(String(init.body)) : undefined;
        calls.push({ url, method, body });
        if (url.endsWith("/relationship-graph")) return response(current);
        if (url.endsWith("/binding-history")) {
          return response(history(current, current.edges.length > 0));
        }
        if (url.endsWith("/connections/preview")) {
          return response({
            previewId,
            projectId,
            source: binding().source,
            target: binding().target,
            compatible: true,
            allowedBindingTypes: ["READ"],
            issues: [],
            graphRevision: 0,
            projectRevision: 4,
            expiresAt: "2026-08-16T00:00:15.000Z",
          });
        }
        if (url.endsWith("/bindings") && method === "POST") {
          current = graph([binding()]);
          return response(
            {
              binding: binding(),
              graphRevision: 1,
              projectRevision: 5,
              commandId,
            },
            201,
          );
        }
        return response({ error: { code: "NOT_FOUND", message: "없음" } }, 404);
      }),
    );
    const user = userEvent.setup();
    render(
      <RelationshipCanvas
        projectId={projectId}
        projectRevision={4}
        onProjectRevisionChange={vi.fn()}
      />,
    );
    await screen.findByText("측정값");
    await user.click(screen.getByRole("button", { name: "ID 출력" }));
    await user.click(screen.getByRole("button", { name: "Rows 입력" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/→/)).toHaveTextContent(
      `${binding().source.portRole} → ${binding().target.portRole}`,
    );
    await user.click(within(dialog).getByRole("button", { name: "연결" }));
    expect(
      await screen.findByRole("button", { name: "조회 Binding" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Node 3 · Edge 1/)).toBeInTheDocument();

    const previewCall = calls.find(({ url }) =>
      url.endsWith("/connections/preview"),
    );
    const createCall = calls.find(
      ({ url, method }) => url.endsWith("/bindings") && method === "POST",
    );
    expect(previewCall?.body).toMatchObject({
      sourcePortId: binding().source.portId,
      targetPortId: binding().target.portId,
    });
    expect(createCall?.body).toMatchObject({
      previewId,
      bindingType: "READ",
    });
    expect(createCall?.body).not.toHaveProperty("sourcePortId");
    expect(document.querySelectorAll(".relationship-edge")).toHaveLength(1);
    expect(document.querySelector(".relationship-edge")).toHaveAttribute(
      "data-binding-id",
      bindingId,
    );
  });

  it("deletes the selected Edge and sends Undo through the durable history boundary", async () => {
    let current = graph([binding()]);
    let currentHistory = history(current, true);
    const methods: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        methods.push(`${method} ${url}`);
        if (url.endsWith("/relationship-graph")) return response(current);
        if (url.endsWith("/binding-history")) return response(currentHistory);
        if (url.includes(`/bindings/${bindingId}`) && method === "DELETE") {
          current = { ...graph(), graphRevision: 2, projectRevision: 6 };
          currentHistory = {
            ...history(current),
            undo: {
              id: commandId,
              commandType: "DELETE_BINDING",
              bindingId,
              state: "APPLIED",
              createdAt: "2026-08-16T00:00:00.000Z",
            },
          };
          return response({
            deletedBindingId: bindingId,
            graphRevision: 2,
            projectRevision: 6,
            commandId,
          });
        }
        if (url.endsWith("/binding-history/undo")) {
          current = {
            ...graph([binding(2)]),
            graphRevision: 3,
            projectRevision: 7,
          };
          currentHistory = {
            ...history(current),
            undo: null,
            redo: {
              id: commandId,
              commandType: "DELETE_BINDING",
              bindingId,
              state: "UNDONE",
              createdAt: "2026-08-16T00:00:00.000Z",
            },
          };
          return response({
            projectId,
            graphRevision: 3,
            projectRevision: 7,
            commandId,
            operation: "UNDO",
            binding: binding(2),
          });
        }
        return response({ error: { code: "NOT_FOUND", message: "없음" } }, 404);
      }),
    );
    const user = userEvent.setup();
    render(
      <RelationshipCanvas
        projectId={projectId}
        projectRevision={5}
        onProjectRevisionChange={vi.fn()}
      />,
    );
    const edge = await screen.findByRole("button", { name: "조회 Binding" });
    await user.click(edge);
    await user.click(screen.getByRole("button", { name: "삭제" }));
    const alert = await screen.findByRole("alertdialog");
    await user.click(within(alert).getByRole("button", { name: "삭제" }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "조회 Binding" })).toBeNull(),
    );
    await user.click(screen.getByRole("button", { name: "실행 취소" }));
    expect(
      await screen.findByRole("button", { name: "조회 Binding" }),
    ).toBeInTheDocument();
    expect(
      methods.some((entry) => entry.endsWith("/binding-history/undo")),
    ).toBe(true);
  });
});
