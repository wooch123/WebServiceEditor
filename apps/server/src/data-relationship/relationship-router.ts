import type {
  RelationshipBindingDto,
  RelationshipEdgeRouteDto,
  RelationshipNodeDto,
  RelationshipPortDto,
  RelationshipRoutePointDto,
} from "@webeditor/domain";

interface Rect {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

interface SearchState {
  readonly x: number;
  readonly y: number;
  readonly direction: number;
  readonly cost: number;
  readonly score: number;
  readonly previous: string | null;
}

const CLEARANCE = 12;
const SOURCE_STUB = 16;
const TARGET_STUB = 16;

function bendCount(points: readonly RelationshipRoutePointDto[]): number {
  let bends = 0;
  for (let index = 2; index < points.length; index += 1) {
    const first = points[index - 2] as RelationshipRoutePointDto;
    const middle = points[index - 1] as RelationshipRoutePointDto;
    const last = points[index] as RelationshipRoutePointDto;
    const firstVertical = first.x === middle.x;
    const secondVertical = middle.x === last.x;
    if (firstVertical !== secondVertical) bends += 1;
  }
  return bends;
}

function portPoint(
  node: RelationshipNodeDto,
  port: RelationshipPortDto,
): RelationshipRoutePointDto {
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

function expanded(node: RelationshipNodeDto): Rect {
  return {
    left: node.x - CLEARANCE,
    right: node.x + node.width + CLEARANCE,
    top: node.y - CLEARANCE,
    bottom: node.y + node.height + CLEARANCE,
  };
}

function interior(node: RelationshipNodeDto): Rect {
  return {
    left: node.x,
    right: node.x + node.width,
    top: node.y,
    bottom: node.y + node.height,
  };
}

function inside(point: RelationshipRoutePointDto, rect: Rect): boolean {
  return (
    point.x > rect.left &&
    point.x < rect.right &&
    point.y > rect.top &&
    point.y < rect.bottom
  );
}

function simplify(
  points: readonly RelationshipRoutePointDto[],
): readonly RelationshipRoutePointDto[] {
  const unique = points.filter(
    (point, index) =>
      index === 0 ||
      point.x !== points[index - 1]?.x ||
      point.y !== points[index - 1]?.y,
  );
  const result: RelationshipRoutePointDto[] = [];
  for (const point of unique) {
    const previous = result.at(-1);
    const beforePrevious = result.at(-2);
    if (
      previous !== undefined &&
      beforePrevious !== undefined &&
      ((beforePrevious.x === previous.x && previous.x === point.x) ||
        (beforePrevious.y === previous.y && previous.y === point.y))
    ) {
      result[result.length - 1] = point;
    } else {
      result.push(point);
    }
  }
  return result;
}

function stateKey(x: number, y: number, direction: number): string {
  return `${x},${y},${direction}`;
}

function routeGrid(
  start: RelationshipRoutePointDto,
  end: RelationshipRoutePointDto,
  obstacles: readonly Rect[],
  bounds: Rect,
): readonly RelationshipRoutePointDto[] {
  const xs = [
    bounds.left,
    bounds.right,
    start.x,
    end.x,
    ...obstacles.flatMap(({ left, right }) => [left, right]),
  ].filter((value, index, values) => values.indexOf(value) === index);
  const ys = [
    bounds.top,
    bounds.bottom,
    start.y,
    end.y,
    ...obstacles.flatMap(({ top, bottom }) => [top, bottom]),
  ].filter((value, index, values) => values.indexOf(value) === index);
  xs.sort((left, right) => left - right);
  ys.sort((left, right) => left - right);
  const startX = xs.indexOf(start.x);
  const startY = ys.indexOf(start.y);
  const endX = xs.indexOf(end.x);
  const endY = ys.indexOf(end.y);
  const width = xs.length - 1;
  const height = ys.length - 1;
  const point = (x: number, y: number): RelationshipRoutePointDto => ({
    x: xs[x] as number,
    y: ys[y] as number,
  });
  const blocked = (x: number, y: number): boolean => {
    if ((x === startX && y === startY) || (x === endX && y === endY)) {
      return false;
    }
    const current = point(x, y);
    return obstacles.some((rect) => inside(current, rect));
  };
  const directions = [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
  ] as const;
  const open: SearchState[] = [];
  const best = new Map<string, SearchState>();
  for (let direction = 0; direction < directions.length; direction += 1) {
    const initial: SearchState = {
      x: startX,
      y: startY,
      direction,
      cost: 0,
      score: Math.abs(endX - startX) + Math.abs(endY - startY),
      previous: null,
    };
    open.push(initial);
    best.set(stateKey(startX, startY, direction), initial);
  }
  let goal: SearchState | undefined;
  while (open.length > 0) {
    open.sort(
      (left, right) => left.score - right.score || left.cost - right.cost,
    );
    const current = open.shift() as SearchState;
    if (current.x === endX && current.y === endY) {
      goal = current;
      break;
    }
    for (let direction = 0; direction < directions.length; direction += 1) {
      const [dx, dy] = directions[direction] as (typeof directions)[number];
      const x = current.x + dx;
      const y = current.y + dy;
      if (x < 0 || y < 0 || x > width || y > height || blocked(x, y)) {
        continue;
      }
      const currentPoint = point(current.x, current.y);
      const nextPoint = point(x, y);
      if (
        obstacles.some((rect) =>
          segmentIntersectsRect(currentPoint, nextPoint, rect),
        )
      ) {
        continue;
      }
      const distance =
        Math.abs(nextPoint.x - currentPoint.x) +
        Math.abs(nextPoint.y - currentPoint.y);
      const cost =
        current.cost + distance + (direction === current.direction ? 0 : 96);
      const key = stateKey(x, y, direction);
      if ((best.get(key)?.cost ?? Number.POSITIVE_INFINITY) <= cost) continue;
      const next: SearchState = {
        x,
        y,
        direction,
        cost,
        score:
          cost + Math.abs(end.x - nextPoint.x) + Math.abs(end.y - nextPoint.y),
        previous: stateKey(current.x, current.y, current.direction),
      };
      best.set(key, next);
      open.push(next);
    }
  }
  if (goal === undefined) throw new Error("Orthogonal route was not found");
  const reversed: RelationshipRoutePointDto[] = [];
  let current: SearchState | undefined = goal;
  while (current !== undefined) {
    reversed.push(point(current.x, current.y));
    current =
      current.previous === null ? undefined : best.get(current.previous);
  }
  return reversed.reverse();
}

function segmentIntersectsRect(
  start: RelationshipRoutePointDto,
  end: RelationshipRoutePointDto,
  rect: Rect,
): boolean {
  if (start.x === end.x) {
    return (
      start.x > rect.left &&
      start.x < rect.right &&
      Math.max(start.y, end.y) > rect.top &&
      Math.min(start.y, end.y) < rect.bottom
    );
  }
  return (
    start.y > rect.top &&
    start.y < rect.bottom &&
    Math.max(start.x, end.x) > rect.left &&
    Math.min(start.x, end.x) < rect.right
  );
}

function routeCrossesNode(
  points: readonly RelationshipRoutePointDto[],
  obstacles: readonly Rect[],
): boolean {
  return points
    .slice(1)
    .some((point, index) =>
      obstacles.some((rect) =>
        segmentIntersectsRect(
          points[index] as RelationshipRoutePointDto,
          point,
          rect,
        ),
      ),
    );
}

export function routeRelationshipEdges(
  nodes: readonly RelationshipNodeDto[],
  bindings: readonly RelationshipBindingDto[],
): readonly RelationshipEdgeRouteDto[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node] as const));
  const portById = new Map(
    nodes.flatMap((node) => node.ports.map((port) => [port.id, port] as const)),
  );
  const globalBounds: Rect = {
    left: Math.min(...nodes.map(({ x }) => x), 0) - 96,
    right: Math.max(...nodes.map(({ x, width }) => x + width), 0) + 96,
    top: Math.min(...nodes.map(({ y }) => y), 0) - 96,
    bottom: Math.max(...nodes.map(({ y, height }) => y + height), 0) + 96,
  };
  return bindings.flatMap((binding): readonly RelationshipEdgeRouteDto[] => {
    const sourceNode = nodeById.get(binding.source.nodeId);
    const targetNode = nodeById.get(binding.target.nodeId);
    const sourcePort = portById.get(binding.source.portId);
    const targetPort = portById.get(binding.target.portId);
    if (!sourceNode || !targetNode || !sourcePort || !targetPort) return [];
    const source = portPoint(sourceNode, sourcePort);
    const target = portPoint(targetNode, targetPort);
    const sourceStub = { x: source.x + SOURCE_STUB, y: source.y };
    const targetStub = { x: target.x - TARGET_STUB, y: target.y };
    const obstacles = nodes.map(expanded);
    const grid = routeGrid(sourceStub, targetStub, obstacles, globalBounds);
    const points = simplify([source, sourceStub, ...grid, targetStub, target]);
    if (routeCrossesNode(points, nodes.map(interior))) {
      throw new Error(
        `Orthogonal route crosses a Node for Binding ${binding.id}`,
      );
    }
    return [
      {
        bindingId: binding.id,
        points,
        bendCount: bendCount(points),
        crossesNode: false,
      },
    ];
  });
}

