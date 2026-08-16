import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { describe, expect, it, vi } from "vitest";

import { AuthBoundary } from "./AuthBoundary";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("AuthBoundary", () => {
  it("renders an accessible login and opens the authenticated application", async () => {
    const requests: Array<{ url: string; credentials?: RequestCredentials }> =
      [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({
          url: String(input),
          ...(init?.credentials === undefined
            ? {}
            : { credentials: init.credentials }),
        });
        if (String(input).endsWith("/session")) {
          return json({
            session: {
              authenticationRequired: true,
              authenticated: false,
              username: null,
              expiresAt: null,
            },
          });
        }
        return json({
          session: {
            authenticationRequired: true,
            authenticated: true,
            username: "admin",
            expiresAt: "2026-08-16T12:00:00.000Z",
          },
        });
      }),
    );

    const { container } = render(
      <AuthBoundary>
        <div>프로젝트</div>
      </AuthBoundary>,
    );
    expect(
      await screen.findByRole("heading", { name: "로그인" }),
    ).toBeVisible();
    expect(screen.getByLabelText("아이디")).toHaveValue("admin");
    expect(screen.getByLabelText("비밀번호")).toHaveAttribute(
      "autocomplete",
      "current-password",
    );
    expect((await axe.run(container)).violations).toEqual([]);

    await userEvent.type(screen.getByLabelText("비밀번호"), "safe password");
    await userEvent.click(screen.getByRole("button", { name: "로그인" }));
    expect(await screen.findByText("프로젝트")).toBeVisible();
    expect(screen.getByRole("button", { name: "로그아웃" })).toBeVisible();
    expect(
      requests.every((request) => request.credentials === "same-origin"),
    ).toBe(true);
  });

  it("passes through local mode and exposes retry after a session failure", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(
        json({
          session: {
            authenticationRequired: false,
            authenticated: true,
            username: "local",
            expiresAt: null,
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    render(
      <AuthBoundary>
        <div>로컬 앱</div>
      </AuthBoundary>,
    );
    expect(await screen.findByText("연결 실패")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    await waitFor(() => expect(screen.getByText("로컬 앱")).toBeVisible());
    expect(screen.queryByRole("button", { name: "로그아웃" })).toBeNull();
  });
});
