import {
  Database,
  LayoutTemplate,
  Plus,
  Replace,
  RotateCcw,
  Search,
  TriangleAlert,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
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
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ElementRenderer } from "@/features/elements/ElementRenderer";
import {
  LAYOUT_PRESET_PREVIEW_DATA,
  type StatisticalElementType,
} from "@/features/elements/statistical-rendering";
import {
  DynamicLucideIcon,
  iconNameToDynamicName,
} from "@/features/pages/DynamicLucideIcon";
import type { ElementDefinitionDto } from "@/services/elements-api";
import {
  applyLayoutPreset,
  LayoutPresetsApiError,
  listLayoutPresets,
  previewLayoutPreset,
  type ApplyLayoutPresetDto,
  type LayoutPresetCategory,
  type LayoutPresetDefinition,
  type LayoutPresetMode,
  type LayoutPresetPreviewDto,
  type LayoutPresetProposedElementDto,
  type LayoutPresetRegistryDto,
} from "@/services/layout-presets-api";

const categoryLabels: Readonly<Record<LayoutPresetCategory, string>> = {
  dashboard: "대시보드",
  statistics: "통계",
  data: "데이터",
  general: "일반",
};

const statisticalElementTypes = new Set<StatisticalElementType>([
  "line-chart",
  "bar-chart",
  "histogram",
  "scatter-plot",
  "box-plot",
  "summary-statistics",
]);

function isStatisticalElementType(
  value: string,
): value is StatisticalElementType {
  return statisticalElementTypes.has(value as StatisticalElementType);
}

function coordinateSnapshot(
  proposedElements: readonly LayoutPresetProposedElementDto[],
) {
  return [...proposedElements]
    .sort((left, right) => left.templateId.localeCompare(right.templateId))
    .map(({ templateId, entry }) => ({
      templateId,
      elementId: entry.element.id,
      type: entry.element.type,
      x: entry.layout.x,
      y: entry.layout.y,
      w: entry.layout.w,
      h: entry.layout.h,
    }));
}

function hasCanonicalProposalOrder(
  proposedElements: readonly LayoutPresetProposedElementDto[],
) {
  const templateIds = proposedElements.map(({ templateId }) => templateId);
  const canonicalTemplateIds = [...templateIds].sort((left, right) =>
    left.localeCompare(right),
  );
  return (
    proposedElements.length > 0 &&
    new Set(templateIds).size === templateIds.length &&
    templateIds.every(
      (templateId, index) => templateId === canonicalTemplateIds[index],
    ) &&
    proposedElements.every(
      ({ entry }) => entry.element.id === entry.layout.elementId,
    )
  );
}

function entriesMatchProposal(
  proposedElements: readonly LayoutPresetProposedElementDto[],
  entries: ApplyLayoutPresetDto["entries"],
) {
  if (
    entries.length < proposedElements.length ||
    new Set(entries.map((entry) => entry.element.id)).size !== entries.length
  ) {
    return false;
  }
  const entryById = new Map(entries.map((entry) => [entry.element.id, entry]));
  return proposedElements.every(({ entry: expected }) => {
    const actual = entryById.get(expected.element.id);
    return (
      actual?.element.type === expected.element.type &&
      actual.layout.elementId === expected.layout.elementId &&
      actual.layout.x === expected.layout.x &&
      actual.layout.y === expected.layout.y &&
      actual.layout.w === expected.layout.w &&
      actual.layout.h === expected.layout.h
    );
  });
}

function sameIds(left: readonly string[], right: readonly string[]) {
  return (
    new Set(left).size === left.length &&
    new Set(right).size === right.length &&
    JSON.stringify([...left].sort()) === JSON.stringify([...right].sort())
  );
}

function hasValidPreviewSnapshot(preview: LayoutPresetPreviewDto) {
  const elementIdByTemplateId = new Map(
    preview.proposedElements.map(({ templateId, entry }) => [
      templateId,
      entry.element.id,
    ]),
  );
  return (
    /^[a-f0-9]{64}$/.test(preview.coordinateChecksum) &&
    preview.presetSnapshot.id === preview.presetId &&
    preview.presetSnapshot.version === preview.presetVersion &&
    preview.createdElementCount === preview.proposedElements.length &&
    hasCanonicalProposalOrder(preview.proposedElements) &&
    preview.proposedElements.every(
      ({ entry }) => entry.element.pageId === preview.pageId,
    ) &&
    new Set(preview.deletedElementIds).size ===
      preview.deletedElementIds.length &&
    (preview.mode === "REPLACE"
      ? preview.deletedElementIds.length === preview.existingElementCount
      : preview.deletedElementIds.length === 0) &&
    preview.bindingPlaceholders.every(
      (placeholder) =>
        placeholder.status === "UNCONNECTED" &&
        placeholder.elementTypeVersion === 1 &&
        elementIdByTemplateId.get(placeholder.templateId) ===
          placeholder.elementId,
    )
  );
}

