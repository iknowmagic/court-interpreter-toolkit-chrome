import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installChromeMock, type ChromeMock } from "../../test/chromeMock";

const RUNTIME_STORAGE_KEY = "session-manager-runtime-v1";
const DB_NAME = "court-interpreter";

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
    request.onblocked = () => resolve();
  });
}

let chromeMock: ChromeMock;
let dbConnectionResets: Array<() => void> = [];

/**
 * Simulates a service-worker module restart: a fresh module instance loses
 * all in-memory state (sessionState, ticker handle, init promise), while
 * chrome.storage.local (chromeMock) and IndexedDB (fake-indexeddb, global)
 * persist underneath, exactly like a real MV3 restart.
 *
 * Also grabs a reference to the freshly-registered indexedDB module so its
 * (lazily-opened) connection can be closed in afterEach — otherwise every
 * restart leaks an open IDBDatabase handle and the next test's
 * `deleteDatabase` call blocks forever waiting for connections to close.
 */
async function freshSessionManager() {
  vi.resetModules();
  const db = await import("../../shared/indexedDB");
  dbConnectionResets.push(db.__resetIndexedDbConnectionForTests);
  return import("../sessionManager");
}

beforeEach(async () => {
  // Delete any existing database under real timers first: fake-indexeddb's
  // internal close/delete machinery for an *existing* database needs real
  // timer callbacks to settle, which fake timers would otherwise freeze.
  await deleteDatabase(DB_NAME);

  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-04-10T12:00:00.000-07:00"));
  chromeMock = installChromeMock();
  dbConnectionResets = [];
});

afterEach(() => {
  for (const reset of dbConnectionResets) {
    reset();
  }
  vi.useRealTimers();
});

