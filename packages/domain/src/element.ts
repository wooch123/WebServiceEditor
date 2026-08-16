export const ELEMENT_SCHEMA_VERSION = 1 as const;
export const ELEMENT_TYPE_VERSION = 1 as const;
export const ELEMENT_REGISTRY_SCHEMA_VERSION = 1 as const;
export const EDITABLE_BREAKPOINT = "desktop" as const;

export const CANVAS_GRID = {
  columns: 24,
  rowHeight: 8,
  gap: 8,
  padding: 16,
} as const;

export const ELEMENT_TYPES = [
  "text",
  "button",
  "container",
  "kpi-card",
  "number-input",
  "data-table",
  "line-chart",
  "bar-chart",
  "histogram",
  "scatter-plot",
  "box-plot",
  "summary-statistics",
  "heading",
  "divider",
  "image",
  "badge",
  "icon",
  "link",
  "spacer",
  "tabs",
  "accordion",
] as const;
export const STATISTICAL_ELEMENT_TYPES = [
  "line-chart",
  "bar-chart",
  "histogram",
  "scatter-plot",
  "box-plot",
  "summary-statistics",
] as const satisfies readonly ElementType[];
export const ELEMENT_PROPERTY_TABS = [
  { id: "general", label: "General" },
  { id: "style", label: "Style" },
  { id: "data", label: "Data" },
  { id: "interaction", label: "Interaction" },
  { id: "validation", label: "Validation" },
  { id: "advanced", label: "Advanced" },
] as const;
export const ELEMENT_RENDER_STATES = [
  "EMPTY",
  "LOADING",
  "ERROR",
  "DATA",
] as const;
export const ELEMENT_BINDING_STATUSES = [
  "NOT_APPLICABLE",
  "UNCONNECTED",
  "CONNECTED",
  "WARNING",
  "ERROR",
] as const;
export const ELEMENT_HISTORY_STATES = [
  "APPLIED",
  "UNDONE",
  "DISCARDED",
] as const;
export const ELEMENT_COMMAND_TYPES = [
  "ADD",
  "MOVE",
  "RESIZE",
  "LOCK",
  "BATCH_LAYOUT",
  "DELETE",
  "PROPERTIES",
  "PRESET_APPLY",
] as const;
export const RESIZE_HANDLES = [
  "n",
  "s",
  "e",
  "w",
  "ne",
  "nw",
  "se",
  "sw",
] as const;
export const BATCH_LAYOUT_MODES = ["COMPLETE", "PARTIAL"] as const;

export type ElementType = (typeof ELEMENT_TYPES)[number];
export type ResizeHandle = (typeof RESIZE_HANDLES)[number];
export type BatchLayoutMode = (typeof BATCH_LAYOUT_MODES)[number];
export type EditableBreakpoint = typeof EDITABLE_BREAKPOINT;
export type ElementPropertyTabId = (typeof ELEMENT_PROPERTY_TABS)[number]["id"];
export type ElementRenderState = (typeof ELEMENT_RENDER_STATES)[number];
export type ElementBindingStatus = (typeof ELEMENT_BINDING_STATUSES)[number];
export type ElementHistoryState = (typeof ELEMENT_HISTORY_STATES)[number];
export type ElementCommandType = (typeof ELEMENT_COMMAND_TYPES)[number];
export type ElementPropertyValue = string | number | boolean | null;

export interface ElementPropertyOption {
  readonly value: string;
  readonly label: string;
}

export interface ElementPropertyField {
  readonly id: string;
  readonly tab: ElementPropertyTabId;
  readonly label: string;
  readonly control:
    | "text"
    | "textarea"
    | "number"
    | "slider"
    | "switch"
    | "select"
    | "theme-token"
    | "color"
    | "icon"
    | "field-ref"
    | "page-ref"
    | "binding-ref"
    | "read-only"
    | "binding-status";
  readonly valueType: "string" | "number" | "boolean" | "enum";
  readonly target: "element" | "props" | "style" | "layout" | "computed";
  readonly required: boolean;
  readonly readOnly: boolean;
  readonly description?: string;
  readonly options?: readonly ElementPropertyOption[];
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly maxLength?: number;
}

export interface ElementPropertySchema {
  readonly fields: readonly ElementPropertyField[];
}

export interface ElementBindingPortDefinition {
  readonly id: string;
  readonly label: string;
  readonly direction: "input" | "output";
  readonly side: "left" | "right";
  readonly valueType: string;
  readonly required: boolean;
  readonly maxConnections: number | null;
}

export interface ElementEventDefinition {
  readonly id: string;
  readonly label: string;
}

export interface ElementMigrationDefinition {
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly migrationKey: string;
}

export interface ElementSizeRule {
  readonly defaultW: number;
  readonly defaultH: number;
  readonly minW: number;
  readonly minH: number;
  readonly maxW: number;
  readonly maxH: number;
}

export interface ElementDefinition {
  readonly type: ElementType;
  readonly typeVersion: typeof ELEMENT_TYPE_VERSION;
  readonly label: string;
  readonly description: string;
  readonly category: "basic" | "input" | "data" | "statistics";
  readonly iconName: string;
  readonly rendererKey: ElementType;
  readonly editorRendererKey: ElementType;
  readonly runtimeRendererKey: ElementType;
  readonly validatorKey: ElementType;
  readonly defaultName: string;
  readonly defaultProps: Readonly<Record<string, unknown>>;
  readonly defaultStyle: Readonly<Record<string, unknown>>;
  readonly defaultEvents: readonly unknown[];
  readonly layout: ElementSizeRule;
  readonly propertySchema: ElementPropertySchema;
  readonly bindingPorts: readonly ElementBindingPortDefinition[];
  readonly events: readonly ElementEventDefinition[];
  readonly supportedRenderStates: readonly ElementRenderState[];
  readonly migrations: readonly ElementMigrationDefinition[];
}

const semanticTokenOptions = [
  { value: "background", label: "Background" },
  { value: "foreground", label: "Foreground" },
  { value: "card", label: "Card" },
  { value: "card-foreground", label: "Card Foreground" },
  { value: "primary", label: "Primary" },
  { value: "primary-foreground", label: "Primary Foreground" },
  { value: "secondary", label: "Secondary" },
  { value: "secondary-foreground", label: "Secondary Foreground" },
  { value: "muted", label: "Muted" },
  { value: "muted-foreground", label: "Muted Foreground" },
  { value: "accent", label: "Accent" },
  { value: "accent-foreground", label: "Accent Foreground" },
  { value: "destructive", label: "Destructive" },
  { value: "border", label: "Border" },
  { value: "input", label: "Input" },
  { value: "ring", label: "Ring" },
] as const satisfies readonly ElementPropertyOption[];

