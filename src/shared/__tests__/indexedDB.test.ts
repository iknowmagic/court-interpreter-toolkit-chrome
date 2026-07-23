import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetIndexedDbConnectionForTests,
  initDB,
  listSessionSummaries,
  loadStateByDate,
  newDay,
  resetToDefaults,
  saveState,
} from "@shared/indexedDB";
import {
  DEFAULT_TEMPLATE,
  createFreshSession,
  getLosAngelesDateString,
  type PracticeTemplateTask,
} from "@shared/practice";

const DB_NAME = "court-interpreter";

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

describe("indexedDB resetToDefaults", () => {
  beforeEach(async () => {
    __resetIndexedDbConnectionForTests();
    await deleteDatabase(DB_NAME);
    await initDB();
  });

  it("hard resets all historical sessions and restores default template", async () => {
    const customTemplate: PracticeTemplateTask[] = [
      { id: "custom-1", name: "Custom Task", duration: 12 },
    ];

    await saveState({
      template: customTemplate,
      session: createFreshSession(customTemplate, "2026-04-10"),
    });
    await saveState({
      template: customTemplate,
      session: createFreshSession(customTemplate, "2026-04-11"),
    });

    const beforeSummaries = await listSessionSummaries();
    expect(beforeSummaries.map((summary) => summary.date)).toEqual([
      "2026-04-10",
      "2026-04-11",
    ]);

    const resetState = await resetToDefaults();

    const afterSummaries = await listSessionSummaries();
    expect(afterSummaries.map((summary) => summary.date)).toEqual([
      getLosAngelesDateString(),
    ]);
    expect(resetState.session.date).toBe(getLosAngelesDateString());
    expect(resetState.template).toEqual(DEFAULT_TEMPLATE);
    expect(resetState.session.tasks).toHaveLength(DEFAULT_TEMPLATE.length);
  });

  it("returns an empty array when no sessions are stored", async () => {
    const summaries = await listSessionSummaries();
    expect(summaries).toEqual([]);
  });

  it("classifies incomplete and complete sessions correctly", async () => {
    const template: PracticeTemplateTask[] = [
      { id: "task-a", name: "Task A", duration: 5 },
      { id: "task-b", name: "Task B", duration: 5 },
    ];

    const incompleteSession = createFreshSession(template, "2026-04-10");
    await saveState({ template, session: incompleteSession });

    const completeSession = createFreshSession(template, "2026-04-11");
    completeSession.tasks = completeSession.tasks.map((task) => ({
      ...task,
      completedAt: "04/11, 10:00:00",
      remainingSeconds: 0,
    }));
    completeSession.done = true;
    await saveState({ template, session: completeSession });

    const summaries = await listSessionSummaries();
    const byDate = new Map(summaries.map((summary) => [summary.date, summary]));

    expect(byDate.get("2026-04-10")?.completed).toBe(false);
    expect(byDate.get("2026-04-11")?.completed).toBe(true);
  });

  it("does not persist a summary for a date that was only read, not saved", async () => {
    const missingDate = "2026-05-01";
    await loadStateByDate(missingDate);

    const summaries = await listSessionSummaries();
    expect(summaries.some((summary) => summary.date === missingDate)).toBe(
      false,
    );
  });
});

function fakeFailingRequest<T extends { onerror?: unknown; onsuccess?: unknown }>(
  error: Error,
): T {
  const request = { error } as unknown as T & { onerror: (() => void) | null };
  Object.defineProperty(request, "onerror", {
    set(fn: () => void) {
      queueMicrotask(fn);
    },
  });
  Object.defineProperty(request, "onsuccess", {
    set() {
      // Never invoked on the failure path.
    },
  });
  return request;
}

describe("indexedDB connection caching", () => {
  beforeEach(async () => {
    __resetIndexedDbConnectionForTests();
    await deleteDatabase(DB_NAME);
  });

  it("reuses the cached connection on a second initDB call", async () => {
    const first = await initDB();
    const second = await initDB();
    expect(second).toBe(first);
  });

  it("lazily opens the database on first use without an explicit initDB call", async () => {
    await expect(loadStateByDate("2026-04-10")).resolves.toBeDefined();
  });
});

describe("indexedDB request failures", () => {
  beforeEach(async () => {
    __resetIndexedDbConnectionForTests();
    await deleteDatabase(DB_NAME);
    await initDB();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects when opening the database fails", async () => {
    __resetIndexedDbConnectionForTests();
    const openSpy = vi
      .spyOn(indexedDB, "open")
      .mockReturnValueOnce(
        fakeFailingRequest<IDBOpenDBRequest>(new Error("open failed")),
      );

    await expect(initDB()).rejects.toThrow("open failed");
    openSpy.mockRestore();
  });

  it("rejects when persisting the template fails", async () => {
    const putSpy = vi
      .spyOn(IDBObjectStore.prototype, "put")
      .mockReturnValueOnce(fakeFailingRequest<IDBRequest>(new Error("put failed")));

    await expect(
      saveState({ template: DEFAULT_TEMPLATE, session: createFreshSession(DEFAULT_TEMPLATE) }),
    ).rejects.toThrow("put failed");
    putSpy.mockRestore();
  });

  it("rejects when reading a stored session fails", async () => {
    const getSpy = vi
      .spyOn(IDBObjectStore.prototype, "get")
      .mockReturnValueOnce(fakeFailingRequest<IDBRequest>(new Error("get failed")));

    await expect(loadStateByDate("2026-04-10")).rejects.toThrow("get failed");
    getSpy.mockRestore();
  });
});

// NOTE: loadState/loadStateByDate compare a freshly-built reconciled session
// against the raw stored record to decide whether a resave is needed. The
// stored record always carries an extra `updatedAt` field (added by
// saveSession's payload spread) that the reconciled session never has, so
// that JSON.stringify comparison never matches and the "skip resave" branch
// is unreachable in practice: every read silently rewrites the record. This
// is pre-existing production behavior (harmless — same content, extra
// write), left unchanged per the coverage-only scope of this pass; see the
// final report for this finding.

describe("empty-template fallbacks", () => {
  beforeEach(async () => {
    __resetIndexedDbConnectionForTests();
    await deleteDatabase(DB_NAME);
    await initDB();
  });

  it("saveState reuses the stored template when given an empty one", async () => {
    await saveState({
      template: DEFAULT_TEMPLATE,
      session: createFreshSession(DEFAULT_TEMPLATE, "2026-04-10"),
    });

    const result = await saveState({
      template: [],
      session: createFreshSession(DEFAULT_TEMPLATE, "2026-04-10"),
    });
    expect(result.template).toEqual(DEFAULT_TEMPLATE);
  });

  it("newDay reuses the stored template when given an empty one", async () => {
    const customTemplate: PracticeTemplateTask[] = [
      { id: "custom-1", name: "Custom Task", duration: 12 },
    ];
    await saveState({
      template: customTemplate,
      session: createFreshSession(customTemplate, "2026-04-10"),
    });

    const result = await newDay([]);
    expect(result.template).toEqual(customTemplate);
  });
});
