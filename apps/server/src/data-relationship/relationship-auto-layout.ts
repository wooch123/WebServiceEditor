import type {
  RelationshipBindingDto,
  RelationshipEdgeRouteDto,
  RelationshipNodeDto,
  RelationshipNodePositionDto,
} from "@webeditor/domain";
import ElkModule from "elkjs";
import type { ELK, ElkNode } from "elkjs/lib/elk-api.js";

import {
  relationshipEdgeCrossingCount,
  routeRelationshipEdges,
} from "./relationship-router.js";

const ElkConstructor = ElkModule as unknown as new () => ELK;
const elk = new ElkConstructor();
const NODE_GAP = 48;
const LAYER_GAP = 112;
const COMPONENT_GAP = 120;
const LAYOUT_GRID = 24;
const LAYOUT_PADDING = 40;
const TARGET_ASPECT_RATIO = 16 / 9;
const SUBCOLUMN_GAP = 48;
const NODE_TYPE_ORDER = ["page", "element", "table"] as const;

function overlaps(
  left: Pick<RelationshipNodeDto, "x" | "y" | "width" | "height">,
  right: Pick<RelationshipNodeDto, "x" | "y" | "width" | "height">,
): boolean {
  return !(
    left.x + left.width + NODE_GAP <= right.x ||
    right.x + right.width + NODE_GAP <= left.x ||
    left.y + left.height + NODE_GAP <= right.y ||
    right.y + right.height + NODE_GAP <= left.y
  );
}

export function relationshipNodeOverlapCount(
  nodes: readonly RelationshipNodeDto[],
): number {
  let count = 0;
  for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < nodes.length;
      rightIndex += 1
    ) {
      if (
        overlaps(
          nodes[leftIndex] as RelationshipNodeDto,
          nodes[rightIndex] as RelationshipNodeDto,
        )
      ) {
        count += 1;
      }
    }
  }
  return count;
}

function elkGraph(
  nodes: readonly RelationshipNodeDto[],
  bindings: readonly RelationshipBindingDto[],
): ElkNode {
  return {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
      "elk.layered.spacing.nodeNodeBetweenLayers": String(LAYER_GAP),
      "elk.separateConnectedComponents": "true",
      "elk.spacing.componentComponent": "96",
      "elk.spacing.nodeNode": String(NODE_GAP),
    },
    children: nodes.map((node) => ({
      id: node.id,
      width: node.width,
      height: node.height,
      layoutOptions: {
        "elk.portConstraints": "FIXED_ORDER",
      },
      ports: node.ports.map((port, index) => ({
        id: port.id,
        width: 8,
        height: 8,
        layoutOptions: {
          "elk.port.index": String(index),
          "elk.port.side": port.direction === "input" ? "WEST" : "EAST",
        },
      })),
    })),
    edges: bindings.map((binding) => ({
      id: binding.id,
      sources: [binding.source.portId],
      targets: [binding.target.portId],
    })),
  };
}

interface RelationshipComponent {
  readonly key: string;
  readonly nodes: readonly RelationshipNodeDto[];
  readonly bindings: readonly RelationshipBindingDto[];
}

interface PositionedComponent extends RelationshipComponent {
  readonly width: number;
  readonly height: number;
}

function snap(value: number): number {
  return Math.round(value / LAYOUT_GRID) * LAYOUT_GRID;
}

function graphComponents(
  nodes: readonly RelationshipNodeDto[],
  bindings: readonly RelationshipBindingDto[],
): readonly RelationshipComponent[] {
  const byId = new Map(nodes.map((node) => [node.id, node] as const));
  const adjacency = new Map(nodes.map((node) => [node.id, new Set<string>()]));
  for (const binding of bindings) {
    adjacency.get(binding.source.nodeId)?.add(binding.target.nodeId);
    adjacency.get(binding.target.nodeId)?.add(binding.source.nodeId);
  }
  const remaining = new Set(nodes.map(({ id }) => id));
  const components: RelationshipComponent[] = [];
  while (remaining.size > 0) {
    const first = [...remaining].sort()[0] as string;
    const queue = [first];
    const componentIds = new Set<string>();
    remaining.delete(first);
    while (queue.length > 0) {
      const id = queue.shift() as string;
      componentIds.add(id);
      for (const neighbor of adjacency.get(id) ?? []) {
        if (!remaining.delete(neighbor)) continue;
        queue.push(neighbor);
      }
    }
    const componentNodes = [...componentIds]
      .map((id) => byId.get(id) as RelationshipNodeDto)
      .sort((left, right) => left.id.localeCompare(right.id));
    components.push({
      key: componentNodes[0]?.id ?? first,
      nodes: componentNodes,
      bindings: bindings
        .filter(
          ({ source, target }) =>
            componentIds.has(source.nodeId) && componentIds.has(target.nodeId),
        )
        .sort((left, right) => left.id.localeCompare(right.id)),
    });
  }
  return components.sort(
    (left, right) =>
      Number(right.nodes.some(({ pinned }) => pinned)) -
        Number(left.nodes.some(({ pinned }) => pinned)) ||
      right.nodes.length - left.nodes.length ||
      right.bindings.length - left.bindings.length ||
      left.key.localeCompare(right.key),
  );
}