const commonPropertyFields = [
  {
    id: "general.displayName",
    tab: "general",
    label: "Display Name",
    control: "text",
    valueType: "string",
    target: "element",
    required: true,
    readOnly: false,
    maxLength: 120,
  },
  {
    id: "general.internalName",
    tab: "general",
    label: "Internal Name",
    control: "text",
    valueType: "string",
    target: "props",
    required: true,
    readOnly: false,
    maxLength: 120,
  },
  {
    id: "general.elementId",
    tab: "general",
    label: "Element ID",
    control: "read-only",
    valueType: "string",
    target: "computed",
    required: true,
    readOnly: true,
  },
  {
    id: "general.visible",
    tab: "general",
    label: "Visible",
    control: "switch",
    valueType: "boolean",
    target: "element",
    required: true,
    readOnly: false,
  },
  {
    id: "general.disabled",
    tab: "general",
    label: "Disabled",
    control: "switch",
    valueType: "boolean",
    target: "props",
    required: true,
    readOnly: false,
  },
  {
    id: "general.locked",
    tab: "general",
    label: "Locked",
    control: "switch",
    valueType: "boolean",
    target: "element",
    required: true,
    readOnly: false,
  },
  {
    id: "general.tooltip",
    tab: "general",
    label: "Tooltip",
    control: "text",
    valueType: "string",
    target: "props",
    required: false,
    readOnly: false,
    maxLength: 500,
  },
  {
    id: "general.accessibilityLabel",
    tab: "general",
    label: "Accessibility Label",
    control: "text",
    valueType: "string",
    target: "props",
    required: false,
    readOnly: false,
    maxLength: 240,
  },
  {
    id: "style.width",
    tab: "style",
    label: "Width",
    control: "read-only",
    valueType: "number",
    target: "layout",
    required: true,
    readOnly: true,
  },
  {
    id: "style.height",
    tab: "style",
    label: "Height",
    control: "read-only",
    valueType: "number",
    target: "layout",
    required: true,
    readOnly: true,
  },
  {
    id: "style.padding",
    tab: "style",
    label: "Padding",
    control: "slider",
    valueType: "number",
    target: "style",
    required: true,
    readOnly: false,
    min: 0,
    max: 64,
    step: 1,
  },
  {
    id: "style.margin",
    tab: "style",
    label: "Margin",
    control: "slider",
    valueType: "number",
    target: "style",
    required: true,
    readOnly: false,
    min: 0,
    max: 64,
    step: 1,
  },
  {
    id: "style.backgroundToken",
    tab: "style",
    label: "Background",
    control: "theme-token",
    valueType: "enum",
    target: "style",
    required: true,
    readOnly: false,
    options: semanticTokenOptions,
  },
  {
    id: "style.backgroundCustom",
    tab: "style",
    label: "Custom Background",
    control: "color",
    valueType: "string",
    target: "style",
    required: false,
    readOnly: false,
    maxLength: 32,
  },
  {
    id: "style.borderToken",
    tab: "style",
    label: "Border",
    control: "theme-token",
    valueType: "enum",
    target: "style",
    required: true,
    readOnly: false,
    options: semanticTokenOptions,
  },
  {
    id: "style.borderWidth",
    tab: "style",
    label: "Border Width",
    control: "slider",
    valueType: "number",
    target: "style",
    required: true,
    readOnly: false,
    min: 0,
    max: 8,
    step: 1,
  },
  {
    id: "style.borderStyle",
    tab: "style",
    label: "Border Style",
    control: "select",
    valueType: "enum",
    target: "style",
    required: true,
    readOnly: false,
    options: [
      { value: "solid", label: "Solid" },
      { value: "dashed", label: "Dashed" },
      { value: "dotted", label: "Dotted" },
      { value: "none", label: "None" },
    ],
  },
  {
    id: "style.radius",
    tab: "style",
    label: "Radius",
    control: "slider",
    valueType: "number",
    target: "style",
    required: true,
    readOnly: false,
    min: 0,
    max: 48,
    step: 1,
  },
  {
    id: "style.shadow",
    tab: "style",
    label: "Shadow",
    control: "select",
    valueType: "enum",
    target: "style",
    required: true,
    readOnly: false,
    options: [
      { value: "none", label: "None" },
      { value: "sm", label: "Small" },
      { value: "md", label: "Medium" },
      { value: "lg", label: "Large" },
    ],
  },
  {
    id: "style.textColorToken",
    tab: "style",
    label: "Text Color",
    control: "theme-token",
    valueType: "enum",
    target: "style",
    required: true,
    readOnly: false,
    options: semanticTokenOptions,
  },
  {
    id: "style.fontSize",
    tab: "style",
    label: "Font Size",
    control: "slider",
    valueType: "number",
    target: "style",
    required: true,
    readOnly: false,
    min: 10,
    max: 72,
    step: 1,
  },
  {
    id: "style.fontWeight",
    tab: "style",
    label: "Font Weight",
    control: "select",
    valueType: "enum",
    target: "style",
    required: true,
    readOnly: false,
    options: [
      { value: "400", label: "Regular" },
      { value: "500", label: "Medium" },
      { value: "600", label: "Semibold" },
      { value: "700", label: "Bold" },
    ],
  },
  {
    id: "style.contentAlign",
    tab: "style",
    label: "Content Align",
    control: "select",
    valueType: "enum",
    target: "style",
    required: true,
    readOnly: false,
    options: [
      { value: "start", label: "Start" },
      { value: "center", label: "Center" },
      { value: "end", label: "End" },
      { value: "stretch", label: "Stretch" },
    ],
  },
  {
    id: "style.textAlign",
    tab: "style",
    label: "Text Align",
    control: "select",
    valueType: "enum",
    target: "style",
    required: true,
    readOnly: false,
    options: [
      { value: "left", label: "Left" },
      { value: "center", label: "Center" },
      { value: "right", label: "Right" },
    ],
  },
  {
    id: "data.bindingStatus",
    tab: "data",
    label: "Binding Status",
    control: "binding-status",
    valueType: "string",
    target: "computed",
    required: true,
    readOnly: true,
  },
  {
    id: "interaction.supportedEvents",
    tab: "interaction",
    label: "Events",
    control: "read-only",
    valueType: "string",
    target: "computed",
    required: true,
    readOnly: true,
  },
  {
    id: "validation.status",
    tab: "validation",
    label: "Status",
    control: "read-only",
    valueType: "string",
    target: "computed",
    required: true,
    readOnly: true,
  },
  {
    id: "advanced.type",
    tab: "advanced",
    label: "Type",
    control: "read-only",
    valueType: "string",
    target: "computed",
    required: true,
    readOnly: true,
  },
  {
    id: "advanced.typeVersion",
    tab: "advanced",
    label: "Type Version",
    control: "read-only",
    valueType: "number",
    target: "computed",
    required: true,
    readOnly: true,
  },
] as const satisfies readonly ElementPropertyField[];

