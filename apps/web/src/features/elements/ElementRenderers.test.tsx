import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  ELEMENT_DEFINITIONS,
  type ElementEntryDto,
  type ElementType,
} from "@webeditor/domain";

import { RuntimeElementRenderer } from "@/features/runtime/RuntimeElementRenderer";
import { elementPresentation } from "./element-presentation";
import {
  assertEditorRendererDefinitions,
  editorRendererByKey,
  ElementRenderer,
} from "./ElementRenderer";
import {
  assertRuntimeRendererDefinitions,
  runtimeRendererByKey,
} from "@/features/runtime/RuntimeElementRenderer";

function definitionFor(type: ElementType) {
  return ELEMENT_DEFINITIONS.find((definition) => definition.type === type)!;
}

function makeEntry(
  type: ElementType,
  overrides: {
    id?: string;
    props?: Readonly<Record<string, unknown>>;
    style?: Readonly<Record<string, unknown>>;
    hidden?: boolean;
  } = {},
): ElementEntryDto {
  const definition = definitionFor(type);
  const id = overrides.id ?? `${type}-1`;
  return {
    element: {
      id,
      projectId: "project-1",
      pageId: "page-1",
      type,
      typeVersion: 1,
      name: definition.defaultName,
      props: { ...definition.defaultProps, ...overrides.props },
      style: { ...definition.defaultStyle, ...overrides.style },
      events: [],
      locked: false,
      hidden: overrides.hidden ?? false,
      revision: 1,
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

afterEach(cleanup);

describe("Phase 6 editor and immutable runtime renderers", () => {
  it("covers every registry renderer key and renders Number Input defaultValue 0 in both trees", () => {
    expect(() =>
      assertEditorRendererDefinitions(ELEMENT_DEFINITIONS),
    ).not.toThrow();
    expect(() =>
      assertRuntimeRendererDefinitions(ELEMENT_DEFINITIONS),
    ).not.toThrow();
    expect(Object.keys(editorRendererByKey)).toEqual(
      ELEMENT_DEFINITIONS.map((definition) => definition.rendererKey),
    );
    expect(Object.keys(runtimeRendererByKey)).toEqual(
      ELEMENT_DEFINITIONS.map((definition) => definition.rendererKey),
    );

    const entry = makeEntry("number-input", {
      props: {
        defaultValue: 0,
        required: true,
        minimum: -5,
        maximum: 25,
        step: 2,
        tooltip: "숫자 범위",
        accessibilityLabel: "수량",
      },
    });
    const definition = definitionFor("number-input");
    const view = render(
      <ElementRenderer entry={entry} definition={definition} compact={false} />,
    );
    const editorInput = screen.getByRole("spinbutton", { name: "수량" });
    expect(editorInput).toHaveValue(0);
    expect(editorInput).toBeRequired();
    expect(editorInput).toHaveAttribute("min", "-5");
    expect(editorInput).toHaveAttribute("max", "25");
    expect(editorInput).toHaveAttribute("step", "2");
    expect(editorInput).toHaveAttribute("title", "숫자 범위");
    expect(view.container.querySelector(".element-renderer")).toHaveAttribute(
      "data-renderer-key",
      "number-input",
    );
    view.unmount();

    render(<RuntimeElementRenderer entry={entry} definition={definition} />);
    const runtimeInput = screen.getByRole("spinbutton", { name: "수량" });
    expect(runtimeInput).toHaveValue(0);
    expect(runtimeInput).toBeRequired();
    expect(runtimeInput).toHaveAttribute("min", "-5");
    expect(runtimeInput).toHaveAttribute("max", "25");
    expect(runtimeInput).toHaveAttribute("step", "2");
    expect(runtimeInput).toHaveAttribute("title", "숫자 범위");
    expect(screen.getByRole("region", { name: "수량" })).toHaveAttribute(
      "data-renderer-key",
      "number-input",
    );
  });

  it.each([
    "heading",
    "divider",
    "image",
    "badge",
    "icon",
    "link",
    "spacer",
    "tabs",
    "accordion",
  ] as const)(
    "renders the %s definition in separate Editor and Runtime trees",
    (type) => {
      const definition = definitionFor(type);
      const entry = makeEntry(type);
      const editor = render(
        <ElementRenderer
          entry={entry}
          definition={definition}
          compact={false}
        />,
      );
      expect(
        editor.container.querySelector(`[data-element-type="${type}"]`),
      ).toHaveAttribute("data-renderer-key", type);
      editor.unmount();

      const runtime = render(
        <RuntimeElementRenderer entry={entry} definition={definition} />,
      );
      expect(
        runtime.container.querySelector(
          `.runtime-element[data-element-type="${type}"]`,
        ),
      ).toHaveAttribute("data-renderer-key", type);
    },
  );

  it("projects semantic heading, tabs, accordion, image, and link controls", () => {
    const heading = makeEntry("heading", {
      props: { text: "Analysis", level: "3" },
    });
    const tabs = makeEntry("tabs", {
      props: { items: "Overview,Details", defaultTab: "Overview" },
    });
    const accordion = makeEntry("accordion", {
      props: { items: "Summary,Notes", defaultItem: "Summary" },
    });
    const image = makeEntry("image", { props: { src: "", alt: "Preview" } });
    const link = makeEntry("link", {
      props: { label: "Report", href: "/report" },
    });
    render(
      <>
        <RuntimeElementRenderer
          entry={heading}
          definition={definitionFor("heading")}
        />
        <RuntimeElementRenderer
          entry={tabs}
          definition={definitionFor("tabs")}
        />
        <RuntimeElementRenderer
          entry={accordion}
          definition={definitionFor("accordion")}
        />
        <RuntimeElementRenderer
          entry={image}
          definition={definitionFor("image")}
        />
        <RuntimeElementRenderer
          entry={link}
          definition={definitionFor("link")}
        />
      </>,
    );
    expect(
      screen.getByRole("heading", { name: "Analysis", level: 3 }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Overview",
      "Details",
    ]);
    expect(screen.getByRole("button", { name: "Summary" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Preview" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Report" })).toHaveAttribute(
      "href",
      "/report",
    );
  });

  it.each([
    {
      type: "kpi-card" as const,
      dataProps: { label: "Revenue", value: "42" },
      dataText: "42",
    },
    {
      type: "data-table" as const,
      dataProps: {
        columns: ["city"],
        rows: [{ city: "Seoul" }],
      },
      density: "compact" as const,
      dataText: "Seoul",
    },
  ])(
    "renders truthful EMPTY/LOADING/ERROR/DATA capability for $type",
    ({ type, dataProps, dataText, density }) => {
      const definition = definitionFor(type);
      const entry = makeEntry(type, {
        props: dataProps,
        ...(density ? { style: { density } } : {}),
      });
      const view = render(
        <ElementRenderer
          entry={entry}
          definition={definition}
          compact={false}
          renderState="EMPTY"
        />,
      );
      expect(screen.getByText("미연결")).toBeInTheDocument();
      expect(screen.queryByText(dataText)).not.toBeInTheDocument();

      view.rerender(
        <ElementRenderer
          entry={entry}
          definition={definition}
          compact={false}
          renderState="LOADING"
        />,
      );
      expect(screen.getByRole("status", { name: "로딩" })).toBeInTheDocument();
      view.rerender(
        <ElementRenderer
          entry={entry}
          definition={definition}
          compact={false}
          renderState="ERROR"
        />,
      );
      expect(screen.getByRole("alert")).toHaveTextContent("데이터 오류");
      view.rerender(
        <ElementRenderer
          entry={entry}
          definition={definition}
          compact={false}
          renderState="DATA"
        />,
      );
      expect(screen.getByText(dataText)).toBeInTheDocument();
      if (type === "data-table") {
        expect(screen.getByRole("table")).toHaveAttribute(
          "data-density",
          "compact",
        );
      }
    },
  );

  it("keeps required-input KPI and Data Table truthful and empty in published Runtime", () => {
    const kpi = makeEntry("kpi-card", {
      id: "kpi",
      props: { label: "Revenue", value: "999" },
    });
    const table = makeEntry("data-table", {
      id: "table",
      props: {
        columns: ["city"],
        rows: [{ city: "Fake row" }],
      },
      style: { density: "spacious" },
    });
    render(
      <>
        <RuntimeElementRenderer
          entry={kpi}
          definition={definitionFor("kpi-card")}
        />
        <RuntimeElementRenderer
          entry={table}
          definition={definitionFor("data-table")}
        />
      </>,
    );
    const runtimeElements = screen.getAllByRole("region");
    expect(runtimeElements).toHaveLength(2);
    expect(
      runtimeElements.every(
        (element) => element.dataset.renderState === "EMPTY",
      ),
    ).toBe(true);
    expect(screen.getAllByText("미연결")).toHaveLength(2);
    expect(screen.queryByText("999")).not.toBeInTheDocument();
    expect(screen.queryByText("Fake row")).not.toBeInTheDocument();
    expect(
      runtimeElements.find(
        (element) => element.dataset.elementType === "data-table",
      ),
    ).toHaveAttribute("data-density", "spacious");
  });

  it("applies the same allowlisted effects to Editor and Runtime and omits hidden Runtime elements", () => {
    const entry = makeEntry("button", {
      props: {
        label: "Action",
        disabled: true,
        tooltip: "도움말",
        accessibilityLabel: "실행 동작",
      },
      style: {
        padding: 12,
        margin: 7,
        backgroundToken: "primary",
        backgroundCustom: "#112233",
        borderToken: "ring",
        borderWidth: 3,
        borderStyle: "dashed",
        radius: 11,
        shadow: "md",
        textColorToken: "accent-foreground",
        fontSize: 18,
        fontWeight: "700",
        textAlign: "right",
        contentAlign: "end",
        customCSS: "position: fixed; inset: 0",
      },
    });
    const definition = definitionFor("button");
    const editor = render(
      <ElementRenderer entry={entry} definition={definition} compact={false} />,
    );
    const editorRoot =
      editor.container.querySelector<HTMLElement>(".element-renderer")!;
    expect(editorRoot).toHaveAttribute("title", "도움말");
    expect(editorRoot).toHaveAttribute("aria-label", "실행 동작");
    expect(editorRoot).toHaveAttribute("aria-disabled", "true");
    const editorButton = within(editorRoot).getByRole("button", {
      name: "실행 동작",
    });
    expect(editorButton).toBeDisabled();
    expect(editorButton).toHaveAttribute("title", "도움말");
    expect(editorRoot.style.backgroundColor).toBe("rgb(17, 34, 51)");
    expect(editorRoot.style.borderColor).toBe("var(--ring)");
    expect(editorRoot.style.borderWidth).toBe("3px");
    expect(editorRoot.style.borderStyle).toBe("dashed");
    expect(editorRoot.style.justifyContent).toBe("flex-end");
    expect(editorRoot.style.position).toBe("");
    const editorStyle = editorRoot.getAttribute("style");
    editor.unmount();

    const runtime = render(
      <RuntimeElementRenderer entry={entry} definition={definition} />,
    );
    const runtimeRoot = screen.getByRole("region", { name: "실행 동작" });
    expect(runtimeRoot.getAttribute("style")).toBe(editorStyle);
    expect(runtimeRoot).toHaveAttribute("title", "도움말");
    const runtimeButton = within(runtimeRoot).getByRole("button", {
      name: "실행 동작",
    });
    expect(runtimeButton).toBeDisabled();
    expect(runtimeButton).toHaveAttribute("title", "도움말");
    runtime.unmount();

    const hidden = makeEntry("button", { hidden: true });
    const hiddenView = render(
      <RuntimeElementRenderer entry={hidden} definition={definition} />,
    );
    expect(hiddenView.container).toBeEmptyDOMElement();
  });

  it("maps every declared semantic token and gives safe backgroundCustom priority", () => {
    const definition = definitionFor("button");
    const tokenField = definition.propertySchema.fields.find(
      (field) => field.id === "style.backgroundToken",
    )!;
    const tokenOptions = "options" in tokenField ? tokenField.options : [];
    for (const option of tokenOptions ?? []) {
      const entry = makeEntry("button", {
        style: {
          backgroundToken: option.value,
          backgroundCustom: "",
          textColorToken: option.value,
          borderToken: option.value,
        },
      });
      const presentation = elementPresentation(entry);
      expect(presentation.style.backgroundColor).toBe(`var(--${option.value})`);
      expect(presentation.style.color).toBe(`var(--${option.value})`);
      expect(presentation.style.borderColor).toBe(`var(--${option.value})`);
    }
    const custom = elementPresentation(
      makeEntry("button", {
        style: { backgroundToken: "primary", backgroundCustom: "#abcdef" },
      }),
    );
    expect(custom.style.backgroundColor).toBe("#abcdef");
  });
});
