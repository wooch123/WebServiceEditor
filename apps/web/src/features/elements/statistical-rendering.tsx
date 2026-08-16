import { CircleAlert, Database } from "lucide-react";
import type { ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  ErrorBar,
  Line,
  LineChart,
  Scatter,
  ScatterChart,
  XAxis,
  YAxis,
} from "recharts";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ElementRenderState } from "@/services/elements-api";

export type StatisticalElementType =
  | "line-chart"
  | "bar-chart"
  | "histogram"
  | "scatter-plot"
  | "box-plot"
  | "summary-statistics"
  | "heatmap"
  | "distribution-plot"
  | "control-chart"
  | "pareto-chart"
  | "gauge"
  | "correlation-matrix";

export interface SeriesPoint {
  readonly label: string;
  readonly value: number;
}

export interface ScatterPoint {
  readonly x: number;
  readonly y: number;
  readonly label?: string;
}

export interface BoxPlotPoint {
  readonly label: string;
  readonly minimum: number;
  readonly firstQuartile: number;
  readonly median: number;
  readonly thirdQuartile: number;
  readonly maximum: number;
  readonly outliers?: readonly number[];
}

export interface SummaryStatistic {
  readonly label: string;
  readonly value: number;
}

export interface StatisticalRenderData {
  readonly series?: readonly SeriesPoint[];
  readonly values?: readonly number[];
  readonly scatter?: readonly ScatterPoint[];
  readonly boxes?: readonly BoxPlotPoint[];
  readonly summary?: readonly SummaryStatistic[];
}

export const LAYOUT_PRESET_PREVIEW_DATA: StatisticalRenderData = {
  series: [
    { label: "A", value: 12 },
    { label: "B", value: 18 },
    { label: "C", value: 11 },
    { label: "D", value: 24 },
    { label: "E", value: 20 },
  ],
  values: [5, 7, 8, 11, 12, 12, 14, 17, 18, 21, 24, 29],
  scatter: [
    { x: 1, y: 12, label: "A" },
    { x: 2, y: 19, label: "B" },
    { x: 3, y: 15, label: "C" },
    { x: 4, y: 26, label: "D" },
    { x: 5, y: 21, label: "E" },
  ],
  boxes: [
    {
      label: "A",
      minimum: 8,
      firstQuartile: 12,
      median: 16,
      thirdQuartile: 20,
      maximum: 25,
      outliers: [4, 31],
    },
    {
      label: "B",
      minimum: 10,
      firstQuartile: 14,
      median: 19,
      thirdQuartile: 23,
      maximum: 29,
      outliers: [35],
    },
  ],
  summary: [
    { label: "Count", value: 5 },
    { label: "Mean", value: 17 },
    { label: "Median", value: 18 },
    { label: "Std. Dev.", value: 4.69 },
    { label: "Minimum", value: 11 },
    { label: "Maximum", value: 24 },
  ],
};

const chartConfig = {
  value: { label: "Value", color: "var(--chart-1)" },
  median: { label: "Median", color: "var(--chart-2)" },
  box: { label: "Quartiles", color: "var(--chart-3)" },
  outlier: { label: "Outliers", color: "var(--chart-4)" },
} satisfies ChartConfig;

function booleanOption(
  options: Readonly<Record<string, unknown>>,
  key: string,
  fallback: boolean,
) {
  return typeof options[key] === "boolean" ? options[key] : fallback;
}

function stringOption<T extends string>(
  options: Readonly<Record<string, unknown>>,
  key: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const value = options[key];
  return typeof value === "string" && allowed.includes(value as T)
    ? (value as T)
    : fallback;
}

function numberOption(
  options: Readonly<Record<string, unknown>>,
  key: string,
  minimum: number,
  maximum: number,
  fallback: number,
) {
  const value = options[key];
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum
    ? value
    : fallback;
}

function hasSeries(data: StatisticalRenderData | undefined) {
  return Boolean(data?.series && data.series.length > 0);
}

function hasValues(data: StatisticalRenderData | undefined) {
  return Boolean(data?.values?.some((value) => Number.isFinite(value)));
}