const commonDefaultStyle = {
  padding: 8,
  margin: 0,
  backgroundToken: "card",
  backgroundCustom: "",
  borderToken: "border",
  borderWidth: 1,
  borderStyle: "solid",
  radius: 8,
  shadow: "none",
  textColorToken: "foreground",
  fontSize: 12,
  fontWeight: "400",
  textAlign: "left",
  contentAlign: "start",
} as const;

const statisticalTitleFields = [
  {
    id: "general.title",
    tab: "general",
    label: "Title",
    control: "text",
    valueType: "string",
    target: "props",
    required: true,
    readOnly: false,
    maxLength: 240,
  },
  {
    id: "data.emptyLabel",
    tab: "data",
    label: "Empty Label",
    control: "text",
    valueType: "string",
    target: "props",
    required: true,
    readOnly: false,
    maxLength: 500,
  },
] as const satisfies readonly ElementPropertyField[];

const statisticalAxisFields = [
  {
    id: "data.xLabel",
    tab: "data",
    label: "X Axis",
    control: "text",
    valueType: "string",
    target: "props",
    required: true,
    readOnly: false,
    maxLength: 120,
  },
  {
    id: "data.yLabel",
    tab: "data",
    label: "Y Axis",
    control: "text",
    valueType: "string",
    target: "props",
    required: true,
    readOnly: false,
    maxLength: 120,
  },
] as const satisfies readonly ElementPropertyField[];

const statisticalChartFields = [
  {
    id: "data.showLegend",
    tab: "data",
    label: "Legend",
    control: "switch",
    valueType: "boolean",
    target: "props",
    required: true,
    readOnly: false,
  },
  {
    id: "data.showGrid",
    tab: "data",
    label: "Grid",
    control: "switch",
    valueType: "boolean",
    target: "props",
    required: true,
    readOnly: false,
  },
] as const satisfies readonly ElementPropertyField[];

const statisticalChartLayout = {
  defaultW: 12,
  defaultH: 18,
  minW: 6,
  minH: 12,
  maxW: 24,
  maxH: 60,
} as const;

function textProperty(
  id: string,
  tab: ElementPropertyTabId,
  label: string,
  control: "text" | "textarea" | "icon" = "text",
  required = true,
): ElementPropertyField {
  return {
    id,
    tab,
    label,
    control,
    valueType: "string",
    target: "props",
    required,
    readOnly: false,
    maxLength: control === "textarea" ? 10_000 : 2_048,
  };
}

function selectProperty(
  id: string,
  tab: ElementPropertyTabId,
  label: string,
  options: readonly ElementPropertyOption[],
): ElementPropertyField {
  return {
    id,
    tab,
    label,
    control: "select",
    valueType: "enum",
    target: "props",
    required: true,
    readOnly: false,
    options,
  };
}

interface AdditionalBasicElementSpec {
  readonly type: Extract<
    ElementType,
    | "heading"
    | "divider"
    | "image"
    | "badge"
    | "icon"
    | "link"
    | "spacer"
    | "tabs"
    | "accordion"
  >;
  readonly label: string;
  readonly description: string;
  readonly iconName: string;
  readonly defaultName: string;
  readonly defaultProps: Readonly<Record<string, unknown>>;
  readonly layout: ElementSizeRule;
  readonly fields: readonly ElementPropertyField[];
  readonly events: readonly ElementEventDefinition[];
}

