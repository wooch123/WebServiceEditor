import { useDroppable } from "@dnd-kit/core";
import {
  Grid3X3,
  Grip,
  LockKeyhole,
  RotateCcw,
  Trash2,
  TriangleAlert,
  UnlockKeyhole,
} from "lucide-react";
import GridLayout, {
  useContainerWidth,
  type Layout,
  type LayoutItem,
} from "react-grid-layout";
import {
  moveElement as moveGridElement,
  noCompactor,
  transformStrategy,
  verticalCompactor,
} from "react-grid-layout/core";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type Ref,
} from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { ElementEntryDto, ResizeHandle } from "@/services/elements-api";
import {
  DynamicLucideIcon,
  iconNameToDynamicName,
} from "@/features/pages/DynamicLucideIcon";
import {
  CANVAS_PADDING,
  CANVAS_ZOOM_LEVELS,
  DESKTOP_COLUMNS,
  GRID_GAP,
  GRID_ROW_HEIGHT,
  gridColumnWidth,
  gridToPixelRect,
} from "./element-geometry";
import { ElementRenderer } from "./ElementRenderer";
import {
  ELEMENT_CANVAS_DROP_ID,
  useElementWorkspace,
} from "./ElementWorkspace";

export const ELEMENT_RESIZE_HANDLES: readonly ResizeHandle[] = [
  "n",
  "s",
  "e",
  "w",
  "ne",
  "nw",
  "se",
  "sw",
];

export function createEditorScaledPositionStrategy(scale: number) {
  return { ...transformStrategy, scale };
}

interface ResizePreview {
  elementId: string;
  handle: ResizeHandle;
  x: number;
  y: number;
  w: number;
  h: number;
}

function entryLayout(entry: ElementEntryDto): LayoutItem {
  const { layout, element } = entry;
  return {
    i: element.id,
    x: layout.x,
    y: layout.y,
    w: layout.w,
    h: layout.h,
    minW: layout.minW,
    minH: layout.minH,
    maxW: layout.maxW,
    maxH: layout.maxH,
    static: element.locked,
    isDraggable: !element.locked,
    isResizable: !element.locked,
    isBounded: true,
    resizeHandles: element.locked ? [] : [...ELEMENT_RESIZE_HANDLES],
  };
}

function CustomResizeHandle({
  axis,
  handleRef,
  onActivate,
  onMouseDown,
  onPointerDown,
  ...dragHandleProps
}: Omit<ComponentPropsWithoutRef<"span">, "onMouseDown" | "onPointerDown"> & {
  axis: ResizeHandle;
  handleRef: Ref<HTMLElement>;
  onActivate: (axis: ResizeHandle) => void;
  onMouseDown?: ComponentPropsWithoutRef<"span">["onMouseDown"];
  onPointerDown?: ComponentPropsWithoutRef<"span">["onPointerDown"];
}) {
  return (
    <span
      {...dragHandleProps}
      ref={handleRef as Ref<HTMLSpanElement>}
      className={`react-resizable-handle react-resizable-handle-${axis} element-resize-handle`}
      role="button"
      tabIndex={-1}
      aria-label={`${axis} 크기 조절`}
      data-testid={`resize-handle-${axis}`}
      data-resize-handle={axis}
      onPointerDown={(event) => {
        onActivate(axis);
        onPointerDown?.(event);
      }}
      onMouseDown={(event) => {
        onActivate(axis);
        onMouseDown?.(event);
      }}
    />
  );
}