export function alignComponentToRowsAndColumns(
  nodes: readonly RelationshipNodeDto[],
): readonly RelationshipNodeDto[] {
  if (nodes.length <= 1) {
    return nodes.map((node) => ({ ...node, x: 0, y: 0 }));
  }
  const ordered = [...nodes].sort(
    (left, right) =>
      left.x - right.x || left.y - right.y || left.id.localeCompare(right.id),
  );
  const layers: RelationshipNodeDto[][] = [];
  for (const node of ordered) {
    const layer = layers.at(-1);
    const anchor = layer?.[0];
    if (anchor === undefined || Math.abs(node.x - anchor.x) > NODE_GAP) {
      layers.push([node]);
    } else {
      (layers[layers.length - 1] as RelationshipNodeDto[]).push(node);
    }
  }
  const rowCount = Math.max(...layers.map((layer) => layer.length));
  const rowPitch = snap(
    Math.max(...nodes.map(({ height }) => height)) + NODE_GAP,
  );
  let columnX = 0;
  const result: RelationshipNodeDto[] = [];
  for (const layer of layers) {
    layer.sort(
      (left, right) => left.y - right.y || left.id.localeCompare(right.id),
    );
    const columnWidth = snap(Math.max(...layer.map(({ width }) => width)));
    const firstRow = Math.floor((rowCount - layer.length) / 2);
    layer.forEach((node, index) => {
      result.push({
        ...node,
        x: snap(columnX),
        y: snap((firstRow + index) * rowPitch),
      });
    });
    columnX = snap(columnX + columnWidth + LAYER_GAP);
  }
  return result.sort((left, right) => left.id.localeCompare(right.id));
}

function connectedNodeIds(
  nodeId: string,
  bindings: readonly RelationshipBindingDto[],
): readonly string[] {
  return bindings.flatMap((binding) => {
    if (binding.source.nodeId === nodeId) return [binding.target.nodeId];
    if (binding.target.nodeId === nodeId) return [binding.source.nodeId];
    return [];
  });
}

/**
 * Presents the relationship model as three stable, top-left-aligned columns:
 * Page | Element | DB. ELK/component placement remains the relationship-aware
 * seed; this pass turns that seed into the predictable editor hierarchy.
 */
