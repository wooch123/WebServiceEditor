import { Database, Image as ImageIcon } from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import type { BindingRenderDataDto, BindingScalar } from "@webeditor/domain";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
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
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
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

function RuntimeInputControl({
  entry,
  value,
  fieldError,
  pending,
  onValueChange,
}: RuntimeRendererProps) {
  const presentation = elementPresentation(entry);
  const id = `runtime-input-${entry.element.id}`;
  const label = inputLabel(entry);
  const disabled = presentation.disabled || pending === true;
  const stringInput =
    value === undefined
      ? stringValue(entry.element.props, "defaultValue", "")
      : value === null
        ? ""
        : String(value);
  const boolInput =
    value === undefined
      ? entry.element.props.defaultChecked === true
      : value === true;
  const options = inputOptions(entry);
  let control: ReactNode;

  switch (entry.element.type) {
    case "text-input":
      control = (
        <Input
          id={id}
          type="text"
          value={stringInput}
          placeholder={stringValue(entry.element.props, "placeholder", "입력")}
          required={entry.element.props.required === true}
          maxLength={finiteNumber(entry.element.props.maxLength)}
          disabled={disabled}
          aria-invalid={fieldError ? true : undefined}
          onChange={(event) =>
            onValueChange?.(entry.element.id, event.target.value)
          }
          readOnly={onValueChange === undefined}
        />
      );
      break;
    case "text-area":
      control = (
        <Textarea
          id={id}
          value={stringInput}
          placeholder={stringValue(entry.element.props, "placeholder", "입력")}
          required={entry.element.props.required === true}
          maxLength={finiteNumber(entry.element.props.maxLength)}
          disabled={disabled}
          aria-invalid={fieldError ? true : undefined}
          onChange={(event) =>
            onValueChange?.(entry.element.id, event.target.value)
          }
          readOnly={onValueChange === undefined}
        />
      );
      break;
    case "select":
      control = (
        <NativeSelect
          id={id}
          className="runtime-native-select"
          value={
            options.includes(stringInput) ? stringInput : (options[0] ?? "")
          }
          required={entry.element.props.required === true}
          disabled={disabled}
          aria-invalid={fieldError ? true : undefined}
          onChange={(event) =>
            onValueChange?.(entry.element.id, event.target.value)
          }
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
      const selected = stringInput
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      control = (
        <NativeSelect
          id={id}
          className="runtime-native-select"
          multiple
          value={selected}
          required={entry.element.props.required === true}
          disabled={disabled}
          aria-invalid={fieldError ? true : undefined}
          onChange={(event) =>
            onValueChange?.(
              entry.element.id,
              [...event.currentTarget.selectedOptions]
                .map((option) => option.value)
                .join(","),
            )
          }
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
          checked={boolInput}
          required={entry.element.props.required === true}
          disabled={disabled}
          aria-invalid={fieldError ? true : undefined}
          onCheckedChange={(checked) =>
            onValueChange?.(entry.element.id, checked === true)
          }
        />
      );
      break;
    case "radio":
      control = (
        <RadioGroup
          value={
            options.includes(stringInput) ? stringInput : (options[0] ?? "")
          }
          required={entry.element.props.required === true}
          disabled={disabled}
          aria-invalid={fieldError ? true : undefined}
          onValueChange={(next) => onValueChange?.(entry.element.id, next)}
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
          checked={boolInput}
          required={entry.element.props.required === true}
          disabled={disabled}
          aria-invalid={fieldError ? true : undefined}
          onCheckedChange={(checked) =>
            onValueChange?.(entry.element.id, checked)
          }
        />
      );
      break;
    case "date-picker":
      control = (
        <Input
          id={id}
          type="date"
          value={stringInput}
          required={entry.element.props.required === true}
          disabled={disabled}
          aria-invalid={fieldError ? true : undefined}
          onChange={(event) =>
            onValueChange?.(entry.element.id, event.target.value)
          }
          readOnly={onValueChange === undefined}
        />
      );
      break;
    case "date-range": {
      const [storedStart = "", storedEnd = ""] = stringInput.split("/");
      const start =
        value === undefined
          ? stringValue(entry.element.props, "start", "")
          : storedStart;
      const end =
        value === undefined
          ? stringValue(entry.element.props, "end", "")
          : storedEnd;
      control = (
        <div className="runtime-date-range">
          <Input
            id={`${id}-start`}
            type="date"
            value={start}
            aria-label={`${label} 시작`}
            disabled={disabled}
            aria-invalid={fieldError ? true : undefined}
            onChange={(event) =>
              onValueChange?.(entry.element.id, `${event.target.value}/${end}`)
            }
            readOnly={onValueChange === undefined}
          />
          <Input
            id={`${id}-end`}
            type="date"
            value={end}
            aria-label={`${label} 종료`}
            disabled={disabled}
            aria-invalid={fieldError ? true : undefined}
            onChange={(event) =>
              onValueChange?.(
                entry.element.id,
                `${start}/${event.target.value}`,
              )
            }
            readOnly={onValueChange === undefined}
          />
        </div>
      );
      break;
    }
    case "slider": {
      const minimum = finiteNumber(entry.element.props.minimum) ?? 0;
      const maximum = finiteNumber(entry.element.props.maximum) ?? 100;
      const numericValue =
        typeof value === "number"
          ? value
          : (finiteNumber(entry.element.props.defaultValue) ?? 50);
      control = (
        <Slider
          id={id}
          value={[Math.min(maximum, Math.max(minimum, numericValue))]}
          min={minimum}
          max={maximum}
          step={finiteNumber(entry.element.props.step) ?? 1}
          disabled={disabled}
          aria-label={label}
          aria-invalid={fieldError ? true : undefined}
          onValueChange={(next) =>
            onValueChange?.(entry.element.id, next[0] ?? minimum)
          }
        />
      );
      break;
    }
    case "file-upload":
      control = (
        <Input
          id={id}
          type="file"
          accept={stringValue(entry.element.props, "accept", "") || undefined}
          multiple={entry.element.props.multiple === true}
          required={entry.element.props.required === true}
          disabled={disabled}
          aria-invalid={fieldError ? true : undefined}
          onChange={(event) =>
            onValueChange?.(
              entry.element.id,
              [...(event.currentTarget.files ?? [])]
                .map((file) => file.name)
                .join(","),
            )
          }
        />
      );
      break;
    default:
      control = null;
  }

  const horizontal =
    entry.element.type === "checkbox" || entry.element.type === "switch";
  return (
    <FieldGroup className="runtime-form-element">
      <Field
        orientation={horizontal ? "horizontal" : "vertical"}
        data-disabled={disabled || undefined}
        data-invalid={fieldError ? true : undefined}
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
        {fieldError && <FieldError>{fieldError}</FieldError>}
      </Field>
    </FieldGroup>
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

function RuntimeDataDisplay({
  entry,
  renderState,
  renderData,
  value,
  pending,
  onValueChange,
}: RuntimeRendererProps) {
  const presentation = elementPresentation(entry);
  const disabled = presentation.disabled || pending === true;
  const title = stringValue(entry.element.props, "title", entry.element.name);
  const rows =
    renderData && "rows" in renderData ? (renderData.rows ?? []) : [];

  if (entry.element.type === "search") {
    const id = `runtime-search-${entry.element.id}`;
    const current =
      value === undefined
        ? stringValue(entry.element.props, "defaultValue", "")
        : value === null
          ? ""
          : String(value);
    return (
      <FieldGroup className="runtime-form-element">
        <Field>
          <FieldLabel htmlFor={id}>{inputLabel(entry)}</FieldLabel>
          <Input
            id={id}
            type="search"
            value={current}
            placeholder={stringValue(
              entry.element.props,
              "placeholder",
              "검색",
            )}
            disabled={disabled}
            onChange={(event) =>
              onValueChange?.(entry.element.id, event.target.value)
            }
            readOnly={onValueChange === undefined}
          />
        </Field>
      </FieldGroup>
    );
  }
  if (entry.element.type === "filter") {
    const options = inputOptions(entry);
    const current =
      value === undefined
        ? stringValue(entry.element.props, "defaultValue", options[0] ?? "")
        : String(value ?? "");
    return (
      <FieldGroup className="runtime-form-element">
        <Field>
          <FieldLabel htmlFor={`runtime-filter-${entry.element.id}`}>
            {inputLabel(entry)}
          </FieldLabel>
          <NativeSelect
            id={`runtime-filter-${entry.element.id}`}
            className="runtime-native-select"
            value={options.includes(current) ? current : (options[0] ?? "")}
            disabled={disabled}
            onChange={(event) =>
              onValueChange?.(entry.element.id, event.target.value)
            }
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
    const page =
      typeof value === "number"
        ? value
        : (finiteNumber(entry.element.props.page) ?? 1);
    const pageCount = finiteNumber(entry.element.props.pageCount) ?? 1;
    return (
      <nav className="runtime-pagination" aria-label={inputLabel(entry)}>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || page <= 1}
          onClick={() => onValueChange?.(entry.element.id, page - 1)}
        >
          이전
        </Button>
        <span>
          {page} / {pageCount}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || page >= pageCount}
          onClick={() => onValueChange?.(entry.element.id, page + 1)}
        >
          다음
        </Button>
      </nav>
    );
  }
  if (renderState !== "DATA" || rows.length === 0) {
    return (
      <Empty className="runtime-data-empty" aria-label={title}>
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
  if (entry.element.type === "detail-view") {
    const record = rows[0] ?? {};
    return (
      <Table aria-label={title}>
        <TableBody>
          {Object.entries(record).map(([key, cell]) => (
            <TableRow key={key}>
              <TableHead>{key}</TableHead>
              <TableCell>{String(cell ?? "")}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  }
  return (
    <div
      className="runtime-record-list"
      role={entry.element.type === "tree" ? "tree" : "list"}
      aria-label={title}
    >
      {rows.slice(0, 50).map((row, index) => (
        <div
          key={index}
          role={entry.element.type === "tree" ? "treeitem" : "listitem"}
        >
          {String(Object.values(row)[0] ?? "")}
        </div>
      ))}
    </div>
  );
}

function RuntimeCollaboration({ entry }: RuntimeRendererProps) {
  const labels = itemLabels(entry, ["Item 1", "Item 2"]);
  if (entry.element.type === "chat") {
    return (
      <Message className="runtime-chat-element" align="start">
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
      <Card className="runtime-collaboration-card">
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
      <Alert className="runtime-notification">
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
      <pre className="runtime-log-viewer" aria-label={entry.element.name}>
        {labels.join("\n")}
      </pre>
    );
  }
  return (
    <div
      className={
        entry.element.type === "board" ? "runtime-board" : "runtime-file-list"
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

function RuntimeNavigation({ entry, pending, onAction }: RuntimeRendererProps) {
  const labels = itemLabels(entry, ["Home", "Current"]);
  const target = safeLink(entry.element.props.target);
  if (entry.element.type === "breadcrumb") {
    return (
      <Breadcrumb className="runtime-element-breadcrumb">
        <BreadcrumbList>
          {labels.map((label, index) => (
            <BreadcrumbItem key={label}>
              {index === labels.length - 1 ? (
                <BreadcrumbPage>{label}</BreadcrumbPage>
              ) : (
                <BreadcrumbLink href={target}>{label}</BreadcrumbLink>
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
      <Button
        type="button"
        disabled={pending}
        onClick={() => onAction?.(entry.element.id)}
      >
        {stringValue(entry.element.props, "label", "Continue")}
      </Button>
    );
  }
  if (entry.element.type === "page-link") {
    return (
      <a className="runtime-element-page-link" href={target}>
        {stringValue(entry.element.props, "label", "Open Page")}
      </a>
    );
  }
  if (entry.element.type === "tabs-navigation") {
    return (
      <Tabs
        className="runtime-tabs-navigation"
        defaultValue={labels[0] ?? "Home"}
      >
        <TabsList>
          {labels.map((label) => (
            <TabsTrigger key={label} value={label}>
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    );
  }
  return (
    <nav className="runtime-element-menu" aria-label={entry.element.name}>
      {labels.map((label) => (
        <a key={label} href={target}>
          {label}
        </a>
      ))}
    </nav>
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
  "text-input": RuntimeInputControl,
  "text-area": RuntimeInputControl,
  select: RuntimeInputControl,
  "multi-select": RuntimeInputControl,
  checkbox: RuntimeInputControl,
  radio: RuntimeInputControl,
  switch: RuntimeInputControl,
  "date-picker": RuntimeInputControl,
  "date-range": RuntimeInputControl,
  slider: RuntimeInputControl,
  "file-upload": RuntimeInputControl,
  list: RuntimeDataDisplay,
  tree: RuntimeDataDisplay,
  pagination: RuntimeDataDisplay,
  search: RuntimeDataDisplay,
  filter: RuntimeDataDisplay,
  "detail-view": RuntimeDataDisplay,
  heatmap: RuntimeStatistical,
  "distribution-plot": RuntimeStatistical,
  "control-chart": RuntimeStatistical,
  "pareto-chart": RuntimeStatistical,
  gauge: RuntimeStatistical,
  "correlation-matrix": RuntimeStatistical,
  board: RuntimeCollaboration,
  comment: RuntimeCollaboration,
  chat: RuntimeCollaboration,
  "file-list": RuntimeCollaboration,
  notification: RuntimeCollaboration,
  "log-viewer": RuntimeCollaboration,
  menu: RuntimeNavigation,
  breadcrumb: RuntimeNavigation,
  "page-link": RuntimeNavigation,
  "button-navigation": RuntimeNavigation,
  "tabs-navigation": RuntimeNavigation,
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
