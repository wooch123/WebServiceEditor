import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ELEMENT_DEFINITIONS,
  STATISTICAL_ELEMENT_TYPES,
  type ElementEntryDto,
  type ElementType,
} from "@webeditor/domain";

import statisticalSource from "./statistical-rendering.tsx?raw";
import { ElementRenderer, editorRendererByKey } from "./ElementRenderer";
import {
  RuntimeElementRenderer,
  runtimeRendererByKey,
} from "@/features/runtime/RuntimeElementRenderer";
import type { StatisticalRenderData } from "./statistical-rendering";

const renderData: StatisticalRenderData = {
  series: [
    { label: "North", value: 12 },
    { label: "South", value: 18 },
    { label: "West", value: 15 },
  ],
  values: [1, 2, 3, 4, 5, 6, 7, 8],
  scatter: [
    { x: 1, y: 12, label: "North" },
    { x: 2, y: 18, label: "South" },
    { x: 3, y: 15, label: "West" },
  ],
  boxes: [
    {
      label: "North",
      minimum: 5,
      firstQuartile: 8,
      median: 12,
      thirdQuartile: 16,
      maximum: 21,
      outliers: [2, 28],
    },
  ],
  summary: [
    { label: "Count", value: 3 },
    { label: "Mean", value: 15 },
    { label: "Median", value: 15 },
    { label: "Std. Dev.", value: 4.69 },
    { label: "Minimum", value: 12 },
    { label: "Maximum", value: 18 },
  ],
};

function definitionFor(type: ElementType) {
  return ELEMENT_DEFINITIONS.find((definition) => definition.type === type)!;
}