export function alignGraphByNodeTypeColumns(
  nodes: readonly RelationshipNodeDto[],
  bindings: readonly RelationshipBindingDto[],
): readonly RelationshipNodeDto[] {
  const orderIndex = new Map<string, number>();
  const degree = new Map(
    nodes.map((node) => [node.id, connectedNodeIds(node.id, bindings).length]),
  );
  const columnNodes = new Map<
    RelationshipNodeDto["type"],
    RelationshipNodeDto[]
  >();
  for (const type of NODE_TYPE_ORDER) {
    const candidates = nodes.filter(
      (node) => node.type === type && !node.pinned,
    );
    const connectedOrder = (node: RelationshipNodeDto): number => {
      const indices = connectedNodeIds(node.id, bindings)
        .map((id) => orderIndex.get(id))
        .filter((value): value is number => value !== undefined);
      return indices.length === 0
        ? Number.POSITIVE_INFINITY
        : indices.reduce((total, value) => total + value, 0) / indices.length;
    };
    candidates.sort((left, right) => {
      const leftConnectedOrder = connectedOrder(left);
      const rightConnectedOrder = connectedOrder(right);
      return (
        leftConnectedOrder - rightConnectedOrder ||
        (degree.get(right.id) ?? 0) - (degree.get(left.id) ?? 0) ||
        left.y - right.y ||
        left.label.localeCompare(right.label) ||
        left.id.localeCompare(right.id)
      );
    });
    candidates.forEach((node, index) => orderIndex.set(node.id, index));
    columnNodes.set(type, candidates);
  }

  const rowPitch = snap(
    Math.max(...nodes.map(({ height }) => height), 0) + NODE_GAP,
  );
  const types = NODE_TYPE_ORDER.filter(
    (type) => (columnNodes.get(type)?.length ?? 0) > 0,
  );
  const widths = new Map(
    NODE_TYPE_ORDER.map((type) => [
      type,
      Math.max(
        ...nodes.filter((node) => node.type === type).map(({ width }) => width),
        0,
      ),
    ]),
  );
  const subcolumnPitches = new Map(
    NODE_TYPE_ORDER.map((type) => [
      type,
      snap((widths.get(type) ?? 0) + SUBCOLUMN_GAP),
    ]),
  );
  const maximumCount = Math.max(
    ...types.map((type) => columnNodes.get(type)?.length ?? 0),
    1,
  );
  const rowsPerSubcolumn = Array.from(
    { length: maximumCount },
    (_, index) => index + 1,
  )
    .map((rows) => {
      const width =
        types.reduce((total, type) => {
          const count = columnNodes.get(type)?.length ?? 0;
          const columns = Math.ceil(count / rows);
          const width = widths.get(type) ?? 0;
          const pitch = subcolumnPitches.get(type) ?? width;
          return total + (columns === 0 ? 0 : (columns - 1) * pitch + width);
        }, 0) +
        Math.max(0, types.length - 1) * LAYER_GAP;
      const height = Math.min(rows, maximumCount) * rowPitch;
      return {
        rows,
        score: Math.abs(
          Math.log(width / Math.max(1, height) / TARGET_ASPECT_RATIO),
        ),
      };
    })
    .sort(
      (left, right) => left.score - right.score || right.rows - left.rows,
    )[0]?.rows;
  const start = snap(LAYOUT_PADDING);
  let columnX = start;
  const aligned = new Map<string, RelationshipNodeDto>();
  for (const type of NODE_TYPE_ORDER) {
    const candidates = columnNodes.get(type) ?? [];
    candidates.forEach((node, index) => {
      aligned.set(node.id, {
        ...node,
        x: snap(
          columnX +
            Math.floor(index / (rowsPerSubcolumn ?? maximumCount)) *
              (subcolumnPitches.get(type) ?? 0),
        ),
        y: start + (index % (rowsPerSubcolumn ?? maximumCount)) * rowPitch,
      });
    });
    if (candidates.length === 0) continue;
    const columns = Math.ceil(
      candidates.length / (rowsPerSubcolumn ?? maximumCount),
    );
    const width = widths.get(type) ?? 0;
    const pitch = subcolumnPitches.get(type) ?? width;
    const zoneWidth = (columns - 1) * pitch + width;
    columnX = snap(columnX + zoneWidth + LAYER_GAP);
  }
  return nodes
    .map((node) => (node.pinned ? node : (aligned.get(node.id) ?? node)))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function normalizedComponent(
  component: RelationshipComponent,
  nodes: readonly RelationshipNodeDto[],
): PositionedComponent {
  const minX = Math.min(...nodes.map(({ x }) => x));
  const minY = Math.min(...nodes.map(({ y }) => y));
  const normalized = nodes.map((node) => ({
    ...node,
    x: node.x - minX,
    y: node.y - minY,
  }));
  return {
    ...component,
    nodes: normalized,
    width: Math.max(...normalized.map(({ x, width }) => x + width)),
    height: Math.max(...normalized.map(({ y, height }) => y + height)),
  };
}

interface ShelfPlacement {
  readonly component: PositionedComponent;
  readonly x: number;
  readonly y: number;
}

function shelfPlacement(
  components: readonly PositionedComponent[],
  targetWidth: number,
): {
  readonly placements: readonly ShelfPlacement[];
  readonly width: number;
  readonly height: number;
  readonly score: number;
} {
  const placements: ShelfPlacement[] = [];
  let cursorX = 0;
  let cursorY = 0;
  let rowHeight = 0;
  let width = 0;
  let occupiedArea = 0;
  for (const component of components) {
    if (cursorX > 0 && cursorX + component.width > targetWidth) {
      cursorX = 0;
      cursorY += rowHeight + COMPONENT_GAP;
      rowHeight = 0;
    }
    placements.push({ component, x: cursorX, y: cursorY });
    cursorX += component.width + COMPONENT_GAP;
    rowHeight = Math.max(rowHeight, component.height);
    width = Math.max(width, cursorX - COMPONENT_GAP);
    occupiedArea += component.width * component.height;
  }
  const height = cursorY + rowHeight;
  const aspect = width / Math.max(1, height);
  const unusedRatio = 1 - occupiedArea / Math.max(1, width * height);
  return {
    placements,
    width,
    height,
    score: Math.abs(Math.log(aspect / TARGET_ASPECT_RATIO)) * 4 + unusedRatio,
  };
}

function packComponents(
  components: readonly PositionedComponent[],
  startX = LAYOUT_PADDING,
  startY = LAYOUT_PADDING,
): readonly RelationshipNodeDto[] {
  if (components.length === 0) return [];
  const totalArea = components.reduce(
    (total, component) =>
      total +
      (component.width + COMPONENT_GAP) * (component.height + COMPONENT_GAP),
    0,
  );
  const largestWidth = Math.max(...components.map(({ width }) => width));
  const totalWidth = components.reduce(
    (total, component) => total + component.width + COMPONENT_GAP,
    -COMPONENT_GAP,
  );
  const idealWidth = Math.sqrt(totalArea * TARGET_ASPECT_RATIO);
  const candidateWidths = [
    largestWidth,
    idealWidth * 0.75,
    idealWidth,
    idealWidth * 1.25,
    idealWidth * 1.5,
    totalWidth,
  ].map((value) => Math.max(largestWidth, value));
  const best = candidateWidths
    .map((width) => shelfPlacement(components, width))
    .sort(
      (left, right) =>
        left.score - right.score ||
        left.width * left.height - right.width * right.height,
    )[0] as ReturnType<typeof shelfPlacement>;
  return best.placements.flatMap(({ component, x, y }) =>
    component.nodes.map((node) => ({
      ...node,
      x: snap(startX + x + node.x),
      y: snap(startY + y + node.y),
    })),
  );
}

function resolveUnpinnedOverlaps(
  nodes: readonly RelationshipNodeDto[],
): readonly RelationshipNodeDto[] {
  const result: RelationshipNodeDto[] = [];
  const ordered = [...nodes].sort(
    (left, right) =>
      Number(right.pinned) - Number(left.pinned) ||
      left.x - right.x ||
      left.y - right.y ||
      left.id.localeCompare(right.id),
  );
  for (const node of ordered) {
    let candidate = node;
    if (!candidate.pinned) {
      let guard = 0;
      while (result.some((other) => overlaps(candidate, other))) {
        candidate = { ...candidate, y: candidate.y + NODE_GAP };
        guard += 1;
        if (guard > 10_000) {
          throw new Error("Auto Layout could not resolve Node overlap");
        }
      }
    }
    result.push(candidate);
  }
  return result.sort((left, right) => left.id.localeCompare(right.id));
}

function routeCost(routes: readonly RelationshipEdgeRouteDto[]) {
  const crossings = relationshipEdgeCrossingCount(routes);
  const bends = routes.reduce((total, route) => total + route.bendCount, 0);
  const length = routes.reduce(
    (total, route) =>
      total +
      route.points.slice(1).reduce((routeTotal, point, index) => {
        const previous = route.points[index] as {
          readonly x: number;
          readonly y: number;
        };
        return (
          routeTotal +
          Math.abs(point.x - previous.x) +
          Math.abs(point.y - previous.y)
        );
      }, 0),
    0,
  );
  return [crossings, bends, length] as const;
}

function improves(
  candidate: ReturnType<typeof routeCost>,
  current: ReturnType<typeof routeCost>,
): boolean {
  return candidate.some(
    (value, index) =>
      value < (current[index] as number) &&
      candidate
        .slice(0, index)
        .every((prior, priorIndex) => Object.is(prior, current[priorIndex])),
  );
}

function minimizeLayerCrossings(
  nodes: readonly RelationshipNodeDto[],
  bindings: readonly RelationshipBindingDto[],
): {
  readonly nodes: readonly RelationshipNodeDto[];
  readonly routes: readonly RelationshipEdgeRouteDto[];
} {
  let current = [...nodes];
  let currentRoutes = routeRelationshipEdges(current, bindings);
  for (let pass = 0; pass < 4; pass += 1) {
    let changed = false;
    const movable = current
      .filter(({ pinned }) => !pinned)
      .sort((left, right) => left.x - right.x || left.y - right.y);
    const layers: RelationshipNodeDto[][] = [];
    for (const node of movable) {
      const layer = layers.at(-1);
      if (
        layer === undefined ||
        node.x - Math.max(...layer.map(({ x }) => x)) > 160
      ) {
        layers.push([node]);
      } else {
        layer.push(node);
      }
    }
    for (const layer of layers) {
      layer.sort(
        (left, right) => left.y - right.y || left.id.localeCompare(right.id),
      );
      for (let index = 1; index < layer.length; index += 1) {
        const upper = layer[index - 1] as RelationshipNodeDto;
        const lower = layer[index] as RelationshipNodeDto;
        const candidate = current.map((node) => {
          if (node.id === upper.id) return { ...node, y: lower.y };
          if (node.id === lower.id) return { ...node, y: upper.y };
          return node;
        });
        if (relationshipNodeOverlapCount(candidate) !== 0) continue;
        let routes: readonly RelationshipEdgeRouteDto[];
        try {
          routes = routeRelationshipEdges(candidate, bindings);
        } catch {
          continue;
        }
        if (!improves(routeCost(routes), routeCost(currentRoutes))) continue;
        current = candidate;
        currentRoutes = routes;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return { nodes: current, routes: currentRoutes };
}

export interface RelationshipAutoLayoutResult {
  readonly nodes: readonly RelationshipNodeDto[];
  readonly positions: readonly RelationshipNodePositionDto[];
  readonly routes: readonly RelationshipEdgeRouteDto[];
  readonly crossingCountBefore: number;
  readonly crossingCountAfter: number;
}

export async function layoutRelationshipGraph(
  nodes: readonly RelationshipNodeDto[],
  bindings: readonly RelationshipBindingDto[],
): Promise<RelationshipAutoLayoutResult> {
  const previousRoutes = routeRelationshipEdges(nodes, bindings);
  const components = graphComponents(nodes, bindings);
  const anchored: RelationshipNodeDto[] = [];
  const movable: PositionedComponent[] = [];
  for (const component of components) {
    const byId =
      component.nodes.length === 1 && component.bindings.length === 0
        ? new Map([
            [
              component.nodes[0]?.id as string,
              { id: component.nodes[0]?.id, x: 0, y: 0 },
            ],
          ])
        : new Map(
            (
              await elk.layout(elkGraph(component.nodes, component.bindings))
            ).children?.map((node) => [node.id, node]) ?? [],
          );
    const raw = component.nodes.map((node) => {
      const result = byId.get(node.id);
      return node.pinned
        ? node
        : {
            ...node,
            x: Math.round(result?.x ?? node.x),
            y: Math.round(result?.y ?? node.y),
          };
    });
    if (component.nodes.some(({ pinned }) => pinned)) {
      const resolved = resolveUnpinnedOverlaps(raw);
      const minimized = minimizeLayerCrossings(resolved, component.bindings);
      anchored.push(...minimized.nodes);
    } else {
      const aligned = alignComponentToRowsAndColumns(raw);
      const minimized = minimizeLayerCrossings(aligned, component.bindings);
      movable.push(normalizedComponent(component, minimized.nodes));
    }
  }
  const anchoredBottom = anchored.reduce(
    (bottom, node) => Math.max(bottom, node.y + node.height),
    0,
  );
  const packed = packComponents(
    movable,
    LAYOUT_PADDING,
    anchored.length === 0 ? LAYOUT_PADDING : anchoredBottom + COMPONENT_GAP,
  );
  const arranged = resolveUnpinnedOverlaps(
    alignGraphByNodeTypeColumns([...anchored, ...packed], bindings),
  );
  if (relationshipNodeOverlapCount(arranged) !== 0) {
    throw new Error("Auto Layout components overlap");
  }
  const minimized = minimizeLayerCrossings(arranged, bindings);
  return {
    nodes: minimized.nodes,
    positions: minimized.nodes.map((node) => ({
      nodeId: node.id,
      nodeType: node.type,
      objectId: node.objectId,
      x: node.x,
      y: node.y,
      pinned: node.pinned,
      revision: node.positionRevision,
    })),
    routes: minimized.routes,
    crossingCountBefore: relationshipEdgeCrossingCount(previousRoutes),
    crossingCountAfter: relationshipEdgeCrossingCount(minimized.routes),
  };
}
