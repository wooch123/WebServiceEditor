import type {
  RelationshipBindingDto,
  RelationshipNodeDto,
  RelationshipPortDto,
} from "@webeditor/domain";
import { describe, expect, it } from "vitest";

import {
  alignComponentToRowsAndColumns,
  alignGraphByNodeTypeColumns,
  layoutRelationshipGraph,
  relationshipNodeOverlapCount,
} from "../../src/data-relationship/relationship-auto-layout.js";
import { routeRelationshipEdges } from "../../src/data-relationship/relationship-router.js";

function node(
  id: string,
  x: number,
  y: number,
  direction: "input" | "output",
): RelationshipNodeDto {
  const objectId = id.slice(id.indexOf(":") + 1);
  const port: RelationshipPortDto = {
    id: `${objectId}:value:${direction}:0`,
    nodeId: id,
    objectId,
    role: "value",
    label: "Value",
    direction,
    side: direction === "input" ? "left" : "right",
    valueType: "number",
    allowedBindingTypes: ["READ"],
    maxConnections: null,
  };
  return {
    id,
    objectId,
    type: id.startsWith("table:") ? "table" : "element",
    label: id,
    subtitle: id,
    iconName: "Table2",
    x,
    y,
    width: 200,
    height: 128,
    pinned: false,
    positionRevision: 0,
    ports: [port],
  };
}

function binding(
  source: RelationshipNodeDto,
  target: RelationshipNodeDto,
): RelationshipBindingDto {
  const sourcePort = source.ports[0] as RelationshipPortDto;
  const targetPort = target.ports[0] as RelationshipPortDto;
  return {
    id: "00000000-0000-4000-8000-000000001001",
    projectId: "00000000-0000-4000-8000-000000001002",
    bindingType: "READ",
    source: {
      nodeType: source.type,
      nodeId: source.id,
      objectId: sourcePort.objectId,
      portId: sourcePort.id,
      portRole: sourcePort.role,
      direction: "output",
      side: "right",
      valueType: "number",
    },
    target: {
      nodeType: target.type,
      nodeId: target.id,
      objectId: targetPort.objectId,
      portId: targetPort.id,
      portRole: targetPort.role,
      direction: "input",
      side: "left",
      valueType: "number",
    },
    query: {},
    mapping: {},
    status: "READY",
    revision: 1,
    createdAt: "2026-08-16T00:00:00.000Z",
    updatedAt: "2026-08-16T00:00:00.000Z",
  };
}

