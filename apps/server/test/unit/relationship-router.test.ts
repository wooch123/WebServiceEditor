import type {
  RelationshipBindingDto,
  RelationshipNodeDto,
  RelationshipPortDto,
} from "@webeditor/domain";
import { describe, expect, it } from "vitest";

import {
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
});
