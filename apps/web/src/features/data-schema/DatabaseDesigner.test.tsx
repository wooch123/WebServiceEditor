import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  DataFieldDto,
  DataSchemaDto,
  DataTableDto,
  SchemaMigrationPlanDto,
} from "@/services/data-schema-api";
import { DatabaseDesigner } from "./DatabaseDesigner";

const projectId = "00000000-0000-4000-8000-000000000801";
const tableId = "00000000-0000-4000-8000-000000000802";
const fieldId = "00000000-0000-4000-8000-000000000803";

const field: DataFieldDto = {
  id: fieldId,
  projectId,
  tableId,
  displayName: "ID",
  physicalName: `c_${"a".repeat(32)}`,
  type: "TEXT",
  primaryKey: true,
  autoIncrement: false,
  nullable: false,
  unique: false,
  defaultValue: null,
  indexed: false,
  unit: null,
  description: null,
  sortOrder: 0,
  revision: 1,
  createdAt: "2026-08-16T00:00:00.000Z",
  updatedAt: "2026-08-16T00:00:00.000Z",
};

const table: DataTableDto = {
  id: tableId,
  projectId,
  displayName: "환자",
  physicalName: `t_${"b".repeat(32)}`,
  description: null,
  revision: 1,
  rowCount: 0,
  fields: [field],
  createdAt: "2026-08-16T00:00:00.000Z",
  updatedAt: "2026-08-16T00:00:00.000Z",
};

function schema(tables: readonly DataTableDto[] = []): DataSchemaDto {
  return {
    schemaVersion: 1,
    projectId,
    schemaRevision: tables.length === 0 ? 0 : 1,
    projectRevision: tables.length === 0 ? 1 : 2,
    tables,
    relations: [],
    runtime: {
      test: {
        environment: "test",
        appliedRevision: 0,
        schemaChecksum: null,
        drift: tables.length > 0,
        integrity: "ok",
      },
      production: {
        environment: "production",
        appliedRevision: 0,
        schemaChecksum: null,
        drift: tables.length > 0,
        integrity: "ok",
      },
    },
  };
}

