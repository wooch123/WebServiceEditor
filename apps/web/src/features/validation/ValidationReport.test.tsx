import type { ValidationRunDto } from "@webeditor/domain";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ValidationReport } from "./ValidationReport";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const projectId = "00000000-0000-4000-8000-000000000016";

function run(overrides: Partial<ValidationRunDto> = {}): ValidationRunDto {
  return {
    id: "10000000-0000-4000-8000-000000000016",
    projectId,
    projectRevision: 4,
    levels: ["STATIC", "REFERENCE", "DATABASE", "BINDING", "INVENTORY"],
    status: "FAIL",
    inventoryRequired: 240,
    inventoryVerified: 240,
    summary: { pass: 240, warning: 0, fail: 1, blocked: 0 },
    issues: [
      {
        id: "20000000-0000-4000-8000-000000000016",
        ruleId: "PAGE_ROUTE_INVALID",
        level: "REFERENCE",
        result: "FAIL",
        title: "페이지 Route",
        detail: "Route가 중복입니다.",
        target: {
          kind: "PAGE",
          projectId,
          pageId: "30000000-0000-4000-8000-000000000016",
        },
      },
    ],
    inventory: [],
    startedAt: "2026-08-16T00:00:00.000Z",
    completedAt: "2026-08-16T00:00:01.000Z",
    ...overrides,
  };
}

function response(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

describe("ValidationReport", () => {
  it("loads the latest durable report and navigates from an issue to its Page", async () => {
    const latest = run();
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      response({ projectId, runs: [latest] }),
    );
    const onNavigate = vi.fn();
    const user = userEvent.setup();

    render(
      <ValidationReport
        projectId={projectId}
        projectRevision={4}
        onNavigate={onNavigate}
      />,
    );

    expect(await screen.findByText("페이지 Route")).toBeVisible();
    expect(screen.getByText("240/240")).toBeVisible();
    await user.click(screen.getByRole("button", { name: /페이지 Route/u }));
    expect(onNavigate).toHaveBeenCalledWith(latest.issues[0]?.target);
  });

  it("runs full and inventory validation with sibling action geometry", async () => {
    const pass = run({
      status: "PASS",
      issues: [],
      summary: { pass: 240, warning: 0, fail: 0, blocked: 0 },
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(() => response({ projectId, runs: [] }))
      .mockImplementation(() => response(pass));
    const user = userEvent.setup();

    render(
      <ValidationReport
        projectId={projectId}
        projectRevision={4}
        onNavigate={vi.fn()}
      />,
    );
    const inventory = await screen.findByRole("button", { name: "목록" });
    const execute = screen.getByRole("button", { name: "실행" });
    expect(inventory).toHaveClass("validation-action");
    expect(execute).toHaveClass("validation-action");

    await user.click(inventory);
    await screen.findByText("오류 없음");
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe(
      `/api/v1/projects/${projectId}/validate-inventory`,
    );
    await user.click(execute);
    await waitFor(() =>
      expect(fetchMock.mock.calls.at(-1)?.[0]).toBe(
        `/api/v1/projects/${projectId}/validate`,
      ),
    );
    const request = fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toMatchObject({
      expectedProjectRevision: 4,
    });
  });

  it("keeps server errors visible and allows a retry", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockImplementationOnce(() => response({ projectId, runs: [] }))
      .mockImplementationOnce(() =>
        response(
          {
            error: { code: "PROJECT_REVISION_CONFLICT", message: "최신 상태" },
          },
          409,
        ),
      )
      .mockImplementationOnce(() =>
        response(run({ status: "PASS", issues: [] })),
      );
    const user = userEvent.setup();
    render(
      <ValidationReport
        projectId={projectId}
        projectRevision={4}
        onNavigate={vi.fn()}
      />,
    );
    const execute = await screen.findByRole("button", { name: "실행" });
    await user.click(execute);
    expect(await screen.findByText("최신 상태")).toBeVisible();
    await user.click(execute);
    expect((await screen.findAllByText("통과")).length).toBeGreaterThan(0);
  });
});
