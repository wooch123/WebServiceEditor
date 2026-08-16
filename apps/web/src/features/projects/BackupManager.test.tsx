import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ProjectDto } from "@/services/projects-api";
import { BackupManager } from "./BackupManager";

const project: ProjectDto = {
  id: "00000000-0000-4000-8000-000000001701",
  name: "Recovery Source",
  slug: "recovery-source",
  description: null,
  lifecycleStatus: "ACTIVE",
  status: "PUBLISHED",
  schemaVersion: 1,
  revision: 8,
  lifecycleRevision: 0,
  favorite: false,
  themeId: "light-clean-paper",
  createdAt: "2026-08-16T00:00:00.000Z",
  updatedAt: "2026-08-16T00:00:00.000Z",
  counts: { pages: 1, elements: 0, bindings: 0, tables: 0, assets: 1 },
  pageCount: 1,
  elementCount: 0,
  bindingCount: 0,
  tableCount: 0,
  assetCount: 1,
};

const backup = {
  id: "00000000-0000-4000-8000-000000001702",
  sourceProjectId: project.id,
  sourceProjectName: project.name,
  sourceProjectSlug: project.slug,
  sourceProjectRevision: project.revision,
  status: "VERIFIED" as const,
  label: null,
  payloadChecksum: "a".repeat(64),
  contentChecksum: "b".repeat(64),
  fileCount: 4,
  totalBytes: 2048,
  createdAt: "2026-08-16T01:00:00.000Z",
  verifiedAt: "2026-08-16T01:00:00.000Z",
};

const restoredProject: ProjectDto = {
  ...project,
  id: "00000000-0000-4000-8000-000000001703",
  name: "Recovery Source 복원",
  slug: `recovery-source-restore-${backup.id.slice(0, 6)}`,
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("BackupManager", () => {
  it("creates, verifies, and restores a durable backup with equal sibling actions", async () => {
    const requests: { url: string; method: string; body: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        const body =
          typeof init?.body === "string" ? JSON.parse(init.body) : null;
        requests.push({ url, method, body });
        if (url === "/api/v1/backups" && method === "GET") {
          return response({ backups: [] });
        }
        if (
          url === `/api/v1/projects/${project.id}/backups` &&
          method === "POST"
        ) {
          return response({ backup }, 201);
        }
        if (url === `/api/v1/backups/${backup.id}/verify`) {
          return response({
            drill: {
              id: "00000000-0000-4000-8000-000000001704",
              backupId: backup.id,
              status: "PASS",
              payloadChecksum: backup.payloadChecksum,
              contentChecksum: backup.contentChecksum,
              fileCount: backup.fileCount,
              checkedAt: "2026-08-16T02:00:00.000Z",
            },
          });
        }
        if (url === `/api/v1/backups/${backup.id}/restore`) {
          return response(
            {
              restored: {
                backup,
                project: restoredProject,
                sourcePayloadChecksum: backup.payloadChecksum,
                restoredFileCount: backup.fileCount,
                restoredAt: "2026-08-16T03:00:00.000Z",
              },
            },
            201,
          );
        }
        return response({ error: { message: "unexpected request" } }, 500);
      }),
    );
    const onRestored = vi.fn();
    const user = userEvent.setup();
    render(<BackupManager projects={[project]} onRestored={onRestored} />);

    await user.click(await screen.findByRole("button", { name: "백업" }));
    expect(await screen.findByText("Recovery Source 백업 완료")).toBeVisible();
    const row = screen.getByRole("row", { name: /Recovery Source/ });
    const rowActions = within(row).getAllByRole("button");
    expect(rowActions).toHaveLength(2);
    expect(
      rowActions.every((button) =>
        button.classList.contains("backup-row-action"),
      ),
    ).toBe(true);

    await user.click(within(row).getByRole("button", { name: "점검" }));
    expect(await screen.findByText("Recovery Source 점검 통과")).toBeVisible();
    await user.click(within(row).getByRole("button", { name: "복원" }));
    const dialog = screen.getByRole("dialog", { name: "백업 복원" });
    const footerButtons = within(dialog).getAllByRole("button", {
      name: /취소|복원/,
    });
    expect(footerButtons).toHaveLength(2);
    await user.click(within(dialog).getByRole("button", { name: "복원" }));
    await waitFor(() =>
      expect(onRestored).toHaveBeenCalledWith(restoredProject),
    );

    expect(
      requests.find(
        (request) =>
          request.url.endsWith("/backups") && request.method === "POST",
      )?.body,
    ).toMatchObject({ expectedRevision: project.revision });
    expect(
      requests.find((request) => request.url.endsWith("/restore"))?.body,
    ).toMatchObject({
      name: "Recovery Source 복원",
      slug: `recovery-source-restore-${backup.id.slice(0, 6)}`,
    });
  });

  it("shows a retryable load failure without a fake backup list", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response(
          { error: { code: "LOAD_FAILED", message: "백업 저장소 오류" } },
          503,
        ),
      )
      .mockResolvedValueOnce(response({ backups: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<BackupManager projects={[project]} onRestored={vi.fn()} />);
    expect(await screen.findByText("백업 저장소 오류")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(await screen.findByText("백업 없음")).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
