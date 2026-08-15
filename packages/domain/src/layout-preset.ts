import {
  ELEMENT_DEFINITIONS,
  type ElementDefinition,
  type ElementEntryDto,
  type ElementPropertyValue,
  type ElementType,
} from "./element.js";

export const LAYOUT_PRESET_SCHEMA_VERSION = 1 as const;
export const LAYOUT_PRESET_VERSION = 1 as const;
export const LAYOUT_PRESET_IDS = [
  "analysis-dashboard",
  "blank-grid",
  "board",
  "chat",
  "comparison-dashboard",
  "correlation-analysis",
  "data-browser",
  "data-entry",
  "data-table",
  "distribution-analysis",
  "executive-dashboard",
  "experiment-comparison",
  "form",
  "kpi-dashboard",
  "master-detail",
  "monitoring-dashboard",
  "quality-dashboard",
  "regression-analysis",
  "report",
  "settings",
  "spc-dashboard",
  "trend-analysis",
] as const;
export const LAYOUT_PRESET_APPLY_MODES = ["ADD", "REPLACE"] as const;
export const LAYOUT_PRESET_INSTANCE_STATES = [
  "APPLIED",
  "UNDONE",
  "DISCARDED",
] as const;
export const LAYOUT_PRESET_INSTANCE_ORIGINS = ["APPLY", "IMPORT"] as const;

export type LayoutPresetId = (typeof LAYOUT_PRESET_IDS)[number];
export type LayoutPresetApplyMode = (typeof LAYOUT_PRESET_APPLY_MODES)[number];
export type LayoutPresetInstanceState =
  (typeof LAYOUT_PRESET_INSTANCE_STATES)[number];
export type LayoutPresetInstanceOrigin =
  (typeof LAYOUT_PRESET_INSTANCE_ORIGINS)[number];
export type LayoutPresetCategory =
  "dashboard" | "statistics" | "data" | "general";

