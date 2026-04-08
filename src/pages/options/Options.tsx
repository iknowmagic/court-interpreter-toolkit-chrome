import React, { useEffect, useState, useCallback } from "react";
import * as rpc from "@utils/chromeRPC";
import type {
  PracticeState,
  PracticeTemplateTask,
  PracticeSession,
} from "@shared/practice";
import { formatDuration, formatLosAngelesClock } from "@shared/practice";
import SessionTimer from "@components/SessionTimer";
import TaskCustomizer from "@components/TaskCustomizer";
import "@pages/options/Options.css";

const TIMER_INTERVAL_MS = 1000; // 1 second

export default function Options() {
  const [state, setState] = useState<PracticeState | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [showTaskCustomizer, setShowTaskCustomizer] = useState(false);
  const [taskNote, setTaskNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Load initial state
  useEffect(() => {
    (async () => {
      try {
        const initialState = await rpc.getSessionState();
        setState(initialState);
        setLoading(false);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        setLoading(false);
      }
    })();
  }, []);

  // Update clock every second
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Update task note from current session
  useEffect(() => {
    if (state && state.session.currentTaskId) {
      const currentTask = state.session.tasks.find(
        (t) => t.id === state.session.currentTaskId,
      );
      setTaskNote(currentTask?.note || "");
    }
  }, [state?.session.currentTaskId, state?.session.tasks]);

  // Timer decrement loop
  useEffect(() => {
    if (!isRunning) {
      return;
    }

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
  }, [isRunning]);

  // Auto-save session on state change (debounced via effect cleanup)
  useEffect(() => {
    const timeout = setTimeout(() => {
      if (state && isRunning) {
        (async () => {
          try {
            await rpc.saveSession(state);
          } catch (err) {
            console.error("Failed to auto-save session:", err);
          }
        })();
      }
    }, 350);

    return () => clearTimeout(timeout);
  }, [state, isRunning]);

  const handleStartSession = useCallback(async () => {
    try {
      const updatedState = await rpc.startSession();
      setState(updatedState);
      setIsRunning(true);
      setIsPaused(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const handlePauseSession = useCallback(async () => {
    try {
      const updatedState = await rpc.pauseSession();
      setState(updatedState);
      setIsRunning(false);
      setIsPaused(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const handleResumeSession = useCallback(async () => {
    try {
      const updatedState = await rpc.resumeSession();
      setState(updatedState);
      setIsRunning(true);
      setIsPaused(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const handleTaskNoteChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newNote = e.target.value;
      setTaskNote(newNote);

      // Update state and persist
      if (state && state.session.currentTaskId) {
        const updatedSession = { ...state.session };
        const currentTask = updatedSession.tasks.find(
          (t) => t.id === state.session.currentTaskId,
        );
        if (currentTask) {
          currentTask.note = newNote;
        }
        const newState = { ...state, session: updatedSession };
        setState(newState);
      }
    },
    [state],
  );

  const handleNewDay = useCallback(async () => {
    try {
      const newState = await rpc.newDay(state?.template);
      setState(newState);
      setIsRunning(false);
      setIsPaused(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [state?.template]);

  const handleResetToDefaults = useCallback(async () => {
    try {
      const newState = await rpc.resetToDefaults();
      setState(newState);
      setIsRunning(false);
      setIsPaused(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

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
    return (
      <div className="min-h-screen bg-gray-100 p-8">
        <div className="max-w-2xl mx-auto">
          <div className="text-center text-gray-600">Loading...</div>
        </div>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="min-h-screen bg-gray-100 p-8">
        <div className="max-w-2xl mx-auto">
          <div className="text-center text-red-600">
            Failed to load session state
          </div>
        </div>
      </div>
    );
  }

  const currentTask = state.session.tasks.find(
    (t) => t.id === state.session.currentTaskId,
  );
  const taskCount = state.session.tasks.length;
  const completedCount = state.session.tasks.filter(
    (t) => t.completedAt !== null,
  ).length;
  const remainingMs = (currentTask?.remainingSeconds || 0) * 1000;

  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <div className="flex justify-between items-center">
            <h1 className="text-3xl font-bold text-gray-800">
              Court Interpreter Practice
            </h1>
            <div className="text-lg text-gray-600 font-mono">
              {formatLosAngelesClock(currentTime)}
            </div>
          </div>
        </div>

        {/* Error Display */}
        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-6">
            {error}
          </div>
        )}

        {/* Timer Display */}
        <div className="bg-cyan-50 rounded-lg shadow p-6 mb-6">
          {currentTask ? (
            <>
              <div className="text-center mb-4">
                <h2 className="text-xl font-semibold text-gray-800">
                  {currentTask.name}
                </h2>
                <p className="text-sm text-gray-600">
                  Task {completedCount + 1} of {taskCount}
                </p>
              </div>

              <SessionTimer
                remainingMs={remainingMs}
                isRunning={isRunning}
                totalMs={(currentTask.duration || 0) * 60000}
              />

              <div className="mt-6 flex gap-2 justify-center">
                {!isRunning && !isPaused && (
                  <button
                    onClick={handleStartSession}
                    className="px-6 py-2 bg-cyan-600 text-white rounded hover:bg-cyan-700 transition"
                  >
                    Start
                  </button>
                )}
                {isRunning && (
                  <button
                    onClick={handlePauseSession}
                    className="px-6 py-2 bg-yellow-600 text-white rounded hover:bg-yellow-700 transition"
                  >
                    Pause
                  </button>
                )}
                {isPaused && (
                  <button
                    onClick={handleResumeSession}
                    className="px-6 py-2 bg-green-600 text-white rounded hover:bg-green-700 transition"
                  >
                    Resume
                  </button>
                )}
              </div>
            </>
          ) : (
            <div className="text-center text-gray-600">
              <p className="mb-4">All tasks completed!</p>
              <button
                onClick={handleNewDay}
                className="px-6 py-2 bg-cyan-600 text-white rounded hover:bg-cyan-700 transition"
              >
                Start New Day
              </button>
            </div>
          )}
        </div>

        {/* Task Notes */}
        {currentTask && (
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <label className="block text-lg font-semibold text-gray-800 mb-2">
              Task Notes
            </label>
            <textarea
              value={taskNote}
              onChange={handleTaskNoteChange}
              placeholder="Add notes for this task..."
              className="w-full h-24 px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-cyan-600"
            />
          </div>
        )}

        {/* Control Buttons */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <div className="flex gap-3 flex-wrap">
            <button
              onClick={() => setShowTaskCustomizer(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition"
            >
              Edit Tasks
            </button>
            <button
              onClick={handleNewDay}
              className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 transition"
            >
              New Day
            </button>
            <button
              onClick={handleResetToDefaults}
              className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition"
            >
              Reset to Defaults
            </button>
          </div>
        </div>

        {/* Task List */}
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">Tasks</h3>
          <div className="space-y-2">
            {state.session.tasks.map((task) => (
              <div
                key={task.id}
                className={`p-3 rounded ${
                  task.completedAt
                    ? "bg-green-50 border-l-4 border-green-500"
                    : task.id === state.session.currentTaskId
                      ? "bg-cyan-50 border-l-4 border-cyan-500"
                      : "bg-gray-50 border-l-4 border-gray-200"
                }`}
              >
                <div className="flex justify-between items-center">
                  <span className="font-medium text-gray-800">{task.name}</span>
                  <span className="text-sm text-gray-600">
                    {task.completedAt
                      ? "✓ Done"
                      : formatDuration(task.remainingSeconds)}
                  </span>
                </div>
                {task.note && (
                  <div className="text-sm text-gray-600 mt-1">
                    Note: {task.note}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Task Customizer Modal */}
        {showTaskCustomizer && (
          <TaskCustomizer
            template={state.template}
            onSave={handleSaveTemplate}
            onCancel={() => setShowTaskCustomizer(false)}
          />
        )}
      </div>
    </div>
  );
}
