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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ELEMENT_DEFINITIONS,
  ELEMENT_PROPERTY_TABS,
  type ElementDefinition,
  type ElementEntryDto,
  type ElementPropertyField,
  type ElementPropertyValue,
  type ElementType,
} from "@webeditor/domain";

import stylesCss from "@/styles.css?raw";
import { RuntimeElementRenderer } from "@/features/runtime/RuntimeElementRenderer";
import { ElementCanvas } from "./ElementCanvas";
import {
  ElementHistoryControls,
  ElementPropertyInspector,
} from "./ElementPropertyInspector";
import {
  ElementWorkspaceProvider,
  WorkspaceElementPalette,
  useElementWorkspace,
} from "./ElementWorkspace";

interface ApiCall {
  path: string;
  method: string;
  body: Record<string, unknown>;
}

interface InspectorApiOptions {
  pageOneEntries?: ElementEntryDto[];
  pageTwoEntries?: ElementEntryDto[];
  definitions?: readonly ElementDefinition[];
  deferFirstProperty?: boolean;
  failFirstProperty?: boolean;
  historyMutationPageId?: string;
}

function definitionFor(type: ElementType) {
  return ELEMENT_DEFINITIONS.find((definition) => definition.type === type)!;
}

function makeEntry(
  id: string,
  type: ElementType = "text",
  pageId = "page-1",
  overrides: {
    name?: string;
    props?: Readonly<Record<string, unknown>>;
    style?: Readonly<Record<string, unknown>>;
    hidden?: boolean;
    locked?: boolean;
    revision?: number;
  } = {},
): ElementEntryDto {
  const definition = definitionFor(type);
  return {
    element: {
      id,
      projectId: "project-1",
      pageId,
      type,
      typeVersion: 1,
      name: overrides.name ?? `${definition.defaultName} ${id}`,
      props: { ...definition.defaultProps, ...overrides.props },
      style: { ...definition.defaultStyle, ...overrides.style },
      events: definition.defaultEvents,
      locked: overrides.locked ?? false,
      hidden: overrides.hidden ?? false,
      revision: overrides.revision ?? 1,
    },
    layout: {
      elementId: id,
      breakpoint: "desktop",
      x: 0,
      y: 0,
      w: definition.layout.defaultW,
      h: definition.layout.defaultH,
      minW: definition.layout.minW,
      minH: definition.layout.minH,
      maxW: definition.layout.maxW,
      maxH: definition.layout.maxH,
    },
  };
}

function response(payload: unknown, status = 200) {
  return Response.json(payload, { status });
}

function propertyKey(fieldId: string) {
  return fieldId.slice(fieldId.indexOf(".") + 1);
}

function propertyValues(entry: ElementEntryDto, definition: ElementDefinition) {
  const values: Record<string, ElementPropertyValue> = {};
  const props = { ...definition.defaultProps, ...entry.element.props };
  const style = { ...definition.defaultStyle, ...entry.element.style };
  for (const field of definition.propertySchema.fields) {
    const key = propertyKey(field.id);
    if (field.id === "general.displayName")
      values[field.id] = entry.element.name;
    else if (field.id === "general.elementId")
      values[field.id] = entry.element.id;
    else if (field.id === "general.visible")
      values[field.id] = !entry.element.hidden;
    else if (field.id === "general.locked")
      values[field.id] = entry.element.locked;
    else if (field.id === "style.width") values[field.id] = entry.layout.w;
    else if (field.id === "style.height") values[field.id] = entry.layout.h;
    else if (field.id === "data.bindingStatus") {
      values[field.id] = definition.bindingPorts.length
        ? "UNCONNECTED"
        : "NOT_APPLICABLE";
    } else if (field.id === "interaction.supportedEvents") {
      values[field.id] = definition.events.map((event) => event.id).join(", ");
    } else if (field.id === "validation.status") {
      values[field.id] = definition.bindingPorts.length ? "WARNING" : "PASS";
    } else if (field.id === "advanced.type") values[field.id] = definition.type;
    else if (field.id === "advanced.typeVersion") values[field.id] = 1;
    else if (field.target === "props") {
      values[field.id] = (props[key] ?? null) as ElementPropertyValue;
    } else if (field.target === "style") {
      values[field.id] = (style[key] ?? null) as ElementPropertyValue;
    } else values[field.id] = null;
  }
  return values;
}

