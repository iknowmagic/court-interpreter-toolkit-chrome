import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import SessionPopup from "@pages/popup/SessionPopup";
import { getLosAngelesDateString, type PracticeState } from "@shared/practice";
import * as rpc from "@utils/chromeRPC";
import { parseDateKey, toDateKey } from "@pages/popup/sessionPopupUtils";
import {
  actWait,
  buildPracticeState,
  flushCalendarPositioning,
  getEnabledCalendarDay,
  wait,
} from "./popupTestUtils";

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

beforeEach(() => {
  vi.clearAllMocks();
  mockedRpc.saveState.mockImplementation(async (state) => state);
  mockedRpc.startSession.mockResolvedValue(null);
  mockedRpc.completeCurrentTaskAndAdvance.mockResolvedValue(null);
  mockedRpc.listSessionSummaries.mockResolvedValue([]);
  mockedRpc.readStateByDate.mockImplementation(async (date: string) =>
    buildPracticeState(date),
  );
  mockedRpc.getSessionState.mockImplementation(async () =>
    buildPracticeState(getLosAngelesDateString()),
  );
  mockedRpc.pauseSession.mockResolvedValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function configureInitialState(
  options: {
    state?: PracticeState;
    running?: boolean;
    paused?: boolean;
  } = {},
): PracticeState {
  const state = options.state ?? buildPracticeState(getLosAngelesDateString());
  mockedRpc.loadState.mockResolvedValue(state);
  mockedRpc.getRunningState.mockResolvedValue({
    isRunning: options.running ?? false,
    isPaused: options.paused ?? false,
  });
  return state;
}

async function renderReadyPopup(
  options: {
    state?: PracticeState;
    running?: boolean;
    paused?: boolean;
    readyMarker?: string | RegExp;
  } = {},
): Promise<PracticeState> {
  const initial = configureInitialState(options);
  render(<SessionPopup />);
  await screen.findByText(options.readyMarker ?? "Current Task");
  return initial;
}

async function openPopupCalendar(): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole("button", { name: "Open calendar" }));
  const dialog = await screen.findByRole("dialog", { name: "Session calendar" });
  await flushCalendarPositioning();
  return dialog;
}

async function waitForPauseSessionCall(): Promise<void> {
  await waitFor(() => {
    expect(mockedRpc.pauseSession).toHaveBeenCalled();
  });
}

async function renderReadyWithPauseFailure(
  state = buildPracticeState(getLosAngelesDateString()),
) {
  mockedRpc.pauseSession.mockRejectedValue(new Error("pause failed"));
  const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  await renderReadyPopup({ state });
  return consoleErrorSpy;
}

