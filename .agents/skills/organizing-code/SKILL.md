---
name: organizing-code
description: Use when creating, moving, splitting, or refactoring Court Interpreter Toolkit TypeScript, React, background, shared, test, or browser-extension files. Governs ownership, source placement, naming, test colocation, imports, component size, and avoiding vague shared abstractions. Trigger for code organization, file placement, splitting large files, moving components, shared helpers, or repository cleanup.
---

# Organizing Court Interpreter Toolkit Code

Use this skill to keep code easy to find, test, and change while preserving ownership boundaries. It governs organization only, not product behavior or visual redesign, and rejects catch-all shared folders and abstraction theater.

## Repository Map

`src/background/`
: Runtime authority, timer/session orchestration, deterministic background helpers.

`src/pages/background/`
: Chrome service-worker entry point and browser-event/message wiring.

`src/pages/popup/`
: Popup controller hook, popup React components, popup-local helpers and tests.

`src/pages/options/`
: Options UI and tests.

`src/shared/`
: Framework-neutral practice domain models, reconciliation, and IndexedDB persistence.

`src/utils/`
: Narrow cross-surface infrastructure such as chromeRPC.

`src/test/`
: Reusable test infrastructure and Chrome API mocks.

`stories/`
: Ladle development stories.

`public/`
: Static extension assets and browser-loaded non-module files.

`scripts/`
: Repository maintenance and build-verification programs.

## Start Workflow

Before organizing code:

1. Read `AGENTS.md`.
2. Read `package.json`.
3. Inspect the source owner and its direct callers/importers.
4. Inspect nearby tests.
5. Consult `duplicates` when the task is driven by clone findings.
6. Consult `validating-features` for proportionate verification.

## Ownership Hierarchy

Use this order:

1. Same function/component/file.
2. Same page or runtime surface.
3. Shared domain/persistence.
4. Narrow cross-surface infrastructure.
5. New shared abstraction only when multiple real owners require it.

Examples:

- Popup-only UI remains under `src/pages/popup/`.
- Background timer logic remains under `src/background/`.
- Browser event registration remains under `src/pages/background/`.
- Practice-state reconciliation belongs under `src/shared/`.
- Chrome messaging belongs in `src/utils/chromeRPC.ts` or another narrowly named transport module.
- Reusable test setup belongs in `src/test/`.

Reject vague new files such as `utils.ts`, `helpers.ts`, `common.ts`, `shared.ts`, `misc.ts`, or `manager.ts` unless an existing, narrowly scoped owner already uses the name and the new declaration truly belongs there.

## Naming Rules

Preserve current conventions:

- PascalCase React component files such as `SessionWorkspace.tsx` and `TaskEditorDialog.tsx`.
- `useCamelCase.ts` hook files such as `usePracticeSession.ts`.
- camelCase TypeScript modules where already established, such as `sessionManager.ts`, `timerRuntime.ts`, and `chromeRPC.ts`.
- `*.test.ts` and `*.test.tsx` tests.
- `__tests__/` beside the source surface.
- Clear behavior/domain names.

Do not perform mass filename normalization merely to impose another repository's naming style.

## React Organization

- A page-local component stays with its page.
- A component with independent behavior, focus/accessibility logic, or focused tests earns its own file.
- Repeated JSX does not automatically earn a shared component.
- Shared UI is justified when interaction and accessibility contracts are the same.
- Keep controller/orchestration separate from presentational components when that separation clarifies state ownership.
- Avoid configurable mega-components with mode flags and closure forests.

## Background Organization

Preserve:

- `sessionManager` as runtime authority.
- Deterministic transitions in focused pure modules.
- Persisted timer runtime logic in its focused module.
- Chrome event/message wiring outside domain logic.
- No popup-owned duplicate runtime authority.

Extract only when the new owner has one clear responsibility.

## Shared-Code Rule

`src/shared/` is not a junk drawer.

Place code there only when it is:

- independent of React presentation;
- independent of one page;
- a durable practice-domain or persistence contract;
- needed by multiple real owners.

Two structurally identical types may remain separate when they represent independently evolving contracts.

## Test Placement

- Keep background tests under `src/background/__tests__/`.
- Keep background entry tests under `src/pages/background/__tests__/`.
- Keep popup tests under `src/pages/popup/__tests__/`.
- Keep options tests under `src/pages/options/__tests__/`.
- Keep shared tests under `src/shared/__tests__/`.
- Keep utility tests under the owning utility area.
- Keep reusable mocks under `src/test/`.

Do not move production code to make tests easier.

## Import Hygiene

After moving/extracting code:

- Update every import.
- Preserve current TypeScript aliases.
- Do not deep-import another surface's private implementation.
- Remove dead exports and compatibility aliases when no longer needed.
- Check circular dependencies.
- Do not create a giant root barrel.

## Component/Module Size

Use size as an inspection prompt, not an automatic split:

- Around 250 non-empty lines: inspect for a natural owner boundary.
- Around 350 non-empty lines: require a clear reason to remain monolithic.

Split earlier for:

- duplicated behavior;
- independent state ownership;
- accessibility/focus behavior;
- deterministic logic suitable for focused tests.

Do not split static markup into tiny files with no independent meaning.

## Output Contract

Report:

1. Files created, moved, removed, or renamed.
2. Ownership rationale.
3. Imports updated.
4. Tests/validation run.
5. Remaining organization issues deliberately left alone.

## Related Skills

- duplicates
- validating-features