function applyPropertyValues(
  entry: ElementEntryDto,
  definition: ElementDefinition,
  values: Readonly<Record<string, ElementPropertyValue>>,
): ElementEntryDto {
  let name = entry.element.name;
  let hidden = entry.element.hidden;
  let locked = entry.element.locked;
  const props = { ...entry.element.props };
  const style = { ...entry.element.style };
  for (const [fieldId, value] of Object.entries(values)) {
    const field = definition.propertySchema.fields.find(
      (candidate) => candidate.id === fieldId,
    );
    if (!field) continue;
    if (fieldId === "general.displayName" && typeof value === "string")
      name = value;
    else if (fieldId === "general.visible" && typeof value === "boolean")
      hidden = !value;
    else if (fieldId === "general.locked" && typeof value === "boolean")
      locked = value;
    else if (field.target === "props") props[propertyKey(fieldId)] = value;
    else if (field.target === "style") style[propertyKey(fieldId)] = value;
  }
  return {
    ...entry,
    element: {
      ...entry.element,
      name,
      hidden,
      locked,
      props,
      style,
      revision: entry.element.revision + 1,
    },
  };
}

function command(
  id: string,
  pageId: string,
  state: "APPLIED" | "UNDONE",
  sequence: number,
) {
  return {
    id,
    pageId,
    elementId: "element-a",
    type: "PROPERTIES",
    state,
    sequence,
    createdAt: "2026-08-16T00:00:00Z",
  };
}

