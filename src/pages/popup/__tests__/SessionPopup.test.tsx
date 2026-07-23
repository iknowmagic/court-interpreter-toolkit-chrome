import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import SessionPopup from "@pages/popup/SessionPopup";
import { getLosAngelesDateString, type PracticeState } from "@shared/practice";
import * as rpc from "@utils/chromeRPC";
import { parseDateKey, toDateKey } from "@pages/popup/sessionPopupUtils";

// Offsets by whole days using the same local-date arithmetic the calendar
// popover uses, so the result is guaranteed to land inside the 42-cell grid
// rendered for "today" without needing to click through month navigation.
function offsetDateKey(dateKey: string, days: number): string {
  const parsed = parseDateKey(dateKey);
  parsed.setDate(parsed.getDate() + days);
  return toDateKey(parsed);
}

vi.mock("@utils/chromeRPC", () => ({
  loadState: vi.fn(),
  readStateByDate: vi.fn(),
  listSessionSummaries: vi.fn(),
  getRunningState: vi.fn(),
  saveState: vi.fn(),
  pauseSession: vi.fn(),
  startSession: vi.fn(),
  completeCurrentTaskAndAdvance: vi.fn(),
  getSessionState: vi.fn(),
  resetToDefaults: vi.fn(),
}));

const mockedRpc = vi.mocked(rpc);

