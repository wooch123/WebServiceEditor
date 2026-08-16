import { Database, Image as ImageIcon } from "lucide-react";
import type { ComponentType } from "react";
import type { BindingRenderDataDto, BindingScalar } from "@webeditor/domain";

import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
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
import { elementPresentation } from "@/features/elements/element-presentation";
import {
  DynamicLucideIcon,
  iconNameToDynamicName,
} from "@/features/pages/DynamicLucideIcon";
import {
  StatisticalVisualization,
  type StatisticalElementType,
  type StatisticalRenderData,
} from "@/features/elements/statistical-rendering";
import type {
  ElementDefinitionDto,
  ElementEntryDto,
  ElementRenderState,
  ElementType,
} from "@/services/elements-api";

interface RuntimeRendererProps {
  entry: ElementEntryDto;
  definition: ElementDefinitionDto;
  renderState?: ElementRenderState;
  renderData?: BindingRenderDataDto | StatisticalRenderData;
  value?: BindingScalar;
  fieldError?: string;
  pending?: boolean;
  onValueChange?: (elementId: string, value: BindingScalar) => void;
  onAction?: (elementId: string) => void;
  queryRows?: readonly Readonly<Record<string, BindingScalar>>[];
  selectedRowIndex?: number;
  onRowSelect?: (
    elementId: string,
    row: Readonly<Record<string, BindingScalar>>,
    rowIndex: number,
  ) => void;
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

function RuntimeText({ entry }: RuntimeRendererProps) {
  return <p>{stringValue(entry.element.props, "text", entry.element.name)}</p>;
}

function RuntimeButton({ entry, pending, onAction }: RuntimeRendererProps) {
  const presentation = elementPresentation(entry);
  return (
    <Button
      type="button"
      disabled={presentation.disabled || pending}
      title={presentation.title}
      aria-label={presentation.accessibilityLabel}
      aria-busy={pending || undefined}
      onClick={() => onAction?.(entry.element.id)}
    >
      {pending
        ? "처리 중"
        : stringValue(entry.element.props, "label", entry.element.name)}
    </Button>
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

function RuntimeHeading({ entry }: RuntimeRendererProps) {
  const levelValue = Number(entry.element.props.level);
  const level =
    Number.isInteger(levelValue) && levelValue >= 1 && levelValue <= 6
      ? levelValue
      : 2;
  const Tag = `h${level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
  return (
    <Tag>{stringValue(entry.element.props, "text", entry.element.name)}</Tag>
  );
}

function RuntimeDivider({ entry }: RuntimeRendererProps) {
  const orientation =
    entry.element.props.orientation === "vertical" ? "vertical" : "horizontal";
  return (
    <div className="runtime-divider" data-orientation={orientation}>
      <Separator orientation={orientation} aria-label={entry.element.name} />
    </div>
  );
}

function RuntimeImage({ entry }: RuntimeRendererProps) {
  const source = safeImageSource(entry.element.props.src);
  const alternative = stringValue(
    entry.element.props,
    "alt",
    entry.element.name,
  );
  return source ? (
    <img
      className="runtime-image"
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
    <Empty className="runtime-image-empty" role="img" aria-label={alternative}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <ImageIcon />
        </EmptyMedia>
        <EmptyTitle>이미지</EmptyTitle>
      </EmptyHeader>
    </Empty>
  );
}

function RuntimeBadge({ entry }: RuntimeRendererProps) {
  const candidate = entry.element.props.variant;
  const variant =
    candidate === "default" ||
    candidate === "destructive" ||
    candidate === "outline"
      ? candidate
      : "secondary";
  return (
    <Badge variant={variant}>
      {stringValue(entry.element.props, "label", entry.element.name)}
    </Badge>
  );
}

function RuntimeIcon({ entry }: RuntimeRendererProps) {
  const iconName = stringValue(entry.element.props, "iconName", "Info");
  return (
    <span
      className="runtime-icon"
      role="img"
      aria-label={stringValue(entry.element.props, "label", entry.element.name)}
    >
      <DynamicLucideIcon
        iconName={iconName}
        dynamicName={iconNameToDynamicName(iconName)}
      />
    </span>
  );
}

function RuntimeLink({ entry }: RuntimeRendererProps) {
  return (
    <a
      className="runtime-link"
      href={safeLink(entry.element.props.href)}
      target={entry.element.props.newTab === true ? "_blank" : undefined}
      rel={
        entry.element.props.newTab === true ? "noopener noreferrer" : undefined
      }
    >
      {stringValue(entry.element.props, "label", entry.element.name)}
    </a>
  );
}

function RuntimeSpacer({ entry }: RuntimeRendererProps) {
  return <div className="runtime-spacer" aria-label={entry.element.name} />;
}

function RuntimeTabs({ entry }: RuntimeRendererProps) {
  const labels = itemLabels(entry, ["Overview", "Details"]);
  const first = labels[0] ?? "Overview";
  const configured = stringValue(entry.element.props, "defaultTab", first);
  return (
    <Tabs defaultValue={labels.includes(configured) ? configured : first}>
      <TabsList>
        {labels.map((label) => (
          <TabsTrigger key={label} value={label}>
            {label}
          </TabsTrigger>
        ))}
      </TabsList>
      {labels.map((label) => (
        <TabsContent key={label} value={label}>
          {label}
        </TabsContent>
      ))}
    </Tabs>
  );
}

function RuntimeAccordion({ entry }: RuntimeRendererProps) {
  const labels = itemLabels(entry, ["Section 1", "Section 2"]);
  const first = labels[0] ?? "Section 1";
  const configured = stringValue(entry.element.props, "defaultItem", first);
  return (
    <Accordion
      type="single"
      collapsible
      defaultValue={labels.includes(configured) ? configured : first}
    >
      {labels.map((label) => (
        <AccordionItem key={label} value={label}>
          <AccordionTrigger>{label}</AccordionTrigger>
          <AccordionContent>{label}</AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}

function RuntimeContainer({ entry, definition }: RuntimeRendererProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {stringValue(entry.element.props, "label", entry.element.name)}
        </CardTitle>
        <CardDescription>{definition.label}</CardDescription>
      </CardHeader>
      <CardContent>콘텐츠</CardContent>
    </Card>
  );
}

function RuntimeKpi({ entry, renderState, renderData }: RuntimeRendererProps) {
  if (renderState === "LOADING") return <Skeleton className="h-full w-full" />;
  if (renderState === "DATA") {
    return (
      <div className="runtime-kpi-data">
        <span>
          {stringValue(entry.element.props, "label", entry.element.name)}
        </span>
        <strong>
          {String(
            renderData && "scalar" in renderData
              ? (renderData.scalar ?? "-")
              : "-",
          )}
        </strong>
      </div>
    );
  }
  return (
    <Empty className="runtime-data-empty">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Database />
        </EmptyMedia>
        <EmptyTitle>
          {stringValue(entry.element.props, "label", "값 없음")}
        </EmptyTitle>
        <EmptyDescription>
          <Badge variant="secondary">미연결</Badge>
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function RuntimeNumberInput({
  entry,
  value,
  fieldError,
  pending,
  onValueChange,
}: RuntimeRendererProps) {
  const presentation = elementPresentation(entry);
  const inputValue =
    value === undefined
      ? (finiteNumber(entry.element.props.defaultValue) ?? "")
      : value === null
        ? ""
        : typeof value === "number"
          ? value
          : String(value);
  return (
    <label className="runtime-number-input">
      <span>
        {stringValue(entry.element.props, "label", entry.element.name)}
      </span>
      <Input
        type="number"
        value={inputValue}
        placeholder={stringValue(entry.element.props, "placeholder", "숫자")}
        disabled={presentation.disabled || pending}
        required={entry.element.props.required === true}
        min={finiteNumber(entry.element.props.minimum)}
        max={finiteNumber(entry.element.props.maximum)}
        step={finiteNumber(entry.element.props.step)}
        title={presentation.title}
        aria-label={presentation.accessibilityLabel}
        aria-invalid={fieldError ? true : undefined}
        onChange={(event) => {
          const next = event.target.value;
          const parsed = event.target.valueAsNumber;
          onValueChange?.(
            entry.element.id,
            next === "" || !Number.isFinite(parsed) ? null : parsed,
          );
        }}
        readOnly={onValueChange === undefined}
      />
      {fieldError && <span role="alert">{fieldError}</span>}
    </label>
  );
}

function RuntimeDataTable({
  entry,
  renderState,
  renderData,
  queryRows = [],
  selectedRowIndex,
  onRowSelect,
}: RuntimeRendererProps) {
  if (renderState === "LOADING") return <Skeleton className="h-full w-full" />;
  const columns =
    renderData && "columns" in renderData ? (renderData.columns ?? []) : [];
  const rows =
    renderData && "rows" in renderData ? (renderData.rows ?? []) : [];
  if (renderState === "DATA" && columns.length > 0) {
    return (
      <Table
        aria-label={stringValue(
          entry.element.props,
          "title",
          entry.element.name,
        )}
      >
        <TableHeader>
          <TableRow>
            {columns.map((column) => (
              <TableHead key={column}>{column}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, rowIndex) => (
            <TableRow
              key={rowIndex}
              tabIndex={onRowSelect ? 0 : undefined}
              aria-selected={
                onRowSelect ? selectedRowIndex === rowIndex : undefined
              }
              data-state={
                selectedRowIndex === rowIndex ? "selected" : undefined
              }
              onClick={() => {
                const queryRow = queryRows[rowIndex];
                if (queryRow)
                  onRowSelect?.(entry.element.id, queryRow, rowIndex);
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                const queryRow = queryRows[rowIndex];
                if (!queryRow) return;
                event.preventDefault();
                onRowSelect?.(entry.element.id, queryRow, rowIndex);
              }}
            >
              {columns.map((column) => (
                <TableCell key={column}>{String(row[column] ?? "")}</TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  }
  return (
    <Empty
      className="runtime-data-empty"
      aria-label={stringValue(entry.element.props, "title", entry.element.name)}
    >
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Database />
        </EmptyMedia>
        <EmptyTitle>
          {stringValue(entry.element.props, "emptyLabel", "데이터 없음")}
        </EmptyTitle>
        <EmptyDescription>
          <Badge variant="secondary">미연결</Badge>
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function RuntimeStatistical({
  entry,
  renderState = "EMPTY",
  renderData,
}: RuntimeRendererProps) {
  return (
    <StatisticalVisualization
      type={entry.element.type as StatisticalElementType}
      title={stringValue(entry.element.props, "title", entry.element.name)}
      emptyLabel={stringValue(entry.element.props, "emptyLabel", "데이터 없음")}
      state={renderState}
      compact={false}
      options={entry.element.props}
      {...(renderData ? { data: renderData as StatisticalRenderData } : {})}
    />
  );
}

export const runtimeRendererByKey: Readonly<
  Record<ElementType, ComponentType<RuntimeRendererProps>>
> = {
  text: RuntimeText,
  button: RuntimeButton,
  container: RuntimeContainer,
  "kpi-card": RuntimeKpi,
  "number-input": RuntimeNumberInput,
  "data-table": RuntimeDataTable,
  "line-chart": RuntimeStatistical,
  "bar-chart": RuntimeStatistical,
  histogram: RuntimeStatistical,
  "scatter-plot": RuntimeStatistical,
  "box-plot": RuntimeStatistical,
  "summary-statistics": RuntimeStatistical,
  heading: RuntimeHeading,
  divider: RuntimeDivider,
  image: RuntimeImage,
  badge: RuntimeBadge,
  icon: RuntimeIcon,
  link: RuntimeLink,
  spacer: RuntimeSpacer,
  tabs: RuntimeTabs,
  accordion: RuntimeAccordion,
};

export function assertRuntimeRendererDefinitions(
  definitions: readonly ElementDefinitionDto[],
): void {
  for (const definition of definitions) {
    if (!Object.hasOwn(runtimeRendererByKey, definition.rendererKey)) {
      throw new Error(`Runtime renderer missing: ${definition.rendererKey}`);
    }
  }
}

export function RuntimeElementRenderer({
  entry,
  definition,
  renderState,
  renderData,
  value,
  fieldError,
  pending,
  onValueChange,
  onAction,
  queryRows,
  selectedRowIndex,
  onRowSelect,
}: RuntimeRendererProps) {
  const presentation = elementPresentation(entry);
  if (presentation.hidden) return null;
  const Renderer = runtimeRendererByKey[definition.rendererKey];
  const effectiveRenderState =
    renderState ??
    (definition.bindingPorts.some(
      (port) => port.direction === "input" && port.required,
    )
      ? "EMPTY"
      : "DATA");
  return (
    <section
      className="runtime-element"
      style={presentation.style}
      title={presentation.title}
      aria-label={presentation.accessibilityLabel ?? entry.element.name}
      aria-disabled={presentation.disabled || undefined}
      data-element-id={entry.element.id}
      data-element-type={entry.element.type}
      data-renderer-key={definition.rendererKey}
      data-render-state={effectiveRenderState}
      {...(entry.element.type === "data-table"
        ? { "data-density": dataDensity(entry) }
        : {})}
    >
      <Renderer
        entry={entry}
        definition={definition}
        renderState={effectiveRenderState}
        {...(renderData ? { renderData } : {})}
        {...(value === undefined ? {} : { value })}
        {...(fieldError ? { fieldError } : {})}
        {...(pending === undefined ? {} : { pending })}
        {...(onValueChange ? { onValueChange } : {})}
        {...(onAction ? { onAction } : {})}
        {...(queryRows ? { queryRows } : {})}
        {...(selectedRowIndex === undefined ? {} : { selectedRowIndex })}
        {...(onRowSelect ? { onRowSelect } : {})}
      />
    </section>
  );
}
