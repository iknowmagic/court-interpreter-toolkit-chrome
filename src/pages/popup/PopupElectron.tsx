import { useEffect, useMemo, useRef, useState } from 'react'
import * as rpc from '@utils/chromeRPC'
import {
  DEFAULT_TEMPLATE,
  type PracticeSession,
  type PracticeSessionTask,
  type PracticeTemplateTask,
  createFreshSession,
  createTaskId,
  formatDuration,
  formatLosAngelesClock,
  formatLosAngelesDateLabel,
  formatLosAngelesTimestamp,
  reconcileSessionWithTemplate
} from '@shared/practice'

type ModalState = { mode: 'add' | 'edit'; taskId?: string; name: string; duration: string }

interface CalendarCell {
  date: Date
  dateKey: string
  inMonth: boolean
}

const WEEK_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

const C = {
  bg: '#ede8de',
  surface: '#fdfaf5',
  border: '#d4ccbf',
  text: '#1a1714',
  muted: '#7a6e65',
  hint: '#9e9188',
  accent: '#c4622d',
  accentDk: '#a85025',
  accentBg: '#fef3e8',
  done: '#2e7d52',
  dark: '#1a1714'
} as const

function findTask(tasks: PracticeSessionTask[], taskId: string | null): PracticeSessionTask | null {
  return taskId ? (tasks.find((task) => task.id === taskId) ?? null) : (tasks[0] ?? null)
}

function taskIndex(tasks: PracticeSessionTask[], taskId: string | null): number {
  return taskId ? tasks.findIndex((task) => task.id === taskId) : -1
}

function toDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseDateKey(dateKey: string): Date {
  const [year, month, day] = dateKey.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function monthLabel(date: Date): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short' }).format(date)
}

function buildCalendarCells(monthDate: Date): CalendarCell[] {
  const firstOfMonth = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1)
  const firstVisible = new Date(firstOfMonth)
  firstVisible.setDate(firstVisible.getDate() - firstVisible.getDay())

  const cells: CalendarCell[] = []
  for (let index = 0; index < 42; index += 1) {
    const cellDate = new Date(firstVisible)
    cellDate.setDate(firstVisible.getDate() + index)
    cells.push({
      date: cellDate,
      dateKey: toDateKey(cellDate),
      inMonth: cellDate.getMonth() === monthDate.getMonth()
    })
  }

  return cells
}

