import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePracticeSession } from "@pages/popup/usePracticeSession";
import { getLosAngelesDateString, type PracticeState } from "@shared/practice";
import * as rpc from "@utils/chromeRPC";
import { actWait, buildPracticeState } from "./popupTestUtils";

vi.mock("@utils/chromeRPC", () => ({
  loadState: vi.fn(),
  readStateByDate: vi.fn(),
  listSessionSummaries: vi.fn(),
  getRunningState: vi.fn(),
  getSessionState: vi.fn(),
  saveState: vi.fn(),
  pauseSession: vi.fn(),
  startSession: vi.fn(),
  completeCurrentTaskAndAdvance: vi.fn(),
  resetToDefaults: vi.fn(),
}));

const mockedRpc = vi.mocked(rpc);

const today = getLosAngelesDateString();

beforeEach(() => {
  vi.clearAllMocks();
  mockedRpc.loadState.mockResolvedValue(buildPracticeState(today));
  mockedRpc.listSessionSummaries.mockResolvedValue([]);
  mockedRpc.getRunningState.mockResolvedValue({ isRunning: false, isPaused: false });
  mockedRpc.saveState.mockImplementation(async (state) => state);
  mockedRpc.pauseSession.mockImplementation(async () => buildPracticeState(today));
  mockedRpc.startSession.mockImplementation(async () => buildPracticeState(today));
  mockedRpc.completeCurrentTaskAndAdvance.mockResolvedValue(null);
  mockedRpc.resetToDefaults.mockImplementation(async () => buildPracticeState(today));
  mockedRpc.readStateByDate.mockImplementation(async (date: string) =>
    buildPracticeState(date),
  );
  mockedRpc.getSessionState.mockImplementation(async () => buildPracticeState(today));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function renderReady() {
  const view = renderHook(() => usePracticeSession());
  await waitFor(() => expect(view.result.current.loadStatus).toBe("ready"));
  return view;
}

async function renderLoadError(message = "network down") {
  mockedRpc.loadState.mockRejectedValueOnce(new Error(message));
  const consoleErrorSpy = captureExpectedConsoleError();
  const view = renderHook(() => usePracticeSession());
  await waitFor(() => expect(view.result.current.loadStatus).toBe("error"));
  return { view, consoleErrorSpy };
}

function captureExpectedConsoleError() {
  return vi.spyOn(console, "error").mockImplementation(() => {});
}

function expectExpectedConsoleError(
  consoleErrorSpy: ReturnType<typeof captureExpectedConsoleError>,
  message: string,
) {
  expect(consoleErrorSpy).toHaveBeenCalledWith(message, expect.any(Error));
  expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
}

async function renderRunningWithFakeTimers() {
  const view = renderHook(() => usePracticeSession());
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(view.result.current.running).toBe(true);
  return view;
}

async function advancePollingInterval() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
}

describe("initial load", () => {
  it("loads the active session, summaries, and running state successfully", async () => {
    mockedRpc.getRunningState.mockResolvedValue({ isRunning: true, isPaused: false });
    mockedRpc.listSessionSummaries.mockResolvedValue([{ date: today, completed: false }]);

    const { result } = await renderReady();

    expect(result.current.session.date).toBe(today);
    expect(result.current.running).toBe(true);
    expect(result.current.sessionSummaries).toEqual([{ date: today, completed: false }]);
  });

  it("renders an error state and never autosaves the fallback default session on load failure", async () => {
    const { view, consoleErrorSpy } = await renderLoadError();
    const { result } = view;
    expect(result.current.loadError).toBe("network down");

    await actWait(500);
    expect(mockedRpc.saveState).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Failed to load the practice session.",
      expect.any(Error),
    );
  });

  it("retryLoad re-runs the load and recovers to ready", async () => {
    const { view, consoleErrorSpy } = await renderLoadError();
    const { result } = view;

    act(() => result.current.retryLoad());
    await waitFor(() => expect(result.current.loadStatus).toBe("ready"));
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Failed to load the practice session.",
      expect.any(Error),
    );
  });

  it("does not autosave immediately after an authoritative load", async () => {
    await renderReady();
    await actWait(500);
    expect(mockedRpc.saveState).not.toHaveBeenCalled();
  });
});