const additionalBasicElementSpecs = [
  {
    type: "heading",
    label: "Heading",
    description: "Semantic section heading.",
    iconName: "Heading",
    defaultName: "Heading",
    defaultProps: { text: "Heading", level: "2" },
    layout: { defaultW: 10, defaultH: 5, minW: 3, minH: 3, maxW: 24, maxH: 12 },
    fields: [
      textProperty("general.text", "general", "Text", "textarea"),
      selectProperty("general.level", "general", "Level", [
        { value: "1", label: "H1" },
        { value: "2", label: "H2" },
        { value: "3", label: "H3" },
        { value: "4", label: "H4" },
        { value: "5", label: "H5" },
        { value: "6", label: "H6" },
      ]),
    ],
    events: [],
  },
  {
    type: "divider",
    label: "Divider",
    description: "Horizontal or vertical content separator.",
    iconName: "Minus",
    defaultName: "Divider",
    defaultProps: { orientation: "horizontal" },
    layout: { defaultW: 12, defaultH: 3, minW: 2, minH: 2, maxW: 24, maxH: 24 },
    fields: [
      selectProperty("general.orientation", "general", "Orientation", [
        { value: "horizontal", label: "Horizontal" },
        { value: "vertical", label: "Vertical" },
      ]),
    ],
    events: [],
  },
  {
    type: "image",
    label: "Image",
    description: "Accessible image from an HTTPS or data URL.",
    iconName: "Image",
    defaultName: "Image",
    defaultProps: { src: "", alt: "Image", objectFit: "cover" },
    layout: { defaultW: 8, defaultH: 12, minW: 3, minH: 4, maxW: 24, maxH: 60 },
    fields: [
      textProperty("general.src", "general", "Source", "text", false),
      textProperty("general.alt", "general", "Alternative Text"),
      selectProperty("style.objectFit", "style", "Fit", [
        { value: "cover", label: "Cover" },
        { value: "contain", label: "Contain" },
        { value: "fill", label: "Fill" },
      ]),
    ],
    events: [{ id: "onClick", label: "Click" }],
  },
  {
    type: "badge",
    label: "Badge",
    description: "Compact semantic status label.",
    iconName: "Badge",
    defaultName: "Badge",
    defaultProps: { label: "Badge", variant: "secondary" },
    layout: { defaultW: 4, defaultH: 4, minW: 2, minH: 3, maxW: 12, maxH: 8 },
    fields: [
      textProperty("general.label", "general", "Label"),
      selectProperty("style.variant", "style", "Variant", [
        { value: "default", label: "Default" },
        { value: "secondary", label: "Secondary" },
        { value: "destructive", label: "Destructive" },
        { value: "outline", label: "Outline" },
      ]),
    ],
    events: [],
  },
  {
    type: "icon",
    label: "Icon",
    description: "Lucide icon with an accessible label.",
    iconName: "Info",
    defaultName: "Icon",
    defaultProps: { iconName: "Info", label: "Information" },
    layout: { defaultW: 3, defaultH: 5, minW: 2, minH: 3, maxW: 10, maxH: 12 },
    fields: [
      textProperty("general.iconName", "general", "Icon", "icon"),
      textProperty("general.label", "general", "Accessible Label"),
    ],
    events: [{ id: "onClick", label: "Click" }],
  },
  {
    type: "link",
    label: "Link",
    description: "Accessible internal or HTTPS link.",
    iconName: "Link",
    defaultName: "Link",
    defaultProps: { label: "Link", href: "/", newTab: false },
    layout: { defaultW: 5, defaultH: 4, minW: 2, minH: 3, maxW: 16, maxH: 8 },
    fields: [
      textProperty("general.label", "general", "Label"),
      textProperty("interaction.href", "interaction", "Destination"),
      {
        id: "interaction.newTab",
        tab: "interaction",
        label: "Open in New Tab",
        control: "switch",
        valueType: "boolean",
        target: "props",
        required: true,
        readOnly: false,
      },
    ],
    events: [{ id: "onClick", label: "Click" }],
  },
  {
    type: "spacer",
    label: "Spacer",
    description: "Intentional empty layout space.",
    iconName: "Space",
    defaultName: "Spacer",
    defaultProps: {},
    layout: { defaultW: 6, defaultH: 4, minW: 1, minH: 1, maxW: 24, maxH: 40 },
    fields: [],
    events: [],
  },
  {
    type: "tabs",
    label: "Tabs",
    description: "Keyboard-accessible tabbed sections.",
    iconName: "PanelsTopLeft",
    defaultName: "Tabs",
    defaultProps: { items: "Overview,Details", defaultTab: "Overview" },
    layout: {
      defaultW: 12,
      defaultH: 12,
      minW: 6,
      minH: 8,
      maxW: 24,
      maxH: 40,
    },
    fields: [
      textProperty("data.items", "data", "Tabs"),
      textProperty("general.defaultTab", "general", "Default Tab"),
    ],
    events: [{ id: "onTabChange", label: "Tab Change" }],
  },
  {
    type: "accordion",
    label: "Accordion",
    description: "Keyboard-accessible collapsible sections.",
    iconName: "ListCollapse",
    defaultName: "Accordion",
    defaultProps: { items: "Section 1,Section 2", defaultItem: "Section 1" },
    layout: {
      defaultW: 12,
      defaultH: 14,
      minW: 6,
      minH: 8,
      maxW: 24,
      maxH: 50,
    },
    fields: [
      textProperty("data.items", "data", "Sections"),
      textProperty("general.defaultItem", "general", "Default Section"),
    ],
    events: [{ id: "onSectionChange", label: "Section Change" }],
  },
] as const satisfies readonly AdditionalBasicElementSpec[];

function additionalBasicDefinition(
  spec: AdditionalBasicElementSpec,
): ElementDefinition {
  return {
    type: spec.type,
    typeVersion: ELEMENT_TYPE_VERSION,
    label: spec.label,
    description: spec.description,
    category: "basic",
    iconName: spec.iconName,
    rendererKey: spec.type,
    editorRendererKey: spec.type,
    runtimeRendererKey: spec.type,
    validatorKey: spec.type,
    defaultName: spec.defaultName,
    defaultProps: {
      internalName: spec.type.replaceAll("-", "_"),
      disabled: false,
      tooltip: "",
      accessibilityLabel: spec.defaultName,
      ...spec.defaultProps,
    },
    defaultStyle: commonDefaultStyle,
    defaultEvents: [],
    layout: spec.layout,
    propertySchema: { fields: [...commonPropertyFields, ...spec.fields] },
    bindingPorts: [],
    events: spec.events,
    supportedRenderStates: ["DATA"],
    migrations: [],
  };
}

