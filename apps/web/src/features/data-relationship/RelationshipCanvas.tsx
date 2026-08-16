import type {
  BindingQueryPreviewDto,
  BindingRenderShape,
  ConfigureBindingMutationRequestDto,
  ConfigureBindingDependencyRequestDto,
  DataRelationshipGraphDto,
  DataSchemaDto,
  ReadAggregateFunction,
  ReadFilterOperator,
  ReadQueryMode,
  RelationshipAutoLayoutPreviewDto,
  RelationshipBindingDto,
  RelationshipBindingType,
  RelationshipConnectionPreviewDto,
  RelationshipEdgeRouteDto,
  RelationshipHistoryDto,
  RelationshipLayoutHistoryDto,
  RelationshipNodeDto,
  RelationshipNodePositionDto,
  RelationshipPortDto,
  RelationshipRoutePointDto,
  ProjectVariableDto,
  ProjectVariableScope,
  ProjectVariableTransport,
  ProjectVariableType,
} from "@webeditor/domain";
import {
  applyNodeChanges,
  Background,
  BaseEdge,
  ConnectionLineType,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeChange,
  type NodeProps,
  type Viewport,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  ArrowRight,
  Braces,
  Link2,
  LoaderCircle,
  Maximize2,
  Pin,
  PinOff,
  Redo2,
  RefreshCw,
  Route,
  Trash2,
  Undo2,
  Unplug,
  X,
} from "lucide-react";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

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
import { Input } from "@/components/ui/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { generateSampleData, getDataSchema } from "@/services/data-schema-api";
import { projectVariablesApi } from "@/services/project-variables-api";

interface RelationshipCanvasProps {
  readonly projectId: string;
  readonly projectRevision: number;
  readonly onProjectRevisionChange: (revision: number) => void;
}

interface RelationshipNodeData extends Record<string, unknown> {
  readonly value: RelationshipNodeDto;
  readonly sourcePortId: string | null;
  readonly busy: boolean;
  readonly onSource: (port: RelationshipPortDto) => void;
  readonly onTarget: (port: RelationshipPortDto) => void;
  readonly onPin: (nodeId: string) => void;
}

interface RelationshipEdgeData extends Record<string, unknown> {
  readonly binding: RelationshipBindingDto;
  readonly route: RelationshipEdgeRouteDto;
  readonly selected: boolean;
  readonly onSelect: (bindingId: string) => void;
}

type RelationshipFlowNode = Node<RelationshipNodeData, "relationship">;
type RelationshipFlowEdge = Edge<RelationshipEdgeData, "orthogonal">;

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

const renderShapeLabels: Record<BindingRenderShape, string> = {
  ROWS: "행",
  SCALAR: "값",
  SERIES: "계열",
  VALUES: "숫자",
  SCATTER: "좌표",
  BOXES: "분포",
  SUMMARY: "요약",
};

const queryModeLabels: Record<ReadQueryMode, string> = {
  LIST: "목록",
  SINGLE: "단일",
  AGGREGATE: "집계",
  CHART_SERIES: "차트",
};

const filterOperatorLabels: Record<ReadFilterOperator, string> = {
  EQ: "같음",
  NE: "다름",
  GT: "초과",
  GTE: "이상",
  LT: "미만",
  LTE: "이하",
  CONTAINS: "포함",
  STARTS_WITH: "시작",
  IS_NULL: "비어 있음",
  IS_NOT_NULL: "값 있음",
};

const writeBindingTypes = new Set<RelationshipBindingType>([
  "CREATE",
  "UPDATE",
  "DELETE",
]);
const dependencyBindingTypes = new Set<RelationshipBindingType>([
  "FILTER",
  "NAVIGATE",
]);

function variableTypeForField(type: string): ProjectVariableType {
  if (type === "INTEGER" || type === "REAL") return "number";
  if (type === "BOOLEAN") return "boolean";
  if (type === "DATE") return "date";
  if (type === "DATETIME") return "datetime";
  return "string";
}

function nodePageLabel(node: RelationshipNodeDto | undefined) {
  if (!node || node.type !== "element") return "";
  const separator = node.subtitle.lastIndexOf(" · ");
  return separator < 0 ? "" : node.subtitle.slice(separator + 3);
}

const aggregateLabels: Record<ReadAggregateFunction, string> = {
  COUNT: "개수",
  SUM: "합계",
  AVG: "평균",
  MIN: "최소",
  MAX: "최대",
  MEDIAN: "중앙값",
  STDDEV: "표준편차",
  VARIANCE: "분산",
};

function defaultRenderShape(
  target: Pick<RelationshipPortDto, "valueType">,
  node: RelationshipNodeDto | undefined,
): BindingRenderShape {
  if (target.valueType === "records") return "ROWS";
  if (target.valueType === "number") return "SCALAR";
  if (target.valueType === "chart-series") return "SERIES";
  if (target.valueType === "xy-points") return "SCATTER";
  if (target.valueType === "grouped-numbers") return "BOXES";
  if (node?.subtitle.startsWith("Summary Statistics")) return "SUMMARY";
  return "VALUES";
}

function allowedRenderShapes(target: Pick<RelationshipPortDto, "valueType">) {
  if (target.valueType === "numbers") {
    return ["VALUES", "SUMMARY"] as const;
  }
  return [defaultRenderShape(target, undefined)] as const;
}

function defaultQueryMode(shape: BindingRenderShape): ReadQueryMode {
  if (shape === "SCALAR") return "AGGREGATE";
  if (shape === "SERIES" || shape === "SCATTER") return "CHART_SERIES";
  return "LIST";
}

function filterScalar(
  field: RelationshipPortDto | undefined,
  value: string,
): string | number | boolean {
  if (field?.valueType === "number") return Number(value);
  if (field?.valueType === "boolean") return value === "true";
  return value;
}

