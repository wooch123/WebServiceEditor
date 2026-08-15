import type {
  DataRelationshipGraphDto,
  RelationshipBindingType,
  RelationshipConnectionPreviewDto,
  RelationshipHistoryDto,
  RelationshipNodeDto,
  RelationshipPortDto,
} from "@webeditor/domain";
import {
  ArrowRight,
  Link2,
  LoaderCircle,
  Redo2,
  RefreshCw,
  Trash2,
  Undo2,
  Unplug,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { DynamicLucideIcon } from "@/features/pages/DynamicLucideIcon";
import {
  dataRelationshipApi,
  RelationshipApiError,
} from "@/services/data-relationship-api";

interface RelationshipCanvasProps {
  readonly projectId: string;
  readonly projectRevision: number;
  readonly onProjectRevisionChange: (revision: number) => void;
}

interface Point {
  readonly x: number;
  readonly y: number;
}

const bindingLabels: Record<RelationshipBindingType, string> = {
  CONTAINS: "포함",
  READ: "조회",
  CREATE: "생성",
  UPDATE: "수정",
  DELETE: "삭제",
  FILTER: "필터",
  NAVIGATE: "이동",
  RELATION: "관계",
};

function errorText(error: unknown): string {
  if (error instanceof RelationshipApiError) {
    if (error.code.includes("REVISION") || error.status === 409) {
      return "변경 충돌";
    }
    return error.message;
  }
  return "요청 실패";
}

function idempotencyKey(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function portPoint(
  node: RelationshipNodeDto,
  port: RelationshipPortDto,
): Point {
  const peers = node.ports.filter(
    ({ direction }) => direction === port.direction,
  );
  const index = Math.max(
    0,
    peers.findIndex(({ id }) => id === port.id),
  );
  return {
    x: port.side === "left" ? node.x : node.x + node.width,
    y: node.y + 76 + index * 30,
  };
}

function edgePath(source: Point, target: Point): string {
  const middle = source.x + Math.max(32, (target.x - source.x) / 2);
  return `M ${source.x} ${source.y} H ${middle} V ${target.y} H ${target.x}`;
}

function portCompatible(
  source: RelationshipPortDto,
  target: RelationshipPortDto,
): boolean {
  return (
    source.direction === "output" &&
    source.side === "right" &&
    target.direction === "input" &&
    target.side === "left" &&
    source.id !== target.id &&
    source.allowedBindingTypes.some((type) =>
      target.allowedBindingTypes.includes(type),
    )
  );
}

function RelationshipNode({
  node,
  sourcePort,
  onSource,
  onTarget,
}: {
  readonly node: RelationshipNodeDto;
  readonly sourcePort: RelationshipPortDto | null;
  readonly onSource: (port: RelationshipPortDto) => void;
  readonly onTarget: (port: RelationshipPortDto) => void;
}) {
  const inputs = node.ports.filter(({ direction }) => direction === "input");
  const outputs = node.ports.filter(({ direction }) => direction === "output");
  return (
    <Card
      size="sm"
      className={`relationship-node relationship-node-${node.type}`}
      style={{
        left: node.x,
        top: node.y,
        width: node.width,
        minHeight: node.height,
      }}
      data-node-id={node.id}
      data-node-type={node.type}
    >
      <CardHeader>
        <span className="relationship-node-icon">
          <DynamicLucideIcon iconName={node.iconName} />
        </span>
        <CardTitle>{node.label}</CardTitle>
        <CardDescription>{node.subtitle}</CardDescription>
      </CardHeader>
      <CardContent className="relationship-port-content">
        <TooltipProvider>
          <div className="relationship-port-column is-input">
            {inputs.map((port) => {
              const compatible =
                sourcePort !== null && portCompatible(sourcePort, port);
              return (
                <Tooltip key={port.id}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className={`relationship-port is-input ${compatible ? "is-compatible" : ""}`}
                      data-port-id={port.id}
                      data-direction="input"
                      data-side="left"
                      aria-label={`${port.label} 입력`}
                      onPointerUp={() => {
                        if (sourcePort) onTarget(port);
                      }}
                      onClick={() => {
                        if (sourcePort) onTarget(port);
                      }}
                    >
                      <span
                        className="relationship-port-marker"
                        aria-hidden="true"
                      />
                      <span>{port.label}</span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="left">
                    입력 · {port.valueType} ·{" "}
                    {port.allowedBindingTypes.join("/")}
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>
          <div className="relationship-port-column is-output">
            {outputs.map((port) => (
              <Tooltip key={port.id}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className={`relationship-port is-output ${sourcePort?.id === port.id ? "is-active" : ""}`}
                    data-port-id={port.id}
                    data-direction="output"
                    data-side="right"
                    aria-label={`${port.label} 출력`}
                    aria-pressed={sourcePort?.id === port.id}
                    onPointerDown={() => onSource(port)}
                    onClick={() => onSource(port)}
                  >
                    <span>{port.label}</span>
                    <span
                      className="relationship-port-marker"
                      aria-hidden="true"
                    />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">
                  출력 · {port.valueType} · {port.allowedBindingTypes.join("/")}
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        </TooltipProvider>
      </CardContent>
    </Card>
  );
}

export function RelationshipCanvas({
  projectId,
  projectRevision,
  onProjectRevisionChange,
}: RelationshipCanvasProps) {
  const [graph, setGraph] = useState<DataRelationshipGraphDto | null>(null);
  const [history, setHistory] = useState<RelationshipHistoryDto | null>(null);
  const [sourcePort, setSourcePort] = useState<RelationshipPortDto | null>(
    null,
  );
  const [pointer, setPointer] = useState<Point | null>(null);
  const [preview, setPreview] =
    useState<RelationshipConnectionPreviewDto | null>(null);
  const [bindingType, setBindingType] =
    useState<RelationshipBindingType>("READ");
  const [selectedBindingId, setSelectedBindingId] = useState<string | null>(
    null,
  );
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const revisionRef = useRef(projectRevision);
  const callbackRef = useRef(onProjectRevisionChange);
  const previewRequestRef = useRef(false);

  useEffect(() => {
    revisionRef.current = Math.max(revisionRef.current, projectRevision);
  }, [projectRevision]);
  useEffect(() => {
    callbackRef.current = onProjectRevisionChange;
  }, [onProjectRevisionChange]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextGraph, nextHistory] = await Promise.all([
        dataRelationshipApi.graph(projectId),
        dataRelationshipApi.history(projectId),
      ]);
      setGraph(nextGraph);
      setHistory(nextHistory);
      revisionRef.current = Math.max(
        revisionRef.current,
        nextGraph.projectRevision,
      );
      callbackRef.current(revisionRef.current);
      setSelectedBindingId((current) =>
        nextGraph.edges.some(({ id }) => id === current) ? current : null,
      );
    } catch (requestError) {
      setError(errorText(requestError));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setSourcePort(null);
      setPointer(null);
      setPreview(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const nodesById = useMemo(
    () => new Map(graph?.nodes.map((node) => [node.id, node]) ?? []),
    [graph],
  );
  const portsById = useMemo(
    () =>
      new Map(
        graph?.nodes.flatMap((node) =>
          node.ports.map((port) => [port.id, port] as const),
        ) ?? [],
      ),
    [graph],
  );
  const selectedBinding =
    graph?.edges.find(({ id }) => id === selectedBindingId) ?? null;
  const canvasSize = useMemo(() => {
    const nodes = graph?.nodes ?? [];
    return {
      width: Math.max(1120, ...nodes.map((node) => node.x + node.width + 120)),
      height: Math.max(620, ...nodes.map((node) => node.y + node.height + 120)),
    };
  }, [graph]);

  const beginSource = (port: RelationshipPortDto) => {
    setSourcePort(port);
    setPointer(null);
    setPreview(null);
    setError(null);
  };

  const targetPort = async (target: RelationshipPortDto) => {
    if (!graph || !sourcePort || busy || previewRequestRef.current) return;
    previewRequestRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const next = await dataRelationshipApi.preview(projectId, {
        sourcePortId: sourcePort.id,
        targetPortId: target.id,
        expectedGraphRevision: graph.graphRevision,
        expectedProjectRevision: graph.projectRevision,
      });
      if (!next.compatible || next.allowedBindingTypes.length === 0) {
        setError(next.issues.join(" · ") || "연결 불가");
        return;
      }
      setPreview(next);
      setBindingType(next.allowedBindingTypes[0] as RelationshipBindingType);
    } catch (requestError) {
      setError(errorText(requestError));
      if (
        requestError instanceof RelationshipApiError &&
        requestError.status === 409
      ) {
        await load();
      }
    } finally {
      previewRequestRef.current = false;
      setBusy(false);
    }
  };

  const commit = async () => {
    if (!graph || !preview || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await dataRelationshipApi.create(projectId, {
        previewId: preview.previewId,
        bindingType,
        expectedGraphRevision: preview.graphRevision,
        expectedProjectRevision: preview.projectRevision,
        idempotencyKey: idempotencyKey("binding-create"),
      });
      revisionRef.current = Math.max(
        revisionRef.current,
        result.projectRevision,
      );
      callbackRef.current(revisionRef.current);
      setPreview(null);
      setSourcePort(null);
      setPointer(null);
      setSelectedBindingId(result.binding.id);
      await load();
    } catch (requestError) {
      setError(errorText(requestError));
      await load();
    } finally {
      setBusy(false);
    }
  };

  const deleteBinding = async () => {
    if (!graph || !selectedBinding || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await dataRelationshipApi.delete(selectedBinding.id, {
        expectedRevision: selectedBinding.revision,
        expectedGraphRevision: graph.graphRevision,
        expectedProjectRevision: graph.projectRevision,
        idempotencyKey: idempotencyKey("binding-delete"),
      });
      revisionRef.current = Math.max(
        revisionRef.current,
        result.projectRevision,
      );
      callbackRef.current(revisionRef.current);
      setDeleteOpen(false);
      setSelectedBindingId(null);
      await load();
    } catch (requestError) {
      setError(errorText(requestError));
      await load();
    } finally {
      setBusy(false);
    }
  };

  const mutateHistory = async (operation: "undo" | "redo") => {
    if (!graph || !history || busy) return;
    const command = operation === "undo" ? history.undo : history.redo;
    if (!command) return;
    setBusy(true);
    setError(null);
    try {
      const result = await dataRelationshipApi.historyMutation(
        projectId,
        operation,
        {
          expectedCommandId: command.id,
          expectedGraphRevision: graph.graphRevision,
          expectedProjectRevision: graph.projectRevision,
          idempotencyKey: idempotencyKey(`binding-${operation}`),
        },
      );
      revisionRef.current = Math.max(
        revisionRef.current,
        result.projectRevision,
      );
      callbackRef.current(revisionRef.current);
      await load();
    } catch (requestError) {
      setError(errorText(requestError));
      await load();
    } finally {
      setBusy(false);
    }
  };

  if (loading && graph === null) {
    return (
      <div className="relationship-loading" role="status">
        <LoaderCircle aria-hidden="true" />
        불러오는 중
      </div>
    );
  }

  if (graph === null) {
    return (
      <Alert variant="destructive">
        <Unplug aria-hidden="true" />
        <AlertTitle>연결 실패</AlertTitle>
        <AlertDescription>{error ?? "요청 실패"}</AlertDescription>
        <Button type="button" variant="outline" onClick={() => void load()}>
          재시도
        </Button>
      </Alert>
    );
  }

  return (
    <section className="relationship-workspace" aria-label="데이터 관계">
      <header className="relationship-toolbar">
        <div>
          <strong>관계</strong>
          <span>
            Node {graph.nodes.length} · Edge {graph.edges.length} · r
            {graph.graphRevision}
          </span>
        </div>
        <div className="relationship-toolbar-actions">
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => void load()}
          >
            <RefreshCw data-icon="inline-start" aria-hidden="true" />
            새로고침
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy || history?.undo === null}
            onClick={() => void mutateHistory("undo")}
          >
            <Undo2 data-icon="inline-start" aria-hidden="true" />
            실행 취소
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy || history?.redo === null}
            onClick={() => void mutateHistory("redo")}
          >
            <Redo2 data-icon="inline-start" aria-hidden="true" />
            다시 실행
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={!sourcePort || busy}
            onClick={() => {
              setSourcePort(null);
              setPointer(null);
            }}
          >
            <X data-icon="inline-start" aria-hidden="true" />
            연결 취소
          </Button>
        </div>
      </header>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>작업 실패</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {graph.nodes.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Node 없음</EmptyTitle>
            <EmptyDescription>Page, Element, Table 추가</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div
          className="relationship-viewport"
          onPointerMove={(event) => {
            if (!sourcePort) return;
            const rect = event.currentTarget.getBoundingClientRect();
            setPointer({
              x: event.clientX - rect.left + event.currentTarget.scrollLeft,
              y: event.clientY - rect.top + event.currentTarget.scrollTop,
            });
          }}
          onPointerLeave={() => setPointer(null)}
        >
          <div
            className="relationship-canvas"
            style={{ width: canvasSize.width, height: canvasSize.height }}
          >
            <svg
              className="relationship-edges"
              width={canvasSize.width}
              height={canvasSize.height}
              role="img"
              aria-label="Binding Edge"
            >
              <defs>
                <marker
                  id="relationship-arrow"
                  markerWidth="10"
                  markerHeight="10"
                  refX="9"
                  refY="3"
                  orient="auto"
                  markerUnits="strokeWidth"
                >
                  <path d="M0,0 L0,6 L9,3 z" />
                </marker>
              </defs>
              {graph.edges.map((binding) => {
                const sourceNode = nodesById.get(binding.source.nodeId);
                const targetNode = nodesById.get(binding.target.nodeId);
                const source = portsById.get(binding.source.portId);
                const target = portsById.get(binding.target.portId);
                if (!sourceNode || !targetNode || !source || !target)
                  return null;
                const sourcePoint = portPoint(sourceNode, source);
                const targetPoint = portPoint(targetNode, target);
                const selected = binding.id === selectedBindingId;
                return (
                  <g
                    key={binding.id}
                    className={`relationship-edge ${selected ? "is-selected" : ""}`}
                    data-binding-id={binding.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`${bindingLabels[binding.bindingType]} Binding`}
                    onClick={() => setSelectedBindingId(binding.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedBindingId(binding.id);
                      }
                    }}
                  >
                    <path
                      className="relationship-edge-hit"
                      d={edgePath(sourcePoint, targetPoint)}
                    />
                    <path
                      className="relationship-edge-line"
                      d={edgePath(sourcePoint, targetPoint)}
                      markerEnd="url(#relationship-arrow)"
                    />
                    <text
                      x={(sourcePoint.x + targetPoint.x) / 2}
                      y={(sourcePoint.y + targetPoint.y) / 2 - 6}
                    >
                      {bindingLabels[binding.bindingType]}
                    </text>
                  </g>
                );
              })}
              {sourcePort &&
                pointer &&
                (() => {
                  const node = nodesById.get(sourcePort.nodeId);
                  if (!node) return null;
                  return (
                    <path
                      className="relationship-edge-preview"
                      d={edgePath(portPoint(node, sourcePort), pointer)}
                      markerEnd="url(#relationship-arrow)"
                    />
                  );
                })()}
            </svg>
            {graph.nodes.map((node) => (
              <RelationshipNode
                key={node.id}
                node={node}
                sourcePort={sourcePort}
                onSource={beginSource}
                onTarget={(port) => void targetPort(port)}
              />
            ))}
          </div>
        </div>
      )}

      <aside className="relationship-selection" aria-label="선택 Binding">
        {selectedBinding ? (
          <>
            <div>
              <Badge variant="secondary">
                {bindingLabels[selectedBinding.bindingType]}
              </Badge>
              <strong>{selectedBinding.id.slice(0, 8)}</strong>
              <span>r{selectedBinding.revision}</span>
            </div>
            <span>
              {selectedBinding.source.portRole}{" "}
              <ArrowRight aria-hidden="true" />{" "}
              {selectedBinding.target.portRole}
            </span>
            <Button
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 data-icon="inline-start" aria-hidden="true" />
              삭제
            </Button>
          </>
        ) : (
          <span>Edge 선택</span>
        )}
      </aside>

      <Dialog
        open={preview !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setPreview(null);
        }}
      >
        <DialogContent showCloseButton={!busy}>
          <DialogHeader>
            <DialogTitle>연결</DialogTitle>
            <DialogDescription>
              {preview?.source.portRole} → {preview?.target.portRole}
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="relationship-binding-type">종류</FieldLabel>
              <NativeSelect
                id="relationship-binding-type"
                value={bindingType}
                disabled={busy}
                onChange={(event) =>
                  setBindingType(event.target.value as RelationshipBindingType)
                }
              >
                {preview?.allowedBindingTypes.map((type) => (
                  <NativeSelectOption key={type} value={type}>
                    {bindingLabels[type]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
          </FieldGroup>
          <DialogFooter className="relationship-dialog-actions">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => setPreview(null)}
            >
              취소
            </Button>
            <Button type="button" disabled={busy} onClick={() => void commit()}>
              {busy ? (
                <LoaderCircle data-icon="inline-start" aria-hidden="true" />
              ) : (
                <Link2 data-icon="inline-start" aria-hidden="true" />
              )}
              연결
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Binding 삭제</AlertDialogTitle>
            <AlertDialogDescription>
              Edge와 Binding 레코드를 함께 삭제합니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="relationship-dialog-actions">
            <AlertDialogCancel disabled={busy}>취소</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(event) => {
                event.preventDefault();
                void deleteBinding();
              }}
            >
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
