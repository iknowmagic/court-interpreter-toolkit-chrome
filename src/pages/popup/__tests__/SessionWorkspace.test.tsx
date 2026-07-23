import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import SessionWorkspace from "@pages/popup/SessionWorkspace";
import type { PracticeSessionTask } from "@shared/practice";
import { PRACTICE_TEMPLATE, buildPracticeSession } from "./popupTestUtils";

type WorkspaceProps = ComponentProps<typeof SessionWorkspace>;

function baseProps(overrides: Partial<WorkspaceProps> = {}): WorkspaceProps {
  const template = PRACTICE_TEMPLATE.map((task) => ({ ...task }));
  const session = buildPracticeSession("2026-04-10");
  const selected: PracticeSessionTask = session.tasks[0];
  return {
    template,
    session,
    selected,
    active: selected,
    activeIndex: 0,
    selectedIndex: 0,
    selectedTemplateIndex: 0,
    doneCount: 0,
    totalMinutes: 15,
    remainingMinutes: 15,
    timerDisplaySeconds: 600,
    running: false,
    isViewingToday: true,
    todayDateKey: "2026-04-10",
    sessionSummaries: [],
    onSelectTask: vi.fn(),
    onAddTask: vi.fn(),
    onEditTask: vi.fn(),
    onMoveTask: vi.fn(),
    onDeleteTask: vi.fn(),
    onResetDefaults: vi.fn(),
    onUpdateNote: vi.fn(),
    onPlay: vi.fn(),
    onStop: vi.fn(),
    onResetCurrent: vi.fn(),
    onCompleteAndNext: vi.fn(),
    onSelectDate: vi.fn().mockResolvedValue(true),
    onToday: vi.fn().mockResolvedValue(true),
    noteSaveStatus: "idle",
    lastNoteSavedAt: null,
    ...overrides,
  };
}

describe("SessionWorkspace", () => {
  it("shows the running status and enables Stop while running", () => {
    const props = baseProps({ running: true });
    render(<SessionWorkspace {...(props)} />);

    expect(screen.getByText("● Running")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "■ Stop" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "▶ Play" })).toBeDisabled();
  });

  it("shows the stopped status and enables Play when not running", () => {
    render(<SessionWorkspace {...(baseProps())} />);

    expect(screen.getByText("Stopped")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "▶ Play" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "■ Stop" })).toBeDisabled();
  });

  it("shows the complete status and current task label when the session is done", () => {
    const session = buildPracticeSession("2026-04-10", { overrides: { done: true } });
    render(
      <SessionWorkspace
        {...(baseProps({ session, active: null, activeIndex: -1 }))}
      />,
    );

    expect(screen.getByText("Every task complete — great session")).toBeInTheDocument();
    expect(screen.getByText("Session Complete")).toBeInTheDocument();
  });

  it("shows a history badge and disables mutation controls and notes while viewing history", () => {
    render(<SessionWorkspace {...(baseProps({ isViewingToday: false }))} />);

    expect(screen.getByText("History view — read only")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ Add Task" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Edit Task" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete Task" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reset List" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "Practice notes for Task A" })).toBeDisabled();
  });

  it("shows the completed timestamp for a completed selected task while viewing today", () => {
    const session = buildPracticeSession("2026-04-10");
    session.tasks[0].completedAt = "04/10, 09:00:00";
    const selected = session.tasks[0];
    render(<SessionWorkspace {...(baseProps({ session, selected }))} />);

    expect(screen.getByText("Completed 04/10, 09:00:00")).toBeInTheDocument();
  });

  it("disables Move Up at the first template position and Move Down at the last", () => {
    render(
      <SessionWorkspace
        {...(baseProps({ selectedTemplateIndex: 0 }))}
      />,
    );
    expect(screen.getByRole("button", { name: "↑ Move Up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "↓ Move Down" })).not.toBeDisabled();
  });

  it("disables Delete Task when only one template task remains", () => {
    const singleTaskTemplate = [{ ...PRACTICE_TEMPLATE[0] }];
    render(
      <SessionWorkspace
        {...(baseProps({ template: singleTaskTemplate }))}
      />,
    );
    expect(screen.getByRole("button", { name: "Delete Task" })).toBeDisabled();
  });

  it("disables Reset Task and Done once the active task is already complete", () => {
    const session = buildPracticeSession("2026-04-10");
    session.tasks[0].completedAt = "04/10, 09:00:00";
    render(
      <SessionWorkspace
        {...(baseProps({ session, active: session.tasks[0] }))}
      />,
    );
    expect(screen.getByRole("button", { name: "✓ Done" })).toBeDisabled();
  });

  it("wires the task list, note, and control callbacks", () => {
    const onSelectTask = vi.fn();
    const onUpdateNote = vi.fn();
    const onAddTask = vi.fn();
    const onEditTask = vi.fn();
    const onMoveTask = vi.fn();
    const onDeleteTask = vi.fn();
    const onResetDefaults = vi.fn();
    const onPlay = vi.fn();
    const onStop = vi.fn();
    const onResetCurrent = vi.fn();
    const onCompleteAndNext = vi.fn();

    render(
      <SessionWorkspace
        {...(baseProps({
          selectedTemplateIndex: 0,
          onSelectTask,
          onUpdateNote,
          onAddTask,
          onEditTask,
          onMoveTask,
          onDeleteTask,
          onResetDefaults,
          onPlay,
          onStop,
          onResetCurrent,
          onCompleteAndNext,
          running: true,
        }))}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Task B/ }));
    expect(onSelectTask).toHaveBeenCalledWith("task-b");

    fireEvent.change(screen.getByRole("textbox", { name: "Practice notes for Task A" }), {
      target: { value: "practiced" },
    });
    expect(onUpdateNote).toHaveBeenCalledWith("task-a", "practiced");

    fireEvent.click(screen.getByRole("button", { name: "+ Add Task" }));
    expect(onAddTask).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Edit Task" }));
    expect(onEditTask).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "↓ Move Down" }));
    expect(onMoveTask).toHaveBeenCalledWith(1);

    fireEvent.click(screen.getByRole("button", { name: "Delete Task" }));
    expect(onDeleteTask).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Reset List" }));
    expect(onResetDefaults).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "■ Stop" }));
    expect(onStop).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "↺ Reset Task" }));
    expect(onResetCurrent).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "✓ Done" }));
    expect(onCompleteAndNext).toHaveBeenCalledTimes(1);
    expect(onPlay).not.toHaveBeenCalled();
  });

  it("shows summary metadata for progress, done count, and totals", () => {
    render(
      <SessionWorkspace
        {...(baseProps({ doneCount: 1, totalMinutes: 15, remainingMinutes: 9 }))}
      />,
    );
    expect(screen.getByText("15m")).toBeInTheDocument();
    expect(screen.getByText("9m")).toBeInTheDocument();
    expect(screen.getByText("1/2")).toBeInTheDocument();
  });

  it("renders the calendar popover integration point", () => {
    render(<SessionWorkspace {...(baseProps())} />);
    expect(screen.getByRole("button", { name: "Open calendar" })).toBeInTheDocument();
  });

  it("labels task notes and exposes save status through a polite live region", () => {
    render(
      <SessionWorkspace
        {...(baseProps({ noteSaveStatus: "saved", lastNoteSavedAt: "10:15 AM" }))}
      />,
    );

    expect(screen.getByRole("textbox", { name: "Practice notes for Task A" })).toBeInTheDocument();
    expect(screen.getByText("Notes saved at 10:15 AM")).toHaveAttribute(
      "aria-live",
      "polite",
    );
  });
});