describe("sessionManager", () => {
  it("readStateByDate leaves active session state and toolbar unchanged", async () => {
    const sm = await freshSessionManager();
    const before = await sm.getSessionState();
    const beforeAction = { ...chromeMock.actionState };

    const historicalDate = "2020-01-01";
    const historical = await sm.readStateByDate(historicalDate);
    expect(historical.session.date).toBe(historicalDate);

    const after = await sm.getSessionState();
    expect(after).toEqual(before);
    expect(chromeMock.actionState).toEqual(beforeAction);
  });

  it("session summaries do not alter active state or toolbar", async () => {
    const sm = await freshSessionManager();
    const before = await sm.getSessionState();
    const beforeAction = { ...chromeMock.actionState };

    await sm.listSessionSummaries();

    const after = await sm.getSessionState();
    expect(after).toEqual(before);
    expect(chromeMock.actionState).toEqual(beforeAction);
  });

  it("publishes toolbar title, badge, and context menu on startup with no running timer runtime", async () => {
    const sm = await freshSessionManager();
    await sm.ensureInitialized();

    expect(chromeMock.actionState.title).toMatch(/^Stopped:/);
    expect(chromeMock.actionState.badgeText).not.toBe("DONE");

    const menuEntries = Array.from(chromeMock.contextMenuItems.values());
    const currentEntry = menuEntries.find((entry) =>
      String(entry.title).startsWith("Current Task:"),
    );
    expect(currentEntry).toBeDefined();

    const playEntry = chromeMock.contextMenuItems.get(sm.CONTEXT_MENU_PLAY);
    const stopEntry = chromeMock.contextMenuItems.get(sm.CONTEXT_MENU_STOP);
    const doneEntry = chromeMock.contextMenuItems.get(sm.CONTEXT_MENU_DONE);
    expect(playEntry?.enabled).toBe(true);
    expect(stopEntry?.enabled).toBe(false);
    expect(doneEntry?.enabled).toBe(true);
  });

  it("publishes a completed, stopped, unpaused state on startup after the final task's deadline has already passed", async () => {
    let sm = await freshSessionManager();
    await sm.newDay([{ id: "only", name: "Only Task", duration: 1 }]);
    await sm.startSession();

    vi.setSystemTime(Date.now() + 61_000); // past the final task's deadline

    sm = await freshSessionManager();
    await sm.ensureInitialized();

    expect(chromeMock.actionState.badgeText).toBe("DONE");
    expect(chromeMock.actionState.title).toMatch(/^Complete:/);
    expect((await sm.getRunningState())).toEqual({ isRunning: false, isPaused: false });

    const playEntry = chromeMock.contextMenuItems.get(sm.CONTEXT_MENU_PLAY);
    const stopEntry = chromeMock.contextMenuItems.get(sm.CONTEXT_MENU_STOP);
    const doneEntry = chromeMock.contextMenuItems.get(sm.CONTEXT_MENU_DONE);
    expect(playEntry?.enabled).toBe(false);
    expect(stopEntry?.enabled).toBe(false);
    expect(doneEntry?.enabled).toBe(false);

    const runtime = chromeMock.storageData[RUNTIME_STORAGE_KEY] as {
      isRunning: boolean;
      isPaused: boolean;
    };
    expect(runtime.isRunning).toBe(false);
    expect(runtime.isPaused).toBe(false);
  });

  it("starting a task persists a valid deadline runtime record", async () => {
    const sm = await freshSessionManager();
    const state = await sm.startSession();
    expect(state).not.toBeNull();

    const runtime = chromeMock.storageData[RUNTIME_STORAGE_KEY] as {
      version: number;
      isRunning: boolean;
      sessionDate: string | null;
      taskId: string | null;
      endsAtMs: number | null;
    };
    expect(runtime.version).toBe(1);
    expect(runtime.isRunning).toBe(true);
    expect(runtime.sessionDate).toBe(state!.session.date);
    expect(runtime.taskId).toBe(state!.session.currentTaskId);
    expect(runtime.endsAtMs).toBeGreaterThan(Date.now());
  });

  it("materializes elapsed time correctly after a simulated worker restart", async () => {
    let sm = await freshSessionManager();
    const started = await sm.startSession();
    const taskId = started!.session.currentTaskId!;
    const initialRemaining = started!.session.tasks.find((t) => t.id === taskId)!
      .remainingSeconds;

    // Move the clock forward without running any timers, simulating the
    // worker being suspended (no ticks fired) rather than staying alive.
    vi.setSystemTime(Date.now() + 60_000);

    sm = await freshSessionManager();
    const state = await sm.getSessionState();
    const task = state!.session.tasks.find((t) => t.id === taskId)!;
    expect(task.remainingSeconds).toBe(initialRemaining - 60);
  });

  it("is idempotent when materialized repeatedly at the same timestamp", async () => {
    const sm = await freshSessionManager();
    await sm.startSession();
    vi.setSystemTime(Date.now() + 60_000);
    const now = Date.now();

    const first = await sm.materializeRunningTimer(now);
    const second = await sm.materializeRunningTimer(now);
    expect(second).toEqual(first);
  });

  it("completes the task exactly once on expiry, selects the next task, and stops", async () => {
    const sm = await freshSessionManager();
    const started = await sm.startSession();
    const firstTaskId = started!.session.currentTaskId!;

    vi.setSystemTime(Date.now() + 301_000); // shadowing task duration is 5 minutes
    const now = Date.now();

    const materialized = await sm.materializeRunningTimer(now);
    const firstTask = materialized!.session.tasks.find((t) => t.id === firstTaskId)!;
    expect(firstTask.completedAt).not.toBeNull();
    expect(firstTask.remainingSeconds).toBe(0);
    expect(materialized!.session.currentTaskId).not.toBe(firstTaskId);
    expect(materialized!.session.done).toBe(false);
    expect((await sm.getRunningState()).isRunning).toBe(false);

    const secondTaskId = materialized!.session.currentTaskId!;
    const again = await sm.materializeRunningTimer(now);
    const secondTask = again!.session.tasks.find((t) => t.id === secondTaskId)!;
    expect(secondTask.completedAt).toBeNull();
  });

  it("marks the session done when the final task expires", async () => {
    const sm = await freshSessionManager();
    await sm.newDay([{ id: "only", name: "Only Task", duration: 1 }]);
    await sm.startSession();

    vi.setSystemTime(Date.now() + 61_000);
    const now = Date.now();

    const materialized = await sm.materializeRunningTimer(now);
    expect(materialized!.session.done).toBe(true);
    expect(materialized!.session.currentTaskId).toBe("only");
    expect(materialized!.session.tasks[0].completedAt).not.toBeNull();
  });

  it("getRunningState reconciles an expired non-final deadline before returning status", async () => {
    const sm = await freshSessionManager();
    const started = await sm.startSession();
    const firstTaskId = started!.session.currentTaskId!;

    // Move the clock past the deadline without letting the ticker/alarm run.
    vi.setSystemTime(Date.now() + 301_000);

    const status = await sm.getRunningState();
    expect(status).toEqual({ isRunning: false, isPaused: true });

    const state = await sm.getSessionState();
    const firstTask = state!.session.tasks.find((t) => t.id === firstTaskId)!;
    expect(firstTask.completedAt).not.toBeNull();

    const runtime = chromeMock.storageData[RUNTIME_STORAGE_KEY] as {
      isRunning: boolean;
      isPaused: boolean;
    };
    expect(runtime.isRunning).toBe(false);
    expect(runtime.isPaused).toBe(true);
  });

  it("getRunningState reconciles an expired final-task deadline as stopped and unpaused", async () => {
    const sm = await freshSessionManager();
    await sm.newDay([{ id: "only", name: "Only Task", duration: 1 }]);
    await sm.startSession();

    vi.setSystemTime(Date.now() + 61_000);

    const status = await sm.getRunningState();
    expect(status).toEqual({ isRunning: false, isPaused: false });

    const state = await sm.getSessionState();
    expect(state!.session.done).toBe(true);

    const runtime = chromeMock.storageData[RUNTIME_STORAGE_KEY] as {
      isRunning: boolean;
      isPaused: boolean;
    };
    expect(runtime.isRunning).toBe(false);
    expect(runtime.isPaused).toBe(false);
  });

  it("pausing after a simulated suspension persists correct remaining time and clears the running runtime", async () => {
    const sm = await freshSessionManager();
    await sm.startSession();

    vi.setSystemTime(Date.now() + 45_000);
    const paused = await sm.pauseSession();
    const task = paused!.session.tasks.find(
      (t) => t.id === paused!.session.currentTaskId,
    )!;
    expect(task.remainingSeconds).toBe(300 - 45);

    const runtime = chromeMock.storageData[RUNTIME_STORAGE_KEY] as {
      isRunning: boolean;
      endsAtMs: number | null;
    };
    expect(runtime.isRunning).toBe(false);
    expect(runtime.endsAtMs).toBeNull();
    expect((await sm.getRunningState()).isRunning).toBe(false);
  });

  it("pausing after the final task's deadline reports stopped and not paused", async () => {
    const sm = await freshSessionManager();
    await sm.newDay([{ id: "only", name: "Only Task", duration: 1 }]);
    await sm.startSession();

    vi.setSystemTime(Date.now() + 61_000); // past the final task's deadline

    const paused = await sm.pauseSession();
    expect(paused!.session.done).toBe(true);
    expect(await sm.getRunningState()).toEqual({ isRunning: false, isPaused: false });

    const runtime = chromeMock.storageData[RUNTIME_STORAGE_KEY] as {
      isRunning: boolean;
      isPaused: boolean;
    };
    expect(runtime.isRunning).toBe(false);
    expect(runtime.isPaused).toBe(false);
  });

  it("Done on the final task reports stopped, not paused", async () => {
    const sm = await freshSessionManager();
    await sm.newDay([{ id: "only", name: "Only Task", duration: 5 }]);
    await sm.startSession();

    const result = await sm.completeCurrentTaskAndAdvanceNoStart();
    expect(result!.session.done).toBe(true);
    expect(await sm.getRunningState()).toEqual({ isRunning: false, isPaused: false });

    const runtime = chromeMock.storageData[RUNTIME_STORAGE_KEY] as {
      isRunning: boolean;
      isPaused: boolean;
    };
    expect(runtime.isRunning).toBe(false);
    expect(runtime.isPaused).toBe(false);
  });

  it("Done with another incomplete task reports paused", async () => {
    const sm = await freshSessionManager();
    await sm.newDay([
      { id: "first", name: "First Task", duration: 5 },
      { id: "second", name: "Second Task", duration: 5 },
    ]);
    await sm.startSession();

    const result = await sm.completeCurrentTaskAndAdvanceNoStart();
    expect(result!.session.done).toBe(false);
    expect(result!.session.currentTaskId).toBe("second");
    expect(await sm.getRunningState()).toEqual({ isRunning: false, isPaused: true });

    const runtime = chromeMock.storageData[RUNTIME_STORAGE_KEY] as {
      isRunning: boolean;
      isPaused: boolean;
    };
    expect(runtime.isRunning).toBe(false);
    expect(runtime.isPaused).toBe(true);
  });

  it("stops safely without overwriting session progress when runtime metadata is malformed", async () => {
    let sm = await freshSessionManager();
    const started = await sm.startSession();
    const taskId = started!.session.currentTaskId!;
    const originalRemaining = started!.session.tasks.find((t) => t.id === taskId)!
      .remainingSeconds;

    chromeMock.storageData[RUNTIME_STORAGE_KEY] = {
      version: 1,
      isRunning: true,
      isPaused: false,
      sessionDate: started!.session.date,
      taskId: "does-not-exist",
      endsAtMs: Date.now() + 60_000,
    };

    sm = await freshSessionManager();
    const state = await sm.getSessionState();
    const task = state!.session.tasks.find((t) => t.id === taskId)!;
    expect(task.remainingSeconds).toBe(originalRemaining);
    expect(task.completedAt).toBeNull();
    expect((await sm.getRunningState()).isRunning).toBe(false);
  });

  it("is safe when a request arrives immediately after a fresh module load", async () => {
    const sm = await freshSessionManager();
    const [state, running] = await Promise.all([
      sm.getSessionState(),
      sm.getRunningState(),
    ]);
    expect(state).not.toBeNull();
    expect(running).toEqual({ isRunning: false, isPaused: false });
  });

  it("Play, Stop, and Done context-menu commands preserve their documented behavior", async () => {
    const sm = await freshSessionManager();

    await sm.handleActionContextMenuClick(sm.CONTEXT_MENU_PLAY);
    expect((await sm.getRunningState()).isRunning).toBe(true);

    await sm.handleActionContextMenuClick(sm.CONTEXT_MENU_STOP);
    expect((await sm.getRunningState()).isRunning).toBe(false);

    const before = await sm.getSessionState();
    const firstTaskId = before!.session.currentTaskId;

    await sm.handleActionContextMenuClick(sm.CONTEXT_MENU_DONE);

    const after = await sm.getSessionState();
    expect(
      after!.session.tasks.find((t) => t.id === firstTaskId)!.completedAt,
    ).not.toBeNull();
    expect(after!.session.currentTaskId).not.toBe(firstTaskId);
    expect((await sm.getRunningState()).isRunning).toBe(false);
  });

  it("coalesces concurrent materialization calls into a single authoritative transition", async () => {
    const sm = await freshSessionManager();
    const db = await import("../../shared/indexedDB");
    await sm.startSession();

    vi.setSystemTime(Date.now() + 301_000); // expire the task
    const now = Date.now();

    const saveStateSpy = vi.spyOn(db, "saveState");
    saveStateSpy.mockClear();

    const [first, second, third, status] = await Promise.all([
      sm.materializeRunningTimer(now),
      sm.materializeRunningTimer(now),
      sm.materializeRunningTimer(now),
      sm.getRunningState(),
    ]);

    // Every concurrent caller receives the exact same authoritative result.
    expect(first).toBe(second);
    expect(second).toBe(third);
    // Only one completion/save transition occurred, not three or four:
    // getRunningState's own materializeRunningTimer call shared the in-flight result.
    expect(saveStateSpy).toHaveBeenCalledTimes(1);
    expect(first!.session.tasks.find((t) => t.completedAt !== null)).toBeTruthy();
    expect(status).toEqual({ isRunning: false, isPaused: true });

    // A later materialization (after the first settles) still runs normally.
    saveStateSpy.mockClear();
    const later = await sm.materializeRunningTimer(now);
    expect(later).toEqual(first);
  });

  it("plays the completion alarm at most once across concurrent materialization calls", async () => {
    const sm = await freshSessionManager();
    await sm.setCompletionAlarmSetting(true);
    await sm.startSession();

    vi.setSystemTime(Date.now() + 301_000);
    const now = Date.now();

    await Promise.all([
      sm.materializeRunningTimer(now),
      sm.materializeRunningTimer(now),
    ]);

    expect(chromeMock.sentMessages).toHaveLength(1);
  });

  it("clears the single-flight slot after a rejected materialization so a later call can retry", async () => {
    const sm = await freshSessionManager();
    const db = await import("../../shared/indexedDB");
    await sm.startSession();

    vi.setSystemTime(Date.now() + 301_000);
    const now = Date.now();

    const saveStateSpy = vi
      .spyOn(db, "saveState")
      .mockRejectedValueOnce(new Error("simulated save failure"));

    await expect(sm.materializeRunningTimer(now)).rejects.toThrow(
      "simulated save failure",
    );

    saveStateSpy.mockRestore();

    const recovered = await sm.materializeRunningTimer(now);
    expect(recovered).not.toBeNull();
    expect(
      recovered!.session.tasks.find((t) => t.completedAt !== null),
    ).toBeTruthy();
  });

  it("triggers the completion alarm exactly once when enabled and a task newly completes", async () => {
    const sm = await freshSessionManager();
    await sm.setCompletionAlarmSetting(true);
    await sm.startSession();

    vi.setSystemTime(Date.now() + 301_000);
    const now = Date.now();

    await sm.materializeRunningTimer(now);
    expect(chromeMock.sentMessages).toHaveLength(1);

    await sm.materializeRunningTimer(now);
    expect(chromeMock.sentMessages).toHaveLength(1);
  });

  it("runs the periodic ticker and logs when a tick's materialization rejects", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date("2026-04-10T12:00:00.000-07:00"));
    const sm = await freshSessionManager();
    const db = await import("../../shared/indexedDB");
    await sm.startSession();

    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const saveStateSpy = vi
      .spyOn(db, "saveState")
      .mockRejectedValueOnce(new Error("tick failure"));

    await vi.advanceTimersByTimeAsync(1000);

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Failed to materialize running timer",
      expect.any(Error),
    );
    saveStateSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe("prior-day rollover", () => {
    it("carries remaining time on the stale day forward without completing the task", async () => {
      vi.setSystemTime(new Date("2026-04-10T23:59:00.000-07:00"));
      const sm = await freshSessionManager();
      await sm.startSession();

      vi.setSystemTime(new Date("2026-04-11T00:01:00.000-07:00"));
      await sm.materializeRunningTimer(Date.now());

      const stale = await sm.readStateByDate("2026-04-10");
      const staleTask = stale.session.tasks.find((t) => t.id === "shadowing")!;
      expect(staleTask.completedAt).toBeNull();
      expect(staleTask.remainingSeconds).toBe(180);

      const today = await sm.getSessionState();
      expect(today!.session.date).toBe("2026-04-11");
      expect((await sm.getRunningState()).isRunning).toBe(false);
    });

    it("completes the stale task and advances it when its deadline already passed before rollover", async () => {
      vi.setSystemTime(new Date("2026-04-10T23:59:00.000-07:00"));
      const sm = await freshSessionManager();
      await sm.setCompletionAlarmSetting(true);
      await sm.startSession();

      vi.setSystemTime(new Date("2026-04-11T00:10:00.000-07:00"));
      await sm.materializeRunningTimer(Date.now());

      const stale = await sm.readStateByDate("2026-04-10");
      const staleTask = stale.session.tasks.find((t) => t.id === "shadowing")!;
      expect(staleTask.completedAt).not.toBeNull();
      expect(staleTask.remainingSeconds).toBe(0);
      expect(stale.session.currentTaskId).toBe("vocab-1");
      expect(chromeMock.sentMessages).toHaveLength(1);

      const today = await sm.getSessionState();
      expect(today!.session.date).toBe("2026-04-11");
    });
  });

  describe("saveSession", () => {
    it("persists the given state and refreshes the toolbar", async () => {
      const sm = await freshSessionManager();
      const before = await sm.getSessionState();
      const edited = {
        ...before!,
        session: { ...before!.session, tasks: before!.session.tasks },
      };
      edited.session.tasks[0].note = "practiced hard";

      const saved = await sm.saveSession(edited);
      expect(saved.session.tasks[0].note).toBe("practiced hard");

      const reloaded = await sm.getSessionState();
      expect(reloaded!.session.tasks[0].note).toBe("practiced hard");
    });
  });

  describe("resetToDefaults", () => {
    it("hard resets progress but preserves the completion-alarm setting", async () => {
      const sm = await freshSessionManager();
      await sm.setCompletionAlarmSetting(true);
      await sm.startSession();

      const reset = await sm.resetToDefaults();
      expect(reset.session.tasks.every((t) => t.completedAt === null)).toBe(true);
      expect((await sm.getRunningState())).toEqual({ isRunning: false, isPaused: false });
      expect(await sm.getCompletionAlarmSetting()).toBe(true);

      const runtime = chromeMock.storageData[RUNTIME_STORAGE_KEY] as {
        isRunning: boolean;
        endsAtMs: number | null;
      };
      expect(runtime.isRunning).toBe(false);
      expect(runtime.endsAtMs).toBeNull();
    });
  });

  describe("newDay", () => {
    it("starts a fresh day with an explicit template", async () => {
      const sm = await freshSessionManager();
      const result = await sm.newDay([{ id: "solo", name: "Solo", duration: 3 }]);
      expect(result.template).toEqual([{ id: "solo", name: "Solo", duration: 3 }]);
      expect(result.session.tasks).toHaveLength(1);
      expect((await sm.getRunningState()).isRunning).toBe(false);
    });

    it("starts a fresh day reusing the current template when none is given", async () => {
      const sm = await freshSessionManager();
      const before = await sm.getSessionState();
      const result = await sm.newDay();
      expect(result.template).toEqual(before!.template);
    });
  });

  describe("editTemplate", () => {
    it("reconciles the session with an edited template while stopped", async () => {
      const sm = await freshSessionManager();
      const before = await sm.getSessionState();
      const nextTemplate = before!.template.map((task) =>
        task.id === "shadowing" ? { ...task, name: "Shadowing Renamed" } : task,
      );

      const result = await sm.editTemplate(nextTemplate);
      expect(
        result.session.tasks.find((t) => t.id === "shadowing")!.name,
      ).toBe("Shadowing Renamed");
      expect((await sm.getRunningState()).isRunning).toBe(false);
    });

    it("stops the ticker when reconciliation leaves the session done", async () => {
      const sm = await freshSessionManager();
      await sm.newDay([{ id: "only", name: "Only Task", duration: 1 }]);
      await sm.startSession();
      await sm.completeCurrentTaskAndAdvanceNoStart();

      const before = await sm.getSessionState();
      expect(before!.session.done).toBe(true);

      const nextTemplate = before!.template.map((task) => ({
        ...task,
        name: `${task.name} v2`,
      }));
      const result = await sm.editTemplate(nextTemplate);
      expect(result.session.done).toBe(true);
      expect((await sm.getRunningState()).isRunning).toBe(false);
    });
  });

  describe("startSession edge cases", () => {
    it("resets a completed selected task for replay instead of refusing to start", async () => {
      const sm = await freshSessionManager();
      await sm.newDay([
        { id: "first", name: "First", duration: 5 },
        { id: "second", name: "Second", duration: 5 },
      ]);
      await sm.startSession();
      const afterDone = await sm.completeCurrentTaskAndAdvanceNoStart();
      expect(afterDone!.session.currentTaskId).toBe("second");

      // Simulate the UI re-selecting the already-completed first task.
      const reselected = {
        ...afterDone!,
        session: { ...afterDone!.session, currentTaskId: "first" },
      };
      await sm.saveSession(reselected);

      const started = await sm.startSession();
      const firstTask = started!.session.tasks.find((t) => t.id === "first")!;
      expect(firstTask.completedAt).toBeNull();
      expect(firstTask.remainingSeconds).toBe(300);
      expect(started!.session.currentTaskId).toBe("first");
      expect((await sm.getRunningState()).isRunning).toBe(true);
    });
  });

  describe("getCompletionAlarmSetting", () => {
    it("defaults to disabled when no setting has been stored", async () => {
      const sm = await freshSessionManager();
      expect(await sm.getCompletionAlarmSetting()).toBe(false);
    });

    it("parses a previously stored enabled setting", async () => {
      chromeMock.storageData["session-manager-settings"] = {
        completionAlarmEnabled: true,
      };
      const sm = await freshSessionManager();
      expect(await sm.getCompletionAlarmSetting()).toBe(true);
    });

    it("coerces a non-boolean stored value", async () => {
      chromeMock.storageData["session-manager-settings"] = {
        completionAlarmEnabled: "yes",
      };
      const sm = await freshSessionManager();
      expect(await sm.getCompletionAlarmSetting()).toBe(true);
    });
  });

  describe("settings storage failures", () => {
    it("falls back to defaults without throwing when reading settings storage fails", async () => {
      const sm = await freshSessionManager();
      vi.mocked(chromeMock.chrome.storage.local.get).mockRejectedValueOnce(
        new Error("storage read failure"),
      );
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      expect(await sm.getCompletionAlarmSetting()).toBe(false);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Failed to load session manager settings",
        expect.any(Error),
      );
      consoleErrorSpy.mockRestore();
    });

    it("keeps the in-memory setting even when persisting it to storage fails", async () => {
      const sm = await freshSessionManager();
      vi.mocked(chromeMock.chrome.storage.local.set).mockRejectedValueOnce(
        new Error("storage write failure"),
      );
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const result = await sm.setCompletionAlarmSetting(true);
      expect(result).toBe(true);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Failed to persist session manager settings",
        expect.any(Error),
      );
      consoleErrorSpy.mockRestore();
    });

    it("no-ops safely when chrome.storage.local is unavailable", async () => {
      const sm = await freshSessionManager();
      const originalStorage = chromeMock.chrome.storage;
      (chromeMock.chrome as unknown as { storage?: unknown }).storage = undefined;

      await expect(sm.getCompletionAlarmSetting()).resolves.toBe(false);
      await expect(sm.setCompletionAlarmSetting(true)).resolves.toBe(true);

      (chromeMock.chrome as unknown as { storage?: unknown }).storage = originalStorage;
    });
  });

  describe("completion alarm offscreen document handling", () => {
    it("does not attempt to play an alarm when the setting is disabled", async () => {
      const sm = await freshSessionManager();
      await sm.newDay([{ id: "only", name: "Only", duration: 1 }]);
      await sm.startSession();

      await sm.completeCurrentTaskAndAdvanceNoStart();
      expect(chromeMock.sentMessages).toHaveLength(0);
    });

    it("creates the offscreen document when absent and sends the alarm once", async () => {
      const sm = await freshSessionManager();
      await sm.setCompletionAlarmSetting(true);
      await sm.newDay([{ id: "only", name: "Only", duration: 1 }]);
      await sm.startSession();

      await sm.completeCurrentTaskAndAdvanceNoStart();
      expect(chromeMock.chrome.offscreen!.createDocument).toHaveBeenCalledTimes(1);
      expect(chromeMock.sentMessages).toHaveLength(1);
    });

    it("reuses an existing offscreen document and still sends the alarm", async () => {
      const sm = await freshSessionManager();
      await sm.setCompletionAlarmSetting(true);
      vi.mocked(chromeMock.chrome.offscreen!.createDocument).mockRejectedValueOnce(
        new Error("Only a single offscreen document may be created"),
      );
      await sm.newDay([{ id: "only", name: "Only", duration: 1 }]);
      await sm.startSession();

      await sm.completeCurrentTaskAndAdvanceNoStart();
      expect(chromeMock.sentMessages).toHaveLength(1);
    });

    it("skips the alarm without throwing when the offscreen document fails to initialize", async () => {
      const sm = await freshSessionManager();
      await sm.setCompletionAlarmSetting(true);
      vi.mocked(chromeMock.chrome.offscreen!.createDocument).mockRejectedValueOnce(
        new Error("boom"),
      );
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      await sm.newDay([{ id: "only", name: "Only", duration: 1 }]);
      await sm.startSession();

      await sm.completeCurrentTaskAndAdvanceNoStart();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Failed to initialize offscreen audio document",
        expect.any(Error),
      );
      expect(chromeMock.sentMessages).toHaveLength(0);
      consoleErrorSpy.mockRestore();
    });

    it("skips the alarm without throwing when chrome.offscreen is unsupported", async () => {
      const sm = await freshSessionManager();
      await sm.setCompletionAlarmSetting(true);
      (chromeMock.chrome as unknown as { offscreen?: unknown }).offscreen = undefined;
      await sm.newDay([{ id: "only", name: "Only", duration: 1 }]);
      await sm.startSession();

      await sm.completeCurrentTaskAndAdvanceNoStart();
      expect(chromeMock.sentMessages).toHaveLength(0);
    });

    it("logs without throwing when sending the alarm message itself fails", async () => {
      const sm = await freshSessionManager();
      await sm.setCompletionAlarmSetting(true);
      vi.mocked(chromeMock.chrome.runtime.sendMessage).mockRejectedValueOnce(
        new Error("no listener"),
      );
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      await sm.newDay([{ id: "only", name: "Only", duration: 1 }]);
      await sm.startSession();

      await sm.completeCurrentTaskAndAdvanceNoStart();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Failed to trigger completion alarm",
        expect.any(Error),
      );
      consoleErrorSpy.mockRestore();
    });
  });

  describe("context menu error handling", () => {
    it("logs the create-time chrome.runtime.lastError without throwing", async () => {
      const sm = await freshSessionManager();
      (chromeMock.chrome.runtime as unknown as { lastError?: { message: string } }).lastError = {
        message: "duplicate id",
      };
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await sm.ensureInitialized();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Failed to create context menu"),
        "duplicate id",
      );
      (chromeMock.chrome.runtime as unknown as { lastError?: unknown }).lastError = undefined;
      consoleErrorSpy.mockRestore();
    });

    it("recovers by reinitializing the menu after a single failed update", async () => {
      const sm = await freshSessionManager();
      await sm.ensureInitialized();

      vi.mocked(chromeMock.chrome.contextMenus.update).mockRejectedValueOnce(
        new Error("stale menu"),
      );

      await expect(sm.startSession()).resolves.not.toBeNull();
      const playEntry = chromeMock.contextMenuItems.get(sm.CONTEXT_MENU_PLAY);
      expect(playEntry).toBeDefined();
    });

    it("logs without throwing when the menu retry itself also fails", async () => {
      const sm = await freshSessionManager();
      await sm.ensureInitialized();

      vi.mocked(chromeMock.chrome.contextMenus.update).mockRejectedValue(
        new Error("permanently stale"),
      );
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await sm.startSession();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Failed to refresh action context menu",
        expect.any(Error),
      );
      consoleErrorSpy.mockRestore();
    });
  });

  describe("handleBackgroundTickAlarm", () => {
    it("materializes the running timer when the alarm name matches", async () => {
      const sm = await freshSessionManager();
      await sm.startSession();
      vi.setSystemTime(Date.now() + 45_000);

      sm.handleBackgroundTickAlarm({ name: "practice-session-tick" } as chrome.alarms.Alarm);
      await Promise.resolve();
      await Promise.resolve();

      const state = await sm.getSessionState();
      const task = state!.session.tasks.find((t) => t.id === state!.session.currentTaskId)!;
      expect(task.remainingSeconds).toBe(300 - 45);
    });

    it("does nothing when the alarm name does not match the ticker alarm", async () => {
      const sm = await freshSessionManager();
      const before = await sm.getSessionState();

      sm.handleBackgroundTickAlarm({ name: "some-other-alarm" } as chrome.alarms.Alarm);
      await Promise.resolve();

      const after = await sm.getSessionState();
      expect(after).toEqual(before);
    });

    it("logs without throwing when materialization from the alarm rejects", async () => {
      const sm = await freshSessionManager();
      const db = await import("../../shared/indexedDB");
      await sm.startSession();
      vi.setSystemTime(Date.now() + 301_000);

      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const saveStateSpy = vi
        .spyOn(db, "saveState")
        .mockRejectedValueOnce(new Error("alarm materialize failure"));

      sm.handleBackgroundTickAlarm({ name: "practice-session-tick" } as chrome.alarms.Alarm);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Failed to materialize running timer from alarm",
        expect.any(Error),
      );
      saveStateSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    });
  });

  describe("toolbar context menu across states", () => {
    it("shows Play only enabled when there is an active task and the session is stopped", async () => {
      const sm = await freshSessionManager();
      await sm.ensureInitialized();
      const playEntry = chromeMock.contextMenuItems.get(sm.CONTEXT_MENU_PLAY);
      const stopEntry = chromeMock.contextMenuItems.get(sm.CONTEXT_MENU_STOP);
      const doneEntry = chromeMock.contextMenuItems.get(sm.CONTEXT_MENU_DONE);
      expect(playEntry?.enabled).toBe(true);
      expect(stopEntry?.enabled).toBe(false);
      expect(doneEntry?.enabled).toBe(true);
    });

    it("shows Stop enabled and Play/Done disabled while running", async () => {
      const sm = await freshSessionManager();
      await sm.startSession();
      const playEntry = chromeMock.contextMenuItems.get(sm.CONTEXT_MENU_PLAY);
      const stopEntry = chromeMock.contextMenuItems.get(sm.CONTEXT_MENU_STOP);
      expect(playEntry?.enabled).toBe(false);
      expect(stopEntry?.enabled).toBe(true);
    });

    it("disables all task actions once the whole session is complete", async () => {
      const sm = await freshSessionManager();
      await sm.newDay([{ id: "only", name: "Only", duration: 1 }]);
      await sm.startSession();
      await sm.completeCurrentTaskAndAdvanceNoStart();

      const playEntry = chromeMock.contextMenuItems.get(sm.CONTEXT_MENU_PLAY);
      const stopEntry = chromeMock.contextMenuItems.get(sm.CONTEXT_MENU_STOP);
      const doneEntry = chromeMock.contextMenuItems.get(sm.CONTEXT_MENU_DONE);
      expect(playEntry?.enabled).toBe(false);
      expect(stopEntry?.enabled).toBe(false);
      expect(doneEntry?.enabled).toBe(false);
    });
  });
});
