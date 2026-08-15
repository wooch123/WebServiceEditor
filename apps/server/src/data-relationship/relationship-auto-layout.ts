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
      "elk.layered.spacing.nodeNodeBetweenLayers": "112",
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

function separateDisconnectedComponents(
  nodes: readonly RelationshipNodeDto[],
  bindings: readonly RelationshipBindingDto[],
): readonly RelationshipNodeDto[] {
  const byId = new Map(nodes.map((node) => [node.id, node] as const));
  const adjacency = new Map(nodes.map((node) => [node.id, new Set<string>()]));
  for (const binding of bindings) {
    adjacency.get(binding.source.nodeId)?.add(binding.target.nodeId);
    adjacency.get(binding.target.nodeId)?.add(binding.source.nodeId);
  }
  const remaining = new Set(nodes.map(({ id }) => id));
  const components: RelationshipNodeDto[][] = [];
  while (remaining.size > 0) {
    const first = [...remaining].sort()[0] as string;
    const queue = [first];
    const component: RelationshipNodeDto[] = [];
    remaining.delete(first);
    while (queue.length > 0) {
      const id = queue.shift() as string;
      const node = byId.get(id);
      if (node !== undefined) component.push(node);
      for (const neighbor of adjacency.get(id) ?? []) {
        if (!remaining.delete(neighbor)) continue;
        queue.push(neighbor);
      }
    }
    components.push(component);
  }
  if (components.length <= 1) return nodes;
  components.sort(
    (left, right) =>
      Number(right.some(({ pinned }) => pinned)) -
        Number(left.some(({ pinned }) => pinned)) ||
      (left.map(({ id }) => id).sort()[0] as string).localeCompare(
        right.map(({ id }) => id).sort()[0] as string,
      ),
  );
  const positioned: RelationshipNodeDto[] = [];
  let cursorY = Math.min(...nodes.map(({ y }) => y), 40);
  for (const component of components) {
    const top = Math.min(...component.map(({ y }) => y));
    const bottom = Math.max(...component.map(({ y, height }) => y + height));
    const fixed = component.some(({ pinned }) => pinned);
    const shiftY = fixed ? 0 : Math.max(0, cursorY - top);
    positioned.push(
      ...component.map((node) =>
        fixed ? node : { ...node, y: node.y + shiftY },
      ),
    );
    cursorY = Math.max(cursorY, bottom + shiftY + 96);
  }
  return positioned.sort((left, right) => left.id.localeCompare(right.id));
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
  const layout = await elk.layout(elkGraph(nodes, bindings));
  const byId = new Map(layout.children?.map((node) => [node.id, node]) ?? []);
  const laidOut = resolveUnpinnedOverlaps(
    nodes.map((node) => {
      const result = byId.get(node.id);
      return node.pinned
        ? node
        : {
            ...node,
            x: Math.round((result?.x ?? node.x) + 40),
            y: Math.round((result?.y ?? node.y) + 40),
          };
    }),
  );
  if (relationshipNodeOverlapCount(laidOut) !== 0) {
    throw new Error("Pinned Nodes overlap after Auto Layout");
  }
  const separated = separateDisconnectedComponents(laidOut, bindings);
  if (relationshipNodeOverlapCount(separated) !== 0) {
    throw new Error("Auto Layout components overlap");
  }
  const minimized = minimizeLayerCrossings(separated, bindings);
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
