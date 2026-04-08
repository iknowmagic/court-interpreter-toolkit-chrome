import { useEffect, useMemo, useRef, useState } from "react";
import * as rpc from "@utils/chromeRPC";
import {
  DEFAULT_TEMPLATE,
  type PracticeSession,
  type PracticeSessionTask,
  type PracticeTemplateTask,
  createFreshSession,
  createTaskId,
  formatDuration,
  formatLosAngelesClock,
  formatLosAngelesTimestamp,
  getLosAngelesDateString,
  reconcileSessionWithTemplate,
} from "@shared/practice";

type ModalState = {
  mode: "add" | "edit";
  taskId?: string;
  name: string;
  duration: string;
};
type NoteSaveStatus = "idle" | "saving" | "saved" | "error";

interface CalendarCell {
  date: Date;
  dateKey: string;
  inMonth: boolean;
}

const WEEK_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

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
} as const;

function findTask(
  tasks: PracticeSessionTask[],
  taskId: string | null,
): PracticeSessionTask | null {
  return taskId
    ? (tasks.find((task) => task.id === taskId) ?? null)
    : (tasks[0] ?? null);
}

function taskIndex(
  tasks: PracticeSessionTask[],
  taskId: string | null,
): number {
  return taskId ? tasks.findIndex((task) => task.id === taskId) : -1;
}