function segments(route: RelationshipEdgeRouteDto) {
  return route.points.slice(1).map((point, index) => ({
    start: route.points[index] as RelationshipRoutePointDto,
    end: point,
  }));
}

function segmentsCross(
  left: ReturnType<typeof segments>[number],
  right: ReturnType<typeof segments>[number],
): boolean {
  const leftVertical = left.start.x === left.end.x;
  const rightVertical = right.start.x === right.end.x;
  if (leftVertical === rightVertical) return false;
  const vertical = leftVertical ? left : right;
  const horizontal = leftVertical ? right : left;
  return (
    vertical.start.x > Math.min(horizontal.start.x, horizontal.end.x) &&
    vertical.start.x < Math.max(horizontal.start.x, horizontal.end.x) &&
    horizontal.start.y > Math.min(vertical.start.y, vertical.end.y) &&
    horizontal.start.y < Math.max(vertical.start.y, vertical.end.y)
  );
}

export function relationshipEdgeCrossingCount(
  routes: readonly RelationshipEdgeRouteDto[],
): number {
  let crossings = 0;
  for (let leftIndex = 0; leftIndex < routes.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < routes.length;
      rightIndex += 1
    ) {
      const leftSegments = segments(
        routes[leftIndex] as RelationshipEdgeRouteDto,
      );
      const rightSegments = segments(
        routes[rightIndex] as RelationshipEdgeRouteDto,
      );
      if (
        leftSegments.some((left) =>
          rightSegments.some((right) => segmentsCross(left, right)),
        )
      ) {
        crossings += 1;
      }
    }
  }
  return crossings;
}
