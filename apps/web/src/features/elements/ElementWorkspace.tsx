import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragCancelEvent,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";

import {
  batchElementLayout,
  createElementFromPlacement,
  createPlacementCandidate,
  deleteElement,
  ElementsApiError,
  listElements,
  updateElement,
  type CanvasPointerDto,
  type ElementChangeDto,
  type ElementEntryDto,
  type ElementLayoutDto,
  type ElementType,
  type PlacementCandidateDto,
  type ResizeHandle,
} from "@/services/elements-api";
import { ElementPalette, PaletteDragOverlay } from "./ElementPalette";
import { canvasElementDefinitionByType } from "./element-definitions";
import {
  CANVAS_PADDING,
  GRID_GAP,
  GRID_ROW_HEIGHT,
  gridColumnWidth,
  normalizeCanvasPointer,
  placementCandidateIsFresh,
  placementMatchesLayout,
  snapPlacementCell,
} from "./element-geometry";

export const ELEMENT_CANVAS_DROP_ID = "element-canvas-drop";

interface RevisionPair {
  projectRevision: number;
  layoutRevision: number;
}

export interface CompleteCanvasLayoutItem {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface ElementWorkspaceContextValue {
  pageId: string | null;
  entries: ElementEntryDto[];
  loading: boolean;
  mutating: boolean;
  candidateLoading: boolean;
  error: string;
  lastCommandId: string | null;
  candidate: PlacementCandidateDto | null;
  activeElementType: ElementType | null;
  keyboardPlacement: boolean;
  selectedElementIds: ReadonlySet<string>;
  zoom: number;
  gridVisible: boolean;
  viewportRef: RefObject<HTMLDivElement | null>;
  canvasRef: RefObject<HTMLDivElement | null>;
  setCanvasSize: (width: number, height: number) => void;
  setZoom: (zoom: number) => void;
  toggleGridVisible: () => void;
  retry: () => Promise<void>;
  beginKeyboardPlacement: (elementType: ElementType) => Promise<void>;
  commitPlacement: () => Promise<void>;
  cancelPlacement: () => void;
  handleCandidateKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  selectElement: (elementId: string, additive: boolean) => void;
  clearSelection: () => void;
  persistCompleteLayout: (
    layout: readonly CompleteCanvasLayoutItem[],
  ) => Promise<void>;
  moveElement: (
    entry: ElementEntryDto,
    layout: Pick<ElementLayoutDto, "x" | "y" | "w" | "h">,
  ) => Promise<void>;
  resizeElement: (
    entry: ElementEntryDto,
    handle: ResizeHandle,
    layout: Pick<ElementLayoutDto, "x" | "y" | "w" | "h">,
  ) => Promise<void>;
  toggleElementLock: (entry: ElementEntryDto) => Promise<void>;
  removeElement: (entry: ElementEntryDto) => Promise<void>;
  removeSelectedElements: () => Promise<void>;
}

const ElementWorkspaceContext =
  createContext<ElementWorkspaceContextValue | null>(null);

export function useElementWorkspace(): ElementWorkspaceContextValue {
  const value = useContext(ElementWorkspaceContext);
  if (!value) {
    throw new Error("ElementWorkspaceProvider is required");
  }
  return value;
}

function isElementType(value: unknown): value is ElementType {
  return (
    value === "text" ||
    value === "button" ||
    value === "container" ||
    value === "kpi-card"
  );
}

function clientPoint(event: DragMoveEvent | DragEndEvent): {
  x: number;
  y: number;
} | null {
  const source = event.activatorEvent;
  if (!("clientX" in source) || !("clientY" in source)) return null;
  return {
    x: Number(source.clientX) + event.delta.x,
    y: Number(source.clientY) + event.delta.y,
  };
}

function upsertEntry(
  entries: ElementEntryDto[],
  next: ElementEntryDto,
): ElementEntryDto[] {
  const exists = entries.some((entry) => entry.element.id === next.element.id);
  if (!exists) return [...entries, next];
  return entries.map((entry) =>
    entry.element.id === next.element.id ? next : entry,
  );
}

function failureCopy(reason: unknown): string {
  if (!(reason instanceof ElementsApiError)) {
    return reason instanceof Error ? reason.message : "저장 실패";
  }
  if (reason.code === "ELEMENT_COLLISION") return "요소 충돌";
  if (reason.code === "ELEMENT_LOCKED") return "잠금 요소";
  if (reason.code === "PLACEMENT_CANDIDATE_EXPIRED") return "배치 만료";
  if (
    reason.code === "PLACEMENT_CANDIDATE_INVALID" ||
    reason.code === "PLACEMENT_CANDIDATE_PAGE_MISMATCH"
  ) {
    return "배치 불가";
  }
  if (reason.status === 409) return "변경 충돌 · 최신 상태";
  return reason.message;
}

export function ElementWorkspaceProvider({
  pageId,
  projectRevision,
  layoutRevision,
  onProjectRevisionChange,
  onLayoutRevisionChange,
  children,
}: {
  pageId: string | null;
  projectRevision: number;
  layoutRevision: number;
  onProjectRevisionChange: (revision: number) => void;
  onLayoutRevisionChange: (pageId: string, revision: number) => void;
  children: ReactNode;
}) {
  const [entries, setEntries] = useState<ElementEntryDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [candidateLoading, setCandidateLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastCommandId, setLastCommandId] = useState<string | null>(null);
  const [candidate, setCandidate] = useState<PlacementCandidateDto | null>(
    null,
  );
  const [activeElementType, setActiveElementType] =
    useState<ElementType | null>(null);
  const [keyboardPlacement, setKeyboardPlacement] = useState(false);
  const [selectedElementIds, setSelectedElementIds] = useState<Set<string>>(
    new Set(),
  );
  const [zoom, setZoom] = useState(1);
  const [gridVisible, setGridVisible] = useState(true);
  const toggleGridVisible = useCallback(() => {
    setGridVisible((visible) => !visible);
  }, []);
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const canvasWidthRef = useRef(960);
  const canvasHeightRef = useRef(640);
  const revisionRef = useRef<RevisionPair>({
    projectRevision,
    layoutRevision,
  });
  const revisionPageIdRef = useRef(pageId);
  const pageIdRef = useRef(pageId);
  const onProjectRevisionChangeRef = useRef(onProjectRevisionChange);
  const onLayoutRevisionChangeRef = useRef(onLayoutRevisionChange);
  const listAbortRef = useRef<AbortController | null>(null);
  const candidateAbortRef = useRef<AbortController | null>(null);
  const candidateSequenceRef = useRef(0);
  const candidateRef = useRef<PlacementCandidateDto | null>(null);
  const candidatePointerRef = useRef<CanvasPointerDto | null>(null);
  const candidateRequestRef = useRef<{
    key: string;
    promise: Promise<PlacementCandidateDto | null>;
    pending: boolean;
  } | null>(null);
  const activeElementTypeRef = useRef<ElementType | null>(null);
  const hasEnteredCanvasRef = useRef(false);
  const dragJustEndedRef = useRef(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  useEffect(() => {
    pageIdRef.current = pageId;
  }, [pageId]);

  useEffect(() => {
    const pageChanged = revisionPageIdRef.current !== pageId;
    revisionPageIdRef.current = pageId;
    revisionRef.current = {
      projectRevision: Math.max(
        revisionRef.current.projectRevision,
        projectRevision,
      ),
      layoutRevision: pageChanged
        ? layoutRevision
        : Math.max(revisionRef.current.layoutRevision, layoutRevision),
    };
  }, [layoutRevision, pageId, projectRevision]);

  useEffect(() => {
    onProjectRevisionChangeRef.current = onProjectRevisionChange;
    onLayoutRevisionChangeRef.current = onLayoutRevisionChange;
  }, [onLayoutRevisionChange, onProjectRevisionChange]);

  useEffect(() => {
    candidateRef.current = candidate;
  }, [candidate]);

  const applyRevisions = useCallback(
    (nextProjectRevision: number, nextLayoutRevision: number) => {
      const current = revisionRef.current;
      revisionRef.current = {
        projectRevision: Math.max(current.projectRevision, nextProjectRevision),
        layoutRevision: Math.max(current.layoutRevision, nextLayoutRevision),
      };
      const latestLayoutRevision = revisionRef.current.layoutRevision;
      if (nextProjectRevision >= current.projectRevision) {
        onProjectRevisionChangeRef.current(nextProjectRevision);
      }
      const currentPageId = pageIdRef.current;
      if (currentPageId) {
        onLayoutRevisionChangeRef.current(currentPageId, latestLayoutRevision);
      }
    },
    [],
  );

  const clearCandidate = useCallback(() => {
    candidateAbortRef.current?.abort();
    candidateAbortRef.current = null;
    candidateSequenceRef.current += 1;
    candidatePointerRef.current = null;
    candidateRequestRef.current = null;
    candidateRef.current = null;
    setCandidate(null);
    setCandidateLoading(false);
    setKeyboardPlacement(false);
  }, []);

  const cancelPlacement = useCallback(() => {
    clearCandidate();
    activeElementTypeRef.current = null;
    setActiveElementType(null);
  }, [clearCandidate]);

  useEffect(() => {
    function cancelPointerPlacement(event: globalThis.KeyboardEvent) {
      if (
        (event.key === "Escape" || event.code === "Escape") &&
        activeElementTypeRef.current &&
        !keyboardPlacement
      ) {
        event.preventDefault();
        cancelPlacement();
      }
    }
    document.addEventListener("keydown", cancelPointerPlacement, true);
    return () => {
      document.removeEventListener("keydown", cancelPointerPlacement, true);
    };
  }, [cancelPlacement, keyboardPlacement]);

  const load = useCallback(async () => {
    const currentPageId = pageIdRef.current;
    listAbortRef.current?.abort();
    cancelPlacement();
    setSelectedElementIds(new Set());
    setLastCommandId(null);
    if (!currentPageId) {
      setEntries([]);
      setLoading(false);
      setError("");
      return;
    }
    const controller = new AbortController();
    listAbortRef.current = controller;
    setLoading(true);
    setError("");
    try {
      const payload = await listElements(currentPageId, controller.signal);
      if (controller.signal.aborted || pageIdRef.current !== payload.pageId) {
        return;
      }
      setEntries(payload.elements);
      applyRevisions(payload.projectRevision, payload.layoutRevision);
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError")
        return;
      setError(reason instanceof Error ? reason.message : "캔버스 오류");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [applyRevisions, cancelPlacement]);

  useEffect(() => {
    void load();
    return () => {
      listAbortRef.current?.abort();
      candidateAbortRef.current?.abort();
    };
  }, [load, pageId]);

  const handleFailure = useCallback(
    async (reason: unknown) => {
      if (reason instanceof ElementsApiError && reason.status === 409) {
        await load();
        setError(failureCopy(reason));
        return;
      }
      setError(failureCopy(reason));
    },
    [load],
  );

  const pointerFromClient = useCallback(
    (point: { x: number; y: number }): CanvasPointerDto | null => {
      const viewport = viewportRef.current;
      const canvas = canvasRef.current;
      if (!viewport || !canvas) return null;
      const viewportRect = viewport.getBoundingClientRect();
      return normalizeCanvasPointer({
        clientX: point.x,
        clientY: point.y,
        viewportLeft: viewportRect.left,
        viewportTop: viewportRect.top,
        scrollLeft: viewport.scrollLeft,
        scrollTop: viewport.scrollTop,
        canvasOffsetLeft: canvas.offsetLeft,
        canvasOffsetTop: canvas.offsetTop,
        zoom,
      });
    },
    [zoom],
  );

  const pointInsideCanvas = useCallback((point: { x: number; y: number }) => {
    const canvas = canvasRef.current;
    if (!canvas) return false;
    const rect = canvas.getBoundingClientRect();
    return (
      point.x >= rect.left &&
      point.x <= rect.right &&
      point.y >= rect.top &&
      point.y <= rect.bottom
    );
  }, []);

  const requestCandidate = useCallback(
    (
      elementType: ElementType,
      pointer: CanvasPointerDto,
      options: { force?: boolean } = {},
    ): Promise<PlacementCandidateDto | null> => {
      const currentPageId = pageIdRef.current;
      if (!currentPageId) return Promise.resolve(null);
      const currentRevision = revisionRef.current;
      const definition = canvasElementDefinitionByType.get(elementType);
      if (!definition) return Promise.resolve(null);
      const { column, row } = snapPlacementCell({
        correctedCanvasX: pointer.correctedCanvasX,
        correctedCanvasY: pointer.correctedCanvasY,
        canvasWidth: canvasWidthRef.current,
        defaultW: definition.defaultW,
      });
      const boundary =
        pointer.correctedCanvasX < 0
          ? "left"
          : pointer.correctedCanvasX > canvasWidthRef.current
            ? "right"
            : pointer.correctedCanvasY < 0
              ? "top"
              : pointer.correctedCanvasY > canvasHeightRef.current
                ? "bottom"
                : "inside";
      const requestKey = [
        currentPageId,
        elementType,
        column,
        row,
        boundary,
        canvasWidthRef.current,
        canvasHeightRef.current,
        currentRevision.projectRevision,
        currentRevision.layoutRevision,
      ].join(":");
      const existingRequest = candidateRequestRef.current;
      if (!options.force && existingRequest?.key === requestKey) {
        if (existingRequest.pending) return existingRequest.promise;
        const cachedCandidate = candidateRef.current;
        if (
          cachedCandidate &&
          cachedCandidate.elementType === elementType &&
          placementCandidateIsFresh(cachedCandidate)
        ) {
          return Promise.resolve(cachedCandidate);
        }
      }
      candidateAbortRef.current?.abort();
      const controller = new AbortController();
      candidateAbortRef.current = controller;
      const sequence = ++candidateSequenceRef.current;
      candidatePointerRef.current = pointer;
      setCandidateLoading(true);
      setError("");
      const requestRecord: {
        key: string;
        promise: Promise<PlacementCandidateDto | null>;
        pending: boolean;
      } = {
        key: requestKey,
        promise: Promise.resolve(null),
        pending: true,
      };
      const requestPromise = (async () => {
        try {
          const payload = await createPlacementCandidate({
            pageId: currentPageId,
            elementType,
            pointer,
            canvasWidth: canvasWidthRef.current,
            canvasHeight: canvasHeightRef.current,
            expectedLayoutRevision: currentRevision.layoutRevision,
            expectedProjectRevision: currentRevision.projectRevision,
            signal: controller.signal,
          });
          if (
            controller.signal.aborted ||
            sequence !== candidateSequenceRef.current ||
            pageIdRef.current !== currentPageId
          ) {
            return null;
          }
          candidateRef.current = payload.candidate;
          setCandidate(payload.candidate);
          return payload.candidate;
        } catch (reason) {
          if (reason instanceof DOMException && reason.name === "AbortError") {
            return null;
          }
          await handleFailure(reason);
          return null;
        } finally {
          requestRecord.pending = false;
          if (sequence === candidateSequenceRef.current) {
            setCandidateLoading(false);
          }
        }
      })();
      requestRecord.promise = requestPromise;
      candidateRequestRef.current = requestRecord;
      return requestPromise;
    },
    [handleFailure],
  );

  const beginKeyboardPlacement = useCallback(
    async (elementType: ElementType) => {
      if (dragJustEndedRef.current || !pageIdRef.current) return;
      const viewport = viewportRef.current;
      const canvas = canvasRef.current;
      if (!viewport || !canvas) return;
      const correctedCanvasX = CANVAS_PADDING + 1;
      const correctedCanvasY = CANVAS_PADDING + 1;
      const pointer = {
        rawCanvasX:
          correctedCanvasX * zoom - viewport.scrollLeft + canvas.offsetLeft,
        rawCanvasY:
          correctedCanvasY * zoom - viewport.scrollTop + canvas.offsetTop,
        correctedCanvasX,
        correctedCanvasY,
      };
      activeElementTypeRef.current = elementType;
      setActiveElementType(elementType);
      setKeyboardPlacement(true);
      await requestCandidate(elementType, pointer);
      requestAnimationFrame(() => {
        document
          .querySelector<HTMLElement>("[data-testid=placement-placeholder]")
          ?.focus();
      });
    },
    [requestCandidate, zoom],
  );

  const commitCandidate = useCallback(
    async (placement: PlacementCandidateDto) => {
      const currentPageId = pageIdRef.current;
      if (!currentPageId || !placement.valid || mutating) {
        return;
      }
      setMutating(true);
      setError("");
      try {
        const currentRevision = revisionRef.current;
        const payload = await createElementFromPlacement({
          pageId: currentPageId,
          candidateId: placement.candidateId,
          expectedLayoutRevision: currentRevision.layoutRevision,
          expectedProjectRevision: currentRevision.projectRevision,
        });
        if (!placementMatchesLayout(placement, payload.entry.layout)) {
          throw new Error("배치 결과 불일치");
        }
        setEntries((current) => upsertEntry(current, payload.entry));
        setSelectedElementIds(new Set([payload.entry.element.id]));
        setLastCommandId(payload.commandId);
        applyRevisions(payload.projectRevision, payload.layoutRevision);
        cancelPlacement();
        requestAnimationFrame(() => {
          document
            .querySelector<HTMLElement>(
              `[data-testid="placed-element-${payload.entry.element.id}"]`,
            )
            ?.focus();
        });
      } catch (reason) {
        await handleFailure(reason);
      } finally {
        setMutating(false);
      }
    },
    [applyRevisions, cancelPlacement, handleFailure, mutating],
  );

  const commitPlacement = useCallback(async () => {
    let placement = candidateRef.current;
    if (!placement) return;
    if (!placementCandidateIsFresh(placement)) {
      const pointer = candidatePointerRef.current;
      if (!pointer) return;
      placement = await requestCandidate(placement.elementType, pointer, {
        force: true,
      });
      if (!placement) return;
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });
    }
    await commitCandidate(placement);
  }, [commitCandidate, requestCandidate]);

  const moveKeyboardCandidate = useCallback(
    async (columnDelta: number, rowDelta: number) => {
      const currentCandidate = candidateRef.current;
      const elementType = activeElementTypeRef.current;
      const viewport = viewportRef.current;
      const canvas = canvasRef.current;
      if (!currentCandidate || !elementType || !viewport || !canvas) return;
      const columnPitch = gridColumnWidth(canvasWidthRef.current) + GRID_GAP;
      const rowPitch = GRID_ROW_HEIGHT + GRID_GAP;
      const correctedCanvasX =
        CANVAS_PADDING +
        Math.max(0, currentCandidate.x + columnDelta) * columnPitch +
        1;
      const correctedCanvasY =
        CANVAS_PADDING +
        Math.max(0, currentCandidate.y + rowDelta) * rowPitch +
        1;
      await requestCandidate(elementType, {
        rawCanvasX:
          correctedCanvasX * zoom - viewport.scrollLeft + canvas.offsetLeft,
        rawCanvasY:
          correctedCanvasY * zoom - viewport.scrollTop + canvas.offsetTop,
        correctedCanvasX,
        correctedCanvasY,
      });
      requestAnimationFrame(() => {
        document
          .querySelector<HTMLElement>("[data-testid=placement-placeholder]")
          ?.focus();
      });
    },
    [requestCandidate, zoom],
  );

  const handleCandidateKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      const step = event.shiftKey ? 4 : 1;
      if (event.key === "Enter") {
        event.preventDefault();
        void commitPlacement();
      } else if (event.key === "Escape") {
        event.preventDefault();
        cancelPlacement();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        void moveKeyboardCandidate(-step, 0);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        void moveKeyboardCandidate(step, 0);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        void moveKeyboardCandidate(0, -step);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        void moveKeyboardCandidate(0, step);
      }
    },
    [cancelPlacement, commitPlacement, moveKeyboardCandidate],
  );

