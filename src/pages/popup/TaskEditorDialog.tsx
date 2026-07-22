import { useState } from "react";
import type { ModalState } from "./usePracticeSession";

interface TaskEditorDialogProps {
  modal: ModalState;
  onSave: (name: string, duration: string) => void;
  onCancel: () => void;
}

export default function TaskEditorDialog({
  modal,
  onSave,
  onCancel,
}: TaskEditorDialogProps): React.JSX.Element {
  const [name, setName] = useState(modal.initialName);
  const [duration, setDuration] = useState(modal.initialDuration);

  const confirm = () => onSave(name, duration);

  return (
    <div className="practice-modal-backdrop">
      <div className="practice-modal">
        <div className="practice-modal-title">
          {modal.mode === "add" ? "Add Task" : "Edit Task"}
        </div>
        <label className="practice-label">
          Task Name
          <input
            className="practice-input"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="practice-label">
          Duration (minutes)
          <input
            className="practice-input"
            type="number"
            min={1}
            max={120}
            value={duration}
            onChange={(event) => setDuration(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && confirm()}
          />
        </label>
        <div className="practice-grid2">
          <button
            type="button"
            className="practice-btn practice-btn-strong"
            onClick={confirm}
          >
            {modal.mode === "add" ? "Add Task" : "Save Changes"}
          </button>
          <button type="button" className="practice-btn" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
