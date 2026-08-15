import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ELEMENT_DEFINITIONS,
  type ElementEntryDto,
  type PageDto,
} from "@webeditor/domain";
import Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { buildServer } from "../../src/app.js";

interface Fixture {
  readonly directory: string;
  readonly databasePath: string;
  readonly storageRoot: string;
}

interface ProjectDto {
  readonly id: string;
  readonly name: string;
  readonly revision: number;
  readonly lifecycleRevision: number;
  readonly elementCount: number;
}

interface ElementListResponse {
  readonly pageId: string;
  readonly layoutRevision: number;
  readonly projectRevision: number;
  readonly elements: readonly ElementEntryDto[];
}

const directories: string[] = [];
const apps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
  for (const directory of directories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function fixture(): Fixture {
  const directory = mkdtempSync(join(tmpdir(), "webeditor-elements-"));
  directories.push(directory);
  return {
    directory,
    databasePath: join(directory, "metadata", "webeditor.sqlite"),
    storageRoot: join(directory, "projects"),
  };
}

function server(current: Fixture): FastifyInstance {
  const app = buildServer({
    metadataDatabasePath: current.databasePath,
    storageRoot: current.storageRoot,
  });
  apps.push(app);
  return app;
}

async function close(app: FastifyInstance): Promise<void> {
  const index = apps.indexOf(app);
  if (index >= 0) apps.splice(index, 1);
  await app.close();
}

async function createProject(
  app: FastifyInstance,
  name = "Element Project",
  slug = `element-project-${randomUUID().slice(0, 8)}`,
): Promise<ProjectDto> {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/projects",
    payload: { name, slug },
  });
  expect(response.statusCode, response.body).toBe(201);
  return (response.json() as { readonly project: ProjectDto }).project;
}