export const ELEMENT_DEFINITIONS = [
  {
    type: "text",
    typeVersion: ELEMENT_TYPE_VERSION,
    label: "Text",
    description: "Plain text content.",
    category: "basic",
    iconName: "Type",
    rendererKey: "text",
    editorRendererKey: "text",
    runtimeRendererKey: "text",
    validatorKey: "text",
    defaultName: "Text",
    defaultProps: {
      internalName: "text",
      text: "Text",
      disabled: false,
      tooltip: "",
      accessibilityLabel: "Text",
    },
    defaultStyle: commonDefaultStyle,
    defaultEvents: [],
    layout: { defaultW: 6, defaultH: 5, minW: 2, minH: 3, maxW: 24, maxH: 20 },
    propertySchema: {
      fields: [
        ...commonPropertyFields,
        {
          id: "general.text",
          tab: "general",
          label: "Text",
          control: "textarea",
          valueType: "string",
          target: "props",
          required: true,
          readOnly: false,
          maxLength: 10_000,
        },
      ],
    },
    bindingPorts: [],
    events: [{ id: "onClick", label: "Click" }],
    supportedRenderStates: ["DATA"],
    migrations: [],
  },
  {
    type: "button",
    typeVersion: ELEMENT_TYPE_VERSION,
    label: "Button",
    description: "Action button.",
    category: "basic",
    iconName: "RectangleHorizontal",
    rendererKey: "button",
    editorRendererKey: "button",
    runtimeRendererKey: "button",
    validatorKey: "button",
    defaultName: "Button",
    defaultProps: {
      internalName: "button",
      label: "Button",
      disabled: false,
      tooltip: "",
      accessibilityLabel: "Button",
    },
    defaultStyle: commonDefaultStyle,
    defaultEvents: [],
    layout: { defaultW: 4, defaultH: 5, minW: 2, minH: 4, maxW: 12, maxH: 10 },
    propertySchema: {
      fields: [
        ...commonPropertyFields,
        {
          id: "general.label",
          tab: "general",
          label: "Label",
          control: "text",
          valueType: "string",
          target: "props",
          required: true,
          readOnly: false,
          maxLength: 240,
        },
      ],
    },
    bindingPorts: [
      {
        id: "click",
        label: "Click",
        direction: "output",
        side: "right",
        valueType: "event",
        required: false,
        maxConnections: null,
      },
    ],
    events: [
      { id: "onClick", label: "Click" },
      { id: "onDoubleClick", label: "Double Click" },
    ],
    supportedRenderStates: ["DATA"],
    migrations: [],
  },
  {
    type: "container",
    typeVersion: ELEMENT_TYPE_VERSION,
    label: "Container",
    description: "Visual grouping container.",
    category: "basic",
    iconName: "PanelTop",
    rendererKey: "container",
    editorRendererKey: "container",
    runtimeRendererKey: "container",
    validatorKey: "container",
    defaultName: "Container",
    defaultProps: {
      internalName: "container",
      label: "Container",
      disabled: false,
      tooltip: "",
      accessibilityLabel: "Container",
    },
    defaultStyle: commonDefaultStyle,
    defaultEvents: [],
    layout: {
      defaultW: 12,
      defaultH: 12,
      minW: 4,
      minH: 6,
      maxW: 24,
      maxH: 60,
    },
    propertySchema: {
      fields: [
        ...commonPropertyFields,
        {
          id: "general.label",
          tab: "general",
          label: "Label",
          control: "text",
          valueType: "string",
          target: "props",
          required: false,
          readOnly: false,
          maxLength: 240,
        },
      ],
    },
    bindingPorts: [],
    events: [{ id: "onLoad", label: "Load" }],
    supportedRenderStates: ["DATA"],
    migrations: [],
  },
  {
    type: "kpi-card",
    typeVersion: ELEMENT_TYPE_VERSION,
    label: "KPI Card",
    description: "Key performance value display.",
    category: "statistics",
    iconName: "ChartNoAxesCombined",
    rendererKey: "kpi-card",
    editorRendererKey: "kpi-card",
    runtimeRendererKey: "kpi-card",
    validatorKey: "kpi-card",
    defaultName: "KPI Card",
    defaultProps: {
      internalName: "kpiCard",
      label: "Value",
      value: "0",
      suffix: "",
      disabled: false,
      tooltip: "",
      accessibilityLabel: "KPI Card",
    },
    defaultStyle: commonDefaultStyle,
    defaultEvents: [],
    layout: { defaultW: 6, defaultH: 10, minW: 4, minH: 8, maxW: 12, maxH: 20 },
    propertySchema: {
      fields: [
        ...commonPropertyFields,
        {
          id: "general.label",
          tab: "general",
          label: "Label",
          control: "text",
          valueType: "string",
          target: "props",
          required: true,
          readOnly: false,
          maxLength: 240,
        },
        {
          id: "data.value",
          tab: "data",
          label: "Value",
          control: "text",
          valueType: "string",
          target: "props",
          required: true,
          readOnly: false,
          maxLength: 240,
        },
        {
          id: "data.suffix",
          tab: "data",
          label: "Suffix",
          control: "text",
          valueType: "string",
          target: "props",
          required: false,
          readOnly: false,
          maxLength: 80,
        },
      ],
    },
    bindingPorts: [
      {
        id: "value",
        label: "Value",
        direction: "input",
        side: "left",
        valueType: "number",
        required: true,
        maxConnections: 1,
      },
    ],
    events: [{ id: "onClick", label: "Click" }],
    supportedRenderStates: ELEMENT_RENDER_STATES,
    migrations: [],
  },
  {
    type: "number-input",
    typeVersion: ELEMENT_TYPE_VERSION,
    label: "Number Input",
    description: "Validated numeric input.",
    category: "input",
    iconName: "ListOrdered",
    rendererKey: "number-input",
    editorRendererKey: "number-input",
    runtimeRendererKey: "number-input",
    validatorKey: "number-input",
    defaultName: "Number Input",
    defaultProps: {
      internalName: "numberInput",
      label: "Number",
      placeholder: "0",
      defaultValue: 0,
      required: false,
      minimum: null,
      maximum: null,
      step: 1,
      disabled: false,
      tooltip: "",
      accessibilityLabel: "Number",
    },
    defaultStyle: commonDefaultStyle,
    defaultEvents: [],
    layout: { defaultW: 6, defaultH: 7, minW: 3, minH: 5, maxW: 12, maxH: 14 },
    propertySchema: {
      fields: [
        ...commonPropertyFields,
        {
          id: "general.label",
          tab: "general",
          label: "Label",
          control: "text",
          valueType: "string",
          target: "props",
          required: true,
          readOnly: false,
          maxLength: 240,
        },
        {
          id: "general.placeholder",
          tab: "general",
          label: "Placeholder",
          control: "text",
          valueType: "string",
          target: "props",
          required: false,
          readOnly: false,
          maxLength: 240,
        },
        {
          id: "data.defaultValue",
          tab: "data",
          label: "Default Value",
          control: "number",
          valueType: "number",
          target: "props",
          required: true,
          readOnly: false,
          min: -1_000_000_000,
          max: 1_000_000_000,
        },
        {
          id: "validation.required",
          tab: "validation",
          label: "Required",
          control: "switch",
          valueType: "boolean",
          target: "props",
          required: true,
          readOnly: false,
        },
        {
          id: "validation.minimum",
          tab: "validation",
          label: "Minimum",
          control: "number",
          valueType: "number",
          target: "props",
          required: false,
          readOnly: false,
          min: -1_000_000_000,
          max: 1_000_000_000,
        },
        {
          id: "validation.maximum",
          tab: "validation",
          label: "Maximum",
          control: "number",
          valueType: "number",
          target: "props",
          required: false,
          readOnly: false,
          min: -1_000_000_000,
          max: 1_000_000_000,
        },
        {
          id: "validation.step",
          tab: "validation",
          label: "Step",
          control: "number",
          valueType: "number",
          target: "props",
          required: true,
          readOnly: false,
          min: 0.000_001,
          max: 1_000_000_000,
        },
      ],
    },
    bindingPorts: [
      {
        id: "value",
        label: "Value",
        direction: "output",
        side: "right",
        valueType: "number",
        required: false,
        maxConnections: null,
      },
    ],
    events: [
      { id: "onChange", label: "Change" },
      { id: "onSubmit", label: "Submit" },
    ],
    supportedRenderStates: ["EMPTY", "ERROR", "DATA"],
    migrations: [],
  },
  {
    type: "data-table",
    typeVersion: ELEMENT_TYPE_VERSION,
    label: "Data Table",
    description: "Tabular data display.",
    category: "data",
    iconName: "Table2",
    rendererKey: "data-table",
    editorRendererKey: "data-table",
    runtimeRendererKey: "data-table",
    validatorKey: "data-table",
    defaultName: "Data Table",
    defaultProps: {
      internalName: "dataTable",
      title: "Data",
      emptyLabel: "No data",
      disabled: false,
      tooltip: "",
      accessibilityLabel: "Data Table",
    },
    defaultStyle: { ...commonDefaultStyle, density: "comfortable" },
    defaultEvents: [],
    layout: {
      defaultW: 12,
      defaultH: 16,
      minW: 6,
      minH: 10,
      maxW: 24,
      maxH: 60,
    },
    propertySchema: {
      fields: [
        ...commonPropertyFields,
        {
          id: "general.title",
          tab: "general",
          label: "Title",
          control: "text",
          valueType: "string",
          target: "props",
          required: true,
          readOnly: false,
          maxLength: 240,
        },
        {
          id: "data.emptyLabel",
          tab: "data",
          label: "Empty Label",
          control: "text",
          valueType: "string",
          target: "props",
          required: true,
          readOnly: false,
          maxLength: 500,
        },
        {
          id: "style.density",
          tab: "style",
          label: "Density",
          control: "select",
          valueType: "enum",
          target: "style",
          required: true,
          readOnly: false,
          options: [
            { value: "compact", label: "Compact" },
            { value: "comfortable", label: "Comfortable" },
            { value: "spacious", label: "Spacious" },
          ],
        },
      ],
    },
    bindingPorts: [
      {
        id: "rows",
        label: "Rows",
        direction: "input",
        side: "left",
        valueType: "records",
        required: true,
        maxConnections: 1,
      },
      {
        id: "selection",
        label: "Selection",
        direction: "output",
        side: "right",
        valueType: "record",
        required: false,
        maxConnections: null,
      },
    ],
    events: [
      { id: "onRowClick", label: "Row Click" },
      { id: "onSelectionChange", label: "Selection Change" },
    ],
    supportedRenderStates: ELEMENT_RENDER_STATES,
    migrations: [],
  },
  {
    type: "line-chart",
    typeVersion: ELEMENT_TYPE_VERSION,
    label: "Line Chart",
    description: "Trend series across an ordered axis.",
    category: "statistics",
    iconName: "ChartSpline",
    rendererKey: "line-chart",
    editorRendererKey: "line-chart",
    runtimeRendererKey: "line-chart",
    validatorKey: "line-chart",
    defaultName: "Line Chart",
    defaultProps: {
      internalName: "lineChart",
      title: "Line Chart",
      emptyLabel: "No data",
      xLabel: "X",
      yLabel: "Y",
      showLegend: true,
      showGrid: true,
      curve: "monotone",
      disabled: false,
      tooltip: "",
      accessibilityLabel: "Line Chart",
    },
    defaultStyle: commonDefaultStyle,
    defaultEvents: [],
    layout: statisticalChartLayout,
    propertySchema: {
      fields: [
        ...commonPropertyFields,
        ...statisticalTitleFields,
        ...statisticalAxisFields,
        ...statisticalChartFields,
        {
          id: "data.curve",
          tab: "data",
          label: "Curve",
          control: "select",
          valueType: "enum",
          target: "props",
          required: true,
          readOnly: false,
          options: [
            { value: "linear", label: "Linear" },
            { value: "monotone", label: "Monotone" },
            { value: "step", label: "Step" },
          ],
        },
      ],
    },
    bindingPorts: [
      {
        id: "series",
        label: "Series",
        direction: "input",
        side: "left",
        valueType: "chart-series",
        required: true,
        maxConnections: 1,
      },
      {
        id: "point",
        label: "Point",
        direction: "output",
        side: "right",
        valueType: "chart-point",
        required: false,
        maxConnections: null,
      },
    ],
    events: [{ id: "onPointClick", label: "Point Click" }],
    supportedRenderStates: ELEMENT_RENDER_STATES,
    migrations: [],
  },
  {
    type: "bar-chart",
    typeVersion: ELEMENT_TYPE_VERSION,
    label: "Bar Chart",
    description: "Categorical comparison with vertical or horizontal bars.",
    category: "statistics",
    iconName: "ChartBarBig",
    rendererKey: "bar-chart",
    editorRendererKey: "bar-chart",
    runtimeRendererKey: "bar-chart",
    validatorKey: "bar-chart",
    defaultName: "Bar Chart",
    defaultProps: {
      internalName: "barChart",
      title: "Bar Chart",
      emptyLabel: "No data",
      xLabel: "Category",
      yLabel: "Value",
      showLegend: true,
      showGrid: true,
      orientation: "vertical",
      disabled: false,
      tooltip: "",
      accessibilityLabel: "Bar Chart",
    },
    defaultStyle: commonDefaultStyle,
    defaultEvents: [],
    layout: statisticalChartLayout,
    propertySchema: {
      fields: [
        ...commonPropertyFields,
        ...statisticalTitleFields,
        ...statisticalAxisFields,
        ...statisticalChartFields,
        {
          id: "data.orientation",
          tab: "data",
          label: "Orientation",
          control: "select",
          valueType: "enum",
          target: "props",
          required: true,
          readOnly: false,
          options: [
            { value: "vertical", label: "Vertical" },
            { value: "horizontal", label: "Horizontal" },
          ],
        },
      ],
    },
    bindingPorts: [
      {
        id: "series",
        label: "Series",
        direction: "input",
        side: "left",
        valueType: "chart-series",
        required: true,
        maxConnections: 1,
      },
      {
        id: "bar",
        label: "Bar",
        direction: "output",
        side: "right",
        valueType: "chart-point",
        required: false,
        maxConnections: null,
      },
    ],
    events: [{ id: "onBarClick", label: "Bar Click" }],
    supportedRenderStates: ELEMENT_RENDER_STATES,
    migrations: [],
  },
  {
    type: "histogram",
    typeVersion: ELEMENT_TYPE_VERSION,
    label: "Histogram",
    description: "Frequency distribution for numeric observations.",
    category: "statistics",
    iconName: "ChartBarBig",
    rendererKey: "histogram",
    editorRendererKey: "histogram",
    runtimeRendererKey: "histogram",
    validatorKey: "histogram",
    defaultName: "Histogram",
    defaultProps: {
      internalName: "histogram",
      title: "Histogram",
      emptyLabel: "No data",
      xLabel: "Value",
      yLabel: "Frequency",
      showGrid: true,
      binCount: 10,
      disabled: false,
      tooltip: "",
      accessibilityLabel: "Histogram",
    },
    defaultStyle: commonDefaultStyle,
    defaultEvents: [],
    layout: statisticalChartLayout,
    propertySchema: {
      fields: [
        ...commonPropertyFields,
        ...statisticalTitleFields,
        ...statisticalAxisFields,
        {
          id: "data.showGrid",
          tab: "data",
          label: "Grid",
          control: "switch",
          valueType: "boolean",
          target: "props",
          required: true,
          readOnly: false,
        },
        {
          id: "data.binCount",
          tab: "data",
          label: "Bins",
          control: "number",
          valueType: "number",
          target: "props",
          required: true,
          readOnly: false,
          min: 2,
          max: 100,
          step: 1,
        },
      ],
    },
    bindingPorts: [
      {
        id: "values",
        label: "Values",
        direction: "input",
        side: "left",
        valueType: "numbers",
        required: true,
        maxConnections: 1,
      },
      {
        id: "bin",
        label: "Bin",
        direction: "output",
        side: "right",
        valueType: "numeric-range",
        required: false,
        maxConnections: null,
      },
    ],
    events: [{ id: "onBinClick", label: "Bin Click" }],
    supportedRenderStates: ELEMENT_RENDER_STATES,
    migrations: [],
  },
  {
    type: "scatter-plot",
    typeVersion: ELEMENT_TYPE_VERSION,
    label: "Scatter Plot",
    description: "Relationship between paired numeric observations.",
    category: "statistics",
    iconName: "ChartScatter",
    rendererKey: "scatter-plot",
    editorRendererKey: "scatter-plot",
    runtimeRendererKey: "scatter-plot",
    validatorKey: "scatter-plot",
    defaultName: "Scatter Plot",
    defaultProps: {
      internalName: "scatterPlot",
      title: "Scatter Plot",
      emptyLabel: "No data",
      xLabel: "X",
      yLabel: "Y",
      showLegend: true,
      showGrid: true,
      showTrendline: false,
      disabled: false,
      tooltip: "",
      accessibilityLabel: "Scatter Plot",
    },
    defaultStyle: commonDefaultStyle,
    defaultEvents: [],
    layout: statisticalChartLayout,
    propertySchema: {
      fields: [
        ...commonPropertyFields,
        ...statisticalTitleFields,
        ...statisticalAxisFields,
        ...statisticalChartFields,
        {
          id: "data.showTrendline",
          tab: "data",
          label: "Trendline",
          control: "switch",
          valueType: "boolean",
          target: "props",
          required: true,
          readOnly: false,
        },
      ],
    },
    bindingPorts: [
      {
        id: "points",
        label: "Points",
        direction: "input",
        side: "left",
        valueType: "xy-points",
        required: true,
        maxConnections: 1,
      },
      {
        id: "point",
        label: "Point",
        direction: "output",
        side: "right",
        valueType: "xy-point",
        required: false,
        maxConnections: null,
      },
    ],
    events: [{ id: "onPointClick", label: "Point Click" }],
    supportedRenderStates: ELEMENT_RENDER_STATES,
    migrations: [],
  },
  {
    type: "box-plot",
    typeVersion: ELEMENT_TYPE_VERSION,
    label: "Box Plot",
    description: "Distribution quartiles and outliers by group.",
    category: "statistics",
    iconName: "ChartNoAxesCombined",
    rendererKey: "box-plot",
    editorRendererKey: "box-plot",
    runtimeRendererKey: "box-plot",
    validatorKey: "box-plot",
    defaultName: "Box Plot",
    defaultProps: {
      internalName: "boxPlot",
      title: "Box Plot",
      emptyLabel: "No data",
      xLabel: "Group",
      yLabel: "Value",
      showLegend: true,
      showGrid: true,
      showOutliers: true,
      disabled: false,
      tooltip: "",
      accessibilityLabel: "Box Plot",
    },
    defaultStyle: commonDefaultStyle,
    defaultEvents: [],
    layout: statisticalChartLayout,
    propertySchema: {
      fields: [
        ...commonPropertyFields,
        ...statisticalTitleFields,
        ...statisticalAxisFields,
        ...statisticalChartFields,
        {
          id: "data.showOutliers",
          tab: "data",
          label: "Outliers",
          control: "switch",
          valueType: "boolean",
          target: "props",
          required: true,
          readOnly: false,
        },
      ],
    },
    bindingPorts: [
      {
        id: "groups",
        label: "Groups",
        direction: "input",
        side: "left",
        valueType: "grouped-numbers",
        required: true,
        maxConnections: 1,
      },
      {
        id: "group",
        label: "Group",
        direction: "output",
        side: "right",
        valueType: "category",
        required: false,
        maxConnections: null,
      },
    ],
    events: [{ id: "onGroupClick", label: "Group Click" }],
    supportedRenderStates: ELEMENT_RENDER_STATES,
    migrations: [],
  },
  {
    type: "summary-statistics",
    typeVersion: ELEMENT_TYPE_VERSION,
    label: "Summary Statistics",
    description: "Count, center, spread, and range summary.",
    category: "statistics",
    iconName: "Sigma",
    rendererKey: "summary-statistics",
    editorRendererKey: "summary-statistics",
    runtimeRendererKey: "summary-statistics",
    validatorKey: "summary-statistics",
    defaultName: "Summary Statistics",
    defaultProps: {
      internalName: "summaryStatistics",
      title: "Summary Statistics",
      emptyLabel: "No data",
      precision: 2,
      showCount: true,
      showMean: true,
      showMedian: true,
      showStdDev: true,
      showMin: true,
      showMax: true,
      disabled: false,
      tooltip: "",
      accessibilityLabel: "Summary Statistics",
    },
    defaultStyle: commonDefaultStyle,
    defaultEvents: [],
    layout: {
      defaultW: 8,
      defaultH: 14,
      minW: 6,
      minH: 10,
      maxW: 24,
      maxH: 40,
    },
    propertySchema: {
      fields: [
        ...commonPropertyFields,
        ...statisticalTitleFields,
        {
          id: "data.precision",
          tab: "data",
          label: "Precision",
          control: "number",
          valueType: "number",
          target: "props",
          required: true,
          readOnly: false,
          min: 0,
          max: 8,
          step: 1,
        },
        ...[
          ["showCount", "Count"],
          ["showMean", "Mean"],
          ["showMedian", "Median"],
          ["showStdDev", "Standard Deviation"],
          ["showMin", "Minimum"],
          ["showMax", "Maximum"],
        ].map(([id, label]) => ({
          id: `data.${id}`,
          tab: "data" as const,
          label: label as string,
          control: "switch" as const,
          valueType: "boolean" as const,
          target: "props" as const,
          required: true,
          readOnly: false,
        })),
      ],
    },
    bindingPorts: [
      {
        id: "values",
        label: "Values",
        direction: "input",
        side: "left",
        valueType: "numbers",
        required: true,
        maxConnections: 1,
      },
    ],
    events: [{ id: "onStatisticClick", label: "Statistic Click" }],
    supportedRenderStates: ELEMENT_RENDER_STATES,
    migrations: [],
  },
  ...additionalBasicElementSpecs.map(additionalBasicDefinition),
] as const satisfies readonly ElementDefinition[];