function installInspectorApi(options: InspectorApiOptions = {}) {
  const definitions = options.definitions ?? ELEMENT_DEFINITIONS;
  const entriesByPage = new Map<string, ElementEntryDto[]>([
    [
      "page-1",
      options.pageOneEntries ?? [makeEntry("element-a", "text", "page-1")],
    ],
    [
      "page-2",
      options.pageTwoEntries ?? [makeEntry("element-b", "text", "page-2")],
    ],
  ]);
  const layoutRevisions = new Map([
    ["page-1", 4],
    ["page-2", 8],
  ]);
  let projectRevision = 10;
  let propertyAttempt = 0;
  let releaseFirstProperty: (() => void) | null = null;
  const calls: ApiCall[] = [];
  const propertyCalls: ApiCall[] = [];
  const historyMutationCalls: ApiCall[] = [];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const path = new URL(String(input), "http://local").pathname;
      const method = init.method?.toUpperCase() ?? "GET";
      const body =
        typeof init.body === "string"
          ? (JSON.parse(init.body) as Record<string, unknown>)
          : {};
      const call = { path, method, body };
      calls.push(call);

      if (path === "/api/v1/elements/registry" && method === "GET") {
        return response({
          schemaVersion: 1,
          tabs: ELEMENT_PROPERTY_TABS,
          definitions,
          checksum: "inspector-test-registry",
        });
      }

      const listMatch = path.match(/^\/api\/v1\/pages\/(page-[12])\/elements$/);
      if (listMatch && method === "GET") {
        const pageId = listMatch[1]!;
        return response({
          pageId,
          breakpoint: "desktop",
          layoutRevision: layoutRevisions.get(pageId),
          projectRevision,
          elements: entriesByPage.get(pageId) ?? [],
        });
      }

      if (
        path === "/api/v1/projects/project-1/element-history" &&
        method === "GET"
      ) {
        const undoCommand = command("undo-1", "page-1", "APPLIED", 2);
        const redoCommand = command("redo-1", "page-1", "UNDONE", 1);
        return response({
          projectId: "project-1",
          canUndo: true,
          canRedo: true,
          undoCommand,
          redoCommand,
          commands: [undoCommand, redoCommand],
        });
      }

      const historyMatch = path.match(
        /^\/api\/v1\/projects\/project-1\/element-history\/(undo|redo)$/,
      );
      if (historyMatch && method === "POST") {
        historyMutationCalls.push(call);
        const pageId = options.historyMutationPageId ?? "page-1";
        projectRevision += 1;
        const layoutRevision = (layoutRevisions.get(pageId) ?? 0) + 1;
        layoutRevisions.set(pageId, layoutRevision);
        return response({
          operation: historyMatch[1] === "undo" ? "UNDO" : "REDO",
          commandId: String(body.expectedCommandId),
          pageId,
          entries: [],
          deletedElementIds: [],
          layoutRevision,
          projectRevision,
          canUndo: true,
          canRedo: true,
        });
      }

      const elementMatch = path.match(/^\/api\/v1\/elements\/([^/]+)$/);
      if (elementMatch && method === "GET") {
        const entry = [...entriesByPage.values()]
          .flat()
          .find((candidate) => candidate.element.id === elementMatch[1]);
        const definition = definitions.find(
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
          propertyValues: propertyValues(entry, definition),
          bindingStatus:
            ports.length > 0
              ? { status: "UNCONNECTED", ports, message: "미연결" }
              : { status: "NOT_APPLICABLE", ports, message: "해당 없음" },
          renderState: {
            state: ports.length > 0 ? "EMPTY" : "DATA",
            message: ports.length > 0 ? "미연결" : null,
          },
        });
      }

      if (elementMatch && method === "PATCH") {
        const change = body.change as {
          kind?: string;
          values?: Record<string, ElementPropertyValue>;
        };
        if (change.kind !== "PROPERTIES" || !change.values) {
          return response(
            { error: { code: "UNEXPECTED_MUTATION", message: "예상 밖 변경" } },
            500,
          );
        }
        propertyCalls.push(call);
        propertyAttempt += 1;
        if (options.failFirstProperty && propertyAttempt === 1) {
          return response(
            { error: { code: "SAVE_FAILED", message: "저장 실패" } },
            500,
          );
        }
        if (options.deferFirstProperty && propertyAttempt === 1) {
          await new Promise<void>((resolveDeferred) => {
            releaseFirstProperty = resolveDeferred;
          });
        }
        const located = [...entriesByPage.entries()].find(([, entries]) =>
          entries.some((entry) => entry.element.id === elementMatch[1]),
        );
        if (!located) {
          return response(
            { error: { code: "ELEMENT_NOT_FOUND", message: "요소 없음" } },
            404,
          );
        }
        const [pageId, entries] = located;
        const index = entries.findIndex(
          (entry) => entry.element.id === elementMatch[1],
        );
        const entry = entries[index]!;
        if (
          body.expectedRevision !== entry.element.revision ||
          body.expectedLayoutRevision !== layoutRevisions.get(pageId) ||
          body.expectedProjectRevision !== projectRevision
        ) {
          return response(
            { error: { code: "REVISION_CONFLICT", message: "리비전 충돌" } },
            409,
          );
        }
        const definition = definitions.find(
          (candidate) => candidate.type === entry.element.type,
        )!;
        const nextEntry = applyPropertyValues(entry, definition, change.values);
        entriesByPage.set(pageId, [
          ...entries.slice(0, index),
          nextEntry,
          ...entries.slice(index + 1),
        ]);
        projectRevision += 1;
        return response({
          entry: nextEntry,
          layoutRevision: layoutRevisions.get(pageId),
          projectRevision,
          commandId: `property-${propertyAttempt}`,
        });
      }

      return response(
        { error: { code: "UNHANDLED", message: `${method} ${path}` } },
        500,
      );
    }),
  );

  return {
    calls,
    propertyCalls,
    historyMutationCalls,
    releaseFirstProperty() {
      releaseFirstProperty?.();
    },
  };
}

function WorkspaceContents({
  onPageChange,
}: {
  onPageChange: (pageId: string) => void;
}) {
  const workspace = useElementWorkspace();
  return (
    <>
      <WorkspaceElementPalette />
      <nav aria-label="테스트 엘리먼트">
        {workspace.entries.map((entry) => (
          <button
            key={entry.element.id}
            type="button"
            onClick={() => workspace.selectElement(entry.element.id, false)}
          >
            {entry.element.id} 선택
          </button>
        ))}
      </nav>
      <button type="button" onClick={() => onPageChange("page-1")}>
        Page 1
      </button>
      <button type="button" onClick={() => onPageChange("page-2")}>
        Page 2
      </button>
      <ElementHistoryControls />
      <ElementPropertyInspector />
      <output aria-label="현재 엘리먼트">
        {workspace.entries.map((entry) => entry.element.id).join(",")}
      </output>
      <output aria-label="선택 엘리먼트">
        {[...workspace.selectedElementIds].join(",")}
      </output>
    </>
  );
}