function errorText(error: unknown): string {
  if (error instanceof RelationshipApiError) {
    if (error.code.includes("REVISION") || error.status === 409) {
      return "변경 충돌";
    }
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return "요청 실패";
}

function idempotencyKey(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
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

export function roundedOrthogonalPath(
  points: readonly RelationshipRoutePointDto[],
  radius = 8,
): string {
  const first = points[0];
  if (first === undefined) return "";
  if (points.length === 1) return `M ${first.x} ${first.y}`;
  let path = `M ${first.x} ${first.y}`;
  for (let index = 1; index < points.length - 1; index += 1) {
    const before = points[index - 1] as RelationshipRoutePointDto;
    const corner = points[index] as RelationshipRoutePointDto;
    const after = points[index + 1] as RelationshipRoutePointDto;
    const incoming = Math.min(
      radius,
      Math.abs(corner.x - before.x) + Math.abs(corner.y - before.y),
    );
    const outgoing = Math.min(
      radius,
      Math.abs(after.x - corner.x) + Math.abs(after.y - corner.y),
    );
    const enter = {
      x: corner.x + Math.sign(before.x - corner.x) * incoming,
      y: corner.y + Math.sign(before.y - corner.y) * incoming,
    };
    const leave = {
      x: corner.x + Math.sign(after.x - corner.x) * outgoing,
      y: corner.y + Math.sign(after.y - corner.y) * outgoing,
    };
    path += ` L ${enter.x} ${enter.y} Q ${corner.x} ${corner.y} ${leave.x} ${leave.y}`;
  }
  const last = points.at(-1) as RelationshipRoutePointDto;
  return `${path} L ${last.x} ${last.y}`;
}

function midpoint(points: readonly RelationshipRoutePointDto[]) {
  if (points.length === 0) return { x: 0, y: 0 };
  const index = Math.floor((points.length - 1) / 2);
  const left = points[index] as RelationshipRoutePointDto;
  const right = (points[index + 1] ?? left) as RelationshipRoutePointDto;
  return { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 };
}

function RelationshipFlowNodeView({ data }: NodeProps<RelationshipFlowNode>) {
  const node = data.value;
  const inputs = node.ports.filter(({ direction }) => direction === "input");
  const outputs = node.ports.filter(({ direction }) => direction === "output");
  return (
    <Card
      size="sm"
      className={`relationship-node relationship-node-${node.type}`}
      style={{ width: node.width, minHeight: node.height }}
      data-node-id={node.id}
      data-node-type={node.type}
      data-pinned={node.pinned}
    >
      <CardHeader>
        <span className="relationship-node-icon">
          <DynamicLucideIcon iconName={node.iconName} />
        </span>
        <CardTitle>{node.label}</CardTitle>
        <CardDescription>{node.subtitle}</CardDescription>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                className="nodrag nopan relationship-pin"
                disabled={data.busy}
                aria-label={node.pinned ? "고정 해제" : "고정"}
                aria-pressed={node.pinned}
                onClick={() => data.onPin(node.id)}
              >
                {node.pinned ? (
                  <PinOff aria-hidden="true" />
                ) : (
                  <Pin aria-hidden="true" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {node.pinned ? "고정 해제" : "고정"}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </CardHeader>
      <CardContent className="relationship-port-content">
        <TooltipProvider>
          <div className="relationship-port-column is-input">
            {inputs.map((port, index) => {
              const source = node.ports.find(
                ({ id }) => id === data.sourcePortId,
              );
              const compatible = source ? portCompatible(source, port) : false;
              return (
                <Fragment key={port.id}>
                  <Handle
                    id={port.id}
                    type="target"
                    position={Position.Left}
                    className="relationship-flow-handle is-input"
                    style={{ top: 12 + index * 30 }}
                    isConnectable
                  />
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className={`relationship-port nodrag nopan is-input ${compatible ? "is-compatible" : ""}`}
                        data-port-id={port.id}
                        data-direction="input"
                        data-side="left"
                        aria-label={`${port.label} 입력`}
                        onPointerUp={() => data.onTarget(port)}
                        onClick={() => data.onTarget(port)}
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
                </Fragment>
              );
            })}
          </div>
          <div className="relationship-port-column is-output">
            {outputs.map((port, index) => (
              <Fragment key={port.id}>
                <Handle
                  id={port.id}
                  type="source"
                  position={Position.Right}
                  className="relationship-flow-handle is-output"
                  style={{ top: 12 + index * 30 }}
                  isConnectable
                />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className={`relationship-port nodrag nopan is-output ${data.sourcePortId === port.id ? "is-active" : ""}`}
                      data-port-id={port.id}
                      data-direction="output"
                      data-side="right"
                      aria-label={`${port.label} 출력`}
                      aria-pressed={data.sourcePortId === port.id}
                      onPointerDown={() => data.onSource(port)}
                      onClick={() => data.onSource(port)}
                    >
                      <span>{port.label}</span>
                      <span
                        className="relationship-port-marker"
                        aria-hidden="true"
                      />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    출력 · {port.valueType} ·{" "}
                    {port.allowedBindingTypes.join("/")}
                  </TooltipContent>
                </Tooltip>
              </Fragment>
            ))}
          </div>
        </TooltipProvider>
      </CardContent>
    </Card>
  );
}

function OrthogonalRelationshipEdge({
  data,
  markerEnd,
}: EdgeProps<RelationshipFlowEdge>) {
  if (data === undefined) return null;
  const path = roundedOrthogonalPath(data.route.points);
  const label = midpoint(data.route.points);
  return (
    <g
      className={`relationship-edge-visual ${data.selected ? "is-selected" : ""}`}
      data-binding-id={data.binding.id}
      data-bend-count={data.route.bendCount}
      role="button"
      tabIndex={0}
      aria-label={`${bindingLabels[data.binding.bindingType]} Binding`}
      onClick={() => data.onSelect(data.binding.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          data.onSelect(data.binding.id);
        }
      }}
    >
      <BaseEdge
        path={path}
        {...(markerEnd === undefined ? {} : { markerEnd })}
        interactionWidth={16}
        className="relationship-edge-line"
      />
      <EdgeLabelRenderer>
        <span
          className="relationship-edge-label nodrag nopan"
          style={{
            transform: `translate(-50%, -50%) translate(${label.x}px, ${label.y - 10}px)`,
          }}
        >
          {bindingLabels[data.binding.bindingType]}
        </span>
      </EdgeLabelRenderer>
    </g>
  );
}

const nodeTypes = { relationship: RelationshipFlowNodeView };
const edgeTypes = { orthogonal: OrthogonalRelationshipEdge };

function positionDto(node: RelationshipFlowNode): RelationshipNodePositionDto {
  return {
    nodeId: node.id,
    nodeType: node.data.value.type,
    objectId: node.data.value.objectId,
    x: node.position.x,
    y: node.position.y,
    pinned: node.data.value.pinned,
    revision: node.data.value.positionRevision,
  };
}

function AutoLayoutPreview({
  preview,
  nodes,
}: {
  readonly preview: RelationshipAutoLayoutPreviewDto;
  readonly nodes: readonly RelationshipNodeDto[];
}) {
  const byId = new Map(nodes.map((node) => [node.id, node] as const));
  const minX = Math.min(...preview.positions.map(({ x }) => x), 0);
  const minY = Math.min(...preview.positions.map(({ y }) => y), 0);
  const maxX = Math.max(
    ...preview.positions.map(
      ({ nodeId, x }) => x + (byId.get(nodeId)?.width ?? 200),
    ),
    1,
  );
  const maxY = Math.max(
    ...preview.positions.map(
      ({ nodeId, y }) => y + (byId.get(nodeId)?.height ?? 128),
    ),
    1,
  );
  const scale = Math.min(
    1,
    620 / Math.max(1, maxX - minX),
    300 / Math.max(1, maxY - minY),
  );
  return (
    <div
      className="relationship-auto-preview"
      style={{ height: Math.max(180, (maxY - minY) * scale + 32) }}
      aria-label="자동 배치 미리보기"
    >
      {preview.positions.map((position) => {
        const node = byId.get(position.nodeId);
        if (!node) return null;
        return (
          <div
            key={position.nodeId}
            className="relationship-auto-preview-node"
            data-node-id={position.nodeId}
            data-x={position.x}
            data-y={position.y}
            style={{
              left: (position.x - minX) * scale + 16,
              top: (position.y - minY) * scale + 16,
              width: Math.max(76, node.width * scale),
              height: Math.max(38, node.height * scale),
            }}
          >
            <span>{node.label}</span>
            {position.pinned && <Pin aria-label="고정" />}
          </div>
        );
      })}
    </div>
  );
}

function RelationshipCanvasInner({
  projectId,
  projectRevision,
  onProjectRevisionChange,
}: RelationshipCanvasProps) {
  const [graph, setGraph] = useState<DataRelationshipGraphDto | null>(null);
  const [history, setHistory] = useState<RelationshipHistoryDto | null>(null);
  const [layoutHistory, setLayoutHistory] =
    useState<RelationshipLayoutHistoryDto | null>(null);
  const [flowNodes, setFlowNodes] = useState<RelationshipFlowNode[]>([]);
  const [sourcePort, setSourcePort] = useState<RelationshipPortDto | null>(
    null,
  );
  const [preview, setPreview] =
    useState<RelationshipConnectionPreviewDto | null>(null);
  const [queryPreview, setQueryPreview] =
    useState<BindingQueryPreviewDto | null>(null);
  const [queryMode, setQueryMode] = useState<ReadQueryMode>("LIST");
  const [renderShape, setRenderShape] = useState<BindingRenderShape>("ROWS");
  const [labelFieldId, setLabelFieldId] = useState("");
  const [valueFieldId, setValueFieldId] = useState("");
  const [filterFieldId, setFilterFieldId] = useState("");
  const [filterOperator, setFilterOperator] =
    useState<ReadFilterOperator>("EQ");
  const [filterValue, setFilterValue] = useState("");
  const [sortFieldId, setSortFieldId] = useState("");
  const [sortDirection, setSortDirection] = useState<"ASC" | "DESC">("ASC");
  const [aggregateFunction, setAggregateFunction] =
    useState<ReadAggregateFunction>("COUNT");
  const [queryLimit, setQueryLimit] = useState(100);
  const [autoPreview, setAutoPreview] =
    useState<RelationshipAutoLayoutPreviewDto | null>(null);
  const [bindingType, setBindingType] =
    useState<RelationshipBindingType>("READ");
  const [dataSchema, setDataSchema] = useState<DataSchemaDto | null>(null);
  const [writeFieldMappings, setWriteFieldMappings] = useState<
    Readonly<Record<string, string>>
  >({});
  const [variables, setVariables] = useState<readonly ProjectVariableDto[]>([]);
  const [variableDialogOpen, setVariableDialogOpen] = useState(false);
  const [variableKey, setVariableKey] = useState("selected_value");
  const [variableName, setVariableName] = useState("선택값");
  const [variableType, setVariableType] =
    useState<ProjectVariableType>("number");
  const [variableScope, setVariableScope] =
    useState<ProjectVariableScope>("session");
  const [variableTransport, setVariableTransport] =
    useState<ProjectVariableTransport>("URL_QUERY");
  const [dependencyVariableId, setDependencyVariableId] = useState("");
  const [dependencySourceFieldId, setDependencySourceFieldId] = useState("");
  const [dependencyTargetReadBindingId, setDependencyTargetReadBindingId] =
    useState("");
  const [dependencyTargetFieldId, setDependencyTargetFieldId] = useState("");
  const [selectedBindingId, setSelectedBindingId] = useState<string | null>(
    null,
  );
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 1 });
  const revisionRef = useRef(projectRevision);
  const callbackRef = useRef(onProjectRevisionChange);
  const graphRef = useRef(graph);
  const flowNodesRef = useRef(flowNodes);
  const routeFrameRef = useRef<number | null>(null);
  const routeSequenceRef = useRef(0);
  const { fitView } = useReactFlow<
    RelationshipFlowNode,
    RelationshipFlowEdge
  >();

  useEffect(() => {
    revisionRef.current = Math.max(revisionRef.current, projectRevision);
  }, [projectRevision]);
  useEffect(() => {
    callbackRef.current = onProjectRevisionChange;
  }, [onProjectRevisionChange]);
  useEffect(() => {
    graphRef.current = graph;
  }, [graph]);
  useEffect(() => {
    flowNodesRef.current = flowNodes;
  }, [flowNodes]);

  const publishRevision = useCallback((next: number) => {
    revisionRef.current = Math.max(revisionRef.current, next);
    callbackRef.current(revisionRef.current);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextGraph, nextHistory, nextLayoutHistory, nextVariables] =
        await Promise.all([
          dataRelationshipApi.graph(projectId),
          dataRelationshipApi.history(projectId),
          dataRelationshipApi.layoutHistory(projectId),
          projectVariablesApi.list(projectId).catch(() => null),
        ]);
      setGraph(nextGraph);
      setHistory(nextHistory);
      setLayoutHistory(nextLayoutHistory);
      setVariables(nextVariables?.variables ?? []);
      setViewport(nextGraph.viewport);
      publishRevision(nextGraph.projectRevision);
      setSelectedBindingId((current) =>
        nextGraph.edges.some(({ id }) => id === current) ? current : null,
      );
    } catch (requestError) {
      setError(errorText(requestError));
    } finally {
      setLoading(false);
    }
  }, [projectId, publishRevision]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setSourcePort(null);
      setPreview(null);
      setQueryPreview(null);
      setAutoPreview(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const beginSource = useCallback((port: RelationshipPortDto) => {
    setSourcePort(port);
    setPreview(null);
    setError(null);
  }, []);

  const targetPort = useCallback(
    async (target: RelationshipPortDto, forcedSource?: RelationshipPortDto) => {
      const current = graphRef.current;
      const source = forcedSource ?? sourcePort;
      if (!current || !source || busy) return;
      setBusy(true);
      setError(null);
      try {
        const next = await dataRelationshipApi.preview(projectId, {
          sourcePortId: source.id,
          targetPortId: target.id,
          expectedGraphRevision: current.graphRevision,
          expectedProjectRevision: current.projectRevision,
        });
        if (!next.compatible || next.allowedBindingTypes.length === 0) {
          setError(next.issues.join(" · ") || "연결 불가");
          return;
        }
        setPreview(next);
        const nextBindingType = next
          .allowedBindingTypes[0] as RelationshipBindingType;
        setDependencyVariableId("");
        setDependencySourceFieldId("");
        setDependencyTargetReadBindingId("");
        setDependencyTargetFieldId("");
        setBindingType(nextBindingType);
        setQueryPreview(null);
        if (nextBindingType === "READ") {
          const targetNode = current.nodes.find(
            ({ id }) => id === next.target.nodeId,
          );
          const fields =
            current.nodes
              .find(({ id }) => id === next.source.nodeId)
              ?.ports.filter(({ direction }) => direction === "output") ?? [];
          const numericFields = fields.filter(
            ({ valueType }) => valueType === "number",
          );
          const shape = defaultRenderShape(next.target, targetNode);
          setRenderShape(shape);
          setQueryMode(defaultQueryMode(shape));
          setLabelFieldId((fields[0] ?? next.source).objectId);
          setValueFieldId(
            (numericFields[0] ?? fields[0] ?? next.source).objectId,
          );
          setFilterFieldId("");
          setFilterValue("");
          setSortFieldId("");
          setAggregateFunction("COUNT");
          setQueryLimit(100);
        }
      } catch (requestError) {
        setError(errorText(requestError));
        if (
          requestError instanceof RelationshipApiError &&
          requestError.status === 409
        ) {
          await load();
        }
      } finally {
        setBusy(false);
      }
    },
    [busy, load, projectId, sourcePort],
  );

  const saveNode = useCallback(
    async (node: RelationshipFlowNode, pinned = node.data.value.pinned) => {
      const current = graphRef.current;
      if (!current || busy) return;
      setBusy(true);
      setError(null);
      try {
        const result = await dataRelationshipApi.moveNode(projectId, node.id, {
          x: node.position.x,
          y: node.position.y,
          pinned,
          expectedPositionRevision: node.data.value.positionRevision,
          expectedGraphRevision: current.graphRevision,
          expectedProjectRevision: current.projectRevision,
          idempotencyKey: idempotencyKey("relationship-node"),
        });
        publishRevision(result.projectRevision);
        await load();
      } catch (requestError) {
        setError(errorText(requestError));
        await load();
      } finally {
        setBusy(false);
      }
    },
    [busy, load, projectId, publishRevision],
  );

  const togglePin = useCallback(
    (nodeId: string) => {
      const node = flowNodesRef.current.find(({ id }) => id === nodeId);
      if (node) void saveNode(node, !node.data.value.pinned);
    },
    [saveNode],
  );

  useEffect(() => {
    if (!graph) {
      setFlowNodes([]);
      return;
    }
    setFlowNodes(
      graph.nodes.map((node) => ({
        id: node.id,
        type: "relationship",
        position: { x: node.x, y: node.y },
        data: {
          value: node,
          sourcePortId: sourcePort?.id ?? null,
          busy,
          onSource: beginSource,
          onTarget: (port) => void targetPort(port),
          onPin: togglePin,
        },
        draggable: !busy,
        selectable: true,
        width: node.width,
        height: node.height,
      })),
    );
  }, [beginSource, busy, graph, sourcePort, targetPort, togglePin]);

  const scheduleRoutes = useCallback(() => {
    if (routeFrameRef.current !== null) {
      cancelAnimationFrame(routeFrameRef.current);
    }
    routeFrameRef.current = requestAnimationFrame(() => {
      routeFrameRef.current = null;
      const current = graphRef.current;
      if (!current) return;
      const sequence = ++routeSequenceRef.current;
      const positions = flowNodesRef.current.map(positionDto);
      void dataRelationshipApi
        .routePreview(projectId, {
          positions,
          expectedGraphRevision: current.graphRevision,
          expectedProjectRevision: current.projectRevision,
        })
        .then((result) => {
          if (sequence !== routeSequenceRef.current) return;
          setGraph((value) =>
            value === null || value.graphRevision !== result.graphRevision
              ? value
              : { ...value, routes: result.routes },
          );
        })
        .catch(() => undefined);
    });
  }, [projectId]);

  useEffect(
    () => () => {
      if (routeFrameRef.current !== null) {
        cancelAnimationFrame(routeFrameRef.current);
      }
    },
    [],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<RelationshipFlowNode>[]) => {
      setFlowNodes((nodes) => applyNodeChanges(changes, nodes));
    },
    [],
  );

  const flowEdges = useMemo<RelationshipFlowEdge[]>(() => {
    if (!graph) return [];
    const routeByBinding = new Map(
      graph.routes.map((route) => [route.bindingId, route]),
    );
    return graph.edges.flatMap((binding): RelationshipFlowEdge[] => {
      const route = routeByBinding.get(binding.id);
      if (!route) return [];
      return [
        {
          id: binding.id,
          source: binding.source.nodeId,
          target: binding.target.nodeId,
          sourceHandle: binding.source.portId,
          targetHandle: binding.target.portId,
          type: "orthogonal",
          markerEnd: { type: MarkerType.ArrowClosed, color: "var(--edge)" },
          data: {
            binding,
            route,
            selected: selectedBindingId === binding.id,
            onSelect: setSelectedBindingId,
          },
          selectable: false,
          focusable: false,
        },
      ];
    });
  }, [graph, selectedBindingId]);

  const selectedBinding =
    graph?.edges.find(({ id }) => id === selectedBindingId) ?? null;

  const sourceFields = useMemo(() => {
    if (!graph || !preview) return [];
    return (
      graph.nodes
        .find(({ id }) => id === preview.source.nodeId)
        ?.ports.filter(({ direction }) => direction === "output") ?? []
    );
  }, [graph, preview]);

  const numericSourceFields = useMemo(
    () => sourceFields.filter(({ valueType }) => valueType === "number"),
    [sourceFields],
  );

  useEffect(() => {
    setQueryPreview(null);
  }, [
    aggregateFunction,
    filterFieldId,
    filterOperator,
    filterValue,
    labelFieldId,
    queryLimit,
    queryMode,
    renderShape,
    sortDirection,
    sortFieldId,
    valueFieldId,
  ]);

  const mutationTable = useMemo(
    () =>
      dataSchema?.tables.find(
        (table) => table.id === preview?.target.objectId,
      ) ?? null,
    [dataSchema, preview],
  );

  const mutationInputs = useMemo(() => {
    if (!graph || !preview) return [];
    const sourceNode = graph.nodes.find(
      (node) => node.id === preview.source.nodeId,
    );
    const pageLabel = nodePageLabel(sourceNode);
    return graph.nodes.filter(
      (node) =>
        node.type === "element" &&
        node.subtitle.startsWith("Number Input ·") &&
        nodePageLabel(node) === pageLabel,
    );
  }, [graph, preview]);

  const mutationFields = useMemo(() => {
    if (!mutationTable || !writeBindingTypes.has(bindingType)) return [];
    const numeric = mutationTable.fields.filter(
      (field) => field.type === "INTEGER" || field.type === "REAL",
    );
    if (bindingType === "DELETE") {
      return numeric.filter((field) => field.primaryKey);
    }
    return numeric.filter(
      (field) => bindingType !== "CREATE" || !field.autoIncrement,
    );
  }, [bindingType, mutationTable]);

  useEffect(() => {
    if (
      !preview ||
      (!writeBindingTypes.has(bindingType) &&
        !dependencyBindingTypes.has(bindingType))
    ) {
      setWriteFieldMappings({});
      return;
    }
    let cancelled = false;
    void getDataSchema(projectId)
      .then((schema) => {
        if (!cancelled) setDataSchema(schema);
      })
      .catch((requestError) => {
        if (!cancelled) setError(errorText(requestError));
      });
    return () => {
      cancelled = true;
    };
  }, [bindingType, preview, projectId]);

  const sourceSelectionRead = useMemo(() => {
    if (!graph || !preview || !dependencyBindingTypes.has(bindingType)) {
      return null;
    }
    return (
      graph.edges.find(
        (binding) =>
          binding.bindingType === "READ" &&
          binding.status === "READY" &&
          binding.target.objectId === preview.source.objectId,
      ) ?? null
    );
  }, [bindingType, graph, preview]);

  const dependencySourceFields = useMemo(() => {
    if (!dataSchema || !sourceSelectionRead) return [];
    const tableId =
      typeof sourceSelectionRead.query.tableId === "string"
        ? sourceSelectionRead.query.tableId
        : "";
    const spec = sourceSelectionRead.query.spec as
      Readonly<Record<string, unknown>> | undefined;
    const selected =
      spec !== undefined && Array.isArray(spec.selectFieldIds)
        ? new Set(spec.selectFieldIds)
        : new Set<unknown>();
    return (
      dataSchema.tables
        .find((table) => table.id === tableId)
        ?.fields.filter((field) => selected.has(field.id)) ?? []
    );
  }, [dataSchema, sourceSelectionRead]);

  const dependencyTargetReads = useMemo(() => {
    if (!graph || !preview || bindingType !== "FILTER") return [];
    return graph.edges.filter(
      (binding) =>
        binding.bindingType === "READ" &&
        binding.status === "READY" &&
        binding.target.objectId === preview.target.objectId,
    );
  }, [bindingType, graph, preview]);

  const dependencyTargetFields = useMemo(() => {
    if (!dataSchema) return [];
    const targetRead = dependencyTargetReads.find(
      ({ id }) => id === dependencyTargetReadBindingId,
    );
    const tableId =
      typeof targetRead?.query.tableId === "string"
        ? targetRead.query.tableId
        : "";
    return (
      dataSchema.tables.find((table) => table.id === tableId)?.fields ?? []
    );
  }, [dataSchema, dependencyTargetReadBindingId, dependencyTargetReads]);

  useEffect(() => {
    if (!preview || !dependencyBindingTypes.has(bindingType)) return;
    const sourceField = dependencySourceFields[0];
    const matchingVariable = variables.find(
      (variable) =>
        sourceField !== undefined &&
        variable.valueType === variableTypeForField(sourceField.type),
    );
    setDependencyVariableId((current) => current || matchingVariable?.id || "");
    setDependencySourceFieldId((current) => current || sourceField?.id || "");
    const targetRead = dependencyTargetReads[0];
    setDependencyTargetReadBindingId(
      (current) => current || targetRead?.id || "",
    );
  }, [
    bindingType,
    dependencySourceFields,
    dependencyTargetReads,
    preview,
    variables,
  ]);

  useEffect(() => {
    const selectedVariable = variables.find(
      ({ id }) => id === dependencyVariableId,
    );
    const matching = dependencyTargetFields.find(
      (field) =>
        selectedVariable !== undefined &&
        variableTypeForField(field.type) === selectedVariable.valueType,
    );
    setDependencyTargetFieldId((current) => current || matching?.id || "");
  }, [dependencyTargetFields, dependencyVariableId, variables]);

  const dependencyConfiguration = useMemo(() => {
    if (!preview || !dependencyBindingTypes.has(bindingType)) return null;
    const variable = variables.find(({ id }) => id === dependencyVariableId);
    const sourceField = dependencySourceFields.find(
      ({ id }) => id === dependencySourceFieldId,
    );
    if (
      !variable ||
      !sourceField ||
      variable.valueType !== variableTypeForField(sourceField.type)
    ) {
      return null;
    }
    if (bindingType === "NAVIGATE") {
      return {
        kind: "NAVIGATE",
        variableId: variable.id,
        sourceFieldId: sourceField.id,
        targetPageId: preview.target.objectId,
        transport: variable.transport,
      } satisfies ConfigureBindingDependencyRequestDto;
    }
    const targetRead = dependencyTargetReads.find(
      ({ id }) => id === dependencyTargetReadBindingId,
    );
    const targetField = dependencyTargetFields.find(
      ({ id }) => id === dependencyTargetFieldId,
    );
    if (
      !targetRead ||
      !targetField ||
      variable.valueType !== variableTypeForField(targetField.type)
    ) {
      return null;
    }
    return {
      kind: "FILTER",
      variableId: variable.id,
      sourceFieldId: sourceField.id,
      targetReadBindingId: targetRead.id,
      targetFieldId: targetField.id,
      operator: "EQ",
    } satisfies ConfigureBindingDependencyRequestDto;
  }, [
    bindingType,
    dependencySourceFieldId,
    dependencySourceFields,
    dependencyTargetFieldId,
    dependencyTargetFields,
    dependencyTargetReadBindingId,
    dependencyTargetReads,
    dependencyVariableId,
    preview,
    variables,
  ]);

  useEffect(() => {
    if (!writeBindingTypes.has(bindingType) || mutationFields.length === 0) {
      setWriteFieldMappings({});
      return;
    }
    setWriteFieldMappings(
      Object.fromEntries(
        mutationFields.map((field, index) => [
          field.id,
          mutationInputs[index]?.objectId ?? "",
        ]),
      ),
    );
  }, [bindingType, mutationFields, mutationInputs]);

  const mutationConfiguration = useMemo(() => {
    if (!writeBindingTypes.has(bindingType) || !mutationTable) return null;
    const fieldMappings = mutationFields.flatMap((field) => {
      const inputElementId = writeFieldMappings[field.id];
      return inputElementId ? [{ fieldId: field.id, inputElementId }] : [];
    });
    const primary = mutationTable.fields.find((field) => field.primaryKey);
    const mapped = new Set(fieldMappings.map(({ fieldId }) => fieldId));
    const valid =
      primary !== undefined &&
      new Set(fieldMappings.map(({ inputElementId }) => inputElementId))
        .size === fieldMappings.length &&
      (bindingType !== "CREATE" ||
        mutationTable.fields
          .filter(
            (field) =>
              !field.nullable &&
              field.defaultValue === null &&
              !field.autoIncrement,
          )
          .every((field) => mapped.has(field.id))) &&
      (bindingType !== "UPDATE" ||
        (mapped.has(primary.id) &&
          fieldMappings.some(({ fieldId }) => fieldId !== primary.id))) &&
      (bindingType !== "DELETE" ||
        (fieldMappings.length === 1 && mapped.has(primary.id)));
    return valid
      ? ({ fieldMappings } satisfies ConfigureBindingMutationRequestDto)
      : null;
  }, [bindingType, mutationFields, mutationTable, writeFieldMappings]);

  const previewReadQuery = async () => {
    if (!graph || !preview || bindingType !== "READ" || busy) return;
    const nullary =
      filterOperator === "IS_NULL" || filterOperator === "IS_NOT_NULL";
    setBusy(true);
    setError(null);
    try {
      setQueryPreview(
        await dataRelationshipApi.previewQuery(projectId, {
          connectionPreviewId: preview.previewId,
          spec: {
            mode: queryMode,
            selectFieldIds: sourceFields.map(({ objectId }) => objectId),
            filters:
              filterFieldId === "" || (!nullary && filterValue === "")
                ? []
                : [
                    {
                      fieldId: filterFieldId,
                      operator: filterOperator,
                      ...(nullary
                        ? {}
                        : {
                            value: filterScalar(
                              sourceFields.find(
                                ({ objectId }) => objectId === filterFieldId,
                              ),
                              filterValue,
                            ),
                          }),
                    },
                  ],
            orderBy:
              sortFieldId === ""
                ? []
                : [{ fieldId: sortFieldId, direction: sortDirection }],
            aggregate:
              queryMode === "AGGREGATE"
                ? {
                    function: aggregateFunction,
                    fieldId: valueFieldId || null,
                  }
                : null,
            groupByFieldId: null,
            limit: queryLimit,
          },
          mapping: {
            shape: renderShape,
            labelFieldId: renderShape === "ROWS" ? null : labelFieldId || null,
            valueFieldId: renderShape === "ROWS" ? null : valueFieldId || null,
            secondaryFieldId: null,
          },
          expectedGraphRevision: preview.graphRevision,
          expectedProjectRevision: preview.projectRevision,
        }),
      );
    } catch (requestError) {
      setError(errorText(requestError));
    } finally {
      setBusy(false);
    }
  };

  const generateSamples = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await generateSampleData(projectId);
      setQueryPreview(null);
    } catch (requestError) {
      setError(errorText(requestError));
    } finally {
      setBusy(false);
    }
  };

  const createVariable = async () => {
    if (
      !graph ||
      busy ||
      variableKey.trim() === "" ||
      variableName.trim() === ""
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await projectVariablesApi.create(projectId, {
        key: variableKey.trim(),
        name: variableName.trim(),
        valueType: variableType,
        scope: variableScope,
        transport: variableTransport,
        sensitive: false,
        defaultValue: null,
        expectedProjectRevision: graph.projectRevision,
        idempotencyKey: idempotencyKey("variable-create"),
      });
      publishRevision(result.projectRevision);
      setDependencyVariableId(result.variable.id);
      setVariableDialogOpen(false);
      await load();
    } catch (requestError) {
      setError(errorText(requestError));
      await load();
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    if (
      !graph ||
      !preview ||
      busy ||
      (bindingType === "READ" && queryPreview === null)
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await dataRelationshipApi.create(projectId, {
        previewId: preview.previewId,
        bindingType,
        ...(bindingType === "READ" && queryPreview
          ? { queryPreviewId: queryPreview.queryPreviewId }
          : {}),
        ...(writeBindingTypes.has(bindingType) && mutationConfiguration
          ? { mutation: mutationConfiguration }
          : {}),
        ...(dependencyBindingTypes.has(bindingType) && dependencyConfiguration
          ? { dependency: dependencyConfiguration }
          : {}),
        expectedGraphRevision: preview.graphRevision,
        expectedProjectRevision: preview.projectRevision,
        idempotencyKey: idempotencyKey("binding-create"),
      });
      publishRevision(result.projectRevision);
      setPreview(null);
      setQueryPreview(null);
      setSourcePort(null);
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
      publishRevision(result.projectRevision);
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

  const mutateBindingHistory = async (operation: "undo" | "redo") => {
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
      publishRevision(result.projectRevision);
      await load();
    } catch (requestError) {
      setError(errorText(requestError));
      await load();
    } finally {
      setBusy(false);
    }
  };

  const previewAutoLayout = async () => {
    if (!graph || busy) return;
    setBusy(true);
    setError(null);
    try {
      setAutoPreview(
        await dataRelationshipApi.previewAutoLayout(projectId, {
          action: "PREVIEW",
          expectedGraphRevision: graph.graphRevision,
          expectedProjectRevision: graph.projectRevision,
        }),
      );
    } catch (requestError) {
      setError(errorText(requestError));
    } finally {
      setBusy(false);
    }
  };

  const applyAutoLayout = async () => {
    if (!autoPreview || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await dataRelationshipApi.applyAutoLayout(projectId, {
        action: "APPLY",
        previewId: autoPreview.previewId,
        expectedGraphRevision: autoPreview.graphRevision,
        expectedProjectRevision: autoPreview.projectRevision,
        idempotencyKey: idempotencyKey("auto-layout"),
      });
      publishRevision(result.projectRevision);
      setAutoPreview(null);
      await load();
      requestAnimationFrame(
        () => void fitView({ padding: 0.16, duration: 240 }),
      );
    } catch (requestError) {
      setError(errorText(requestError));
      await load();
    } finally {
      setBusy(false);
    }
  };

  const mutateLayoutHistory = async (operation: "undo" | "redo") => {
    if (!graph || !layoutHistory || busy) return;
    const command =
      operation === "undo" ? layoutHistory.undo : layoutHistory.redo;
    if (!command) return;
    setBusy(true);
    setError(null);
    try {
      const result = await dataRelationshipApi.layoutHistoryMutation(
        projectId,
        operation,
        {
          expectedCommandId: command.id,
          expectedGraphRevision: graph.graphRevision,
          expectedProjectRevision: graph.projectRevision,
          idempotencyKey: idempotencyKey(`relationship-layout-${operation}`),
        },
      );
      publishRevision(result.projectRevision);
      await load();
    } catch (requestError) {
      setError(errorText(requestError));
      await load();
    } finally {
      setBusy(false);
    }
  };

  const saveViewport = useCallback(
    async (next: Viewport) => {
      const current = graphRef.current;
      if (!current) return;
      try {
        const saved = await dataRelationshipApi.updateViewport(projectId, {
          x: next.x,
          y: next.y,
          zoom: next.zoom,
          expectedRevision: current.viewport.revision,
        });
        setGraph((value) =>
          value === null ? value : { ...value, viewport: saved },
        );
      } catch (requestError) {
        if (
          requestError instanceof RelationshipApiError &&
          requestError.status === 409
        ) {
          await load();
        }
      }
    },
    [load, projectId],
  );

  const connect = useCallback(
    (connection: Connection) => {
      if (!graph || !connection.sourceHandle || !connection.targetHandle) {
        return;
      }
      const ports = new Map(
        graph.nodes.flatMap((node) =>
          node.ports.map((port) => [port.id, port] as const),
        ),
      );
      const source = ports.get(connection.sourceHandle);
      const target = ports.get(connection.targetHandle);
      if (source) beginSource(source);
      if (source && target) void targetPort(target, source);
    },
    [beginSource, graph, targetPort],
  );

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
            onClick={() => setVariableDialogOpen(true)}
          >
            <Braces data-icon="inline-start" aria-hidden="true" />
            변수
          </Button>
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
            onClick={() => void mutateBindingHistory("undo")}
          >
            <Undo2 data-icon="inline-start" aria-hidden="true" />
            연결 취소
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy || history?.redo === null}
            onClick={() => void mutateBindingHistory("redo")}
          >
            <Redo2 data-icon="inline-start" aria-hidden="true" />
            연결 다시
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={!sourcePort || busy}
            onClick={() => setSourcePort(null)}
          >
            <X data-icon="inline-start" aria-hidden="true" />
            선택 취소
          </Button>
        </div>
      </header>

      <div
        className="relationship-layout-actions"
        role="group"
        aria-label="위치 도구"
      >
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => void previewAutoLayout()}
        >
          <Route data-icon="inline-start" aria-hidden="true" />
          자동 배치
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy || layoutHistory?.undo === null}
          onClick={() => void mutateLayoutHistory("undo")}
        >
          <Undo2 data-icon="inline-start" aria-hidden="true" />
          위치 취소
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy || layoutHistory?.redo === null}
          onClick={() => void mutateLayoutHistory("redo")}
        >
          <Redo2 data-icon="inline-start" aria-hidden="true" />
          위치 다시
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => void fitView({ padding: 0.16, duration: 240 })}
        >
          <Maximize2 data-icon="inline-start" aria-hidden="true" />
          맞춤
        </Button>
      </div>

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
        <div className="relationship-viewport">
          <ReactFlow<RelationshipFlowNode, RelationshipFlowEdge>
            nodes={flowNodes}
            edges={flowEdges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            viewport={viewport}
            onViewportChange={setViewport}
            onMoveEnd={(_event, next) => void saveViewport(next)}
            onNodesChange={onNodesChange}
            onNodeDrag={() => scheduleRoutes()}
            onNodeDragStop={(_event, node) => void saveNode(node)}
            onConnect={connect}
            connectionLineType={ConnectionLineType.Straight}
            minZoom={0.25}
            maxZoom={2}
            nodesDraggable={!busy}
            nodesConnectable={!busy}
            panOnDrag={!busy}
            deleteKeyCode={null}
            proOptions={{ hideAttribution: true }}
            aria-label="관계 그래프"
          >
            <Background color="var(--canvas-grid)" gap={24} />
            <Controls showInteractive={false} />
          </ReactFlow>
          <div className="relationship-edge-accessibility">
            {graph.edges.map((binding) => (
              <button
                key={binding.id}
                type="button"
                className="relationship-edge"
                data-binding-id={binding.id}
                aria-label={`${bindingLabels[binding.bindingType]} Binding`}
                onClick={() => setSelectedBindingId(binding.id)}
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
              {selectedBinding.source.portRole}
              <ArrowRight aria-hidden="true" />
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
          if (!open && !busy) {
            setPreview(null);
            setQueryPreview(null);
          }
        }}
      >
        <DialogContent
          className="relationship-binding-dialog"
          showCloseButton={!busy}
        >
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
                onChange={(event) => {
                  setBindingType(event.target.value as RelationshipBindingType);
                  setQueryPreview(null);
                  setDependencyVariableId("");
                  setDependencySourceFieldId("");
                  setDependencyTargetReadBindingId("");
                  setDependencyTargetFieldId("");
                }}
              >
                {preview?.allowedBindingTypes.map((type) => (
                  <NativeSelectOption key={type} value={type}>
                    {bindingLabels[type]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
          </FieldGroup>
          {preview && bindingType === "READ" && (
            <>
              <FieldGroup className="binding-query-fields">
                <Field>
                  <FieldLabel htmlFor="binding-query-mode">방식</FieldLabel>
                  <NativeSelect
                    id="binding-query-mode"
                    value={queryMode}
                    disabled={busy}
                    onChange={(event) =>
                      setQueryMode(event.target.value as ReadQueryMode)
                    }
                  >
                    {(
                      ["LIST", "SINGLE", "AGGREGATE", "CHART_SERIES"] as const
                    ).map((mode) => (
                      <NativeSelectOption key={mode} value={mode}>
                        {queryModeLabels[mode]}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>
                <Field>
                  <FieldLabel htmlFor="binding-render-shape">출력</FieldLabel>
                  <NativeSelect
                    id="binding-render-shape"
                    value={renderShape}
                    disabled={busy}
                    onChange={(event) => {
                      const shape = event.target.value as BindingRenderShape;
                      setRenderShape(shape);
                      setQueryMode(defaultQueryMode(shape));
                    }}
                  >
                    {allowedRenderShapes(preview.target).map((shape) => (
                      <NativeSelectOption key={shape} value={shape}>
                        {renderShapeLabels[shape]}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>
                {renderShape !== "ROWS" && (
                  <>
                    <Field>
                      <FieldLabel htmlFor="binding-value-field">값</FieldLabel>
                      <NativeSelect
                        id="binding-value-field"
                        value={valueFieldId}
                        disabled={busy}
                        onChange={(event) =>
                          setValueFieldId(event.target.value)
                        }
                      >
                        {numericSourceFields.map((field) => (
                          <NativeSelectOption
                            key={field.objectId}
                            value={field.objectId}
                          >
                            {field.label}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="binding-label-field">
                        기준
                      </FieldLabel>
                      <NativeSelect
                        id="binding-label-field"
                        value={labelFieldId}
                        disabled={busy}
                        onChange={(event) =>
                          setLabelFieldId(event.target.value)
                        }
                      >
                        {sourceFields.map((field) => (
                          <NativeSelectOption
                            key={field.objectId}
                            value={field.objectId}
                          >
                            {field.label}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    </Field>
                  </>
                )}
                {queryMode === "AGGREGATE" && (
                  <Field>
                    <FieldLabel htmlFor="binding-aggregate">집계</FieldLabel>
                    <NativeSelect
                      id="binding-aggregate"
                      value={aggregateFunction}
                      disabled={busy}
                      onChange={(event) =>
                        setAggregateFunction(
                          event.target.value as ReadAggregateFunction,
                        )
                      }
                    >
                      {Object.entries(aggregateLabels).map(([value, label]) => (
                        <NativeSelectOption key={value} value={value}>
                          {label}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </Field>
                )}
                <Field>
                  <FieldLabel htmlFor="binding-filter-field">필터</FieldLabel>
                  <NativeSelect
                    id="binding-filter-field"
                    value={filterFieldId}
                    disabled={busy}
                    onChange={(event) => setFilterFieldId(event.target.value)}
                  >
                    <NativeSelectOption value="">없음</NativeSelectOption>
                    {sourceFields.map((field) => (
                      <NativeSelectOption
                        key={field.objectId}
                        value={field.objectId}
                      >
                        {field.label}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>
                {filterFieldId !== "" && (
                  <>
                    <Field>
                      <FieldLabel htmlFor="binding-filter-operator">
                        조건
                      </FieldLabel>
                      <NativeSelect
                        id="binding-filter-operator"
                        value={filterOperator}
                        disabled={busy}
                        onChange={(event) =>
                          setFilterOperator(
                            event.target.value as ReadFilterOperator,
                          )
                        }
                      >
                        {Object.entries(filterOperatorLabels).map(
                          ([value, label]) => (
                            <NativeSelectOption key={value} value={value}>
                              {label}
                            </NativeSelectOption>
                          ),
                        )}
                      </NativeSelect>
                    </Field>
                    {!["IS_NULL", "IS_NOT_NULL"].includes(filterOperator) && (
                      <Field>
                        <FieldLabel htmlFor="binding-filter-value">
                          조건값
                        </FieldLabel>
                        <Input
                          id="binding-filter-value"
                          value={filterValue}
                          disabled={busy}
                          onChange={(event) =>
                            setFilterValue(event.target.value)
                          }
                        />
                      </Field>
                    )}
                  </>
                )}
                <Field>
                  <FieldLabel htmlFor="binding-sort-field">정렬</FieldLabel>
                  <NativeSelect
                    id="binding-sort-field"
                    value={sortFieldId}
                    disabled={busy}
                    onChange={(event) => setSortFieldId(event.target.value)}
                  >
                    <NativeSelectOption value="">없음</NativeSelectOption>
                    {sourceFields.map((field) => (
                      <NativeSelectOption
                        key={field.objectId}
                        value={field.objectId}
                      >
                        {field.label}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>
                {sortFieldId !== "" && (
                  <Field>
                    <FieldLabel htmlFor="binding-sort-direction">
                      순서
                    </FieldLabel>
                    <NativeSelect
                      id="binding-sort-direction"
                      value={sortDirection}
                      disabled={busy}
                      onChange={(event) =>
                        setSortDirection(event.target.value as "ASC" | "DESC")
                      }
                    >
                      <NativeSelectOption value="ASC">
                        오름차순
                      </NativeSelectOption>
                      <NativeSelectOption value="DESC">
                        내림차순
                      </NativeSelectOption>
                    </NativeSelect>
                  </Field>
                )}
                <Field>
                  <FieldLabel htmlFor="binding-query-limit">행</FieldLabel>
                  <Input
                    id="binding-query-limit"
                    type="number"
                    min={1}
                    max={500}
                    value={queryLimit}
                    disabled={busy}
                    onChange={(event) =>
                      setQueryLimit(
                        Math.min(
                          500,
                          Math.max(1, Number(event.target.value) || 1),
                        ),
                      )
                    }
                  />
                </Field>
              </FieldGroup>
              <div
                className="binding-query-actions"
                role="group"
                aria-label="조회 도구"
              >
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void generateSamples()}
                >
                  샘플
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy || sourceFields.length === 0}
                  onClick={() => void previewReadQuery()}
                >
                  미리보기
                </Button>
              </div>
              {queryPreview && (
                <section
                  className="binding-query-preview"
                  aria-label="조회 결과"
                  data-plan-checksum={queryPreview.planChecksum}
                >
                  <header>
                    <strong>{queryPreview.result.rowCount}행</strong>
                    <Badge variant="secondary">
                      {queryPreview.result.renderState}
                    </Badge>
                  </header>
                  {queryPreview.result.rows.length > 0 ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          {queryPreview.result.columns.map((column) => (
                            <TableHead key={column.fieldId}>
                              {column.label}
                            </TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {queryPreview.result.rows
                          .slice(0, 5)
                          .map((row, index) => (
                            <TableRow key={index}>
                              {queryPreview.result.columns.map((column) => (
                                <TableCell key={column.fieldId}>
                                  {String(row[column.fieldId] ?? "")}
                                </TableCell>
                              ))}
                            </TableRow>
                          ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <span>결과 없음</span>
                  )}
                </section>
              )}
            </>
          )}
          {preview && writeBindingTypes.has(bindingType) && (
            <FieldGroup className="binding-mutation-fields">
              {mutationFields.map((field) => (
                <Field
                  key={field.id}
                  data-invalid={!writeFieldMappings[field.id] || undefined}
                >
                  <FieldLabel htmlFor={`binding-mutation-${field.id}`}>
                    {field.displayName}
                    {field.primaryKey ? " · 키" : ""}
                  </FieldLabel>
                  <NativeSelect
                    id={`binding-mutation-${field.id}`}
                    value={writeFieldMappings[field.id] ?? ""}
                    disabled={busy}
                    aria-invalid={
                      !writeFieldMappings[field.id] ? true : undefined
                    }
                    onChange={(event) =>
                      setWriteFieldMappings((current) => ({
                        ...current,
                        [field.id]: event.target.value,
                      }))
                    }
                  >
                    <NativeSelectOption value="">입력 선택</NativeSelectOption>
                    {mutationInputs.map((input) => (
                      <NativeSelectOption
                        key={input.objectId}
                        value={input.objectId}
                      >
                        {input.label}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>
              ))}
              {mutationFields.length === 0 && (
                <p role="alert">숫자 필드 없음</p>
              )}
              {mutationInputs.length === 0 && (
                <p role="alert">숫자 입력 없음</p>
              )}
            </FieldGroup>
          )}
          {preview && dependencyBindingTypes.has(bindingType) && (
            <FieldGroup className="binding-dependency-fields">
              <Field data-invalid={!dependencyVariableId || undefined}>
                <FieldLabel htmlFor="binding-dependency-variable">
                  변수
                </FieldLabel>
                <NativeSelect
                  id="binding-dependency-variable"
                  value={dependencyVariableId}
                  disabled={busy}
                  onChange={(event) => {
                    setDependencyVariableId(event.target.value);
                    setDependencyTargetFieldId("");
                  }}
                >
                  <NativeSelectOption value="">변수 선택</NativeSelectOption>
                  {variables.map((variable) => (
                    <NativeSelectOption key={variable.id} value={variable.id}>
                      {variable.name} · {variable.valueType}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
              <Field data-invalid={!dependencySourceFieldId || undefined}>
                <FieldLabel htmlFor="binding-dependency-source-field">
                  선택 필드
                </FieldLabel>
                <NativeSelect
                  id="binding-dependency-source-field"
                  value={dependencySourceFieldId}
                  disabled={busy}
                  onChange={(event) =>
                    setDependencySourceFieldId(event.target.value)
                  }
                >
                  <NativeSelectOption value="">필드 선택</NativeSelectOption>
                  {dependencySourceFields.map((field) => (
                    <NativeSelectOption key={field.id} value={field.id}>
                      {field.displayName}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
              {bindingType === "FILTER" ? (
                <>
                  <Field
                    data-invalid={!dependencyTargetReadBindingId || undefined}
                  >
                    <FieldLabel htmlFor="binding-dependency-target-read">
                      대상 조회
                    </FieldLabel>
                    <NativeSelect
                      id="binding-dependency-target-read"
                      value={dependencyTargetReadBindingId}
                      disabled={busy}
                      onChange={(event) => {
                        setDependencyTargetReadBindingId(event.target.value);
                        setDependencyTargetFieldId("");
                      }}
                    >
                      <NativeSelectOption value="">
                        조회 선택
                      </NativeSelectOption>
                      {dependencyTargetReads.map((binding) => (
                        <NativeSelectOption key={binding.id} value={binding.id}>
                          {binding.id.slice(0, 8)}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </Field>
                  <Field data-invalid={!dependencyTargetFieldId || undefined}>
                    <FieldLabel htmlFor="binding-dependency-target-field">
                      필터 필드
                    </FieldLabel>
                    <NativeSelect
                      id="binding-dependency-target-field"
                      value={dependencyTargetFieldId}
                      disabled={busy}
                      onChange={(event) =>
                        setDependencyTargetFieldId(event.target.value)
                      }
                    >
                      <NativeSelectOption value="">
                        필드 선택
                      </NativeSelectOption>
                      {dependencyTargetFields.map((field) => (
                        <NativeSelectOption key={field.id} value={field.id}>
                          {field.displayName}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </Field>
                </>
              ) : (
                <Field>
                  <FieldLabel>대상 Page</FieldLabel>
                  <Input
                    readOnly
                    value={
                      graph.nodes.find(
                        (node) => node.objectId === preview.target.objectId,
                      )?.label ?? preview.target.objectId
                    }
                  />
                </Field>
              )}
              {variables.length === 0 && (
                <p role="alert">변수를 먼저 추가하세요.</p>
              )}
            </FieldGroup>
          )}
          <DialogFooter className="relationship-dialog-actions">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setPreview(null);
                setQueryPreview(null);
              }}
            >
              취소
            </Button>
            <Button
              type="button"
              disabled={
                busy ||
                (bindingType === "READ" && queryPreview === null) ||
                (writeBindingTypes.has(bindingType) &&
                  mutationConfiguration === null) ||
                (dependencyBindingTypes.has(bindingType) &&
                  dependencyConfiguration === null)
              }
              onClick={() => void commit()}
            >
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

      <Dialog
        open={variableDialogOpen}
        onOpenChange={(open) => {
          if (!busy) setVariableDialogOpen(open);
        }}
      >
        <DialogContent showCloseButton={!busy}>
          <DialogHeader>
            <DialogTitle>변수</DialogTitle>
            <DialogDescription>선택값 전달</DialogDescription>
          </DialogHeader>
          {variables.length > 0 && (
            <div className="relationship-variable-list" aria-label="변수 목록">
              {variables.map((variable) => (
                <div key={variable.id}>
                  <strong>{variable.name}</strong>
                  <span>
                    {variable.key} · {variable.valueType} · {variable.transport}
                  </span>
                </div>
              ))}
            </div>
          )}
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="project-variable-name">이름</FieldLabel>
              <Input
                id="project-variable-name"
                value={variableName}
                disabled={busy}
                onChange={(event) => setVariableName(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="project-variable-key">키</FieldLabel>
              <Input
                id="project-variable-key"
                value={variableKey}
                disabled={busy}
                onChange={(event) => setVariableKey(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="project-variable-type">형식</FieldLabel>
              <NativeSelect
                id="project-variable-type"
                value={variableType}
                disabled={busy}
                onChange={(event) =>
                  setVariableType(event.target.value as ProjectVariableType)
                }
              >
                {(
                  ["string", "number", "boolean", "date", "datetime"] as const
                ).map((value) => (
                  <NativeSelectOption key={value} value={value}>
                    {value}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor="project-variable-scope">범위</FieldLabel>
              <NativeSelect
                id="project-variable-scope"
                value={variableScope}
                disabled={busy}
                onChange={(event) =>
                  setVariableScope(event.target.value as ProjectVariableScope)
                }
              >
                <NativeSelectOption value="project">project</NativeSelectOption>
                <NativeSelectOption value="session">session</NativeSelectOption>
                <NativeSelectOption value="page">page</NativeSelectOption>
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor="project-variable-transport">전달</FieldLabel>
              <NativeSelect
                id="project-variable-transport"
                value={variableTransport}
                disabled={busy}
                onChange={(event) =>
                  setVariableTransport(
                    event.target.value as ProjectVariableTransport,
                  )
                }
              >
                <NativeSelectOption value="URL_QUERY">URL</NativeSelectOption>
                <NativeSelectOption value="SESSION_STATE">
                  세션
                </NativeSelectOption>
              </NativeSelect>
            </Field>
          </FieldGroup>
          <DialogFooter className="relationship-dialog-actions">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => setVariableDialogOpen(false)}
            >
              취소
            </Button>
            <Button
              type="button"
              disabled={
                busy || variableName.trim() === "" || variableKey.trim() === ""
              }
              onClick={() => void createVariable()}
            >
              추가
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={autoPreview !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setAutoPreview(null);
        }}
      >
        <DialogContent
          className="relationship-auto-dialog"
          showCloseButton={!busy}
        >
          <DialogHeader>
            <DialogTitle>자동 배치</DialogTitle>
            <DialogDescription>
              교차 {autoPreview?.crossingCountBefore ?? 0} →{" "}
              {autoPreview?.crossingCountAfter ?? 0}
            </DialogDescription>
          </DialogHeader>
          {autoPreview && (
            <AutoLayoutPreview preview={autoPreview} nodes={graph.nodes} />
          )}
          <DialogFooter className="relationship-dialog-actions">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => setAutoPreview(null)}
            >
              취소
            </Button>
            <Button
              type="button"
              disabled={busy}
              onClick={() => void applyAutoLayout()}
            >
              {busy ? (
                <LoaderCircle data-icon="inline-start" aria-hidden="true" />
              ) : (
                <Route data-icon="inline-start" aria-hidden="true" />
              )}
              적용
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Binding 삭제</AlertDialogTitle>
            <AlertDialogDescription>
              Edge와 Binding을 삭제합니다.
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

export function RelationshipCanvas(props: RelationshipCanvasProps) {
  return (
    <ReactFlowProvider>
      <RelationshipCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