export interface ElementDto {
  readonly id: string;
  readonly projectId: string;
  readonly pageId: string;
  readonly type: ElementType;
  readonly typeVersion: typeof ELEMENT_TYPE_VERSION;
  readonly name: string;
  readonly props: Readonly<Record<string, unknown>>;
  readonly style: Readonly<Record<string, unknown>>;
  readonly events: readonly unknown[];
  readonly locked: boolean;
  readonly hidden: boolean;
  readonly revision: number;
}

export interface ElementLayoutDto {
  readonly elementId: string;
  readonly breakpoint: EditableBreakpoint;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly minW: number;
  readonly minH: number;
  readonly maxW: number;
  readonly maxH: number;
}

export interface ElementEntryDto {
  readonly element: ElementDto;
  readonly layout: ElementLayoutDto;
}

export interface ElementListDto {
  readonly pageId: string;
  readonly breakpoint: EditableBreakpoint;
  readonly layoutRevision: number;
  readonly projectRevision: number;
  readonly elements: readonly ElementEntryDto[];
}

export interface ElementRegistryDto {
  readonly schemaVersion: typeof ELEMENT_REGISTRY_SCHEMA_VERSION;
  readonly tabs: typeof ELEMENT_PROPERTY_TABS;
  readonly definitions: readonly ElementDefinition[];
  readonly checksum: string;
}