function RegistryProbeContents() {
  return (
    <>
      <WorkspaceElementPalette />
      <ElementCanvas />
      <ElementPropertyInspector />
    </>
  );
}

function RegistryProbeHarness() {
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
        setLayoutRevision((current) => Math.max(current, revision))
      }
    >
      <RegistryProbeContents />
    </ElementWorkspaceProvider>
  );
}

function Harness({
  onLayoutRevisionChange = () => undefined,
}: {
  onLayoutRevisionChange?: (pageId: string, revision: number) => void;
}) {
  const [pageId, setPageId] = useState("page-1");
  const [projectRevision, setProjectRevision] = useState(10);
  const [layoutRevisions, setLayoutRevisions] = useState<
    Record<string, number>
  >({
    "page-1": 4,
    "page-2": 8,
  });
  return (
    <ElementWorkspaceProvider
      projectId="project-1"
      pageId={pageId}
      projectRevision={projectRevision}
      layoutRevision={layoutRevisions[pageId] ?? 0}
      onProjectRevisionChange={setProjectRevision}
      onLayoutRevisionChange={(changedPageId, revision) => {
        onLayoutRevisionChange(changedPageId, revision);
        setLayoutRevisions((current) => ({
          ...current,
          [changedPageId]: Math.max(current[changedPageId] ?? 0, revision),
        }));
      }}
    >
      <WorkspaceContents onPageChange={setPageId} />
      <output aria-label="현재 페이지">{pageId}</output>
      <output aria-label="프로젝트 리비전">{projectRevision}</output>
      <output aria-label="현재 레이아웃 리비전">
        {layoutRevisions[pageId] ?? 0}
      </output>
    </ElementWorkspaceProvider>
  );
}

