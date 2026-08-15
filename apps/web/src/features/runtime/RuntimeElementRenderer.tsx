import { Database } from "lucide-react";
import type { ComponentType } from "react";

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
import { elementPresentation } from "@/features/elements/element-presentation";
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
  renderData?: StatisticalRenderData;
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

function RuntimeButton({ entry }: RuntimeRendererProps) {
  const presentation = elementPresentation(entry);
  return (
    <Button
      type="button"
      disabled={presentation.disabled}
      title={presentation.title}
      aria-label={presentation.accessibilityLabel}
    >
      {stringValue(entry.element.props, "label", entry.element.name)}
    </Button>
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

function RuntimeKpi({ entry }: RuntimeRendererProps) {
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

function RuntimeNumberInput({ entry }: RuntimeRendererProps) {
  const presentation = elementPresentation(entry);
  return (
    <label className="runtime-number-input">
      <span>
        {stringValue(entry.element.props, "label", entry.element.name)}
      </span>
      <Input
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
    </label>
  );
}

function RuntimeDataTable({ entry }: RuntimeRendererProps) {
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
      {...(renderData ? { data: renderData } : {})}
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
      />
    </section>
  );
}
