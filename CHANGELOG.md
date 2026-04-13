# Changelog

All notable changes to this project are documented here.

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