  const mutateEntry = useCallback(
    async (entry: ElementEntryDto, change: ElementChangeDto) => {
      if (mutating) return;
      if (
        entry.element.locked &&
        (change.kind === "MOVE" || change.kind === "RESIZE")
      ) {
        setError("잠금 요소");
        return;
      }
      setMutating(true);
      setError("");
      if (change.kind === "MOVE" || change.kind === "RESIZE") {
        setEntries((current) =>
          current.map((candidateEntry) =>
            candidateEntry.element.id === entry.element.id
              ? {
                  ...candidateEntry,
                  layout: {
                    ...candidateEntry.layout,
                    x: change.x,
                    y: change.y,
                    ...(change.kind === "RESIZE"
                      ? { w: change.w, h: change.h }
                      : {}),
                  },
                }
              : candidateEntry,
          ),
        );
      }
      try {
        const currentRevision = revisionRef.current;
        const payload = await updateElement({
          entry,
          expectedLayoutRevision: currentRevision.layoutRevision,
          expectedProjectRevision: currentRevision.projectRevision,
          change,
        });
        setEntries((current) => upsertEntry(current, payload.entry));
        setLastCommandId(payload.commandId);
        applyRevisions(payload.projectRevision, payload.layoutRevision);
      } catch (reason) {
        if (!(reason instanceof ElementsApiError && reason.status === 409)) {
          setEntries((current) => upsertEntry(current, entry));
        }
        await handleFailure(reason);
      } finally {
        setMutating(false);
      }
    },
    [applyRevisions, handleFailure, mutating],
  );

