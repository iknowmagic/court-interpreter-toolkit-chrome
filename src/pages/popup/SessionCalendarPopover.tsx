import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PracticeSessionSummary } from "@shared/practice";
import { buildCalendarCells, monthLabel, parseDateKey } from "./sessionPopupUtils";

const WEEK_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

type CalendarPopoverPlacement = "above" | "below" | "center";

interface CalendarPopoverPosition {
  top: number;
  left: number;
  placement: CalendarPopoverPlacement;
}

interface SessionCalendarPopoverProps {
  sessionDate: string;
  isSessionDone: boolean;
  todayDateKey: string;
  summaries: PracticeSessionSummary[];
  onSelectDate: (dateKey: string) => Promise<boolean>;
  onToday: () => Promise<boolean>;
}

function fullDateLabel(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function calendarDateLabel(date: Date, isSelected: boolean, isComplete: boolean): string {
  const states = [isSelected ? "selected" : null, isComplete ? "completed" : null].filter(
    Boolean,
  );
  return [fullDateLabel(date), ...states].join(", ");
}

function targetMonthLabel(monthDate: Date, direction: -1 | 1): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
  }).format(new Date(monthDate.getFullYear(), monthDate.getMonth() + direction, 1));
}

export default function SessionCalendarPopover({
  sessionDate,
  isSessionDone,
  todayDateKey,
  summaries,
  onSelectDate,
  onToday,
}: SessionCalendarPopoverProps): React.JSX.Element {
  const [showCalendarPopover, setShowCalendarPopover] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const parsed = parseDateKey(sessionDate);
    return new Date(parsed.getFullYear(), parsed.getMonth(), 1);
  });
  const [calendarPopoverPosition, setCalendarPopoverPosition] =
    useState<CalendarPopoverPosition | null>(null);
  const popoverTitleId = useId();
  const monthTitleId = useId();
  const calendarPopoverAnchorRef = useRef<HTMLDivElement | null>(null);
  const calendarTriggerRef = useRef<HTMLButtonElement | null>(null);
  const calendarPopoverPanelRef = useRef<HTMLDivElement | null>(null);
  const focusOnOpenPendingRef = useRef(false);

  useEffect(() => {
    const parsed = parseDateKey(sessionDate);
    setCalendarMonth(new Date(parsed.getFullYear(), parsed.getMonth(), 1));
  }, [sessionDate]);

  useEffect(() => {
    if (!showCalendarPopover) {
      setCalendarPopoverPosition(null);
      return;
    }

    const anchor = calendarPopoverAnchorRef.current;
    if (!anchor) return;

    const gap = 8;
    const viewportPad = 8;
    const updatePosition = () => {
      const anchorRect = anchor.getBoundingClientRect();
      const panelRect =
        calendarPopoverPanelRef.current?.getBoundingClientRect();
      const popoverWidth = panelRect?.width ?? 280;
      const popoverHeight = panelRect?.height ?? 360;
      const maxLeft = Math.max(
        viewportPad,
        window.innerWidth - popoverWidth - viewportPad,
      );
      const anchoredLeft = Math.min(
        maxLeft,
        Math.max(viewportPad, anchorRect.left),
      );

      const aboveTop = anchorRect.top - popoverHeight - gap;
      if (aboveTop >= viewportPad) {
        setCalendarPopoverPosition({
          top: aboveTop,
          left: anchoredLeft,
          placement: "above",
        });
        return;
      }

      const belowTop = anchorRect.bottom + gap;
      if (belowTop + popoverHeight <= window.innerHeight - viewportPad) {
        setCalendarPopoverPosition({
          top: belowTop,
          left: anchoredLeft,
          placement: "below",
        });
        return;
      }

      const centeredTop = Math.max(
        viewportPad,
        Math.floor((window.innerHeight - popoverHeight) / 2),
      );
      const centeredLeft = Math.max(
        viewportPad,
        Math.floor((window.innerWidth - popoverWidth) / 2),
      );
      setCalendarPopoverPosition({
        top: centeredTop,
        left: centeredLeft,
        placement: "center",
      });
    };

    updatePosition();
    const rafId = window.requestAnimationFrame(updatePosition);
    const rafIdTwo = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(updatePosition);
    });
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.cancelAnimationFrame(rafId);
      window.cancelAnimationFrame(rafIdTwo);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [showCalendarPopover, calendarMonth]);

  useEffect(() => {
    if (!showCalendarPopover || !calendarPopoverPosition || !focusOnOpenPendingRef.current) return;

    const panel = calendarPopoverPanelRef.current;
    if (!panel) return;

    const dateButtons = Array.from(
      panel.querySelectorAll<HTMLButtonElement>(".practice-calendar-day"),
    );
    const selectedDateButton = dateButtons.find(
      (button) => button.dataset.dateKey === sessionDate && !button.disabled,
    );
    const todayDateButton = dateButtons.find(
      (button) => button.dataset.dateKey === todayDateKey && !button.disabled,
    );
    const fallbackButton = panel.querySelector<HTMLButtonElement>(
      "[data-calendar-nav='previous']",
    );

    (selectedDateButton ?? todayDateButton ?? fallbackButton)?.focus();
    focusOnOpenPendingRef.current = false;
  }, [calendarPopoverPosition, sessionDate, showCalendarPopover, todayDateKey]);

  const restoreTriggerFocus = useCallback(() => {
    const trigger = calendarTriggerRef.current;
    if (!trigger?.isConnected) return;
    window.requestAnimationFrame(() => {
      if (trigger.isConnected) trigger.focus();
    });
  }, []);

  const closeCalendarPopover = useCallback((restoreFocus: boolean) => {
    setShowCalendarPopover(false);
    focusOnOpenPendingRef.current = false;
    if (restoreFocus) restoreTriggerFocus();
  }, [restoreTriggerFocus]);

  const keepFocusInsidePopover = useCallback(() => {
    const panel = calendarPopoverPanelRef.current;
    if (!panel) return;
    if (document.activeElement && panel.contains(document.activeElement)) return;
    panel
      .querySelector<HTMLButtonElement>("[data-calendar-nav='previous']")
      ?.focus();
  }, []);

  useEffect(() => {
    if (!showCalendarPopover) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      const insideTrigger = calendarPopoverAnchorRef.current?.contains(target);
      const insidePopover = calendarPopoverPanelRef.current?.contains(target);
      if (!insideTrigger && !insidePopover) {
        closeCalendarPopover(true);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeCalendarPopover(true);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [closeCalendarPopover, showCalendarPopover]);

  const sessionDateSet = useMemo(
    () => new Set(summaries.map((summary) => summary.date)),
    [summaries],
  );
  const completedSessionDateSet = useMemo(() => {
    const keys = new Set(
      summaries.filter((summary) => summary.completed).map((summary) => summary.date),
    );
    if (isSessionDone) keys.add(sessionDate);
    return keys;
  }, [summaries, isSessionDone, sessionDate]);
  const calendarCells = useMemo(
    () => buildCalendarCells(calendarMonth),
    [calendarMonth],
  );

  const moveCalendarMonth = (direction: -1 | 1) => {
    setCalendarMonth(
      (previous) =>
        new Date(previous.getFullYear(), previous.getMonth() + direction, 1),
    );
  };

  const handleSelectDate = (dateKey: string) => {
    void (async () => {
      try {
        const ok = await onSelectDate(dateKey);
        if (ok) {
          closeCalendarPopover(true);
        } else {
          keepFocusInsidePopover();
        }
      } catch {
        keepFocusInsidePopover();
      }
    })();
  };

  const handleToday = () => {
    void (async () => {
      try {
        const ok = await onToday();
        if (ok) {
          closeCalendarPopover(true);
        } else {
          keepFocusInsidePopover();
        }
      } catch {
        keepFocusInsidePopover();
      }
    })();
  };

  return (
    <div className="practice-calendar-popover-wrap" ref={calendarPopoverAnchorRef}>
      <button
        ref={calendarTriggerRef}
        type="button"
        className="practice-btn"
        style={{ width: "100%" }}
        aria-expanded={showCalendarPopover}
        aria-controls="practice-calendar-popover"
        aria-label="Open calendar"
        onClick={() => {
          setShowCalendarPopover((current) => {
            if (current) return false;
            focusOnOpenPendingRef.current = true;
            return true;
          });
        }}
      >
        Open Calendar
      </button>

      {showCalendarPopover
        ? createPortal(
            <div
              id="practice-calendar-popover"
              ref={calendarPopoverPanelRef}
              className="practice-calendar-popover"
              data-placement={calendarPopoverPosition?.placement ?? "below"}
              role="dialog"
              aria-labelledby={`${popoverTitleId} ${monthTitleId}`}
              style={{
                top: `${calendarPopoverPosition?.top ?? -10000}px`,
                left: `${calendarPopoverPosition?.left ?? -10000}px`,
                visibility: calendarPopoverPosition ? "visible" : "hidden",
              }}
            >
              <div id={popoverTitleId} className="practice-popover-title">Session Calendar</div>
              <div className="practice-calendar">
                <div className="practice-calendar-head">
                  <button
                    type="button"
                    className="practice-calendar-nav"
                    data-calendar-nav="previous"
                    aria-label={`Previous month, ${targetMonthLabel(calendarMonth, -1)}`}
                    onClick={() => moveCalendarMonth(-1)}
                  >
                    ‹
                  </button>
                  <div id={monthTitleId} className="practice-calendar-title">
                    <span>{monthLabel(calendarMonth)}</span>
                    <span>{calendarMonth.getFullYear()}</span>
                  </div>
                  <button
                    type="button"
                    className="practice-calendar-nav"
                    data-calendar-nav="next"
                    aria-label={`Next month, ${targetMonthLabel(calendarMonth, 1)}`}
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
                    const isSelectedDate = cell.dateKey === sessionDate;
                    const hasData = sessionDateSet.has(cell.dateKey);
                    const isCompleteDay = completedSessionDateSet.has(cell.dateKey);
                    const isSelectable = hasData || cell.dateKey === todayDateKey;
                    return (
                      <button
                        key={cell.dateKey}
                        type="button"
                        className={`practice-calendar-day${isSelectedDate ? " is-selected" : ""}${cell.inMonth ? "" : " is-outside"}${isCompleteDay ? " is-complete" : ""}`}
                        aria-label={calendarDateLabel(cell.date, isSelectedDate, isCompleteDay)}
                        data-date-key={cell.dateKey}
                        disabled={!isSelectable}
                        onClick={() => handleSelectDate(cell.dateKey)}
                      >
                        <span className="practice-calendar-day-inner">
                          {cell.date.getDate()}
                          <span className="practice-calendar-check" aria-hidden="true">
                            ✓
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
                <div style={{ marginTop: "8px" }}>
                  <button
                    type="button"
                    className="practice-btn"
                    style={{ width: "100%" }}
                    onClick={handleToday}
                  >
                    Today
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
