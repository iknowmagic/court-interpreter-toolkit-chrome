import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import TaskEditorDialog from "@pages/popup/TaskEditorDialog";
import type { ModalState } from "@pages/popup/usePracticeSession";

describe("TaskEditorDialog", () => {
  it("shows Add Task title and button in add mode with empty defaults", () => {
    const modal: ModalState = { mode: "add", initialName: "", initialDuration: "5" };
    render(<TaskEditorDialog modal={modal} onSave={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByText("Add Task", { selector: ".practice-modal-title" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add Task" })).toBeInTheDocument();
    expect(screen.getByLabelText("Task Name")).toHaveValue("");
    expect(screen.getByLabelText("Duration (minutes)")).toHaveValue(5);
  });

  it("shows Edit Task title and Save Changes button pre-filled in edit mode", () => {
    const modal: ModalState = {
      mode: "edit",
      taskId: "task-a",
      initialName: "Shadowing",
      initialDuration: "10",
    };
    render(<TaskEditorDialog modal={modal} onSave={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByText("Edit Task")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save Changes" })).toBeInTheDocument();
    expect(screen.getByLabelText("Task Name")).toHaveValue("Shadowing");
    expect(screen.getByLabelText("Duration (minutes)")).toHaveValue(10);
  });

  it("enforces min/max attributes on the duration input", () => {
    const modal: ModalState = { mode: "add", initialName: "", initialDuration: "5" };
    render(<TaskEditorDialog modal={modal} onSave={vi.fn()} onCancel={vi.fn()} />);

    const durationInput = screen.getByLabelText("Duration (minutes)");
    expect(durationInput).toHaveAttribute("min", "1");
    expect(durationInput).toHaveAttribute("max", "120");
  });

  it("passes changed name and duration values to onSave", () => {
    const onSave = vi.fn();
    const modal: ModalState = { mode: "add", initialName: "", initialDuration: "5" };
    render(<TaskEditorDialog modal={modal} onSave={onSave} onCancel={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Task Name"), { target: { value: "New Drill" } });
    fireEvent.change(screen.getByLabelText("Duration (minutes)"), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Add Task" }));

    expect(onSave).toHaveBeenCalledWith("New Drill", "12");
  });

  it("submits on Enter within the duration input", () => {
    const onSave = vi.fn();
    const modal: ModalState = { mode: "edit", taskId: "t", initialName: "X", initialDuration: "5" };
    render(<TaskEditorDialog modal={modal} onSave={onSave} onCancel={vi.fn()} />);

    fireEvent.keyDown(screen.getByLabelText("Duration (minutes)"), { key: "Enter" });
    expect(onSave).toHaveBeenCalledWith("X", "5");
  });

  it("ignores non-Enter keys in the duration input", () => {
    const onSave = vi.fn();
    const modal: ModalState = { mode: "add", initialName: "", initialDuration: "5" };
    render(<TaskEditorDialog modal={modal} onSave={onSave} onCancel={vi.fn()} />);

    fireEvent.keyDown(screen.getByLabelText("Duration (minutes)"), { key: "Tab" });
    expect(onSave).not.toHaveBeenCalled();
  });

  it("calls onCancel from the Cancel button", () => {
    const onCancel = vi.fn();
    const modal: ModalState = { mode: "add", initialName: "", initialDuration: "5" };
    render(<TaskEditorDialog modal={modal} onSave={vi.fn()} onCancel={onCancel} />);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
