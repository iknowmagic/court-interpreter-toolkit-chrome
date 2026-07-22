import { useMemo } from "react";
import type {
  PracticeSession,
  PracticeSessionSummary,
  PracticeSessionTask,
  PracticeTemplateTask,
} from "@shared/practice";
import { formatDuration } from "@shared/practice";
import SessionCalendarPopover from "./SessionCalendarPopover";
import { parseDateKey } from "./sessionPopupUtils";

const C = {
  accent: "#c4622d",
  accentBg: "#fef3e8",
  done: "#2e7d52",
} as const;

interface SessionWorkspaceProps {
  template: PracticeTemplateTask[];
  session: PracticeSession;
  selected: PracticeSessionTask | null;
  active: PracticeSessionTask | null;
  activeIndex: number;
  selectedIndex: number;
  selectedTemplateIndex: number;
  doneCount: number;
  totalMinutes: number;
  remainingMinutes: number;
  timerDisplaySeconds: number;
  running: boolean;
  isViewingToday: boolean;
  todayDateKey: string;
  sessionSummaries: PracticeSessionSummary[];
  onSelectTask: (taskId: string) => void;
  onAddTask: () => void;
  onEditTask: () => void;
  onMoveTask: (direction: -1 | 1) => void;
  onDeleteTask: () => void;
  onResetDefaults: () => void;
  onUpdateNote: (taskId: string, note: string) => void;
  onPlay: () => void;
  onStop: () => void;
  onResetCurrent: () => void;
  onCompleteAndNext: () => void;
  onSelectDate: (dateKey: string) => Promise<boolean>;
  onToday: () => Promise<boolean>;
}