function CandidatePlaceholder({ canvasWidth }: { canvasWidth: number }) {
  const workspace = useElementWorkspace();
  const candidate = workspace.candidate;
  if (!candidate) return null;
  const definition = workspace.definitionByType.get(candidate.elementType);
  const rect = gridToPixelRect(candidate, canvasWidth);
  const style = {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };

  return (
    <div
      className={cn(
        "placement-placeholder",
        candidate.valid ? "is-valid" : "is-invalid",
        candidate.collisionResolved && "is-collision-resolved",
      )}
      style={style}
      role={workspace.keyboardPlacement ? "group" : "status"}
      tabIndex={workspace.keyboardPlacement ? 0 : -1}
      aria-label={`${definition?.label ?? candidate.elementType} 배치 후보 X ${candidate.x} Y ${candidate.y} W ${candidate.w} H ${candidate.h}`}
      data-testid="placement-placeholder"
      data-x={candidate.x}
      data-y={candidate.y}
      data-w={candidate.w}
      data-h={candidate.h}
      data-valid={String(candidate.valid)}
      data-collision-resolved={String(candidate.collisionResolved)}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          workspace.cancelPlacement();
          return;
        }
        if (event.target === event.currentTarget) {
          workspace.handleCandidateKeyDown(event);
        }
      }}
    >
      <div className="placement-placeholder-copy">
        {definition && (
          <DynamicLucideIcon
            iconName={definition.iconName}
            dynamicName={iconNameToDynamicName(definition.iconName)}
          />
        )}
        <strong>{definition?.label ?? candidate.elementType}</strong>
        <span>
          X {candidate.x} · Y {candidate.y} · W {candidate.w} · H {candidate.h}
        </span>
        <small>
          {!candidate.valid
            ? "배치 불가"
            : candidate.collisionResolved
              ? "충돌 조정"
              : "배치 가능"}
        </small>
      </div>
      {workspace.keyboardPlacement && (
        <div className="placement-placeholder-actions">
          <Button
            type="button"
            size="sm"
            disabled={!candidate.valid || workspace.mutating}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.stopPropagation();
              }
            }}
            onClick={() => void workspace.commitPlacement()}
          >
            배치
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.stopPropagation();
              }
            }}
            onClick={workspace.cancelPlacement}
          >
            취소
          </Button>
        </div>
      )}
    </div>
  );
}

interface PlacedElementProps extends Omit<
  ComponentPropsWithoutRef<"div">,
  "children"