function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateKey(dateKey: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function monthLabel(date: Date): string {
  return new Intl.DateTimeFormat("en-US", { month: "short" }).format(date);
}

function buildCalendarCells(monthDate: Date): CalendarCell[] {
  const firstOfMonth = new Date(
    monthDate.getFullYear(),
    monthDate.getMonth(),
    1,
  );
  const firstVisible = new Date(firstOfMonth);
  firstVisible.setDate(firstVisible.getDate() - firstVisible.getDay());

  const cells: CalendarCell[] = [];
  for (let index = 0; index < 42; index += 1) {
    const cellDate = new Date(firstVisible);
    cellDate.setDate(firstVisible.getDate() + index);
    cells.push({
      date: cellDate,
      dateKey: toDateKey(cellDate),
      inMonth: cellDate.getMonth() === monthDate.getMonth(),
    });
  }

  return cells;
}

export default function CourtInterpreterApp(): React.JSX.Element {
  const [template, setTemplate] =
    useState<PracticeTemplateTask[]>(DEFAULT_TEMPLATE);
  const [session, setSession] = useState<PracticeSession>(
    createFreshSession(DEFAULT_TEMPLATE),
  );
  const [selectedTaskId, setSelectedTaskId] = useState(
    DEFAULT_TEMPLATE[0]?.id ?? "",
  );
  const [modal, setModal] = useState<ModalState | null>(null);
  const [clock, setClock] = useState(() => formatLosAngelesClock());
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), 1);
  });
  const [sessionDates, setSessionDates] = useState<string[]>([]);
  const [completedSessionDates, setCompletedSessionDates] = useState<string[]>(
    [],
  );
  const [running, setRunning] = useState(false);
  const [ready, setReady] = useState(false);
  const [showCalendarPopover, setShowCalendarPopover] = useState(false);
  const [noteSaveStatus, setNoteSaveStatus] = useState<NoteSaveStatus>("idle");
  const [lastNoteSavedAt, setLastNoteSavedAt] = useState<string | null>(null);
  const previousCurrentTaskId = useRef<string | null>(session.currentTaskId);
  const saveTimer = useRef<number | null>(null);
  const noteChangedSinceSaveRef = useRef(false);
  const calendarPopoverRef = useRef<HTMLDivElement | null>(null);
  const latestToolbarStateRef = useRef({ template, session });

  useEffect(() => {
    const id = window.setInterval(
      () => setClock(formatLosAngelesClock()),
      1000,
    );
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const loaded = await rpc.loadState();
        if (!cancelled) {
          setTemplate(loaded.template);
          setSession(loaded.session);
          setCalendarMonth(
            new Date(
              parseDateKey(loaded.session.date).getFullYear(),
              parseDateKey(loaded.session.date).getMonth(),
              1,
            ),
          );
          setSelectedTaskId(
            loaded.session.currentTaskId ??
              loaded.session.tasks[0]?.id ??
              loaded.template[0]?.id ??
              "",
          );
          const dates = await rpc.listSessionDates();
          setSessionDates(dates);
          noteChangedSinceSaveRef.current = false;
          setNoteSaveStatus("idle");
          setLastNoteSavedAt(null);
        }
      } catch (error) {
        console.error("Failed to load practice state", error);
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void (async () => {
        try {
          await rpc.saveState({ template, session });
          setSessionDates((previous) =>
            previous.includes(session.date)
              ? previous
              : [...previous, session.date],
          );
          if (noteChangedSinceSaveRef.current) {
            noteChangedSinceSaveRef.current = false;
            setLastNoteSavedAt(formatLosAngelesClock());
            setNoteSaveStatus("saved");
          }
        } catch (error) {
          console.error("Failed to save practice state", error);
          if (noteChangedSinceSaveRef.current) {
            setNoteSaveStatus("error");
          }
        }
      })();
    }, 350);
    return () => {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    };
  }, [ready, session, template]);

  useEffect(() => {
    latestToolbarStateRef.current = { template, session };
  }, [session, template]);

  useEffect(() => {
    if (!ready) return;
    void rpc
      .updateToolbarStatus({ template, session }, running, {
        timestampMs: Date.now(),
      })
      .catch((error) => {
        console.error("Failed to update toolbar status", error);
      });
  }, [ready, running, session, template]);

  useEffect(() => {
    const stopToolbarRunning = () => {
      if (!ready) return;
      const latestState = latestToolbarStateRef.current;
      void rpc.updateToolbarStatus(
        latestState,
        false,
        { timestampMs: Date.now(), forceStopped: true },
      );
    };
    const handleVisibilityChange = () => {
      if (document.hidden) stopToolbarRunning();
    };

    window.addEventListener("pagehide", stopToolbarRunning);
    window.addEventListener("beforeunload", stopToolbarRunning);
    window.addEventListener("unload", stopToolbarRunning);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", stopToolbarRunning);
      window.removeEventListener("beforeunload", stopToolbarRunning);
      window.removeEventListener("unload", stopToolbarRunning);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      stopToolbarRunning();
    };
  }, [ready]);

  useEffect(() => {
    let cancelled = false;
    if (sessionDates.length === 0) {
      setCompletedSessionDates([]);
      return () => {
        cancelled = true;
      };
    }

    void (async () => {
      try {
        const completionKeys = await Promise.all(
          sessionDates.map(async (dateKey) => {
            const loaded = await rpc.loadStateByDate(dateKey);
            const completed =
              loaded.session.done ||
              loaded.session.tasks.every((task) => task.completedAt !== null);
            return completed ? dateKey : null;
          }),
        );
        if (!cancelled) {
          setCompletedSessionDates(
            completionKeys.filter((dateKey): dateKey is string => !!dateKey),
          );
        }
      } catch (error) {
        console.error("Failed to load session completion states", error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionDates]);

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
    if (session.done) setRunning(false);
  }, [session.done]);

  useEffect(() => {
    if (!showCalendarPopover) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        calendarPopoverRef.current &&
        !calendarPopoverRef.current.contains(target)
      ) {
        setShowCalendarPopover(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowCalendarPopover(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [showCalendarPopover]);

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      setSession((previous) => {
        if (previous.done || previous.tasks.length === 0) return previous;
        const active = findTask(previous.tasks, previous.currentTaskId);
        if (!active) return previous;
        const index = taskIndex(previous.tasks, active.id);
        if (index < 0) return previous;
        const tasks = previous.tasks.map((task) =>
          task.id === active.id
            ? {
                ...task,
                remainingSeconds: Math.max(0, task.remainingSeconds - 1),
              }
            : task,
        );
        if ((tasks[index]?.remainingSeconds ?? 1) > 0)
          return { ...previous, tasks };
        const completedAt = active.completedAt ?? formatLosAngelesTimestamp();
        const completedTasks = tasks.map((task) =>
          task.id === active.id
            ? { ...task, remainingSeconds: 0, completedAt }
            : task,
        );
        const nextIncomplete =
          completedTasks
            .slice(index + 1)
            .find((task) => task.completedAt === null) ??
          completedTasks.find((task) => task.completedAt === null) ??
          null;
        const done = nextIncomplete === null;
        return {
          ...previous,
          tasks: completedTasks,
          currentTaskId: done
            ? (completedTasks[completedTasks.length - 1]?.id ?? active.id)
            : nextIncomplete.id,
          done,
        };
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [running]);

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

    // Keep countdown frozen on stop; only show full duration for completed tasks.
    if (remainingSeconds === 0 || active.completedAt) return totalSeconds;
    return remainingSeconds;
  }, [active]);
  const todayDateKey = getLosAngelesDateString();
  const isViewingToday = session.date === todayDateKey;
  const sessionDateSet = useMemo(() => new Set(sessionDates), [sessionDates]);
  const completedSessionDateSet = useMemo(() => {
    const keys = new Set(completedSessionDates);
    if (session.done) keys.add(session.date);
    return keys;
  }, [completedSessionDates, session.date, session.done]);
  const calendarCells = useMemo(
    () => buildCalendarCells(calendarMonth),
    [calendarMonth],
  );

  const syncTemplate = (nextTemplate: PracticeTemplateTask[]) => {
    setTemplate(nextTemplate);
    setSession((previous) =>
      reconcileSessionWithTemplate(nextTemplate, previous),
    );
    setSelectedTaskId((current) =>
      nextTemplate.some((task) => task.id === current)
        ? current
        : (nextTemplate[0]?.id ?? ""),
    );
  };

  const resetNoteSaveIndicator = () => {
    noteChangedSinceSaveRef.current = false;
    setNoteSaveStatus("idle");
    setLastNoteSavedAt(null);
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
  };

  const selectTask = (taskId: string) => {
    setSelectedTaskId(taskId);
    setRunning(false);
    setSession((previous) => {
      const selectedTask = previous.tasks.find((task) => task.id === taskId);
      if (!selectedTask) {
        return previous;
      }

      const hasPendingTasks = previous.tasks.some(
        (task) => task.completedAt === null,
      );
      return {
        ...previous,
        currentTaskId: taskId,
        done: hasPendingTasks ? false : previous.done,
      };
    });
  };

  const addTask = () => setModal({ mode: "add", name: "", duration: "5" });
  const editTask = () =>
    selected &&
    setModal({
      mode: "edit",
      taskId: selected.id,
      name: selected.name,
      duration: String(selected.duration),
    });
  const deleteTask = () => {
    if (!selected || template.length <= 1) return;
    if (!window.confirm(`Delete "${selected.name}" from the template?`)) return;
    syncTemplate(template.filter((task) => task.id !== selected.id));
  };
  const moveTask = (direction: -1 | 1) => {
    if (!selected) return;
    const index = template.findIndex((task) => task.id === selected.id);
    const target = index + direction;
    if (target < 0 || target >= template.length) return;
    const next = [...template];
    [next[index], next[target]] = [next[target], next[index]];
    syncTemplate(next);
  };

  const confirmModal = () => {
    if (!modal) return;
    const name = modal.name.trim() || "Task";
    const duration = Math.max(1, Number.parseInt(modal.duration, 10) || 5);
    if (modal.mode === "add") {
      const task = { id: createTaskId("practice-task"), name, duration };
      syncTemplate([...template, task]);
      setSelectedTaskId(task.id);
    } else {
      syncTemplate(
        template.map((task) =>
          task.id === modal.taskId ? { ...task, name, duration } : task,
        ),
      );
    }
    setModal(null);
  };

  const play = () => !session.done && active && setRunning(true);
  const stop = () => setRunning(false);
  const resetCurrent = () =>
    active &&
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
  const completeAndNext = () => {
    if (!active) return;
    setSession((previous) => {
      const index = taskIndex(previous.tasks, active.id);
      if (index < 0) return previous;
      const completedAt =
        previous.tasks[index]?.completedAt ?? formatLosAngelesTimestamp();
      const tasks = previous.tasks.map((task, taskIndexValue) =>
        taskIndexValue === index
          ? { ...task, remainingSeconds: 0, completedAt }
          : task,
      );

      const nextIncomplete =
        tasks.slice(index + 1).find((task) => task.completedAt === null) ??
        tasks.find((task) => task.completedAt === null) ??
        null;
      if (!nextIncomplete) {
        return {
          ...previous,
          tasks,
          currentTaskId: tasks[tasks.length - 1]?.id ?? previous.currentTaskId,
          done: true,
        };
      }

      return {
        ...previous,
        tasks,
        currentTaskId: nextIncomplete.id,
        done: false,
      };
    });
  };

  const resetDefaults = async () => {
    if (!window.confirm("Reset task template and today session to defaults?"))
      return;
    setRunning(false);
    const next = await rpc.resetToDefaults();
    setTemplate(next.template);
    setSession(next.session);
    setCalendarMonth(
      new Date(
        parseDateKey(next.session.date).getFullYear(),
        parseDateKey(next.session.date).getMonth(),
        1,
      ),
    );
    setSessionDates((previous) =>
      previous.includes(next.session.date)
        ? previous
        : [...previous, next.session.date],
    );
    setSelectedTaskId(next.session.currentTaskId ?? next.template[0]?.id ?? "");
    resetNoteSaveIndicator();
  };

  const loadDate = async (dateKey: string) => {
    setRunning(false);
    const next = await rpc.loadStateByDate(dateKey);
    setTemplate(next.template);
    setSession(next.session);
    setSelectedTaskId(
      next.session.currentTaskId ?? next.session.tasks[0]?.id ?? "",
    );
    setCalendarMonth(
      new Date(
        parseDateKey(dateKey).getFullYear(),
        parseDateKey(dateKey).getMonth(),
        1,
      ),
    );
    setShowCalendarPopover(false);
    resetNoteSaveIndicator();
  };

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
  const sessionDateHeaderLabel = useMemo(
    () =>
      new Intl.DateTimeFormat("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      }).format(parseDateKey(session.date)),
    [session.date],
  );

  const toggleCalendarPopover = () => {
    setShowCalendarPopover((current) => !current);
  };

  const moveCalendarMonth = (direction: -1 | 1) => {
    setCalendarMonth(
      (previous) =>
        new Date(previous.getFullYear(), previous.getMonth() + direction, 1),
    );
  };

  if (!ready)
    return (
      <div className="practice-loading">
        Court Interpreter
        <br />
        Loading practice session...
      </div>
    );

  return (
    <div className="practice-app practice-app--popup">
      <style>{`
        .practice-app{min-height:100%;display:flex;flex-direction:column;background:${C.bg};color:${C.text}}
        .practice-shell{width:min(1120px,calc(100% - 24px));margin:0 auto;display:flex;flex-direction:column;flex:1}
        .practice-layout{display:grid;grid-template-columns:300px minmax(0,760px);grid-template-areas:'left right' 'left notes' 'calendar .';align-items:stretch;justify-content:center;gap:14px;padding:14px;flex:1;min-height:0}
        .practice-task-list{flex:1;overflow:auto}
        .practice-side,.practice-main{min-width:0}
        .practice-side{display:flex;flex-direction:column;gap:10px;min-height:0}
        .practice-side .practice-list-card{flex:1;min-height:0}
        .practice-task:hover{background:#faf5ee!important}
        .practice-btn:hover:not(:disabled){background:${C.accentBg}!important;border-color:${C.accent}!important;color:${C.accent}!important}
        .practice-btn-strong{background:${C.accent}!important;border-color:${C.accent}!important;color:#fff!important}
        .practice-btn-strong:hover:not(:disabled){background:${C.accentDk}!important;border-color:${C.accentDk}!important;color:#fff!important}
        .practice-btn-danger{background:#8f2f1f!important;border-color:#8f2f1f!important;color:#fff!important}
        .practice-btn-danger:hover:not(:disabled){background:#76271a!important;border-color:#76271a!important;color:#fff!important}
        .practice-current-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px}
        .practice-input:focus,.practice-textarea:focus{border-color:${C.accent}!important;outline:none}
        .practice-calendar-popover-wrap{position:relative}
        .practice-calendar-popover{position:absolute;left:0;top:calc(100% + 8px);z-index:250;width:min(320px,calc(100vw - 20px));background:${C.surface};border:1px solid ${C.border};border-radius:12px;box-shadow:0 18px 42px rgba(26,23,20,0.22);padding:10px}
        .practice-popover-title{font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:${C.muted};margin-bottom:8px}
        .practice-calendar-popover .practice-calendar{margin-top:0}
        .practice-calendar-day-inner{position:relative;display:inline-flex;align-items:center;justify-content:center;width:100%}
        .practice-calendar-check{position:absolute;top:-4px;right:2px;font-size:9px;line-height:1;color:${C.done};opacity:0}
        .practice-calendar-day.is-complete .practice-calendar-check{opacity:1}
        .practice-calendar-day:disabled{opacity:.45;cursor:default}
        .practice-history-badge{font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:${C.muted}}
        .practice-loading{min-height:100%;display:grid;place-items:center;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:${C.bg};color:${C.text};text-align:center}
        .practice-app--popup .practice-shell{width:min(620px,100%);padding:0}
        .practice-app--popup .practice-layout{grid-template-columns:240px minmax(0,1fr);grid-template-rows:auto minmax(0,1fr);grid-template-areas:'left right' 'left notes';gap:8px;padding:8px}
        .practice-app--popup .practice-header{padding:10px 16px 8px;gap:12px}
        .practice-app--popup .practice-title{font-size:22px}
        .practice-app--popup .practice-subtitle{font-size:9px;letter-spacing:0.16em}
        .practice-app--popup .practice-date,.practice-app--popup .practice-summary{font-size:11px}
        .practice-app--popup .practice-clock{font-size:14px}
        .practice-app--popup .practice-side{gap:8px;height:100%}
        .practice-app--popup .practice-main{gap:10px}
        .practice-app--popup .practice-main.practice-main-notes{justify-content:flex-end;min-height:0}
        .practice-app--popup .practice-side .practice-list-card{flex:1 1 auto;min-height:0}
        .practice-app--popup .practice-task-list{max-height:none;min-height:0}
        .practice-app--popup .practice-list-head{padding:8px 10px;font-size:9px}
        .practice-app--popup .practice-task{padding:8px 10px}
        .practice-app--popup .practice-task-name{font-size:11px}
        .practice-app--popup .practice-btn{padding:7px 8px;font-size:11px}
        .practice-app--popup .practice-timer-card,.practice-app--popup .practice-notes-card{padding:14px 16px}
        .practice-app--popup .practice-current{font-size:20px;margin-bottom:10px}
        .practice-app--popup .practice-timer{font-size:56px;margin-bottom:2px}
        .practice-app--popup .practice-status{margin-bottom:10px}
        .practice-app--popup .practice-actions{margin-bottom:8px}
        .practice-app--popup .practice-meta{gap:12px;padding:8px 10px;font-size:10px}
        .practice-app--popup .practice-note-title{font-size:12px;margin-bottom:6px}
        .practice-app--popup .practice-textarea{min-height:64px;padding:8px 10px;margin-bottom:8px}
        .practice-app--popup .practice-calendar-popover{width:min(280px,calc(100vw - 20px))}
        @media (max-width:745px){.practice-main .practice-grid2.practice-actions{grid-template-columns:repeat(2,minmax(0,1fr))}}
        @media (max-width:650px){.practice-layout{grid-template-columns:1fr;grid-template-areas:'right' 'left' 'notes'}.practice-task-list{max-height:none}}
      `}</style>

      <div className="practice-shell">
        <header className="practice-header">
          <div>
            <div className="practice-title">COURT INTERPRETER</div>
            <div className="practice-subtitle">Daily Practice Session</div>
            <div className="practice-date">{sessionDateHeaderLabel}</div>
          </div>
          <div className="practice-clock-wrap">
            <div className="practice-clock">{clock}</div>
            <div className="practice-summary">
              {doneCount}/{template.length} | {remainingMinutes}m
            </div>
          </div>
        </header>

        <div className="practice-progress">
          <div
            style={{ width: `${Math.max(0, Math.min(100, progress * 100))}%` }}
          />
        </div>

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
                  const isActive =
                    task.id === session.currentTaskId && !session.done;
                  const isSelected = task.id === selected?.id;
                  const isDone = task.completedAt !== null;
                  return (
                    <button
                      key={task.id}
                      type="button"
                      className="practice-task"
                      onClick={() => selectTask(task.id)}
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
                      <span className="practice-task-num">
                        {isDone ? "✓" : index + 1}
                      </span>
                      <span className="practice-task-name">{task.name}</span>
                      <span className="practice-task-time">{`${task.duration}m`}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="practice-grid2">
              <button
                type="button"
                className="practice-btn"
                onClick={addTask}
                disabled={!isViewingToday}
              >
                + Add Task
              </button>
              <button
                type="button"
                className="practice-btn"
                onClick={editTask}
                disabled={!isViewingToday || !selected}
              >
                Edit Task
              </button>
            </div>
            <div className="practice-grid2">
              <button
                type="button"
                className="practice-btn"
                onClick={() => moveTask(-1)}
                disabled={!isViewingToday || selectedTemplateIndex <= 0}
              >
                ↑ Move Up
              </button>
              <button
                type="button"
                className="practice-btn"
                onClick={() => moveTask(1)}
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
                onClick={deleteTask}
                disabled={!isViewingToday || !selected || template.length <= 1}
              >
                Delete Task
              </button>
              <button
                type="button"
                className="practice-btn practice-btn-danger"
                onClick={() => void resetDefaults()}
                disabled={!isViewingToday}
              >
                Reset List
              </button>
            </div>
            <div
              className="practice-calendar-popover-wrap"
              ref={calendarPopoverRef}
            >
              <button
                type="button"
                className="practice-btn"
                style={{ width: "100%" }}
                aria-expanded={showCalendarPopover}
                aria-label="Open calendar"
                onClick={toggleCalendarPopover}
              >
                Open Calendar
              </button>
              {showCalendarPopover ? (
                <div
                  className="practice-calendar-popover"
                  role="dialog"
                  aria-label="Session calendar"
                >
                  <div className="practice-popover-title">Session Calendar</div>
                  <div className="practice-calendar">
                    <div className="practice-calendar-head">
                      <button
                        type="button"
                        className="practice-calendar-nav"
                        aria-label="Previous month"
                        onClick={() => moveCalendarMonth(-1)}
                      >
                        ‹
                      </button>
                      <div className="practice-calendar-title">
                        <span>{monthLabel(calendarMonth)}</span>
                        <span>{calendarMonth.getFullYear()}</span>
                      </div>
                      <button
                        type="button"
                        className="practice-calendar-nav"
                        aria-label="Next month"
                        onClick={() => moveCalendarMonth(1)}
                      >
                        ›
                      </button>
                    </div>

                    <div className="practice-calendar-grid practice-calendar-weekdays">
                      {WEEK_LABELS.map((label) => (
                        <span key={label}>{label}</span>
                      ))}
                    </div>

                    <div className="practice-calendar-grid">
                      {calendarCells.map((cell) => {
                        const isSelectedDate = cell.dateKey === session.date;
                        const hasData = sessionDateSet.has(cell.dateKey);
                        const isCompleteDay = completedSessionDateSet.has(
                          cell.dateKey,
                        );
                        const isSelectable =
                          hasData || cell.dateKey === todayDateKey;
                        return (
                          <button
                            key={cell.dateKey}
                            type="button"
                            className={`practice-calendar-day${isSelectedDate ? " is-selected" : ""}${cell.inMonth ? "" : " is-outside"}${isCompleteDay ? " is-complete" : ""}`}
                            disabled={!isSelectable}
                            onClick={() => void loadDate(cell.dateKey)}
                          >
                            <span className="practice-calendar-day-inner">
                              {cell.date.getDate()}
                              <span
                                className="practice-calendar-check"
                                aria-hidden="true"
                              >
                                ✓
                              </span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </section>

          <section className="practice-main" style={{ gridArea: "right" }}>
            <div className="practice-card practice-timer-card">
              <div className="practice-current-head">
                <div className="practice-eyebrow">Current Task</div>
                {!isViewingToday ? (
                  <span className="practice-history-badge">{`Viewing ${viewingDateLabel}`}</span>
                ) : selected?.completedAt ? (
                  <span className="practice-completed">
                    Completed {selected.completedAt}
                  </span>
                ) : null}
              </div>
              <div className="practice-current">
                {session.done ? "Session Complete" : (active?.name ?? "—")}
              </div>
              <div className="practice-timer">
                {formatDuration(timerDisplaySeconds)}
              </div>
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
                  onClick={play}
                  disabled={
                    !isViewingToday || running || session.done || !active
                  }
                >
                  ▶ Play
                </button>
                <button
                  type="button"
                  className="practice-btn"
                  onClick={stop}
                  disabled={!isViewingToday || !running}
                >
                  ■ Stop
                </button>
              </div>
              <div className="practice-grid2 practice-actions">
                <button
                  type="button"
                  className="practice-btn"
                  onClick={resetCurrent}
                  disabled={!isViewingToday || !active || session.done}
                >
                  ↺ Reset Task
                </button>
                <button
                  type="button"
                  className="practice-btn practice-btn-strong"
                  onClick={completeAndNext}
                  disabled={
                    !isViewingToday ||
                    !active ||
                    session.done ||
                    active.completedAt !== null
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
                      ? `${activeIndex + 1} of ${session.tasks.length}`
                      : "—"}
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

          <section
            className="practice-main practice-main-notes"
            style={{ gridArea: "notes" }}
          >
            <div className="practice-card practice-notes-card">
              <div className="practice-eyebrow">Task Notes</div>
              <div className="practice-note-title">
                {selectedIndex >= 0
                  ? `${selectedIndex + 1}. ${selected?.name ?? "—"}`
                  : "Select a task"}
              </div>
              <textarea
                className="practice-textarea"
                value={selected?.note ?? ""}
                onChange={(event) =>
                  selected && updateNote(selected.id, event.target.value)
                }
                placeholder="What did you practice?"
                disabled={!selected || !isViewingToday}
              />
            </div>
          </section>
        </main>
      </div>

      {modal ? (
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
                value={modal.name}
                onChange={(event) =>
                  setModal((current) =>
                    current
                      ? { ...current, name: event.target.value }
                      : current,
                  )
                }
              />
            </label>
            <label className="practice-label">
              Duration (minutes)
              <input
                className="practice-input"
                type="number"
                min={1}
                max={120}
                value={modal.duration}
                onChange={(event) =>
                  setModal((current) =>
                    current
                      ? { ...current, duration: event.target.value }
                      : current,
                  )
                }
                onKeyDown={(event) => event.key === "Enter" && confirmModal()}
              />
            </label>
            <div className="practice-grid2">
              <button
                type="button"
                className="practice-btn practice-btn-strong"
                onClick={confirmModal}
              >
                {modal.mode === "add" ? "Add Task" : "Save Changes"}
              </button>
              <button
                type="button"
                className="practice-btn"
                onClick={() => setModal(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
