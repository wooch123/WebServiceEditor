import {
  CircleAlert,
  Database,
  EyeOff,
  Image as ImageIcon,
  LockKeyhole,
} from "lucide-react";
import type { ComponentType, MouseEvent, ReactNode } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Message,
  MessageContent,
  MessageHeader,
} from "@/components/ui/message";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
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

function inputOptions(entry: ElementEntryDto) {
  const value = entry.element.props.options;
  if (typeof value !== "string") return ["Option 1", "Option 2"];
  const options = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item, index, values) => values.indexOf(item) === index)
    .slice(0, 50);
  return options.length > 0 ? options : ["Option 1", "Option 2"];
}

function inputLabel(entry: ElementEntryDto) {
  return stringValue(entry.element.props, "label", entry.element.name);
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

function InputControlRenderer({ entry }: CanvasRendererProps) {
  const presentation = elementPresentation(entry);
  const id = `canvas-input-${entry.element.id}`;
  const label = inputLabel(entry);
  const placeholder = stringValue(entry.element.props, "placeholder", "입력");
  const defaultValue = stringValue(entry.element.props, "defaultValue", "");
  const options = inputOptions(entry);
  const disabled = presentation.disabled;
  let control: ReactNode;

  switch (entry.element.type) {
    case "text-input":
      control = (
        <Input
          id={id}
          className="element-interactive"
          value={defaultValue}
          placeholder={placeholder}
          required={entry.element.props.required === true}
          maxLength={finiteNumber(entry.element.props.maxLength)}
          disabled={disabled}
          readOnly
        />
      );
      break;
    case "text-area":
      control = (
        <Textarea
          id={id}
          className="element-interactive"
          value={defaultValue}
          placeholder={placeholder}
          required={entry.element.props.required === true}
          maxLength={finiteNumber(entry.element.props.maxLength)}
          disabled={disabled}
          readOnly
        />
      );
      break;
    case "select":
      control = (
        <NativeSelect
          id={id}
          className="element-interactive canvas-native-select"
          value={
            options.includes(defaultValue) ? defaultValue : (options[0] ?? "")
          }
          required={entry.element.props.required === true}
          disabled={disabled}
          onChange={() => undefined}
        >
          {options.map((option) => (
            <NativeSelectOption key={option} value={option}>
              {option}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      );
      break;
    case "multi-select": {
      const selected = new Set(
        defaultValue
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      );
      control = (
        <NativeSelect
          id={id}
          className="element-interactive canvas-native-select"
          multiple
          value={[...selected]}
          disabled={disabled}
          onChange={() => undefined}
        >
          {options.map((option) => (
            <NativeSelectOption key={option} value={option}>
              {option}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      );
      break;
    }
    case "checkbox":
      control = (
        <Checkbox
          id={id}
          className="element-interactive"
          checked={entry.element.props.defaultChecked === true}
          disabled={disabled}
        />
      );
      break;
    case "radio":
      control = (
        <RadioGroup
          className="element-interactive"
          value={
            options.includes(defaultValue) ? defaultValue : (options[0] ?? "")
          }
          disabled={disabled}
        >
          {options.map((option, index) => (
            <Field key={option} orientation="horizontal">
              <RadioGroupItem id={`${id}-${index}`} value={option} />
              <FieldLabel htmlFor={`${id}-${index}`}>{option}</FieldLabel>
            </Field>
          ))}
        </RadioGroup>
      );
      break;
    case "switch":
      control = (
        <Switch
          id={id}
          className="element-interactive"
          checked={entry.element.props.defaultChecked === true}
          disabled={disabled}
        />
      );
      break;
    case "date-picker":
      control = (
        <Input
          id={id}
          className="element-interactive"
          type="date"
          value={defaultValue}
          required={entry.element.props.required === true}
          disabled={disabled}
          readOnly
        />
      );
      break;
    case "date-range":
      control = (
        <div className="canvas-date-range element-interactive">
          <Input
            id={`${id}-start`}
            type="date"
            value={stringValue(entry.element.props, "start", "")}
            aria-label={`${label} 시작`}
            disabled={disabled}
            readOnly
          />
          <Input
            id={`${id}-end`}
            type="date"
            value={stringValue(entry.element.props, "end", "")}
            aria-label={`${label} 종료`}
            disabled={disabled}
            readOnly
          />
        </div>
      );
      break;
    case "slider": {
      const minimum = finiteNumber(entry.element.props.minimum) ?? 0;
      const maximum = finiteNumber(entry.element.props.maximum) ?? 100;
      const value = Math.min(
        maximum,
        Math.max(minimum, finiteNumber(entry.element.props.defaultValue) ?? 50),
      );
      control = (
        <Slider
          id={id}
          className="element-interactive"
          value={[value]}
          min={minimum}
          max={maximum}
          step={finiteNumber(entry.element.props.step) ?? 1}
          disabled={disabled}
          aria-label={label}
        />
      );
      break;
    }
    case "file-upload":
      control = (
        <Input
          id={id}
          className="element-interactive"
          type="file"
          accept={stringValue(entry.element.props, "accept", "") || undefined}
          multiple={entry.element.props.multiple === true}
          required={entry.element.props.required === true}
          disabled={disabled}
          onChange={() => undefined}
        />
      );
      break;
    default:
      control = null;
  }

  const horizontal =
    entry.element.type === "checkbox" || entry.element.type === "switch";
  return (
    <FieldGroup className="canvas-form-element">
      <Field
        orientation={horizontal ? "horizontal" : "vertical"}
        data-disabled={disabled || undefined}
      >
        {horizontal ? (
          <>
            {control}
            <FieldLabel htmlFor={id}>{label}</FieldLabel>
          </>
        ) : (
          <>
            <FieldLabel htmlFor={id}>{label}</FieldLabel>
            {control}
          </>
        )}
      </Field>
    </FieldGroup>
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

function DataDisplayRenderer({
  entry,
  compact,
  renderState,
  renderData,
}: CanvasRendererProps) {
  const presentation = elementPresentation(entry);
  const title = stringValue(entry.element.props, "title", entry.element.name);
  const rows = renderData?.rows ?? [];
  const firstValues = rows
    .map((row) => Object.values(row)[0])
    .slice(0, compact ? 3 : 12);

  if (entry.element.type === "search") {
    const id = `canvas-search-${entry.element.id}`;
    return (
      <FieldGroup className="canvas-form-element">
        <Field>
          <FieldLabel htmlFor={id}>{inputLabel(entry)}</FieldLabel>
          <Input
            id={id}
            className="element-interactive"
            type="search"
            value={stringValue(entry.element.props, "defaultValue", "")}
            placeholder={stringValue(
              entry.element.props,
              "placeholder",
              "검색",
            )}
            disabled={presentation.disabled}
            readOnly
          />
        </Field>
      </FieldGroup>
    );
  }
  if (entry.element.type === "filter") {
    const options = inputOptions(entry);
    const configured = stringValue(
      entry.element.props,
      "defaultValue",
      options[0] ?? "",
    );
    return (
      <FieldGroup className="canvas-form-element">
        <Field>
          <FieldLabel htmlFor={`canvas-filter-${entry.element.id}`}>
            {inputLabel(entry)}
          </FieldLabel>
          <NativeSelect
            id={`canvas-filter-${entry.element.id}`}
            className="element-interactive canvas-native-select"
            value={
              options.includes(configured) ? configured : (options[0] ?? "")
            }
            disabled={presentation.disabled}
            onChange={() => undefined}
          >
            {options.map((option) => (
              <NativeSelectOption key={option} value={option}>
                {option}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
      </FieldGroup>
    );
  }
  if (entry.element.type === "pagination") {
    const page = finiteNumber(entry.element.props.page) ?? 1;
    const pageCount = finiteNumber(entry.element.props.pageCount) ?? 1;
    return (
      <nav className="canvas-pagination" aria-label={inputLabel(entry)}>
        <Button
          className="element-interactive"
          type="button"
          variant="outline"
          size="sm"
          disabled
        >
          이전
        </Button>
        <span>
          {page} / {pageCount}
        </span>
        <Button
          className="element-interactive"
          type="button"
          variant="outline"
          size="sm"
          disabled
        >
          다음
        </Button>
      </nav>
    );
  }
  if (renderState !== "DATA" || rows.length === 0) {
    return (
      <EmptyData
        label={stringValue(entry.element.props, "emptyLabel", "데이터 없음")}
        ariaLabel={title}
      />
    );
  }
  if (entry.element.type === "detail-view") {
    const record = rows[0] ?? {};
    return (
      <Table aria-label={title}>
        <TableBody>
          {Object.entries(record).map(([key, value]) => (
            <TableRow key={key}>
              <TableHead>{key}</TableHead>
              <TableCell>{String(value ?? "")}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  }
  return (
    <div
      className="canvas-record-list"
      role={entry.element.type === "tree" ? "tree" : "list"}
      aria-label={title}
    >
      {firstValues.map((value, index) => (
        <div
          key={index}
          role={entry.element.type === "tree" ? "treeitem" : "listitem"}
        >
          {String(value ?? "")}
        </div>
      ))}
    </div>
  );
}

function CollaborationRenderer({ entry }: CanvasRendererProps) {
  const labels = itemLabels(entry, ["Item 1", "Item 2"]);
  if (entry.element.type === "chat") {
    return (
      <Message className="canvas-chat-element" align="start">
        <MessageContent>
          <MessageHeader>
            {stringValue(entry.element.props, "sender", "Member")}
          </MessageHeader>
          <Bubble variant="muted" align="start">
            <BubbleContent>
              {stringValue(entry.element.props, "message", "Message")}
            </BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>
    );
  }
  if (entry.element.type === "comment") {
    return (
      <Card className="canvas-collaboration-card">
        <CardHeader>
          <CardTitle>
            {stringValue(entry.element.props, "author", "Author")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {stringValue(entry.element.props, "body", "Comment")}
        </CardContent>
      </Card>
    );
  }
  if (entry.element.type === "notification") {
    return (
      <Alert className="canvas-notification">
        <AlertTitle>
          {stringValue(entry.element.props, "title", "Notification")}
        </AlertTitle>
        <AlertDescription>
          {stringValue(entry.element.props, "body", "Update")}
        </AlertDescription>
      </Alert>
    );
  }
  if (entry.element.type === "log-viewer") {
    return (
      <pre className="canvas-log-viewer" aria-label={entry.element.name}>
        {labels.join("\n")}
      </pre>
    );
  }
  return (
    <div
      className={
        entry.element.type === "board" ? "canvas-board" : "canvas-file-list"
      }
      role="list"
      aria-label={stringValue(entry.element.props, "title", entry.element.name)}
    >
      {labels.map((label) => (
        <Card key={label} role="listitem">
          <CardHeader>
            <CardTitle>{label}</CardTitle>
          </CardHeader>
        </Card>
      ))}
    </div>
  );
}

function NavigationRenderer({ entry }: CanvasRendererProps) {
  const labels = itemLabels(entry, ["Home", "Current"]);
  const target = safeLink(entry.element.props.target);
  const stop = (event: MouseEvent) => event.preventDefault();
  if (entry.element.type === "breadcrumb") {
    return (
      <Breadcrumb className="canvas-element-breadcrumb">
        <BreadcrumbList>
          {labels.map((label, index) => (
            <BreadcrumbItem key={label}>
              {index === labels.length - 1 ? (
                <BreadcrumbPage>{label}</BreadcrumbPage>
              ) : (
                <BreadcrumbLink
                  className="element-interactive"
                  href={target}
                  onClick={stop}
                >
                  {label}
                </BreadcrumbLink>
              )}
              {index < labels.length - 1 && <BreadcrumbSeparator />}
            </BreadcrumbItem>
          ))}
        </BreadcrumbList>
      </Breadcrumb>
    );
  }
  if (entry.element.type === "button-navigation") {
    return (
      <Button className="element-interactive" type="button">
        {stringValue(entry.element.props, "label", "Continue")}
      </Button>
    );
  }
  if (entry.element.type === "page-link") {
    return (
      <a
        className="element-interactive canvas-element-page-link"
        href={target}
        onClick={stop}
      >
        {stringValue(entry.element.props, "label", "Open Page")}
      </a>
    );
  }
  if (entry.element.type === "tabs-navigation") {
    return (
      <Tabs className="canvas-tabs-element" defaultValue={labels[0] ?? "Home"}>
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
      </Tabs>
    );
  }
  return (
    <nav className="canvas-element-menu" aria-label={entry.element.name}>
      {labels.map((label) => (
        <a
          className="element-interactive"
          key={label}
          href={target}
          onClick={stop}
        >
          {label}
        </a>
      ))}
    </nav>
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
  "text-input": InputControlRenderer,
  "text-area": InputControlRenderer,
  select: InputControlRenderer,
  "multi-select": InputControlRenderer,
  checkbox: InputControlRenderer,
  radio: InputControlRenderer,
  switch: InputControlRenderer,
  "date-picker": InputControlRenderer,
  "date-range": InputControlRenderer,
  slider: InputControlRenderer,
  "file-upload": InputControlRenderer,
  list: DataDisplayRenderer,
  tree: DataDisplayRenderer,
  pagination: DataDisplayRenderer,
  search: DataDisplayRenderer,
  filter: DataDisplayRenderer,
  "detail-view": DataDisplayRenderer,
  heatmap: StatisticalRenderer,
  "distribution-plot": StatisticalRenderer,
  "control-chart": StatisticalRenderer,
  "pareto-chart": StatisticalRenderer,
  gauge: StatisticalRenderer,
  "correlation-matrix": StatisticalRenderer,
  board: CollaborationRenderer,
  comment: CollaborationRenderer,
  chat: CollaborationRenderer,
  "file-list": CollaborationRenderer,
  notification: CollaborationRenderer,
  "log-viewer": CollaborationRenderer,
  menu: NavigationRenderer,
  breadcrumb: NavigationRenderer,
  "page-link": NavigationRenderer,
  "button-navigation": NavigationRenderer,
  "tabs-navigation": NavigationRenderer,
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