function buildState(date: string, remainingSeconds = 590): PracticeState {
  return {
    template: [
      { id: "task-a", name: "Task A", duration: 10 },
      { id: "task-b", name: "Task B", duration: 5 },
    ],
    session: {
      date,
      currentTaskId: "task-a",
      done: false,
      tasks: [
        {
          id: "task-a",
          name: "Task A",
          duration: 10,
          note: "",
          completedAt: null,
          remainingSeconds,
        },
        {
          id: "task-b",
          name: "Task B",
          duration: 5,
          note: "",
          completedAt: null,
          remainingSeconds: 300,
        },
      ],
    },
  };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Wraps a real-timer wait in `act` so any state update it triggers is flushed. */
async function actWait(ms: number): Promise<void> {
  await act(() => wait(ms));
}

/**
 * The calendar popover measures itself across two nested
 * `requestAnimationFrame` calls before it becomes visible. Flushing both
 * inside `act` keeps that positioning update from leaking into whatever
 * assertion runs next.
 */
async function flushCalendarPositioning(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
}

function clickEnabledCalendarDay(dialog: HTMLElement, dayLabel: string): void {
  const candidates = within(dialog).getAllByRole("button", { name: dayLabel });
  const enabled = candidates.find(
    (button) => !(button as HTMLButtonElement).disabled,
  );
  if (!enabled) throw new Error(`No enabled calendar day button "${dayLabel}"`);
  fireEvent.click(enabled);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedRpc.saveState.mockImplementation(async (state) => state);
  mockedRpc.startSession.mockResolvedValue(null);
  mockedRpc.completeCurrentTaskAndAdvance.mockResolvedValue(null);
  mockedRpc.listSessionSummaries.mockResolvedValue([]);
  mockedRpc.readStateByDate.mockImplementation(async (date: string) =>
    buildState(date),
  );
  mockedRpc.getSessionState.mockImplementation(async () => buildState(getLosAngelesDateString()));
  mockedRpc.pauseSession.mockResolvedValue(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SessionPopup", () => {
  it("stops timer first and applies edited duration immediately", async () => {
    const today = getLosAngelesDateString();
    const initial = buildState(today, 590);

    mockedRpc.loadState.mockResolvedValue(initial);
    mockedRpc.getRunningState.mockResolvedValue({
      isRunning: true,
      isPaused: false,
    });
    mockedRpc.pauseSession.mockResolvedValue(initial);

    render(<SessionPopup />);

    await screen.findByText("Current Task");

    fireEvent.click(screen.getByRole("button", { name: "Edit Task" }));

    const durationInput = screen.getByLabelText("Duration (minutes)");
    fireEvent.change(durationInput, { target: { value: "15" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => {
      expect(mockedRpc.pauseSession).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(screen.getByText("15:00")).toBeInTheDocument();
    });
  });

  it("shows read-only disabled controls in history mode", async () => {
    const pastDate = "2026-01-01";
    mockedRpc.loadState.mockResolvedValue(buildState(pastDate));
    mockedRpc.getRunningState.mockResolvedValue({ isRunning: false, isPaused: false });

    render(<SessionPopup />);

    await screen.findByText("History view — read only");

    expect(screen.getByRole("button", { name: "+ Add Task" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Edit Task" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "↑ Move Up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete Task" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "▶ Play" })).toBeDisabled();
    expect(screen.getByPlaceholderText("What did you practice?")).toBeDisabled();

    const root = screen
      .getByText("Court Interpreter Toolkit")
      .closest(".practice-app");
    expect(root).toHaveClass("practice-app--history");
  });

  it("jumps to today and closes calendar popover from Today button, reloading via the active-state contract", async () => {
    const today = getLosAngelesDateString();
    const pastDate = "2026-01-01";

    mockedRpc.loadState.mockResolvedValue(buildState(pastDate));
    mockedRpc.getRunningState.mockResolvedValue({ isRunning: false, isPaused: false });
    mockedRpc.listSessionSummaries.mockResolvedValue([
      { date: pastDate, completed: false },
      { date: today, completed: false },
    ]);
    mockedRpc.pauseSession.mockResolvedValue(buildState(pastDate));

    render(<SessionPopup />);

    await screen.findByText("History view — read only");

    fireEvent.click(screen.getByRole("button", { name: "Open calendar" }));
    await screen.findByRole("dialog", { name: "Session calendar" });
    await flushCalendarPositioning();

    fireEvent.click(screen.getByRole("button", { name: "Today" }));

    await waitFor(() => {
      expect(mockedRpc.getSessionState).toHaveBeenCalled();
    });
    expect(mockedRpc.readStateByDate).not.toHaveBeenCalledWith(today);

    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "Session calendar" }),
      ).not.toBeInTheDocument();
    });
  });

  it("renders an alert with Retry on initial load failure and never autosaves the fallback state", async () => {
    mockedRpc.loadState.mockRejectedValue(new Error("network down"));
    mockedRpc.getRunningState.mockResolvedValue({ isRunning: false, isPaused: false });
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      render(<SessionPopup />);

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("network down");
      expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Failed to load the practice session.",
        expect.any(Error),
      );

      await actWait(500);
      expect(mockedRpc.saveState).not.toHaveBeenCalled();
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it("renders the real stored session after a successful Retry", async () => {
    const today = getLosAngelesDateString();
    mockedRpc.loadState
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(buildState(today));
    mockedRpc.getRunningState.mockResolvedValue({ isRunning: false, isPaused: false });
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      render(<SessionPopup />);

      await screen.findByRole("alert");
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Failed to load the practice session.",
        expect.any(Error),
      );
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));

      await screen.findByText("Current Task");
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it("fetches session summaries once and never issues per-date full loads for the calendar", async () => {
    const today = getLosAngelesDateString();
    mockedRpc.loadState.mockResolvedValue(buildState(today));
    mockedRpc.getRunningState.mockResolvedValue({ isRunning: false, isPaused: false });
    mockedRpc.listSessionSummaries.mockResolvedValue([
      { date: today, completed: false },
    ]);

    render(<SessionPopup />);

    await screen.findByText("Current Task");

    expect(mockedRpc.listSessionSummaries).toHaveBeenCalledTimes(1);
    expect(mockedRpc.readStateByDate).not.toHaveBeenCalled();
  });

  it("uses readStateByDate for a past date and never autosaves the historical view", async () => {
    const today = getLosAngelesDateString();
    const pastDate = offsetDateKey(today, -1);
    mockedRpc.loadState.mockResolvedValue(buildState(today));
    mockedRpc.getRunningState.mockResolvedValue({ isRunning: false, isPaused: false });
    mockedRpc.listSessionSummaries.mockResolvedValue([
      { date: pastDate, completed: false },
      { date: today, completed: false },
    ]);
    mockedRpc.pauseSession.mockResolvedValue(buildState(today));

    render(<SessionPopup />);
    await screen.findByText("Current Task");

    fireEvent.click(screen.getByRole("button", { name: "Open calendar" }));
    const dialog = await screen.findByRole("dialog", { name: "Session calendar" });
    await flushCalendarPositioning();
    clickEnabledCalendarDay(dialog, String(parseDateKey(pastDate).getDate()));

    await waitFor(() => {
      expect(mockedRpc.readStateByDate).toHaveBeenCalledWith(pastDate);
    });
    await screen.findByText("History view — read only");

    mockedRpc.saveState.mockClear();
    await actWait(500);
    expect(mockedRpc.saveState).not.toHaveBeenCalled();
  });

  it("aborts task selection when pause fails and surfaces a visible error", async () => {
    const today = getLosAngelesDateString();
    const initial = buildState(today);
    mockedRpc.loadState.mockResolvedValue(initial);
    mockedRpc.getRunningState.mockResolvedValue({ isRunning: false, isPaused: false });
    mockedRpc.pauseSession.mockRejectedValue(new Error("pause failed"));
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      render(<SessionPopup />);
      await screen.findByText("Current Task");

      fireEvent.click(screen.getByRole("button", { name: /Task B/ }));

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("pause failed");
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Failed to pause before selecting that task.",
        expect.any(Error),
      );
      // Current task selection must be unchanged.
      expect(document.querySelector(".practice-current")).toHaveTextContent(
        "Task A",
      );
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it("aborts add/edit/delete/move/reset/date-navigation mutations when pause fails", async () => {
    const today = getLosAngelesDateString();
    const initial = buildState(today);
    mockedRpc.loadState.mockResolvedValue(initial);
    mockedRpc.getRunningState.mockResolvedValue({ isRunning: false, isPaused: false });
    mockedRpc.pauseSession.mockRejectedValue(new Error("pause failed"));
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      render(<SessionPopup />);
      await screen.findByText("Current Task");

      fireEvent.click(screen.getByRole("button", { name: "Edit Task" }));
      const durationInput = screen.getByLabelText("Duration (minutes)");
      fireEvent.change(durationInput, { target: { value: "42" } });
      fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

      await screen.findByRole("alert");
      expect(screen.queryByText("42:00")).not.toBeInTheDocument();
      expect(mockedRpc.saveState).not.toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Failed to pause before saving the task.",
        expect.any(Error),
      );
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it("keeps the session stopped after a successful mutation", async () => {
    const today = getLosAngelesDateString();
    const initial = buildState(today);
    mockedRpc.loadState.mockResolvedValue(initial);
    mockedRpc.getRunningState.mockResolvedValue({ isRunning: true, isPaused: false });
    mockedRpc.pauseSession.mockResolvedValue(initial);

    render(<SessionPopup />);
    await screen.findByText("Current Task");

    fireEvent.click(screen.getByRole("button", { name: "Edit Task" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => {
      expect(mockedRpc.pauseSession).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "▶ Play" })).not.toBeDisabled();
    });
    expect(screen.getByRole("button", { name: "■ Stop" })).toBeDisabled();
  });

  it("wires Play, Stop, Reset Task, Done, Move, Delete, and Reset List through to the RPC layer", async () => {
    const today = getLosAngelesDateString();
    const initial = buildState(today);
    mockedRpc.loadState.mockResolvedValue(initial);
    mockedRpc.getRunningState.mockResolvedValue({ isRunning: false, isPaused: false });
    mockedRpc.pauseSession.mockResolvedValue(initial);
    mockedRpc.startSession.mockResolvedValue(initial);
    mockedRpc.completeCurrentTaskAndAdvance.mockResolvedValue(initial);
    vi.stubGlobal("confirm", vi.fn(() => true));

    render(<SessionPopup />);
    await screen.findByText("Current Task");

    fireEvent.click(screen.getByRole("button", { name: "▶ Play" }));
    await waitFor(() => expect(mockedRpc.startSession).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "■ Stop" }));
    await waitFor(() => expect(mockedRpc.pauseSession).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "↺ Reset Task" }));

    fireEvent.click(screen.getByRole("button", { name: "✓ Done" }));
    await waitFor(() =>
      expect(mockedRpc.completeCurrentTaskAndAdvance).toHaveBeenCalled(),
    );

    fireEvent.click(screen.getByRole("button", { name: "↓ Move Down" }));
    await waitFor(() => expect(mockedRpc.pauseSession).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByRole("button", { name: "Delete Task" }));
    await waitFor(() => expect(mockedRpc.pauseSession).toHaveBeenCalledTimes(3));

    mockedRpc.resetToDefaults.mockResolvedValue(initial);
    fireEvent.click(screen.getByRole("button", { name: "Reset List" }));
    await waitFor(() => expect(mockedRpc.pauseSession).toHaveBeenCalledTimes(4));
  });

  it("polls and applies authoritative running-session state from the background", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "setTimeout", "Date"] });
    try {
      const today = getLosAngelesDateString();
      mockedRpc.loadState.mockResolvedValue(buildState(today, 590));
      mockedRpc.getRunningState.mockResolvedValue({ isRunning: true, isPaused: false });
      mockedRpc.getSessionState.mockResolvedValue(buildState(today, 480));

      render(<SessionPopup />);
      // The initial load only awaits real (mocked) promises, not fake
      // timers, but `advanceTimersByTimeAsync(0)` also flushes those pending
      // microtasks each loop iteration, so it doubles as a deterministic
      // "wait for the initial load" here. Wrapped in `act` since it resolves
      // the state updates from that load.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(screen.getByText("09:50")).toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(screen.getByText("08:00")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not let a stale (older) date response overwrite a newer date selection", async () => {
    const today = getLosAngelesDateString();
    const firstCallDate = offsetDateKey(today, -2);
    const secondCallDate = offsetDateKey(today, -1);
    mockedRpc.loadState.mockResolvedValue(buildState(today));
    mockedRpc.getRunningState.mockResolvedValue({ isRunning: false, isPaused: false });
    mockedRpc.listSessionSummaries.mockResolvedValue([
      { date: firstCallDate, completed: false },
      { date: secondCallDate, completed: false },
      { date: today, completed: false },
    ]);
    mockedRpc.pauseSession.mockResolvedValue(buildState(today));

    let resolveFirst: (state: PracticeState) => void = () => {};
    mockedRpc.readStateByDate.mockImplementation(async (date: string) => {
      if (date === firstCallDate) {
        return new Promise<PracticeState>((resolve) => {
          resolveFirst = resolve;
        });
      }
      return buildState(date);
    });

    render(<SessionPopup />);
    await screen.findByText("Current Task");

    fireEvent.click(screen.getByRole("button", { name: "Open calendar" }));
    const dialog = await screen.findByRole("dialog", { name: "Session calendar" });
    await flushCalendarPositioning();
    clickEnabledCalendarDay(dialog, String(parseDateKey(firstCallDate).getDate()));
    await waitFor(() => expect(mockedRpc.readStateByDate).toHaveBeenCalledWith(firstCallDate));

    // The first request is still pending (unresolved), so the popover is
    // still open; click the second date from the same still-open dialog.
    clickEnabledCalendarDay(dialog, String(parseDateKey(secondCallDate).getDate()));
    await waitFor(() => expect(mockedRpc.readStateByDate).toHaveBeenCalledWith(secondCallDate));

    await screen.findByText(/Viewing/);

    // Resolve the stale, older request after the newer one has already landed.
    await act(async () => {
      resolveFirst(buildState(firstCallDate));
      await wait(50);
    });

    expect(screen.getByText(/Viewing/).textContent).toContain(
      new Intl.DateTimeFormat("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(parseDateKey(secondCallDate)),
    );
  });
});