export interface ElementBindingPortStatusDto {
  readonly portId: string;
  readonly status: "UNCONNECTED";
  readonly message: string;
}

export interface ElementBindingStatusDto {
  readonly status: "NOT_APPLICABLE" | "UNCONNECTED";
  readonly ports: readonly ElementBindingPortStatusDto[];
  readonly message: string;
}

export interface ElementRenderStateDto {
  readonly state: "EMPTY" | "DATA";
  readonly message: string | null;
}

export interface ElementInspectorDto {
  readonly entry: ElementEntryDto;
  readonly definition: ElementDefinition;
  readonly propertyValues: Readonly<Record<string, ElementPropertyValue>>;
  readonly bindingStatus: ElementBindingStatusDto;
  readonly renderState: ElementRenderStateDto;
}

export interface PublishedRuntimePageDto {
  readonly projectId: string;
  readonly versionId: string;
  readonly publishedAt: string;
  readonly page: {
    readonly id: string;
    readonly name: string;
    readonly route: string;
    readonly sortOrder: number;
    readonly iconName: string;
    readonly iconCatalogVersion: string;
    readonly navigationVisible: boolean;
    readonly navigationGroup: string | null;
  };
  readonly elements: readonly ElementEntryDto[];
}

export interface CanvasPointerDto {
  readonly rawCanvasX: number;
  readonly rawCanvasY: number;
  readonly correctedCanvasX: number;
  readonly correctedCanvasY: number;
}