function histogramBoundary(value: number) {
  return String(Number(value.toFixed(4)));
}

function histogramBins(
  values: readonly number[] | undefined,
  requestedBinCount: number,
): readonly SeriesPoint[] {
  const finiteValues = (values ?? []).filter(Number.isFinite);
  if (finiteValues.length === 0) return [];
  const minimum = Math.min(...finiteValues);
  const maximum = Math.max(...finiteValues);
  if (minimum === maximum) {
    return [{ label: histogramBoundary(minimum), value: finiteValues.length }];
  }
  const binCount = Math.max(2, Math.min(100, Math.trunc(requestedBinCount)));
  const width = (maximum - minimum) / binCount;
  const counts = Array.from({ length: binCount }, () => 0);
  for (const value of finiteValues) {
    const index =
      value === maximum
        ? binCount - 1
        : Math.min(binCount - 1, Math.floor((value - minimum) / width));
    counts[index] = (counts[index] ?? 0) + 1;
  }
  return counts.map((value, index) => {
    const start = minimum + width * index;
    const end =
      index === binCount - 1 ? maximum : minimum + width * (index + 1);
    return {
      label: `${histogramBoundary(start)}–${histogramBoundary(end)}`,
      value,
    };
  });
}

function hasScatter(data: StatisticalRenderData | undefined) {
  return Boolean(data?.scatter && data.scatter.length > 0);
}

function hasBoxes(data: StatisticalRenderData | undefined) {
  return Boolean(data?.boxes && data.boxes.length > 0);
}

function hasSummary(data: StatisticalRenderData | undefined) {
  return Boolean(data?.summary && data.summary.length > 0);
}

