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
    expect(sm.getRunningState().isRunning).toBe(false);

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
    expect(sm.getRunningState().isRunning).toBe(false);
  });

  it("pausing after the final task's deadline reports stopped and not paused", async () => {
    const sm = await freshSessionManager();
    await sm.newDay([{ id: "only", name: "Only Task", duration: 1 }]);
    await sm.startSession();

    vi.setSystemTime(Date.now() + 61_000); // past the final task's deadline

    const paused = await sm.pauseSession();
    expect(paused!.session.done).toBe(true);
    expect(sm.getRunningState()).toEqual({ isRunning: false, isPaused: false });

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
    expect(sm.getRunningState()).toEqual({ isRunning: false, isPaused: false });

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
    expect(sm.getRunningState()).toEqual({ isRunning: false, isPaused: true });

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
    expect(sm.getRunningState().isRunning).toBe(false);
  });

  it("is safe when a request arrives immediately after a fresh module load", async () => {
    const sm = await freshSessionManager();
    const [state, running] = await Promise.all([
      sm.getSessionState(),
      Promise.resolve(sm.getRunningState()),
    ]);
    expect(state).not.toBeNull();
    expect(running).toEqual({ isRunning: false, isPaused: false });
  });

  it("Play, Stop, and Done context-menu commands preserve their documented behavior", async () => {
    const sm = await freshSessionManager();

    await sm.handleActionContextMenuClick(sm.CONTEXT_MENU_PLAY);
    expect(sm.getRunningState().isRunning).toBe(true);

    await sm.handleActionContextMenuClick(sm.CONTEXT_MENU_STOP);
    expect(sm.getRunningState().isRunning).toBe(false);

    const before = await sm.getSessionState();
    const firstTaskId = before!.session.currentTaskId;

    await sm.handleActionContextMenuClick(sm.CONTEXT_MENU_DONE);

    const after = await sm.getSessionState();
    expect(
      after!.session.tasks.find((t) => t.id === firstTaskId)!.completedAt,
    ).not.toBeNull();
    expect(after!.session.currentTaskId).not.toBe(firstTaskId);
    expect(sm.getRunningState().isRunning).toBe(false);
  });

  it("coalesces concurrent materialization calls into a single authoritative transition", async () => {
    const sm = await freshSessionManager();
    const db = await import("../../shared/indexedDB");
    await sm.startSession();

    vi.setSystemTime(Date.now() + 301_000); // expire the task
    const now = Date.now();

    const saveStateSpy = vi.spyOn(db, "saveState");
    saveStateSpy.mockClear();

    const [first, second, third] = await Promise.all([
      sm.materializeRunningTimer(now),
      sm.materializeRunningTimer(now),
      sm.materializeRunningTimer(now),
    ]);

    // Every concurrent caller receives the exact same authoritative result.
    expect(first).toBe(second);
    expect(second).toBe(third);
    // Only one completion/save transition occurred, not three.
    expect(saveStateSpy).toHaveBeenCalledTimes(1);
    expect(first!.session.tasks.find((t) => t.completedAt !== null)).toBeTruthy();

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
});