export interface LayoutPresetTemplateLayout {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface LayoutPresetElementTemplate {
  readonly templateId: string;
  readonly elementType: ElementType;
  readonly name: string;
  readonly props: Readonly<Record<string, ElementPropertyValue>>;
  readonly style: Readonly<Record<string, ElementPropertyValue>>;
  readonly layout: LayoutPresetTemplateLayout;
}

export interface LayoutPresetBindingPlaceholderTemplate {
  readonly templateId: string;
  readonly portId: string;
  readonly status: "UNCONNECTED";
}

export interface LayoutPresetSuggestedSchemaField {
  readonly templateId: string;
  readonly displayName: string;
  readonly dataType: "TEXT" | "INTEGER" | "REAL" | "BOOLEAN" | "DATETIME";
  readonly nullable: boolean;
}

export interface LayoutPresetSuggestedSchemaTable {
  readonly templateId: string;
  readonly displayName: string;
  readonly fields: readonly LayoutPresetSuggestedSchemaField[];
}

export interface LayoutPresetSuggestedSchemaProposal {
  readonly id: string;
  readonly label: string;
  readonly tables: readonly LayoutPresetSuggestedSchemaTable[];
}

export interface LayoutPresetValidationScenario {
  readonly id: string;
  readonly label: string;
}

export interface LayoutPresetDefinition {
  readonly id: LayoutPresetId;
  readonly version: typeof LAYOUT_PRESET_VERSION;
  readonly name: string;
  readonly category: LayoutPresetCategory;
  readonly description: string;
  readonly iconName: string;
  readonly requiredElements: readonly ElementType[];
  readonly elementCount: number;
  readonly elements: readonly LayoutPresetElementTemplate[];
  readonly bindingPlaceholders: readonly LayoutPresetBindingPlaceholderTemplate[];
  readonly suggestedSchema: LayoutPresetSuggestedSchemaProposal | null;
  readonly validationScenario: LayoutPresetValidationScenario | null;
}

export interface LayoutPresetRegistryDto {
  readonly schemaVersion: typeof LAYOUT_PRESET_SCHEMA_VERSION;
  readonly definitions: readonly LayoutPresetDefinition[];
  readonly checksum: string;
}

export interface LayoutPresetBindingPlaceholderDto {
  readonly instanceId: string;
  readonly elementId: string;
  readonly elementTypeVersion: 1;
  readonly templateId: string;
  readonly portId: string;
  readonly status: "UNCONNECTED";
}

export interface LayoutPresetProposedElementDto {
  readonly templateId: string;
  readonly entry: ElementEntryDto;
}

export interface LayoutPresetWarningDto {
  readonly code: "REQUIRED_BINDING_UNCONNECTED" | "REPLACE_EXISTING_ELEMENTS";
  readonly message: string;
  readonly elementId: string | null;
  readonly portId: string | null;
}

export interface LayoutPresetPreviewDto {
  readonly previewId: string;
  readonly presetId: LayoutPresetId;
  readonly presetVersion: typeof LAYOUT_PRESET_VERSION;
  readonly presetSnapshot: LayoutPresetDefinition;
  readonly registryChecksum: string;
  readonly coordinateChecksum: string;
  readonly pageId: string;
  readonly mode: LayoutPresetApplyMode;
  readonly existingElementCount: number;
  readonly createdElementCount: number;
  readonly proposedElements: readonly LayoutPresetProposedElementDto[];
  readonly deletedElementIds: readonly string[];
  readonly suggestedSchema: LayoutPresetSuggestedSchemaProposal | null;
  readonly bindingPlaceholders: readonly Omit<
    LayoutPresetBindingPlaceholderDto,
    "instanceId"
  >[];
  readonly warnings: readonly LayoutPresetWarningDto[];
  readonly layoutRevision: number;
  readonly projectRevision: number;
  readonly expiresAt: string;
}

export interface PreviewLayoutPresetRequest {
  readonly mode: LayoutPresetApplyMode;
  readonly expectedLayoutRevision: number;
  readonly expectedProjectRevision: number;
}

export interface ApplyLayoutPresetRequest {
  readonly previewId: string;
  readonly expectedLayoutRevision: number;
  readonly expectedProjectRevision: number;
  readonly idempotencyKey: string;
}

export interface LayoutPresetInstanceElementDto {
  readonly templateId: string;
  readonly elementId: string;
}

export interface LayoutPresetInstanceDto {
  readonly id: string;
  readonly projectId: string;
  readonly pageId: string;
  readonly presetId: LayoutPresetId;
  readonly presetVersion: typeof LAYOUT_PRESET_VERSION;
  readonly presetSnapshot: LayoutPresetDefinition;
  readonly registryChecksum: string;
  readonly coordinateChecksum: string;
  readonly mode: LayoutPresetApplyMode;
  readonly state: LayoutPresetInstanceState;
  readonly origin: LayoutPresetInstanceOrigin;
  readonly commandId: string | null;
  readonly elements: readonly LayoutPresetInstanceElementDto[];
  readonly proposedElements: readonly LayoutPresetProposedElementDto[];
  readonly bindingPlaceholders: readonly LayoutPresetBindingPlaceholderDto[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface LayoutPresetInstancesExportDto {
  readonly schemaVersion: typeof LAYOUT_PRESET_SCHEMA_VERSION;
  readonly instances: readonly LayoutPresetInstanceDto[];
}

export interface ApplyLayoutPresetDto {
  readonly instance: LayoutPresetInstanceDto;
  readonly coordinateChecksum: string;
  readonly proposedElements: readonly LayoutPresetProposedElementDto[];
  readonly entries: readonly ElementEntryDto[];
  readonly createdElementIds: readonly string[];
  readonly deletedElementIds: readonly string[];
  readonly suggestedSchema: LayoutPresetSuggestedSchemaProposal | null;
  readonly bindingPlaceholders: readonly LayoutPresetBindingPlaceholderDto[];
  readonly layoutRevision: number;
  readonly projectRevision: number;
  readonly commandId: string;
}

const definitionsByType = new Map<ElementType, ElementDefinition>(
  ELEMENT_DEFINITIONS.map((definition) => [definition.type, definition]),
);

function elementTemplate(
  templateId: string,
  elementType: ElementType,
  name: string,
  x: number,
  y: number,
  w: number,
  h: number,
  props: Readonly<Record<string, ElementPropertyValue>> = {},
  style: Readonly<Record<string, ElementPropertyValue>> = {},
): LayoutPresetElementTemplate {
  return {
    templateId,
    elementType,
    name,
    props,
    style,
    layout: { x, y, w, h },
  };
}

function layoutPreset(input: {
  readonly id: LayoutPresetId;
  readonly name: string;
  readonly category: LayoutPresetCategory;
  readonly description: string;
  readonly iconName: string;
  readonly elements: readonly LayoutPresetElementTemplate[];
  readonly suggestedSchema?: LayoutPresetSuggestedSchemaProposal;
  readonly validationScenario?: LayoutPresetValidationScenario;
}): LayoutPresetDefinition {
  const requiredElements = [
    ...new Set(input.elements.map(({ elementType }) => elementType)),
  ];
  const bindingPlaceholders = input.elements.flatMap((template) => {
    const definition = definitionsByType.get(template.elementType);
    if (definition === undefined) {
      throw new Error(`Unknown Layout Preset Element ${template.elementType}`);
    }
    return definition.bindingPorts
      .filter(
        (port) =>
          port.required && port.direction === "input" && port.side === "left",
      )
      .map((port) => ({
        templateId: template.templateId,
        portId: port.id,
        status: "UNCONNECTED" as const,
      }));
  });
  return {
    ...input,
    version: LAYOUT_PRESET_VERSION,
    requiredElements,
    elementCount: input.elements.length,
    bindingPlaceholders,
    suggestedSchema: input.suggestedSchema ?? null,
    validationScenario: input.validationScenario ?? null,
  };
}

export const LAYOUT_PRESET_DEFINITIONS = [
  layoutPreset({
    id: "analysis-dashboard",
    name: "Analysis Dashboard",
    category: "dashboard",
    description: "Key measures, statistical summary, trends, and records.",
    iconName: "LayoutDashboard",
    elements: [
      elementTemplate("title", "text", "Analysis", 0, 0, 24, 5, {
        text: "Analysis",
      }),
      elementTemplate("primary-kpi", "kpi-card", "Primary KPI", 0, 5, 6, 10, {
        label: "Primary",
      }),
      elementTemplate("summary", "summary-statistics", "Summary", 6, 5, 8, 14),
      elementTemplate("records", "data-table", "Records", 14, 5, 10, 16, {
        title: "Records",
      }),
      elementTemplate("trend", "line-chart", "Trend", 0, 21, 12, 18, {
        title: "Trend",
      }),
      elementTemplate("comparison", "bar-chart", "Comparison", 12, 21, 12, 18, {
        title: "Comparison",
      }),
    ],
  }),
  layoutPreset({
    id: "blank-grid",
    name: "Blank Grid",
    category: "general",
    description: "A minimal real data surface ready for connection.",
    iconName: "LayoutGrid",
    elements: [
      elementTemplate("data", "data-table", "Data", 0, 0, 24, 16, {
        title: "Data",
      }),
    ],
  }),
  layoutPreset({
    id: "board",
    name: "Board",
    category: "general",
    description: "Board records with a primary action.",
    iconName: "PanelTop",
    elements: [
      elementTemplate("title", "text", "Board", 0, 0, 24, 5, { text: "Board" }),
      elementTemplate("items", "data-table", "Board Items", 0, 5, 18, 18, {
        title: "Items",
      }),
      elementTemplate("new", "button", "New Item", 18, 5, 6, 5, {
        label: "New",
      }),
    ],
  }),
  layoutPreset({
    id: "chat",
    name: "Chat",
    category: "general",
    description: "Message history and a concise composer.",
    iconName: "MessageSquare",
    elements: [
      elementTemplate("messages", "data-table", "Messages", 0, 0, 24, 18, {
        title: "Messages",
      }),
      elementTemplate("message", "text", "Message", 0, 18, 18, 5, {
        text: "Message",
      }),
      elementTemplate("send", "button", "Send", 18, 18, 6, 5, {
        label: "Send",
      }),
    ],
  }),
  layoutPreset({
    id: "comparison-dashboard",
    name: "Comparison Dashboard",
    category: "dashboard",
    description: "Side-by-side measures and visual comparisons.",
    iconName: "LayoutDashboard",
    elements: [
      ...[0, 1, 2, 3].map((index) =>
        elementTemplate(
          `kpi-${index + 1}`,
          "kpi-card",
          `KPI ${index + 1}`,
          index * 6,
          0,
          6,
          10,
          { label: `KPI ${index + 1}` },
        ),
      ),
      elementTemplate(
        "bars",
        "bar-chart",
        "Category Comparison",
        0,
        10,
        12,
        18,
        {
          title: "Category Comparison",
        },
      ),
      elementTemplate(
        "trend",
        "line-chart",
        "Period Comparison",
        12,
        10,
        12,
        18,
        {
          title: "Period Comparison",
        },
      ),
    ],
  }),
  layoutPreset({
    id: "correlation-analysis",
    name: "Correlation Analysis",
    category: "statistics",
    description: "Paired relationships, summaries, and source records.",
    iconName: "ChartScatter",
    elements: [
      elementTemplate(
        "scatter-a",
        "scatter-plot",
        "Relationship A",
        0,
        0,
        12,
        18,
        {
          title: "Relationship A",
        },
      ),
      elementTemplate(
        "scatter-b",
        "scatter-plot",
        "Relationship B",
        12,
        0,
        12,
        18,
        {
          title: "Relationship B",
        },
      ),
      elementTemplate("summary", "summary-statistics", "Summary", 0, 18, 8, 14),
      elementTemplate("records", "data-table", "Records", 8, 18, 16, 16, {
        title: "Records",
      }),
    ],
  }),
  layoutPreset({
    id: "data-browser",
    name: "Data Browser",
    category: "data",
    description: "Browse records with a compact filter rail.",
    iconName: "Database",
    elements: [
      elementTemplate("records", "data-table", "Records", 0, 0, 18, 24, {
        title: "Records",
      }),
      elementTemplate("filter-label", "text", "Filter", 18, 0, 6, 5, {
        text: "Filter",
      }),
      elementTemplate(
        "filter-value",
        "number-input",
        "Filter Value",
        18,
        5,
        6,
        7,
        {
          label: "Value",
        },
      ),
      elementTemplate("apply", "button", "Apply", 18, 12, 6, 5, {
        label: "Apply",
      }),
    ],
  }),
  layoutPreset({
    id: "data-entry",
    name: "Data Entry",
    category: "data",
    description: "Numeric entry form followed by submitted records.",
    iconName: "SquarePen",
    suggestedSchema: {
      id: "measurement-records",
      label: "Measurement Records",
      tables: [
        {
          templateId: "measurements",
          displayName: "Measurements",
          fields: [
            {
              templateId: "measured-at",
              displayName: "Measured At",
              dataType: "DATETIME",
              nullable: false,
            },
            {
              templateId: "value-a",
              displayName: "Value A",
              dataType: "REAL",
              nullable: false,
            },
            {
              templateId: "value-b",
              displayName: "Value B",
              dataType: "REAL",
              nullable: true,
            },
          ],
        },
      ],
    },
    elements: [
      elementTemplate("title", "text", "Data Entry", 0, 0, 24, 5, {
        text: "Data Entry",
      }),
      ...[0, 1, 2].map((index) =>
        elementTemplate(
          `value-${index + 1}`,
          "number-input",
          `Value ${index + 1}`,
          index * 8,
          5,
          8,
          7,
          { label: `Value ${index + 1}` },
        ),
      ),
      elementTemplate("submit", "button", "Submit", 0, 12, 6, 5, {
        label: "Submit",
      }),
      elementTemplate(
        "records",
        "data-table",
        "Submitted Records",
        0,
        17,
        24,
        16,
        {
          title: "Submitted Records",
        },
      ),
    ],
  }),
  layoutPreset({
    id: "data-table",
    name: "Data Table",
    category: "data",
    description: "A full-width record table.",
    iconName: "Table2",
    elements: [
      elementTemplate("records", "data-table", "Records", 0, 0, 24, 24, {
        title: "Records",
      }),
    ],
  }),
  layoutPreset({
    id: "distribution-analysis",
    name: "Distribution Analysis",
    category: "statistics",
    description: "Histogram, box plot, summary, and raw observations.",
    iconName: "ChartBarBig",
    elements: [
      elementTemplate("histogram", "histogram", "Distribution", 0, 0, 12, 18, {
        title: "Distribution",
      }),
      elementTemplate("box", "box-plot", "Quartiles", 12, 0, 12, 18, {
        title: "Quartiles",
      }),
      elementTemplate("summary", "summary-statistics", "Summary", 0, 18, 8, 14),
      elementTemplate("records", "data-table", "Observations", 8, 18, 16, 16, {
        title: "Observations",
      }),
    ],
  }),
  layoutPreset({
    id: "executive-dashboard",
    name: "Executive Dashboard",
    category: "dashboard",
    description: "Top measures, trend, summary, and detailed results.",
    iconName: "LayoutDashboard",
    elements: [
      ...[0, 1, 2, 3].map((index) =>
        elementTemplate(
          `kpi-${index + 1}`,
          "kpi-card",
          `Measure ${index + 1}`,
          index * 6,
          0,
          6,
          10,
          { label: `Measure ${index + 1}` },
        ),
      ),
      elementTemplate("trend", "line-chart", "Executive Trend", 0, 10, 16, 18, {
        title: "Executive Trend",
      }),
      elementTemplate(
        "summary",
        "summary-statistics",
        "Summary",
        16,
        10,
        8,
        14,
      ),
      elementTemplate("records", "data-table", "Details", 0, 28, 24, 16, {
        title: "Details",
      }),
    ],
  }),
  layoutPreset({
    id: "experiment-comparison",
    name: "Experiment Comparison",
    category: "statistics",
    description: "Compare grouped experiments and their distributions.",
    iconName: "ChartNoAxesCombined",
    elements: [
      elementTemplate("title", "text", "Experiment Comparison", 0, 0, 24, 5, {
        text: "Experiment Comparison",
      }),
      elementTemplate("box", "box-plot", "Distributions", 0, 5, 12, 18, {
        title: "Distributions",
      }),
      elementTemplate("bars", "bar-chart", "Means", 12, 5, 12, 18, {
        title: "Means",
      }),
      elementTemplate("summary", "summary-statistics", "Summary", 0, 23, 8, 14),
      elementTemplate("records", "data-table", "Runs", 8, 23, 16, 16, {
        title: "Runs",
      }),
    ],
  }),
  layoutPreset({
    id: "form",
    name: "Form",
    category: "general",
    description: "A compact numeric form and its resulting records.",
    iconName: "SquarePen",
    elements: [
      elementTemplate("title", "text", "Form", 0, 0, 24, 5, { text: "Form" }),
      elementTemplate("value-a", "number-input", "Value A", 0, 5, 8, 7, {
        label: "Value A",
      }),
      elementTemplate("value-b", "number-input", "Value B", 8, 5, 8, 7, {
        label: "Value B",
      }),
      elementTemplate("submit", "button", "Submit", 16, 5, 8, 5, {
        label: "Submit",
      }),
      elementTemplate("records", "data-table", "Submissions", 0, 12, 24, 16, {
        title: "Submissions",
      }),
    ],
  }),
  layoutPreset({
    id: "kpi-dashboard",
    name: "KPI Dashboard",
    category: "dashboard",
    description: "Four measures, trend, comparison, and records.",
    iconName: "LayoutDashboard",
    elements: [
      ...[0, 1, 2, 3].map((index) =>
        elementTemplate(
          `kpi-${index + 1}`,
          "kpi-card",
          `KPI ${index + 1}`,
          index * 6,
          0,
          6,
          10,
          { label: `KPI ${index + 1}` },
        ),
      ),
      elementTemplate("trend", "line-chart", "Trend", 0, 10, 12, 18, {
        title: "Trend",
      }),
      elementTemplate("comparison", "bar-chart", "Comparison", 12, 10, 12, 18, {
        title: "Comparison",
      }),
      elementTemplate("records", "data-table", "Records", 0, 28, 24, 16, {
        title: "Records",
      }),
    ],
  }),
  layoutPreset({
    id: "master-detail",
    name: "Master Detail",
    category: "data",
    description: "Master records beside a detail and summary rail.",
    iconName: "PanelTop",
    elements: [
      elementTemplate("master", "data-table", "Master", 0, 0, 10, 26, {
        title: "Master",
      }),
      elementTemplate("detail", "container", "Detail", 10, 0, 14, 12, {
        label: "Detail",
      }),
      elementTemplate("value", "kpi-card", "Selected Value", 10, 12, 7, 10, {
        label: "Selected",
      }),
      elementTemplate(
        "summary",
        "summary-statistics",
        "Summary",
        17,
        12,
        7,
        14,
      ),
    ],
  }),
  layoutPreset({
    id: "monitoring-dashboard",
    name: "Monitoring Dashboard",
    category: "dashboard",
    description: "Live measures, trend, events, and comparison surfaces.",
    iconName: "LayoutDashboard",
    elements: [
      ...[0, 1, 2, 3].map((index) =>
        elementTemplate(
          `kpi-${index + 1}`,
          "kpi-card",
          `Signal ${index + 1}`,
          index * 6,
          0,
          6,
          10,
          { label: `Signal ${index + 1}` },
        ),
      ),
      elementTemplate("trend", "line-chart", "Signal Trend", 0, 10, 16, 18, {
        title: "Signal Trend",
      }),
      elementTemplate("events", "data-table", "Events", 16, 10, 8, 18, {
        title: "Events",
      }),
      elementTemplate("comparison", "bar-chart", "Comparison", 0, 28, 12, 18, {
        title: "Comparison",
      }),
      elementTemplate(
        "summary",
        "summary-statistics",
        "Summary",
        12,
        28,
        12,
        14,
      ),
    ],
  }),
  layoutPreset({
    id: "quality-dashboard",
    name: "Quality Dashboard",
    category: "statistics",
    description: "Process trend, distribution, defects, and summary.",
    iconName: "ChartSpline",
    elements: [
      elementTemplate("process", "line-chart", "Process Trend", 0, 0, 12, 18, {
        title: "Process Trend",
      }),
      elementTemplate(
        "distribution",
        "histogram",
        "Distribution",
        12,
        0,
        12,
        18,
        {
          title: "Distribution",
        },
      ),
      elementTemplate("defects", "bar-chart", "Defects", 0, 18, 12, 18, {
        title: "Defects",
      }),
      elementTemplate(
        "summary",
        "summary-statistics",
        "Summary",
        12,
        18,
        12,
        14,
      ),
    ],
  }),
  layoutPreset({
    id: "regression-analysis",
    name: "Regression Analysis",
    category: "statistics",
    description: "Observed relationship, fitted trend, summary, and records.",
    iconName: "ChartScatter",
    elements: [
      elementTemplate("scatter", "scatter-plot", "Observed", 0, 0, 12, 18, {
        title: "Observed",
      }),
      elementTemplate("fit", "line-chart", "Fitted Trend", 12, 0, 12, 18, {
        title: "Fitted Trend",
      }),
      elementTemplate("summary", "summary-statistics", "Summary", 0, 18, 8, 14),
      elementTemplate("records", "data-table", "Observations", 8, 18, 16, 16, {
        title: "Observations",
      }),
    ],
  }),
  layoutPreset({
    id: "report",
    name: "Report",
    category: "general",
    description: "Narrative, statistical summary, chart, and appendix data.",
    iconName: "FileText",
    elements: [
      elementTemplate("title", "text", "Report", 0, 0, 24, 5, {
        text: "Report",
      }),
      elementTemplate("summary", "summary-statistics", "Summary", 0, 5, 8, 14),
      elementTemplate("trend", "line-chart", "Trend", 8, 5, 16, 18, {
        title: "Trend",
      }),
      elementTemplate("notes", "text", "Notes", 0, 23, 24, 5, {
        text: "Notes",
      }),
      elementTemplate("appendix", "data-table", "Appendix", 0, 28, 24, 16, {
        title: "Appendix",
      }),
    ],
  }),
  layoutPreset({
    id: "settings",
    name: "Settings",
    category: "general",
    description: "Setting records with a numeric control and save action.",
    iconName: "Settings",
    elements: [
      elementTemplate("settings", "data-table", "Settings", 0, 0, 16, 18, {
        title: "Settings",
      }),
      elementTemplate("value", "number-input", "Value", 16, 0, 8, 7, {
        label: "Value",
      }),
      elementTemplate("save", "button", "Save", 16, 7, 8, 5, {
        label: "Save",
      }),
    ],
  }),
  layoutPreset({
    id: "spc-dashboard",
    name: "SPC Dashboard",
    category: "statistics",
    description: "Process trend, distribution, variation, and observations.",
    iconName: "ChartSpline",
    elements: [
      elementTemplate("process", "line-chart", "Process", 0, 0, 16, 18, {
        title: "Process",
      }),
      elementTemplate("summary", "summary-statistics", "Summary", 16, 0, 8, 14),
      elementTemplate("histogram", "histogram", "Distribution", 0, 18, 12, 18, {
        title: "Distribution",
      }),
      elementTemplate("box", "box-plot", "Variation", 12, 18, 12, 18, {
        title: "Variation",
      }),
      elementTemplate("records", "data-table", "Observations", 0, 36, 24, 16, {
        title: "Observations",
      }),
    ],
  }),
  layoutPreset({
    id: "trend-analysis",
    name: "Trend Analysis",
    category: "statistics",
    description: "Trend, summary, period comparison, and observations.",
    iconName: "ChartSpline",
    elements: [
      elementTemplate("trend", "line-chart", "Trend", 0, 0, 16, 18, {
        title: "Trend",
      }),
      elementTemplate("summary", "summary-statistics", "Summary", 16, 0, 8, 14),
      elementTemplate("periods", "bar-chart", "Periods", 0, 18, 12, 18, {
        title: "Periods",
      }),
      elementTemplate("records", "data-table", "Observations", 12, 18, 12, 18, {
        title: "Observations",
      }),
    ],
  }),
] as const satisfies readonly LayoutPresetDefinition[];
