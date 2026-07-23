import { vi } from "vitest";

/**
 * A persistent, in-memory `chrome.*` mock for background/service-worker
 * tests. `storage.local` is backed by a plain object that survives
 * `vi.resetModules()` + dynamic re-import, so tests can simulate a
 * service-worker restart by reloading the sessionManager module while this
 * mock (and fake-indexeddb) keep acting as the durable layer underneath.
 */
export interface ChromeMock {
  chrome: typeof chrome;
  storageData: Record<string, unknown>;
  alarms: Map<string, chrome.alarms.Alarm>;
  actionState: {
    title: string | null;
    badgeText: string | null;
    badgeColor: string | null;
  };
  contextMenuItems: Map<string, chrome.contextMenus.CreateProperties>;
  sentMessages: unknown[];
}

export function createChromeMock(): ChromeMock {
  const storageData: Record<string, unknown> = {};
  const alarms = new Map<string, chrome.alarms.Alarm>();
  const actionState = {
    title: null as string | null,
    badgeText: null as string | null,
    badgeColor: null as string | null,
  };
  const contextMenuItems = new Map<string, chrome.contextMenus.CreateProperties>();
  const sentMessages: unknown[] = [];

  const storageLocal = {
    get: vi.fn(async (keys?: string | string[] | Record<string, unknown>) => {
      if (keys === undefined || keys === null) return { ...storageData };
      const keyList = typeof keys === "string" ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
      const result: Record<string, unknown> = {};
      for (const key of keyList) {
        if (key in storageData) result[key] = storageData[key];
      }
      return result;
    }),
    set: vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(storageData, items);
    }),
    remove: vi.fn(async (keys: string | string[]) => {
      const keyList = typeof keys === "string" ? [keys] : keys;
      for (const key of keyList) delete storageData[key];
    }),
    clear: vi.fn(async () => {
      for (const key of Object.keys(storageData)) delete storageData[key];
    }),
  };

  const chromeMock = {
    storage: {
      local: storageLocal,
    },
    alarms: {
      create: vi.fn(async (name: string, alarmInfo: chrome.alarms.AlarmCreateInfo) => {
        alarms.set(name, {
          name,
          scheduledTime: Date.now(),
          periodInMinutes: alarmInfo?.periodInMinutes,
        });
      }),
      clear: vi.fn(async (name: string) => {
        return alarms.delete(name);
      }),
      get: vi.fn(async (name: string) => alarms.get(name)),
      onAlarm: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
    action: {
      setTitle: vi.fn(async (details: { title: string }) => {
        actionState.title = details.title;
      }),
      setBadgeText: vi.fn(async (details: { text: string }) => {
        actionState.badgeText = details.text;
      }),
      setBadgeBackgroundColor: vi.fn(async (details: { color: string }) => {
        actionState.badgeColor = details.color;
      }),
    },
    contextMenus: {
      create: vi.fn(
        (
          createProperties: chrome.contextMenus.CreateProperties,
          callback?: () => void,
        ) => {
          contextMenuItems.set(String(createProperties.id), createProperties);
          callback?.();
          return createProperties.id ?? "";
        },
      ),
      update: vi.fn(
        async (
          id: string | number,
          updateProperties: Omit<chrome.contextMenus.CreateProperties, "id">,
        ) => {
          const existing = contextMenuItems.get(String(id));
          if (!existing) throw new Error(`No context menu item with id ${id}`);
          contextMenuItems.set(String(id), { ...existing, ...updateProperties });
        },
      ),
      removeAll: vi.fn(async () => {
        contextMenuItems.clear();
      }),
      onClicked: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
    runtime: {
      lastError: undefined,
      sendMessage: vi.fn(async (message: unknown) => {
        sentMessages.push(message);
        return undefined;
      }),
      onMessage: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
      onInstalled: {
        addListener: vi.fn(),
      },
      getURL: vi.fn((path: string) => `chrome-extension://test/${path}`),
      OnInstalledReason: { INSTALL: "install" },
    },
    tabs: {
      create: vi.fn(async () => ({ id: 1 })),
    },
    offscreen: {
      createDocument: vi.fn(async () => undefined),
    },
  } as unknown as typeof chrome;

  return {
    chrome: chromeMock,
    storageData,
    alarms,
    actionState,
    contextMenuItems,
    sentMessages,
  };
}

export function installChromeMock(): ChromeMock {
  const mock = createChromeMock();
  (globalThis as unknown as { chrome: typeof chrome }).chrome = mock.chrome;
  return mock;
}