describe("autosave and notes", () => {
  it("marks state dirty on note edit and autosaves after the debounce window", async () => {
    const { result } = await renderReady();

    act(() => result.current.updateNote("task-a", "practiced hard"));
    expect(result.current.noteSaveStatus).toBe("saving");

    await waitFor(() => expect(mockedRpc.saveState).toHaveBeenCalled());
    await waitFor(() => expect(result.current.noteSaveStatus).toBe("saved"));
    expect(result.current.lastNoteSavedAt).not.toBeNull();
  });

  it("does not autosave while the session is running", async () => {
    mockedRpc.startSession.mockResolvedValue(buildPracticeState(today));
    const { result } = await renderReady();

    await act(async () => {
      await result.current.play();
    });
    expect(result.current.running).toBe(true);
    mockedRpc.saveState.mockClear();

    act(() => result.current.updateNote("task-a", "note during run"));
    await actWait(500);
    expect(mockedRpc.saveState).not.toHaveBeenCalled();
  });

  it("does not autosave while viewing history", async () => {
    const pastDate = "2020-01-01";
    const { result } = await renderReady();

    await act(async () => {
      await result.current.loadDate(pastDate);
    });
    expect(result.current.isViewingToday).toBe(false);
    mockedRpc.saveState.mockClear();

    act(() => result.current.updateNote("task-a", "history note"));
    await actWait(500);
    expect(mockedRpc.saveState).not.toHaveBeenCalled();
  });

  it("shows an error status when the note autosave fails", async () => {
    mockedRpc.saveState.mockRejectedValue(new Error("save failed"));
    const { result } = await renderReady();
    const consoleErrorSpy = captureExpectedConsoleError();

    act(() => result.current.updateNote("task-a", "will fail"));
    await waitFor(() => expect(result.current.noteSaveStatus).toBe("error"));
    expect(result.current.operationError).toBe("save failed");
    expectExpectedConsoleError(consoleErrorSpy, "Failed to save changes.");
  });

  it("clears a prior save error once a later note save succeeds", async () => {
    mockedRpc.saveState.mockRejectedValueOnce(new Error("save failed"));
    const { result } = await renderReady();
    const consoleErrorSpy = captureExpectedConsoleError();

    act(() => result.current.updateNote("task-a", "first edit"));
    await waitFor(() => expect(result.current.noteSaveStatus).toBe("error"));
    expectExpectedConsoleError(consoleErrorSpy, "Failed to save changes.");

    act(() => result.current.updateNote("task-a", "second edit"));
    await waitFor(() => expect(result.current.noteSaveStatus).toBe("saved"));
    expectExpectedConsoleError(consoleErrorSpy, "Failed to save changes.");
  });

  it("clears the pending autosave timer on unmount", async () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
    });
    try {
      const { result, unmount } = await (async () => {
        const view = renderHook(() => usePracticeSession());
        await act(async () => {
          await vi.advanceTimersByTimeAsync(0);
        });
        return view;
      })();
      expect(result.current.loadStatus).toBe("ready");

      act(() => result.current.updateNote("task-a", "before unmount"));
      unmount();
      mockedRpc.saveState.mockClear();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(mockedRpc.saveState).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("play, stop, done", () => {
  it("play saves local state first, then applies the authoritative started state", async () => {
    const started = buildPracticeState(today, {
      sessionOverrides: { currentTaskId: "task-a" },
    });
    mockedRpc.startSession.mockResolvedValue(started);
    const { result } = await renderReady();

    await act(async () => {
      await result.current.play();
    });

    expect(mockedRpc.saveState).toHaveBeenCalledTimes(1);
    expect(mockedRpc.startSession).toHaveBeenCalledTimes(1);
    expect(result.current.running).toBe(true);
  });

  it("surfaces an operation error and does not optimistically mark running on play failure", async () => {
    mockedRpc.startSession.mockRejectedValue(new Error("start failed"));
    const { result } = await renderReady();
    const consoleErrorSpy = captureExpectedConsoleError();

    await act(async () => {
      await result.current.play();
    });

    expect(result.current.operationError).toBe("start failed");
    expect(result.current.running).toBe(false);
    expectExpectedConsoleError(consoleErrorSpy, "Failed to start the session.");
  });

  it("stop applies the paused authoritative state", async () => {
    const paused = buildPracticeState(today);
    mockedRpc.pauseSession.mockResolvedValue(paused);
    const { result } = await renderReady();

    await act(async () => {
      await result.current.stop();
    });

    expect(result.current.running).toBe(false);
  });

  it("stop failure preserves prior state and shows an error", async () => {
    mockedRpc.pauseSession.mockRejectedValue(new Error("stop failed"));
    const { result } = await renderReady();
    const sessionBefore = result.current.session;
    const consoleErrorSpy = captureExpectedConsoleError();

    await act(async () => {
      await result.current.stop();
    });

    expect(result.current.operationError).toBe("stop failed");
    expect(result.current.session).toBe(sessionBefore);
    expectExpectedConsoleError(consoleErrorSpy, "Failed to stop the session.");
  });

  it("done saves first, completes via RPC, remains stopped, and advances", async () => {
    const advanced = buildPracticeState(today, {
      sessionOverrides: { currentTaskId: "task-b" },
    });
    mockedRpc.completeCurrentTaskAndAdvance.mockResolvedValue(advanced);
    const { result } = await renderReady();

    await act(async () => {
      await result.current.completeAndNext();
    });

    expect(mockedRpc.saveState).toHaveBeenCalledTimes(1);
    expect(mockedRpc.completeCurrentTaskAndAdvance).toHaveBeenCalledTimes(1);
    expect(result.current.running).toBe(false);
    expect(result.current.session.currentTaskId).toBe("task-b");
  });

  it("done failure shows the existing operation error", async () => {
    mockedRpc.completeCurrentTaskAndAdvance.mockRejectedValue(new Error("done failed"));
    const { result } = await renderReady();
    const consoleErrorSpy = captureExpectedConsoleError();

    await act(async () => {
      await result.current.completeAndNext();
    });

    expect(result.current.operationError).toBe("done failed");
    expectExpectedConsoleError(consoleErrorSpy, "Failed to complete the current task.");
  });
});

describe("mutations", () => {
  beforeEach(() => {
    vi.stubGlobal("confirm", vi.fn(() => true));
  });

  it("pauses before selecting a task and applies the selection", async () => {
    const { result } = await renderReady();

    await act(async () => {
      await result.current.selectTask("task-b");
    });

    expect(mockedRpc.pauseSession).toHaveBeenCalledTimes(1);
    expect(result.current.session.currentTaskId).toBe("task-b");
  });

  it("aborts selection when pause fails", async () => {
    mockedRpc.pauseSession.mockRejectedValue(new Error("pause failed"));
    const { result } = await renderReady();
    const before = result.current.session.currentTaskId;
    const consoleErrorSpy = captureExpectedConsoleError();

    await act(async () => {
      await result.current.selectTask("task-b");
    });

    expect(result.current.operationError).toBe("pause failed");
    expect(result.current.session.currentTaskId).toBe(before);
    expectExpectedConsoleError(consoleErrorSpy, "Failed to pause before selecting that task.");
  });

  it("adds a new task to the template and selects it", async () => {
    const { result } = await renderReady();

    act(() => result.current.openAddModal());
    await act(async () => {
      await result.current.confirmModal("New Drill", "8");
    });

    expect(result.current.template.some((t) => t.name === "New Drill" && t.duration === 8)).toBe(
      true,
    );
    expect(result.current.modal).toBeNull();
  });

  it("defaults an empty name and an invalid duration when adding", async () => {
    const { result } = await renderReady();

    act(() => result.current.openAddModal());
    await act(async () => {
      await result.current.confirmModal("   ", "not-a-number");
    });

    const added = result.current.template[result.current.template.length - 1];
    expect(added.name).toBe("Task");
    expect(added.duration).toBe(5);
  });

  it("clamps a negative duration to a minimum of 1", async () => {
    const { result } = await renderReady();

    act(() => result.current.openAddModal());
    await act(async () => {
      await result.current.confirmModal("Short", "-3");
    });

    const added = result.current.template[result.current.template.length - 1];
    expect(added.duration).toBe(1);
  });

  it("edits an existing task in place, preserving its id", async () => {
    const { result } = await renderReady();

    act(() => result.current.openEditModal());
    await act(async () => {
      await result.current.confirmModal("Task A Renamed", "12");
    });

    const editedTask = result.current.template.find((t) => t.id === "task-a")!;
    expect(editedTask.name).toBe("Task A Renamed");
    expect(editedTask.duration).toBe(12);
  });

  it("deletes the selected task when confirmed", async () => {
    const { result } = await renderReady();

    await act(async () => {
      await result.current.deleteTask();
    });

    expect(result.current.template.some((t) => t.id === "task-a")).toBe(false);
  });

  it("does not delete or pause when the confirm dialog is cancelled", async () => {
    vi.stubGlobal("confirm", vi.fn(() => false));
    const { result } = await renderReady();

    await act(async () => {
      await result.current.deleteTask();
    });

    expect(mockedRpc.pauseSession).not.toHaveBeenCalled();
    expect(result.current.template.some((t) => t.id === "task-a")).toBe(true);
  });

  it("moves the selected task up one position", async () => {
    const { result } = await renderReady();

    await act(async () => {
      await result.current.selectTask("task-b");
    });
    await act(async () => {
      await result.current.moveTask(-1);
    });
    expect(result.current.template.map((t) => t.id)).toEqual(["task-b", "task-a"]);
  });

  it("moves the selected task down one position", async () => {
    const { result } = await renderReady();

    await act(async () => {
      await result.current.moveTask(1);
    });
    expect(result.current.template.map((t) => t.id)).toEqual(["task-b", "task-a"]);
  });

  it("does not move a task past either boundary", async () => {
    const { result } = await renderReady();
    mockedRpc.pauseSession.mockClear();

    await act(async () => {
      await result.current.moveTask(-1);
    });
    expect(mockedRpc.pauseSession).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.selectTask("task-b");
    });
    mockedRpc.pauseSession.mockClear();
    await act(async () => {
      await result.current.moveTask(1);
    });
    expect(mockedRpc.pauseSession).not.toHaveBeenCalled();
  });

  it("aborts a move when the pre-move pause fails", async () => {
    mockedRpc.pauseSession.mockRejectedValue(new Error("pause failed"));
    const { result } = await renderReady();
    const before = result.current.template.map((t) => t.id);
    const consoleErrorSpy = captureExpectedConsoleError();

    await act(async () => {
      await result.current.moveTask(1);
    });

    expect(result.current.operationError).toBe("pause failed");
    expect(result.current.template.map((t) => t.id)).toEqual(before);
    expectExpectedConsoleError(consoleErrorSpy, "Failed to pause before moving the task.");
  });

  it("resets the active task's progress without a pause round-trip", async () => {
    mockedRpc.completeCurrentTaskAndAdvance.mockResolvedValue(
      buildPracticeState(today, {
        sessionOverrides: {
          tasks: [
            { id: "task-a", name: "Task A", duration: 10, note: "", completedAt: "done", remainingSeconds: 0 },
            { id: "task-b", name: "Task B", duration: 5, note: "", completedAt: null, remainingSeconds: 300 },
          ],
        },
      }) as never,
    );
    const { result } = await renderReady();
    await act(async () => {
      await result.current.completeAndNext();
    });
    mockedRpc.pauseSession.mockClear();

    act(() => result.current.resetCurrent());

    expect(mockedRpc.pauseSession).not.toHaveBeenCalled();
  });

  it("hard resets the list when confirmed, applying the authoritative state", async () => {
    const { result } = await renderReady();
    mockedRpc.listSessionSummaries.mockClear();

    await act(async () => {
      await result.current.resetDefaults();
    });

    expect(mockedRpc.resetToDefaults).toHaveBeenCalledTimes(1);
    expect(mockedRpc.listSessionSummaries).toHaveBeenCalled();
  });

  it("does not reset when the confirm dialog is cancelled", async () => {
    vi.stubGlobal("confirm", vi.fn(() => false));
    const { result } = await renderReady();

    await act(async () => {
      await result.current.resetDefaults();
    });

    expect(mockedRpc.resetToDefaults).not.toHaveBeenCalled();
  });

  it("shows an error when pausing before a hard reset fails", async () => {
    mockedRpc.pauseSession.mockRejectedValue(new Error("pause failed"));
    const { result } = await renderReady();
    const consoleErrorSpy = captureExpectedConsoleError();

    await act(async () => {
      await result.current.resetDefaults();
    });

    expect(result.current.operationError).toBe("pause failed");
    expect(mockedRpc.resetToDefaults).not.toHaveBeenCalled();
    expectExpectedConsoleError(consoleErrorSpy, "Failed to pause before resetting the list.");
  });

  it("shows an error when resetToDefaults itself fails", async () => {
    mockedRpc.resetToDefaults.mockRejectedValue(new Error("reset failed"));
    const view = await renderReady();
    const { result } = view;
    const consoleErrorSpy = captureExpectedConsoleError();

    await act(() => result.current.resetDefaults());

    expect(result.current.operationError).toBe("reset failed");
    expect(mockedRpc.pauseSession).toHaveBeenCalledTimes(1);
    expectExpectedConsoleError(consoleErrorSpy, "Failed to reset the list.");
  });

  it("keeps the session stopped after successful mutations", async () => {
    const { result } = await renderReady();

    await act(async () => {
      await result.current.selectTask("task-b");
    });

    expect(result.current.running).toBe(false);
  });
});