export default function SessionWorkspace({
  template,
  session,
  selected,
  active,
  activeIndex,
  selectedIndex,
  selectedTemplateIndex,
  doneCount,
  totalMinutes,
  remainingMinutes,
  timerDisplaySeconds,
  running,
  isViewingToday,
  todayDateKey,
  sessionSummaries,
  onSelectTask,
  onAddTask,
  onEditTask,
  onMoveTask,
  onDeleteTask,
  onResetDefaults,
  onUpdateNote,
  onPlay,
  onStop,
  onResetCurrent,
  onCompleteAndNext,
  onSelectDate,
  onToday,
}: SessionWorkspaceProps): React.JSX.Element {
  const viewingDateLabel = useMemo(
    () =>
      new Intl.DateTimeFormat("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(parseDateKey(session.date)),
    [session.date],
  );

  return (
    <main className="practice-layout">
      <section className="practice-side" style={{ gridArea: "left" }}>
        <div className="practice-card practice-list-card">
          <div className="practice-list-head">
            <span>#</span>
            <span>Task</span>
            <span>Time</span>
          </div>
          <div className="practice-task-list">
            {session.tasks.map((task, index) => {
              const isActive = task.id === session.currentTaskId && !session.done;
              const isSelected = task.id === selected?.id;
              const isDone = task.completedAt !== null;
              return (
                <button
                  key={task.id}
                  type="button"
                  className="practice-task"
                  onClick={() => onSelectTask(task.id)}
                  style={{
                    borderLeftColor: isDone
                      ? C.done
                      : isActive
                        ? C.accent
                        : isSelected
                          ? `${C.accent}99`
                          : "transparent",
                    background:
                      isActive || isSelected
                        ? C.accentBg
                        : isDone
                          ? "#f9f8f5"
                          : "transparent",
                    opacity: isDone && !isSelected ? 0.72 : 1,
                  }}
                >
                  <span className="practice-task-num">{isDone ? "✓" : index + 1}</span>
                  <span className="practice-task-name">{task.name}</span>
                  <span className="practice-task-time">{`${task.duration}m`}</span>
                </button>
              );
            })}
          </div>
          <div className="practice-list-footer" aria-hidden="true" />
        </div>
        <div className="practice-side-controls">
          <div className="practice-grid2">
            <button
              type="button"
              className="practice-btn"
              onClick={onAddTask}
              disabled={!isViewingToday}
            >
              + Add Task
            </button>
            <button
              type="button"
              className="practice-btn"
              onClick={onEditTask}
              disabled={!isViewingToday || !selected}
            >
              Edit Task
            </button>
          </div>
          <div className="practice-grid2">
            <button
              type="button"
              className="practice-btn"
              onClick={() => onMoveTask(-1)}
              disabled={!isViewingToday || selectedTemplateIndex <= 0}
            >
              ↑ Move Up
            </button>
            <button
              type="button"
              className="practice-btn"
              onClick={() => onMoveTask(1)}
              disabled={
                !isViewingToday ||
                selectedTemplateIndex < 0 ||
                selectedTemplateIndex >= template.length - 1
              }
            >
              ↓ Move Down
            </button>
          </div>
          <div className="practice-grid2">
            <button
              type="button"
              className="practice-btn"
              onClick={onDeleteTask}
              disabled={!isViewingToday || !selected || template.length <= 1}
            >
              Delete Task
            </button>
            <button
              type="button"
              className="practice-btn practice-btn-danger"
              onClick={onResetDefaults}
              disabled={!isViewingToday}
            >
              Reset List
            </button>
          </div>
          <SessionCalendarPopover
            sessionDate={session.date}
            isSessionDone={session.done}
            todayDateKey={todayDateKey}
            summaries={sessionSummaries}
            onSelectDate={onSelectDate}
            onToday={onToday}
          />
        </div>
      </section>

      <section className="practice-main" style={{ gridArea: "right" }}>
        <div className="practice-card practice-timer-card">
          <div className="practice-current-head">
            <div className="practice-eyebrow">Current Task</div>
            {!isViewingToday ? (
              <span className="practice-history-badge">{`Viewing ${viewingDateLabel}`}</span>
            ) : selected?.completedAt ? (
              <span className="practice-completed">Completed {selected.completedAt}</span>
            ) : null}
          </div>
          <div className="practice-current">
            {session.done ? "Session Complete" : (active?.name ?? "—")}
          </div>
          <div className="practice-timer">{formatDuration(timerDisplaySeconds)}</div>
          <div className="practice-status">
            {!isViewingToday
              ? "History view — read only"
              : session.done
                ? "Every task complete — great session"
                : running
                  ? "● Running"
                  : "Stopped"}
          </div>
          <div className="practice-grid2 practice-actions">
            <button
              type="button"
              className="practice-btn practice-btn-strong"
              onClick={onPlay}
              disabled={!isViewingToday || running || !active}
            >
              ▶ Play
            </button>
            <button
              type="button"
              className="practice-btn"
              onClick={onStop}
              disabled={!isViewingToday || !running}
            >
              ■ Stop
            </button>
          </div>
          <div className="practice-grid2 practice-actions">
            <button
              type="button"
              className="practice-btn"
              onClick={onResetCurrent}
              disabled={!isViewingToday || !active || session.done}
            >
              ↺ Reset Task
            </button>
            <button
              type="button"
              className="practice-btn practice-btn-strong"
              onClick={onCompleteAndNext}
              disabled={
                !isViewingToday || !active || session.done || active.completedAt !== null
              }
            >
              ✓ Done
            </button>
          </div>
          <div className="practice-meta">
            <span>
              Task{" "}
              <strong>
                {activeIndex >= 0 ? `${activeIndex + 1} of ${session.tasks.length}` : "—"}
              </strong>
            </span>
            <span>
              Remaining <strong>{remainingMinutes}m</strong>
            </span>
            <span>
              Done{" "}
              <strong>
                {doneCount}/{session.tasks.length}
              </strong>
            </span>
            <span>
              Total <strong>{totalMinutes}m</strong>
            </span>
          </div>
        </div>
      </section>

      <section className="practice-main practice-main-notes" style={{ gridArea: "notes" }}>
        <div className="practice-card practice-notes-card">
          <div className="practice-eyebrow">Task Notes</div>
          <div className="practice-note-title">
            {selectedIndex >= 0 ? `${selectedIndex + 1}. ${selected?.name ?? "—"}` : "Select a task"}
          </div>
          <textarea
            className="practice-textarea"
            value={selected?.note ?? ""}
            onChange={(event) => selected && onUpdateNote(selected.id, event.target.value)}
            placeholder="What did you practice?"
            disabled={!selected || !isViewingToday}
          />
        </div>
      </section>
    </main>
  );
}
