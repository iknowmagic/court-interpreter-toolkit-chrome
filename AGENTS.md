# Court Interpreter Chrome: Agent Notes

## Architecture
- UI surfaces: `Popup` and `Options`.
- Transport: UI calls `@utils/chromeRPC`.
- Runtime logic: background `sessionManager` is the single source of timer truth.
- Persistence: `@shared/indexedDB` stores template and daily sessions.
- Data flow: `Popup/Options -> chromeRPC -> background/sessionManager -> indexedDB`.

## Core Invariants
- Only one task is current (`session.currentTaskId`).
- `Stop` never resets task time.
- `Play` resumes where left off unless the current task is complete/empty, then that task is reset and started.
- All template edits reconcile into session state by task id.
- Duration edits reset that task's `remainingSeconds` to full duration.

## Button Semantics
- `Play`: starts/resumes selected current task.
- `Stop`: pauses timer only.
- `Reset Task`: resets selected/current task to full duration and clears only that task completion.
- `Done`: completes current task and advances selection without auto-starting next.
- `Edit/Add/Delete/Move`: stop timer first, then mutate.
- `Reset List`: hard reset. Deletes all history/session progress across all days, restores default template, creates fresh today session.

## Mutation Contract
- Before `Edit Save`, `Add`, `Delete`, `Move Up`, `Move Down`: timer is paused and `running=false`.
- After mutation: timer remains stopped.
- Completion status remains unless task is deleted.

## History Mode (Past Dates)
- Past-day view is read-only.
- Task control buttons and note input are disabled and shown in gray monochrome styling.
- Calendar remains available for date navigation.
- Calendar `Today` button jumps back to today and closes the popover.

## Reset Behavior
- `Reset List` is intentionally destructive and uses a hard-confirm dialog:
  - `Are you sure you want to reset the list? All progress data across all days will be deleted. This action cannot be undone.`
- Non-progress settings (like completion alarm toggle) are not reset.

## Known Pitfalls
- If code mutates session/template without pausing first, UI and background timer can drift.
- Reconciliation is id-based; changing task ids is equivalent to delete+add.
- `loadStateByDate` for missing dates returns a derived in-memory session unless later saved.
