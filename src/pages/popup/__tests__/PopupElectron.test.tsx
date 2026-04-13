import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import PopupElectron from "@pages/popup/PopupElectron";
import { getLosAngelesDateString, type PracticeState } from "@shared/practice";
import * as rpc from "@utils/chromeRPC";

vi.mock("@utils/chromeRPC", () => ({
  loadState: vi.fn(),
  loadStateByDate: vi.fn(),
  listSessionDates: vi.fn(),
  getRunningState: vi.fn(),
  saveState: vi.fn(),
  pauseSession: vi.fn(),
  startSession: vi.fn(),
  completeCurrentTaskAndAdvance: vi.fn(),
  updateToolbarStatus: vi.fn(),
  getSessionState: vi.fn(),
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

beforeEach(() => {
  vi.clearAllMocks();
  mockedRpc.saveState.mockImplementation(async (state) => state);
  mockedRpc.startSession.mockResolvedValue(null);
  mockedRpc.completeCurrentTaskAndAdvance.mockResolvedValue(null);
  mockedRpc.updateToolbarStatus.mockResolvedValue();
  mockedRpc.listSessionDates.mockResolvedValue([]);
  mockedRpc.loadStateByDate.mockImplementation(async (date: string) =>
    buildState(date),
  );
  mockedRpc.pauseSession.mockResolvedValue(null);
});

describe("PopupElectron", () => {
  it("stops timer first and applies edited duration immediately", async () => {
    const today = getLosAngelesDateString();
    const initial = buildState(today, 590);

    mockedRpc.loadState.mockResolvedValue(initial);
    mockedRpc.getRunningState.mockResolvedValue({
      isRunning: true,
      isPaused: false,
    });
    mockedRpc.pauseSession.mockResolvedValue(initial);

    render(<PopupElectron />);

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

    render(<PopupElectron />);

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

  it("jumps to today and closes calendar popover from Today button", async () => {
    const today = getLosAngelesDateString();
    const pastDate = "2026-01-01";

    mockedRpc.loadState.mockResolvedValue(buildState(pastDate));
    mockedRpc.getRunningState.mockResolvedValue({ isRunning: false, isPaused: false });
    mockedRpc.listSessionDates.mockResolvedValue([pastDate, today]);
    mockedRpc.loadStateByDate.mockImplementation(async (date: string) =>
      buildState(date),
    );

    render(<PopupElectron />);

    await screen.findByText("History view — read only");

    fireEvent.click(screen.getByRole("button", { name: "Open calendar" }));
    await screen.findByRole("dialog", { name: "Session calendar" });

    fireEvent.click(screen.getByRole("button", { name: "Today" }));

    await waitFor(() => {
      expect(mockedRpc.loadStateByDate).toHaveBeenCalledWith(today);
    });

    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "Session calendar" }),
      ).not.toBeInTheDocument();
    });
  });
});
