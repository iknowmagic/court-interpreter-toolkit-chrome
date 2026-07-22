import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetIndexedDbConnectionForTests,
  initDB,
  listSessionSummaries,
  loadStateByDate,
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
