# Changelog

All notable changes to this project are documented here.

## [Unreleased]

### Fixed
- History reads (`readStateByDate`) are now strictly read-only: viewing a past date can no longer replace the active background session, alter timer runtime metadata, change the toolbar, or get autosaved.
- Timer truth is now a persisted deadline (`endsAtMs`, stored in `chrome.storage.local`) instead of an in-memory tick timestamp, so remaining time is correct after Manifest V3 service-worker suspension or restart, with no lost or double-counted elapsed time.
- Mutation prerequisites (select task, add/edit/delete/move, reset list, date navigation) now abort when the required pause fails, instead of silently continuing and letting the UI drift from the background timer.
- Removed the popup-driven `updateToolbarStatus` RPC path; the background `sessionManager` is the only surface that writes toolbar/context-menu state.
- Removed the stretched empty area below the task list by aligning list-card sizing with fixed-height list scrolling and bottom-anchored controls.
- Background initialization retries per event instead of permanently failing: a captured module-level `readyPromise` that swallowed a startup rejection has been replaced with `runInitialized()`, which calls `ensureInitialized()` fresh for every message/alarm/context-menu event so a later event can still succeed after an earlier one failed.
- `materializeRunningTimer` is now single-flight: interval ticks, the Chrome alarm, initialization, state reads, pause, and other runtime commands used to be able to race into concurrent completion/save/alarm transitions; only one materialization now runs at a time, with concurrent callers sharing its result and a rejection clearing the slot for retry.
- `pauseSession` and the Done command (`completeCurrentTaskAndAdvanceNoStart`) no longer report a completed session as paused. If materializing elapsed time completes the final task (e.g. the deadline passed while the worker was asleep), the session now correctly reports `{ isRunning: false, isPaused: false }` instead of `isPaused: true`.
- Removed React `act(...)` warnings and unasserted `console.error` dumps from the popup test suite.

### Added
- Explicit popup load states (`loading` / `ready` / `error`) with a Retry action on initial-load failure, instead of silently falling back to an editable default session.
- A visible, dismissible operation-error banner for failed Play/Stop/Done, mutation, reset, and date-navigation calls.
- `PracticeSessionSummary` + `listSessionSummaries()`: the calendar's data/completion markers now come from one summary query instead of one full session load per date.
- Direct background `sessionManager` test suite (`src/background/__tests__/sessionManager.test.ts`) covering restart, idempotent materialization, expiry/completion, date rollover, malformed-runtime safety, single-flight materialization concurrency/retry, paused-state transitions, and context-menu commands, plus a reusable `chrome.*` test mock (`src/test/chromeMock.ts`).
- ESLint 9 flat config and a real CI workflow running on push/PR/dispatch.
- `scripts/verify-chrome-build.mjs` and `pnpm check:build`: an executable check (not just a manual smoke test) that a production build never contains development name/icons/source maps and leaves `dist_chrome/` as a verified production artifact.
- Pinned the local toolchain (Node `24.18.0`, pnpm `11.9.0`) via `.nvmrc`, `package.json` `engines`/`packageManager`, and matching CI setup steps.

### Changed
- Renamed the popup surface component from `PopupElectron` to `SessionPopup`, including updated popup exports and popup test naming.
- Split `SessionPopup.tsx` into `usePracticeSession.ts` (state/RPC/autosave/error orchestration), `SessionWorkspace.tsx`, `SessionCalendarPopover.tsx`, `TaskEditorDialog.tsx`, and `sessionPopupUtils.ts`, with no change to visual design or product behavior.
- Updated the popup task list to use a fixed internal scroll region (`height: 270px`) instead of max-height-based behavior.
- Added a dedicated left-column controls wrapper (`practice-side-controls`) so task/action controls can be anchored to the bottom of the popup column.
- Added themed task-list scrollbar styling with `scrollbar-color: #e9d0a8 #fdfaf5` and matching WebKit thumb/track rules.
- Package metadata now reflects the actual product (`court-interpreter-toolkit`, correct repository/homepage/bugs URLs) instead of the upstream Vite extension template.
- Vite configuration was refactored to mode-based factories (`createBaseManifest`/`createBaseConfig` in `vite.config.base.ts`): `vite.config.chrome.ts` now derives development vs. production purely from Vite's `mode`, replacing the previous private `__DEV__` environment variable contract. Both modes now set `emptyOutDir: true` so every build is a clean one-shot build.
- `pnpm check` now runs `check:build`, in addition to lint/typecheck/coverage and duplicate scanning, so the quality gate verifies the Chrome production build artifact.

### Removed
- Unused starter-template surfaces: content script, devtools panel, new-tab override, side panel, `SessionTimer`/`TaskCustomizer` components, i18n locales scaffold, and Firefox build config.

### Docs
- Rewrote `README.md` with real product/architecture/source-tree/test-strategy documentation.
- Updated `AGENTS.md` invariants for read-only history, persisted-deadline timer truth, per-event background initialization retry, single-flight materialization, and correct paused-state semantics.
- Corrected a previous entry in this changelog that mistakenly listed "dev-icon swapping" as removed: the development manifest (`manifest.dev.json`) and its two development icons were retained and simplified (no `web_accessible_resources`, no `contentStyle.css` reference), not removed.

## [1.5.0] - 2026-04-12

### Added
- Completion alarm support with a settings toggle in the extension action context menu.
- Offscreen alarm playback document (`alarm-player.html` / `alarm-player.js`) for smooth completion chime playback.
- Popup calendar `Today` button to jump back to today and close the calendar popover.
- Vitest test setup (`vitest.config.ts`, `vitest.setup.ts`) and test scripts (`test`, `test:watch`).
- Automated tests for popup/options behavior and shared session logic.

### Changed
- `Edit Task` save now updates both task name and task duration immediately in the UI.
- Task mutations (`Edit`, `Add`, `Delete`, `Move Up`, `Move Down`) now follow stop-first behavior in popup and options flows.
- `Reset List` now performs a hard reset: all historical progress is deleted and defaults are restored.
- Reset confirmation message now explicitly warns about destructive, irreversible data loss.
- Past-day history mode now uses gray monochrome disabled styling for controls and note input.
- Replaced the extension Options page with the new dedicated settings design, including hero image support and a single alarm toggle flow backed by background settings.
- Removed duplicate alarm controls from the action context menu so alarm configuration lives in Options.

### Fixed
- Duration edits now correctly reset `remainingSeconds` to full new duration without requiring manual `Reset Task`.
- Template reconciliation now preserves completion/note fields while still applying duration changes correctly.
- Session date list after hard reset now reflects the fresh current day only.

### Docs
- Added `AGENTS.md` with architecture, button semantics, invariants, reset behavior, and pitfalls.

### Commit Reference
- Start of 1.5.0 work: `9ca50c40c36312c42a7ed261d9b735ff66985af0`
- Consolidated feature/fix/test update: `2a40cf492248680342f37850e98947eaa53a08c3`
