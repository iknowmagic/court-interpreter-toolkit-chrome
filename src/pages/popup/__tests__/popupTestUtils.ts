import { act, within } from "@testing-library/react";
import type {
  PracticeSession,
  PracticeState,
  PracticeTemplateTask,
} from "@shared/practice";

export const PRACTICE_TEMPLATE: PracticeTemplateTask[] = [
  { id: "task-a", name: "Task A", duration: 10 },
  { id: "task-b", name: "Task B", duration: 5 },
];

export function buildPracticeSession(
  date: string,
  options: {
    firstTaskRemainingSeconds?: number;
    overrides?: Partial<PracticeSession>;
  } = {},
): PracticeSession {
  const defaultSession: PracticeSession = {
    date,
    currentTaskId: "task-a",
    done: false,
    tasks: [
      {
        id: "task-a",
        name: "Task A",
        duration: 10,
        note: "",
        completedAt: null,
        remainingSeconds: options.firstTaskRemainingSeconds ?? 600,
      },
      {
        id: "task-b",
        name: "Task B",
        duration: 5,
        note: "",
        completedAt: null,
        remainingSeconds: 300,
      },
    ],
  };
  const { tasks, ...sessionOverrides } = options.overrides ?? {};

  return {
    ...defaultSession,
    ...sessionOverrides,
    tasks: tasks ? tasks.map((task) => ({ ...task })) : defaultSession.tasks,
  };
}

export function buildPracticeState(
  date: string,
  options: {
    firstTaskRemainingSeconds?: number;
    sessionOverrides?: Partial<PracticeSession>;
  } = {},
): PracticeState {
  return {
    template: PRACTICE_TEMPLATE.map((task) => ({ ...task })),
    session: buildPracticeSession(date, {
      firstTaskRemainingSeconds: options.firstTaskRemainingSeconds,
      overrides: options.sessionOverrides,
    }),
  };
}

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function actWait(ms: number): Promise<void> {
  await act(async () => {
    await wait(ms);
  });
}

export async function flushCalendarPositioning(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
  });
}

export function getEnabledCalendarDay(
  dialog: HTMLElement,
  dayLabel: string,
): HTMLButtonElement {
  const enabled = within(dialog)
    .getAllByRole("button", { name: dayLabel })
    .find(
      (button): button is HTMLButtonElement =>
        !(button as HTMLButtonElement).disabled,
    );

  if (!enabled) {
    throw new Error(`No enabled calendar day button "${dayLabel}" was found.`);
  }

  return enabled;
}
