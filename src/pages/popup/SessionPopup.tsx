import { useMemo } from "react";
import { usePracticeSession } from "./usePracticeSession";
import SessionWorkspace from "./SessionWorkspace";
import TaskEditorDialog from "./TaskEditorDialog";
import { parseDateKey } from "./sessionPopupUtils";

const C = {
  bg: "#ede8de",
  surface: "#fdfaf5",
  border: "#d4ccbf",
  text: "#1a1714",
  muted: "#7a6e65",
  hint: "#9e9188",
  accent: "#c4622d",
  accentDk: "#a85025",
  accentBg: "#fef3e8",
  done: "#2e7d52",
  dark: "#1a1714",
  disabledBg: "#e3e3e3",
  disabledBorder: "#9d9d9d",
  disabledText: "#676767",
  danger: "#8f2f1f",
} as const;

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
      <style>{`
        .practice-app{min-height:100%;display:flex;flex-direction:column;background:${C.bg};color:${C.text}}
        .practice-shell{width:min(1120px,calc(100% - 24px));margin:0 auto;display:flex;flex-direction:column;flex:1}
        .practice-layout{display:grid;grid-template-columns:300px minmax(0,760px);grid-template-areas:'left right' 'left notes' 'calendar .';align-items:stretch;justify-content:center;gap:14px;padding:14px;flex:1;min-height:0}
        .practice-task-list{flex:0 0 270px;height:270px;min-height:270px;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain}
        .practice-task-list{scrollbar-width:thin;scrollbar-color:#e9d0a8 #fdfaf5}
        .practice-task-list::-webkit-scrollbar{width:10px}
        .practice-task-list::-webkit-scrollbar-track{background:#fdfaf5;border-radius:10px}
        .practice-task-list::-webkit-scrollbar-thumb{background:#e9d0a8;border-radius:10px;border:2px solid #fdfaf5}
        .practice-task-list::-webkit-scrollbar-thumb:hover{background:#dfbe8d}
        .practice-side,.practice-main{min-width:0}
        .practice-side{display:flex;flex-direction:column;gap:10px;min-height:0}
        .practice-side .practice-list-card{flex:1;min-height:0}
        .practice-list-footer{flex:0 0 10px;height:10px}
        .practice-side-controls{display:flex;flex-direction:column;gap:10px}
        .practice-task:hover{background:#faf5ee!important}
        .practice-btn:hover:not(:disabled){background:${C.accentBg}!important;border-color:${C.accent}!important;color:${C.accent}!important}
        .practice-btn-strong{background:${C.accent}!important;border-color:${C.accent}!important;color:#fff!important}
        .practice-btn-strong:hover:not(:disabled){background:${C.accentDk}!important;border-color:${C.accentDk}!important;color:#fff!important}
        .practice-btn-danger{background:#8f2f1f!important;border-color:#8f2f1f!important;color:#fff!important}
        .practice-btn-danger:hover:not(:disabled){background:#76271a!important;border-color:#76271a!important;color:#fff!important}
        .practice-btn:disabled,.practice-input:disabled,.practice-textarea:disabled{cursor:not-allowed}
        .practice-app--history .practice-btn:disabled,.practice-app--history .practice-input:disabled,.practice-app--history .practice-textarea:disabled{background:${C.disabledBg}!important;border-color:${C.disabledBorder}!important;color:${C.disabledText}!important;box-shadow:none!important}
        .practice-app--history .practice-btn:disabled:hover{background:${C.disabledBg}!important;border-color:${C.disabledBorder}!important;color:${C.disabledText}!important}
        .practice-current-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px}
        .practice-input:focus,.practice-textarea:focus{border-color:${C.accent}!important;outline:none}
        .practice-calendar-popover{position:fixed;z-index:250;width:280px;max-width:calc(100vw - 16px);background:${C.surface};border:1px solid ${C.border};border-radius:12px;box-shadow:0 18px 42px rgba(26,23,20,0.22);padding:10px}
        .practice-popover-title{font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:${C.muted};margin-bottom:8px}
        .practice-calendar-popover .practice-calendar{margin-top:0}
        .practice-calendar-day-inner{position:relative;display:inline-flex;align-items:center;justify-content:center;width:100%}
        .practice-calendar-check{position:absolute;top:-4px;right:2px;font-size:9px;line-height:1;color:${C.done};opacity:0}
        .practice-calendar-day.is-complete .practice-calendar-check{opacity:1}
        .practice-calendar-day:disabled{opacity:.45;cursor:default}
        .practice-history-badge{font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:${C.muted}}
        .practice-loading{min-height:100%;display:grid;place-items:center;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:${C.bg};color:${C.text};text-align:center}
        .practice-loading-error{gap:12px;padding:24px}
        .practice-load-error-title{font-size:18px;font-weight:700}
        .practice-load-error-message{font-size:13px;color:${C.muted};max-width:320px}
        .practice-operation-error{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0 14px;padding:8px 12px;border-radius:8px;background:#fdeceb;border:1px solid #e0a79c;color:#7a2b1f;font-size:12px}
        .practice-operation-error button{background:none;border:none;color:inherit;font-weight:700;cursor:pointer;padding:0 4px}
        .practice-app--popup .practice-shell{width:min(620px,100%);padding:0}
        .practice-app--popup .practice-layout{grid-template-columns:240px minmax(0,1fr);grid-template-rows:auto minmax(0,1fr);grid-template-areas:'left right' 'left notes';gap:8px;padding:8px}
        .practice-app--popup .practice-header{padding:12px 16px 10px;gap:12px}
        .practice-app--popup .practice-title{font-size:22px}
        .practice-app--popup .practice-subtitle{font-size:9px;letter-spacing:0.16em}
        .practice-app--popup .practice-date,.practice-app--popup .practice-summary{font-size:11px}
        .practice-app--popup .practice-clock{font-size:14px}
        .practice-app--popup .practice-side{gap:8px;height:100%}
        .practice-app--popup .practice-side-controls{gap:8px;margin-top:auto}
        .practice-app--popup .practice-main{gap:10px}
        .practice-app--popup .practice-main.practice-main-notes{justify-content:flex-end;min-height:0}
        .practice-app--popup .practice-side .practice-list-card{flex:0 0 auto;min-height:0}
        .practice-app--popup .practice-task-list{height:270px;min-height:270px}
        .practice-app--popup .practice-list-head{padding:8px 10px;font-size:9px}
        .practice-app--popup .practice-task{padding:8px 10px}
        .practice-app--popup .practice-task-name{font-size:11px}
        .practice-app--popup .practice-btn{padding:7px 8px;font-size:11px}
        .practice-app--popup .practice-timer-card,.practice-app--popup .practice-notes-card{padding:14px 16px}
        .practice-app--popup .practice-current{font-size:20px;margin-bottom:10px}
        .practice-app--popup .practice-timer{font-size:64px;margin-bottom:2px}
        .practice-app--popup .practice-status{margin-bottom:10px}
        .practice-app--popup .practice-actions{margin-bottom:8px}
        .practice-app--popup .practice-meta{gap:12px;padding:8px 10px;font-size:10px}
        .practice-app--popup .practice-note-title{font-size:12px;margin-bottom:6px}
        .practice-app--popup .practice-textarea{min-height:64px;padding:8px 10px;margin-bottom:8px}
        .practice-app--popup .practice-calendar-popover{width:280px;max-width:calc(100vw - 16px)}
        @media (max-width:745px){.practice-main .practice-grid2.practice-actions{grid-template-columns:repeat(2,minmax(0,1fr))}}
        @media (max-width:650px){.practice-layout{grid-template-columns:1fr;grid-template-areas:'right' 'left' 'notes'}.practice-task-list{height:270px;min-height:270px}}
      `}</style>

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
