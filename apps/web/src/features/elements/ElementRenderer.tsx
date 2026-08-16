import {
  CircleAlert,
  Database,
  EyeOff,
  Image as ImageIcon,
  LockKeyhole,
} from "lucide-react";
import type { ComponentType } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type {
  ElementDefinitionDto,
  ElementEntryDto,
  ElementRenderState,
  ElementType,
} from "@/services/elements-api";
import { elementPresentation } from "./element-presentation";
import {
  DynamicLucideIcon,
  iconNameToDynamicName,
} from "@/features/pages/DynamicLucideIcon";
import {
  StatisticalVisualization,
  type StatisticalElementType,
  type StatisticalRenderData,
} from "./statistical-rendering";

export interface ElementRenderData extends StatisticalRenderData {
  readonly columns?: readonly string[];
  readonly rows?: readonly Readonly<Record<string, unknown>>[];
  readonly scalar?: string | number | boolean | null;
}

interface CanvasRendererProps {
  entry: ElementEntryDto;
  definition: ElementDefinitionDto;
  compact: boolean;
  renderState?: ElementRenderState;
  renderData?: ElementRenderData;
}

function stringValue(
  source: Readonly<Record<string, unknown>>,
  key: string,
  fallback: string,
): string {
  const value = source[key];
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number") return String(value);
  return fallback;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function dataDensity(entry: ElementEntryDto) {
  const value = entry.element.style.density;
  return value === "compact" || value === "comfortable" || value === "spacious"
    ? value
    : "comfortable";
}

function TextRenderer({ entry, definition, compact }: CanvasRendererProps) {
  return (
    <div className="canvas-text-element">
      <p>{stringValue(entry.element.props, "text", entry.element.name)}</p>
      {!compact && <small>{definition.label}</small>}
    </div>
  );
}

function ButtonRenderer({ entry }: CanvasRendererProps) {
  const presentation = elementPresentation(entry);
  return (
    <div className="canvas-button-element">
      <Button
        className="element-interactive"
        type="button"
        disabled={presentation.disabled}
        title={presentation.title}
        aria-label={presentation.accessibilityLabel}
      >
        {stringValue(entry.element.props, "label", entry.element.name)}
      </Button>
    </div>
  );
}

function itemLabels(entry: ElementEntryDto, fallback: readonly string[]) {
  const value = entry.element.props.items;
  if (typeof value !== "string") return fallback;
  const labels = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item, index, values) => values.indexOf(item) === index)
    .slice(0, 12);
  return labels.length > 0 ? labels : fallback;
}

function safeImageSource(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const source = value.trim();
  return /^(?:https:\/\/|data:image\/(?:png|jpeg|webp|gif);base64,)/iu.test(
    source,
  )
    ? source
    : null;
}