function instanceMembershipMatches(
  proposedElements: readonly LayoutPresetProposedElementDto[],
  instanceElements: ApplyLayoutPresetDto["instance"]["elements"],
) {
  if (instanceElements.length !== proposedElements.length) return false;
  const expected = proposedElements.map(({ templateId, entry }) => ({
    templateId,
    elementId: entry.element.id,
  }));
  return JSON.stringify(instanceElements) === JSON.stringify(expected);
}

function hasExactAppliedCoordinates(
  preview: LayoutPresetPreviewDto,
  result: ApplyLayoutPresetDto,
) {
  const expected = JSON.stringify(coordinateSnapshot(preview.proposedElements));
  return (
    hasValidPreviewSnapshot(preview) &&
    hasCanonicalProposalOrder(result.proposedElements) &&
    hasCanonicalProposalOrder(result.instance.proposedElements) &&
    result.coordinateChecksum === preview.coordinateChecksum &&
    result.instance.coordinateChecksum === preview.coordinateChecksum &&
    result.instance.pageId === preview.pageId &&
    result.instance.presetId === preview.presetId &&
    result.instance.mode === preview.mode &&
    sameIds(
      preview.proposedElements.map(({ entry }) => entry.element.id),
      result.createdElementIds,
    ) &&
    sameIds(preview.deletedElementIds, result.deletedElementIds) &&
    JSON.stringify(coordinateSnapshot(result.proposedElements)) === expected &&
    JSON.stringify(coordinateSnapshot(result.instance.proposedElements)) ===
      expected &&
    entriesMatchProposal(preview.proposedElements, result.entries) &&
    instanceMembershipMatches(
      preview.proposedElements,
      result.instance.elements,
    )
  );
}

export interface LayoutPresetRevisionTarget {
  readonly pageId: string;
  readonly layoutRevision: number;
  readonly projectRevision: number;
}

export interface LayoutPresetBrowserProps {
  readonly pageId: string | null;
  readonly definitions: readonly ElementDefinitionDto[];
  readonly disabled?: boolean;
  readonly captureRevision: () => LayoutPresetRevisionTarget | null;
  readonly onApplied: (result: ApplyLayoutPresetDto) => void | Promise<void>;
}

function failureCopy(reason: unknown): string {
  if (!(reason instanceof LayoutPresetsApiError)) {
    return reason instanceof Error ? reason.message : "요청 실패";
  }
  if (
    reason.code === "LAYOUT_PRESET_PREVIEW_EXPIRED" ||
    reason.code === "LAYOUT_PRESET_PREVIEW_NOT_FOUND"
  ) {
    return "미리보기 만료";
  }
  if (
    reason.code === "LAYOUT_PRESET_PREVIEW_STALE" ||
    reason.code === "LAYOUT_PRESET_PREVIEW_SCOPE_MISMATCH" ||
    reason.code === "LAYOUT_PRESET_PREVIEW_TAMPERED"
  ) {
    return "미리보기 갱신";
  }
  if (
    reason.code === "ELEMENT_LOCKED" ||
    reason.code === "LAYOUT_PRESET_LOCKED_ELEMENTS"
  ) {
    return "잠금 요소";
  }
  if (reason.status === 409) return "변경 충돌 · 다시 미리보기";
  return reason.message;
}

function requiresNewPreview(reason: unknown) {
  return (
    reason instanceof LayoutPresetsApiError &&
    (reason.status === 409 ||
      [
        "LAYOUT_PRESET_PREVIEW_EXPIRED",
        "LAYOUT_PRESET_PREVIEW_NOT_FOUND",
        "LAYOUT_PRESET_PREVIEW_SCOPE_MISMATCH",
        "LAYOUT_PRESET_PREVIEW_STALE",
        "LAYOUT_PRESET_PREVIEW_TAMPERED",
      ].includes(reason.code))
  );
}