const plan: SchemaMigrationPlanDto = {
  id: "00000000-0000-4000-8000-000000000804",
  projectId,
  target: "test",
  schemaRevision: 1,
  projectRevision: 2,
  schemaChecksum: "c".repeat(64),
  status: "READY",
  impact: {
    destructive: false,
    droppedTableCount: 0,
    droppedFieldCount: 0,
    affectedRowCount: 0,
    relationCount: 0,
  },
  steps: [
    {
      order: 1,
      kind: "CREATE_TABLE",
      tableId,
      label: "Create 환자",
      destructive: false,
      affectedRows: 0,
    },
  ],
  createdAt: "2026-08-16T00:00:00.000Z",
  expiresAt: "2026-08-16T00:05:00.000Z",
};

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("DatabaseDesigner", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
    HTMLElement.prototype.setPointerCapture = vi.fn();
    HTMLElement.prototype.releasePointerCapture = vi.fn();
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => cleanup());

  it("loads the isolated runtime state and creates a server-owned Table from a GUI form", async () => {
    const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input);
        if (init?.method === "POST") {
          requests.push({
            path,
            body: JSON.parse(String(init.body)) as Record<string, unknown>,
          });
          return json(schema([table]), 201);
        }
        return json(schema());
      }),
    );
    const onRevision = vi.fn();
    const user = userEvent.setup();
    render(
      <DatabaseDesigner
        projectId={projectId}
        projectRevision={1}
        onProjectRevisionChange={onRevision}
      />,
    );
    expect(await screen.findByText("테이블 없음")).toBeVisible();
    expect(screen.getByText("Test").parentElement).toHaveTextContent("일치");

    await user.click(screen.getAllByRole("button", { name: "테이블" })[0]!);
    await user.type(screen.getByLabelText("이름"), "환자");
    const dialog = screen.getByRole("dialog", { name: "테이블 추가" });
    await user.click(within(dialog).getByRole("button", { name: "추가" }));
    expect(await screen.findByRole("option", { name: /환자/ })).toBeVisible();
    expect(requests[0]).toMatchObject({
      path: `/api/v1/projects/${projectId}/tables`,
      body: {
        displayName: "환자",
        template: "BLANK",
        expectedSchemaRevision: 0,
        expectedProjectRevision: 1,
      },
    });
    expect(requests[0]?.body.idempotencyKey).toEqual(expect.any(String));
    expect(requests[0]?.body).not.toHaveProperty("physicalName");
    expect(onRevision).toHaveBeenLastCalledWith(2);
  });

  it("loads once when parent revision and callback identities change", async () => {
    const request = vi.fn(async () => json(schema([table])));
    vi.stubGlobal("fetch", request);
    const firstRevision = vi.fn();
    const view = render(
      <DatabaseDesigner
        projectId={projectId}
        projectRevision={1}
        onProjectRevisionChange={firstRevision}
      />,
    );
    await screen.findByRole("table", { name: "환자 필드" });
    expect(request).toHaveBeenCalledTimes(1);

    const nextRevision = vi.fn();
    view.rerender(
      <DatabaseDesigner
        projectId={projectId}
        projectRevision={2}
        onProjectRevisionChange={nextRevision}
      />,
    );
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    expect(nextRevision).not.toHaveBeenCalled();
  });

  it("adds a typed Field and preserves equal geometry classes for same-level actions", async () => {
    const nextField: DataFieldDto = {
      ...field,
      id: "00000000-0000-4000-8000-000000000805",
      displayName: "점수",
      physicalName: `c_${"d".repeat(32)}`,
      type: "REAL",
      primaryKey: false,
      nullable: true,
      indexed: true,
      sortOrder: 1,
    };
    let sent: Record<string, unknown> | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes("/fields") && init?.method === "POST") {
          sent = JSON.parse(String(init.body)) as Record<string, unknown>;
          return json(schema([{ ...table, fields: [field, nextField] }]));
        }
        return json(schema([table]));
      }),
    );
    const user = userEvent.setup();
    const { container } = render(
      <DatabaseDesigner
        projectId={projectId}
        projectRevision={2}
        onProjectRevisionChange={vi.fn()}
      />,
    );
    expect(
      await screen.findByRole("table", { name: "환자 필드" }),
    ).toBeVisible();
    const headerActions = container.querySelectorAll(
      ".schema-header-actions > button",
    );
    expect(headerActions).toHaveLength(3);
    expect(
      [...headerActions].every((control) => control.className.includes("h-8")),
    ).toBe(true);
    await user.click(screen.getByRole("button", { name: "필드" }));
    await user.type(screen.getByLabelText("이름"), "점수");
    await user.click(screen.getByLabelText("형식"));
    await user.click(screen.getByRole("option", { name: "REAL" }));
    await user.click(screen.getByLabelText("인덱스"));
    await user.click(
      within(screen.getByRole("dialog", { name: "필드 추가" })).getByRole(
        "button",
        { name: "추가" },
      ),
    );
    expect(await screen.findByText("점수")).toBeVisible();
    expect(sent).toMatchObject({
      displayName: "점수",
      type: "REAL",
      nullable: true,
      indexed: true,
      expectedSchemaRevision: 1,
      expectedProjectRevision: 2,
    });
  });

  it("renames display labels without sending or changing physical names", async () => {
    let current = schema([table]);
    const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input);
        if (init?.method === "PATCH") {
          const body = JSON.parse(String(init.body)) as Record<string, unknown>;
          requests.push({ path, body });
          if (path.endsWith(`/tables/${tableId}`)) {
            current = {
              ...current,
              schemaRevision: 2,
              projectRevision: 3,
              tables: [{ ...table, displayName: "고객", revision: 2 }],
            };
          } else {
            current = {
              ...current,
              schemaRevision: 3,
              projectRevision: 4,
              tables: [
                {
                  ...table,
                  displayName: "고객",
                  revision: 2,
                  fields: [{ ...field, displayName: "키", revision: 2 }],
                },
              ],
            };
          }
          return json(current);
        }
        return json(current);
      }),
    );
    const user = userEvent.setup();
    render(
      <DatabaseDesigner
        projectId={projectId}
        projectRevision={2}
        onProjectRevisionChange={vi.fn()}
      />,
    );
    await screen.findByRole("table", { name: "환자 필드" });

    await user.click(screen.getByRole("button", { name: "이름" }));
    const tableDialog = screen.getByRole("dialog", { name: "테이블 이름" });
    const tableName = within(tableDialog).getByLabelText("이름");
    await user.clear(tableName);
    await user.type(tableName, "고객");
    await user.click(within(tableDialog).getByRole("button", { name: "저장" }));
    expect(
      await screen.findByRole("table", { name: "고객 필드" }),
    ).toBeVisible();

    await user.click(screen.getByRole("button", { name: "ID 이름 변경" }));
    const fieldDialog = screen.getByRole("dialog", { name: "필드 이름" });
    const fieldName = within(fieldDialog).getByLabelText("이름");
    await user.clear(fieldName);
    await user.type(fieldName, "키");
    await user.click(within(fieldDialog).getByRole("button", { name: "저장" }));
    expect(await screen.findByText("키")).toBeVisible();

    expect(requests).toEqual([
      {
        path: `/api/v1/tables/${tableId}`,
        body: expect.objectContaining({
          displayName: "고객",
          expectedRevision: 1,
          expectedSchemaRevision: 1,
          expectedProjectRevision: 2,
        }),
      },
      {
        path: `/api/v1/fields/${fieldId}`,
        body: expect.objectContaining({
          displayName: "키",
          expectedRevision: 1,
          expectedSchemaRevision: 2,
          expectedProjectRevision: 3,
        }),
      },
    ]);
    for (const request of requests) {
      expect(request.body).not.toHaveProperty("physicalName");
    }
    expect(current.tables[0]?.physicalName).toBe(table.physicalName);
    expect(current.tables[0]?.fields[0]?.physicalName).toBe(field.physicalName);
  });

  it("previews impact and applies the exact server-issued plan after a verified backup", async () => {
    const methods: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input);
        methods.push(`${init?.method ?? "GET"} ${path}`);
        if (path.endsWith("/schema/plan")) return json({ plan });
        if (path.endsWith("/schema/apply")) {
          return json({
            plan: { ...plan, status: "APPLIED" },
            schema: {
              ...schema([table]),
              runtime: {
                ...schema([table]).runtime,
                test: {
                  ...schema([table]).runtime.test,
                  appliedRevision: 1,
                  schemaChecksum: plan.schemaChecksum,
                  drift: false,
                },
              },
            },
            backupId: "00000000-0000-4000-8000-000000000806",
            backupChecksum: "e".repeat(64),
            databaseChecksum: "f".repeat(64),
            rowCountBefore: 0,
            rowCountAfter: 0,
            integrity: "ok",
          });
        }
        return json(schema([table]));
      }),
    );
    const user = userEvent.setup();
    render(
      <DatabaseDesigner
        projectId={projectId}
        projectRevision={2}
        onProjectRevisionChange={vi.fn()}
      />,
    );
    await screen.findByRole("table", { name: "환자 필드" });
    await user.click(screen.getByRole("button", { name: "적용 계획" }));
    const alert = await screen.findByRole("alertdialog", {
      name: "Test DB 적용",
    });
    expect(within(alert).getByText("Create 환자")).toBeVisible();
    const actions = within(alert).getAllByRole("button");
    expect(actions).toHaveLength(2);
    expect(actions.every((control) => control.className.includes("h-8"))).toBe(
      true,
    );
    expect(actions[0]?.parentElement).toHaveClass("schema-dialog-actions");
    await user.click(within(alert).getByRole("button", { name: "적용" }));
    await waitFor(() =>
      expect(screen.getByText("Test").parentElement).toHaveTextContent("일치"),
    );
    expect(methods).toContain(`POST /api/v1/projects/${projectId}/schema/plan`);
    expect(methods).toContain(
      `POST /api/v1/projects/${projectId}/schema/apply`,
    );
  });

  it("keeps physical deletion behind a second migration impact confirmation", async () => {
    let current = schema([table]);
    const destructivePlan: SchemaMigrationPlanDto = {
      ...plan,
      impact: {
        destructive: true,
        droppedTableCount: 1,
        droppedFieldCount: 1,
        affectedRowCount: 12,
        relationCount: 0,
      },
      steps: [
        {
          order: 1,
          kind: "DROP_TABLE",
          tableId: null,
          label: "Remove table",
          destructive: true,
          affectedRows: 12,
        },
      ],
    };
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input);
        if (init?.body)
          bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        if (path.endsWith(`/tables/${tableId}`) && init?.method === "DELETE") {
          current = { ...schema(), schemaRevision: 2, projectRevision: 3 };
          return json(current);
        }
        if (path.endsWith("/schema/plan"))
          return json({ plan: destructivePlan });
        return json(current);
      }),
    );
    const user = userEvent.setup();
    render(
      <DatabaseDesigner
        projectId={projectId}
        projectRevision={2}
        onProjectRevisionChange={vi.fn()}
      />,
    );
    await screen.findByRole("table", { name: "환자 필드" });
    await user.click(screen.getByRole("button", { name: "환자 삭제" }));
    const metadataDelete = await screen.findByRole("alertdialog", {
      name: "테이블 삭제",
    });
    expect(metadataDelete).toHaveTextContent("실제 행 삭제는 적용 계획");
    await user.click(
      within(metadataDelete).getByRole("button", { name: "삭제" }),
    );
    await screen.findByText("테이블 없음");
    await user.click(screen.getByRole("button", { name: "적용 계획" }));
    const impact = await screen.findByRole("alertdialog", {
      name: "Test DB 적용",
    });
    expect(impact).toHaveTextContent("삭제 테이블 1");
    expect(impact).toHaveTextContent("영향 행 12");
    expect(bodies[0]).toMatchObject({
      expectedSchemaRevision: 1,
      expectedProjectRevision: 2,
    });
  });
});