  const persistCompleteLayout = useCallback(
    async (layout: readonly CompleteCanvasLayoutItem[]) => {
      if (mutating || layout.length !== entries.length) return;
      const nextById = new Map(layout.map((item) => [item.i, item]));
      if (
        entries.some((entry) => !nextById.has(entry.element.id)) ||
        !entries.some((entry) => {
          const next = nextById.get(entry.element.id)!;
          return (
            next.x !== entry.layout.x ||
            next.y !== entry.layout.y ||
            next.w !== entry.layout.w ||
            next.h !== entry.layout.h
          );
        })
      ) {
        return;
      }
      const snapshot = entries;
      const optimistic = entries.map((entry) => {
        const next = nextById.get(entry.element.id)!;
        return {
          ...entry,
          layout: {
            ...entry.layout,
            x: next.x,
            y: next.y,
            w: next.w,
            h: next.h,
          },
        };
      });
      setEntries(optimistic);
      setMutating(true);
      setError("");
      try {
        const currentPageId = pageIdRef.current;
        if (!currentPageId) return;
        const currentRevision = revisionRef.current;
        const payload = await batchElementLayout({
          pageId: currentPageId,
          expectedLayoutRevision: currentRevision.layoutRevision,
          expectedProjectRevision: currentRevision.projectRevision,
          mode: "COMPLETE",
          items: entries.map((entry) => {
            const next = nextById.get(entry.element.id)!;
            return {
              elementId: entry.element.id,
              expectedRevision: entry.element.revision,
              x: next.x,
              y: next.y,
              w: next.w,
              h: next.h,
            };
          }),
        });
        setEntries(payload.entries);
        setLastCommandId(payload.commandId);
        applyRevisions(payload.projectRevision, payload.layoutRevision);
      } catch (reason) {
        if (!(reason instanceof ElementsApiError && reason.status === 409)) {
          setEntries(snapshot);
        }
        await handleFailure(reason);
      } finally {
        setMutating(false);
      }
    },
    [applyRevisions, entries, handleFailure, mutating],
  );

