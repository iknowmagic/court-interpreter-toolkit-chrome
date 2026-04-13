import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetIndexedDbConnectionForTests,
  initDB,
  listSessionDates,
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

    const beforeDates = await listSessionDates();
    expect(beforeDates).toEqual(["2026-04-10", "2026-04-11"]);

    const resetState = await resetToDefaults();

    const afterDates = await listSessionDates();
    expect(afterDates).toEqual([getLosAngelesDateString()]);
    expect(resetState.session.date).toBe(getLosAngelesDateString());
    expect(resetState.template).toEqual(DEFAULT_TEMPLATE);
    expect(resetState.session.tasks).toHaveLength(DEFAULT_TEMPLATE.length);
  });
});