function safeLink(value: unknown): string {
  if (typeof value !== "string") return "/";
  const href = value.trim();
  return /^(?:\/[^/]|\/$|#|https:\/\/)/u.test(href) ? href : "/";
}

function HeadingRenderer({ entry }: CanvasRendererProps) {
  const levelValue = Number(entry.element.props.level);
  const level =
    Number.isInteger(levelValue) && levelValue >= 1 && levelValue <= 6
      ? levelValue
      : 2;
  const Tag = `h${level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
  return (
    <div className="canvas-heading-element">
      <Tag>{stringValue(entry.element.props, "text", entry.element.name)}</Tag>
    </div>
  );
}

function DividerRenderer({ entry }: CanvasRendererProps) {
  const orientation =
    entry.element.props.orientation === "vertical" ? "vertical" : "horizontal";
  return (
    <div
      className="canvas-divider-element"
      data-orientation={orientation}
      aria-label={entry.element.name}
    >
      <Separator orientation={orientation} />
    </div>
  );
}

function ImageRenderer({ entry }: CanvasRendererProps) {
  const source = safeImageSource(entry.element.props.src);
  const alternative = stringValue(
    entry.element.props,
    "alt",
    entry.element.name,
  );
  return source ? (
    <img
      className="canvas-image-element"
      src={source}
      alt={alternative}
      style={{
        objectFit:
          entry.element.props.objectFit === "contain" ||
          entry.element.props.objectFit === "fill"
            ? entry.element.props.objectFit
            : "cover",
      }}
    />
  ) : (
    <Empty className="canvas-image-empty" role="img" aria-label={alternative}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <ImageIcon />
        </EmptyMedia>
        <EmptyTitle>이미지</EmptyTitle>
      </EmptyHeader>
    </Empty>
  );
}

function BadgeRenderer({ entry }: CanvasRendererProps) {
  const candidate = entry.element.props.variant;
  const variant =
    candidate === "default" ||
    candidate === "destructive" ||
    candidate === "outline"
      ? candidate
      : "secondary";
  return (
    <div className="canvas-badge-element">
      <Badge variant={variant}>
        {stringValue(entry.element.props, "label", entry.element.name)}
      </Badge>
    </div>
  );
}

function IconRenderer({ entry }: CanvasRendererProps) {
  const iconName = stringValue(entry.element.props, "iconName", "Info");
  return (
    <div
      className="canvas-icon-element"
      role="img"
      aria-label={stringValue(entry.element.props, "label", entry.element.name)}
    >
      <DynamicLucideIcon
        iconName={iconName}
        dynamicName={iconNameToDynamicName(iconName)}
      />
    </div>
  );
}

function LinkRenderer({ entry }: CanvasRendererProps) {
  return (
    <div className="canvas-link-element">
      <a
        className="element-interactive"
        href={safeLink(entry.element.props.href)}
        target={entry.element.props.newTab === true ? "_blank" : undefined}
        rel={
          entry.element.props.newTab === true
            ? "noopener noreferrer"
            : undefined
        }
        onClick={(event) => event.preventDefault()}
      >
        {stringValue(entry.element.props, "label", entry.element.name)}
      </a>
    </div>
  );
}

function SpacerRenderer({ entry }: CanvasRendererProps) {
  return (
    <div className="canvas-spacer-element" aria-label={entry.element.name}>
      <span>여백</span>
    </div>
  );
}

function TabsRenderer({ entry, compact }: CanvasRendererProps) {
  const labels = itemLabels(entry, ["Overview", "Details"]);
  const configured = stringValue(entry.element.props, "defaultTab", labels[0]!);
  const defaultValue = labels.includes(configured) ? configured : labels[0]!;
  return (
    <Tabs className="canvas-tabs-element" defaultValue={defaultValue}>
      <TabsList>
        {labels.map((label) => (
          <TabsTrigger
            className="element-interactive"
            key={label}
            value={label}
          >
            {label}
          </TabsTrigger>
        ))}
      </TabsList>
      {!compact &&
        labels.map((label) => (
          <TabsContent key={label} value={label}>
            {label}
          </TabsContent>
        ))}
    </Tabs>
  );
}

function AccordionRenderer({ entry, compact }: CanvasRendererProps) {
  const labels = itemLabels(entry, ["Section 1", "Section 2"]);
  const first = labels[0] ?? "Section 1";
  const configured = stringValue(entry.element.props, "defaultItem", first);
  return (
    <Accordion
      className="canvas-accordion-element"
      type="single"
      collapsible
      defaultValue={labels.includes(configured) ? configured : first}
    >
      {labels.map((label) => (
        <AccordionItem key={label} value={label}>
          <AccordionTrigger className="element-interactive">
            {label}
          </AccordionTrigger>
          {!compact && <AccordionContent>{label}</AccordionContent>}
        </AccordionItem>
      ))}
    </Accordion>
  );
}

function ContainerRenderer({
  entry,
  definition,
  compact,
}: CanvasRendererProps) {
  return (
    <Card className="canvas-container-element">
      <CardHeader>
        <CardTitle>
          {stringValue(entry.element.props, "label", entry.element.name)}
        </CardTitle>
        {!compact && <CardDescription>{definition.label}</CardDescription>}
      </CardHeader>
      {!compact && <CardContent>콘텐츠</CardContent>}
    </Card>
  );
}

function KpiRenderer({
  entry,
  compact,
  renderState,
  renderData,
}: CanvasRendererProps) {
  if (renderState === "LOADING") {
    return (
      <div className="element-data-loading" role="status" aria-label="로딩">
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-8 w-1/2" />
      </div>
    );
  }
  if (renderState === "ERROR") {
    return (
      <Alert className="element-data-error" variant="destructive">
        <CircleAlert />
        <AlertTitle>데이터 오류</AlertTitle>
        <AlertDescription>연결 확인</AlertDescription>
      </Alert>
    );
  }
  if (renderState !== "DATA") {
    return <EmptyData label="값 없음" />;
  }
  return (
    <Card className="canvas-kpi-element">
      <CardHeader>
        <CardDescription>
          {stringValue(entry.element.props, "label", entry.element.name)}
        </CardDescription>
        <CardTitle>
          {renderData?.scalar === undefined
            ? stringValue(entry.element.props, "value", "0")
            : String(renderData.scalar ?? "")}
          {stringValue(entry.element.props, "suffix", "")}
        </CardTitle>
      </CardHeader>
      {!compact && (
        <CardContent>
          {stringValue(entry.element.props, "detail", "지표")}
        </CardContent>
      )}
    </Card>
  );
}

function NumberInputRenderer({ entry }: CanvasRendererProps) {
  const presentation = elementPresentation(entry);
  return (
    <div className="canvas-input-element">
      <label htmlFor={`canvas-input-${entry.element.id}`}>
        {stringValue(entry.element.props, "label", entry.element.name)}
      </label>
      <Input
        id={`canvas-input-${entry.element.id}`}
        className="element-interactive"
        type="number"
        value={stringValue(entry.element.props, "defaultValue", "0")}
        placeholder={stringValue(entry.element.props, "placeholder", "숫자")}
        disabled={presentation.disabled}
        required={entry.element.props.required === true}
        min={finiteNumber(entry.element.props.minimum)}
        max={finiteNumber(entry.element.props.maximum)}
        step={finiteNumber(entry.element.props.step)}
        title={presentation.title}
        aria-label={presentation.accessibilityLabel}
        readOnly
      />
    </div>
  );
}

function EmptyData({
  label,
  ariaLabel,
}: {
  label: string;
  ariaLabel?: string;
}) {
  return (
    <Empty className="element-data-state" aria-label={ariaLabel}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Database />
        </EmptyMedia>
        <EmptyTitle>{label}</EmptyTitle>
        <EmptyDescription>
          <Badge variant="secondary">미연결</Badge>
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function DataTableRenderer({
  entry,
  compact,
  renderState,
  renderData,
}: CanvasRendererProps) {
  const title = stringValue(entry.element.props, "title", entry.element.name);
  if (renderState === "LOADING") {
    return (
      <div className="element-data-loading" role="status" aria-label="로딩">
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-5 w-3/4" />
      </div>
    );
  }
  if (renderState === "ERROR") {
    return (
      <Alert className="element-data-error" variant="destructive">
        <CircleAlert />
        <AlertTitle>데이터 오류</AlertTitle>
        <AlertDescription>연결 확인</AlertDescription>
      </Alert>
    );
  }
  if (renderState !== "DATA") {
    return (
      <EmptyData
        label={stringValue(entry.element.props, "emptyLabel", "데이터 없음")}
        ariaLabel={title}
      />
    );
  }

  const columns = Array.isArray(renderData?.columns)
    ? [...renderData.columns]
    : Array.isArray(entry.element.props.columns)
      ? entry.element.props.columns.filter(
          (column): column is string => typeof column === "string",
        )
      : [];
  const rows = Array.isArray(renderData?.rows)
    ? [...renderData.rows]
    : Array.isArray(entry.element.props.rows)
      ? entry.element.props.rows.filter(
          (row): row is Record<string, unknown> =>
            typeof row === "object" && row !== null && !Array.isArray(row),
        )
      : [];
  if (columns.length === 0 || rows.length === 0) {
    return (
      <EmptyData
        label={stringValue(entry.element.props, "emptyLabel", "데이터 없음")}
        ariaLabel={title}
      />
    );
  }
  return (
    <Table aria-label={title} data-density={dataDensity(entry)}>
      <TableHeader>
        <TableRow>
          {columns.map((column) => (
            <TableHead key={column}>{column}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      {!compact && (
        <TableBody>
          {rows.map((row, index) => (
            <TableRow key={index}>
              {columns.map((column) => (
                <TableCell key={column}>{String(row[column] ?? "")}</TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      )}
    </Table>
  );
}

function StatisticalRenderer({
  entry,
  compact,
  renderState = "EMPTY",
  renderData,
}: CanvasRendererProps) {
  return (
    <StatisticalVisualization
      type={entry.element.type as StatisticalElementType}
      title={stringValue(entry.element.props, "title", entry.element.name)}
      emptyLabel={stringValue(entry.element.props, "emptyLabel", "데이터 없음")}
      state={renderState}
      compact={compact}
      options={entry.element.props}
      {...(renderData ? { data: renderData } : {})}
    />
  );
}

export const editorRendererByKey: Readonly<
  Record<ElementType, ComponentType<CanvasRendererProps>>
> = {
  text: TextRenderer,
  button: ButtonRenderer,
  container: ContainerRenderer,
  "kpi-card": KpiRenderer,
  "number-input": NumberInputRenderer,
  "data-table": DataTableRenderer,
  "line-chart": StatisticalRenderer,
  "bar-chart": StatisticalRenderer,
  histogram: StatisticalRenderer,
  "scatter-plot": StatisticalRenderer,
  "box-plot": StatisticalRenderer,
  "summary-statistics": StatisticalRenderer,
  heading: HeadingRenderer,
  divider: DividerRenderer,
  image: ImageRenderer,
  badge: BadgeRenderer,
  icon: IconRenderer,
  link: LinkRenderer,
  spacer: SpacerRenderer,
  tabs: TabsRenderer,
  accordion: AccordionRenderer,
};

export function assertEditorRendererDefinitions(
  definitions: readonly ElementDefinitionDto[],
): void {
  for (const definition of definitions) {
    if (!Object.hasOwn(editorRendererByKey, definition.rendererKey)) {
      throw new Error(`Editor renderer missing: ${definition.rendererKey}`);
    }
  }
}

export function ElementRenderer({
  entry,
  definition,
  compact,
  renderState,
  renderData,
}: CanvasRendererProps) {
  const Renderer = editorRendererByKey[definition.rendererKey];
  const presentation = elementPresentation(entry);
  const effectiveRenderState =
    renderState ??
    (definition.bindingPorts.some(
      (port) => port.direction === "input" && port.required,
    )
      ? "EMPTY"
      : "DATA");
  return (
    <div
      className="element-renderer"
      style={presentation.style}
      title={presentation.title}
      aria-label={presentation.accessibilityLabel}
      aria-disabled={presentation.disabled || undefined}
      data-hidden={presentation.hidden || undefined}
      data-render-mode={compact ? "compact" : "full"}
      data-render-state={effectiveRenderState}
      data-element-type={definition.type}
      data-renderer-key={definition.rendererKey}
    >
      {entry.element.locked && (
        <Badge className="element-lock-badge" variant="secondary">
          <LockKeyhole data-icon="inline-start" />
          잠금
        </Badge>
      )}
      {presentation.hidden && (
        <Badge className="element-hidden-badge" variant="secondary">
          <EyeOff data-icon="inline-start" />
          숨김
        </Badge>
      )}
      <Renderer
        entry={entry}
        definition={definition}
        compact={compact}
        renderState={effectiveRenderState}
        {...(renderData ? { renderData } : {})}
      />
    </div>
  );
}