  const moveElement = useCallback(
    async (
      entry: ElementEntryDto,
      layout: Pick<ElementLayoutDto, "x" | "y" | "w" | "h">,
    ) => {
      if (entry.layout.x === layout.x && entry.layout.y === layout.y) return;
      await mutateEntry(entry, { kind: "MOVE", x: layout.x, y: layout.y });
    },
    [mutateEntry],
  );

  const resizeElement = useCallback(
    async (
      entry: ElementEntryDto,
      handle: ResizeHandle,
      layout: Pick<ElementLayoutDto, "x" | "y" | "w" | "h">,
    ) => {
      if (
        entry.layout.x === layout.x &&
        entry.layout.y === layout.y &&
        entry.layout.w === layout.w &&
        entry.layout.h === layout.h
      ) {
        return;
      }
      await mutateEntry(entry, { kind: "RESIZE", handle, ...layout });
    },
    [mutateEntry],
  );

  const toggleElementLock = useCallback(
    async (entry: ElementEntryDto) => {
      await mutateEntry(entry, {
        kind: "LOCK",
        locked: !entry.element.locked,
      });
    },
    [mutateEntry],
  );

  const removeElement = useCallback(
    async (entry: ElementEntryDto) => {
      if (mutating) return;
      if (entry.element.locked) {
        setError("잠금 요소");
        return;
      }
      setMutating(true);
      setError("");
      try {
        const currentRevision = revisionRef.current;
        const payload = await deleteElement({
          entry,
          expectedLayoutRevision: currentRevision.layoutRevision,
          expectedProjectRevision: currentRevision.projectRevision,
        });
        setEntries((current) =>
          current.filter(
            (candidateEntry) =>
              candidateEntry.element.id !== payload.deletedElementId,
          ),
        );
        setSelectedElementIds((current) => {
          const next = new Set(current);
          next.delete(payload.deletedElementId);
          return next;
        });
        setLastCommandId(payload.commandId);
        applyRevisions(payload.projectRevision, payload.layoutRevision);
      } catch (reason) {
        await handleFailure(reason);
      } finally {
        setMutating(false);
      }
    },
    [applyRevisions, handleFailure, mutating],
  );

