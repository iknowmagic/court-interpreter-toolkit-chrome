# Court Interpreter Chrome: Agent Notes

## Architecture
- UI surfaces: `Popup` and `Options`.
- Transport: UI calls `@utils/chromeRPC`.
- Runtime logic: background `sessionManager` is the single runtime authority (timer, toolbar, context menu). There is no second popup-driven toolbar-sync path.
- Persistence: `@shared/indexedDB` stores template and daily sessions; `chrome.storage.local` stores the persisted timer runtime record and settings.
- Data flow: `Popup/Options -> chromeRPC -> background/sessionManager -> indexedDB + chrome.storage.local -> toolbar/context-menu refresh`.
- Background initialization is a single awaited promise (`ensureInitialized`). Every message, alarm, and context-menu handler calls it fresh for its own event (via `runInitialized` in `pages/background/index.ts`) rather than awaiting one module-level captured promise, so a failed initialization is retried on the next event instead of being permanently swallowed.
- `materializeRunningTimer` (in `sessionManager.ts`) is single-flight: interval ticks, the Chrome alarm, initialization, state reads, pause, and other runtime commands can all call it at nearly the same moment, but only one materialization runs at a time. Concurrent callers receive the same authoritative result; a rejected materialization clears the in-flight slot so the next call can retry.
- Vite `mode` (`production` | `development`), not a private `__DEV__` env var, controls development-only build composition (`vite.config.base.ts`'s `createBaseManifest`/`createBaseConfig`). Production output must never contain the development manifest name, `dev-icon-*` files, or source maps; `pnpm check:builds` / `scripts/verify-chrome-build.mjs` enforce this.

## Core Invariants
- Only one task is current (`session.currentTaskId`).
- `Stop` never resets task time.
- `Play` resumes where left off unless the current task is complete/empty, then that task is reset and started.
- All template edits reconcile into session state by task id.
- Duration edits reset that task's `remainingSeconds` to full duration.
- Timer truth is a persisted deadline (`endsAtMs` in `background/timerRuntime.ts`), not an in-memory tick timestamp. Remaining time is always recomputed fresh from the deadline, so it survives service-worker suspension/restart and repeated materialization at the same timestamp is idempotent.
- History reads are strictly read-only: `readStateByDate(date)` delegates to IndexedDB and returns the result without mutating active session state, timer runtime, or the toolbar/context menu. Only the normal active-state contract (`loadState`/`getSessionState`) may change what's active.
- Historical state is never autosaved. Autosave only runs when the initial load succeeded, the viewed date is today, the timer is not running, and the user actually changed something since the last authoritative load.
- Mutation prerequisites (select task, add, edit, delete, move, reset list, change date) call the popup's blocking `pauseForMutation` helper first. A failed pause aborts the mutation and surfaces a visible error; it never continues silently.
- A completed session is never reported as paused: if `Stop` or `Done` cause the session to finish (e.g. the deadline already passed while the worker was asleep), `getRunningState()` reports `{ isRunning: false, isPaused: false }`, not `isPaused: true`.

## Button Semantics
- `Play`: starts/resumes selected current task.
- `Stop`: pauses timer only.
- `Reset Task`: resets selected/current task to full duration and clears only that task completion.
- `Done`: completes current task and advances selection without auto-starting next.
- `Edit/Add/Delete/Move`: stop timer first, then mutate.
- `Reset List`: hard reset. Deletes all history/session progress across all days, restores default template, creates fresh today session.

## Mutation Contract
- Before `Edit Save`, `Add`, `Delete`, `Move Up`, `Move Down`, task selection, `Reset List`, and date navigation: the background timer is paused (`pauseForMutation`) and `running=false`.
- A pause failure aborts the mutation entirely; local template/session state is not touched.
- After a successful mutation: timer remains stopped.
- Completion status remains unless task is deleted.

## History Mode (Past Dates)
- Past-day view is read-only.
- Task control buttons and note input are disabled and shown in gray monochrome styling.
- Calendar remains available for date navigation, backed by one `listSessionSummaries()` call (not one full session load per date).
- Calendar `Today` button jumps back to today (reloading the active background state) and closes the popover.

## Reset Behavior
- `Reset List` is intentionally destructive and uses a hard-confirm dialog:
  - `Are you sure you want to reset the list? All progress data across all days will be deleted. This action cannot be undone.`
- Non-progress settings (like completion alarm toggle) are not reset.

## Known Pitfalls
- If code mutates session/template without pausing first, UI and background timer can drift. Use `pauseForMutation` rather than calling `rpc.pauseSession()` directly and continuing regardless of the result.
- Reconciliation is id-based; changing task ids is equivalent to delete+add.
- `readStateByDate` for a missing date returns a derived in-memory session but never persists it; only a later save (editing today) writes a real record.
- Timer runtime metadata lives in `chrome.storage.local` under `session-manager-runtime-v1`, separate from IndexedDB. Do not migrate it into IndexedDB.

## Changelog Standard
- Keep `CHANGELOG.md` updated per release.
- Use version sections with date (`## [x.y.z] - YYYY-MM-DD`).
- Keep entries short and grouped by `Added`, `Changed`, `Fixed`, and `Docs`.
- Include commit references when they help track major release work.