function PresetList({
  definitions,
  selectedId,
  disabled,
  onSelect,
}: {
  definitions: readonly LayoutPresetDefinition[];
  selectedId: string | null;
  disabled: boolean;
  onSelect: (definition: LayoutPresetDefinition) => void;
}) {
  if (definitions.length === 0) {
    return (
      <Empty className="layout-preset-list-empty">
        <EmptyHeader>
          <EmptyTitle>검색 결과 없음</EmptyTitle>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <div className="layout-preset-list" role="listbox" aria-label="프리셋">
      {definitions.map((definition) => (
        <Button
          key={definition.id}
          className="layout-preset-list-item"
          variant={selectedId === definition.id ? "secondary" : "outline"}
          type="button"
          role="option"
          aria-selected={selectedId === definition.id}
          data-preset-id={definition.id}
          disabled={disabled}
          onClick={() => onSelect(definition)}
        >
          <DynamicLucideIcon
            iconName={definition.iconName}
            dynamicName={iconNameToDynamicName(definition.iconName)}
          />
          <span>
            <strong>{definition.name}</strong>
            <small>
              {categoryLabels[definition.category]} · {definition.elementCount}
            </small>
          </span>
        </Button>
      ))}
    </div>
  );
}

function PreviewCanvas({
  preview,
  definitions,
}: {
  preview: LayoutPresetPreviewDto;
  definitions: readonly ElementDefinitionDto[];
}) {
  const definitionByType = useMemo(
    () =>
      new Map(definitions.map((definition) => [definition.type, definition])),
    [definitions],
  );
  const rowCount = Math.max(
    1,
    ...preview.proposedElements.map(
      ({ entry }) => entry.layout.y + entry.layout.h,
    ),
  );
  const style = {
    "--layout-preset-preview-rows": rowCount,
  } as CSSProperties;
  return (
    <div
      className="layout-preset-preview-canvas"
      style={style}
      role="region"
      aria-label="실시간 레이아웃 미리보기"
      data-preview-id={preview.previewId}
      data-preview-coordinate-checksum={preview.coordinateChecksum}
    >
      {preview.proposedElements.map(({ templateId, entry }) => {
        const definition = definitionByType.get(entry.element.type);
        if (!definition) return null;
        const hasRequiredInput = definition.bindingPorts.some(
          (port) => port.direction === "input" && port.required,
        );
        const isStatistical = isStatisticalElementType(entry.element.type);
        const unconnected = preview.bindingPlaceholders.some(
          (placeholder) => placeholder.elementId === entry.element.id,
        );
        return (
          <div
            key={entry.element.id}
            className="layout-preset-preview-item"
            style={{
              gridColumn: `${entry.layout.x + 1} / span ${entry.layout.w}`,
              gridRow: `${entry.layout.y + 1} / span ${entry.layout.h}`,
            }}
            data-element-id={entry.element.id}
            data-template-id={templateId}
            data-element-type={entry.element.type}
            data-x={entry.layout.x}
            data-y={entry.layout.y}
            data-w={entry.layout.w}
            data-h={entry.layout.h}
          >
            {unconnected && (
              <Badge
                className="layout-preset-binding-warning"
                variant="secondary"
              >
                <TriangleAlert data-icon="inline-start" />
                미연결
              </Badge>
            )}
            <ElementRenderer
              entry={entry}
              definition={definition}
              compact
              renderState={
                isStatistical ? "DATA" : hasRequiredInput ? "EMPTY" : "DATA"
              }
              {...(isStatistical
                ? { renderData: LAYOUT_PRESET_PREVIEW_DATA }
                : {})}
            />
          </div>
        );
      })}
    </div>
  );
}

export function LayoutPresetBrowser({
  pageId,
  definitions,
  disabled = false,
  captureRevision,
  onApplied,
}: LayoutPresetBrowserProps) {
  const [open, setOpen] = useState(false);
  const [registry, setRegistry] = useState<LayoutPresetRegistryDto | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<LayoutPresetCategory | "all">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<LayoutPresetMode>("ADD");
  const [preview, setPreview] = useState<LayoutPresetPreviewDto | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [applying, setApplying] = useState(false);
  const [replaceConfirmationOpen, setReplaceConfirmationOpen] = useState(false);
  const [appliedEvidence, setAppliedEvidence] = useState<{
    readonly previewCoordinateChecksum: string;
    readonly appliedCoordinateChecksum: string;
    readonly instanceCoordinateChecksum: string;
  } | null>(null);
  const registryAbortRef = useRef<AbortController | null>(null);
  const previewAbortRef = useRef<AbortController | null>(null);
  const previewSequenceRef = useRef(0);
  const applyIntentRef = useRef<{
    previewId: string;
    idempotencyKey: string;
  } | null>(null);

  const selectedDefinition = registry?.definitions.find(
    (definition) => definition.id === selectedId,
  );
  const filteredDefinitions = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("ko-KR");
    return (registry?.definitions ?? []).filter((definition) => {
      if (category !== "all" && definition.category !== category) return false;
      return (
        normalizedQuery === "" ||
        `${definition.name} ${definition.description} ${definition.id}`
          .toLocaleLowerCase("ko-KR")
          .includes(normalizedQuery)
      );
    });
  }, [category, query, registry]);

  async function loadRegistry() {
    registryAbortRef.current?.abort();
    const controller = new AbortController();
    registryAbortRef.current = controller;
    setLoading(true);
    setError("");
    try {
      const payload = await listLayoutPresets(controller.signal);
      if (!controller.signal.aborted) setRegistry(payload);
    } catch (reason) {
      if (!controller.signal.aborted) setError(failureCopy(reason));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  async function requestPreview(
    definition: LayoutPresetDefinition,
    nextMode: LayoutPresetMode,
  ) {
    if (applying) return;
    const target = captureRevision();
    if (!target || target.pageId !== pageId) {
      setPreview(null);
      setPreviewError("페이지 필요");
      return;
    }
    previewAbortRef.current?.abort();
    const controller = new AbortController();
    previewAbortRef.current = controller;
    const sequence = ++previewSequenceRef.current;
    setPreview(null);
    setPreviewLoading(true);
    setPreviewError("");
    try {
      const payload = await previewLayoutPreset({
        pageId: target.pageId,
        presetId: definition.id,
        mode: nextMode,
        expectedLayoutRevision: target.layoutRevision,
        expectedProjectRevision: target.projectRevision,
        signal: controller.signal,
      });
      if (
        !controller.signal.aborted &&
        sequence === previewSequenceRef.current
      ) {
        if (!hasValidPreviewSnapshot(payload.preview)) {
          throw new Error("미리보기 좌표 불일치");
        }
        applyIntentRef.current = null;
        setPreview(payload.preview);
      }
    } catch (reason) {
      if (
        !controller.signal.aborted &&
        sequence === previewSequenceRef.current
      ) {
        setPreviewError(failureCopy(reason));
      }
    } finally {
      if (
        !controller.signal.aborted &&
        sequence === previewSequenceRef.current
      ) {
        setPreviewLoading(false);
      }
    }
  }

  async function commitPreview() {
    if (!preview || !selectedDefinition || applying) return;
    const applyIntent =
      applyIntentRef.current?.previewId === preview.previewId
        ? applyIntentRef.current
        : {
            previewId: preview.previewId,
            idempotencyKey: `layout-preset:${preview.pageId}:${preview.presetId}:${preview.previewId}:${crypto.randomUUID()}`,
          };
    applyIntentRef.current = applyIntent;
    setApplying(true);
    setPreviewError("");
    try {
      const result = await applyLayoutPreset({
        pageId: preview.pageId,
        presetId: preview.presetId,
        previewId: preview.previewId,
        expectedLayoutRevision: preview.layoutRevision,
        expectedProjectRevision: preview.projectRevision,
        idempotencyKey: applyIntent.idempotencyKey,
      });
      if (!hasExactAppliedCoordinates(preview, result)) {
        throw new Error("적용 좌표 불일치");
      }
      await onApplied(result);
      setAppliedEvidence({
        previewCoordinateChecksum: preview.coordinateChecksum,
        appliedCoordinateChecksum: result.coordinateChecksum,
        instanceCoordinateChecksum: result.instance.coordinateChecksum,
      });
      applyIntentRef.current = null;
      setReplaceConfirmationOpen(false);
      setOpen(false);
      setQuery("");
      setCategory("all");
      setSelectedId(null);
      setPreview(null);
      setPreviewError("");
      setMode("ADD");
    } catch (reason) {
      setReplaceConfirmationOpen(false);
      setPreviewError(failureCopy(reason));
      if (requiresNewPreview(reason)) {
        applyIntentRef.current = null;
        setPreview(null);
      }
    } finally {
      setApplying(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    void loadRegistry();
    return () => registryAbortRef.current?.abort();
  }, [open]);

  useEffect(() => {
    previewAbortRef.current?.abort();
    setSelectedId(null);
    setPreview(null);
    setPreviewError("");
    setMode("ADD");
    setAppliedEvidence(null);
  }, [pageId]);

  useEffect(
    () => () => {
      registryAbortRef.current?.abort();
      previewAbortRef.current?.abort();
    },
    [],
  );

  function changeOpen(nextOpen: boolean) {
    if (!nextOpen && applying) return;
    setOpen(nextOpen);
    if (!nextOpen) {
      previewAbortRef.current?.abort();
      setQuery("");
      setCategory("all");
      setSelectedId(null);
      setPreview(null);
      setPreviewError("");
      setMode("ADD");
      applyIntentRef.current = null;
    }
  }

  function selectDefinition(definition: LayoutPresetDefinition) {
    if (applying) return;
    setSelectedId(definition.id);
    void requestPreview(definition, mode);
  }

  function changeMode(value: string) {
    if (applying) return;
    if (value !== "ADD" && value !== "REPLACE") return;
    setMode(value);
    if (selectedDefinition) void requestPreview(selectedDefinition, value);
  }

  const applyDisabled = !preview || previewLoading || applying;

  return (
    <>
      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogTrigger asChild>
          <Button
            className="layout-preset-trigger"
            variant="outline"
            size="sm"
            type="button"
            disabled={disabled || !pageId}
            data-preview-coordinate-checksum={
              appliedEvidence?.previewCoordinateChecksum
            }
            data-applied-coordinate-checksum={
              appliedEvidence?.appliedCoordinateChecksum
            }
            data-instance-coordinate-checksum={
              appliedEvidence?.instanceCoordinateChecksum
            }
          >
            <LayoutTemplate data-icon="inline-start" />
            프리셋
          </Button>
        </DialogTrigger>
        <DialogContent
          className="layout-preset-dialog"
          showCloseButton={false}
          onEscapeKeyDown={(event) => {
            if (applying) event.preventDefault();
            else previewAbortRef.current?.abort();
          }}
          onPointerDownOutside={(event) => {
            if (applying) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (applying) event.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>프리셋</DialogTitle>
            <DialogDescription>레이아웃 선택</DialogDescription>
          </DialogHeader>

          {error ? (
            <Alert className="layout-preset-error" variant="destructive">
              <TriangleAlert />
              <AlertTitle>목록 오류</AlertTitle>
              <AlertDescription>
                <span>{error}</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void loadRegistry()}
                >
                  <RotateCcw data-icon="inline-start" />
                  재시도
                </Button>
              </AlertDescription>
            </Alert>
          ) : (
            <div className="layout-preset-browser">
              <section
                className="layout-preset-catalog"
                aria-label="프리셋 목록"
              >
                <div className="layout-preset-tools">
                  <div className="layout-preset-search">
                    <Search aria-hidden="true" />
                    <Input
                      value={query}
                      aria-label="프리셋 검색"
                      placeholder="검색"
                      disabled={applying}
                      onChange={(event) => setQuery(event.target.value)}
                    />
                  </div>
                  <Select
                    value={category}
                    disabled={applying}
                    onValueChange={(value) =>
                      setCategory(value as LayoutPresetCategory | "all")
                    }
                  >
                    <SelectTrigger
                      className="layout-preset-category"
                      aria-label="프리셋 분류"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent position="popper">
                      <SelectGroup>
                        <SelectItem value="all">전체</SelectItem>
                        {Object.entries(categoryLabels).map(
                          ([value, label]) => (
                            <SelectItem key={value} value={value}>
                              {label}
                            </SelectItem>
                          ),
                        )}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>
                {loading && !registry ? (
                  <div className="layout-preset-list-loading" role="status">
                    {Array.from({ length: 6 }, (_, index) => (
                      <Skeleton
                        key={index}
                        className="layout-preset-list-item"
                      />
                    ))}
                  </div>
                ) : (
                  <PresetList
                    definitions={filteredDefinitions}
                    selectedId={selectedId}
                    disabled={applying}
                    onSelect={selectDefinition}
                  />
                )}
              </section>

              <section
                className="layout-preset-preview"
                aria-label="프리셋 미리보기"
              >
                <div className="layout-preset-preview-heading">
                  <div>
                    <strong>{selectedDefinition?.name ?? "미리보기"}</strong>
                  </div>
                  {selectedDefinition && (
                    <Badge variant="outline">
                      {selectedDefinition.elementCount}개
                    </Badge>
                  )}
                </div>
                <ToggleGroup
                  className="layout-preset-modes"
                  type="single"
                  value={mode}
                  variant="outline"
                  spacing={0}
                  aria-label="적용 방식"
                  onValueChange={changeMode}
                >
                  <ToggleGroupItem
                    value="ADD"
                    aria-label="추가"
                    disabled={applying}
                  >
                    <Plus data-icon="inline-start" />
                    추가
                  </ToggleGroupItem>
                  <ToggleGroupItem
                    value="REPLACE"
                    aria-label="교체"
                    disabled={applying}
                  >
                    <Replace data-icon="inline-start" />
                    교체
                  </ToggleGroupItem>
                </ToggleGroup>

                {previewError && (
                  <Alert
                    className="layout-preset-preview-error"
                    variant="destructive"
                  >
                    <TriangleAlert />
                    <AlertTitle>미리보기 오류</AlertTitle>
                    <AlertDescription>
                      <span>{previewError}</span>
                      {selectedDefinition && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            void requestPreview(selectedDefinition, mode)
                          }
                        >
                          <RotateCcw data-icon="inline-start" />
                          재시도
                        </Button>
                      )}
                    </AlertDescription>
                  </Alert>
                )}
                {previewLoading ? (
                  <div
                    className="layout-preset-preview-loading"
                    role="status"
                    aria-label="미리보기 로딩"
                  >
                    <Skeleton className="h-full w-full" />
                  </div>
                ) : preview ? (
                  <>
                    <PreviewCanvas
                      preview={preview}
                      definitions={definitions}
                    />
                    <div className="layout-preset-preview-meta">
                      <Badge variant="secondary">
                        <TriangleAlert data-icon="inline-start" />
                        미연결 {preview.bindingPlaceholders.length}
                      </Badge>
                      {preview.mode === "REPLACE" && (
                        <Badge variant="outline">
                          교체 {preview.existingElementCount}
                        </Badge>
                      )}
                      {preview.suggestedSchema && (
                        <Badge
                          variant="outline"
                          title={preview.suggestedSchema.label}
                        >
                          <Database data-icon="inline-start" />
                          스키마 {preview.suggestedSchema.tables.length} · 읽기
                          전용
                        </Badge>
                      )}
                    </div>
                  </>
                ) : (
                  <Empty className="layout-preset-preview-empty">
                    <EmptyHeader>
                      <EmptyTitle>프리셋 선택</EmptyTitle>
                      <EmptyDescription>선택 후 미리보기</EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                )}
              </section>
            </div>
          )}

          <DialogFooter className="layout-preset-actions">
            <Button
              variant="outline"
              type="button"
              disabled={applying}
              onClick={() => changeOpen(false)}
            >
              취소
            </Button>
            <Button
              type="button"
              disabled={applyDisabled}
              onClick={() => {
                if (mode === "REPLACE") setReplaceConfirmationOpen(true);
                else void commitPreview();
              }}
            >
              {applying && <Spinner data-icon="inline-start" />}
              {applying ? "적용 중" : "적용"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={replaceConfirmationOpen}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && applying) return;
          setReplaceConfirmationOpen(nextOpen);
        }}
      >
        <AlertDialogContent
          onEscapeKeyDown={(event) => {
            if (applying) event.preventDefault();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>교체</AlertDialogTitle>
            <AlertDialogDescription>
              기존 {preview?.existingElementCount ?? 0}개 삭제 · 신규{" "}
              {preview?.createdElementCount ?? 0}개
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="layout-preset-replace-actions">
            <AlertDialogCancel disabled={applying}>취소</AlertDialogCancel>
            <AlertDialogAction
              disabled={applying}
              onClick={(event) => {
                event.preventDefault();
                void commitPreview();
              }}
            >
              {applying && <Spinner data-icon="inline-start" />}
              교체
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
