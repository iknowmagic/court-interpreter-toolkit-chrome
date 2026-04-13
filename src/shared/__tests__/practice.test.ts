import { describe, expect, it } from "vitest";
import {
  createFreshSession,
  reconcileSessionWithTemplate,
  type PracticeSession,
  type PracticeTemplateTask,
} from "@shared/practice";

describe("practice reconciliation", () => {
  it("resets remainingSeconds to full new duration on duration edit", () => {
    const template: PracticeTemplateTask[] = [{ id: "task-a", name: "Task A", duration: 10 }];
    const session = createFreshSession(template, "2026-04-10");
    session.tasks[0].remainingSeconds = 590;

    const editedTemplate: PracticeTemplateTask[] = [
      { id: "task-a", name: "Task A", duration: 15 },
    ];

    const reconciled = reconcileSessionWithTemplate(editedTemplate, session);

    expect(reconciled.tasks[0].remainingSeconds).toBe(900);
    expect(reconciled.tasks[0].completedAt).toBeNull();
  });

  it("preserves completion flag while still resetting timer on duration edit", () => {
    const template: PracticeTemplateTask[] = [{ id: "task-a", name: "Task A", duration: 10 }];
    const session = createFreshSession(template, "2026-04-10");
    session.tasks[0].completedAt = "04/10, 10:00:00";
    session.tasks[0].remainingSeconds = 0;

    const editedTemplate: PracticeTemplateTask[] = [
      { id: "task-a", name: "Task A", duration: 15 },
    ];

    const reconciled = reconcileSessionWithTemplate(editedTemplate, session);

    expect(reconciled.tasks[0].completedAt).toBe("04/10, 10:00:00");
    expect(reconciled.tasks[0].remainingSeconds).toBe(900);
  });

  it("preserves completion on add/move and removes deleted tasks", () => {
    const template: PracticeTemplateTask[] = [
      { id: "task-a", name: "Task A", duration: 5 },
      { id: "task-b", name: "Task B", duration: 5 },
    ];

    const session: PracticeSession = createFreshSession(template, "2026-04-10");
    session.currentTaskId = "task-b";
    session.tasks[0].completedAt = "04/10, 09:00:00";
    session.tasks[0].remainingSeconds = 0;
    session.tasks[1].remainingSeconds = 120;

    const addedAndMovedTemplate: PracticeTemplateTask[] = [
      { id: "task-b", name: "Task B", duration: 5 },
      { id: "task-a", name: "Task A", duration: 5 },
      { id: "task-c", name: "Task C", duration: 7 },
    ];

    const reconciled = reconcileSessionWithTemplate(addedAndMovedTemplate, session);

    const taskA = reconciled.tasks.find((task) => task.id === "task-a");
    const taskB = reconciled.tasks.find((task) => task.id === "task-b");
    const taskC = reconciled.tasks.find((task) => task.id === "task-c");

    expect(taskA?.completedAt).toBe("04/10, 09:00:00");
    expect(taskB?.completedAt).toBeNull();
    expect(taskB?.remainingSeconds).toBe(120);
    expect(taskC?.remainingSeconds).toBe(420);

    const deletedTemplate: PracticeTemplateTask[] = [
      { id: "task-a", name: "Task A", duration: 5 },
      { id: "task-c", name: "Task C", duration: 7 },
    ];

    const afterDelete = reconcileSessionWithTemplate(deletedTemplate, reconciled);
    expect(afterDelete.tasks.some((task) => task.id === "task-b")).toBe(false);
    expect(afterDelete.tasks.find((task) => task.id === "task-a")?.completedAt).toBe(
      "04/10, 09:00:00",
    );
  });
});
