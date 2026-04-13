import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Options from "@pages/options/Options";
import type { PracticeState } from "@shared/practice";
import * as rpc from "@utils/chromeRPC";

vi.mock("@utils/chromeRPC", () => ({
  getSessionState: vi.fn(),
  getRunningState: vi.fn(),
  decrementTimer: vi.fn(),
  saveSession: vi.fn(),
  startSession: vi.fn(),
  pauseSession: vi.fn(),
  resumeSession: vi.fn(),
  newDay: vi.fn(),
  resetToDefaults: vi.fn(),
  editTemplate: vi.fn(),
}));

const mockedRpc = vi.mocked(rpc);

function buildState(): PracticeState {
  return {
    template: [
      { id: "task-a", name: "Task A", duration: 10 },
      { id: "task-b", name: "Task B", duration: 5 },
    ],
    session: {
      date: "2026-04-12",
      currentTaskId: "task-a",
      done: false,
      tasks: [
        {
          id: "task-a",
          name: "Task A",
          duration: 10,
          note: "",
          completedAt: null,
          remainingSeconds: 600,
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
  const state = buildState();
  mockedRpc.getSessionState.mockResolvedValue(state);
  mockedRpc.getRunningState.mockResolvedValue({
    isRunning: true,
    isPaused: false,
  });
  mockedRpc.pauseSession.mockResolvedValue(state);
  mockedRpc.editTemplate.mockResolvedValue(state);
  mockedRpc.resetToDefaults.mockResolvedValue(state);
  mockedRpc.newDay.mockResolvedValue(state);
  mockedRpc.startSession.mockResolvedValue(state);
  mockedRpc.resumeSession.mockResolvedValue(state);
  mockedRpc.decrementTimer.mockResolvedValue(state);
  mockedRpc.saveSession.mockResolvedValue(state);
});

describe("Options", () => {
  it("stops running timer before task template mutations", async () => {
    render(<Options />);

    await screen.findByRole("button", { name: "Edit Tasks" });
    fireEvent.click(screen.getByRole("button", { name: "Edit Tasks" }));

    const addButton = await screen.findByRole("button", { name: "+ Add Task" });
    fireEvent.click(addButton);

    await waitFor(() => {
      expect(mockedRpc.pauseSession).toHaveBeenCalled();
    });

    expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
  });

  it("uses destructive reset confirmation text and calls hard reset", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<Options />);

    const resetButton = await screen.findByRole("button", {
      name: "Reset to Defaults",
    });
    fireEvent.click(resetButton);

    await waitFor(() => {
      expect(confirmSpy).toHaveBeenCalledWith(
        "Are you sure you want to reset the list? All progress data across all days will be deleted. This action cannot be undone.",
      );
      expect(mockedRpc.pauseSession).toHaveBeenCalled();
      expect(mockedRpc.resetToDefaults).toHaveBeenCalled();
    });

    confirmSpy.mockRestore();
  });
});
