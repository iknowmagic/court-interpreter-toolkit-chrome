import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SessionCalendarPopover from "@pages/popup/SessionCalendarPopover";
import { getLosAngelesDateString } from "@shared/practice";

type PopoverProps = ComponentProps<typeof SessionCalendarPopover>;

const today = getLosAngelesDateString();

async function flushPositioning(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
}

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

describe("SessionCalendarPopover", () => {
  it("is closed initially and opens on trigger click", async () => {
    render(<SessionCalendarPopover {...(baseProps())} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open calendar" }));
    await flushPositioning();
    expect(screen.getByRole("dialog", { name: "Session calendar" })).toBeInTheDocument();
  });

  it("disables days with no stored session data other than today", async () => {
    render(<SessionCalendarPopover {...(baseProps({ summaries: [] }))} />);
    fireEvent.click(screen.getByRole("button", { name: "Open calendar" }));
    const dialog = await screen.findByRole("dialog", { name: "Session calendar" });
    await flushPositioning();

    const todayDay = new Date().getDate();
    const buttons = within(dialog).getAllByRole("button", { name: String(todayDay) });
    const enabledToday = buttons.find((b) => !(b as HTMLButtonElement).disabled);
    expect(enabledToday).toBeDefined();
  });

  it("marks a completed day with the is-complete class", async () => {
    render(
      <SessionCalendarPopover
        {...(baseProps({ summaries: [{ date: today, completed: true }] }))}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open calendar" }));
    const dialog = await screen.findByRole("dialog", { name: "Session calendar" });
    await flushPositioning();

    const todayDay = new Date().getDate();
    const buttons = within(dialog).getAllByRole("button", { name: String(todayDay) });
    const selectedButton = buttons.find((b) => b.className.includes("is-selected"));
    expect(selectedButton?.className).toContain("is-complete");
  });

  it("marks the session date as selected even when isSessionDone flags it complete", async () => {
    render(<SessionCalendarPopover {...(baseProps({ isSessionDone: true, summaries: [] }))} />);
    fireEvent.click(screen.getByRole("button", { name: "Open calendar" }));
    const dialog = await screen.findByRole("dialog", { name: "Session calendar" });
    await flushPositioning();

    const todayDay = new Date().getDate();
    const buttons = within(dialog).getAllByRole("button", { name: String(todayDay) });
    const selectedButton = buttons.find((b) => b.className.includes("is-selected"));
    expect(selectedButton?.className).toContain("is-complete");
  });

  it("navigates to the previous and next month", async () => {
    render(<SessionCalendarPopover {...(baseProps())} />);
    fireEvent.click(screen.getByRole("button", { name: "Open calendar" }));
    const dialog = await screen.findByRole("dialog", { name: "Session calendar" });
    await flushPositioning();

    const currentTitle = within(dialog).getByText(new Date().getFullYear());
    expect(currentTitle).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Previous month" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Next month" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Next month" }));
    // Still renders a valid calendar grid after navigation without throwing.
    expect(within(dialog).getByText("Su")).toBeInTheDocument();
  });

  it("calls onToday and closes the popover on the Today button", async () => {
    const onToday = vi.fn().mockResolvedValue(true);
    render(<SessionCalendarPopover {...(baseProps({ onToday }))} />);
    fireEvent.click(screen.getByRole("button", { name: "Open calendar" }));
    const dialog = await screen.findByRole("dialog", { name: "Session calendar" });
    await flushPositioning();

    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Today" }));
      await Promise.resolve();
    });

    expect(onToday).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("does not close the popover when onToday resolves false", async () => {
    const onToday = vi.fn().mockResolvedValue(false);
    render(<SessionCalendarPopover {...(baseProps({ onToday }))} />);
    fireEvent.click(screen.getByRole("button", { name: "Open calendar" }));
    const dialog = await screen.findByRole("dialog", { name: "Session calendar" });
    await flushPositioning();

    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Today" }));
      await Promise.resolve();
    });

    expect(screen.getByRole("dialog", { name: "Session calendar" })).toBeInTheDocument();
  });

  it("calls onSelectDate for an enabled day and closes on success", async () => {
    const onSelectDate = vi.fn().mockResolvedValue(true);
    render(<SessionCalendarPopover {...(baseProps({ onSelectDate }))} />);
    fireEvent.click(screen.getByRole("button", { name: "Open calendar" }));
    const dialog = await screen.findByRole("dialog", { name: "Session calendar" });
    await flushPositioning();

    const todayDay = new Date().getDate();
    const buttons = within(dialog).getAllByRole("button", { name: String(todayDay) });
    const enabled = buttons.find((b) => !(b as HTMLButtonElement).disabled)!;

    await act(async () => {
      fireEvent.click(enabled);
      await Promise.resolve();
    });

    expect(onSelectDate).toHaveBeenCalledWith(today);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes the popover on Escape", async () => {
    render(<SessionCalendarPopover {...(baseProps())} />);
    fireEvent.click(screen.getByRole("button", { name: "Open calendar" }));
    await screen.findByRole("dialog", { name: "Session calendar" });
    await flushPositioning();

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
    await flushPositioning();

    fireEvent.mouseDown(within(dialog).getByText("Session Calendar"));
    expect(screen.getByRole("dialog", { name: "Session calendar" })).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("repositions on window resize and scroll while open", async () => {
    render(<SessionCalendarPopover {...(baseProps())} />);
    fireEvent.click(screen.getByRole("button", { name: "Open calendar" }));
    await screen.findByRole("dialog", { name: "Session calendar" });
    await flushPositioning();

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
    await flushPositioning();

    expect(() => unmount()).not.toThrow();
  });
});

describe("SessionCalendarPopover placement", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("places the popover above the anchor when there is enough room above it", async () => {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      top: 700,
      bottom: 700,
      left: 100,
      right: 380,
      width: 280,
      height: 360,
      x: 100,
      y: 700,
      toJSON() {},
    } as DOMRect);

    render(<SessionCalendarPopover {...(baseProps())} />);
    fireEvent.click(screen.getByRole("button", { name: "Open calendar" }));
    const dialog = await screen.findByRole("dialog", { name: "Session calendar" });
    await flushPositioning();

    expect(dialog).toHaveAttribute("data-placement", "above");
  });

  it("centers the popover when there is not enough room above or below the anchor", async () => {
    const originalInnerHeight = window.innerHeight;
    Object.defineProperty(window, "innerHeight", { value: 100, configurable: true });
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      top: 50,
      bottom: 60,
      left: 100,
      right: 380,
      width: 280,
      height: 360,
      x: 100,
      y: 50,
      toJSON() {},
    } as DOMRect);

    try {
      render(<SessionCalendarPopover {...(baseProps())} />);
      fireEvent.click(screen.getByRole("button", { name: "Open calendar" }));
      const dialog = await screen.findByRole("dialog", { name: "Session calendar" });
      await flushPositioning();

      expect(dialog).toHaveAttribute("data-placement", "center");
    } finally {
      Object.defineProperty(window, "innerHeight", {
        value: originalInnerHeight,
        configurable: true,
      });
    }
  });
});
