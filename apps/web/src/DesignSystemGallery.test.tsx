import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { COMPONENT_FAMILIES, DesignSystemGallery } from "./DesignSystemGallery";

beforeAll(() => {
  class ResizeObserverStub {
    private readonly callback: ResizeObserverCallback;

    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }

    observe(target: Element) {
      const contentRect = {
        bottom: 240,
        height: 240,
        left: 0,
        right: 640,
        top: 0,
        width: 640,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      } as DOMRectReadOnly;
      this.callback(
        [
          {
            borderBoxSize: [{ blockSize: 240, inlineSize: 640 }],
            contentBoxSize: [{ blockSize: 240, inlineSize: 640 }],
            contentRect,
            devicePixelContentBoxSize: [{ blockSize: 240, inlineSize: 640 }],
            target,
          },
        ],
        this as unknown as ResizeObserver,
      );
    }
    unobserve() {}
    disconnect() {}
  }

  class IntersectionObserverStub {
    readonly root = null;
    readonly rootMargin = "0px";
    readonly thresholds = [0];

    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }

  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );

  HTMLElement.prototype.scrollIntoView = vi.fn();
  HTMLElement.prototype.scrollTo = vi.fn();
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
});

afterEach(() => {
  window.history.replaceState({}, "", "/");
});

describe("internal design-system gallery", () => {
  it("renders without React console errors", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    try {
      render(<DesignSystemGallery />);
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  it("routes the internal pathname to an executable inventory of all UI families", async () => {
    window.history.replaceState({}, "", "/internal/design-system");
    const { container } = render(<App />);

    expect(
      await screen.findByRole("heading", { name: "WebEditor 디자인 시스템" }),
    ).toBeInTheDocument();

    const renderedFamilies = Array.from(
      container.querySelectorAll<HTMLElement>("[data-component-family]"),
      (element) => element.dataset.componentFamily,
    );

    expect(renderedFamilies).toHaveLength(COMPONENT_FAMILIES.length);
    expect(new Set(renderedFamilies)).toEqual(new Set(COMPONENT_FAMILIES));
  });

  it("supports keyboard tab navigation", async () => {
    const user = userEvent.setup();
    render(<DesignSystemGallery />);

    const draftTab = screen.getByRole("tab", { name: "초안" });
    const publishedTab = screen.getByRole("tab", { name: "게시 버전" });
    draftTab.focus();
    await user.keyboard("{ArrowRight}");

    expect(publishedTab).toHaveFocus();
    expect(publishedTab).toHaveAttribute("data-state", "active");
  });

  it("traps dialog focus, closes with Escape, and returns focus to its trigger", async () => {
    const user = userEvent.setup();
    render(<DesignSystemGallery />);

    const trigger = screen.getByRole("button", { name: "페이지 이름 변경" });
    await user.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "페이지 이름 변경" });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    await user.keyboard("{Escape}");

    expect(
      screen.queryByRole("dialog", { name: "페이지 이름 변경" }),
    ).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("opens grouped menus and changes a grouped select option", async () => {
    const user = userEvent.setup();
    render(<DesignSystemGallery />);

    await user.click(screen.getByRole("button", { name: /프로젝트 작업/ }));
    const menu = screen.getByRole("menu");
    expect(
      within(menu).getByRole("menuitem", { name: /게시/ }),
    ).toBeInTheDocument();
    await user.keyboard("{Escape}");

    const select = screen.getByRole("combobox", { name: "차트 유형" });
    await user.click(select);
    await user.keyboard("{ArrowDown}{Enter}");
    expect(select).toHaveTextContent("막대 차트");
  });
});