beforeEach(() => {
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
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Phase 6 property inspector", () => {
  it("renders color, icon, Page, Field, and Binding controls from injected schema vocabulary", async () => {
    const base = definitionFor("text");
    const referenceFields: ElementPropertyField[] = [
      {
        id: "advanced.icon",
        tab: "advanced",
        label: "Icon",
        control: "icon",
        valueType: "string",
        target: "props",
        required: false,
        readOnly: false,
      },
      ...(["field-ref", "page-ref", "binding-ref"] as const).map(
        (control): ElementPropertyField => ({
          id: `advanced.${control}`,
          tab: "advanced",
          label: control,
          control,
          valueType: "string",
          target: "props",
          required: false,
          readOnly: false,
        }),
      ),
    ];
    const injectedDefinition: ElementDefinition = {
      ...base,
      defaultProps: { ...base.defaultProps, icon: "File" },
      propertySchema: {
        fields: [...base.propertySchema.fields, ...referenceFields],
      },
    };
    installInspectorApi({
      definitions: ELEMENT_DEFINITIONS.map((definition) =>
        definition.type === "text" ? injectedDefinition : definition,
      ),
    });
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(
      await screen.findByRole("button", { name: "element-a 선택" }),
    );
    const inspector = await screen.findByTestId("element-property-inspector");
    await user.click(within(inspector).getByRole("tab", { name: "Style" }));
    expect(
      within(inspector).getByLabelText("Custom Background"),
    ).toHaveAttribute("type", "color");
    await user.click(within(inspector).getByRole("tab", { name: "Advanced" }));
    expect(
      within(inspector).getByRole("button", { name: "File 아이콘 변경" }),
    ).toBeEnabled();
    const unavailable = within(inspector).getAllByPlaceholderText("사용 불가");
    expect(unavailable).toHaveLength(3);
    expect(
      unavailable.every((control) => control.hasAttribute("disabled")),
    ).toBe(true);
  });

  it("generates every canonical Registry field under its declared tab for all six definitions", async () => {
    const entries = ELEMENT_DEFINITIONS.map((definition) =>
      makeEntry(`schema-${definition.type}`, definition.type),
    );
    installInspectorApi({ pageOneEntries: entries });
    const user = userEvent.setup();
    render(<Harness />);

    for (const definition of ELEMENT_DEFINITIONS) {
      const entryId = `schema-${definition.type}`;
      await user.click(
        await screen.findByRole("button", { name: `${entryId} 선택` }),
      );
      const inspector = await screen.findByTestId("element-property-inspector");
      await waitFor(() =>
        expect(
          inspector.querySelector(".property-inspector-meta > strong"),
        ).toHaveTextContent(`${definition.defaultName} ${entryId}`),
      );

      for (const tab of ELEMENT_PROPERTY_TABS) {
        await user.click(
          within(inspector).getByRole("tab", { name: tab.label }),
        );
        const tabFields = definition.propertySchema.fields.filter(
          (field) => field.tab === tab.id,
        );
        for (const field of tabFields) {
          if (field.control === "binding-status") {
            if (definition.bindingPorts.length > 0) {
              expect(
                within(inspector).getByLabelText("데이터 연결 상태"),
              ).toHaveTextContent("미연결");
            } else {
              expect(
                within(inspector).getByText("해당 없음"),
              ).toBeInTheDocument();
            }
            continue;
          }
          const control = within(inspector).getByTestId(
            `property-field-${field.id}`,
          );
          expect(control.closest('[data-slot="field"]')).toHaveTextContent(
            field.label,
          );
        }
      }
    }
  });

  it("projects one injected Number Input through Palette, Inventory, Inspector, Editor, and Runtime", async () => {
    const probe = makeEntry("registry-probe", "number-input", "page-1", {
      props: { defaultValue: 0, accessibilityLabel: "Probe Number" },
    });
    installInspectorApi({ pageOneEntries: [probe] });
    const user = userEvent.setup();
    const editor = render(<RegistryProbeHarness />);

    expect(
      await screen.findByTestId("palette-item-number-input"),
    ).toHaveAccessibleName(/Number Input 배치/);
    const inventoryEntry = await screen.findByTestId(
      "placed-element-registry-probe",
    );
    expect(inventoryEntry).toHaveAttribute("role", "option");
    expect(
      inventoryEntry.querySelector('[data-renderer-key="number-input"]'),
    ).toHaveAttribute("data-element-type", "number-input");
    expect(within(inventoryEntry).getByRole("spinbutton")).toHaveValue(0);

    await user.click(inventoryEntry);
    const inspector = await screen.findByTestId("element-property-inspector");
    expect(within(inspector).getByText("Number Input")).toBeInTheDocument();
    await user.click(within(inspector).getByRole("tab", { name: "Data" }));
    expect(within(inspector).getByLabelText("Default Value")).toHaveValue(0);

    const runtime = render(
      <RuntimeElementRenderer
        entry={probe}
        definition={definitionFor("number-input")}
      />,
    );
    expect(
      runtime.container.querySelector('[data-renderer-key="number-input"]'),
    ).toHaveAttribute("data-element-type", "number-input");
    expect(within(runtime.container).getByRole("spinbutton")).toHaveValue(0);
    editor.unmount();
  });

  it("projects six registry entries, six schema tabs, and truthful unconnected data without Custom CSS", async () => {
    installInspectorApi({
      pageOneEntries: [
        makeEntry("no-port", "text"),
        makeEntry("table", "data-table"),
      ],
    });
    const user = userEvent.setup();
    render(<Harness />);

    expect(await screen.findAllByTestId(/^palette-item-/)).toHaveLength(6);
    await user.click(
      await screen.findByRole("button", { name: "no-port 선택" }),
    );
    const inspector = await screen.findByTestId("element-property-inspector");
    const tabs = within(inspector).getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(
      ELEMENT_PROPERTY_TABS.map((tab) => tab.label),
    );
    expect(screen.queryByText(/Custom CSS/i)).not.toBeInTheDocument();

    await user.click(within(inspector).getByRole("tab", { name: "Data" }));
    expect(within(inspector).getByText("연결 없음")).toBeInTheDocument();
    expect(within(inspector).getByText("해당 없음")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "table 선택" }));
    await waitFor(() =>
      expect(within(inspector).getByText("Data Table")).toBeInTheDocument(),
    );
    expect(
      within(inspector).getByLabelText("데이터 연결 상태"),
    ).toHaveTextContent("Rows미연결");

    await user.click(within(inspector).getByRole("tab", { name: "Style" }));
    expect(within(inspector).getByText("Padding")).toBeInTheDocument();
    expect(within(inspector).getByText("Border Width")).toBeInTheDocument();
    await user.click(within(inspector).getByRole("tab", { name: "Data" }));
    await user.click(
      within(inspector).getByRole("tab", { name: "Interaction" }),
    );
    expect(within(inspector).getByText("Events")).toBeInTheDocument();
    await user.click(
      within(inspector).getByRole("tab", { name: "Validation" }),
    );
    expect(within(inspector).getByText("Status")).toBeInTheDocument();
    await user.click(within(inspector).getByRole("tab", { name: "Advanced" }));
    expect(within(inspector).getByText("Type Version")).toBeInTheDocument();

    expect(stylesCss).toMatch(
      /\.property-tabs-list\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/s,
    );
    expect(stylesCss).toMatch(
      /\.property-tabs-list \[data-slot="tabs-trigger"\]\s*\{[^}]*width:\s*100%;[^}]*height:\s*var\(--control-height\)/s,
    );
    expect(stylesCss).toMatch(
      /@media \(max-width: 900px\)[\s\S]*\.inspector-panel\s*\{[\s\S]*display:\s*block;/,
    );
  });

  it("debounces 500ms, shows Saved only after ACK, and flushes the next field on blur", async () => {
    const api = installInspectorApi({ deferFirstProperty: true });
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(
      await screen.findByRole("button", { name: "element-a 선택" }),
    );
    const displayName = await screen.findByLabelText("Display Name");
    await user.clear(displayName);
    await user.type(displayName, "새 이름");
    expect(screen.getByLabelText("속성 저장 상태")).toHaveTextContent("변경됨");
    expect(screen.getByRole("button", { name: "잠금" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "삭제" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "실행 취소" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "다시 실행" })).toBeDisabled();

    await new Promise((resolve) => window.setTimeout(resolve, 320));
    expect(api.propertyCalls).toHaveLength(0);
    await waitFor(() => expect(api.propertyCalls).toHaveLength(1), {
      timeout: 900,
    });
    expect(screen.getByLabelText("속성 저장 상태")).toHaveTextContent(
      "저장 중",
    );
    expect(api.propertyCalls[0]!.body.change).toEqual({
      kind: "PROPERTIES",
      values: { "general.displayName": "새 이름" },
    });
    api.releaseFirstProperty();
    await waitFor(() =>
      expect(screen.getByLabelText("속성 저장 상태")).toHaveTextContent(
        "저장됨",
      ),
    );

    const tooltip = screen.getByLabelText("Tooltip");
    await user.type(tooltip, "도움말");
    fireEvent.blur(tooltip);
    await waitFor(() => expect(api.propertyCalls).toHaveLength(2), {
      timeout: 300,
    });
    expect(api.propertyCalls[1]!.body.change).toEqual({
      kind: "PROPERTIES",
      values: { "general.tooltip": "도움말" },
    });
  });

  it("keeps a failed draft visible and retries the same idempotent payload", async () => {
    const api = installInspectorApi({ failFirstProperty: true });
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(
      await screen.findByRole("button", { name: "element-a 선택" }),
    );
    const tooltip = await screen.findByLabelText("Tooltip");
    await user.type(tooltip, "실패 초안");
    fireEvent.blur(tooltip);
    expect(
      await screen.findByText("저장 오류", {
        selector: "[data-slot=alert-title]",
      }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Tooltip")).toHaveValue("실패 초안");
    expect(screen.getByRole("button", { name: "잠금" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "재시도" }));
    await waitFor(() => expect(api.propertyCalls).toHaveLength(2));
    await waitFor(() =>
      expect(screen.getByLabelText("속성 저장 상태")).toHaveTextContent(
        "저장됨",
      ),
    );
    expect(api.propertyCalls[1]!.body.change).toEqual(
      api.propertyCalls[0]!.body.change,
    );
    expect(api.propertyCalls[1]!.body.idempotencyKey).toBe(
      api.propertyCalls[0]!.body.idempotencyKey,
    );
    expect(screen.getByLabelText("Tooltip")).toHaveValue("실패 초안");
  });

  it("isolates rapid A and B drafts while advancing only the project-wide revision", async () => {
    const api = installInspectorApi({
      pageOneEntries: [
        makeEntry("element-a", "text", "page-1"),
        makeEntry("element-b", "text", "page-1"),
      ],
    });
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(
      await screen.findByRole("button", { name: "element-a 선택" }),
    );
    await user.type(await screen.findByLabelText("Tooltip"), "A 초안");
    await user.click(screen.getByRole("button", { name: "element-b 선택" }));
    await user.type(await screen.findByLabelText("Tooltip"), "B 초안");
    fireEvent.blur(screen.getByLabelText("Tooltip"));

    await waitFor(() => expect(api.propertyCalls).toHaveLength(2));
    expect(api.propertyCalls.map((call) => call.path)).toEqual([
      "/api/v1/elements/element-a",
      "/api/v1/elements/element-b",
    ]);
    expect(api.propertyCalls.map((call) => call.body.change)).toEqual([
      { kind: "PROPERTIES", values: { "general.tooltip": "A 초안" } },
      { kind: "PROPERTIES", values: { "general.tooltip": "B 초안" } },
    ]);
    expect(
      api.propertyCalls.map((call) => call.body.expectedProjectRevision),
    ).toEqual([10, 11]);
    expect(
      api.propertyCalls.map((call) => call.body.expectedLayoutRevision),
    ).toEqual([4, 4]);
    expect(screen.getByLabelText("선택 엘리먼트")).toHaveTextContent(
      "element-b",
    );
  });

  it("keeps a delayed Page A save out of Page B entries and layout revision", async () => {
    const api = installInspectorApi({ deferFirstProperty: true });
    const onLayoutRevisionChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness onLayoutRevisionChange={onLayoutRevisionChange} />);
    await user.click(
      await screen.findByRole("button", { name: "element-a 선택" }),
    );
    await user.type(await screen.findByLabelText("Tooltip"), "Page A");
    await user.click(screen.getByRole("button", { name: "Page 2" }));

    await waitFor(() =>
      expect(screen.getByLabelText("현재 페이지")).toHaveTextContent("page-2"),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("현재 엘리먼트")).toHaveTextContent(
        "element-b",
      ),
    );
    expect(api.propertyCalls).toHaveLength(1);
    expect(api.propertyCalls[0]!.body.expectedLayoutRevision).toBe(4);
    expect(api.propertyCalls[0]!.body.expectedRevision).toBe(1);
    api.releaseFirstProperty();

    await waitFor(() =>
      expect(screen.getByLabelText("프로젝트 리비전")).toHaveTextContent("11"),
    );
    expect(screen.getByLabelText("현재 엘리먼트")).toHaveTextContent(
      "element-b",
    );
    expect(screen.getByLabelText("현재 엘리먼트")).not.toHaveTextContent(
      "element-a",
    );
    expect(screen.getByLabelText("현재 레이아웃 리비전")).toHaveTextContent(
      "8",
    );
    expect(onLayoutRevisionChange).toHaveBeenCalledWith("page-1", 4);
  });

  it("keeps native field undo local and applies global Undo/Redo page-aware", async () => {
    const api = installInspectorApi({ historyMutationPageId: "page-2" });
    const onLayoutRevisionChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness onLayoutRevisionChange={onLayoutRevisionChange} />);
    await user.click(
      await screen.findByRole("button", { name: "element-a 선택" }),
    );
    const tooltip = await screen.findByLabelText("Tooltip");
    tooltip.focus();
    await user.keyboard("{Control>}z{/Control}");
    fireEvent.keyDown(tooltip, { key: "ArrowRight" });
    fireEvent.keyDown(tooltip, { key: "Delete" });
    fireEvent.keyDown(tooltip, { key: "Escape" });
    expect(api.historyMutationCalls).toHaveLength(0);
    expect(screen.getByLabelText("선택 엘리먼트")).toHaveTextContent(
      "element-a",
    );

    screen.getByRole("button", { name: "element-a 선택" }).focus();
    await user.keyboard("{Control>}z{/Control}");
    await waitFor(() => expect(api.historyMutationCalls).toHaveLength(1));
    expect(api.historyMutationCalls[0]!.path).toMatch(/\/undo$/);
    expect(screen.getByLabelText("현재 레이아웃 리비전")).toHaveTextContent(
      "4",
    );
    expect(onLayoutRevisionChange).toHaveBeenCalledWith("page-2", 9);

    await user.keyboard("{Control>}{Shift>}z{/Shift}{/Control}");
    await waitFor(() => expect(api.historyMutationCalls).toHaveLength(2));
    expect(api.historyMutationCalls[1]!.path).toMatch(/\/redo$/);
  });
});
