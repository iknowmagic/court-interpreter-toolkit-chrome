import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as rpc from "@utils/chromeRPC";
import {
  DEFAULT_TEMPLATE,
  type PracticeSession,
  type PracticeSessionSummary,
  type PracticeSessionTask,
  type PracticeState,
  type PracticeTemplateTask,
  createFreshSession,
  createTaskId,
  formatLosAngelesClock,
  getLosAngelesDateString,
  reconcileSessionWithTemplate,
} from "@shared/practice";
import { describeError, findTask, taskIndex } from "./sessionPopupUtils";

export type LoadStatus = "loading" | "ready" | "error";
export type NoteSaveStatus = "idle" | "saving" | "saved" | "error";

export type ModalState = {
  mode: "add" | "edit";
  taskId?: string;
  initialName: string;
  initialDuration: string;
};

const AUTOSAVE_DEBOUNCE_MS = 350;

export function usePracticeSession() {
  const [loadStatus, setLoadStatus] = useState<LoadStatus>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadTick, setLoadTick] = useState(0);

  const [operationError, setOperationError] = useState<string | null>(null);

  const [template, setTemplate] =
    useState<PracticeTemplateTask[]>(DEFAULT_TEMPLATE);
  const [session, setSession] = useState<PracticeSession>(
    createFreshSession(DEFAULT_TEMPLATE),
  );
  const [selectedTaskId, setSelectedTaskId] = useState(
    DEFAULT_TEMPLATE[0]?.id ?? "",
  );
  const [running, setRunning] = useState(false);
  const [clock, setClock] = useState(() => formatLosAngelesClock());
  const [sessionSummaries, setSessionSummaries] = useState<
    PracticeSessionSummary[]
  >([]);
  const [modal, setModal] = useState<ModalState | null>(null);
  const [noteSaveStatus, setNoteSaveStatus] = useState<NoteSaveStatus>("idle");
  const [lastNoteSavedAt, setLastNoteSavedAt] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const dirtyRef = useRef(false);
  const noteChangedSinceSaveRef = useRef(false);
  const saveTimerRef = useRef<number | null>(null);
  const loadRequestIdRef = useRef(0);
  const dateRequestIdRef = useRef(0);
  const pollingRequestIdRef = useRef(0);
  const previousCurrentTaskId = useRef<string | null>(session.currentTaskId);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const todayDateKey = getLosAngelesDateString();
  const isViewingToday = session.date === todayDateKey;

  const resetNoteSaveIndicator = () => {
    noteChangedSinceSaveRef.current = false;
    setNoteSaveStatus("idle");
    setLastNoteSavedAt(null);
  };

  const applyAuthoritativeState = (next: PracticeState) => {
    setTemplate(next.template);
    setSession(next.session);
    setSelectedTaskId(
      next.session.currentTaskId ??
        next.session.tasks[0]?.id ??
        next.template[0]?.id ??
        "",
    );
    dirtyRef.current = false;
    resetNoteSaveIndicator();
  };

  const refreshSummaries = async () => {
    try {
      const summaries = await rpc.listSessionSummaries();
      if (!mountedRef.current) return;
      setSessionSummaries(summaries);
    } catch (error) {
      if (!mountedRef.current) return;
      setOperationError(describeError(error, "Failed to refresh the calendar."));
    }
  };

  // Clock, purely presentational.
  useEffect(() => {
    const id = window.setInterval(
      () => setClock(formatLosAngelesClock()),
      1000,
    );
    return () => window.clearInterval(id);
  }, []);

  // Initial load (and retry). Failure renders an explicit error state instead
  // of a silently-editable default session.
  useEffect(() => {
    const requestId = ++loadRequestIdRef.current;
    setLoadStatus("loading");
    setLoadError(null);

    void (async () => {
      try {
        const loaded = await rpc.loadState();
        const [summaries, runningState] = await Promise.all([
          rpc.listSessionSummaries(),
          rpc.getRunningState(),
        ]);
        if (!mountedRef.current || loadRequestIdRef.current !== requestId) return;
        applyAuthoritativeState(loaded);
        setSessionSummaries(summaries);
        setRunning(runningState.isRunning);
        setLoadStatus("ready");
      } catch (error) {
        if (!mountedRef.current || loadRequestIdRef.current !== requestId) return;
        setLoadError(
          describeError(error, "Failed to load the practice session."),
        );
        setLoadStatus("error");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadTick]);

  const retryLoad = () => setLoadTick((tick) => tick + 1);

  const invalidatePolling = useCallback(() => {
    pollingRequestIdRef.current += 1;
  }, []);

  // Autosave: only for today's live, non-running, user-dirty state.
  useEffect(() => {
    if (loadStatus !== "ready") return;
    if (!isViewingToday) return;
    if (running) return;
    if (!dirtyRef.current) return;

    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      void (async () => {
        try {
          await rpc.saveState({ template, session });
          dirtyRef.current = false;
          if (noteChangedSinceSaveRef.current) {
            noteChangedSinceSaveRef.current = false;
            setLastNoteSavedAt(formatLosAngelesClock());
            setNoteSaveStatus("saved");
          }
          void refreshSummaries();
        } catch (error) {
          setOperationError(describeError(error, "Failed to save changes."));
          if (noteChangedSinceSaveRef.current) {
            setNoteSaveStatus("error");
          }
        }
      })();
    }, AUTOSAVE_DEBOUNCE_MS);

    return () => {
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    };
  }, [loadStatus, isViewingToday, running, session, template]);

  // Authoritative running-state polling. Never applies a partial update on
  // failure; the last known-good state is preserved and an error is shown.
  useEffect(() => {
    if (loadStatus !== "ready" || !running) return;
    let lastStartedRequestId = pollingRequestIdRef.current;
    const intervalId = window.setInterval(() => {
      void (async () => {
        if (pollingRequestIdRef.current !== lastStartedRequestId) return;
        const requestId = ++pollingRequestIdRef.current;
        lastStartedRequestId = requestId;
        try {
          const [nextState, runningState] = await Promise.all([
            rpc.getSessionState(),
            rpc.getRunningState(),
          ]);
          if (!mountedRef.current || pollingRequestIdRef.current !== requestId) return;
          if (!nextState) return;
          if (!runningState.isRunning) invalidatePolling();
          setTemplate(nextState.template);
          setSession(nextState.session);
          setRunning(runningState.isRunning);
        } catch (error) {
          if (!mountedRef.current || pollingRequestIdRef.current !== requestId) return;
          setOperationError(
            describeError(error, "Failed to sync the running session."),
          );
        }
      })();
    }, 1000);
    return () => {
      invalidatePolling();
      window.clearInterval(intervalId);
    };
  }, [invalidatePolling, loadStatus, running]);

  useEffect(() => {
    const previous = previousCurrentTaskId.current;
    previousCurrentTaskId.current = session.currentTaskId;
    setSelectedTaskId((current) => {
      if (!session.tasks.some((task) => task.id === current))
        return session.currentTaskId ?? session.tasks[0]?.id ?? "";
      return current === previous
        ? (session.currentTaskId ?? current)
        : current;
    });
  }, [session.currentTaskId, session.tasks]);

  useEffect(() => {
    if (!session.done) return;
    invalidatePolling();
    setRunning(false);
  }, [invalidatePolling, session.done]);

  useEffect(() => {
    if (!isViewingToday && modal) setModal(null);
  }, [isViewingToday, modal]);

  const active = useMemo(
    () => findTask(session.tasks, session.currentTaskId),
    [session],
  );
  const selected = useMemo(
    () =>
      session.tasks.find((task) => task.id === selectedTaskId) ??
      active ??
      session.tasks[0] ??
      null,
    [active, selectedTaskId, session.tasks],
  );
  const activeIndex = taskIndex(session.tasks, session.currentTaskId);
  const selectedIndex = taskIndex(session.tasks, selected?.id ?? null);
  const selectedTemplateIndex = selected
    ? template.findIndex((task) => task.id === selected.id)
    : -1;
  const doneCount = session.tasks.filter(
    (task) => task.completedAt !== null,
  ).length;
  const totalMinutes = template.reduce((sum, task) => sum + task.duration, 0);
  const remainingMinutes = Math.ceil(
    session.tasks.reduce((sum, task) => sum + task.remainingSeconds, 0) / 60,
  );
  const progress = template.length > 0 ? doneCount / template.length : 0;
  const timerDisplaySeconds = useMemo(() => {
    if (!active) return 0;
    const totalSeconds = Math.max(0, active.duration * 60);
    const remainingSeconds = Math.max(0, active.remainingSeconds);
    if (remainingSeconds === 0 || active.completedAt) return totalSeconds;
    return remainingSeconds;
  }, [active]);

  const dismissOperationError = () => setOperationError(null);

  /**
   * Blocking pause-before-mutation contract: requires a non-null returned
   * state, applies it as authoritative, and throws on any failure so
   * callers never mutate local state after a failed pause.
   */
  const pauseForMutation = async (): Promise<PracticeState> => {
    const paused = await rpc.pauseSession();
    if (!paused) {
      throw new Error("Failed to pause the timer before this action.");
    }
    invalidatePolling();
    setTemplate(paused.template);
    setSession(paused.session);
    setRunning(false);
    dirtyRef.current = false;
    return paused;
  };

  const applyTemplateChange = (nextTemplate: PracticeTemplateTask[]) => {
    setTemplate(nextTemplate);
    setSession((previous) =>
      reconcileSessionWithTemplate(nextTemplate, previous),
    );
    setSelectedTaskId((current) =>
      nextTemplate.some((task) => task.id === current)
        ? current
        : (nextTemplate[0]?.id ?? ""),
    );
    dirtyRef.current = true;
  };

  const selectTask = async (taskId: string) => {
    try {
      await pauseForMutation();
    } catch (error) {
      setOperationError(
        describeError(error, "Failed to pause before selecting that task."),
      );
      return;
    }
    setSelectedTaskId(taskId);
    setSession((previous) => {
      const selectedTask = previous.tasks.find((task) => task.id === taskId);
      if (!selectedTask) return previous;
      const hasPendingTasks = previous.tasks.some(
        (task) => task.completedAt === null,
      );
      return {
        ...previous,
        currentTaskId: taskId,
        done: hasPendingTasks ? false : previous.done,
      };
    });
    dirtyRef.current = true;
  };

  const updateNote = (taskId: string, note: string) => {
    const currentNote =
      session.tasks.find((task) => task.id === taskId)?.note ?? "";
    if (note === currentNote) return;
    noteChangedSinceSaveRef.current = true;
    setNoteSaveStatus("saving");
    setSession((previous) => ({
      ...previous,
      tasks: previous.tasks.map((task) =>
        task.id === taskId ? { ...task, note } : task,
      ),
    }));
    dirtyRef.current = true;
  };

  const openAddModal = () => {
    if (!isViewingToday) return;
    setModal({ mode: "add", initialName: "", initialDuration: "5" });
  };

  const openEditModal = () => {
    if (!selected || !isViewingToday) return;
    setModal({
      mode: "edit",
      taskId: selected.id,
      initialName: selected.name,
      initialDuration: String(selected.duration),
    });
  };

  const closeModal = () => setModal(null);

  const confirmModal = async (name: string, durationRaw: string) => {
    if (!modal) return;
    try {
      await pauseForMutation();
    } catch (error) {
      setOperationError(
        describeError(error, "Failed to pause before saving the task."),
      );
      return;
    }
    const trimmedName = name.trim() || "Task";
    const duration = Math.max(1, Number.parseInt(durationRaw, 10) || 5);
    if (modal.mode === "add") {
      const task = {
        id: createTaskId("practice-task"),
        name: trimmedName,
        duration,
      };
      applyTemplateChange([...template, task]);
      setSelectedTaskId(task.id);
    } else {
      applyTemplateChange(
        template.map((task) =>
          task.id === modal.taskId
            ? { ...task, name: trimmedName, duration }
            : task,
        ),
      );
    }
    setModal(null);
  };

  const deleteTask = async () => {
    if (!selected || template.length <= 1) return;
    if (!window.confirm(`Delete "${selected.name}" from the template?`)) return;
    try {
      await pauseForMutation();
    } catch (error) {
      setOperationError(
        describeError(error, "Failed to pause before deleting the task."),
      );
      return;
    }
    applyTemplateChange(template.filter((task) => task.id !== selected.id));
  };

  const moveTask = async (direction: -1 | 1) => {
    if (!selected) return;
    const index = template.findIndex((task) => task.id === selected.id);
    const target = index + direction;
    if (target < 0 || target >= template.length) return;
    try {
      await pauseForMutation();
    } catch (error) {
      setOperationError(
        describeError(error, "Failed to pause before moving the task."),
      );
      return;
    }
    const next = [...template];
    [next[index], next[target]] = [next[target], next[index]];
    applyTemplateChange(next);
  };

  const resetCurrent = () => {
    if (!active) return;
    setSession((previous) => ({
      ...previous,
      done: false,
      currentTaskId: active.id,
      tasks: previous.tasks.map((task) =>
        task.id === active.id
          ? { ...task, remainingSeconds: task.duration * 60, completedAt: null }
          : task,
      ),
    }));
    dirtyRef.current = true;
  };

  const play = async () => {
    if (!isViewingToday || !active) return;
    try {
      const saved = await rpc.saveState({ template, session });
      setTemplate(saved.template);
      setSession(saved.session);
      const next = await rpc.startSession();
      if (next) {
        setTemplate(next.template);
        setSession(next.session);
      }
      setRunning(true);
      dirtyRef.current = false;
    } catch (error) {
      setOperationError(describeError(error, "Failed to start the session."));
    }
  };

  const stop = async () => {
    try {
      const next = await rpc.pauseSession();
      invalidatePolling();
      if (next) {
        setTemplate(next.template);
        setSession(next.session);
      }
      setRunning(false);
      dirtyRef.current = false;
    } catch (error) {
      setOperationError(describeError(error, "Failed to stop the session."));
    }
  };

  const completeAndNext = async () => {
    if (!active || !isViewingToday) return;
    try {
      const saved = await rpc.saveState({ template, session });
      setTemplate(saved.template);
      setSession(saved.session);
      const next = await rpc.completeCurrentTaskAndAdvance();
      invalidatePolling();
      if (next) {
        setTemplate(next.template);
        setSession(next.session);
      }
      setRunning(false);
      dirtyRef.current = false;
      void refreshSummaries();
    } catch (error) {
      setOperationError(
        describeError(error, "Failed to complete the current task."),
      );
    }
  };

  const resetDefaults = async () => {
    if (
      !window.confirm(
        "Are you sure you want to reset the list? All progress data across all days will be deleted. This action cannot be undone.",
      )
    )
      return;
    try {
      await pauseForMutation();
    } catch (error) {
      setOperationError(
        describeError(error, "Failed to pause before resetting the list."),
      );
      return;
    }
    try {
      const next = await rpc.resetToDefaults();
      applyAuthoritativeState(next);
      await refreshSummaries();
    } catch (error) {
      setOperationError(describeError(error, "Failed to reset the list."));
    }
  };

  /** Returns true on success so callers (the calendar popover) can decide to close. */
  const loadDate = async (dateKey: string): Promise<boolean> => {
    const requestId = ++dateRequestIdRef.current;
    try {
      await pauseForMutation();
    } catch (error) {
      if (dateRequestIdRef.current === requestId) {
        setOperationError(
          describeError(error, "Failed to pause before changing date."),
        );
      }
      return false;
    }

    try {
      const next =
        dateKey === todayDateKey
          ? await rpc.getSessionState()
          : await rpc.readStateByDate(dateKey);
      if (dateRequestIdRef.current !== requestId) return false;
      if (!next) throw new Error("No session state was returned for that date.");
      applyAuthoritativeState(next);
      return true;
    } catch (error) {
      if (dateRequestIdRef.current !== requestId) return false;
      setOperationError(describeError(error, "Failed to load that date."));
      return false;
    }
  };

  const goToToday = () => loadDate(todayDateKey);

  const selectedTask: PracticeSessionTask | null = selected;

  return {
    loadStatus,
    loadError,
    retryLoad,

    operationError,
    dismissOperationError,

    template,
    session,
    selectedTaskId,
    selected: selectedTask,
    active,
    running,
    clock,
    todayDateKey,
    isViewingToday,
    sessionSummaries,

    activeIndex,
    selectedIndex,
    selectedTemplateIndex,
    doneCount,
    totalMinutes,
    remainingMinutes,
    progress,
    timerDisplaySeconds,

    noteSaveStatus,
    lastNoteSavedAt,

    modal,
    openAddModal,
    openEditModal,
    closeModal,
    confirmModal,

    selectTask,
    updateNote,
    deleteTask,
    moveTask,
    resetCurrent,
    play,
    stop,
    completeAndNext,
    resetDefaults,
    loadDate,
    goToToday,
  };
}

export type UsePracticeSessionResult = ReturnType<typeof usePracticeSession>;
