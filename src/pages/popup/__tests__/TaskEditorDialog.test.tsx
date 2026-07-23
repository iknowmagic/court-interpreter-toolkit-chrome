import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi, type Mock } from "vitest";
import TaskEditorDialog from "@pages/popup/TaskEditorDialog";
import type { ModalState } from "@pages/popup/usePracticeSession";

const ADD_MODAL: ModalState = {
  mode: "add",
  initialName: "",
  initialDuration: "5",
};

function renderDialog(
  options: {
    modal?: ModalState;
    onSave?: Mock;
    onCancel?: Mock;
  } = {},
) {
  const onSave = options.onSave ?? vi.fn();
  const onCancel = options.onCancel ?? vi.fn();
  render(
    <TaskEditorDialog
      modal={options.modal ?? ADD_MODAL}
      onSave={onSave}
      onCancel={onCancel}
    />,
  );
  return { onSave, onCancel };
}

describe("TaskEditorDialog", () => {
  it("shows Add Task title and button in add mode with empty defaults", () => {
    renderDialog();

    expect(screen.getByRole("dialog", { name: "Add Task" })).toHaveAttribute(
      "aria-modal",
      "true",
    );
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
    renderDialog({ modal });

    expect(screen.getByRole("dialog", { name: "Edit Task" })).toBeInTheDocument();
    expect(screen.getByText("Edit Task")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save Changes" })).toBeInTheDocument();
    expect(screen.getByLabelText("Task Name")).toHaveValue("Shadowing");
    expect(screen.getByLabelText("Duration (minutes)")).toHaveValue(10);
  });

  it("enforces min/max attributes on the duration input", () => {
    renderDialog();

    const durationInput = screen.getByLabelText("Duration (minutes)");
    expect(durationInput).toHaveAttribute("min", "1");
    expect(durationInput).toHaveAttribute("max", "120");
  });

  it("passes changed name and duration values to onSave", () => {
    const { onSave } = renderDialog();

    fireEvent.change(screen.getByLabelText("Task Name"), { target: { value: "New Drill" } });
    fireEvent.change(screen.getByLabelText("Duration (minutes)"), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Add Task" }));

    expect(onSave).toHaveBeenCalledWith("New Drill", "12");
  });

  it("submits on Enter within the duration input", () => {
    const onSave = vi.fn();
    const modal: ModalState = { mode: "edit", taskId: "t", initialName: "X", initialDuration: "5" };
    renderDialog({ modal, onSave });

    fireEvent.keyDown(screen.getByLabelText("Duration (minutes)"), { key: "Enter" });
    expect(onSave).toHaveBeenCalledWith("X", "5");
  });

  it("ignores non-Enter keys in the duration input", () => {
    const { onSave } = renderDialog();

    fireEvent.keyDown(screen.getByLabelText("Duration (minutes)"), { key: "Tab" });
    expect(onSave).not.toHaveBeenCalled();
  });

  it("focuses the task-name input on open", () => {
    renderDialog();

    expect(screen.getByLabelText("Task Name")).toHaveFocus();
  });

  it("selects the existing task name in edit mode", () => {
    const modal: ModalState = {
      mode: "edit",
      taskId: "task-a",
      initialName: "Shadowing",
      initialDuration: "10",
    };
    renderDialog({ modal });

    const nameInput = screen.getByLabelText("Task Name") as HTMLInputElement;
    expect(nameInput).toHaveFocus();
    expect(nameInput.selectionStart).toBe(0);
    expect(nameInput.selectionEnd).toBe("Shadowing".length);
  });

  it("calls onCancel on Escape", () => {
    const { onCancel } = renderDialog();

    fireEvent.keyDown(screen.getByLabelText("Task Name"), {
      key: "Escape",
      code: "Escape",
      keyCode: 27,
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("wraps Tab from the last focusable control to the first", () => {
    renderDialog();

    const nameInput = screen.getByLabelText("Task Name");
    const cancelButton = screen.getByRole("button", { name: "Cancel" });
    cancelButton.focus();

    window.dispatchEvent(
      new window.KeyboardEvent("keydown", {
        key: "Tab",
        code: "Tab",
      }),
    );

    expect(nameInput).toHaveFocus();
  });

  it("wraps Shift+Tab from the first focusable control to the last", () => {
    renderDialog();

    const nameInput = screen.getByLabelText("Task Name");
    const cancelButton = screen.getByRole("button", { name: "Cancel" });
    nameInput.focus();

    window.dispatchEvent(
      new window.KeyboardEvent("keydown", {
        key: "Tab",
        code: "Tab",
        shiftKey: true,
      }),
    );

    expect(cancelButton).toHaveFocus();
  });

  it("calls onCancel from the Cancel button", () => {
    const { onCancel } = renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