export function StatisticalDataBoundary({
  state,
  emptyLabel,
  children,
}: {
  state: ElementRenderState;
  emptyLabel: string;
  children: ReactNode;
}) {
  if (state === "LOADING") {
    return (
      <div className="statistical-loading" role="status" aria-label="로딩">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-full min-h-24 w-full" />
      </div>
    );
  }
  if (state === "ERROR") {
    return (
      <Alert className="statistical-error" variant="destructive">
        <CircleAlert />
        <AlertTitle>데이터 오류</AlertTitle>
        <AlertDescription>연결 확인</AlertDescription>
      </Alert>
    );
  }
  if (state === "EMPTY") {
    return (
      <Empty className="statistical-empty">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Database />
          </EmptyMedia>
          <EmptyTitle>{emptyLabel}</EmptyTitle>
          <EmptyDescription>
            <Badge variant="secondary">미연결</Badge>
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return children;
}

function SeriesChart({
  kind,
  title,
  data,
  compact,
  options,
}: {
  kind:
    | "line-chart"
    | "bar-chart"
    | "histogram"
    | "distribution-plot"
    | "control-chart"
    | "pareto-chart";
  title: string;
  data: StatisticalRenderData;
  compact: boolean;
  options: Readonly<Record<string, unknown>>;
}) {
  const showGrid = booleanOption(options, "showGrid", true);
  const showLegend = booleanOption(options, "showLegend", false);
  const xLabel = typeof options.xLabel === "string" ? options.xLabel : "X";
  const yLabel = typeof options.yLabel === "string" ? options.yLabel : "Y";
  const curve = stringOption(
    options,
    "curve",
    ["linear", "monotone", "step"] as const,
    "monotone",
  );
  const orientation = stringOption(
    options,
    "orientation",
    ["vertical", "horizontal"] as const,
    "vertical",
  );
  const horizontal =
    (kind === "bar-chart" || kind === "pareto-chart") &&
    orientation === "horizontal";
  const binCount = Math.trunc(numberOption(options, "binCount", 2, 100, 10));
  const points =
    kind === "histogram" || kind === "distribution-plot"
      ? histogramBins(data.values, binCount)
      : (data.series ?? []);
  const grid = compact || !showGrid ? null : <CartesianGrid vertical={false} />;
  const axes = horizontal ? (
    <>
      <XAxis
        type="number"
        tickLine={false}
        axisLine={false}
        aria-label={xLabel}
      />
      <YAxis
        dataKey="label"
        type="category"
        tickLine={false}
        axisLine={false}
        width={compact ? 24 : 48}
        aria-label={yLabel}
      />
    </>
  ) : (
    <>
      <XAxis
        dataKey="label"
        tickLine={false}
        axisLine={false}
        aria-label={xLabel}
      />
      {!compact && (
        <YAxis
          tickLine={false}
          axisLine={false}
          width={32}
          aria-label={yLabel}
        />
      )}
    </>
  );
  return (
    <figure
      className="statistical-chart"
      aria-label={title}
      data-x-label={xLabel}
      data-y-label={yLabel}
      {...(kind === "histogram" ? { "data-bin-count": binCount } : {})}
      {...(kind === "bar-chart" ? { "data-orientation": orientation } : {})}
      {...(kind === "line-chart" ? { "data-curve": curve } : {})}
    >
      {!compact && <figcaption>{title}</figcaption>}
      <ChartContainer
        className="statistical-chart-container"
        config={chartConfig}
        initialDimension={{ width: 480, height: compact ? 120 : 240 }}
      >
        {kind === "line-chart" ||
        kind === "distribution-plot" ||
        kind === "control-chart" ? (
          <LineChart accessibilityLayer data={points}>
            {grid}
            {axes}
            <ChartTooltip content={<ChartTooltipContent />} />
            <Line
              dataKey="value"
              type={curve}
              stroke="var(--color-value)"
              strokeWidth={2}
              dot={!compact}
              isAnimationActive={false}
            />
            {!compact && showLegend && (
              <ChartLegend content={<ChartLegendContent />} />
            )}
          </LineChart>
        ) : (
          <BarChart
            accessibilityLayer
            data={points}
            layout={horizontal ? "vertical" : "horizontal"}
          >
            {grid}
            {axes}
            <ChartTooltip content={<ChartTooltipContent />} />
            <Bar
              dataKey="value"
              fill="var(--color-value)"
              radius={kind === "histogram" ? 0 : 4}
              isAnimationActive={false}
            >
              {kind === "histogram" &&
                points.map((point, index) => (
                  <Cell
                    key={`${point.label}:${index}`}
                    className="statistical-histogram-bin"
                    fill="var(--color-value)"
                  />
                ))}
            </Bar>
            {!compact && showLegend && (
              <ChartLegend content={<ChartLegendContent />} />
            )}
          </BarChart>
        )}
      </ChartContainer>
    </figure>
  );
}

function Heatmap({
  title,
  data,
}: {
  title: string;
  data: StatisticalRenderData;
}) {
  const values = (data.values ?? data.series?.map(({ value }) => value) ?? [])
    .filter(Number.isFinite)
    .slice(0, 64);
  const maximum = Math.max(...values.map((value) => Math.abs(value)), 1);
  return (
    <figure className="statistical-heatmap" aria-label={title}>
      <figcaption>{title}</figcaption>
      <div className="statistical-heatmap-grid">
        {values.map((value, index) => (
          <span
            key={`${value}:${index}`}
            style={{ opacity: 0.25 + (Math.abs(value) / maximum) * 0.75 }}
            aria-label={`${index + 1}: ${value}`}
          />
        ))}
      </div>
    </figure>
  );
}

function GaugeChart({
  title,
  data,
}: {
  title: string;
  data: StatisticalRenderData;
}) {
  const value =
    data.values?.find(Number.isFinite) ?? data.series?.[0]?.value ?? 0;
  const bounded = Math.max(0, Math.min(100, value));
  return (
    <figure className="statistical-gauge" aria-label={title}>
      <figcaption>{title}</figcaption>
      <meter min={0} max={100} value={bounded} aria-label={title} />
      <strong>{bounded.toLocaleString()}</strong>
    </figure>
  );
}

function CorrelationMatrix({
  title,
  data,
}: {
  title: string;
  data: StatisticalRenderData;
}) {
  const points = (data.summary ?? data.series ?? []).slice(0, 12);
  return (
    <Table aria-label={title} className="statistical-correlation-matrix">
      <TableHeader>
        <TableRow>
          <TableHead>Variable</TableHead>
          <TableHead>Correlation</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {points.map((point) => (
          <TableRow key={point.label}>
            <TableCell>{point.label}</TableCell>
            <TableCell>{point.value.toFixed(2)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ScatterPlot({
  title,
  data,
  compact,
  options,
}: {
  title: string;
  data: StatisticalRenderData;
  compact: boolean;
  options: Readonly<Record<string, unknown>>;
}) {
  const showGrid = booleanOption(options, "showGrid", true);
  const showLegend = booleanOption(options, "showLegend", false);
  const showTrendline = booleanOption(options, "showTrendline", false);
  const xLabel = typeof options.xLabel === "string" ? options.xLabel : "X";
  const yLabel = typeof options.yLabel === "string" ? options.yLabel : "Y";
  return (
    <figure
      className="statistical-chart"
      aria-label={title}
      data-x-label={xLabel}
      data-y-label={yLabel}
      data-trendline={String(showTrendline)}
    >
      {!compact && <figcaption>{title}</figcaption>}
      <ChartContainer
        className="statistical-chart-container"
        config={chartConfig}
        initialDimension={{ width: 480, height: compact ? 120 : 240 }}
      >
        <ScatterChart accessibilityLayer>
          {!compact && showGrid && <CartesianGrid />}
          <XAxis
            dataKey="x"
            type="number"
            tickLine={false}
            axisLine={false}
            aria-label={xLabel}
          />
          {!compact && (
            <YAxis
              dataKey="y"
              type="number"
              tickLine={false}
              axisLine={false}
              width={32}
              aria-label={yLabel}
            />
          )}
          <ChartTooltip content={<ChartTooltipContent />} />
          <Scatter
            data={data.scatter ?? []}
            dataKey="y"
            fill="var(--color-value)"
            isAnimationActive={false}
          />
          {showTrendline && (
            <Line
              data={data.scatter ?? []}
              dataKey="y"
              type="linear"
              stroke="var(--color-median)"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          )}
          {!compact && showLegend && (
            <ChartLegend content={<ChartLegendContent />} />
          )}
        </ScatterChart>
      </ChartContainer>
    </figure>
  );
}

function BoxPlot({
  title,
  data,
  compact,
  options,
}: {
  title: string;
  data: StatisticalRenderData;
  compact: boolean;
  options: Readonly<Record<string, unknown>>;
}) {
  const showGrid = booleanOption(options, "showGrid", true);
  const showLegend = booleanOption(options, "showLegend", false);
  const showOutliers = booleanOption(options, "showOutliers", true);
  const xLabel = typeof options.xLabel === "string" ? options.xLabel : "X";
  const yLabel = typeof options.yLabel === "string" ? options.yLabel : "Y";
  const boxes = (data.boxes ?? []).map((point) => ({
    ...point,
    box: [point.firstQuartile, point.thirdQuartile] as const,
    whisker: [
      point.median - point.minimum,
      point.maximum - point.median,
    ] as const,
  }));
  const outliers = boxes.flatMap((point) =>
    (point.outliers ?? []).filter(Number.isFinite).map((outlier) => ({
      label: point.label,
      outlier,
    })),
  );
  return (
    <figure
      className="statistical-chart"
      aria-label={title}
      data-x-label={xLabel}
      data-y-label={yLabel}
      data-show-outliers={String(showOutliers)}
    >
      {!compact && <figcaption>{title}</figcaption>}
      <ChartContainer
        className="statistical-chart-container"
        config={chartConfig}
        initialDimension={{ width: 480, height: compact ? 120 : 240 }}
      >
        <ComposedChart accessibilityLayer data={boxes}>
          {!compact && showGrid && <CartesianGrid vertical={false} />}
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            aria-label={xLabel}
          />
          {!compact && (
            <YAxis
              tickLine={false}
              axisLine={false}
              width={32}
              aria-label={yLabel}
            />
          )}
          <ChartTooltip content={<ChartTooltipContent />} />
          <Bar
            dataKey="box"
            fill="var(--color-box)"
            radius={2}
            isAnimationActive={false}
          >
            <ErrorBar
              dataKey="whisker"
              direction="y"
              stroke="var(--color-median)"
              width={8}
            />
          </Bar>
          <Scatter
            dataKey="median"
            fill="var(--color-median)"
            isAnimationActive={false}
          />
          {showOutliers && outliers.length > 0 && (
            <Scatter
              className="statistical-box-outliers"
              data={outliers}
              dataKey="outlier"
              fill="var(--color-outlier)"
              name="Outliers"
              isAnimationActive={false}
            />
          )}
          {!compact && showLegend && (
            <ChartLegend content={<ChartLegendContent />} />
          )}
        </ComposedChart>
      </ChartContainer>
    </figure>
  );
}

function SummaryStatistics({
  title,
  data,
  compact,
  options,
}: {
  title: string;
  data: StatisticalRenderData;
  compact: boolean;
  options: Readonly<Record<string, unknown>>;
}) {
  const precision = numberOption(options, "precision", 0, 8, 2);
  const optionByLabel: Readonly<Record<string, string>> = {
    Count: "showCount",
    Mean: "showMean",
    Median: "showMedian",
    "Std. Dev.": "showStdDev",
    Minimum: "showMin",
    Maximum: "showMax",
  };
  const summary = (data.summary ?? []).filter((item) =>
    booleanOption(options, optionByLabel[item.label] ?? "", true),
  );
  return (
    <Card className="summary-statistics-card">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <Table aria-label={title}>
          <TableHeader className="sr-only">
            <TableRow>
              <TableHead>Statistic</TableHead>
              <TableHead>Value</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {summary.slice(0, compact ? 2 : summary.length).map((item) => (
              <TableRow key={item.label}>
                <TableCell>{item.label}</TableCell>
                <TableCell className="summary-statistic-value">
                  {item.value.toLocaleString(undefined, {
                    minimumFractionDigits: 0,
                    maximumFractionDigits: precision,
                  })}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export function StatisticalVisualization({
  type,
  title,
  emptyLabel,
  state,
  data,
  compact,
  options,
}: {
  type: StatisticalElementType;
  title: string;
  emptyLabel: string;
  state: ElementRenderState;
  data?: StatisticalRenderData;
  compact: boolean;
  options: Readonly<Record<string, unknown>>;
}) {
  const hasData =
    type === "scatter-plot"
      ? hasScatter(data)
      : type === "histogram"
        ? hasValues(data)
        : type === "box-plot"
          ? hasBoxes(data)
          : type === "summary-statistics" || type === "correlation-matrix"
            ? hasSummary(data)
            : type === "heatmap" ||
                type === "gauge" ||
                type === "distribution-plot"
              ? hasValues(data) || hasSeries(data)
              : hasSeries(data);
  const effectiveState = state === "DATA" && !hasData ? "EMPTY" : state;
  return (
    <StatisticalDataBoundary state={effectiveState} emptyLabel={emptyLabel}>
      {data &&
        (type === "line-chart" ||
        type === "bar-chart" ||
        type === "histogram" ||
        type === "distribution-plot" ||
        type === "control-chart" ||
        type === "pareto-chart" ? (
          <SeriesChart
            kind={type}
            title={title}
            data={data}
            compact={compact}
            options={options}
          />
        ) : type === "scatter-plot" ? (
          <ScatterPlot
            title={title}
            data={data}
            compact={compact}
            options={options}
          />
        ) : type === "box-plot" ? (
          <BoxPlot
            title={title}
            data={data}
            compact={compact}
            options={options}
          />
        ) : type === "heatmap" ? (
          <Heatmap title={title} data={data} />
        ) : type === "gauge" ? (
          <GaugeChart title={title} data={data} />
        ) : type === "correlation-matrix" ? (
          <CorrelationMatrix title={title} data={data} />
        ) : (
          <SummaryStatistics
            title={title}
            data={data}
            compact={compact}
            options={options}
          />
        ))}
    </StatisticalDataBoundary>
  );
}
