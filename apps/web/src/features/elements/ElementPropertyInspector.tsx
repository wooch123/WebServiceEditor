import {
  CircleAlert,
  Database,
  LockKeyhole,
  Redo2,
  RotateCcw,
  Trash2,
  Undo2,
  UnlockKeyhole,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type {
  ElementPropertyFieldDto,
  ElementPropertyTabId,
  ElementPropertyValue,
} from "@/services/elements-api";
import { IconPicker } from "@/features/pages/IconPicker";
import {
  useElementWorkspace,
  type ElementPropertyUpdateTarget,
} from "./ElementWorkspace";

const PROPERTY_DEBOUNCE_MS = 500;

function stopCanvasShortcut(event: KeyboardEvent<HTMLElement>) {
  if (
    event.key === "Escape" ||
    event.key === "Delete" ||
    event.key === "Backspace" ||
    event.key.startsWith("Arrow")
  ) {
    event.stopPropagation();
  }
}

function InspectorEmpty({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <Empty className="property-inspector-empty">
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        {description && <EmptyDescription>{description}</EmptyDescription>}
      </EmptyHeader>
    </Empty>
  );
}

function FieldControl({
  field,
  value,
  disabled,
  onChange,
  onBlur,
}: {
  field: ElementPropertyFieldDto;
  value: ElementPropertyValue;
  disabled: boolean;
  onChange: (value: ElementPropertyValue) => void;
  onBlur: () => void;
}) {
  const id = `property-${field.id}`;
  const invalid =
    field.required &&
    (value === null || (typeof value === "string" && value.trim() === ""));
  const common = {
    id,
    disabled: disabled || field.readOnly,
    "aria-invalid": invalid,
    "data-testid": `property-field-${field.id}`,
    onKeyDown: stopCanvasShortcut,
    onBlur,
  };
  const referenceUnavailable =
    field.control === "field-ref" ||
    field.control === "page-ref" ||
    field.control === "binding-ref";

  return (
    <Field data-invalid={invalid || undefined} data-disabled={disabled}>
      <FieldLabel htmlFor={id}>{field.label}</FieldLabel>
      {field.control === "switch" ? (
        <Switch
          {...common}
          checked={Boolean(value)}
          onCheckedChange={(checked) => onChange(checked)}
        />
      ) : field.control === "select" ||
        (field.control === "theme-token" &&
          (field.options?.length ?? 0) > 0) ? (
        <Select
          {...(typeof value === "string" ? { value } : {})}
          disabled={common.disabled}
          onValueChange={(nextValue) => onChange(nextValue)}
        >
          <SelectTrigger
            id={id}
            aria-invalid={invalid}
            data-testid={common["data-testid"]}
            onKeyDown={stopCanvasShortcut}
            onBlur={onBlur}
          >
            <SelectValue placeholder="선택" />
          </SelectTrigger>
          <SelectContent position="popper">
            <SelectGroup>
              {(field.options ?? []).map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      ) : field.control === "slider" ? (
        <div className="property-slider-control">
          <Slider
            id={id}
            aria-invalid={invalid}
            aria-label={field.label}
            data-testid={common["data-testid"]}
            disabled={common.disabled}
            min={field.min ?? 0}
            max={field.max ?? 100}
            step={field.step ?? 1}
            value={[typeof value === "number" ? value : (field.min ?? 0)]}
            onValueChange={(nextValue) => onChange(nextValue[0] ?? null)}
            onKeyDown={stopCanvasShortcut}
            onBlur={onBlur}
          />
          <output>
            {typeof value === "number" ? value : (field.min ?? 0)}
          </output>
        </div>
      ) : field.control === "icon" ? (
        <div
          className="property-icon-control"
          data-testid={common["data-testid"]}
        >
          <IconPicker
            currentIcon={typeof value === "string" && value ? value : "File"}
            disabled={common.disabled}
            onSelect={(icon) => onChange(icon.name)}
          />
          <Input value={typeof value === "string" ? value : ""} readOnly />
        </div>
      ) : field.control === "textarea" ? (
        <Textarea
          {...common}
          maxLength={field.maxLength}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <Input
          {...common}
          disabled={common.disabled || referenceUnavailable}
          type={
            field.control === "number"
              ? "number"
              : field.control === "color"
                ? "color"
                : "text"
          }
          min={field.min}
          max={field.max}
          step={field.step}
          maxLength={field.maxLength}
          readOnly={
            field.control === "read-only" ||
            field.control === "binding-status" ||
            referenceUnavailable ||
            field.readOnly
          }
          placeholder={referenceUnavailable ? "사용 불가" : undefined}
          value={value === null ? "" : String(value ?? "")}
          onChange={(event) =>
            onChange(
              field.control === "number"
                ? event.target.value === ""
                  ? null
                  : Number(event.target.value)
                : event.target.value,
            )
          }
        />
      )}
      {field.description && (
        <FieldDescription>{field.description}</FieldDescription>
      )}
      {invalid && <FieldError>필수</FieldError>}
    </Field>
  );
}

function BindingStatus() {
  const workspace = useElementWorkspace();
  const binding = workspace.selectedDetail?.bindingStatus;
  const definition = workspace.selectedDetail?.definition;
  if (!binding || binding.status === "NOT_APPLICABLE") {
    return <InspectorEmpty title="연결 없음" description="해당 없음" />;
  }
  return (
    <div className="binding-status-list" aria-label="데이터 연결 상태">
      {binding.ports.map((port) => (
        <div key={port.portId}>
          <span>
            <Database aria-hidden="true" />
            {definition?.bindingPorts.find(
              (candidate) => candidate.id === port.portId,
            )?.label ?? port.portId}
          </span>
          <Badge variant="secondary">미연결</Badge>
        </div>
      ))}
    </div>
  );
}

export function ElementHistoryControls() {
  const workspace = useElementWorkspace();
  const busy =
    workspace.historyLoading ||
    workspace.historyMutating ||
    workspace.propertyDraftPending ||
    workspace.propertySaving ||
    workspace.mutating;
  return (
    <div className="element-history-controls" aria-label="작업 기록">
      <Button
        variant="outline"
        size="icon-sm"
        type="button"
        aria-label="실행 취소"
        title="실행 취소 · Ctrl+Z"
        disabled={busy || !workspace.history?.canUndo}
        onClick={() => void workspace.undoElementCommand()}
      >
        <Undo2 />
      </Button>
      <Button
        variant="outline"
        size="icon-sm"
        type="button"
        aria-label="다시 실행"
        title="다시 실행 · Ctrl+Shift+Z"
        disabled={busy || !workspace.history?.canRedo}
        onClick={() => void workspace.redoElementCommand()}
      >
        <Redo2 />
      </Button>
    </div>
  );
}

export function ElementPropertyInspector() {
  const workspace = useElementWorkspace();
  const detail = workspace.selectedDetail;
  const [draft, setDraft] = useState<
    Readonly<Record<string, ElementPropertyValue>>
  >({});
  const [saveState, setSaveState] = useState<
    "saved" | "pending" | "saving" | "error"
  >("saved");
  const [activeTab, setActiveTab] = useState<ElementPropertyTabId>("general");
  const selected = useMemo(
    () =>
      workspace.entries.filter((entry) =>
        workspace.selectedElementIds.has(entry.element.id),
      ),
    [workspace.entries, workspace.selectedElementIds],
  );
  const selectedElementId =
    selected.length === 1 ? selected[0]!.element.id : null;
  const queuesRef = useRef(
    new Map<
      string,
      {
        pending: Record<string, ElementPropertyValue>;
        failed: Record<string, ElementPropertyValue>;
        timer: number | null;
        target: ElementPropertyUpdateTarget | null;
      }
    >(),
  );
  const activeElementIdRef = useRef<string | null>(null);
  const flushRef = useRef<(elementId: string) => Promise<void>>(async () => {});

  function queueFor(elementId: string) {
    const existing = queuesRef.current.get(elementId);
    if (existing) return existing;
    const created = {
      pending: {} as Record<string, ElementPropertyValue>,
      failed: {} as Record<string, ElementPropertyValue>,
      timer: null as number | null,
      target: null as ElementPropertyUpdateTarget | null,
    };
    queuesRef.current.set(elementId, created);
    return created;
  }

  function syncDraftBoundary() {
    workspace.setPropertyDraftPending(
      [...queuesRef.current.values()].some(
        (queue) =>
          Object.keys(queue.pending).length > 0 ||
          Object.keys(queue.failed).length > 0,
      ),
    );
  }

  const flush = useCallback(
    async (elementId: string) => {
      const queue = queueFor(elementId);
      if (queue.timer !== null) {
        window.clearTimeout(queue.timer);
        queue.timer = null;
      }
      const values = queue.pending;
      const target = queue.target;
      if (Object.keys(values).length === 0 || !target) return;
      queue.pending = {};
      queue.target = null;
      if (activeElementIdRef.current === elementId) setSaveState("saving");
      const nextTarget = await workspace.updateElementProperties(
        target,
        values,
      );
      if (nextTarget) {
        queue.failed = {};
        if (Object.keys(queue.pending).length > 0) {
          queue.target = nextTarget;
          queue.timer = window.setTimeout(
            () => void flushRef.current(elementId),
            PROPERTY_DEBOUNCE_MS,
          );
        }
        if (activeElementIdRef.current === elementId) {
          setSaveState(
            Object.keys(queue.pending).length === 0 ? "saved" : "pending",
          );
        }
        syncDraftBoundary();
        return;
      }
      queue.failed = { ...values, ...queue.pending };
      queue.pending = {};
      queue.target = target;
      if (activeElementIdRef.current === elementId) {
        setDraft((current) => ({ ...current, ...queue.failed }));
        setSaveState("error");
      }
      syncDraftBoundary();
    },
    [workspace],
  );

  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  useEffect(() => {
    const previousElementId = activeElementIdRef.current;
    if (previousElementId && previousElementId !== selectedElementId) {
      void flushRef.current(previousElementId);
    }
    activeElementIdRef.current = selectedElementId;
    if (!selectedElementId) {
      setDraft({});
      setSaveState("saved");
      return;
    }
    const queue = queueFor(selectedElementId);
    setDraft({ ...queue.failed, ...queue.pending });
    setSaveState(
      Object.keys(queue.failed).length > 0
        ? "error"
        : Object.keys(queue.pending).length > 0
          ? "pending"
          : "saved",
    );
  }, [selectedElementId]);

  useEffect(() => {
    if (!detail || detail.entry.element.id !== selectedElementId) return;
    const queue = queueFor(selectedElementId);
    setDraft({
      ...detail.propertyValues,
      ...queue.failed,
      ...queue.pending,
    });
    setSaveState(
      Object.keys(queue.failed).length > 0
        ? "error"
        : Object.keys(queue.pending).length > 0
          ? "pending"
          : "saved",
    );
  }, [detail, selectedElementId]);

  useEffect(
    () => () => {
      for (const [elementId, queue] of queuesRef.current) {
        if (queue.timer !== null) window.clearTimeout(queue.timer);
        if (Object.keys(queue.pending).length > 0) {
          void flushRef.current(elementId);
        }
      }
    },
    [],
  );

  function changeField(fieldId: string, value: ElementPropertyValue) {
    const elementId = activeElementIdRef.current;
    if (!elementId) return;
    const queue = queueFor(elementId);
    if (!queue.target) {
      queue.target = workspace.captureElementPropertyTarget(elementId);
    }
    if (!queue.target) return;
    setDraft((current) => ({ ...current, [fieldId]: value }));
    queue.pending = { ...queue.pending, [fieldId]: value };
    if (Object.keys(queue.failed).length > 0) {
      queue.failed = {};
      queue.target = workspace.captureElementPropertyTarget(elementId);
      if (!queue.target) return;
    }
    setSaveState("pending");
    workspace.setPropertyDraftPending(true);
    if (queue.timer !== null) window.clearTimeout(queue.timer);
    queue.timer = window.setTimeout(
      () => void flushRef.current(elementId),
      PROPERTY_DEBOUNCE_MS,
    );
  }

  function retrySave() {
    const elementId = activeElementIdRef.current;
    if (!elementId) return;
    const queue = queueFor(elementId);
    if (Object.keys(queue.failed).length === 0) return;
    queue.pending = { ...queue.failed };
    queue.failed = {};
    setSaveState("pending");
    workspace.setPropertyDraftPending(true);
    void flush(elementId);
  }
  const fieldsByTab = useMemo(() => {
    const map = new Map<ElementPropertyTabId, ElementPropertyFieldDto[]>();
    for (const field of detail?.definition.propertySchema.fields ?? []) {
      if (field.control === "binding-status") continue;
      map.set(field.tab, [...(map.get(field.tab) ?? []), field]);
    }
    return map;
  }, [detail]);

  if (selected.length === 0) {
    return <InspectorEmpty title="선택 없음" description="엘리먼트 선택" />;
  }
  if (selected.length > 1) {
    return <InspectorEmpty title={`${selected.length}개 선택`} />;
  }
  if (workspace.detailLoading && !detail) {
    return (
      <div className="property-inspector-loading" role="status">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    );
  }
  if (workspace.detailError) {
    return (
      <Alert className="property-inspector-alert" variant="destructive">
        <CircleAlert />
        <AlertTitle>속성 오류</AlertTitle>
        <AlertDescription>
          <span>{workspace.detailError}</span>
          <Button
            variant="outline"
            size="sm"
            type="button"
            onClick={() => void workspace.retryDetail()}
          >
            <RotateCcw data-icon="inline-start" />
            재시도
          </Button>
        </AlertDescription>
      </Alert>
    );
  }
  if (!detail) return null;

  return (
    <div
      className="element-property-inspector"
      data-testid="element-property-inspector"
    >
      <div className="property-inspector-meta">
        <strong>{detail.entry.element.name}</strong>
        <Badge variant="secondary">{detail.definition.label}</Badge>
        <output
          aria-live="polite"
          aria-label="속성 저장 상태"
          data-save-state={saveState}
        >
          {saveState === "saved"
            ? "저장됨"
            : saveState === "saving"
              ? "저장 중"
              : saveState === "error"
                ? "저장 오류"
                : "변경됨"}
        </output>
      </div>

      {saveState === "error" && (
        <Alert className="property-save-error" variant="destructive">
          <CircleAlert />
          <AlertTitle>저장 오류</AlertTitle>
          <AlertDescription>
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={retrySave}
            >
              재시도
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <Tabs
        className="property-tabs"
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as ElementPropertyTabId)}
      >
        <TabsList className="property-tabs-list" aria-label="속성 탭">
          {(workspace.registry?.tabs ?? []).map((tab) => (
            <TabsTrigger key={tab.id} value={tab.id} title={tab.label}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {(workspace.registry?.tabs ?? []).map((tab) => {
          const fields = fieldsByTab.get(tab.id) ?? [];
          return (
            <TabsContent key={tab.id} value={tab.id}>
              {tab.id === "data" ? <BindingStatus /> : null}
              {fields.length > 0 ? (
                <FieldGroup className="property-field-group">
                  {fields.map((field) => (
                    <FieldControl
                      key={field.id}
                      field={field}
                      value={draft[field.id] ?? null}
                      disabled={workspace.historyMutating}
                      onChange={(value) => changeField(field.id, value)}
                      onBlur={() => {
                        const elementId = activeElementIdRef.current;
                        if (elementId) void flush(elementId);
                      }}
                    />
                  ))}
                </FieldGroup>
              ) : tab.id !== "data" ? (
                <InspectorEmpty title="설정 없음" />
              ) : null}
            </TabsContent>
          );
        })}
      </Tabs>

      <div className="element-inspector-actions">
        <Button
          variant="outline"
          size="sm"
          type="button"
          disabled={
            workspace.mutating ||
            workspace.propertySaving ||
            saveState !== "saved"
          }
          onClick={() => void workspace.toggleElementLock(detail.entry)}
        >
          {detail.entry.element.locked ? (
            <UnlockKeyhole data-icon="inline-start" />
          ) : (
            <LockKeyhole data-icon="inline-start" />
          )}
          {detail.entry.element.locked ? "해제" : "잠금"}
        </Button>
        <Button
          variant="destructive"
          size="sm"
          type="button"
          disabled={
            workspace.mutating ||
            workspace.propertySaving ||
            saveState !== "saved" ||
            detail.entry.element.locked
          }
          onClick={() => void workspace.removeElement(detail.entry)}
        >
          <Trash2 data-icon="inline-start" />
          삭제
        </Button>
      </div>
    </div>
  );
}
