import type {
  DataRelationshipGraphDto,
  RelationshipBindingDto,
  RelationshipHistoryDto,
  RelationshipLayoutHistoryDto,
  RelationshipNodeDto,
  RelationshipPortDto,
} from "@webeditor/domain";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RelationshipCanvas,
  roundedOrthogonalPath,
} from "./RelationshipCanvas";

const projectId = "00000000-0000-4000-8000-000000000901";
const pageId = "00000000-0000-4000-8000-000000000902";
const elementId = "00000000-0000-4000-8000-000000000903";
const tableId = "00000000-0000-4000-8000-000000000904";
const fieldId = "00000000-0000-4000-8000-000000000905";
const bindingId = "00000000-0000-4000-8000-000000000906";
const commandId = "00000000-0000-4000-8000-000000000907";
const previewId = "00000000-0000-4000-8000-000000000908";
const queryPreviewId = "00000000-0000-4000-8000-000000000909";

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
  pinned: false,
  positionRevision: 0,
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
  pinned: false,
  positionRevision: 0,
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
  pinned: false,
  positionRevision: 0,
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
    routes: edges.map((edge) => ({
      bindingId: edge.id,
      points: [
        { x: 1060, y: 116 },
        { x: 1076, y: 116 },
        { x: 1076, y: 146 },
        { x: 364, y: 146 },
        { x: 380, y: 146 },
      ],
      bendCount: 2,
      crossesNode: false,
    })),
    viewport: { x: 0, y: 0, zoom: 1, revision: 0 },
  };
}

