import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installChromeMock, type ChromeMock } from "../../test/chromeMock";
import * as rpc from "../chromeRPC";

let chromeMock: ChromeMock;

beforeEach(() => {
  chromeMock = installChromeMock();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function mockResponse(response: { success: boolean; data?: unknown; error?: string }) {
  vi.mocked(chromeMock.chrome.runtime.sendMessage).mockImplementation(
    ((_message: unknown, callback?: (response: unknown) => void) => {
      callback?.(response);
      return Promise.resolve(undefined);
    }) as typeof chrome.runtime.sendMessage,
  );
}

describe("chromeRPC", () => {
  it("resolves with the response data on success", async () => {
    mockResponse({ success: true, data: { hello: "world" } });
    await expect(rpc.loadState()).resolves.toEqual({ hello: "world" });
  });

  it("rejects with the response error when the background reports failure", async () => {
    mockResponse({ success: false, error: "boom" });
    await expect(rpc.loadState()).rejects.toThrow("boom");
  });

  it("rejects with a fallback message when the background reports failure without an error", async () => {
    mockResponse({ success: false });
    await expect(rpc.loadState()).rejects.toThrow("Unknown error");
  });

  it("rejects with chrome.runtime.lastError when present", async () => {
    (chromeMock.chrome.runtime as unknown as { lastError?: { message: string } }).lastError = {
      message: "disconnected",
    };
    mockResponse({ success: true, data: null });
    await expect(rpc.loadState()).rejects.toThrow("disconnected");
    (chromeMock.chrome.runtime as unknown as { lastError?: unknown }).lastError = undefined;
  });

  it("sends readStateByDate with the requested date", async () => {
    mockResponse({ success: true, data: { session: { date: "2020-01-01" } } });
    await rpc.readStateByDate("2020-01-01");
    expect(chromeMock.chrome.runtime.sendMessage).toHaveBeenCalledWith(
      { action: "readStateByDate", date: "2020-01-01" },
      expect.any(Function),
    );
  });

  it("sends listSessionSummaries", async () => {
    mockResponse({ success: true, data: [] });
    await rpc.listSessionSummaries();
    expect(chromeMock.chrome.runtime.sendMessage).toHaveBeenCalledWith(
      { action: "listSessionSummaries" },
      expect.any(Function),
    );
  });

  it("sends getSessionState", async () => {
    mockResponse({ success: true, data: null });
    await rpc.getSessionState();
    expect(chromeMock.chrome.runtime.sendMessage).toHaveBeenCalledWith(
      { action: "getSessionState" },
      expect.any(Function),
    );
  });

  it("sends startSession", async () => {
    mockResponse({ success: true, data: null });
    await rpc.startSession();
    expect(chromeMock.chrome.runtime.sendMessage).toHaveBeenCalledWith(
      { action: "startSession" },
      expect.any(Function),
    );
  });

  it("sends pauseSession", async () => {
    mockResponse({ success: true, data: null });
    await rpc.pauseSession();
    expect(chromeMock.chrome.runtime.sendMessage).toHaveBeenCalledWith(
      { action: "pauseSession" },
      expect.any(Function),
    );
  });

  it("sends saveSession with the given state", async () => {
    const state = { template: [], session: {} };
    mockResponse({ success: true, data: state });
    await rpc.saveSession(state as never);
    expect(chromeMock.chrome.runtime.sendMessage).toHaveBeenCalledWith(
      { action: "saveSession", state },
      expect.any(Function),
    );
  });

  it("saveState delegates to saveSession", async () => {
    const state = { template: [], session: {} };
    mockResponse({ success: true, data: state });
    await rpc.saveState(state as never);
    expect(chromeMock.chrome.runtime.sendMessage).toHaveBeenCalledWith(
      { action: "saveSession", state },
      expect.any(Function),
    );
  });

  it("sends newDay with an optional template", async () => {
    mockResponse({ success: true, data: { template: [], session: {} } });
    const template = [{ id: "a", name: "A", duration: 5 }];
    await rpc.newDay(template);
    expect(chromeMock.chrome.runtime.sendMessage).toHaveBeenCalledWith(
      { action: "newDay", template },
      expect.any(Function),
    );
  });

  it("sends resetToDefaults", async () => {
    mockResponse({ success: true, data: { template: [], session: {} } });
    await rpc.resetToDefaults();
    expect(chromeMock.chrome.runtime.sendMessage).toHaveBeenCalledWith(
      { action: "resetToDefaults" },
      expect.any(Function),
    );
  });

  it("sends editTemplate with the template", async () => {
    mockResponse({ success: true, data: { template: [], session: {} } });
    const template = [{ id: "a", name: "A", duration: 5 }];
    await rpc.editTemplate(template);
    expect(chromeMock.chrome.runtime.sendMessage).toHaveBeenCalledWith(
      { action: "editTemplate", template },
      expect.any(Function),
    );
  });

  it("sends getRunningState", async () => {
    mockResponse({ success: true, data: { isRunning: false, isPaused: false } });
    await rpc.getRunningState();
    expect(chromeMock.chrome.runtime.sendMessage).toHaveBeenCalledWith(
      { action: "getRunningState" },
      expect.any(Function),
    );
  });

  it("sends getCompletionAlarmSetting", async () => {
    mockResponse({ success: true, data: false });
    await rpc.getCompletionAlarmSetting();
    expect(chromeMock.chrome.runtime.sendMessage).toHaveBeenCalledWith(
      { action: "getCompletionAlarmSetting" },
      expect.any(Function),
    );
  });

  it("sends setCompletionAlarmSetting with the enabled flag", async () => {
    mockResponse({ success: true, data: true });
    await rpc.setCompletionAlarmSetting(true);
    expect(chromeMock.chrome.runtime.sendMessage).toHaveBeenCalledWith(
      { action: "setCompletionAlarmSetting", enabled: true },
      expect.any(Function),
    );
  });

  it("sends completeCurrentTaskAndAdvance", async () => {
    mockResponse({ success: true, data: null });
    await rpc.completeCurrentTaskAndAdvance();
    expect(chromeMock.chrome.runtime.sendMessage).toHaveBeenCalledWith(
      { action: "completeCurrentTaskAndAdvance" },
      expect.any(Function),
    );
  });
});
