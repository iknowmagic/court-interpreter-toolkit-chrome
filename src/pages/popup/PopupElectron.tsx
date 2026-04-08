import { useEffect, useState, useCallback } from "react";
import * as rpc from "@utils/chromeRPC";
import type {
  PracticeState,
  PracticeTemplateTask,
  PracticeSessionTask,
} from "@shared/practice";
import {
  formatDuration,
  formatLosAngelesClock,
  formatLosAngelesDateLabel,
} from "@shared/practice";
import TaskCustomizer from "@components/TaskCustomizer";
import "@assets/styles/globals.css";

const TIMER_INTERVAL_MS = 1000;

function findTask(
  tasks: PracticeSessionTask[],
  taskId: string | null,
): PracticeSessionTask | null {
  return taskId
    ? (tasks.find((t) => t.id === taskId) ?? null)
    : (tasks[0] ?? null);
}

function taskIndex(
  tasks: PracticeSessionTask[],
  taskId: string | null,
): number {
  return taskId ? tasks.findIndex((t) => t.id === taskId) : -1;
}

export default function PopupElectron() {
  const [state, setState] = useState<PracticeState | null>(null);
  const [running, setRunning] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [clock, setClock] = useState(() => formatLosAngelesClock());
  const [showTaskCustomizer, setShowTaskCustomizer] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load initial state
  useEffect(() => {
    (async () => {
      try {
        const initialState = await rpc.getSessionState();
        setState(initialState);
        if (initialState?.session.currentTaskId) {
          setSelectedTaskId(initialState.session.currentTaskId);
        }
        setLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      }
    })();
  }, []);

  // Update clock every second
  useEffect(() => {
    const interval = setInterval(() => setClock(formatLosAngelesClock()), 1000);
    return () => clearInterval(interval);
  }, []);

  // Timer decrement loop
  useEffect(() => {
    if (!running || !state) return;
    const interval = setInterval(() => {
      (async () => {
        try {
          const newState = await rpc.decrementTimer(1);
          setState(newState);
        } catch (err) {
          console.error("Failed to decrement timer:", err);
        }
      })();
    }, TIMER_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [running, state]);

  // Auto-save session
  useEffect(() => {
    const timeout = setTimeout(() => {
      if (state && running) {
        (async () => {
          try {
            await rpc.saveSession(state);
          } catch (err) {
            console.error("Failed to auto-save:", err);
          }
        })();
      }
    }, 350);
    return () => clearTimeout(timeout);
  }, [state, running]);

  const active = findTask(
    state?.session.tasks ?? [],
    state?.session.currentTaskId ?? null,
  );
  const selected = findTask(state?.session.tasks ?? [], selectedTaskId ?? null);
  const activeIndex = taskIndex(
    state?.session.tasks ?? [],
    state?.session.currentTaskId ?? null,
  );
  const selectedIndex = taskIndex(
    state?.session.tasks ?? [],
    selectedTaskId ?? null,
  );
  const doneCount = (state?.session.tasks ?? []).filter(
    (t) => t.completedAt !== null,
  ).length;
  const totalMinutes = (state?.template ?? []).reduce(
    (sum, t) => sum + t.duration,
    0,
  );
  const remainingMinutes = Math.ceil(
    (state?.session.tasks ?? []).reduce(
      (sum, t) => sum + t.remainingSeconds,
      0,
    ) / 60,
  );
  const progress =
    (state?.template?.length ?? 0) > 0
      ? doneCount / (state?.template?.length ?? 1)
      : 0;

  const timerDisplaySeconds = active
    ? Math.max(
        0,
        active.remainingSeconds === 0
          ? active.duration * 60
          : active.remainingSeconds,
      )
    : 0;

  const selectTask = useCallback(
    (taskId: string) => {
      setSelectedTaskId(taskId);
      setRunning(false);
      if (state) {
        setState({
          ...state,
          session: {
            ...state.session,
            currentTaskId: taskId,
            done: false,
          },
        });
      }
    },
    [state],
  );

  const play = useCallback(async () => {
    if (!running && active && !state?.session.done) {
      setRunning(true);
    }
  }, [running, active, state?.session.done]);

  const stop = useCallback(() => {
    setRunning(false);
  }, []);

  const resetCurrent = useCallback(async () => {
    if (active && state) {
      const newState = await rpc.saveSession({
        ...state,
        session: {
          ...state.session,
          tasks: state.session.tasks.map((t) =>
            t.id === active.id
              ? { ...t, remainingSeconds: t.duration * 60, completedAt: null }
              : t,
          ),
        },
      });
      setState(newState);
    }
  }, [active, state]);

  const skipNext = useCallback(async () => {
    if (active && state) {
      const index = taskIndex(state.session.tasks, active.id);
      const completedAt = active.completedAt ?? new Date().toISOString();
      const tasks = state.session.tasks.map((t) =>
        t.id === active.id ? { ...t, remainingSeconds: 0, completedAt } : t,
      );
      const nextId =
        tasks[index + 1]?.id ?? tasks[tasks.length - 1]?.id ?? active.id;
      const newState = await rpc.saveSession({
        ...state,
        session: {
          ...state.session,
          tasks,
          currentTaskId:
            index >= tasks.length - 1
              ? (tasks[tasks.length - 1]?.id ?? active.id)
              : nextId,
          done: index >= tasks.length - 1,
        },
      });
      setState(newState);
      setRunning(false);
    }
  }, [active, state]);

  const markDone = useCallback(async () => {
    if (active && state) {
      const newState = await rpc.saveSession({
        ...state,
        session: {
          ...state.session,
          tasks: state.session.tasks.map((t) =>
            t.id === active.id
              ? { ...t, completedAt: t.completedAt ?? new Date().toISOString() }
              : t,
          ),
        },
      });
      setState(newState);
    }
  }, [active, state]);

  const newDay = useCallback(async () => {
    try {
      setRunning(false);
      const newState = await rpc.newDay(state?.template);
      setState(newState);
      setSelectedTaskId(newState?.session.currentTaskId ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [state?.template]);

  const updateNote = useCallback(
    (noteText: string) => {
      if (selected && state) {
        setState({
          ...state,
          session: {
            ...state.session,
            tasks: state.session.tasks.map((t) =>
              t.id === selected.id ? { ...t, note: noteText } : t,
            ),
          },
        });
      }
    },
    [selected, state],
  );

  const handleSaveTemplate = useCallback(
    async (template: PracticeTemplateTask[]) => {
      try {
        const newState = await rpc.editTemplate(template);
        setState(newState);
        setShowTaskCustomizer(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [],
  );

  if (loading) {
    return <div style={{ padding: 40, textAlign: "center" }}>Loading...</div>;
  }

  if (!state) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "red" }}>
        Failed to load
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "var(--bg)",
      }}
    >
      {/* Header */}
      <div className="practice-header">
        <div>
          <div className="practice-title">COURT INTERPRETER</div>
          <div className="practice-subtitle">Daily Practice Session</div>
          <div className="practice-date">{formatLosAngelesDateLabel()}</div>
        </div>
        <div className="practice-clock-wrap">
          <div className="practice-clock">{clock}</div>
          <div className="practice-summary">
            {doneCount}/{state.template.length} | {remainingMinutes}/{totalMinutes}m
          </div>
        </div>
      </div>

      {error && (
        <div style={{ padding: "6px 12px", color: "#9d3412", fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* Progress */}
      <div className="practice-progress">
        <div
          style={{ width: `${Math.max(0, Math.min(100, progress * 100))}%` }}
        />
      </div>

      {/* Main Layout */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "200px 1fr",
          gap: 12,
          padding: 12,
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        {/* Left: Task List */}
        <div className="practice-card practice-list-card">
          <div className="practice-list-head">
            <span>#</span>
            <span>Task</span>
            <span>Time</span>
          </div>
          <div className="practice-task-list">
            {state.session.tasks.map((task, index) => {
              const isActive =
                task.id === state.session.currentTaskId && !state.session.done;
              const isSelected = task.id === selectedTaskId;
              const isDone = task.completedAt !== null;
              return (
                <button
                  key={task.id}
                  type="button"
                  className="practice-task"
                  onClick={() => selectTask(task.id)}
                  style={{
                    borderLeftColor: isDone
                      ? "var(--done)"
                      : isActive
                        ? "var(--accent)"
                        : isSelected
                          ? "rgba(196, 98, 45, 0.6)"
                          : "transparent",
                    background:
                      isActive || isSelected
                        ? "var(--accent-bg)"
                        : isDone
                          ? "#f9f8f5"
                          : "transparent",
                    opacity: isDone && !isSelected ? 0.72 : 1,
                  }}
                >
                  <span className="practice-task-num">
                    {isDone ? "✓" : index + 1}
                  </span>
                  <span className="practice-task-name">{task.name}</span>
                  <span className="practice-task-time">{task.duration}m</span>
                </button>
              );
            })}
          </div>
          <div className="practice-grid2" style={{ marginTop: "auto" }}>
            <button type="button" className="practice-btn" onClick={newDay}>
              New Day
            </button>
          </div>
        </div>

        {/* Right: Timer + Notes */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
            minHeight: 0,
            overflow: "hidden",
          }}
        >
          {/* Timer Card */}
          <div className="practice-card" style={{ flex: "0 0 auto" }}>
            <div className="practice-current-head">
              <div className="practice-eyebrow">Current Task</div>
            </div>
            <div className="practice-current">
              {state.session.done ? "Session Complete" : (active?.name ?? "—")}
            </div>
            <div className="practice-timer">
              {formatDuration(timerDisplaySeconds)}
            </div>
            <div className="practice-status">
              {state.session.done
                ? "Every task complete"
                : running
                  ? "● Running"
                  : "STOPPED"}
            </div>
            <div className="practice-grid2 practice-actions">
              <button
                type="button"
                className="practice-btn practice-btn-strong"
                onClick={play}
                disabled={running || state.session.done || !active}
              >
                ▶ Play
              </button>
              <button
                type="button"
                className="practice-btn"
                onClick={stop}
                disabled={!running}
              >
                ■ Stop
              </button>
            </div>
            <div className="practice-grid3 practice-actions">
              <button
                type="button"
                className="practice-btn"
                onClick={resetCurrent}
                disabled={!active || state.session.done}
              >
                ↺ Reset
              </button>
              <button
                type="button"
                className="practice-btn"
                onClick={skipNext}
                disabled={!active || state.session.done}
              >
                ⏭ Next
              </button>
              <button
                type="button"
                className="practice-btn practice-btn-strong"
                onClick={markDone}
                disabled={
                  !active || state.session.done || active.completedAt !== null
                }
              >
                ✓ Done
              </button>
            </div>
            <div className="practice-meta">
              <span>
                Task{" "}
                <strong>
                  {activeIndex >= 0
                    ? `${activeIndex + 1}/${state.session.tasks.length}`
                    : "—"}
                </strong>
              </span>
              <span>
                Remaining <strong>{remainingMinutes}m</strong>
              </span>
            </div>
          </div>

          {/* Notes Card */}
          <div
            className="practice-card"
            style={{
              flex: 1,
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div className="practice-eyebrow">Task Notes</div>
            <div className="practice-note-title" style={{ marginBottom: 8 }}>
              {selectedIndex >= 0
                ? `${selectedIndex + 1}. ${selected?.name ?? "—"}`
                : "Select a task"}
            </div>
            <textarea
              className="practice-textarea"
              value={selected?.note ?? ""}
              onChange={(e) => updateNote(e.target.value)}
              placeholder="What did you practice?"
              disabled={!selected}
              style={{ flex: 1, marginBottom: 8 }}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                className="practice-btn practice-btn-strong"
                onClick={() => selected && updateNote(selected.note)}
                disabled={!selected}
              >
                Save Note
              </button>
              <button
                type="button"
                className="practice-btn"
                onClick={() => selected && updateNote("")}
                disabled={!selected}
              >
                Clear
              </button>
            </div>
          </div>
        </div>
      </div>

      {showTaskCustomizer && state && (
        <TaskCustomizer
          template={state.template}
          onSave={handleSaveTemplate}
          onCancel={() => setShowTaskCustomizer(false)}
        />
      )}
    </div>
  );
}