describe("relationship orthogonal router", () => {
  it("uses horizontal stubs and no bend when source and target share a row", () => {
    const source = node(
      "table:00000000-0000-4000-8000-000000001003",
      0,
      0,
      "output",
    );
    const target = node(
      "element:00000000-0000-4000-8000-000000001004",
      500,
      0,
      "input",
    );
    const route = routeRelationshipEdges(
      [source, target],
      [binding(source, target)],
    )[0];
    expect(route).toBeDefined();
    expect(route?.bendCount).toBe(0);
    expect(route?.points).toEqual([
      { x: 200, y: 76 },
      { x: 500, y: 76 },
    ]);
    expect(
      (route?.points[1]?.x ?? 0) - (route?.points[0]?.x ?? 0),
    ).toBeGreaterThanOrEqual(32);
  });

  it("avoids Node interiors with only horizontal and vertical routes and 16-pixel endpoint stubs", () => {
    const source = node(
      "table:00000000-0000-4000-8000-000000001005",
      0,
      0,
      "output",
    );
    const obstacle = node(
      "element:00000000-0000-4000-8000-000000001006",
      250,
      0,
      "input",
    );
    const target = node(
      "element:00000000-0000-4000-8000-000000001007",
      600,
      0,
      "input",
    );
    const route = routeRelationshipEdges(
      [source, obstacle, target],
      [binding(source, target)],
    )[0];
    expect(route?.crossesNode).toBe(false);
    expect(route?.bendCount).toBeLessThanOrEqual(4);
    expect(route?.points.length).toBeGreaterThan(4);
    const points = route?.points ?? [];
    const first = points[0];
    const firstStub = points[1];
    const targetStub = points.at(-2);
    const targetPoint = points.at(-1);
    expect((firstStub?.x ?? 0) - (first?.x ?? 0)).toBeGreaterThanOrEqual(16);
    expect((targetPoint?.x ?? 0) - (targetStub?.x ?? 0)).toBeGreaterThanOrEqual(
      16,
    );
    for (let index = 1; index < (route?.points.length ?? 0); index += 1) {
      const before = route?.points[index - 1];
      const after = route?.points[index];
      expect(before?.x === after?.x || before?.y === after?.y).toBe(true);
      const crossesObstacleInterior =
        Math.min(before?.x ?? 0, after?.x ?? 0) < obstacle.x + obstacle.width &&
        Math.max(before?.x ?? 0, after?.x ?? 0) > obstacle.x &&
        Math.min(before?.y ?? 0, after?.y ?? 0) <
          obstacle.y + obstacle.height &&
        Math.max(before?.y ?? 0, after?.y ?? 0) > obstacle.y;
      expect(crossesObstacleInterior).toBe(false);
    }
  });

  it("omits a transient unrouteable Edge while overlapping Nodes await Auto Layout", () => {
    const source = node(
      "table:00000000-0000-4000-8000-000000001105",
      0,
      0,
      "output",
    );
    const target = node(
      "element:00000000-0000-4000-8000-000000001106",
      0,
      0,
      "input",
    );
    const blocker = {
      ...node(
        "element:00000000-0000-4000-8000-000000001107",
        -500,
        -500,
        "input",
      ),
      width: 2_000,
      height: 2_000,
    };
    const routes = routeRelationshipEdges(
      [source, target, blocker],
      [binding(source, target)],
    );
    expect(routes).toEqual([]);
  });

  it("keeps a pinned component fixed and separates disconnected components without increasing Edge crossings", async () => {
    const makeNode = (
      id: string,
      type: RelationshipNodeDto["type"],
      x: number,
      y: number,
      pinned: boolean,
      directions: readonly ("input" | "output")[],
    ): RelationshipNodeDto => {
      const objectId = id.slice(id.indexOf(":") + 1);
      return {
        id,
        objectId,
        type,
        label: id,
        subtitle: id,
        iconName: "Table2",
        x,
        y,
        width: type === "table" ? 300 : type === "page" ? 240 : 260,
        height: type === "page" ? 128 : type === "table" ? 208 : 144,
        pinned,
        positionRevision: pinned ? 1 : 0,
        ports: directions.map((direction, index) => ({
          id: `${objectId}:port-${index}:${direction}:${index}`,
          nodeId: id,
          objectId,
          role: `port-${index}`,
          label: `Port ${index}`,
          direction,
          side: direction === "input" ? "left" : "right",
          valueType: "records",
          allowedBindingTypes: ["READ"],
          maxConnections: null,
        })),
      };
    };
    const pageA = makeNode("page:a", "page", 110, 80, true, ["output"]);
    const pageB = makeNode("page:b", "page", 40, 220, false, ["output"]);
    const elementA = makeNode("element:a", "element", 380, 40, false, [
      "input",
      "input",
    ]);
    const elementB = makeNode("element:b", "element", 380, 220, false, [
      "input",
    ]);
    const table = makeNode("table:a", "table", 760, 40, false, ["output"]);
    const connect = (
      id: string,
      source: RelationshipNodeDto,
      target: RelationshipNodeDto,
      targetPortIndex = 0,
    ): RelationshipBindingDto => {
      const sourcePort = source.ports[0] as RelationshipPortDto;
      const targetPort = target.ports[targetPortIndex] as RelationshipPortDto;
      return {
        ...binding(source, target),
        id,
        source: {
          nodeType: source.type,
          nodeId: source.id,
          objectId: sourcePort.objectId,
          portId: sourcePort.id,
          portRole: sourcePort.role,
          direction: "output",
          side: "right",
          valueType: sourcePort.valueType,
        },
        target: {
          nodeType: target.type,
          nodeId: target.id,
          objectId: targetPort.objectId,
          portId: targetPort.id,
          portRole: targetPort.role,
          direction: "input",
          side: "left",
          valueType: targetPort.valueType,
        },
      };
    };
    const nodes = [pageA, pageB, elementA, elementB, table];
    const bindings = [
      connect("binding:a", pageA, elementA),
      connect("binding:b", pageB, elementB),
      connect("binding:c", table, elementA, 1),
    ];
    const result = await layoutRelationshipGraph(nodes, bindings);
    expect(
      result.positions.find(({ nodeId }) => nodeId === pageA.id),
    ).toMatchObject({ x: 110, y: 80, pinned: true });
    expect(result.crossingCountAfter).toBeLessThanOrEqual(
      result.crossingCountBefore,
    );
    expect(relationshipNodeOverlapCount(result.nodes)).toBe(0);
    expect(result.routes.every(({ crossesNode }) => !crossesNode)).toBe(true);
  });

  it("arranges related Nodes into deterministic Page, Element, and DB columns", async () => {
    const sources = Array.from({ length: 4 }, (_, index) =>
      node(
        `table:source-${index}`,
        1_800 - index * 270,
        900 + index * 310,
        "output",
      ),
    );
    const targets = Array.from({ length: 4 }, (_, index) =>
      node(
        `element:target-${index}`,
        80 + index * 420,
        1_700 - index * 260,
        "input",
      ),
    );
    const nodes = [...sources, ...targets];
    const bindings = sources.map((source, index) => ({
      ...binding(source, targets[index] as RelationshipNodeDto),
      id: `binding:${index}`,
    }));

    const first = await layoutRelationshipGraph(nodes, bindings);
    const second = await layoutRelationshipGraph(nodes, bindings);
    expect(second.positions).toEqual(first.positions);
    expect(relationshipNodeOverlapCount(first.nodes)).toBe(0);
    expect(first.routes.every(({ crossesNode }) => !crossesNode)).toBe(true);

    const byId = new Map(
      first.nodes.map((value) => [value.id, value] as const),
    );
    for (let index = 0; index < sources.length; index += 1) {
      const source = byId.get((sources[index] as RelationshipNodeDto).id);
      const target = byId.get((targets[index] as RelationshipNodeDto).id);
      expect(source).toBeDefined();
      expect(target).toBeDefined();
      expect(target?.x).toBeLessThan(source?.x ?? 0);
    }
    for (const value of first.nodes) {
      expect(value.x % 24).toBe(0);
      expect(value.y % 24).toBe(0);
    }
    const minX = Math.min(...first.nodes.map(({ x }) => x));
    const minY = Math.min(...first.nodes.map(({ y }) => y));
    const maxX = Math.max(...first.nodes.map(({ x, width }) => x + width));
    const maxY = Math.max(...first.nodes.map(({ y, height }) => y + height));
    expect(maxX - minX).toBeGreaterThan(400);
    expect(maxY - minY).toBeGreaterThan(400);
  });

  it("aligns variable-width Nodes by their top-left layer origin", async () => {
    const sources = [
      { ...node("table:left-a", 900, 800, "output"), width: 176 },
      { ...node("table:left-b", 120, 420, "output"), width: 248 },
      { ...node("table:left-c", 640, 90, "output"), width: 320 },
    ];
    const target = {
      ...node("element:right", 1_500, 600, "input"),
      width: 280,
    };
    const bindings = sources.map((source, index) => ({
      ...binding(source, target),
      id: `top-left-binding:${index}`,
    }));
    const result = await layoutRelationshipGraph(
      [...sources, target],
      bindings,
    );
    const alignedSources = alignComponentToRowsAndColumns([
      { ...sources[0]!, x: 10, y: 0 },
      { ...sources[1]!, x: 18, y: 300 },
      { ...sources[2]!, x: 24, y: 600 },
    ]);
    expect(new Set(alignedSources.map(({ x }) => x)).size).toBe(1);
    expect(
      alignedSources.every(({ x, y }) => x % 24 === 0 && y % 24 === 0),
    ).toBe(true);
    const positions = new Map(
      result.nodes.map((value) => [value.id, value] as const),
    );
    expect(result.nodes.every(({ x, y }) => x % 24 === 0 && y % 24 === 0)).toBe(
      true,
    );
    expect(positions.get(target.id)).toBeDefined();
    expect(
      sources
        .map(({ id }) => positions.get(id)?.y)
        .every((y) => Number.isInteger((y ?? 1) / 24)),
    ).toBe(true);
  });

  it("uses Page | Element | DB columns and puts highly connected Nodes first", () => {
    const pageMain = {
      ...node("page:main", 900, 900, "output"),
      type: "page" as const,
      label: "Main",
    };
    const pageOther = {
      ...node("page:other", 400, 200, "output"),
      type: "page" as const,
      label: "Other",
    };
    const elementMain = node("element:main", 100, 800, "input");
    const elementOther = node("element:other", 800, 100, "input");
    const tableMain = node("table:main", 500, 500, "output");
    const connect = (
      id: string,
      source: RelationshipNodeDto,
      target: RelationshipNodeDto,
    ) => ({ ...binding(source, target), id });
    const bindings = [
      connect("contains:a", pageMain, elementMain),
      connect("contains:b", pageMain, elementOther),
      connect("read:a", tableMain, elementMain),
      connect("contains:c", pageOther, elementOther),
    ];
    const arranged = alignGraphByNodeTypeColumns(
      [pageOther, tableMain, elementOther, pageMain, elementMain],
      bindings,
    );
    const byId = new Map(arranged.map((value) => [value.id, value] as const));
    expect(byId.get(pageMain.id)?.y).toBeLessThan(
      byId.get(pageOther.id)?.y ?? 0,
    );
    expect(byId.get(pageMain.id)?.x).toBeLessThan(
      byId.get(elementMain.id)?.x ?? 0,
    );
    expect(byId.get(elementMain.id)?.x).toBeLessThan(
      byId.get(tableMain.id)?.x ?? 0,
    );
    expect(
      new Set(arranged.filter(({ type }) => type === "page").map(({ x }) => x))
        .size,
    ).toBe(1);
    expect(
      new Set(
        arranged.filter(({ type }) => type === "element").map(({ x }) => x),
      ).size,
    ).toBe(1);
  });

  it("wraps large typed inventories toward a 16:9 overview without mixing zones", () => {
    const pages = Array.from({ length: 22 }, (_, index) => ({
      ...node(`page:${index}`, index * 11, index * 17, "output"),
      type: "page" as const,
      width: 240,
    }));
    const elements = Array.from({ length: 55 }, (_, index) =>
      node(`element:${index}`, index * 13, index * 19, "input"),
    );
    const tables = Array.from({ length: 8 }, (_, index) => ({
      ...node(`table:${index}`, index * 23, index * 29, "output"),
      width: 300,
    }));
    const arranged = alignGraphByNodeTypeColumns(
      [...tables, ...elements, ...pages],
      [],
    );
    const pageMaxX = Math.max(
      ...arranged
        .filter(({ type }) => type === "page")
        .map(({ x, width }) => x + width),
    );
    const elementMinX = Math.min(
      ...arranged.filter(({ type }) => type === "element").map(({ x }) => x),
    );
    const elementMaxX = Math.max(
      ...arranged
        .filter(({ type }) => type === "element")
        .map(({ x, width }) => x + width),
    );
    const tableMinX = Math.min(
      ...arranged.filter(({ type }) => type === "table").map(({ x }) => x),
    );
    expect(pageMaxX).toBeLessThan(elementMinX);
    expect(elementMaxX).toBeLessThan(tableMinX);
    const minX = Math.min(...arranged.map(({ x }) => x));
    const minY = Math.min(...arranged.map(({ y }) => y));
    const maxX = Math.max(...arranged.map(({ x, width }) => x + width));
    const maxY = Math.max(...arranged.map(({ y, height }) => y + height));
    const aspect = (maxX - minX) / (maxY - minY);
    expect(aspect).toBeGreaterThan(1.35);
    expect(aspect).toBeLessThan(2.25);
    expect(arranged.every(({ x, y }) => x % 24 === 0 && y % 24 === 0)).toBe(
      true,
    );
  });
});