> {
  entry: ElementEntryDto;
  resizePreview: ResizePreview | null;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

const PlacedElement = forwardRef<HTMLDivElement, PlacedElementProps>(
  function PlacedElement(
    { entry, resizePreview, className, style, children, ...gridItemProps },
    forwardedRef,
  ) {
    const workspace = useElementWorkspace();
    const selected = workspace.selectedElementIds.has(entry.element.id);
    const definition = workspace.definitionByType.get(entry.element.type);
    const resizing = resizePreview?.elementId === entry.element.id;
    const bindingResult = workspace.bindingResults.get(entry.element.id);
    const additivePointerRef = useRef(false);

    function select(event: PointerEvent<HTMLElement>) {
      event.stopPropagation();
      additivePointerRef.current =
        event.ctrlKey || event.metaKey || event.shiftKey;
      workspace.selectElement(entry.element.id, additivePointerRef.current);
    }

    function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
      if (event.target !== event.currentTarget) return;
      if (!event.key.startsWith("Arrow")) return;
      event.preventDefault();
      if (entry.element.locked) return;
      const step = event.shiftKey ? 4 : 1;
      let x = entry.layout.x;
      let y = entry.layout.y;
      if (event.key === "ArrowLeft") x -= step;
      if (event.key === "ArrowRight") x += step;
      if (event.key === "ArrowUp") y -= step;
      if (event.key === "ArrowDown") y += step;
      x = Math.max(0, Math.min(DESKTOP_COLUMNS - entry.layout.w, x));
      y = Math.max(0, y);
      const currentLayout = workspace.entries.map(entryLayout);
      const movingItem = currentLayout.find(
        (item) => item.i === entry.element.id,
      );
      if (!movingItem) return;
      const movedLayout = moveGridElement(
        currentLayout,
        movingItem,
        x,
        y,
        true,
        false,
        verticalCompactor.type,
        DESKTOP_COLUMNS,
        verticalCompactor.allowOverlap,
      );
      void workspace.persistCompleteLayout(
        verticalCompactor.compact(movedLayout, DESKTOP_COLUMNS),
      );
    }

    return (
      <div
        {...gridItemProps}
        ref={forwardedRef}
        className={cn(
          "placed-element",
          className,
          selected && "is-selected",
          entry.element.locked && "is-locked",
          resizing && "is-resizing",
        )}
        style={style}
        role="option"
        tabIndex={0}
        aria-label={`${entry.element.name} · ${entry.element.type}`}
        aria-selected={selected}
        data-testid={`placed-element-${entry.element.id}`}
        data-element-id={entry.element.id}
        data-x={entry.layout.x}
        data-y={entry.layout.y}
        data-w={entry.layout.w}
        data-h={entry.layout.h}
        onPointerDown={select}
        onPointerUp={() => {
          additivePointerRef.current = false;
        }}
        onFocus={() => {
          if (additivePointerRef.current) {
            additivePointerRef.current = false;
            return;
          }
          if (!selected) workspace.selectElement(entry.element.id, false);
        }}
        onKeyDown={handleKeyDown}
      >
        <div className="element-item-toolbar element-node-drag-area">
          <span className="element-drag-affordance" aria-hidden="true">
            <Grip />
          </span>
          <strong>{entry.element.name}</strong>
          <Button
            className="element-lock-control element-interactive"
            variant="ghost"
            size="icon-sm"
            type="button"
            aria-label={entry.element.locked ? "잠금 해제" : "잠금"}
            disabled={workspace.mutating}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              void workspace.toggleElementLock(entry);
            }}
          >
            {entry.element.locked ? <UnlockKeyhole /> : <LockKeyhole />}
          </Button>
          <Button
            className="element-delete-control element-interactive"
            variant="ghost"
            size="icon-sm"
            type="button"
            aria-label={`${entry.element.name} 삭제`}
            disabled={workspace.mutating || entry.element.locked}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              void workspace.removeElement(entry);
            }}
          >
            <Trash2 />
          </Button>
        </div>
        <div className="element-render-surface element-node-drag-area">
          {definition ? (
            <ElementRenderer
              entry={entry}
              definition={definition}
              compact={resizing}
              {...(bindingResult
                ? {
                    renderState: bindingResult.renderState,
                    ...(bindingResult.renderData
                      ? { renderData: bindingResult.renderData }
                      : {}),
                  }
                : workspace.selectedDetail?.entry.element.id ===
                    entry.element.id
                  ? {
                      renderState: workspace.selectedDetail.renderState.state,
                    }
                  : {})}
            />
          ) : (
            <Skeleton className="h-full w-full" />
          )}
        </div>
        {resizing && resizePreview && (
          <output
            className="element-resize-tooltip"
            data-testid="resize-tooltip"
            data-handle={resizePreview.handle}
          >
            W {resizePreview.w} · H {resizePreview.h}
          </output>
        )}
        {children}
      </div>
    );
  },
);

