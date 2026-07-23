import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installChromeMock, type ChromeMock } from "../../test/chromeMock";
import {
  TIMER_RUNTIME_STORAGE_KEY,
  isValidPersistedTimerRuntime,
  loadTimerRuntime,
  remainingSecondsFromDeadline,
  runningRuntime,
  saveTimerRuntime,
  stoppedRuntime,
  type PersistedTimerRuntime,
} from "../timerRuntime";

let chromeMock: ChromeMock;

beforeEach(() => {
  chromeMock = installChromeMock();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("isValidPersistedTimerRuntime", () => {
  const valid: PersistedTimerRuntime = {
    version: 1,
    isRunning: true,
    isPaused: false,
    sessionDate: "2026-04-10",
    taskId: "shadowing",
    endsAtMs: 1000,
  };

  it("accepts a well-formed running runtime", () => {
    expect(isValidPersistedTimerRuntime(valid)).toBe(true);
  });

  it("accepts a well-formed stopped runtime with null date/task/deadline", () => {
    expect(
      isValidPersistedTimerRuntime({
        version: 1,
        isRunning: false,
        isPaused: true,
        sessionDate: null,
        taskId: null,
        endsAtMs: null,
      }),
    ).toBe(true);
  });

  it("rejects null and non-object input", () => {
    expect(isValidPersistedTimerRuntime(null)).toBe(false);
    expect(isValidPersistedTimerRuntime(undefined)).toBe(false);
    expect(isValidPersistedTimerRuntime("not an object")).toBe(false);
    expect(isValidPersistedTimerRuntime(42)).toBe(false);
  });

  it("rejects the wrong version", () => {
    expect(isValidPersistedTimerRuntime({ ...valid, version: 2 })).toBe(false);
  });

  it("rejects non-boolean isRunning or isPaused", () => {
    expect(
      isValidPersistedTimerRuntime({ ...valid, isRunning: "true" }),
    ).toBe(false);
    expect(
      isValidPersistedTimerRuntime({ ...valid, isPaused: "false" }),
    ).toBe(false);
  });

  it("rejects a non-string, non-null sessionDate", () => {
    expect(
      isValidPersistedTimerRuntime({ ...valid, sessionDate: 20260410 }),
    ).toBe(false);
  });

  it("rejects a non-string, non-null taskId", () => {
    expect(isValidPersistedTimerRuntime({ ...valid, taskId: 7 })).toBe(false);
  });

  it("rejects a non-number, non-null endsAtMs", () => {
    expect(
      isValidPersistedTimerRuntime({ ...valid, endsAtMs: "1000" }),
    ).toBe(false);
  });

  it("rejects a running runtime with a null deadline", () => {
    expect(
      isValidPersistedTimerRuntime({ ...valid, isRunning: true, endsAtMs: null }),
    ).toBe(false);
  });

  it("rejects a running runtime with a non-finite deadline", () => {
    expect(
      isValidPersistedTimerRuntime({ ...valid, isRunning: true, endsAtMs: Infinity }),
    ).toBe(false);
    expect(
      isValidPersistedTimerRuntime({ ...valid, isRunning: true, endsAtMs: NaN }),
    ).toBe(false);
  });

  it("accepts a stopped runtime even with a null deadline", () => {
    expect(
      isValidPersistedTimerRuntime({ ...valid, isRunning: false, endsAtMs: null }),
    ).toBe(true);
  });
});

describe("runningRuntime / stoppedRuntime factories", () => {
  it("builds a running runtime record", () => {
    expect(runningRuntime("2026-04-10", "shadowing", 5000)).toEqual({
      version: 1,
      isRunning: true,
      isPaused: false,
      sessionDate: "2026-04-10",
      taskId: "shadowing",
      endsAtMs: 5000,
    });
  });

  it("builds a stopped runtime record", () => {
    expect(stoppedRuntime("2026-04-10", "shadowing", true)).toEqual({
      version: 1,
      isRunning: false,
      isPaused: true,
      sessionDate: "2026-04-10",
      taskId: "shadowing",
      endsAtMs: null,
    });
  });

  it("builds a fully-cleared stopped runtime", () => {
    expect(stoppedRuntime(null, null, false)).toEqual({
      version: 1,
      isRunning: false,
      isPaused: false,
      sessionDate: null,
      taskId: null,
      endsAtMs: null,
    });
  });
});

describe("remainingSecondsFromDeadline", () => {
  it("rounds up partial seconds with Math.ceil", () => {
    expect(remainingSecondsFromDeadline(10_500, 9_000)).toBe(2);
    expect(remainingSecondsFromDeadline(10_000, 9_000)).toBe(1);
  });

  it("clamps an already-elapsed deadline to zero", () => {
    expect(remainingSecondsFromDeadline(1_000, 5_000)).toBe(0);
  });

  it("returns zero exactly at the deadline", () => {
    expect(remainingSecondsFromDeadline(5_000, 5_000)).toBe(0);
  });
});

describe("loadTimerRuntime", () => {
  it("returns null when chrome.storage.local is unavailable", async () => {
    (chromeMock.chrome as unknown as { storage?: unknown }).storage = undefined;
    await expect(loadTimerRuntime()).resolves.toBeNull();
  });

  it("returns null when nothing has been persisted", async () => {
    await expect(loadTimerRuntime()).resolves.toBeNull();
  });

  it("returns null when the persisted value fails validation", async () => {
    chromeMock.storageData[TIMER_RUNTIME_STORAGE_KEY] = { version: 2 };
    await expect(loadTimerRuntime()).resolves.toBeNull();
  });

  it("returns the parsed runtime when storage holds a valid record", async () => {
    const record: PersistedTimerRuntime = {
      version: 1,
      isRunning: false,
      isPaused: true,
      sessionDate: "2026-04-10",
      taskId: "shadowing",
      endsAtMs: null,
    };
    chromeMock.storageData[TIMER_RUNTIME_STORAGE_KEY] = record;
    await expect(loadTimerRuntime()).resolves.toEqual(record);
  });

  it("logs and returns null when storage.get rejects", async () => {
    vi.mocked(chromeMock.chrome.storage.local.get).mockRejectedValueOnce(
      new Error("read failure"),
    );
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(loadTimerRuntime()).resolves.toBeNull();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Failed to load persisted timer runtime",
      expect.any(Error),
    );
  });
});

describe("saveTimerRuntime", () => {
  it("no-ops when chrome.storage.local is unavailable", async () => {
    (chromeMock.chrome as unknown as { storage?: unknown }).storage = undefined;
    await expect(
      saveTimerRuntime(stoppedRuntime(null, null, false)),
    ).resolves.toBeUndefined();
  });

  it("persists the runtime under the storage key", async () => {
    const record = runningRuntime("2026-04-10", "shadowing", 5000);
    await saveTimerRuntime(record);
    expect(chromeMock.storageData[TIMER_RUNTIME_STORAGE_KEY]).toEqual(record);
  });

  it("logs without throwing when storage.set rejects", async () => {
    vi.mocked(chromeMock.chrome.storage.local.set).mockRejectedValueOnce(
      new Error("write failure"),
    );
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      saveTimerRuntime(stoppedRuntime(null, null, false)),
    ).resolves.toBeUndefined();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Failed to persist timer runtime",
      expect.any(Error),
    );
  });
});