function layoutHistory(
  currentGraph: DataRelationshipGraphDto,
): RelationshipLayoutHistoryDto {
  return {
    projectId,
    graphRevision: currentGraph.graphRevision,
    projectRevision: currentGraph.projectRevision,
    undo: null,
    redo: null,
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
    "DOMMatrixReadOnly",
    class {
      readonly m22 = 1;
      constructor(_transform?: string) {}
    },
  );
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
  it("renders server-owned orthogonal points with rounded corners and no Bezier segment", () => {
    const path = roundedOrthogonalPath([
      { x: 0, y: 20 },
      { x: 32, y: 20 },
      { x: 32, y: 80 },
      { x: 96, y: 80 },
    ]);
    expect(path).toBe(
      "M 0 20 L 24 20 Q 32 20 32 28 L 32 72 Q 32 80 40 80 L 96 80",
    );
    expect(path).not.toMatch(/\bC\b/u);
  });

  it("renders Page, Element, and Table nodes with strict side/direction ports and equal sibling controls", async () => {
    const current = graph();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/relationship-graph")) return response(current);
        if (url.endsWith("/relationship-layout-history"))
          return response(layoutHistory(current));
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
    expect(controls).toHaveLength(5);
    expect(
      controls.every((control) => control.className === controls[0]?.className),
    ).toBe(true);
  });

  it("creates a typed Variable and sends only its canonical Data Table selection Navigation dependency", async () => {
    const targetPageId = "00000000-0000-4000-8000-000000000911";
    const variableId = "00000000-0000-4000-8000-000000000912";
    const selectionPort = {
      ...port(
        `element:${elementId}`,
        elementId,
        "selection",
        "Selection",
        "output",
        ["FILTER", "NAVIGATE"],
        2,
      ),
      valueType: "record" as const,
    };
    const sourceNode = {
      ...elementNode,
      ports: [...elementNode.ports, selectionPort],
    };
    const targetPage = {
      ...pageNode,
      id: `page:${targetPageId}`,
      objectId: targetPageId,
      label: "상세",
      subtitle: "/detail",
      ports: [
        port(
          `page:${targetPageId}`,
          targetPageId,
          "navigation",
          "Navigation",
          "input",
          ["NAVIGATE"],
          0,
        ),
      ],
    };
    const sourceRead = {
      ...binding(),
      query: { tableId, spec: { selectFieldIds: [fieldId] } },
    };
    let current: DataRelationshipGraphDto = {
      ...graph([sourceRead]),
      nodes: [pageNode, targetPage, sourceNode, tableNode],
      projectRevision: 4,
    };
    let variableCreated = false;
    const calls: Array<{ url: string; method: string; body: unknown }> = [];
    const variable = {
      id: variableId,
      projectId,
      key: "selected_value",
      name: "선택값",
      valueType: "number",
      scope: "session",
      transport: "URL_QUERY",
      sensitive: false,
      defaultValue: null,
      revision: 1,
      createdAt: "2026-08-16T00:00:00.000Z",
      updatedAt: "2026-08-16T00:00:00.000Z",
    } as const;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        const body = init?.body ? JSON.parse(String(init.body)) : undefined;
        calls.push({ url, method, body });
        if (url.endsWith("/relationship-graph")) return response(current);
        if (url.endsWith("/relationship-layout-history"))
          return response(layoutHistory(current));
        if (url.endsWith("/binding-history")) return response(history(current));
        if (url.endsWith("/variables") && method === "GET") {
          return response({
            schemaVersion: 1,
            projectId,
            projectRevision: current.projectRevision,
            variables: variableCreated ? [variable] : [],
          });
        }
        if (url.endsWith("/variables") && method === "POST") {
          variableCreated = true;
          current = { ...current, projectRevision: 5 };
          return response(
            { variable, projectRevision: 5, commandId: "variable-command" },
            201,
          );
        }
        if (url.endsWith("/schema")) {
          return response({
            schemaVersion: 1,
            projectId,
            schemaRevision: 1,
            projectRevision: current.projectRevision,
            tables: [
              {
                id: tableId,
                fields: [{ id: fieldId, displayName: "ID", type: "INTEGER" }],
              },
            ],
          });
        }
        if (url.endsWith("/connections/preview")) {
          return response({
            previewId,
            projectId,
            source: {
              nodeType: "element",
              nodeId: sourceNode.id,
              objectId: elementId,
              portId: selectionPort.id,
              portRole: "selection",
              direction: "output",
              side: "right",
              valueType: "record",
            },
            target: {
              nodeType: "page",
              nodeId: targetPage.id,
              objectId: targetPageId,
              portId: targetPage.ports[0]?.id,
              portRole: "navigation",
              direction: "input",
              side: "left",
              valueType: "page",
            },
            compatible: true,
            allowedBindingTypes: ["NAVIGATE"],
            issues: [],
            graphRevision: 1,
            projectRevision: 5,
            expiresAt: "2026-08-16T00:00:15.000Z",
          });
        }
        if (url.endsWith("/bindings") && method === "POST") {
          return response(
            {
              binding: { ...sourceRead, id: "navigation-binding" },
              graphRevision: 2,
              projectRevision: 6,
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
    const toolbar = document.querySelector(
      ".relationship-toolbar-actions",
    ) as HTMLElement;
    await user.click(within(toolbar).getByRole("button", { name: "변수" }));
    const variableDialog = screen.getByRole("dialog", { name: "변수" });
    await user.clear(within(variableDialog).getByLabelText("이름"));
    await user.type(within(variableDialog).getByLabelText("이름"), "선택값");
    await user.click(
      within(variableDialog).getByRole("button", { name: "추가" }),
    );
    await waitFor(() => expect(variableCreated).toBe(true));

    await user.click(screen.getByRole("button", { name: "Selection 출력" }));
    await user.click(
      screen.getAllByRole("button", { name: "Navigation 입력" })[1]!,
    );
    const bindingDialog = await screen.findByRole("dialog", { name: "연결" });
    await waitFor(() => {
      expect(within(bindingDialog).getByLabelText("변수")).toHaveValue(
        variableId,
      );
      expect(within(bindingDialog).getByLabelText("선택 필드")).toHaveValue(
        fieldId,
      );
    });
    expect(within(bindingDialog).getByDisplayValue("상세")).toHaveAttribute(
      "readonly",
    );
    await user.click(
      within(bindingDialog).getByRole("button", { name: "연결" }),
    );
    const variableCall = calls.find(
      ({ url, method }) => url.endsWith("/variables") && method === "POST",
    );
    expect(variableCall?.body).toMatchObject({
      key: "selected_value",
      name: "선택값",
      valueType: "number",
      transport: "URL_QUERY",
    });
    const bindingCall = calls.find(
      ({ url, method }) => url.endsWith("/bindings") && method === "POST",
    );
    expect(bindingCall?.body).toMatchObject({
      previewId,
      bindingType: "NAVIGATE",
      dependency: {
        kind: "NAVIGATE",
        variableId,
        sourceFieldId: fieldId,
        targetPageId,
        transport: "URL_QUERY",
      },
    });
    expect(bindingCall?.body).not.toHaveProperty("value");
    expect(bindingCall?.body).not.toHaveProperty("route");
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
        if (url.endsWith("/relationship-layout-history"))
          return response(layoutHistory(current));
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
        if (url.endsWith("/binding-query-previews")) {
          return response({
            queryPreviewId,
            connectionPreviewId: previewId,
            projectId,
            sourceTableId: tableId,
            targetElementId: elementId,
            spec: {
              mode: "LIST",
              selectFieldIds: [fieldId],
              filters: [],
              orderBy: [],
              aggregate: null,
              groupByFieldId: null,
              limit: 100,
            },
            mapping: {
              shape: "ROWS",
              labelFieldId: null,
              valueFieldId: null,
              secondaryFieldId: null,
            },
            result: {
              columns: [{ fieldId, label: "ID", valueType: "INTEGER" }],
              rows: [{ [fieldId]: 1 }],
              rowCount: 1,
              truncated: false,
              renderState: "DATA",
              renderData: { columns: ["ID"], rows: [{ ID: 1 }] },
            },
            planChecksum: "a".repeat(64),
            graphRevision: 0,
            projectRevision: 4,
            expiresAt: "2026-08-16T00:00:15.000Z",
          });
        }
        if (url.endsWith("/sample-data/generate")) {
          return response({
            projectId,
            tableCount: 1,
            rowCount: 24,
            databaseChecksum: "b".repeat(64),
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
    const queryActions = within(dialog).getByRole("group", {
      name: "조회 도구",
    });
    const siblingActions = within(queryActions).getAllByRole("button");
    expect(siblingActions).toHaveLength(2);
    expect(siblingActions[0]?.className).toBe(siblingActions[1]?.className);
    expect(within(dialog).getByRole("button", { name: "연결" })).toBeDisabled();
    await user.click(within(dialog).getByRole("button", { name: "샘플" }));
    await user.click(within(dialog).getByRole("button", { name: "미리보기" }));
    expect(await within(dialog).findByText("1행")).toBeInTheDocument();
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
    const sampleCall = calls.find(({ url }) =>
      url.endsWith("/sample-data/generate"),
    );
    const queryCall = calls.find(({ url }) =>
      url.endsWith("/binding-query-previews"),
    );
    expect(previewCall?.body).toMatchObject({
      sourcePortId: binding().source.portId,
      targetPortId: binding().target.portId,
    });
    expect(createCall?.body).toMatchObject({
      previewId,
      bindingType: "READ",
      queryPreviewId,
    });
    expect(createCall?.body).not.toHaveProperty("sourcePortId");
    expect(createCall?.body).not.toHaveProperty("sql");
    expect(sampleCall?.body).toMatchObject({ rowCount: 24, reset: true });
    expect(queryCall?.body).toMatchObject({
      spec: {
        mode: "LIST",
        selectFieldIds: [fieldId],
        filters: [],
        orderBy: [],
        aggregate: null,
        limit: 100,
      },
      mapping: {
        shape: "ROWS",
        valueFieldId: null,
      },
    });
    expect(queryCall?.body).not.toHaveProperty("sql");
    expect(document.querySelectorAll(".relationship-edge")).toHaveLength(1);
    expect(document.querySelector(".relationship-edge")).toHaveAttribute(
      "data-binding-id",
      bindingId,
    );
  });

  it("maps Number Inputs to logical Table fields for a CREATE Binding", async () => {
    const buttonId = "00000000-0000-4000-8000-000000000910";
    const inputId = "00000000-0000-4000-8000-000000000911";
    const valueFieldId = "00000000-0000-4000-8000-000000000912";
    const buttonNode: RelationshipNodeDto = {
      ...elementNode,
      id: `element:${buttonId}`,
      objectId: buttonId,
      label: "저장",
      subtitle: "Button · 분석",
      ports: [
        elementNode.ports[0] as RelationshipPortDto,
        {
          id: `${buttonId}:click:output:1`,
          nodeId: `element:${buttonId}`,
          objectId: buttonId,
          role: "click",
          label: "Submit",
          direction: "output",
          side: "right",
          valueType: "event",
          allowedBindingTypes: ["CREATE", "UPDATE", "DELETE"],
          maxConnections: null,
        },
      ],
    };
    const inputNode: RelationshipNodeDto = {
      ...elementNode,
      id: `element:${inputId}`,
      objectId: inputId,
      label: "값 입력",
      subtitle: "Number Input · 분석",
      ports: [],
    };
    const writeGraph: DataRelationshipGraphDto = {
      ...graph(),
      nodes: [pageNode, buttonNode, inputNode, tableNode],
    };
    const sourcePort = buttonNode.ports[1] as RelationshipPortDto;
    const targetPort = tableNode.ports[0] as RelationshipPortDto;
    const endpoint = (portValue: RelationshipPortDto) => ({
      nodeType: portValue.nodeId.startsWith("table:")
        ? ("table" as const)
        : ("element" as const),
      nodeId: portValue.nodeId,
      objectId: portValue.objectId,
      portId: portValue.id,
      portRole: portValue.role,
      direction: portValue.direction,
      side: portValue.side,
      valueType: portValue.valueType,
    });
    const createBinding: RelationshipBindingDto = {
      ...binding(),
      id: "00000000-0000-4000-8000-000000000913",
      bindingType: "CREATE",
      source: endpoint(sourcePort),
      target: endpoint(targetPort),
      query: {
        schemaVersion: 1,
        operation: "CREATE",
        tableId,
        primaryKeyFieldId: fieldId,
      },
      mapping: {
        fields: [{ fieldId: valueFieldId, inputElementId: inputId }],
      },
    };
    const calls: Array<{ url: string; method: string; body: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        const body = init?.body ? JSON.parse(String(init.body)) : undefined;
        calls.push({ url, method, body });
        if (url.endsWith("/relationship-graph")) return response(writeGraph);
        if (url.endsWith("/relationship-layout-history"))
          return response(layoutHistory(writeGraph));
        if (url.endsWith("/binding-history"))
          return response(history(writeGraph));
        if (url.endsWith("/connections/preview")) {
          return response({
            previewId,
            projectId,
            source: endpoint(sourcePort),
            target: endpoint(targetPort),
            compatible: true,
            allowedBindingTypes: ["CREATE", "UPDATE", "DELETE"],
            issues: [],
            graphRevision: 0,
            projectRevision: 4,
            expiresAt: "2026-08-16T00:00:15.000Z",
          });
        }
        if (url.endsWith("/schema")) {
          return response({
            schemaVersion: 1,
            projectId,
            schemaRevision: 2,
            projectRevision: 4,
            tables: [
              {
                id: tableId,
                projectId,
                displayName: "측정값",
                physicalName: "measurements",
                description: null,
                revision: 2,
                rowCount: 0,
                createdAt: "2026-08-16T00:00:00.000Z",
                updatedAt: "2026-08-16T00:00:00.000Z",
                fields: [
                  {
                    id: fieldId,
                    projectId,
                    tableId,
                    displayName: "ID",
                    physicalName: "id",
                    type: "INTEGER",
                    primaryKey: true,
                    autoIncrement: true,
                    nullable: false,
                    unique: true,
                    defaultValue: null,
                    indexed: true,
                    unit: null,
                    description: null,
                    sortOrder: 0,
                    revision: 1,
                    createdAt: "2026-08-16T00:00:00.000Z",
                    updatedAt: "2026-08-16T00:00:00.000Z",
                  },
                  {
                    id: valueFieldId,
                    projectId,
                    tableId,
                    displayName: "값",
                    physicalName: "value",
                    type: "REAL",
                    primaryKey: false,
                    autoIncrement: false,
                    nullable: false,
                    unique: false,
                    defaultValue: null,
                    indexed: false,
                    unit: null,
                    description: null,
                    sortOrder: 1,
                    revision: 1,
                    createdAt: "2026-08-16T00:00:00.000Z",
                    updatedAt: "2026-08-16T00:00:00.000Z",
                  },
                ],
              },
            ],
            relations: [],
            runtime: {
              test: {
                environment: "test",
                appliedRevision: 2,
                schemaChecksum: "a".repeat(64),
                drift: false,
                integrity: "ok",
              },
              production: {
                environment: "production",
                appliedRevision: 2,
                schemaChecksum: "a".repeat(64),
                drift: false,
                integrity: "ok",
              },
            },
          });
        }
        if (url.endsWith("/bindings") && method === "POST") {
          return response(
            {
              binding: createBinding,
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
    await screen.findByText("저장");
    await user.click(screen.getByRole("button", { name: "Submit 출력" }));
    await user.click(screen.getByRole("button", { name: "Record 입력" }));
    const dialog = await screen.findByRole("dialog", { name: "연결" });
    expect(await within(dialog).findByLabelText("값")).toHaveValue(inputId);
    await user.click(within(dialog).getByRole("button", { name: "연결" }));
    const createCall = calls.find(
      ({ url, method }) => url.endsWith("/bindings") && method === "POST",
    );
    expect(createCall?.body).toMatchObject({
      bindingType: "CREATE",
      mutation: {
        fieldMappings: [{ fieldId: valueFieldId, inputElementId: inputId }],
      },
    });
    expect(createCall?.body).not.toHaveProperty("tableName");
    expect(createCall?.body).not.toHaveProperty("sql");
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
        if (url.endsWith("/relationship-layout-history"))
          return response(layoutHistory(current));
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
    expect(screen.queryByLabelText("선택 Binding")).not.toBeInTheDocument();
    const edge = await screen.findByRole("button", { name: "조회 Binding" });
    await user.click(edge);
    const selection = screen.getByLabelText("선택 Binding");
    expect(selection).toBeInTheDocument();
    await user.click(within(selection).getByRole("button", { name: "닫기" }));
    expect(screen.queryByLabelText("선택 Binding")).not.toBeInTheDocument();
    await user.click(edge);
    await user.click(screen.getByRole("button", { name: "삭제" }));
    const alert = await screen.findByRole("alertdialog");
    await user.click(within(alert).getByRole("button", { name: "삭제" }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "조회 Binding" })).toBeNull(),
    );
    await user.click(screen.getByRole("button", { name: "연결 취소" }));
    expect(
      await screen.findByRole("button", { name: "조회 Binding" }),
    ).toBeInTheDocument();
    expect(
      methods.some((entry) => entry.endsWith("/binding-history/undo")),
    ).toBe(true);
  });

  it("previews and applies one server-owned Auto Layout snapshot, then exposes one durable Undo command", async () => {
    const previewPositions = [
      { ...pageNode, x: 40, y: 40, pinned: true, positionRevision: 1 },
      { ...elementNode, x: 420, y: 40, positionRevision: 1 },
      { ...tableNode, x: 820, y: 40, positionRevision: 1 },
    ].map((node) => ({
      nodeId: node.id,
      nodeType: node.type,
      objectId: node.objectId,
      x: node.x,
      y: node.y,
      pinned: node.pinned,
      revision: node.positionRevision,
    }));
    let current: DataRelationshipGraphDto = graph([binding()]);
    let currentLayoutHistory = layoutHistory(current);
    const calls: Array<{ url: string; method: string; body: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        const body = init?.body ? JSON.parse(String(init.body)) : undefined;
        calls.push({ url, method, body });
        if (url.endsWith("/relationship-graph")) return response(current);
        if (url.endsWith("/relationship-layout-history"))
          return response(currentLayoutHistory);
        if (url.endsWith("/binding-history"))
          return response(history(current, true));
        if (url.endsWith("/auto-layout") && method === "POST") {
          const action = (body as { action?: string }).action;
          if (action === "PREVIEW") {
            return response({
              action: "PREVIEW",
              previewId,
              projectId,
              positions: previewPositions,
              routes: current.routes,
              crossingCountBefore: 1,
              crossingCountAfter: 0,
              graphRevision: 1,
              projectRevision: 5,
              expiresAt: "2026-08-16T00:00:15.000Z",
            });
          }
          current = {
            ...current,
            graphRevision: 2,
            projectRevision: 6,
            nodes: current.nodes.map((node) => {
              const position = previewPositions.find(
                ({ nodeId }) => nodeId === node.id,
              );
              return position === undefined
                ? node
                : {
                    ...node,
                    x: position.x,
                    y: position.y,
                    pinned: position.pinned,
                    positionRevision: position.revision,
                  };
            }),
          };
          currentLayoutHistory = {
            projectId,
            graphRevision: 2,
            projectRevision: 6,
            undo: {
              id: commandId,
              commandType: "AUTO_LAYOUT",
              state: "APPLIED",
              createdAt: "2026-08-16T00:00:00.000Z",
            },
            redo: null,
          };
          return response({
            action: "APPLY",
            projectId,
            positions: previewPositions,
            routes: current.routes,
            graphRevision: 2,
            projectRevision: 6,
            commandId,
          });
        }
        return response({ error: { code: "NOT_FOUND", message: "없음" } }, 404);
      }),
    );
    const onProjectRevisionChange = vi.fn();
    const user = userEvent.setup();
    render(
      <RelationshipCanvas
        projectId={projectId}
        projectRevision={5}
        onProjectRevisionChange={onProjectRevisionChange}
      />,
    );
    await screen.findByText("측정값");
    const layoutToolbar = screen.getByRole("group", { name: "위치 도구" });
    const layoutControls = within(layoutToolbar).getAllByRole("button");
    expect(layoutControls).toHaveLength(4);
    expect(
      layoutControls.every(
        (control) => control.className === layoutControls[0]?.className,
      ),
    ).toBe(true);

    await user.click(
      within(layoutToolbar).getByRole("button", { name: "자동 배치" }),
    );
    const dialog = await screen.findByRole("dialog", { name: "자동 배치" });
    expect(within(dialog).getByText("교차 1 → 0")).toBeInTheDocument();
    expect(within(dialog).getAllByText(/분석|표|측정값/u)).toHaveLength(3);
    const dialogActions = within(dialog).getAllByRole("button", {
      name: /취소|적용/u,
    });
    expect(dialogActions).toHaveLength(2);
    expect(dialogActions[0]).toHaveAttribute("data-size", "default");
    expect(dialogActions[1]).toHaveAttribute("data-size", "default");
    await user.click(within(dialog).getByRole("button", { name: "적용" }));
    await waitFor(() =>
      expect(
        within(layoutToolbar).getByRole("button", { name: "위치 취소" }),
      ).toBeEnabled(),
    );
    const applyCall = calls.find(
      ({ url, body }) =>
        url.endsWith("/auto-layout") &&
        (body as { action?: string }).action === "APPLY",
    );
    expect(applyCall?.body).toMatchObject({
      action: "APPLY",
      previewId,
      expectedGraphRevision: 1,
      expectedProjectRevision: 5,
    });
    expect(applyCall?.body).not.toHaveProperty("positions");
    expect(onProjectRevisionChange).toHaveBeenCalledWith(6);
  });

  it("persists pin state through the node-position command without changing coordinates", async () => {
    let current = graph();
    let releasePositionResponse: (() => void) | undefined;
    const calls: Array<{ url: string; method: string; body: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        const body = init?.body ? JSON.parse(String(init.body)) : undefined;
        calls.push({ url, method, body });
        if (url.endsWith("/relationship-graph")) return response(current);
        if (url.endsWith("/relationship-layout-history"))
          return response(layoutHistory(current));
        if (url.endsWith("/binding-history")) return response(history(current));
        if (
          url.endsWith(
            `/relationship-nodes/${encodeURIComponent(pageNode.id)}`,
          ) &&
          method === "PATCH"
        ) {
          const nextPage = {
            ...pageNode,
            pinned: true,
            positionRevision: 1,
          };
          current = {
            ...current,
            graphRevision: 1,
            projectRevision: 5,
            nodes: [nextPage, elementNode, tableNode],
          };
          await new Promise<void>((resolve) => {
            releasePositionResponse = resolve;
          });
          return response({
            position: {
              nodeId: nextPage.id,
              nodeType: nextPage.type,
              objectId: nextPage.objectId,
              x: nextPage.x,
              y: nextPage.y,
              pinned: true,
              revision: 1,
            },
            routes: [],
            graphRevision: 1,
            projectRevision: 5,
            commandId,
          });
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
    const pin = (
      await screen.findAllByRole("button", { name: "고정" })
    )[0] as HTMLElement;
    await user.click(pin);
    await waitFor(() => expect(releasePositionResponse).toBeDefined());
    expect(screen.getByRole("button", { name: "새로고침" })).toBeEnabled();
    expect(
      calls.filter(({ url }) => url.endsWith("/relationship-graph")),
    ).toHaveLength(1);
    releasePositionResponse?.();
    expect(
      await screen.findByRole("button", { name: "고정 해제" }),
    ).toHaveAttribute("aria-pressed", "true");
    const moveCall = calls.find(
      ({ url, method }) =>
        url.endsWith(
          `/relationship-nodes/${encodeURIComponent(pageNode.id)}`,
        ) && method === "PATCH",
    );
    expect(moveCall?.body).toMatchObject({
      x: pageNode.x,
      y: pageNode.y,
      pinned: true,
      expectedPositionRevision: 0,
      expectedGraphRevision: 0,
      expectedProjectRevision: 4,
    });
    expect(
      calls.filter(({ url }) => url.endsWith("/relationship-graph")),
    ).toHaveLength(1);
  });
});