function makeEntry(
  type: ElementType,
  props: Readonly<Record<string, unknown>> = {},
): ElementEntryDto {
  const definition = definitionFor(type);
  return {
    element: {
      id: `${type}-1`,
      projectId: "project-1",
      pageId: "page-1",
      type,
      typeVersion: 1,
      name: definition.defaultName,
      props: { ...definition.defaultProps, ...props },
      style: definition.defaultStyle,
      events: [],
      locked: false,
      hidden: false,
      revision: 1,
    },
    layout: {
      elementId: `${type}-1`,
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
              contentRect: {
                width: 480,
                height: 240,
              },
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
});

describe("Phase 7 statistical elements", () => {
  it("projects statistical chart properties and every required input port on the left", () => {
    for (const type of STATISTICAL_ELEMENT_TYPES) {
      const definition = definitionFor(type);
      expect(definition.propertySchema.fields.length).toBeGreaterThan(0);
      const requiredInputs = definition.bindingPorts.filter(
        (port) => port.direction === "input" && port.required,
      );
      expect(requiredInputs.length).toBeGreaterThan(0);
      expect(requiredInputs.every((port) => port.side === "left")).toBe(true);
    }
  });

  it("keeps preview demo and sample dataset values out of persisted statistical defaults", () => {
    const forbiddenPersistedKeys = [
      "data",
      "dataset",
      "series",
      "values",
      "scatter",
      "boxes",
      "summary",
    ];
    for (const type of STATISTICAL_ELEMENT_TYPES) {
      expect(
        Object.keys(definitionFor(type).defaultProps).filter((key) =>
          forbiddenPersistedKeys.includes(key),
        ),
      ).toEqual([]);
    }
    expect(statisticalSource).toContain("LAYOUT_PRESET_PREVIEW_DATA");
  });

  it("covers every statistical renderer key in separate Editor and Runtime registries", () => {
    expect(STATISTICAL_ELEMENT_TYPES).toHaveLength(6);
    for (const type of STATISTICAL_ELEMENT_TYPES) {
      expect(definitionFor(type).category).toBe("statistics");
      expect(editorRendererByKey[type]).toBeTypeOf("function");
      expect(runtimeRendererByKey[type]).toBeTypeOf("function");
      expect(editorRendererByKey[type]).not.toBe(runtimeRendererByKey[type]);
    }
    expect(Object.keys(editorRendererByKey)).toEqual(
      ELEMENT_DEFINITIONS.map((definition) => definition.rendererKey),
    );
    expect(Object.keys(runtimeRendererByKey)).toEqual(
      ELEMENT_DEFINITIONS.map((definition) => definition.rendererKey),
    );
  });

  it("keeps statistical Editor and Runtime accessible with semantic theme tokens", () => {
    const entry = makeEntry("line-chart", {
      title: "Accessible trend",
      accessibilityLabel: "Accessible trend",
    });
    const editor = render(
      <ElementRenderer
        entry={entry}
        definition={definitionFor("line-chart")}
        compact={false}
        renderState="DATA"
        renderData={renderData}
      />,
    );
    expect(
      screen.getByRole("figure", { name: "Accessible trend" }),
    ).toBeInTheDocument();
    editor.unmount();
    const runtime = render(
      <RuntimeElementRenderer
        entry={entry}
        definition={definitionFor("line-chart")}
        renderState="DATA"
        renderData={renderData}
      />,
    );
    expect(
      screen.getByRole("region", { name: "Accessible trend" }),
    ).toHaveAttribute("data-render-state", "DATA");
    expect(runtime.container.querySelector("[data-chart]")).toBeInTheDocument();
    expect(statisticalSource).toMatch(/var\(--chart-[1-8]\)/);
    expect(editorRendererByKey["line-chart"]).not.toBe(
      runtimeRendererByKey["line-chart"],
    );
  });

  it.each(STATISTICAL_ELEMENT_TYPES)(
    "renders truthful EMPTY, LOADING, ERROR, and DATA for %s",
    (type) => {
      const definition = definitionFor(type);
      const entry = makeEntry(type, { title: `Chart ${type}` });
      const view = render(
        <ElementRenderer
          entry={entry}
          definition={definition}
          compact={false}
          renderState="EMPTY"
        />,
      );
      expect(screen.getByText("미연결")).toBeInTheDocument();
      expect(
        view.container.querySelector('[data-render-state="EMPTY"]'),
      ).toBeInTheDocument();

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
          renderData={renderData}
        />,
      );
      if (type === "summary-statistics") {
        expect(
          screen.getByRole("table", { name: `Chart ${type}` }),
        ).toBeInTheDocument();
        expect(screen.getByText("Mean")).toBeInTheDocument();
      } else {
        expect(
          screen.getByRole("figure", { name: `Chart ${type}` }),
        ).toBeInTheDocument();
        expect(
          view.container.querySelector("[data-chart]"),
        ).toBeInTheDocument();
      }
      expect(
        view.container.querySelector('[data-render-state="DATA"]'),
      ).toBeInTheDocument();
    },
  );

  it("projects every declared chart option without arbitrary colors or animation", () => {
    const cases = [
      {
        type: "line-chart" as const,
        props: { curve: "step", xLabel: "Month", yLabel: "Sales" },
        attributes: {
          "data-curve": "step",
          "data-x-label": "Month",
          "data-y-label": "Sales",
        },
      },
      {
        type: "bar-chart" as const,
        props: { orientation: "horizontal" },
        attributes: { "data-orientation": "horizontal" },
      },
      {
        type: "scatter-plot" as const,
        props: { showTrendline: true },
        attributes: { "data-trendline": "true" },
      },
    ];
    for (const testCase of cases) {
      const entry = makeEntry(testCase.type, {
        title: testCase.type,
        ...testCase.props,
      });
      const view = render(
        <ElementRenderer
          entry={entry}
          definition={definitionFor(testCase.type)}
          compact={false}
          renderState="DATA"
          renderData={renderData}
        />,
      );
      const figure = screen.getByRole("figure", { name: testCase.type });
      for (const [name, value] of Object.entries(testCase.attributes)) {
        expect(figure).toHaveAttribute(name, value);
      }
      view.unmount();
    }

    const summary = makeEntry("summary-statistics", {
      title: "Summary",
      precision: 1,
      showStdDev: false,
    });
    render(
      <ElementRenderer
        entry={summary}
        definition={definitionFor("summary-statistics")}
        compact={false}
        renderState="DATA"
        renderData={renderData}
      />,
    );
    expect(screen.queryByText("Std. Dev.")).not.toBeInTheDocument();
    expect(screen.getAllByText("15")).toHaveLength(2);

    expect(statisticalSource).toContain('color: "var(--chart-1)"');
    expect(statisticalSource).toContain('color: "var(--chart-2)"');
    expect(statisticalSource).toContain('color: "var(--chart-3)"');
    expect(statisticalSource).toContain('color: "var(--chart-4)"');
    expect(statisticalSource).not.toMatch(/#[0-9a-f]{3,8}/i);
    expect(statisticalSource).toMatch(/isAnimationActive=\{false\}/);
  });

  it("changes actual histogram bins and box-plot outlier marks when their properties change", () => {
    const histogramTwo = makeEntry("histogram", {
      title: "Histogram",
      binCount: 2,
    });
    const histogram = render(
      <ElementRenderer
        entry={histogramTwo}
        definition={definitionFor("histogram")}
        compact={false}
        renderState="DATA"
        renderData={renderData}
      />,
    );
    expect(
      histogram.container.querySelectorAll(".statistical-histogram-bin"),
    ).toHaveLength(2);
    histogram.rerender(
      <ElementRenderer
        entry={makeEntry("histogram", { title: "Histogram", binCount: 4 })}
        definition={definitionFor("histogram")}
        compact={false}
        renderState="DATA"
        renderData={renderData}
      />,
    );
    expect(
      histogram.container.querySelectorAll(".statistical-histogram-bin"),
    ).toHaveLength(4);
    expect(histogram.container).toHaveTextContent("1–2.75");
    histogram.unmount();

    const box = render(
      <ElementRenderer
        entry={makeEntry("box-plot", {
          title: "Box Plot",
          showOutliers: false,
        })}
        definition={definitionFor("box-plot")}
        compact={false}
        renderState="DATA"
        renderData={renderData}
      />,
    );
    expect(
      box.container.querySelector(".statistical-box-outliers"),
    ).not.toBeInTheDocument();
    box.rerender(
      <ElementRenderer
        entry={makeEntry("box-plot", {
          title: "Box Plot",
          showOutliers: true,
        })}
        definition={definitionFor("box-plot")}
        compact={false}
        renderState="DATA"
        renderData={renderData}
      />,
    );
    expect(
      box.container.querySelector(".statistical-box-outliers"),
    ).toBeInTheDocument();
  });

  it.each(STATISTICAL_ELEMENT_TYPES)(
    "keeps an unconnected %s empty in immutable Runtime and accepts data only through an explicit runtime result",
    (type) => {
      const definition = definitionFor(type);
      const entry = makeEntry(type, {
        title: `Runtime ${type}`,
        accessibilityLabel: `Runtime ${type}`,
      });
      const view = render(
        <RuntimeElementRenderer entry={entry} definition={definition} />,
      );
      const region = screen.getByRole("region", { name: `Runtime ${type}` });
      expect(region).toHaveAttribute("data-render-state", "EMPTY");
      expect(screen.getByText("미연결")).toBeInTheDocument();
      expect(
        view.container.querySelector("[data-chart]"),
      ).not.toBeInTheDocument();
      view.rerender(
        <RuntimeElementRenderer
          entry={entry}
          definition={definition}
          renderState="DATA"
          renderData={renderData}
        />,
      );
      expect(region).toHaveAttribute("data-render-state", "DATA");
      expect(screen.queryByText("미연결")).not.toBeInTheDocument();
      expect(
        type === "summary-statistics"
          ? screen.getByRole("table", { name: `Runtime ${type}` })
          : view.container.querySelector("[data-chart]"),
      ).toBeInTheDocument();
    },
  );
});
