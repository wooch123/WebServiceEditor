import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { App } from "./App";

describe("WebEditor first frontend slice", () => {
  it("renders a product-specific project home and preserves the required control order", () => {
    render(<App />);

    expect(
      screen.getByRole("heading", { name: "분석을 서비스로 이어가세요" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("article")).toHaveLength(3);

    const minus = screen.getByRole("button", { name: "글꼴 크기 줄이기" });
    const size = screen.getByRole("status", { name: "현재 글꼴 크기" });
    const plus = screen.getByRole("button", { name: "글꼴 크기 늘리기" });
    const theme = screen.getByRole("combobox", { name: "테마 선택" });

    expect(
      minus.compareDocumentPosition(size) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      size.compareDocumentPosition(plus) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      plus.compareDocumentPosition(theme) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("changes font size by exactly one pixel and applies a canonical theme immediately", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(screen.getByRole("button", { name: "글꼴 크기 늘리기" }));
    expect(
      screen.getByRole("status", { name: "현재 글꼴 크기" }),
    ).toHaveTextContent("13px");

    await user.selectOptions(
      screen.getByRole("combobox", { name: "테마 선택" }),
      "dark-polar-night",
    );
    const app = container.querySelector(".webeditor-app");
    expect(app).toHaveAttribute("data-theme-id", "dark-polar-night");
    expect(app).toHaveStyle({ "--app-base-font-size": "13px" });
  });

  it("filters projects and opens the editor shell", async () => {
    const user = userEvent.setup();
    render(<App />);

    const search = screen.getByPlaceholderText("프로젝트 이름 또는 설명 검색");
    await user.type(search, "SPC");
    expect(
      screen.getByRole("heading", { name: "품질 관리 SPC 센터" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "지역 건강지표 모니터" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "편집 열기" }));
    expect(
      screen.getByRole("navigation", { name: "제작 단계" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("페이지 캔버스")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "지역 건강지표 개요" }),
    ).toBeInTheDocument();
  });

  it("moves a project through an impact dialog and restores it from the recycle bin", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(
      screen.getByRole("button", {
        name: "설문 분석 워크벤치 휴지통으로 이동",
      }),
    );
    const dialog = screen.getByRole("dialog", {
      name: "휴지통으로 이동할까요?",
    });
    expect(within(dialog).getByText("3")).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole("button", { name: "휴지통으로 이동" }),
    );

    const projectNavigation = screen.getByRole("navigation", {
      name: "프로젝트 홈",
    });
    await user.click(
      within(projectNavigation).getByRole("button", { name: /^휴지통/ }),
    );
    expect(
      screen.getByRole("heading", { name: "설문 분석 워크벤치" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "복원" }));
    expect(screen.getByText("표시할 프로젝트가 없습니다")).toBeInTheDocument();
  });
});