export default function CourtInterpreterApp(): React.JSX.Element {
  const [template, setTemplate] = useState<PracticeTemplateTask[]>(DEFAULT_TEMPLATE)
  const [session, setSession] = useState<PracticeSession>(createFreshSession(DEFAULT_TEMPLATE))
  const [selectedTaskId, setSelectedTaskId] = useState(DEFAULT_TEMPLATE[0]?.id ?? '')
  const [modal, setModal] = useState<ModalState | null>(null)
  const [clock, setClock] = useState(() => formatLosAngelesClock())
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const today = new Date()
    return new Date(today.getFullYear(), today.getMonth(), 1)
  })
  const [sessionDates, setSessionDates] = useState<string[]>([])
  const [running, setRunning] = useState(false)
  const [ready, setReady] = useState(false)
  const previousCurrentTaskId = useRef<string | null>(session.currentTaskId)
  const saveTimer = useRef<number | null>(null)

  useEffect(() => {
    const id = window.setInterval(() => setClock(formatLosAngelesClock()), 1000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const loaded = await rpc.loadState()
        if (!cancelled) {
          setTemplate(loaded.template)
          setSession(loaded.session)
          setCalendarMonth(
            new Date(
              parseDateKey(loaded.session.date).getFullYear(),
              parseDateKey(loaded.session.date).getMonth(),
              1
            )
          )
          setSelectedTaskId(
            loaded.session.currentTaskId ??
              loaded.session.tasks[0]?.id ??
              loaded.template[0]?.id ??
              ''
          )
          const dates = await rpc.listSessionDates()
          setSessionDates(dates)
        }
      } catch (error) {
        console.error('Failed to load practice state', error)
      } finally {
        if (!cancelled) setReady(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!ready) return
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      void rpc.saveState({ template, session })
      setSessionDates((previous) =>
        previous.includes(session.date) ? previous : [...previous, session.date]
      )
    }, 350)
    return () => {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
    }
  }, [ready, session, template])

  useEffect(() => {
    const previous = previousCurrentTaskId.current
    previousCurrentTaskId.current = session.currentTaskId
    setSelectedTaskId((current) => {
      if (!session.tasks.some((task) => task.id === current))
        return session.currentTaskId ?? session.tasks[0]?.id ?? ''
      return current === previous ? (session.currentTaskId ?? current) : current
    })
  }, [session.currentTaskId, session.tasks])

  useEffect(() => {
    if (session.done) setRunning(false)
  }, [session.done])

  useEffect(() => {
    if (!running) return
    const id = window.setInterval(() => {
      setSession((previous) => {
        if (previous.done || previous.tasks.length === 0) return previous
        const active = findTask(previous.tasks, previous.currentTaskId)
        if (!active) return previous
        const index = taskIndex(previous.tasks, active.id)
        const tasks = previous.tasks.map((task) =>
          task.id === active.id
            ? { ...task, remainingSeconds: Math.max(0, task.remainingSeconds - 1) }
            : task
        )
        if ((tasks[index]?.remainingSeconds ?? 1) > 0) return { ...previous, tasks }
        const completedAt = active.completedAt ?? formatLosAngelesTimestamp()
        const completedTasks = tasks.map((task) =>
          task.id === active.id ? { ...task, remainingSeconds: 0, completedAt } : task
        )
        const nextId =
          completedTasks[index + 1]?.id ??
          completedTasks[completedTasks.length - 1]?.id ??
          active.id
        return {
          ...previous,
          tasks: completedTasks,
          currentTaskId:
            index >= completedTasks.length - 1
              ? (completedTasks[completedTasks.length - 1]?.id ?? active.id)
              : nextId,
          done: index >= completedTasks.length - 1
        }
      })
    }, 1000)
    return () => window.clearInterval(id)
  }, [running])

  const active = useMemo(() => findTask(session.tasks, session.currentTaskId), [session])
  const selected = useMemo(
    () =>
      session.tasks.find((task) => task.id === selectedTaskId) ??
      active ??
      session.tasks[0] ??
      null,
    [active, selectedTaskId, session.tasks]
  )
  const activeIndex = taskIndex(session.tasks, session.currentTaskId)
  const selectedIndex = taskIndex(session.tasks, selected?.id ?? null)
  const doneCount = session.tasks.filter((task) => task.completedAt !== null).length
  const totalMinutes = template.reduce((sum, task) => sum + task.duration, 0)
  const remainingMinutes = Math.ceil(
    session.tasks.reduce((sum, task) => sum + task.remainingSeconds, 0) / 60
  )
  const progress = template.length > 0 ? doneCount / template.length : 0
  const timerDisplaySeconds = useMemo(() => {
    if (!active) return 0
    const totalSeconds = Math.max(0, active.duration * 60)
    const remainingSeconds = Math.max(0, active.remainingSeconds)

    // Keep countdown frozen on stop; only show full duration for completed tasks.
    if (remainingSeconds === 0 || active.completedAt) return totalSeconds
    return remainingSeconds
  }, [active])
  const sessionDateSet = useMemo(() => new Set(sessionDates), [sessionDates])
  const calendarCells = useMemo(() => buildCalendarCells(calendarMonth), [calendarMonth])

  const syncTemplate = (nextTemplate: PracticeTemplateTask[]) => {
    setTemplate(nextTemplate)
    setSession((previous) => reconcileSessionWithTemplate(nextTemplate, previous))
    setSelectedTaskId((current) =>
      nextTemplate.some((task) => task.id === current) ? current : (nextTemplate[0]?.id ?? '')
    )
  }

  const updateNote = (taskId: string, note: string) => {
    setSession((previous) => ({
      ...previous,
      tasks: previous.tasks.map((task) => (task.id === taskId ? { ...task, note } : task))
    }))
  }

  const selectTask = (taskId: string) => {
    setSelectedTaskId(taskId)
    setRunning(false)
    setSession((previous) => {
      const selectedTask = previous.tasks.find((task) => task.id === taskId)
      if (!selectedTask) {
        return previous
      }

      const hasPendingTasks = previous.tasks.some((task) => task.completedAt === null)
      return {
        ...previous,
        currentTaskId: taskId,
        done: hasPendingTasks ? false : previous.done
      }
    })
  }

  const addTask = () => setModal({ mode: 'add', name: '', duration: '5' })
  const editTask = () =>
    selected &&
    setModal({
      mode: 'edit',
      taskId: selected.id,
      name: selected.name,
      duration: String(selected.duration)
    })
  const deleteTask = () =>
    selected &&
    template.length > 1 &&
    syncTemplate(template.filter((task) => task.id !== selected.id))
  const moveTask = (direction: -1 | 1) => {
    if (!selected) return
    const index = template.findIndex((task) => task.id === selected.id)
    const target = index + direction
    if (target < 0 || target >= template.length) return
    const next = [...template]
    ;[next[index], next[target]] = [next[target], next[index]]
    syncTemplate(next)
  }

  const confirmModal = () => {
    if (!modal) return
    const name = modal.name.trim() || 'Task'
    const duration = Math.max(1, Number.parseInt(modal.duration, 10) || 5)
    if (modal.mode === 'add') {
      const task = { id: createTaskId('practice-task'), name, duration }
      syncTemplate([...template, task])
      setSelectedTaskId(task.id)
    } else {
      syncTemplate(
        template.map((task) => (task.id === modal.taskId ? { ...task, name, duration } : task))
      )
    }
    setModal(null)
  }

  const play = () => !session.done && active && setRunning(true)
  const stop = () => setRunning(false)
  const resetCurrent = () =>
    active &&
    setSession((previous) => ({
      ...previous,
      done: false,
      currentTaskId: active.id,
      tasks: previous.tasks.map((task) =>
        task.id === active.id
          ? { ...task, remainingSeconds: task.duration * 60, completedAt: null }
          : task
      )
    }))
  const skipNext = () =>
    active &&
    setSession((previous) => {
      const index = taskIndex(previous.tasks, active.id)
      const completedAt = active.completedAt ?? formatLosAngelesTimestamp()
      const tasks = previous.tasks.map((task) =>
        task.id === active.id ? { ...task, remainingSeconds: 0, completedAt } : task
      )
      const nextId = tasks[index + 1]?.id ?? tasks[tasks.length - 1]?.id ?? active.id
      return {
        ...previous,
        tasks,
        currentTaskId:
          index >= tasks.length - 1 ? (tasks[tasks.length - 1]?.id ?? active.id) : nextId,
        done: index >= tasks.length - 1
      }
    })
  const markDone = () =>
    active &&
    setSession((previous) => ({
      ...previous,
      tasks: previous.tasks.map((task) =>
        task.id === active.id
          ? { ...task, completedAt: task.completedAt ?? formatLosAngelesTimestamp() }
          : task
      )
    }))

  const newDay = async () => {
    setRunning(false)
    const next = await rpc.newDay(template)
    setTemplate(next.template)
    setSession(next.session)
    setCalendarMonth(
      new Date(
        parseDateKey(next.session.date).getFullYear(),
        parseDateKey(next.session.date).getMonth(),
        1
      )
    )
    setSessionDates((previous) =>
      previous.includes(next.session.date) ? previous : [...previous, next.session.date]
    )
    setSelectedTaskId(next.session.currentTaskId ?? next.template[0]?.id ?? '')
  }
  const resetDefaults = async () => {
    setRunning(false)
    const next = await rpc.resetToDefaults()
    setTemplate(next.template)
    setSession(next.session)
    setCalendarMonth(
      new Date(
        parseDateKey(next.session.date).getFullYear(),
        parseDateKey(next.session.date).getMonth(),
        1
      )
    )
    setSessionDates((previous) =>
      previous.includes(next.session.date) ? previous : [...previous, next.session.date]
    )
    setSelectedTaskId(next.session.currentTaskId ?? next.template[0]?.id ?? '')
  }

  const loadDate = async (dateKey: string) => {
    setRunning(false)
    const next = await rpc.loadStateByDate(dateKey)
    setTemplate(next.template)
    setSession(next.session)
    setSelectedTaskId(next.session.currentTaskId ?? next.session.tasks[0]?.id ?? '')
    setCalendarMonth(
      new Date(parseDateKey(dateKey).getFullYear(), parseDateKey(dateKey).getMonth(), 1)
    )
  }

  const moveCalendarMonth = (direction: -1 | 1) => {
    setCalendarMonth(
      (previous) => new Date(previous.getFullYear(), previous.getMonth() + direction, 1)
    )
  }

  if (!ready)
    return (
      <div className="practice-loading">
        Court Interpreter
        <br />
        Loading practice session...
      </div>
    )

  return (
    <div className="practice-app">
      <style>{`
        .practice-app{min-height:100vh;display:flex;flex-direction:column;background:${C.bg};color:${C.text}}
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
        .practice-current-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px}
        .practice-input:focus,.practice-textarea:focus{border-color:${C.accent}!important;outline:none}
        .practice-loading{min-height:100vh;display:grid;place-items:center;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:${C.bg};color:${C.text};text-align:center}
        @media (max-width:745px){.practice-main .practice-grid3.practice-actions{grid-template-columns:repeat(2,minmax(0,1fr))}.practice-main .practice-done-btn{grid-column:1 / -1}}
        @media (max-width:650px){.practice-layout{grid-template-columns:1fr;grid-template-areas:'right' 'left' 'notes' 'calendar'}.practice-task-list{max-height:none}}
      `}</style>

      <div className="practice-shell">
        <header className="practice-header">
          <div>
            <div className="practice-title">COURT INTERPRETER</div>
            <div className="practice-subtitle">Daily Practice Session</div>
            <div className="practice-date">{formatLosAngelesDateLabel()}</div>
          </div>
          <div className="practice-clock-wrap">
            <div className="practice-clock">{clock}</div>
            <div className="practice-summary">
              {doneCount}/{template.length} | {remainingMinutes}m
            </div>
          </div>
        </header>

        <div className="practice-progress">
          <div style={{ width: `${Math.max(0, Math.min(100, progress * 100))}%` }} />
        </div>

        <main className="practice-layout">
          <section className="practice-side" style={{ gridArea: 'left' }}>
            <div className="practice-card practice-list-card">
              <div className="practice-list-head">
                <span>#</span>
                <span>Task</span>
                <span>Time</span>
              </div>
              <div className="practice-task-list">
                {session.tasks.map((task, index) => {
                  const isActive = task.id === session.currentTaskId && !session.done
                  const isSelected = task.id === selected?.id
                  const isDone = task.completedAt !== null
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
                              : 'transparent',
                        background:
                          isActive || isSelected ? C.accentBg : isDone ? '#f9f8f5' : 'transparent',
                        opacity: isDone && !isSelected ? 0.72 : 1
                      }}
                    >
                      <span className="practice-task-num">{isDone ? '✓' : index + 1}</span>
                      <span className="practice-task-name">{task.name}</span>
                      <span className="practice-task-time">{`${task.duration}m`}</span>
                    </button>
                  )
                })}
              </div>
            </div>
            <div className="practice-grid3" style={{ marginTop: 'auto' }}>
              <button type="button" className="practice-btn" onClick={addTask}>
                + Add
              </button>
              <button
                type="button"
                className="practice-btn"
                onClick={editTask}
                disabled={!selected}
              >
                Edit
              </button>
              <button
                type="button"
                className="practice-btn"
                onClick={deleteTask}
                disabled={!selected || template.length <= 1}
              >
                Delete
              </button>
            </div>
            <div className="practice-grid2">
              <button
                type="button"
                className="practice-btn"
                onClick={() => moveTask(-1)}
                disabled={!selected}
              >
                ↑ Move Up
              </button>
              <button
                type="button"
                className="practice-btn"
                onClick={() => moveTask(1)}
                disabled={!selected}
              >
                ↓ Move Down
              </button>
            </div>
            <div className="practice-grid2">
              <button type="button" className="practice-btn practice-btn-strong" onClick={newDay}>
                New Day
              </button>
              <button type="button" className="practice-btn" onClick={resetDefaults}>
                Reset List
              </button>
            </div>
          </section>

          <section className="practice-main" style={{ gridArea: 'right' }}>
            <div className="practice-card practice-timer-card">
              <div className="practice-current-head">
                <div className="practice-eyebrow">Current Task</div>
                {selected?.completedAt ? (
                  <span className="practice-completed">Completed {selected.completedAt}</span>
                ) : null}
              </div>
              <div className="practice-current">
                {session.done ? 'Session Complete' : (active?.name ?? '—')}
              </div>
              <div className="practice-timer">{formatDuration(timerDisplaySeconds)}</div>
              <div className="practice-status">
                {session.done
                  ? 'Every task complete — great session'
                  : running
                    ? '● Running'
                    : 'Stopped'}
              </div>
              <div className="practice-grid2 practice-actions">
                <button
                  type="button"
                  className="practice-btn practice-btn-strong"
                  onClick={play}
                  disabled={running || session.done || !active}
                >
                  ▶ Play
                </button>
                <button type="button" className="practice-btn" onClick={stop} disabled={!running}>
                  ■ Stop
                </button>
              </div>
              <div className="practice-grid3 practice-actions">
                <button
                  type="button"
                  className="practice-btn"
                  onClick={resetCurrent}
                  disabled={!active || session.done}
                >
                  ↺ Reset Task
                </button>
                <button
                  type="button"
                  className="practice-btn"
                  onClick={skipNext}
                  disabled={!active || session.done}
                >
                  ⏭ Next Task
                </button>
                <button
                  type="button"
                  className="practice-btn practice-btn-strong practice-done-btn"
                  onClick={markDone}
                  disabled={!active || session.done || active.completedAt !== null}
                >
                  ✓ Done
                </button>
              </div>
              <div className="practice-meta">
                <span>
                  Task{' '}
                  <strong>
                    {activeIndex >= 0 ? `${activeIndex + 1} of ${session.tasks.length}` : '—'}
                  </strong>
                </span>
                <span>
                  Remaining <strong>{remainingMinutes}m</strong>
                </span>
                <span>
                  Done{' '}
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

          <section className="practice-main" style={{ gridArea: 'notes' }}>
            <div className="practice-card practice-notes-card">
              <div className="practice-eyebrow">Task Notes</div>
              <div className="practice-note-title">
                {selectedIndex >= 0
                  ? `${selectedIndex + 1}. ${selected?.name ?? '—'}`
                  : 'Select a task'}
              </div>
              <textarea
                className="practice-textarea"
                value={selected?.note ?? ''}
                onChange={(event) => selected && updateNote(selected.id, event.target.value)}
                placeholder="What did you practice?"
                disabled={!selected}
              />
              <div className="practice-notes-footer">
                <div className="practice-note-actions">
                  <button
                    type="button"
                    className="practice-btn practice-btn-strong"
                    onClick={() => selected && updateNote(selected.id, selected.note)}
                    disabled={!selected}
                  >
                    Save Note
                  </button>
                  <button
                    type="button"
                    className="practice-btn"
                    onClick={() => selected && updateNote(selected.id, '')}
                    disabled={!selected}
                  >
                    Clear
                  </button>
                </div>
              </div>
            </div>
          </section>

          <div className="practice-card practice-calendar-card" style={{ gridArea: 'calendar' }}>
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
                  const isSelectedDate = cell.dateKey === session.date
                  const hasData = sessionDateSet.has(cell.dateKey)
                  return (
                    <button
                      key={cell.dateKey}
                      type="button"
                      className={`practice-calendar-day${isSelectedDate ? ' is-selected' : ''}${cell.inMonth ? '' : ' is-outside'}${hasData ? ' has-data' : ''}`}
                      onClick={() => loadDate(cell.dateKey)}
                    >
                      <span>{cell.date.getDate()}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </main>
      </div>

      {modal ? (
        <div className="practice-modal-backdrop">
          <div className="practice-modal">
            <div className="practice-modal-title">
              {modal.mode === 'add' ? 'Add Task' : 'Edit Task'}
            </div>
            <label className="practice-label">
              Task Name
              <input
                className="practice-input"
                type="text"
                value={modal.name}
                onChange={(event) =>
                  setModal((current) =>
                    current ? { ...current, name: event.target.value } : current
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
                    current ? { ...current, duration: event.target.value } : current
                  )
                }
                onKeyDown={(event) => event.key === 'Enter' && confirmModal()}
              />
            </label>
            <div className="practice-grid2">
              <button
                type="button"
                className="practice-btn practice-btn-strong"
                onClick={confirmModal}
              >
                {modal.mode === 'add' ? 'Add Task' : 'Save Changes'}
              </button>
              <button type="button" className="practice-btn" onClick={() => setModal(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
