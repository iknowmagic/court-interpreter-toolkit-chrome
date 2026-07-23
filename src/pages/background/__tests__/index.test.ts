import { afterEach, describe, expect, it, vi } from "vitest";
import { installChromeMock, type ChromeMock } from "../../../test/chromeMock";

vi.mock("@background/sessionManager", () => ({
  ensureInitialized: vi.fn(),
  getSessionState: vi.fn(),
  readStateByDate: vi.fn(),
  listSessionSummaries: vi.fn(),
  startSession: vi.fn(),
  pauseSession: vi.fn(),
  saveSession: vi.fn(),
  newDay: vi.fn(),
  resetToDefaults: vi.fn(),
  editTemplate: vi.fn(),
  getRunningState: vi.fn(),
  getCompletionAlarmSetting: vi.fn(),
  setCompletionAlarmSetting: vi.fn(),
  completeCurrentTaskAndAdvanceNoStart: vi.fn(),
  handleBackgroundTickAlarm: vi.fn(),
  handleActionContextMenuClick: vi.fn(),
}));

type MessageResponse = { success: boolean; data?: unknown; error?: string };
type MessageListener = (
  request: unknown,
  sender: unknown,
  sendResponse: (response: MessageResponse) => void,
) => boolean;
type AlarmListener = (alarm: chrome.alarms.Alarm) => void;
type ContextMenuListener = (info: chrome.contextMenus.OnClickData) => void;
type InstalledListener = (details: chrome.runtime.InstalledDetails) => void;

let chromeMock: ChromeMock;

async function loadBackgroundIndex() {
  vi.resetModules();
  chromeMock = installChromeMock();
  const sessionManager = await import("@background/sessionManager");
  vi.mocked(sessionManager.ensureInitialized).mockResolvedValue(undefined);
  await import("../index");
  return sessionManager;
}

function getMessageListener(): MessageListener {
  const calls = vi.mocked(chromeMock.chrome.runtime.onMessage.addListener).mock.calls;
  return calls[0][0] as MessageListener;
}

function getAlarmListener(): AlarmListener {
  const calls = vi.mocked(chromeMock.chrome.alarms.onAlarm.addListener).mock.calls;
  return calls[0][0] as AlarmListener;
}

function getContextMenuListener(): ContextMenuListener {
  const calls = vi.mocked(chromeMock.chrome.contextMenus.onClicked.addListener).mock.calls;
  return calls[0][0] as ContextMenuListener;
}

function getInstalledListener(): InstalledListener {
  const calls = vi.mocked(chromeMock.chrome.runtime.onInstalled.addListener).mock.calls;
  return calls[0][0] as InstalledListener;
}

function sendMessage(request: unknown): Promise<MessageResponse> {
  const listener = getMessageListener();
  return new Promise((resolve) => {
    const returnValue = listener(request, {}, (response) => resolve(response));
    expect(returnValue).toBe(true);
  });
}