  const removeSelectedElements = useCallback(async () => {
    if (mutating) return;
    const selectedEntries = entries.filter((entry) =>
      selectedElementIds.has(entry.element.id),
    );
    if (selectedEntries.length === 0) return;
    if (selectedEntries.some((entry) => entry.element.locked)) {
      setError("잠금 요소");
      return;
    }
    setMutating(true);
    setError("");
    try {
      let lastCommandId: string | null = null;
      for (const entry of selectedEntries) {
        const currentRevision = revisionRef.current;
        const payload = await deleteElement({
          entry,
          expectedLayoutRevision: currentRevision.layoutRevision,
          expectedProjectRevision: currentRevision.projectRevision,
        });
        lastCommandId = payload.commandId;
        applyRevisions(payload.projectRevision, payload.layoutRevision);
      }
      const deletedIds = new Set(
        selectedEntries.map((entry) => entry.element.id),
      );
      setEntries((current) =>
        current.filter((entry) => !deletedIds.has(entry.element.id)),
      );
      setSelectedElementIds(new Set());
      setLastCommandId(lastCommandId);
    } catch (reason) {
      // Multiple DELETEs have no batch route; reload authoritative state if a
      // later request fails after an earlier request committed.
      await load();
      setError(failureCopy(reason));
    } finally {
      setMutating(false);
    }
  }, [applyRevisions, entries, load, mutating, selectedElementIds]);