describe("modal state", () => {
  it("opens the add modal with empty defaults while viewing today", async () => {
    const { result } = await renderReady();
    act(() => result.current.openAddModal());
    expect(result.current.modal).toEqual({ mode: "add", initialName: "", initialDuration: "5" });
  });

  it("opens the edit modal pre-filled with the selected task", async () => {
    const { result } = await renderReady();
    act(() => result.current.openEditModal());
    expect(result.current.modal).toMatchObject({
      mode: "edit",
      taskId: "task-a",
      initialName: "Task A",
      initialDuration: "10",
    });
  });

  it("does not open a modal while viewing history", async () => {
    const { result } = await renderReady();
    await act(async () => {
      await result.current.loadDate("2020-01-01");
    });

    act(() => result.current.openAddModal());
    expect(result.current.modal).toBeNull();

    act(() => result.current.openEditModal());
    expect(result.current.modal).toBeNull();
  });

  it("closes the modal", async () => {
    const { result } = await renderReady();
    act(() => result.current.openAddModal());
    act(() => result.current.closeModal());
    expect(result.current.modal).toBeNull();
  });
});

describe("date and history navigation", () => {
  it("uses readStateByDate for a past date and marks the view read-only", async () => {
    const { result } = await renderReady();

    await act(async () => {
      await result.current.loadDate("2020-01-01");
    });

    expect(mockedRpc.readStateByDate).toHaveBeenCalledWith("2020-01-01");
    expect(result.current.isViewingToday).toBe(false);
  });

  it("uses the active-state contract for today instead of readStateByDate", async () => {
    const { result } = await renderReady();
    mockedRpc.readStateByDate.mockClear();

    await act(async () => {
      await result.current.loadDate(today);
    });

    expect(mockedRpc.getSessionState).toHaveBeenCalled();
    expect(mockedRpc.readStateByDate).not.toHaveBeenCalledWith(today);
  });

  it("returning to today via goToToday resets read-only state", async () => {
    const { result } = await renderReady();
    await act(async () => {
      await result.current.loadDate("2020-01-01");
    });
    expect(result.current.isViewingToday).toBe(false);

    await act(async () => {
      await result.current.goToToday();
    });
    expect(result.current.isViewingToday).toBe(true);
  });

  it("aborts date navigation when the pre-navigation pause fails", async () => {
    mockedRpc.pauseSession.mockRejectedValue(new Error("pause failed"));
    const { result } = await renderReady();
    const consoleErrorSpy = captureExpectedConsoleError();

    await act(async () => {
      await result.current.loadDate("2020-01-01");
    });

    expect(result.current.operationError).toBe("pause failed");
    expect(result.current.isViewingToday).toBe(true);
    expectExpectedConsoleError(consoleErrorSpy, "Failed to pause before changing date.");
  });

  it("shows an error when the date fetch itself fails after a successful pause", async () => {
    mockedRpc.readStateByDate.mockRejectedValue(new Error("fetch failed"));
    const { result } = await renderReady();
    const consoleErrorSpy = captureExpectedConsoleError();
    let loaded = true;

    await act(async () => {
      loaded = await result.current.loadDate("2020-01-01");
    });

    expect(loaded).toBe(false);
    expect(result.current.operationError).toBe("fetch failed");
    expect(result.current.isViewingToday).toBe(true);
    expect(mockedRpc.readStateByDate).toHaveBeenCalledWith("2020-01-01");
    expectExpectedConsoleError(consoleErrorSpy, "Failed to load that date.");
  });

  it("ignores a stale earlier date response once a later selection has landed", async () => {
    const { result } = await renderReady();
    let resolveFirst: (state: PracticeState) => void = () => {};
    mockedRpc.readStateByDate.mockImplementation((date: string) => {
      if (date === "2020-01-01") {
        return new Promise<PracticeState>((resolve) => {
          resolveFirst = resolve;
        });
      }
      return Promise.resolve(buildPracticeState(date));
    });

    let firstCall: Promise<boolean>;
    await act(async () => {
      firstCall = result.current.loadDate("2020-01-01");
      await Promise.resolve();
    });
    await act(async () => {
      await result.current.loadDate("2020-06-01");
    });
    expect(result.current.session.date).toBe("2020-06-01");

    await act(async () => {
      resolveFirst(buildPracticeState("2020-01-01"));
      await firstCall!;
    });

    expect(result.current.session.date).toBe("2020-06-01");
  });
});