export function ElementCanvas() {
  const workspace = useElementWorkspace();
  const { width, containerRef } = useContainerWidth({ initialWidth: 960 });
  const { setNodeRef: setDroppableRef, isOver } = useDroppable({
    id: ELEMENT_CANVAS_DROP_ID,
    disabled: !workspace.pageId,
  });
  const [resizePreview, setResizePreview] = useState<ResizePreview | null>(
    null,
  );
  const [gridInstance, setGridInstance] = useState(0);
  const [rollbackLayout, setRollbackLayout] = useState<Layout | null>(null);
  const activeResizeHandleRef = useRef<ResizeHandle>("se");
  const activeGridInteractionRef = useRef<"drag" | "resize" | null>(null);
  const cancelledGridInteractionRef = useRef<"drag" | "resize" | null>(null);
  const interactionSnapshotRef = useRef<Layout | null>(null);
  const canvasWidth = Math.max(960, Math.round(width));
  const layout = useMemo<Layout>(
    () => workspace.entries.map(entryLayout),
    [workspace.entries],
  );
  const renderedLayout = rollbackLayout ?? layout;
  const contentRows = Math.max(
    96,
    ...workspace.entries.map((entry) => entry.layout.y + entry.layout.h + 48),
  );
  const contentHeight = Math.max(
    640,
    CANVAS_PADDING * 2 + contentRows * (GRID_ROW_HEIGHT + GRID_GAP),
  );
  const zoomShellStyle = {
    "--canvas-zoom": workspace.zoom,
    "--canvas-base-height": `${contentHeight}px`,
  } as CSSProperties;
  const canvasStyle = {
    "--canvas-column-pitch": `${gridColumnWidth(canvasWidth) + GRID_GAP}px`,
    transform: `scale(${workspace.zoom})`,
  } as CSSProperties;
  const positionStrategy = useMemo(
    () => createEditorScaledPositionStrategy(workspace.zoom),
    [workspace.zoom],
  );

  const setCanvasNode = useCallback(
    (node: HTMLDivElement | null) => {
      containerRef.current = node;
      workspace.canvasRef.current = node;
      setDroppableRef(node);
    },
    [containerRef, setDroppableRef, workspace.canvasRef],
  );

  useEffect(() => {
    workspace.setCanvasSize(canvasWidth, contentHeight);
  }, [canvasWidth, contentHeight, workspace]);

  useEffect(() => {
    setRollbackLayout(null);
  }, [workspace.entries]);

  useEffect(() => {
    function cancelGridInteraction(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape" || !activeGridInteractionRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      cancelledGridInteractionRef.current = activeGridInteractionRef.current;
      activeGridInteractionRef.current = null;
      setResizePreview(null);
      setRollbackLayout(
        interactionSnapshotRef.current?.map((item) => ({ ...item })) ?? null,
      );
      setGridInstance((current) => current + 1);
    }
    document.addEventListener("keydown", cancelGridInteraction, true);
    return () => {
      document.removeEventListener("keydown", cancelGridInteraction, true);
    };
  }, []);

  useEffect(() => {
    function handleSelectionKey(event: globalThis.KeyboardEvent) {
      if (workspace.selectedElementIds.size === 0) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest('input, textarea, [contenteditable="true"]')
      ) {
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        workspace.clearSelection();
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        void workspace.removeSelectedElements();
      }
    }
    document.addEventListener("keydown", handleSelectionKey);
    return () => document.removeEventListener("keydown", handleSelectionKey);
  }, [
    workspace.clearSelection,
    workspace.removeSelectedElements,
    workspace.selectedElementIds,
  ]);

  function beginGridInteraction(kind: "drag" | "resize") {
    cancelledGridInteractionRef.current = null;
    activeGridInteractionRef.current = kind;
    interactionSnapshotRef.current = layout.map((item) => ({ ...item }));
    setRollbackLayout(null);
  }

  function handleBlankPointerDown(event: PointerEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (
      !target.closest("[data-element-id], [data-testid=placement-placeholder]")
    ) {
      workspace.clearSelection();
    }
  }

  function handleDragStop(
    nextLayout: Layout,
    _oldItem: LayoutItem | null,
    _nextItem: LayoutItem | null,
  ) {
    if (cancelledGridInteractionRef.current === "drag") {
      cancelledGridInteractionRef.current = null;
      return;
    }
    activeGridInteractionRef.current = null;
    interactionSnapshotRef.current = null;
    setRollbackLayout(null);
    void workspace.persistCompleteLayout(
      verticalCompactor.compact(
        nextLayout.map((item) => ({ ...item })),
        DESKTOP_COLUMNS,
      ),
    );
  }

  function handleResizeStart(
    nextLayout: Layout,
    oldItem: LayoutItem | null,
    nextItem: LayoutItem | null,
    placeholder: LayoutItem | null,
    event: Event,
  ) {
    beginGridInteraction("resize");
    handleResize(nextLayout, oldItem, nextItem, placeholder, event);
  }

  function handleResize(
    _nextLayout: Layout,
    _oldItem: LayoutItem | null,
    nextItem: LayoutItem | null,
    _placeholder: LayoutItem | null,
    event: Event,
  ) {
    if (!nextItem) return;
    const target = event.target;
    const detectedHandle =
      target instanceof Element
        ? target.closest<HTMLElement>("[data-resize-handle]")?.dataset
            .resizeHandle
        : undefined;
    if (
      detectedHandle &&
      ELEMENT_RESIZE_HANDLES.includes(detectedHandle as ResizeHandle)
    ) {
      activeResizeHandleRef.current = detectedHandle as ResizeHandle;
    }
    setResizePreview({
      elementId: nextItem.i,
      handle: activeResizeHandleRef.current,
      x: nextItem.x,
      y: nextItem.y,
      w: nextItem.w,
      h: nextItem.h,
    });
  }

  function handleResizeStop(
    nextLayout: Layout,
    _oldItem: LayoutItem | null,
    nextItem: LayoutItem | null,
  ) {
    if (!nextItem) return;
    setResizePreview(null);
    if (cancelledGridInteractionRef.current === "resize") {
      cancelledGridInteractionRef.current = null;
      return;
    }
    activeGridInteractionRef.current = null;
    interactionSnapshotRef.current = null;
    setRollbackLayout(null);
    void workspace.persistCompleteLayout(
      verticalCompactor.compact(
        nextLayout.map((item) => ({ ...item })),
        DESKTOP_COLUMNS,
      ),
    );
  }

  return (
    <div
      ref={workspace.viewportRef}
      className={cn(
        "element-canvas-viewport",
        isOver && "is-drag-over",
        workspace.gridVisible && "is-grid-visible",
      )}
      data-testid="element-canvas"
      aria-label="페이지 캔버스"
      data-zoom={workspace.zoom}
      data-grid-visible={workspace.gridVisible}
      onPointerDown={handleBlankPointerDown}
    >
      <div className="element-canvas-zoom-shell" style={zoomShellStyle}>
        <div
          ref={setCanvasNode}
          className="element-canvas-document"
          style={canvasStyle}
          role="listbox"
          aria-label="배치 엘리먼트"
          aria-multiselectable="true"
        >
          {workspace.error && (
            <Alert className="element-canvas-alert" variant="destructive">
              <TriangleAlert />
              <AlertTitle>캔버스 오류</AlertTitle>
              <AlertDescription>
                <span>{workspace.error}</span>
                <Button
                  className="element-interactive"
                  variant="outline"
                  size="sm"
                  type="button"
                  onClick={() => void workspace.retry()}
                >
                  <RotateCcw data-icon="inline-start" />
                  재시도
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {workspace.loading ? (
            <div className="element-canvas-loading" role="status">
              <Skeleton className="h-24 w-1/3" />
              <Skeleton className="h-36 w-1/2" />
            </div>
          ) : (
            <>
              {workspace.entries.length === 0 && !workspace.candidate && (
                <Empty className="element-canvas-empty">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <Grid3X3 />
                    </EmptyMedia>
                    <EmptyTitle>빈 캔버스</EmptyTitle>
                    <EmptyDescription>엘리먼트를 배치하세요.</EmptyDescription>
                  </EmptyHeader>
                  <EmptyContent>
                    <span>드래그 · Enter</span>
                  </EmptyContent>
                </Empty>
              )}
              <GridLayout
                key={gridInstance}
                width={canvasWidth}
                layout={renderedLayout}
                gridConfig={{
                  cols: DESKTOP_COLUMNS,
                  rowHeight: GRID_ROW_HEIGHT,
                  margin: [GRID_GAP, GRID_GAP],
                  containerPadding: [CANVAS_PADDING, CANVAS_PADDING],
                }}
                dragConfig={{
                  enabled: !workspace.mutating,
                  bounded: true,
                  threshold: 12,
                  handle: ".element-node-drag-area",
                  cancel:
                    ".element-interactive, .element-resize-handle, button, input, textarea, select, a, label, [contenteditable='true']",
                }}
                resizeConfig={{
                  enabled: !workspace.mutating,
                  handles: ELEMENT_RESIZE_HANDLES,
                  handleComponent: (axis, handleRef) => (
                    <CustomResizeHandle
                      axis={axis}
                      handleRef={handleRef}
                      onActivate={(nextAxis) => {
                        activeResizeHandleRef.current = nextAxis;
                        beginGridInteraction("resize");
                      }}
                    />
                  ),
                }}
                compactor={noCompactor}
                positionStrategy={positionStrategy}
                onDragStart={() => beginGridInteraction("drag")}
                onDragStop={handleDragStop}
                onResizeStart={handleResizeStart}
                onResize={handleResize}
                onResizeStop={handleResizeStop}
              >
                {workspace.entries.map((entry) => (
                  <PlacedElement
                    key={entry.element.id}
                    entry={entry}
                    resizePreview={resizePreview}
                  />
                ))}
              </GridLayout>
              <CandidatePlaceholder canvasWidth={canvasWidth} />
              {workspace.candidateLoading && (
                <span className="candidate-loading" role="status">
                  위치 계산
                </span>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function CanvasControls() {
  const workspace = useElementWorkspace();
  return (
    <div className="canvas-controls" aria-label="캔버스 설정">
      {workspace.selectedElementIds.size > 0 && (
        <Badge variant="secondary">
          선택 {workspace.selectedElementIds.size}
        </Badge>
      )}
      <label className="canvas-zoom-control">
        <span className="sr-only">캔버스 배율</span>
        <select
          aria-label="캔버스 배율"
          value={workspace.zoom}
          onChange={(event) => workspace.setZoom(Number(event.target.value))}
        >
          {CANVAS_ZOOM_LEVELS.map((level) => (
            <option key={level} value={level}>
              {Math.round(level * 100)}%
            </option>
          ))}
        </select>
      </label>
      <Button
        className="canvas-grid-toggle"
        variant="outline"
        size="sm"
        type="button"
        aria-pressed={workspace.gridVisible}
        onClick={workspace.toggleGridVisible}
      >
        <Grid3X3 data-icon="inline-start" />
        그리드
      </Button>
    </div>
  );
}

export function ElementInspectorSummary() {
  const workspace = useElementWorkspace();
  const selected = workspace.entries.filter((entry) =>
    workspace.selectedElementIds.has(entry.element.id),
  );
  if (selected.length === 0) {
    return (
      <div className="inspector-summary" role="status">
        <span>선택 없음</span>
        <span>클릭 · Ctrl/Shift</span>
      </div>
    );
  }
  if (selected.length > 1) {
    return (
      <div className="inspector-summary" role="status">
        <span>다중 선택 {selected.length}</span>
      </div>
    );
  }
  const entry = selected[0]!;
  return (
    <div className="element-inspector-summary">
      <dl>
        <div>
          <dt>유형</dt>
          <dd>{entry.element.type}</dd>
        </div>
        <div>
          <dt>위치</dt>
          <dd>
            {entry.layout.x}, {entry.layout.y}
          </dd>
        </div>
        <div>
          <dt>크기</dt>
          <dd>
            {entry.layout.w} × {entry.layout.h}
          </dd>
        </div>
      </dl>
      <div className="element-inspector-actions">
        <Button
          variant="outline"
          size="sm"
          type="button"
          disabled={workspace.mutating}
          onClick={() => void workspace.toggleElementLock(entry)}
        >
          {entry.element.locked ? (
            <UnlockKeyhole data-icon="inline-start" />
          ) : (
            <LockKeyhole data-icon="inline-start" />
          )}
          {entry.element.locked ? "해제" : "잠금"}
        </Button>
        <Button
          variant="destructive"
          size="sm"
          type="button"
          disabled={workspace.mutating || entry.element.locked}
          onClick={() => void workspace.removeElement(entry)}
        >
          <Trash2 data-icon="inline-start" />
          삭제
        </Button>
      </div>
      {workspace.lastCommandId && <small>작업 기록됨</small>}
    </div>
  );
}