export interface PlacementCandidateDto {
  readonly candidateId: string;
  readonly pageId: string;
  readonly elementType: ElementType;
  readonly breakpoint: EditableBreakpoint;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly valid: boolean;
  readonly collisionResolved: boolean;
  readonly layoutRevision: number;
  readonly projectRevision: number;
  readonly expiresAt: string;
}

export interface CreatePlacementCandidateRequest {
  readonly elementType: ElementType;
  readonly pointer: CanvasPointerDto;
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  readonly expectedLayoutRevision: number;
  readonly expectedProjectRevision: number;
}

export interface CreateElementRequest {
  readonly elementType: ElementType;
  readonly expectedLayoutRevision: number;
  readonly expectedProjectRevision: number;
  readonly idempotencyKey: string;
}

export interface CreateElementFromPlacementRequest {
  readonly candidateId: string;
  readonly expectedLayoutRevision: number;
  readonly expectedProjectRevision: number;
  readonly idempotencyKey: string;
}

export type ElementChange =
  | { readonly kind: "MOVE"; readonly x: number; readonly y: number }
  | {
      readonly kind: "RESIZE";
      readonly handle: ResizeHandle;
      readonly x: number;
      readonly y: number;
      readonly w: number;
      readonly h: number;
    }
  | { readonly kind: "LOCK"; readonly locked: boolean }
  | {
      readonly kind: "PROPERTIES";
      readonly values: Readonly<Record<string, ElementPropertyValue>>;
    };

export interface PatchElementRequest {
  readonly expectedRevision: number;
  readonly expectedLayoutRevision: number;
  readonly expectedProjectRevision: number;
  readonly idempotencyKey: string;
  readonly change: ElementChange;
}

export interface DeleteElementRequest {
  readonly expectedRevision: number;
  readonly expectedLayoutRevision: number;
  readonly expectedProjectRevision: number;
  readonly idempotencyKey: string;
}

export interface BatchLayoutItem {
  readonly elementId: string;
  readonly expectedRevision: number;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface BatchLayoutRequest {
  readonly pageId: string;
  readonly expectedLayoutRevision: number;
  readonly expectedProjectRevision: number;
  readonly idempotencyKey: string;
  readonly mode: BatchLayoutMode;
  readonly items: readonly BatchLayoutItem[];
}

export interface ElementMutationDto {
  readonly entry: ElementEntryDto;
  readonly layoutRevision: number;
  readonly projectRevision: number;
  readonly commandId: string;
}

export interface ElementCommandSummaryDto {
  readonly id: string;
  readonly pageId: string;
  readonly elementId: string | null;
  readonly type: ElementCommandType;
  readonly state: ElementHistoryState;
  readonly sequence: number;
  readonly createdAt: string;
}

export interface ElementHistoryDto {
  readonly projectId: string;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly undoCommand: ElementCommandSummaryDto | null;
  readonly redoCommand: ElementCommandSummaryDto | null;
  readonly commands: readonly ElementCommandSummaryDto[];
}

export interface ElementHistoryMutationRequest {
  readonly expectedProjectRevision: number;
  readonly expectedCommandId: string;
  readonly idempotencyKey: string;
}

export interface ElementHistoryMutationDto {
  readonly operation: "UNDO" | "REDO";
  readonly commandId: string;
  readonly pageId: string;
  readonly entries: readonly ElementEntryDto[];
  readonly deletedElementIds: readonly string[];
  readonly layoutRevision: number;
  readonly projectRevision: number;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}
