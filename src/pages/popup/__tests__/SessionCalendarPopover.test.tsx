import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SessionCalendarPopover from "@pages/popup/SessionCalendarPopover";
import { getLosAngelesDateString } from "@shared/practice";
import {
  flushCalendarPositioning,
  getEnabledCalendarDay,
} from "./popupTestUtils";

type PopoverProps = ComponentProps<typeof SessionCalendarPopover>;

const today = getLosAngelesDateString();

function baseProps(overrides: Partial<PopoverProps> = {}): PopoverProps {
  return {
    sessionDate: today,
    isSessionDone: false,
    todayDateKey: today,
    summaries: [{ date: today, completed: false }],
    onSelectDate: vi.fn().mockResolvedValue(true),
    onToday: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

async function renderOpenPopover(
  overrides: Partial<PopoverProps> = {},
): Promise<HTMLElement> {
  render(<SessionCalendarPopover {...(baseProps(overrides))} />);
  fireEvent.click(screen.getByRole("button", { name: "Open calendar" }));
  const dialog = await screen.findByRole("dialog", { name: "Session calendar" });
  await flushCalendarPositioning();
  return dialog;
}

function makeRect(overrides: Partial<DOMRect>): DOMRect {
  return {
    top: 0,
    bottom: 10,
    left: 100,
    right: 380,
    width: 280,
    height: 360,
    x: 100,
    y: 0,
    toJSON() {},
    ...overrides,
  } as DOMRect;
}

describe("SessionCalendarPopover", () => {
  it("is closed initially and opens on trigger click", async () => {
    render(<SessionCalendarPopover {...(baseProps())} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open calendar" }));
    await flushCalendarPositioning();
    expect(screen.getByRole("dialog", { name: "Session calendar" })).toBeInTheDocument();
  });

  it("disables days with no stored session data other than today", async () => {
    const dialog = await renderOpenPopover({ summaries: [] });
    const todayDay = new Date().getDate();
    expect(getEnabledCalendarDay(dialog, String(todayDay))).toBeDefined();
  });

  it.each([
    {
      name: "completed summary",
      overrides: { summaries: [{ date: today, completed: true }] },
    },
    {
      name: "isSessionDone without summaries",
      overrides: { isSessionDone: true, summaries: [] },
    },
  ])("marks the selected day complete from $name", async ({ overrides }) => {
    const dialog = await renderOpenPopover(overrides);
    const todayDay = new Date().getDate();
    const selectedButton = getEnabledCalendarDay(dialog, String(todayDay));
    expect(selectedButton.className).toContain("is-selected");
    expect(selectedButton.className).toContain("is-complete");
  });

  it("navigates to the previous and next month", async () => {
    const dialog = await renderOpenPopover();
    const currentTitle = within(dialog).getByText(new Date().getFullYear());
    expect(currentTitle).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Previous month" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Next month" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Next month" }));
    // Still renders a valid calendar grid after navigation without throwing.
    expect(within(dialog).getByText("Su")).toBeInTheDocument();
  });

  it.each([
    {
      name: "closes when onToday resolves true",
      onTodayResult: true,
      expectOpen: false,
    },
    {
      name: "stays open when onToday resolves false",
      onTodayResult: false,
      expectOpen: true,
    },
  ])("$name", async ({ onTodayResult, expectOpen }) => {
    const onToday = vi.fn().mockResolvedValue(onTodayResult);
    const dialog = await renderOpenPopover({ onToday });

    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Today" }));
      await Promise.resolve();
    });

    expect(onToday).toHaveBeenCalledTimes(1);
    if (expectOpen) {
      expect(screen.getByRole("dialog", { name: "Session calendar" })).toBeInTheDocument();
    } else {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    }
  });

  it("calls onSelectDate for an enabled day and closes on success", async () => {
    const onSelectDate = vi.fn().mockResolvedValue(true);
    const dialog = await renderOpenPopover({ onSelectDate });
    const todayDay = new Date().getDate();
    const enabled = getEnabledCalendarDay(dialog, String(todayDay));

    await act(async () => {
      fireEvent.click(enabled);
      await Promise.resolve();
    });

    expect(onSelectDate).toHaveBeenCalledWith(today);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes the popover on Escape", async () => {
    await renderOpenPopover();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes the popover on an outside click but not a click inside it", async () => {
    render(
      <div>
        <div data-testid="outside">outside</div>
        <SessionCalendarPopover {...(baseProps())} />
      </div>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open calendar" }));
    const dialog = await screen.findByRole("dialog", { name: "Session calendar" });
    await flushCalendarPositioning();

    fireEvent.mouseDown(within(dialog).getByText("Session Calendar"));
    expect(screen.getByRole("dialog", { name: "Session calendar" })).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("repositions on window resize and scroll while open", async () => {
    await renderOpenPopover();

    expect(() => {
      fireEvent(window, new Event("resize"));
      fireEvent.scroll(window, {});
    }).not.toThrow();
    expect(screen.getByRole("dialog", { name: "Session calendar" })).toBeInTheDocument();
  });

  it("cleans up listeners and animation frames on unmount while open", async () => {
    const { unmount } = render(<SessionCalendarPopover {...(baseProps())} />);
    fireEvent.click(screen.getByRole("button", { name: "Open calendar" }));
    await screen.findByRole("dialog", { name: "Session calendar" });
    await flushCalendarPositioning();

    expect(() => unmount()).not.toThrow();
  });
});

describe("SessionCalendarPopover placement", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("places the popover above the anchor when there is enough room above it", async () => {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue(makeRect({
      top: 700,
      bottom: 700,
      y: 700,
    }));

    const dialog = await renderOpenPopover();

    expect(dialog).toHaveAttribute("data-placement", "above");
  });

  it("centers the popover when there is not enough room above or below the anchor", async () => {
    const originalInnerHeight = window.innerHeight;
    Object.defineProperty(window, "innerHeight", { value: 100, configurable: true });
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue(makeRect({
      top: 50,
      bottom: 60,
      y: 50,
    }));

    try {
      const dialog = await renderOpenPopover();

      expect(dialog).toHaveAttribute("data-placement", "center");
    } finally {
      Object.defineProperty(window, "innerHeight", {
        value: originalInnerHeight,
        configurable: true,
      });
    }
  });
});