describe("SessionPopup", () => {
  it("stops timer first and applies edited duration immediately", async () => {
    const today = getLosAngelesDateString();
    const initial = buildPracticeState(today, {
      firstTaskRemainingSeconds: 590,
    });
    mockedRpc.pauseSession.mockResolvedValue(initial);

    await renderReadyPopup({ state: initial, running: true });

    fireEvent.click(screen.getByRole("button", { name: "Edit Task" }));

    const durationInput = screen.getByLabelText("Duration (minutes)");
    fireEvent.change(durationInput, { target: { value: "15" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitForPauseSessionCall();

    await waitFor(() => {
      expect(screen.getByText("15:00")).toBeInTheDocument();
    });
  });

  it("shows read-only disabled controls in history mode", async () => {
    const pastDate = "2026-01-01";
    await renderReadyPopup({
      state: buildPracticeState(pastDate),
      readyMarker: "History view — read only",
    });

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

    mockedRpc.listSessionSummaries.mockResolvedValue([
      { date: pastDate, completed: false },
      { date: today, completed: false },
    ]);
    mockedRpc.pauseSession.mockResolvedValue(buildPracticeState(pastDate));

    await renderReadyPopup({
      state: buildPracticeState(pastDate),
      readyMarker: "History view — read only",
    });

    await openPopupCalendar();

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
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

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
  });

  it("renders the real stored session after a successful Retry", async () => {
    const today = getLosAngelesDateString();
    mockedRpc.loadState
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(buildPracticeState(today));
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(<SessionPopup />);

    await screen.findByRole("alert");
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Failed to load the practice session.",
      expect.any(Error),
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await screen.findByText("Current Task");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("fetches session summaries once and never issues per-date full loads for the calendar", async () => {
    const today = getLosAngelesDateString();
    mockedRpc.listSessionSummaries.mockResolvedValue([
      { date: today, completed: false },
    ]);

    await renderReadyPopup({ state: buildPracticeState(today) });

    expect(mockedRpc.listSessionSummaries).toHaveBeenCalledTimes(1);
    expect(mockedRpc.readStateByDate).not.toHaveBeenCalled();
  });

  it("uses readStateByDate for a past date and never autosaves the historical view", async () => {
    const today = getLosAngelesDateString();
    const pastDate = offsetDateKey(today, -1);
    mockedRpc.listSessionSummaries.mockResolvedValue([
      { date: pastDate, completed: false },
      { date: today, completed: false },
    ]);
    mockedRpc.pauseSession.mockResolvedValue(buildPracticeState(today));

    await renderReadyPopup({ state: buildPracticeState(today) });

    const dialog = await openPopupCalendar();
    fireEvent.click(getEnabledCalendarDay(dialog, String(parseDateKey(pastDate).getDate())));

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
    const initial = buildPracticeState(today);
    const consoleErrorSpy = await renderReadyWithPauseFailure(initial);

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
  });

  it("aborts saving an edited task when pause fails", async () => {
    const today = getLosAngelesDateString();
    const initial = buildPracticeState(today);
    const consoleErrorSpy = await renderReadyWithPauseFailure(initial);

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
  });

  it("keeps the session stopped after a successful mutation", async () => {
    const today = getLosAngelesDateString();
    const initial = buildPracticeState(today);
    mockedRpc.pauseSession.mockResolvedValue(initial);

    await renderReadyPopup({ state: initial, running: true });

    fireEvent.click(screen.getByRole("button", { name: "Edit Task" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitForPauseSessionCall();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "▶ Play" })).not.toBeDisabled();
    });
    expect(screen.getByRole("button", { name: "■ Stop" })).toBeDisabled();
  });

  it("wires Play, Stop, Reset Task, Done, Move, Delete, and Reset List through to the RPC layer", async () => {
    const today = getLosAngelesDateString();
    const initial = buildPracticeState(today);
    mockedRpc.pauseSession.mockResolvedValue(initial);
    mockedRpc.startSession.mockResolvedValue(initial);
    mockedRpc.completeCurrentTaskAndAdvance.mockResolvedValue(initial);
    vi.stubGlobal("confirm", vi.fn(() => true));

    await renderReadyPopup({ state: initial });

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
      const initial = buildPracticeState(today, {
        firstTaskRemainingSeconds: 590,
      });
      configureInitialState({ state: initial, running: true });
      mockedRpc.getSessionState.mockResolvedValue(
        buildPracticeState(today, { firstTaskRemainingSeconds: 480 }),
      );

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
    mockedRpc.listSessionSummaries.mockResolvedValue([
      { date: firstCallDate, completed: false },
      { date: secondCallDate, completed: false },
      { date: today, completed: false },
    ]);
    mockedRpc.pauseSession.mockResolvedValue(buildPracticeState(today));

    let resolveFirst: (state: PracticeState) => void = () => {};
    mockedRpc.readStateByDate.mockImplementation(async (date: string) => {
      if (date === firstCallDate) {
        return new Promise<PracticeState>((resolve) => {
          resolveFirst = resolve;
        });
      }
      return buildPracticeState(date);
    });

    await renderReadyPopup({ state: buildPracticeState(today) });

    const dialog = await openPopupCalendar();
    fireEvent.click(getEnabledCalendarDay(dialog, String(parseDateKey(firstCallDate).getDate())));
    await waitFor(() => expect(mockedRpc.readStateByDate).toHaveBeenCalledWith(firstCallDate));

    // The first request is still pending (unresolved), so the popover is
    // still open; click the second date from the same still-open dialog.
    fireEvent.click(getEnabledCalendarDay(dialog, String(parseDateKey(secondCallDate).getDate())));
    await waitFor(() => expect(mockedRpc.readStateByDate).toHaveBeenCalledWith(secondCallDate));

    await screen.findByText(/Viewing/);

    // Resolve the stale, older request after the newer one has already landed.
    await act(async () => {
      resolveFirst(buildPracticeState(firstCallDate));
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