describe("polling", () => {
  it("applies authoritative state and status while running", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "setTimeout", "Date"] });
    try {
      mockedRpc.getRunningState.mockResolvedValue({ isRunning: true, isPaused: false });
      const polled = buildPracticeState(today, {
        sessionOverrides: { currentTaskId: "task-b" },
      });
      mockedRpc.getSessionState.mockResolvedValue(polled);

      const { result } = await renderRunningWithFakeTimers();

      await advancePollingInterval();
      expect(result.current.session.currentTaskId).toBe("task-b");
    } finally {
      vi.useRealTimers();
    }
  });

  it("surfaces an operation error on poll failure while preserving the last valid state", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "setTimeout", "Date"] });
    try {
      mockedRpc.getRunningState.mockResolvedValue({ isRunning: true, isPaused: false });
      const { result } = await renderRunningWithFakeTimers();
      const sessionBefore = result.current.session;

      mockedRpc.getSessionState.mockRejectedValue(new Error("poll failed"));
      const consoleErrorSpy = captureExpectedConsoleError();
      await advancePollingInterval();

      expect(result.current.operationError).toBe("poll failed");
      expect(result.current.session).toBe(sessionBefore);
      expectExpectedConsoleError(consoleErrorSpy, "Failed to sync the running session.");
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores a late poll response after unmount without throwing", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "setTimeout", "Date"] });
    try {
      mockedRpc.getRunningState.mockResolvedValue({ isRunning: true, isPaused: false });
      let resolvePoll: (state: PracticeState) => void = () => {};
      mockedRpc.getSessionState.mockImplementation(
        () =>
          new Promise<PracticeState>((resolve) => {
            resolvePoll = resolve;
          }),
      );

      const { unmount } = await renderRunningWithFakeTimers();

      await advancePollingInterval();
      unmount();

      expect(() => resolvePoll(buildPracticeState(today))).not.toThrow();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
