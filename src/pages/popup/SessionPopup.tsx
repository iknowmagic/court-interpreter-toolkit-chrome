import { useMemo } from "react";
import { usePracticeSession } from "./usePracticeSession";
import SessionWorkspace from "./SessionWorkspace";
import TaskEditorDialog from "./TaskEditorDialog";
import { parseDateKey } from "./sessionPopupUtils";

export default function SessionPopup(): React.JSX.Element {
  const app = usePracticeSession();

  const sessionDateHeaderLabel = useMemo(
    () =>
      new Intl.DateTimeFormat("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      }).format(parseDateKey(app.session.date)),
    [app.session.date],
  );

  if (app.loadStatus === "loading") {
    return (
      <div className="practice-loading">
        Court Interpreter Toolkit
        <br />
        Loading practice session...
      </div>
    );
  }

  if (app.loadStatus === "error") {
    return (
      <div className="practice-loading practice-loading-error">
        <div className="practice-load-error-title">Court Interpreter Toolkit</div>
        <div className="practice-load-error-message" role="alert">
          {app.loadError ?? "Failed to load the practice session."}
        </div>
        <button type="button" className="practice-btn practice-btn-strong" onClick={app.retryLoad}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div
      className={`practice-app practice-app--popup${app.isViewingToday ? "" : " practice-app--history"}`}
    >
      <div className="practice-shell">
        <header className="practice-header">
          <div>
            <div className="practice-title">Court Interpreter Toolkit</div>
            <div className="practice-subtitle">Daily Practice Session</div>
            <div className="practice-date">{sessionDateHeaderLabel}</div>
          </div>
          <div className="practice-clock-wrap">
            <div className="practice-clock">{app.clock}</div>
            <div className="practice-summary">
              {app.doneCount}/{app.template.length} | {app.remainingMinutes}m
            </div>
          </div>
        </header>

        <div className="practice-progress">
          <div style={{ width: `${Math.max(0, Math.min(100, app.progress * 100))}%` }} />
        </div>

        {app.operationError ? (
          <div className="practice-operation-error" role="alert">
            <span>{app.operationError}</span>
            <button type="button" onClick={app.dismissOperationError} aria-label="Dismiss error">
              ✕
            </button>
          </div>
        ) : null}

        <SessionWorkspace
          template={app.template}
          session={app.session}
          selected={app.selected}
          active={app.active}
          activeIndex={app.activeIndex}
          selectedIndex={app.selectedIndex}
          selectedTemplateIndex={app.selectedTemplateIndex}
          doneCount={app.doneCount}
          totalMinutes={app.totalMinutes}
          remainingMinutes={app.remainingMinutes}
          timerDisplaySeconds={app.timerDisplaySeconds}
          running={app.running}
          isViewingToday={app.isViewingToday}
          todayDateKey={app.todayDateKey}
          sessionSummaries={app.sessionSummaries}
          onSelectTask={(taskId) => void app.selectTask(taskId)}
          onAddTask={app.openAddModal}
          onEditTask={app.openEditModal}
          onMoveTask={(direction) => void app.moveTask(direction)}
          onDeleteTask={() => void app.deleteTask()}
          onResetDefaults={() => void app.resetDefaults()}
          onUpdateNote={app.updateNote}
          onPlay={() => void app.play()}
          onStop={() => void app.stop()}
          onResetCurrent={app.resetCurrent}
          onCompleteAndNext={() => void app.completeAndNext()}
          onSelectDate={app.loadDate}
          onToday={app.goToToday}
          noteSaveStatus={app.noteSaveStatus}
          lastNoteSavedAt={app.lastNoteSavedAt}
        />
      </div>

      {app.modal ? (
        <TaskEditorDialog
          modal={app.modal}
          onSave={(name, duration) => void app.confirmModal(name, duration)}
          onCancel={app.closeModal}
        />
      ) : null}
    </div>
  );
}
