import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { completeCurrentTaskAndAdvance } from "../sessionTransitions";
import type { PracticeSession, PracticeSessionTask } from "../../shared/practice";

function makeTask(overrides: Partial<PracticeSessionTask> = {}): PracticeSessionTask {
  return {
    id: "task",
    name: "Task",
    duration: 5,
    note: "",
    completedAt: null,
    remainingSeconds: 300,
    ...overrides,
  };
}

function makeSession(overrides: Partial<PracticeSession> = {}): PracticeSession {
  return {
    date: "2026-04-10",
    currentTaskId: "task-a",
    done: false,
    tasks: [
      makeTask({ id: "task-a", name: "Task A" }),
      makeTask({ id: "task-b", name: "Task B" }),
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-04-10T12:00:00.000-07:00"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("completeCurrentTaskAndAdvance", () => {
  it("is a no-op when the session is already marked done", () => {
    const session = makeSession({ done: true });
    const result = completeCurrentTaskAndAdvance(session);
    expect(result).toEqual({ session, completedTaskId: null });
    expect(result.session).toBe(session);
  });

  it("is a no-op when there are no tasks", () => {
    const session = makeSession({ tasks: [], currentTaskId: null });
    const result = completeCurrentTaskAndAdvance(session);
    expect(result).toEqual({ session, completedTaskId: null });
  });

  it("completes the current task and reports its id", () => {
    const session = makeSession();
    const result = completeCurrentTaskAndAdvance(session);

    const taskA = result.session.tasks.find((t) => t.id === "task-a")!;
    expect(taskA.completedAt).not.toBeNull();
    expect(taskA.remainingSeconds).toBe(0);
    expect(result.completedTaskId).toBe("task-a");
  });

  it("advances to the next incomplete task after the current one", () => {
    const session = makeSession({
      currentTaskId: "task-a",
      tasks: [
        makeTask({ id: "task-a" }),
        makeTask({ id: "task-b" }),
        makeTask({ id: "task-c" }),
      ],
    });
    const result = completeCurrentTaskAndAdvance(session);
    expect(result.session.currentTaskId).toBe("task-b");
    expect(result.session.done).toBe(false);
  });

  it("wraps to an earlier incomplete task when none remain after the current one", () => {
    const session = makeSession({
      currentTaskId: "task-c",
      tasks: [
        makeTask({ id: "task-a" }),
        makeTask({ id: "task-b" }),
        makeTask({ id: "task-c" }),
      ],
    });
    const result = completeCurrentTaskAndAdvance(session);
    expect(result.session.currentTaskId).toBe("task-a");
    expect(result.session.done).toBe(false);
  });

  it("marks the session done and keeps the final task's id when the last task completes", () => {
    const session = makeSession({
      currentTaskId: "task-b",
      tasks: [
        makeTask({ id: "task-a", completedAt: "04/10, 09:00:00", remainingSeconds: 0 }),
        makeTask({ id: "task-b" }),
      ],
    });
    const result = completeCurrentTaskAndAdvance(session);
    expect(result.session.done).toBe(true);
    expect(result.session.currentTaskId).toBe("task-b");
    expect(result.completedTaskId).toBe("task-b");
  });

  it("does not re-complete an already-complete current task but still advances selection", () => {
    const session = makeSession({
      currentTaskId: "task-a",
      tasks: [
        makeTask({ id: "task-a", completedAt: "04/10, 09:00:00", remainingSeconds: 0 }),
        makeTask({ id: "task-b" }),
      ],
    });
    const result = completeCurrentTaskAndAdvance(session);

    expect(result.completedTaskId).toBeNull();
    expect(result.session.tasks.find((t) => t.id === "task-a")!.completedAt).toBe(
      "04/10, 09:00:00",
    );
    expect(result.session.currentTaskId).toBe("task-b");
  });

  it("sets a Los Angeles-formatted completion timestamp and clears remaining seconds", () => {
    const session = makeSession({
      tasks: [makeTask({ id: "task-a", remainingSeconds: 42 })],
    });
    const result = completeCurrentTaskAndAdvance(session);
    const taskA = result.session.tasks.find((t) => t.id === "task-a")!;
    expect(taskA.completedAt).toMatch(/^\d{2}\/\d{2}, \d{2}:\d{2}:\d{2} (AM|PM)$/);
    expect(taskA.remainingSeconds).toBe(0);
  });

  it("does not mutate the input session or its task array", () => {
    const session = makeSession();
    const originalTasks = session.tasks;
    const originalTaskA = session.tasks[0];

    const result = completeCurrentTaskAndAdvance(session);

    expect(session.tasks).toBe(originalTasks);
    expect(session.tasks[0]).toBe(originalTaskA);
    expect(session.tasks[0].completedAt).toBeNull();
    expect(result.session.tasks).not.toBe(originalTasks);
  });
});