async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("background/index message contract", () => {
  it("requests eager initialization on load", async () => {
    const sessionManager = await loadBackgroundIndex();
    expect(sessionManager.ensureInitialized).toHaveBeenCalledTimes(1);
  });

  it("logs but does not throw when the eager warm-up initialization rejects", async () => {
    vi.resetModules();
    chromeMock = installChromeMock();
    const sessionManager = await import("@background/sessionManager");
    vi.mocked(sessionManager.ensureInitialized).mockRejectedValueOnce(
      new Error("boot failure"),
    );
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await import("../index");
    await flushMicrotasks();

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Initial session manager warm-up failed:",
      expect.any(Error),
    );
  });

  it("loadState waits for initialization and returns structured success", async () => {
    const sessionManager = await loadBackgroundIndex();
    const state = { template: [], session: {} } as unknown;
    vi.mocked(sessionManager.getSessionState).mockResolvedValue(state as never);

    const response = await sendMessage({ action: "loadState" });

    expect(sessionManager.ensureInitialized).toHaveBeenCalledTimes(2);
    expect(response).toEqual({ success: true, data: state });
  });

  it("getSessionState action shares the same handler as loadState", async () => {
    const sessionManager = await loadBackgroundIndex();
    const state = { template: [], session: {} } as unknown;
    vi.mocked(sessionManager.getSessionState).mockResolvedValue(state as never);

    const response = await sendMessage({ action: "getSessionState" });
    expect(response).toEqual({ success: true, data: state });
  });

  it("getRunningState awaits the asynchronous manager result", async () => {
    const sessionManager = await loadBackgroundIndex();
    vi.mocked(sessionManager.getRunningState).mockResolvedValue({
      isRunning: true,
      isPaused: false,
    });

    const response = await sendMessage({ action: "getRunningState" });
    expect(response).toEqual({
      success: true,
      data: { isRunning: true, isPaused: false },
    });
  });

  it("readStateByDate forwards the requested date", async () => {
    const sessionManager = await loadBackgroundIndex();
    const state = { template: [], session: { date: "2020-01-01" } } as unknown;
    vi.mocked(sessionManager.readStateByDate).mockResolvedValue(state as never);

    const response = await sendMessage({ action: "readStateByDate", date: "2020-01-01" });

    expect(sessionManager.readStateByDate).toHaveBeenCalledWith("2020-01-01");
    expect(response).toEqual({ success: true, data: state });
  });

  it("listSessionSummaries returns the manager's summaries", async () => {
    const sessionManager = await loadBackgroundIndex();
    const summaries = [{ date: "2020-01-01", completed: true }];
    vi.mocked(sessionManager.listSessionSummaries).mockResolvedValue(summaries);

    const response = await sendMessage({ action: "listSessionSummaries" });
    expect(response).toEqual({ success: true, data: summaries });
  });

  it.each([
    ["startSession", {}, "startSession", []],
    ["pauseSession", {}, "pauseSession", []],
    [
      "saveSession",
      { state: { template: [], session: {} } },
      "saveSession",
      [{ template: [], session: {} }],
    ],
    ["newDay", { template: [{ id: "a", name: "A", duration: 5 }] }, "newDay", [
      [{ id: "a", name: "A", duration: 5 }],
    ]],
    ["resetToDefaults", {}, "resetToDefaults", []],
    [
      "editTemplate",
      { template: [{ id: "a", name: "A", duration: 5 }] },
      "editTemplate",
      [[{ id: "a", name: "A", duration: 5 }]],
    ],
    ["getCompletionAlarmSetting", {}, "getCompletionAlarmSetting", []],
    [
      "setCompletionAlarmSetting",
      { enabled: true },
      "setCompletionAlarmSetting",
      [true],
    ],
    [
      "completeCurrentTaskAndAdvance",
      {},
      "completeCurrentTaskAndAdvanceNoStart",
      [],
    ],
  ] as const)(
    "%s forwards its payload to sessionManager.%s",
    async (action, extra, managerFn, expectedArgs) => {
      const sessionManager = await loadBackgroundIndex();
      const fn = sessionManager[managerFn as keyof typeof sessionManager] as ReturnType<
        typeof vi.fn
      >;
      const result = { ok: true };
      fn.mockResolvedValue(result);

      const response = await sendMessage({ action, ...extra });

      expect(fn).toHaveBeenCalledWith(...expectedArgs);
      expect(response).toEqual({ success: true, data: result });
    },
  );

  it("an unknown action returns the existing structured error payload without throwing", async () => {
    await loadBackgroundIndex();
    const response = await sendMessage({ action: "bogusAction" });
    expect(response).toEqual({
      success: true,
      data: { error: "Unknown action: bogusAction" },
    });
  });

  it("returns a structured failure response when initialization rejects for a message", async () => {
    const sessionManager = await loadBackgroundIndex();
    vi.mocked(sessionManager.ensureInitialized).mockRejectedValueOnce(
      new Error("init failed"),
    );
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await sendMessage({ action: "loadState" });

    expect(response).toEqual({ success: false, error: "init failed" });
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Error handling loadState:",
      expect.any(Error),
    );
  });

  it("returns a structured failure response when the action handler itself rejects", async () => {
    const sessionManager = await loadBackgroundIndex();
    vi.mocked(sessionManager.getSessionState).mockRejectedValue(
      new Error("db exploded"),
    );
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await sendMessage({ action: "loadState" });

    expect(response).toEqual({ success: false, error: "db exploded" });
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Error handling loadState:",
      expect.any(Error),
    );
  });

  it("returns false without responding for a message with no action", async () => {
    await loadBackgroundIndex();
    const listener = getMessageListener();
    const sendResponse = vi.fn();

    expect(listener(null, {}, sendResponse)).toBe(false);
    expect(listener({}, {}, sendResponse)).toBe(false);
    expect(sendResponse).not.toHaveBeenCalled();
  });
});