async function createPage(
  app: FastifyInstance,
  projectId: string,
  projectRevision: number,
  name = "Canvas",
): Promise<{ readonly page: PageDto; readonly projectRevision: number }> {
  const response = await app.inject({
    method: "POST",
    url: `/api/v1/projects/${projectId}/pages`,
    payload: {
      name,
      pageType: "blank",
      expectedProjectRevision: projectRevision,
      idempotencyKey: `page-${randomUUID()}`,
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json() as {
    readonly page: PageDto;
    readonly projectRevision: number;
  };
}

async function listElements(
  app: FastifyInstance,
  pageId: string,
): Promise<ElementListResponse> {
  const response = await app.inject({
    method: "GET",
    url: `/api/v1/pages/${pageId}/elements`,
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json() as ElementListResponse;
}

async function directCreate(
  app: FastifyInstance,
  pageId: string,
  elementType: "text" | "button" | "container" | "kpi-card",
  layoutRevision: number,
  projectRevision: number,
) {
  const response = await app.inject({
    method: "POST",
    url: `/api/v1/pages/${pageId}/elements`,
    payload: {
      elementType,
      expectedLayoutRevision: layoutRevision,
      expectedProjectRevision: projectRevision,
      idempotencyKey: `element-${randomUUID()}`,
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json() as {
    readonly entry: ElementEntryDto;
    readonly layoutRevision: number;
    readonly projectRevision: number;
    readonly commandId: string;
  };
}

describe("element layout routes", () => {
  it("previews and commits exact geometry for every registered ELEMENT_DEFINITIONS type with deterministic nearest collision", async () => {
    const current = fixture();
    const app = server(current);
    const project = await createProject(
      app,
      "Kernel Elements",
      "kernel-elements",
    );
    const page = await createPage(app, project.id, project.revision);
    let layoutRevision = 0;
    let projectRevision = page.projectRevision;

    for (const [index, definition] of ELEMENT_DEFINITIONS.entries()) {
      const placement = await app.inject({
        method: "POST",
        url: `/api/v1/pages/${page.page.id}/placement-candidates`,
        payload: {
          elementType: definition.type,
          pointer: {
            rawCanvasX: 16,
            rawCanvasY: 16,
            correctedCanvasX: 16,
            correctedCanvasY: 16,
          },
          canvasWidth: 1_000,
          canvasHeight: 800,
          expectedLayoutRevision: layoutRevision,
          expectedProjectRevision: projectRevision,
        },
      });
      expect(placement.statusCode, placement.body).toBe(200);
      const candidate = (
        placement.json() as {
          candidate: {
            candidateId: string;
            x: number;
            y: number;
            w: number;
            h: number;
            collisionResolved: boolean;
          };
        }
      ).candidate;
      expect(candidate).toMatchObject({
        w: definition.layout.defaultW,
        h: definition.layout.defaultH,
        collisionResolved: index > 0,
      });

      const commit = await app.inject({
        method: "POST",
        url: `/api/v1/pages/${page.page.id}/elements/from-placement`,
        payload: {
          candidateId: candidate.candidateId,
          expectedLayoutRevision: layoutRevision,
          expectedProjectRevision: projectRevision,
          idempotencyKey: `kernel-drop-${definition.type}-${randomUUID()}`,
        },
      });
      expect(commit.statusCode, commit.body).toBe(201);
      const committed = commit.json() as {
        entry: ElementEntryDto;
        layoutRevision: number;
        projectRevision: number;
      };
      expect(committed.entry.layout).toMatchObject({
        x: candidate.x,
        y: candidate.y,
        w: candidate.w,
        h: candidate.h,
      });
      layoutRevision = committed.layoutRevision;
      projectRevision = committed.projectRevision;
    }

    expect((await listElements(app, page.page.id)).elements).toHaveLength(
      ELEMENT_DEFINITIONS.length,
    );
  });

  it("resolves a locked collision to the exact nearest cell with the canonical scan-order tie-break", async () => {
    const current = fixture();
    const app = server(current);
    const project = await createProject(
      app,
      "Nearest Collision",
      "nearest-collision",
    );
    const page = await createPage(app, project.id, project.revision);
    const blocker = await directCreate(
      app,
      page.page.id,
      "button",
      0,
      page.projectRevision,
    );
    const positionedResponse = await app.inject({
      method: "PATCH",
      url: `/api/v1/elements/${blocker.entry.element.id}`,
      payload: {
        expectedRevision: blocker.entry.element.revision,
        expectedLayoutRevision: blocker.layoutRevision,
        expectedProjectRevision: blocker.projectRevision,
        idempotencyKey: `nearest-position-${randomUUID()}`,
        change: { kind: "MOVE", x: 10, y: 10 },
      },
    });
    expect(positionedResponse.statusCode, positionedResponse.body).toBe(200);
    const positioned = positionedResponse.json() as {
      entry: ElementEntryDto;
      layoutRevision: number;
      projectRevision: number;
    };
    const support = await directCreate(
      app,
      page.page.id,
      "button",
      positioned.layoutRevision,
      positioned.projectRevision,
    );
    const supportPositionedResponse = await app.inject({
      method: "PATCH",
      url: `/api/v1/elements/${support.entry.element.id}`,
      payload: {
        expectedRevision: support.entry.element.revision,
        expectedLayoutRevision: support.layoutRevision,
        expectedProjectRevision: support.projectRevision,
        idempotencyKey: `nearest-support-${randomUUID()}`,
        change: { kind: "MOVE", x: 6, y: 5 },
      },
    });
    expect(
      supportPositionedResponse.statusCode,
      supportPositionedResponse.body,
    ).toBe(200);
    const supportPositioned = supportPositionedResponse.json() as {
      entry: ElementEntryDto;
      layoutRevision: number;
      projectRevision: number;
    };
    const lockedResponse = await app.inject({
      method: "PATCH",
      url: `/api/v1/elements/${blocker.entry.element.id}`,
      payload: {
        expectedRevision: positioned.entry.element.revision,
        expectedLayoutRevision: supportPositioned.layoutRevision,
        expectedProjectRevision: supportPositioned.projectRevision,
        idempotencyKey: `nearest-lock-${randomUUID()}`,
        change: { kind: "LOCK", locked: true },
      },
    });
    expect(lockedResponse.statusCode, lockedResponse.body).toBe(200);
    const locked = lockedResponse.json() as {
      entry: ElementEntryDto;
      layoutRevision: number;
      projectRevision: number;
    };
    const canvasWidth = 1_000;
    const columnStride = (canvasWidth - 16 * 2 - 8 * (24 - 1)) / 24 + 8;
    const correctedCanvasX = 16 + columnStride * 10;
    const correctedCanvasY = 16 + (8 + 8) * 10;
    const placement = await app.inject({
      method: "POST",
      url: `/api/v1/pages/${page.page.id}/placement-candidates`,
      payload: {
        elementType: "button",
        pointer: {
          rawCanvasX: correctedCanvasX,
          rawCanvasY: correctedCanvasY,
          correctedCanvasX,
          correctedCanvasY,
        },
        canvasWidth,
        canvasHeight: 800,
        expectedLayoutRevision: locked.layoutRevision,
        expectedProjectRevision: locked.projectRevision,
      },
    });
    expect(placement.statusCode, placement.body).toBe(200);
    const candidate = (
      placement.json() as {
        candidate: {
          candidateId: string;
          x: number;
          y: number;
          w: number;
          h: number;
          collisionResolved: boolean;
        };
      }
    ).candidate;
    expect(candidate).toMatchObject({
      x: 6,
      y: 10,
      w: 4,
      h: 5,
      collisionResolved: true,
    });

    const committed = await app.inject({
      method: "POST",
      url: `/api/v1/pages/${page.page.id}/elements/from-placement`,
      payload: {
        candidateId: candidate.candidateId,
        expectedLayoutRevision: locked.layoutRevision,
        expectedProjectRevision: locked.projectRevision,
        idempotencyKey: `nearest-commit-${randomUUID()}`,
      },
    });
    expect(committed.statusCode, committed.body).toBe(201);
    expect(
      (committed.json() as { entry: ElementEntryDto }).entry.layout,
    ).toMatchObject({ x: 6, y: 10, w: 4, h: 5 });
  });

  it("server-compacts an empty y12 placement to y0 and a blocked placement to the exact blocker bottom", async () => {
    const current = fixture();
    const app = server(current);
    const project = await createProject(
      app,
      "Candidate Compaction",
      "candidate-compaction",
    );
    const page = await createPage(app, project.id, project.revision);
    const correctedCanvasY = 16 + (8 + 8) * 12;
    const requestCandidate = async (
      elementType: "text" | "button",
      layoutRevision: number,
      projectRevision: number,
    ) => {
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/pages/${page.page.id}/placement-candidates`,
        payload: {
          elementType,
          pointer: {
            rawCanvasX: 16,
            rawCanvasY: correctedCanvasY,
            correctedCanvasX: 16,
            correctedCanvasY,
          },
          canvasWidth: 1_000,
          canvasHeight: 800,
          expectedLayoutRevision: layoutRevision,
          expectedProjectRevision: projectRevision,
        },
      });
      expect(response.statusCode, response.body).toBe(200);
      return (
        response.json() as {
          candidate: {
            candidateId: string;
            x: number;
            y: number;
            w: number;
            h: number;
            valid: boolean;
            collisionResolved: boolean;
          };
        }
      ).candidate;
    };
    const commit = async (
      candidate: { candidateId: string },
      layoutRevision: number,
      projectRevision: number,
    ) => {
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/pages/${page.page.id}/elements/from-placement`,
        payload: {
          candidateId: candidate.candidateId,
          expectedLayoutRevision: layoutRevision,
          expectedProjectRevision: projectRevision,
          idempotencyKey: `compact-drop-${randomUUID()}`,
        },
      });
      expect(response.statusCode, response.body).toBe(201);
      return response.json() as {
        entry: ElementEntryDto;
        layoutRevision: number;
        projectRevision: number;
      };
    };

    const emptyCandidate = await requestCandidate(
      "text",
      0,
      page.projectRevision,
    );
    expect(emptyCandidate).toMatchObject({
      x: 0,
      y: 0,
      w: 6,
      h: 5,
      valid: true,
      collisionResolved: true,
    });
    const first = await commit(emptyCandidate, 0, page.projectRevision);
    expect(first.entry.layout).toMatchObject({ x: 0, y: 0, w: 6, h: 5 });

    const blockedCandidate = await requestCandidate(
      "button",
      first.layoutRevision,
      first.projectRevision,
    );
    expect(blockedCandidate).toMatchObject({
      x: 0,
      y: 5,
      w: 4,
      h: 5,
      valid: true,
      collisionResolved: true,
    });
    const second = await commit(
      blockedCandidate,
      first.layoutRevision,
      first.projectRevision,
    );
    expect(second.entry.layout).toMatchObject({ x: 0, y: 5, w: 4, h: 5 });
  });

  it("binds measured Canvas height and blocks bottom+1 or final-element overflow without inserting", async () => {
    const current = fixture();
    const app = server(current);
    const project = await createProject(
      app,
      "Vertical Boundary",
      "vertical-boundary",
    );
    const page = await createPage(app, project.id, project.revision);
    const canvasHeight = 240;
    for (const invalidCanvasHeight of [239, 100_001]) {
      const invalidHeight = await app.inject({
        method: "POST",
        url: `/api/v1/pages/${page.page.id}/placement-candidates`,
        payload: {
          elementType: "text",
          pointer: {
            rawCanvasX: 16,
            rawCanvasY: 16,
            correctedCanvasX: 16,
            correctedCanvasY: 16,
          },
          canvasWidth: 1_000,
          canvasHeight: invalidCanvasHeight,
          expectedLayoutRevision: 0,
          expectedProjectRevision: page.projectRevision,
        },
      });
      expect(invalidHeight.statusCode).toBe(400);
      expect(invalidHeight.json()).toMatchObject({
        error: { code: "INVALID_CANVAS_HEIGHT" },
      });
    }
    const candidateResponse = await app.inject({
      method: "POST",
      url: `/api/v1/pages/${page.page.id}/placement-candidates`,
      payload: {
        elementType: "text",
        pointer: {
          rawCanvasX: 16,
          rawCanvasY: canvasHeight + 1,
          correctedCanvasX: 16,
          correctedCanvasY: canvasHeight + 1,
        },
        canvasWidth: 1_000,
        canvasHeight,
        expectedLayoutRevision: 0,
        expectedProjectRevision: page.projectRevision,
      },
    });
    expect(candidateResponse.statusCode, candidateResponse.body).toBe(200);
    const bottomCandidate = (
      candidateResponse.json() as {
        candidate: { candidateId: string; valid: boolean };
      }
    ).candidate;
    expect(bottomCandidate.valid).toBe(false);
    const blockedBottomCommit = await app.inject({
      method: "POST",
      url: `/api/v1/pages/${page.page.id}/elements/from-placement`,
      payload: {
        candidateId: bottomCandidate.candidateId,
        expectedLayoutRevision: 0,
        expectedProjectRevision: page.projectRevision,
        idempotencyKey: `bottom-plus-one-${randomUUID()}`,
      },
    });
    expect(blockedBottomCommit.statusCode).toBe(409);
    expect(blockedBottomCommit.json()).toMatchObject({
      error: { code: "PLACEMENT_CANDIDATE_INVALID" },
    });
    expect((await listElements(app, page.page.id)).elements).toHaveLength(0);

    const blocker = await directCreate(
      app,
      page.page.id,
      "container",
      0,
      page.projectRevision,
    );
    const overflowResponse = await app.inject({
      method: "POST",
      url: `/api/v1/pages/${page.page.id}/placement-candidates`,
      payload: {
        elementType: "text",
        pointer: {
          rawCanvasX: 16,
          rawCanvasY: 200,
          correctedCanvasX: 16,
          correctedCanvasY: 200,
        },
        canvasWidth: 1_000,
        canvasHeight,
        expectedLayoutRevision: blocker.layoutRevision,
        expectedProjectRevision: blocker.projectRevision,
      },
    });
    expect(overflowResponse.statusCode, overflowResponse.body).toBe(200);
    const overflowCandidate = (
      overflowResponse.json() as {
        candidate: {
          candidateId: string;
          y: number;
          h: number;
          valid: boolean;
        };
      }
    ).candidate;
    expect(overflowCandidate).toMatchObject({ y: 12, h: 5, valid: false });
    const blockedOverflowCommit = await app.inject({
      method: "POST",
      url: `/api/v1/pages/${page.page.id}/elements/from-placement`,
      payload: {
        candidateId: overflowCandidate.candidateId,
        expectedLayoutRevision: blocker.layoutRevision,
        expectedProjectRevision: blocker.projectRevision,
        idempotencyKey: `bottom-overflow-${randomUUID()}`,
      },
    });
    expect(blockedOverflowCommit.statusCode).toBe(409);
    expect((await listElements(app, page.page.id)).elements).toHaveLength(1);
  });

  it("rolls back a 5xx server failure without a command and lets the same idempotency key retry succeed", async () => {
    const current = fixture();
    let injectFailure = true;
    const app = buildServer({
      metadataDatabasePath: current.databasePath,
      storageRoot: current.storageRoot,
      elementFailureInjector: (point) => {
        if (injectFailure && point === "element:add-before-command") {
          injectFailure = false;
          throw new Error("Injected Element server failure");
        }
      },
    });
    apps.push(app);
    const project = await createProject(
      app,
      "Element Rollback",
      "element-rollback",
    );
    const page = await createPage(app, project.id, project.revision);
    const idempotencyKey = `retry-5xx-${randomUUID()}`;
    const payload = {
      elementType: "text",
      expectedLayoutRevision: 0,
      expectedProjectRevision: page.projectRevision,
      idempotencyKey,
    };
    const database = new Database(current.databasePath);
    const state = () =>
      database
        .prepare(
          `SELECT p.revision,
             (SELECT desktop_revision FROM page_layout_revisions WHERE page_id = ?) AS layout_revision,
             (SELECT count(*) FROM elements WHERE project_id = ?) AS elements,
             (SELECT count(*) FROM element_commands WHERE project_id = ?) AS commands,
             (SELECT count(*) FROM audit_logs WHERE project_id = ? AND action = 'ELEMENT_ADD') AS audits
           FROM projects p WHERE p.id = ?`,
        )
        .get(page.page.id, project.id, project.id, project.id, project.id);
    const before = state();

    const failed = await app.inject({
      method: "POST",
      url: `/api/v1/pages/${page.page.id}/elements`,
      payload,
    });
    expect(failed.statusCode).toBe(500);
    expect(failed.json()).toMatchObject({ error: { code: "INTERNAL_ERROR" } });
    expect(state()).toEqual(before);

    const retry = await app.inject({
      method: "POST",
      url: `/api/v1/pages/${page.page.id}/elements`,
      payload,
    });
    expect(retry.statusCode, retry.body).toBe(201);
    expect(state()).toMatchObject({
      revision: page.projectRevision + 1,
      layout_revision: 1,
      elements: 1,
      commands: 1,
      audits: 1,
    });
    database.close();
  });

  it("uses a write-free server candidate for preview and blocks a clamped out-of-bounds commit", async () => {
    const current = fixture();
    const app = server(current);
    const project = await createProject(app);
    const page = await createPage(app, project.id, project.revision);
    const initial = await listElements(app, page.page.id);
    expect(initial).toMatchObject({
      layoutRevision: 0,
      projectRevision: page.projectRevision,
      elements: [],
    });

    const beforeDatabase = new Database(current.databasePath, {
      readonly: true,
    });
    const stateBefore = beforeDatabase
      .prepare(
        `SELECT p.revision, p.updated_at,
           (SELECT count(*) FROM audit_logs WHERE project_id = p.id) AS audits,
           (SELECT count(*) FROM element_commands WHERE project_id = p.id) AS commands,
           (SELECT desktop_revision FROM page_layout_revisions WHERE page_id = ?) AS layout_revision
         FROM projects p WHERE p.id = ?`,
      )
      .get(page.page.id, project.id);
    beforeDatabase.close();

    const candidateResponse = await app.inject({
      method: "POST",
      url: `/api/v1/pages/${page.page.id}/placement-candidates`,
      payload: {
        elementType: "text",
        pointer: {
          rawCanvasX: 16,
          rawCanvasY: 16,
          correctedCanvasX: 16,
          correctedCanvasY: 16,
        },
        canvasWidth: 1_000,
        canvasHeight: 800,
        expectedLayoutRevision: 0,
        expectedProjectRevision: page.projectRevision,
      },
    });
    expect(candidateResponse.statusCode, candidateResponse.body).toBe(200);
    const candidate = (
      candidateResponse.json() as {
        readonly candidate: {
          readonly candidateId: string;
          readonly x: number;
          readonly y: number;
          readonly w: number;
          readonly h: number;
          readonly valid: boolean;
          readonly collisionResolved: boolean;
        };
      }
    ).candidate;
    expect(candidate).toMatchObject({
      x: 0,
      y: 0,
      w: 6,
      h: 5,
      valid: true,
      collisionResolved: false,
    });

    const afterDatabase = new Database(current.databasePath, {
      readonly: true,
    });
    expect(
      afterDatabase
        .prepare(
          `SELECT p.revision, p.updated_at,
             (SELECT count(*) FROM audit_logs WHERE project_id = p.id) AS audits,
             (SELECT count(*) FROM element_commands WHERE project_id = p.id) AS commands,
             (SELECT desktop_revision FROM page_layout_revisions WHERE page_id = ?) AS layout_revision
           FROM projects p WHERE p.id = ?`,
        )
        .get(page.page.id, project.id),
    ).toEqual(stateBefore);
    afterDatabase.close();

    const idempotencyKey = `drop-${randomUUID()}`;
    const dropPayload = {
      candidateId: candidate.candidateId,
      expectedLayoutRevision: 0,
      expectedProjectRevision: page.projectRevision,
      idempotencyKey,
    };
    const committed = await app.inject({
      method: "POST",
      url: `/api/v1/pages/${page.page.id}/elements/from-placement`,
      payload: dropPayload,
    });
    expect(committed.statusCode, committed.body).toBe(201);
    const committedBody = committed.json() as {
      readonly entry: ElementEntryDto;
      readonly layoutRevision: number;
      readonly projectRevision: number;
    };
    expect(committedBody.entry.layout).toMatchObject({
      x: candidate.x,
      y: candidate.y,
      w: candidate.w,
      h: candidate.h,
    });

    const replay = await app.inject({
      method: "POST",
      url: `/api/v1/pages/${page.page.id}/elements/from-placement`,
      payload: dropPayload,
    });
    expect(replay.statusCode, replay.body).toBe(201);
    expect(replay.json()).toEqual(committed.json());

    const consumedAgain = await app.inject({
      method: "POST",
      url: `/api/v1/pages/${page.page.id}/elements/from-placement`,
      payload: {
        ...dropPayload,
        expectedLayoutRevision: committedBody.layoutRevision,
        expectedProjectRevision: committedBody.projectRevision,
        idempotencyKey: `drop-again-${randomUUID()}`,
      },
    });
    expect(consumedAgain.statusCode).toBe(409);
    expect(consumedAgain.json()).toMatchObject({
      error: { code: "PLACEMENT_CANDIDATE_STALE" },
    });

    const keyConflict = await app.inject({
      method: "POST",
      url: `/api/v1/pages/${page.page.id}/elements/from-placement`,
      payload: {
        ...dropPayload,
        expectedProjectRevision: committedBody.projectRevision,
      },
    });
    expect(keyConflict.statusCode).toBe(409);
    expect(keyConflict.json()).toMatchObject({
      error: { code: "IDEMPOTENCY_PAYLOAD_CONFLICT" },
    });

    const outside = await app.inject({
      method: "POST",
      url: `/api/v1/pages/${page.page.id}/placement-candidates`,
      payload: {
        elementType: "button",
        pointer: {
          rawCanvasX: -5,
          rawCanvasY: 10,
          correctedCanvasX: -5,
          correctedCanvasY: 10,
        },
        canvasWidth: 1_000,
        canvasHeight: 800,
        expectedLayoutRevision: committedBody.layoutRevision,
        expectedProjectRevision: committedBody.projectRevision,
      },
    });
    expect(outside.statusCode).toBe(200);
    expect(outside.json()).toMatchObject({ candidate: { valid: false, x: 0 } });
    const invalidDrop = await app.inject({
      method: "POST",
      url: `/api/v1/pages/${page.page.id}/elements/from-placement`,
      payload: {
        candidateId: (outside.json() as { candidate: { candidateId: string } })
          .candidate.candidateId,
        expectedLayoutRevision: committedBody.layoutRevision,
        expectedProjectRevision: committedBody.projectRevision,
        idempotencyKey: `outside-${randomUUID()}`,
      },
    });
    expect(invalidDrop.statusCode).toBe(409);
    expect(invalidDrop.json()).toMatchObject({
      error: { code: "PLACEMENT_CANDIDATE_INVALID" },
    });
  });

  it("persists exact n/s/e/w/ne/nw/se/sw resize results and clamps min/max boundaries", async () => {
    const current = fixture();
    const app = server(current);
    const project = await createProject(app, "Resize Matrix", "resize-matrix");
    const page = await createPage(app, project.id, project.revision);
    const created = await directCreate(
      app,
      page.page.id,
      "text",
      0,
      page.projectRevision,
    );
    const positioned = await app.inject({
      method: "PATCH",
      url: `/api/v1/elements/${created.entry.element.id}`,
      payload: {
        expectedRevision: created.entry.element.revision,
        expectedLayoutRevision: created.layoutRevision,
        expectedProjectRevision: created.projectRevision,
        idempotencyKey: `position-${randomUUID()}`,
        change: { kind: "MOVE", x: 8, y: 20 },
      },
    });
    expect(positioned.statusCode, positioned.body).toBe(200);
    let state = positioned.json() as {
      readonly entry: ElementEntryDto;
      readonly layoutRevision: number;
      readonly projectRevision: number;
    };

    const handles = ["n", "s", "e", "w", "ne", "nw", "se", "sw"] as const;
    for (const handle of handles) {
      const currentLayout = state.entry.layout;
      const requested = {
        x: currentLayout.x - (handle.includes("w") ? 1 : 0),
        y: currentLayout.y - (handle.includes("n") ? 1 : 0),
        w:
          currentLayout.w +
          (handle.includes("w") || handle.includes("e") ? 1 : 0),
        h:
          currentLayout.h +
          (handle.includes("n") || handle.includes("s") ? 1 : 0),
      };
      const response = await app.inject({
        method: "PATCH",
        url: `/api/v1/elements/${state.entry.element.id}`,
        payload: {
          expectedRevision: state.entry.element.revision,
          expectedLayoutRevision: state.layoutRevision,
          expectedProjectRevision: state.projectRevision,
          idempotencyKey: `resize-${handle}-${randomUUID()}`,
          change: { kind: "RESIZE", handle, ...requested },
        },
      });
      expect(response.statusCode, `${handle}: ${response.body}`).toBe(200);
      state = response.json() as typeof state;
      expect(state.entry.layout, handle).toMatchObject(requested);
    }

    const resize = async (
      handle: "n" | "s" | "e" | "w",
      requested: { x: number; y: number; w: number; h: number },
    ) => {
      const response = await app.inject({
        method: "PATCH",
        url: `/api/v1/elements/${state.entry.element.id}`,
        payload: {
          expectedRevision: state.entry.element.revision,
          expectedLayoutRevision: state.layoutRevision,
          expectedProjectRevision: state.projectRevision,
          idempotencyKey: `limit-${handle}-${randomUUID()}`,
          change: { kind: "RESIZE", handle, ...requested },
        },
      });
      expect(response.statusCode, response.body).toBe(200);
      state = response.json() as typeof state;
      return state.entry.layout;
    };

    let layout = state.entry.layout;
    layout = await resize("e", {
      x: layout.x,
      y: layout.y,
      w: 999,
      h: layout.h,
    });
    expect(layout.x + layout.w).toBe(24);
    layout = await resize("w", {
      x: -100,
      y: layout.y,
      w: layout.x + layout.w + 100,
      h: layout.h,
    });
    expect(layout).toMatchObject({ x: 0, w: 24 });
    layout = await resize("n", {
      x: layout.x,
      y: -100,
      w: layout.w,
      h: layout.y + layout.h + 100,
    });
    expect(layout.h).toBe(20);
    layout = await resize("s", {
      x: layout.x,
      y: layout.y,
      w: layout.w,
      h: 999,
    });
    expect(layout.h).toBe(20);
    layout = await resize("e", {
      x: layout.x,
      y: layout.y,
      w: 1,
      h: layout.h,
    });
    expect(layout.w).toBe(2);
    layout = await resize("s", {
      x: layout.x,
      y: layout.y,
      w: layout.w,
      h: 1,
    });
    expect(layout.h).toBe(3);
  });

  it("persists 20 Elements, atomic complete/partial layouts, locks, deletes, and restart", async () => {
    const current = fixture();
    let app = server(current);
    const project = await createProject(app, "Dense Canvas", "dense-canvas");
    const page = await createPage(app, project.id, project.revision);
    let layoutRevision = 0;
    let projectRevision = page.projectRevision;
    for (let index = 0; index < 20; index += 1) {
      const created = await directCreate(
        app,
        page.page.id,
        "text",
        layoutRevision,
        projectRevision,
      );
      layoutRevision = created.layoutRevision;
      projectRevision = created.projectRevision;
    }
    let listed = await listElements(app, page.page.id);
    expect(listed.elements).toHaveLength(20);

    const movedItems = listed.elements.map(({ element, layout }) => ({
      elementId: element.id,
      expectedRevision: element.revision,
      x: layout.x,
      y: layout.y + 100,
      w: layout.w - 1,
      h: layout.h - 1,
    }));
    const batch = await app.inject({
      method: "POST",
      url: "/api/v1/elements/batch-layout",
      payload: {
        pageId: page.page.id,
        expectedLayoutRevision: layoutRevision,
        expectedProjectRevision: projectRevision,
        idempotencyKey: `complete-${randomUUID()}`,
        mode: "COMPLETE",
        items: movedItems,
      },
    });
    expect(batch.statusCode, batch.body).toBe(200);
    const batchBody = batch.json() as {
      readonly entries: readonly ElementEntryDto[];
      readonly layoutRevision: number;
      readonly projectRevision: number;
    };
    layoutRevision = batchBody.layoutRevision;
    projectRevision = batchBody.projectRevision;
    expect(batchBody.entries.every(({ layout }) => layout.y >= 100)).toBe(true);
    expect(
      batchBody.entries.every(({ layout }) => layout.w === 5 && layout.h === 4),
    ).toBe(true);

    const partialPayload = {
      pageId: page.page.id,
      expectedLayoutRevision: layoutRevision,
      expectedProjectRevision: projectRevision,
      idempotencyKey: `partial-${randomUUID()}`,
      mode: "PARTIAL",
      items: [
        {
          elementId: batchBody.entries[0]?.element.id,
          expectedRevision: batchBody.entries[0]?.element.revision,
          x: (batchBody.entries[0]?.layout.x ?? 0) + 2,
          y: batchBody.entries[0]?.layout.y,
          w: batchBody.entries[0]?.layout.w,
          h: batchBody.entries[0]?.layout.h,
        },
      ],
    };
    const partial = await app.inject({
      method: "POST",
      url: "/api/v1/elements/batch-layout",
      payload: partialPayload,
    });
    expect(partial.statusCode, partial.body).toBe(409);
    expect(partial.json()).toMatchObject({
      error: { code: "ELEMENT_COLLISION" },
    });
    const failureReplay = await app.inject({
      method: "POST",
      url: "/api/v1/elements/batch-layout",
      payload: partialPayload,
    });
    expect(failureReplay.statusCode).toBe(409);
    expect(failureReplay.json()).toEqual(partial.json());

    await close(app);
    app = server(current);
    listed = await listElements(app, page.page.id);
    expect(listed.elements).toEqual(batchBody.entries);
    layoutRevision = listed.layoutRevision;
    projectRevision = listed.projectRevision;

    const target = listed.elements[0] as ElementEntryDto;
    const locked = await app.inject({
      method: "PATCH",
      url: `/api/v1/elements/${target.element.id}`,
      payload: {
        expectedRevision: target.element.revision,
        expectedLayoutRevision: layoutRevision,
        expectedProjectRevision: projectRevision,
        idempotencyKey: `lock-${randomUUID()}`,
        change: { kind: "LOCK", locked: true },
      },
    });
    expect(locked.statusCode, locked.body).toBe(200);
    const lockedBody = locked.json() as {
      readonly entry: ElementEntryDto;
      readonly layoutRevision: number;
      readonly projectRevision: number;
    };
    expect(lockedBody.entry.element.locked).toBe(true);
    expect(lockedBody.layoutRevision).toBe(layoutRevision);

    const lockedMovePayload = {
      expectedRevision: lockedBody.entry.element.revision,
      expectedLayoutRevision: lockedBody.layoutRevision,
      expectedProjectRevision: lockedBody.projectRevision,
      idempotencyKey: `locked-move-${randomUUID()}`,
      change: {
        kind: "MOVE",
        x: lockedBody.entry.layout.x,
        y: lockedBody.entry.layout.y + 50,
      },
    };
    const lockedMove = await app.inject({
      method: "PATCH",
      url: `/api/v1/elements/${target.element.id}`,
      payload: lockedMovePayload,
    });
    expect(lockedMove.statusCode).toBe(409);
    expect(lockedMove.json()).toMatchObject({
      error: { code: "ELEMENT_LOCKED" },
    });
    const lockedMoveReplay = await app.inject({
      method: "PATCH",
      url: `/api/v1/elements/${target.element.id}`,
      payload: lockedMovePayload,
    });
    expect(lockedMoveReplay.json()).toEqual(lockedMove.json());

    const unlocked = await app.inject({
      method: "PATCH",
      url: `/api/v1/elements/${target.element.id}`,
      payload: {
        expectedRevision: lockedBody.entry.element.revision,
        expectedLayoutRevision: lockedBody.layoutRevision,
        expectedProjectRevision: lockedBody.projectRevision,
        idempotencyKey: `unlock-${randomUUID()}`,
        change: { kind: "LOCK", locked: false },
      },
    });
    expect(unlocked.statusCode, unlocked.body).toBe(200);
    const unlockedBody = unlocked.json() as {
      readonly entry: ElementEntryDto;
      readonly layoutRevision: number;
      readonly projectRevision: number;
    };

    const arrowMove = await app.inject({
      method: "PATCH",
      url: `/api/v1/elements/${target.element.id}`,
      payload: {
        expectedRevision: unlockedBody.entry.element.revision,
        expectedLayoutRevision: unlockedBody.layoutRevision,
        expectedProjectRevision: unlockedBody.projectRevision,
        idempotencyKey: `arrow-${randomUUID()}`,
        change: {
          kind: "MOVE",
          x: unlockedBody.entry.layout.x + 1,
          y: unlockedBody.entry.layout.y,
        },
      },
    });
    expect(arrowMove.statusCode, arrowMove.body).toBe(200);
    const arrowBody = arrowMove.json() as {
      readonly entry: ElementEntryDto;
      readonly layoutRevision: number;
      readonly projectRevision: number;
    };
    expect(arrowBody.entry.layout.x).toBe(unlockedBody.entry.layout.x + 1);
    const shiftMove = await app.inject({
      method: "PATCH",
      url: `/api/v1/elements/${target.element.id}`,
      payload: {
        expectedRevision: arrowBody.entry.element.revision,
        expectedLayoutRevision: arrowBody.layoutRevision,
        expectedProjectRevision: arrowBody.projectRevision,
        idempotencyKey: `shift-arrow-${randomUUID()}`,
        change: {
          kind: "MOVE",
          x: arrowBody.entry.layout.x,
          y: arrowBody.entry.layout.y - 4,
        },
      },
    });
    expect(shiftMove.statusCode, shiftMove.body).toBe(200);
    const shiftBody = shiftMove.json() as {
      readonly entry: ElementEntryDto;
      readonly layoutRevision: number;
      readonly projectRevision: number;
    };
    expect(shiftBody.entry.layout.y).toBe(arrowBody.entry.layout.y - 4);

    const deletePayload = {
      expectedRevision: shiftBody.entry.element.revision,
      expectedLayoutRevision: shiftBody.layoutRevision,
      expectedProjectRevision: shiftBody.projectRevision,
      idempotencyKey: `delete-${randomUUID()}`,
    };
    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/v1/elements/${target.element.id}`,
      payload: deletePayload,
    });
    expect(deleted.statusCode, deleted.body).toBe(200);
    const deleteReplay = await app.inject({
      method: "DELETE",
      url: `/api/v1/elements/${target.element.id}`,
      payload: deletePayload,
    });
    expect(deleteReplay.statusCode, deleteReplay.body).toBe(200);
    expect(deleteReplay.json()).toEqual(deleted.json());
    const deleteConflict = await app.inject({
      method: "DELETE",
      url: `/api/v1/elements/${target.element.id}`,
      payload: { ...deletePayload, expectedProjectRevision: 999 },
    });
    expect(deleteConflict.statusCode).toBe(409);
    expect(deleteConflict.json()).toMatchObject({
      error: { code: "IDEMPOTENCY_PAYLOAD_CONFLICT" },
    });
  });

  it("fails closed for expired, stale, cross-Page, missing, and geometry-tampered candidates", async () => {
    const current = fixture();
    let clock = Date.parse("2026-08-16T00:00:00.000Z");
    const app = buildServer({
      metadataDatabasePath: current.databasePath,
      storageRoot: current.storageRoot,
      clock: () => new Date(clock),
    });
    apps.push(app);
    const project = await createProject(
      app,
      "Candidate Guards",
      "candidate-guards",
    );
    const firstPage = await createPage(
      app,
      project.id,
      project.revision,
      "First",
    );
    const secondPage = await createPage(
      app,
      project.id,
      firstPage.projectRevision,
      "Second",
    );

    const candidateFor = async () => {
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/pages/${firstPage.page.id}/placement-candidates`,
        payload: {
          elementType: "button",
          pointer: {
            rawCanvasX: 200,
            rawCanvasY: 100,
            correctedCanvasX: 200,
            correctedCanvasY: 100,
          },
          canvasWidth: 1_000,
          canvasHeight: 800,
          expectedLayoutRevision: 0,
          expectedProjectRevision: secondPage.projectRevision,
        },
      });
      expect(response.statusCode, response.body).toBe(200);
      return (response.json() as { candidate: { candidateId: string } })
        .candidate;
    };

    const crossCandidate = await candidateFor();
    const crossPage = await app.inject({
      method: "POST",
      url: `/api/v1/pages/${secondPage.page.id}/elements/from-placement`,
      payload: {
        candidateId: crossCandidate.candidateId,
        expectedLayoutRevision: 0,
        expectedProjectRevision: secondPage.projectRevision,
        idempotencyKey: `cross-${randomUUID()}`,
      },
    });
    expect(crossPage.statusCode).toBe(409);
    expect(crossPage.json()).toMatchObject({
      error: { code: "PLACEMENT_CANDIDATE_PAGE_MISMATCH" },
    });

    const missing = await app.inject({
      method: "POST",
      url: `/api/v1/pages/${firstPage.page.id}/elements/from-placement`,
      payload: {
        candidateId: randomUUID(),
        expectedLayoutRevision: 0,
        expectedProjectRevision: secondPage.projectRevision,
        idempotencyKey: `missing-${randomUUID()}`,
      },
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({
      error: { code: "PLACEMENT_CANDIDATE_NOT_FOUND" },
    });

    const expiredCandidate = await candidateFor();
    clock += 15_001;
    const expired = await app.inject({
      method: "POST",
      url: `/api/v1/pages/${firstPage.page.id}/elements/from-placement`,
      payload: {
        candidateId: expiredCandidate.candidateId,
        expectedLayoutRevision: 0,
        expectedProjectRevision: secondPage.projectRevision,
        idempotencyKey: `expired-${randomUUID()}`,
      },
    });
    expect(expired.statusCode).toBe(409);
    expect(expired.json()).toMatchObject({
      error: { code: "PLACEMENT_CANDIDATE_EXPIRED" },
    });

    const staleCandidate = await candidateFor();
    const inserted = await directCreate(
      app,
      firstPage.page.id,
      "text",
      0,
      secondPage.projectRevision,
    );
    const stale = await app.inject({
      method: "POST",
      url: `/api/v1/pages/${firstPage.page.id}/elements/from-placement`,
      payload: {
        candidateId: staleCandidate.candidateId,
        expectedLayoutRevision: inserted.layoutRevision,
        expectedProjectRevision: inserted.projectRevision,
        idempotencyKey: `stale-${randomUUID()}`,
      },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({
      error: { code: "PLACEMENT_CANDIDATE_STALE" },
    });

    const tampered = await app.inject({
      method: "POST",
      url: `/api/v1/pages/${firstPage.page.id}/elements/from-placement`,
      payload: {
        candidateId: staleCandidate.candidateId,
        expectedLayoutRevision: inserted.layoutRevision,
        expectedProjectRevision: inserted.projectRevision,
        idempotencyKey: `tampered-${randomUUID()}`,
        x: 23,
      },
    });
    expect(tampered.statusCode).toBe(400);
    expect(tampered.json()).toMatchObject({
      error: { code: "UNKNOWN_REQUEST_FIELD", details: { fields: ["x"] } },
    });
  });

  it("keeps Draft/Published isolation and remaps Element ownership across lifecycle copies", async () => {
    const current = fixture();
    const app = server(current);
    const project = await createProject(
      app,
      "Lifecycle Elements",
      "lifecycle-elements",
    );
    const page = await createPage(app, project.id, project.revision);
    const created = await directCreate(
      app,
      page.page.id,
      "kpi-card",
      0,
      page.projectRevision,
    );

    const publish = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/publish`,
      payload: {
        expectedProjectRevision: created.projectRevision,
        idempotencyKey: `publish-${randomUUID()}`,
      },
    });
    expect(publish.statusCode, publish.body).toBe(200);
    const publishBody = publish.json() as { readonly projectRevision: number };
    const inspection = new Database(current.databasePath, { readonly: true });
    const publishedBefore = (
      inspection
        .prepare(
          "SELECT snapshot_json FROM project_versions WHERE project_id = ? ORDER BY sequence DESC LIMIT 1",
        )
        .get(project.id) as { readonly snapshot_json: string }
    ).snapshot_json;
    expect(JSON.parse(publishedBefore)).toMatchObject({
      elements: [
        {
          element: { id: created.entry.element.id, projectId: project.id },
          layout: { elementId: created.entry.element.id },
        },
      ],
    });
    inspection.close();

    const moved = await app.inject({
      method: "PATCH",
      url: `/api/v1/elements/${created.entry.element.id}`,
      payload: {
        expectedRevision: created.entry.element.revision,
        expectedLayoutRevision: created.layoutRevision,
        expectedProjectRevision: publishBody.projectRevision,
        idempotencyKey: `draft-move-${randomUUID()}`,
        change: { kind: "MOVE", x: 10, y: 40 },
      },
    });
    expect(moved.statusCode, moved.body).toBe(200);
    const movedBody = moved.json() as {
      readonly entry: ElementEntryDto;
      readonly layoutRevision: number;
      readonly projectRevision: number;
    };
    const immutableCheck = new Database(current.databasePath, {
      readonly: true,
    });
    expect(
      (
        immutableCheck
          .prepare(
            "SELECT snapshot_json FROM project_versions WHERE project_id = ? ORDER BY sequence DESC LIMIT 1",
          )
          .get(project.id) as { readonly snapshot_json: string }
      ).snapshot_json,
    ).toBe(publishedBefore);
    immutableCheck.close();

    const exportedResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/export`,
    });
    expect(exportedResponse.statusCode, exportedResponse.body).toBe(200);
    const exported = (exportedResponse.json() as { readonly export: unknown })
      .export;
    const clonedResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/clone`,
      payload: { name: "Element Clone", slug: "element-clone" },
    });
    expect(clonedResponse.statusCode, clonedResponse.body).toBe(201);
    const clone = (clonedResponse.json() as { readonly project: ProjectDto })
      .project;
    const importedResponse = await app.inject({
      method: "POST",
      url: "/api/v1/projects/import",
      payload: {
        export: exported,
        name: "Element Import",
        slug: "element-import",
      },
    });
    expect(importedResponse.statusCode, importedResponse.body).toBe(201);
    const imported = (
      importedResponse.json() as { readonly project: ProjectDto }
    ).project;

    for (const copied of [clone, imported]) {
      const pagesResponse = await app.inject({
        method: "GET",
        url: `/api/v1/projects/${copied.id}/pages`,
      });
      const copiedPage = (
        pagesResponse.json() as { readonly pages: readonly PageDto[] }
      ).pages[0] as PageDto;
      const elements = await listElements(app, copiedPage.id);
      expect(elements.elements).toHaveLength(1);
      expect(elements.elements[0]?.element).toMatchObject({
        projectId: copied.id,
        pageId: copiedPage.id,
      });
      expect(elements.elements[0]?.element.id).not.toBe(
        created.entry.element.id,
      );
      expect(elements.elements[0]?.layout).toMatchObject({
        x: movedBody.entry.layout.x,
        y: movedBody.entry.layout.y,
        w: movedBody.entry.layout.w,
        h: movedBody.entry.layout.h,
        minW: movedBody.entry.layout.minW,
        minH: movedBody.entry.layout.minH,
        maxW: movedBody.entry.layout.maxW,
        maxH: movedBody.entry.layout.maxH,
      });
    }

    const cloneTrash = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${clone.id}/trash`,
      payload: {
        expectedRevision: clone.revision,
        expectedLifecycleRevision: clone.lifecycleRevision,
        idempotencyKey: `clone-trash-${randomUUID()}`,
      },
    });
    expect(cloneTrash.statusCode, cloneTrash.body).toBe(200);
    const cloneTrashed = (cloneTrash.json() as { project: ProjectDto }).project;
    const purgePlan = await app.inject({
      method: "POST",
      url: `/api/v1/recycle-bin/projects/${clone.id}/purge-plan`,
      payload: { expectedLifecycleRevision: cloneTrashed.lifecycleRevision },
    });
    expect(purgePlan.statusCode, purgePlan.body).toBe(200);
    const plan = (
      purgePlan.json() as {
        plan: { purgePlanId: string; typedConfirmation: string };
      }
    ).plan;
    const purge = await app.inject({
      method: "DELETE",
      url: `/api/v1/recycle-bin/projects/${clone.id}`,
      payload: {
        purgePlanId: plan.purgePlanId,
        expectedLifecycleRevision: cloneTrashed.lifecycleRevision,
        typedConfirmation: plan.typedConfirmation,
        idempotencyKey: `clone-purge-${randomUUID()}`,
        backupBeforePurge: false,
      },
    });
    expect(purge.statusCode, purge.body).toBe(200);
    const purgedMetadata = new Database(current.databasePath, {
      readonly: true,
    });
    for (const table of [
      "pages",
      "page_layout_revisions",
      "elements",
      "element_layouts",
      "element_commands",
      "project_versions",
    ]) {
      expect(
        (
          purgedMetadata
            .prepare(
              `SELECT count(*) AS count FROM ${table} WHERE project_id = ?`,
            )
            .get(clone.id) as { count: number }
        ).count,
        table,
      ).toBe(0);
    }
    purgedMetadata.close();
    expect(existsSync(join(current.storageRoot, "active", clone.id))).toBe(
      false,
    );
    expect(existsSync(join(current.storageRoot, "trash", clone.id))).toBe(
      false,
    );
    expect(existsSync(join(current.storageRoot, "active", project.id))).toBe(
      true,
    );
    expect(existsSync(join(current.storageRoot, "active", imported.id))).toBe(
      true,
    );

    const trash = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/trash`,
      payload: {
        expectedRevision: movedBody.projectRevision,
        expectedLifecycleRevision: project.lifecycleRevision,
        idempotencyKey: `trash-${randomUUID()}`,
      },
    });
    expect(trash.statusCode, trash.body).toBe(200);
    const trashed = (trash.json() as { readonly project: ProjectDto }).project;
    const inactiveElements = await app.inject({
      method: "GET",
      url: `/api/v1/pages/${page.page.id}/elements`,
    });
    expect(inactiveElements.statusCode).toBe(409);
    expect(inactiveElements.json()).toMatchObject({
      error: { code: "PROJECT_NOT_ACTIVE" },
    });
    const inactiveCandidate = await app.inject({
      method: "POST",
      url: `/api/v1/pages/${page.page.id}/placement-candidates`,
      payload: {
        elementType: "text",
        pointer: {
          rawCanvasX: 16,
          rawCanvasY: 16,
          correctedCanvasX: 16,
          correctedCanvasY: 16,
        },
        canvasWidth: 1_000,
        canvasHeight: 800,
        expectedLayoutRevision: movedBody.layoutRevision,
        expectedProjectRevision: movedBody.projectRevision,
      },
    });
    expect(inactiveCandidate.statusCode).toBe(409);
    expect(inactiveCandidate.json()).toMatchObject({
      error: { code: "PROJECT_NOT_ACTIVE" },
    });
    const tamperDatabase = new Database(current.databasePath);
    tamperDatabase
      .prepare("UPDATE elements SET name = 'Tampered' WHERE id = ?")
      .run(created.entry.element.id);
    tamperDatabase.close();
    const checksumBlocked = await app.inject({
      method: "POST",
      url: `/api/v1/recycle-bin/projects/${project.id}/restore`,
      payload: {
        expectedLifecycleRevision: trashed.lifecycleRevision,
        idempotencyKey: `restore-tampered-${randomUUID()}`,
        conflictResolution: "KEEP_ORIGINAL",
      },
    });
    expect(checksumBlocked.statusCode).toBe(409);
    expect(checksumBlocked.json()).toMatchObject({
      error: { code: "TRASH_PAGE_DEFINITION_CHECKSUM_MISMATCH" },
    });
    const repairDatabase = new Database(current.databasePath);
    repairDatabase
      .prepare("UPDATE elements SET name = ? WHERE id = ?")
      .run(created.entry.element.name, created.entry.element.id);
    repairDatabase.close();
    const restore = await app.inject({
      method: "POST",
      url: `/api/v1/recycle-bin/projects/${project.id}/restore`,
      payload: {
        expectedLifecycleRevision: trashed.lifecycleRevision,
        idempotencyKey: `restore-${randomUUID()}`,
        conflictResolution: "KEEP_ORIGINAL",
      },
    });
    expect(restore.statusCode, restore.body).toBe(200);
    const restoredElements = await listElements(app, page.page.id);
    expect(restoredElements.elements[0]).toEqual(movedBody.entry);

    const deletePlan = await app.inject({
      method: "POST",
      url: `/api/v1/pages/${page.page.id}/delete-plan`,
      payload: {
        expectedRevision: page.page.revision,
        expectedProjectRevision: movedBody.projectRevision,
      },
    });
    expect(deletePlan.statusCode, deletePlan.body).toBe(200);
    expect(deletePlan.json()).toMatchObject({ impact: { elementCount: 1 } });

    const deletePage = await app.inject({
      method: "DELETE",
      url: `/api/v1/pages/${page.page.id}`,
      payload: {
        expectedRevision: page.page.revision,
        expectedProjectRevision: movedBody.projectRevision,
        idempotencyKey: `delete-page-${randomUUID()}`,
        resolution: "DELETE_DEPENDENCIES",
      },
    });
    expect(deletePage.statusCode, deletePage.body).toBe(200);
    const deletePageBody = deletePage.json() as {
      commandId: string;
      projectRevision: number;
    };
    const hiddenByPageDelete = await app.inject({
      method: "GET",
      url: `/api/v1/pages/${page.page.id}/elements`,
    });
    expect(hiddenByPageDelete.statusCode).toBe(404);
    const undoPage = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/pages/commands/${deletePageBody.commandId}/undo`,
      payload: {
        expectedProjectRevision: deletePageBody.projectRevision,
        idempotencyKey: `undo-page-${randomUUID()}`,
      },
    });
    expect(undoPage.statusCode, undoPage.body).toBe(200);
    expect(undoPage.json()).toMatchObject({ page: { id: page.page.id } });
    const elementsAfterUndo = await listElements(app, page.page.id);
    expect(elementsAfterUndo.elements).toEqual([movedBody.entry]);
    expect(elementsAfterUndo.layoutRevision).toBe(movedBody.layoutRevision);
  });
});
