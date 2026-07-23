import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { ModalState } from "./usePracticeSession";

interface TaskEditorDialogProps {
  modal: ModalState;
  onSave: (name: string, duration: string) => void;
  onCancel: () => void;
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not(:disabled)",
  "input:not(:disabled)",
  "select:not(:disabled)",
  "textarea:not(:disabled)",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

type DialogKeyEvent = Pick<
  KeyboardEvent,
  "key" | "keyCode" | "shiftKey" | "target" | "preventDefault" | "stopPropagation"
>;

export default function TaskEditorDialog({
  modal,
  onSave,
  onCancel,
}: TaskEditorDialogProps): React.JSX.Element {
  const [name, setName] = useState(modal.initialName);
  const [duration, setDuration] = useState(modal.initialDuration);
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const confirm = () => onSave(name, duration);

  useEffect(() => {
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    const nameInput = nameInputRef.current;
    nameInput?.focus();
    if (modal.mode === "edit") nameInput?.select();

    return () => {
      const previousFocus = previousFocusRef.current;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [modal.mode]);

  const trapDialogKey = useCallback((event: DialogKeyEvent) => {
    const isEscape = event.key === "Escape" || event.keyCode === 27;
    const isTab = event.key === "Tab" || event.keyCode === 9;

    if (isEscape) {
      event.stopPropagation();
      onCancel();
      return;
    }

    if (!isTab) return;

    const dialog = dialogRef.current;
    if (!dialog) return;

    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
    ).filter(
      (element) =>
        element.tabIndex >= 0 &&
        !element.hasAttribute("disabled") &&
        element.getAttribute("aria-hidden") !== "true",
    ).sort((left, right) =>
      left.compareDocumentPosition(right) & 4 ? -1 : 1,
    );
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const activeElement = document.activeElement;
    const eventTarget = event.target;
    const activeIndex = focusable.findIndex(
      (element) => element === activeElement || element === eventTarget,
    );

    if (event.shiftKey && (activeIndex <= 0)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && activeIndex >= focusable.length - 1) {
      event.preventDefault();
      first.focus();
    }
  }, [onCancel]);

  useEffect(() => {
    const handleNativeKeyDown = (event: KeyboardEvent) => {
      trapDialogKey(event);
    };

    window.addEventListener("keydown", handleNativeKeyDown, true);
    return () => window.removeEventListener("keydown", handleNativeKeyDown, true);
  }, [trapDialogKey]);

  return (
    <div className="practice-modal-backdrop">
      <div
        ref={dialogRef}
        className="practice-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div id={titleId} className="practice-modal-title">
          {modal.mode === "add" ? "Add Task" : "Edit Task"}
        </div>
        <label className="practice-label">
          Task Name
          <input
            ref={nameInputRef}
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