describe("background/index alarm and context-menu wiring", () => {
  it("handles the background tick alarm through the initialized event boundary", async () => {
    const sessionManager = await loadBackgroundIndex();
    const alarm = { name: "practice-session-tick" } as chrome.alarms.Alarm;

    getAlarmListener()(alarm);
    await flushMicrotasks();

    expect(sessionManager.ensureInitialized).toHaveBeenCalledTimes(2);
    expect(sessionManager.handleBackgroundTickAlarm).toHaveBeenCalledWith(alarm);
  });

  it("logs without throwing when alarm initialization rejects", async () => {
    const sessionManager = await loadBackgroundIndex();
    vi.mocked(sessionManager.ensureInitialized).mockRejectedValueOnce(
      new Error("alarm init failed"),
    );
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    getAlarmListener()({ name: "practice-session-tick" } as chrome.alarms.Alarm);
    await flushMicrotasks();

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Failed to handle alarm:",
      expect.any(Error),
    );
    expect(sessionManager.handleBackgroundTickAlarm).not.toHaveBeenCalled();
  });

  it("handles context-menu clicks through the initialized event boundary", async () => {
    const sessionManager = await loadBackgroundIndex();

    getContextMenuListener()({
      menuItemId: "practice-play",
      checked: undefined,
    } as chrome.contextMenus.OnClickData);
    await flushMicrotasks();

    expect(sessionManager.ensureInitialized).toHaveBeenCalledTimes(2);
    expect(sessionManager.handleActionContextMenuClick).toHaveBeenCalledWith(
      "practice-play",
      undefined,
    );
  });

  it("logs without throwing when context-menu initialization rejects", async () => {
    const sessionManager = await loadBackgroundIndex();
    vi.mocked(sessionManager.ensureInitialized).mockRejectedValueOnce(
      new Error("menu init failed"),
    );
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    getContextMenuListener()({
      menuItemId: "practice-play",
    } as chrome.contextMenus.OnClickData);
    await flushMicrotasks();

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Failed to handle context-menu click:",
      expect.any(Error),
    );
    expect(sessionManager.handleActionContextMenuClick).not.toHaveBeenCalled();
  });
});

describe("background/index install handling", () => {
  it("opens the welcome page on a fresh install", async () => {
    await loadBackgroundIndex();

    getInstalledListener()({
      reason: "install",
    } as chrome.runtime.InstalledDetails);
    await flushMicrotasks();

    expect(chromeMock.chrome.runtime.getURL).toHaveBeenCalledWith("welcome.html");
    expect(chromeMock.chrome.tabs.create).toHaveBeenCalledWith({
      url: "chrome-extension://test/welcome.html",
    });
  });

  it("does not open the welcome page on update", async () => {
    await loadBackgroundIndex();

    getInstalledListener()({
      reason: "update",
    } as chrome.runtime.InstalledDetails);
    await flushMicrotasks();

    expect(chromeMock.chrome.tabs.create).not.toHaveBeenCalled();
  });

  it("logs when opening the welcome page fails", async () => {
    await loadBackgroundIndex();
    vi.mocked(chromeMock.chrome.tabs.create).mockRejectedValueOnce(
      new Error("tab creation failed"),
    );
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    getInstalledListener()({
      reason: "install",
    } as chrome.runtime.InstalledDetails);
    await flushMicrotasks();

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Failed to open welcome page on install:",
      expect.any(Error),
    );
  });
});