  const selectElement = useCallback((elementId: string, additive: boolean) => {
    setSelectedElementIds((current) => {
      if (!additive) return new Set([elementId]);
      const next = new Set(current);
      if (next.has(elementId)) next.delete(elementId);
      else next.add(elementId);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedElementIds(new Set());
  }, []);

  function handleDragStart(event: DragStartEvent) {
    const elementType = event.active.data.current?.elementType;
    if (!isElementType(elementType)) return;
    hasEnteredCanvasRef.current = false;
    activeElementTypeRef.current = elementType;
    setActiveElementType(elementType);
    setKeyboardPlacement(false);
    setError("");
  }

  function handleDragMove(event: DragMoveEvent) {
    const elementType = activeElementTypeRef.current;
    if (!elementType) {
      if (candidateRef.current) clearCandidate();
      return;
    }
    const point = clientPoint(event);
    if (!point) return;
    if (pointInsideCanvas(point)) {
      hasEnteredCanvasRef.current = true;
    }
    if (!hasEnteredCanvasRef.current) return;
    const pointer = pointerFromClient(point);
    if (!pointer) return;
    void requestCandidate(elementType, pointer);
  }

  function finishDrag() {
    dragJustEndedRef.current = true;
    window.setTimeout(() => {
      dragJustEndedRef.current = false;
    }, 0);
    hasEnteredCanvasRef.current = false;
    activeElementTypeRef.current = null;
    setActiveElementType(null);
  }

  function handleDragCancel(_event: DragCancelEvent) {
    finishDrag();
    cancelPlacement();
  }

  async function finishPointerDrop(event: DragEndEvent) {
    const elementType = activeElementTypeRef.current;
    const point = clientPoint(event);
    const enteredCanvas =
      hasEnteredCanvasRef.current || Boolean(point && pointInsideCanvas(point));
    finishDrag();
    if (!elementType || !point || !enteredCanvas) {
      cancelPlacement();
      return;
    }
    const pointer = pointerFromClient(point);
    if (!pointer) {
      cancelPlacement();
      return;
    }
    const finalCandidate = await requestCandidate(elementType, pointer);
    if (!finalCandidate?.valid) {
      cancelPlacement();
      return;
    }
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
    await commitCandidate(finalCandidate);
  }

  function handleDragEnd(event: DragEndEvent) {
    void finishPointerDrop(event);
  }

  const value = useMemo<ElementWorkspaceContextValue>(
    () => ({
      pageId,
      entries,
      loading,
      mutating,
      candidateLoading,
      error,
      lastCommandId,
      candidate,
      activeElementType,
      keyboardPlacement,
      selectedElementIds,
      zoom,
      gridVisible,
      viewportRef,
      canvasRef,
      setCanvasSize: (width, height) => {
        if (width > 0) canvasWidthRef.current = width;
        if (height > 0) canvasHeightRef.current = height;
      },
      setZoom,
      toggleGridVisible,
      retry: load,
      beginKeyboardPlacement,
      commitPlacement,
      cancelPlacement,
      handleCandidateKeyDown,
      selectElement,
      clearSelection,
      persistCompleteLayout,
      moveElement,
      resizeElement,
      toggleElementLock,
      removeElement,
      removeSelectedElements,
    }),
    [
      activeElementType,
      beginKeyboardPlacement,
      cancelPlacement,
      candidate,
      candidateLoading,
      clearSelection,
      commitPlacement,
      entries,
      error,
      gridVisible,
      handleCandidateKeyDown,
      keyboardPlacement,
      lastCommandId,
      load,
      loading,
      moveElement,
      mutating,
      pageId,
      persistCompleteLayout,
      removeElement,
      removeSelectedElements,
      resizeElement,
      selectElement,
      selectedElementIds,
      toggleElementLock,
      toggleGridVisible,
      zoom,
    ],
  );

  return (
    <ElementWorkspaceContext.Provider value={value}>
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={handleDragStart}
        onDragMove={handleDragMove}
        onDragCancel={handleDragCancel}
        onDragEnd={handleDragEnd}
      >
        {children}
        <DragOverlay dropAnimation={{ duration: 140, easing: "ease-out" }}>
          {activeElementType ? (
            <PaletteDragOverlay elementType={activeElementType} />
          ) : null}
        </DragOverlay>
      </DndContext>
    </ElementWorkspaceContext.Provider>
  );
}

export function WorkspaceElementPalette({
  disabled = false,
}: {
  disabled?: boolean;
}) {
  const workspace = useElementWorkspace();
  return (
    <ElementPalette
      disabled={disabled || !workspace.pageId || workspace.mutating}
      onKeyboardPlace={(elementType) => {
        void workspace.beginKeyboardPlacement(elementType);
      }}
    />
  );
}
