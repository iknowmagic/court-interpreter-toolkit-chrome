---
name: validating-features
description: Use after modifying Court Interpreter Toolkit TypeScript, React, Chrome-extension runtime behavior, tests, build configuration, manifests, or development tooling. Chooses proportionate Vitest, Testing Library, type-check, lint, coverage, Chrome build verification, Ladle, and manual browser validation. Trigger for validation, tests, coverage, pnpm check, browser smoke tests, or proving a change works.
---

# Validating Court Interpreter Toolkit Features

Use this skill to prove behavior through the narrowest adequate boundary. It distinguishes lint/type/build validation from behavior tests, avoids ceremonial full-suite and screenshot work, and never claims browser behavior from unit tests alone.

## Installed Stack

- `pnpm`
- ESLint
- TypeScript
- Vitest
- V8 coverage
- Testing Library
- jsdom
- fake-indexeddb
- Chrome API mock
- Vite/CRX build
- Ladle
- `scripts/verify-chrome-build.mjs`

## Proportional Validation Ladder

### Pure Helper or Small Local Extraction

Run:

```bash
pnpm lint
pnpm typecheck
pnpm exec vitest run <focused-test-file>
pnpm exec vitest run <focused-test-file> <another-focused-test-file>
git diff --check
```

### React Component or Controller Behavior

Run:

```bash
pnpm exec vitest run <focused-test-file>
pnpm exec vitest run <focused-test-file> <another-focused-test-file>
pnpm lint
pnpm typecheck
```

Use Testing Library and behavior assertions. Use `act`, fake timers, and controlled promises for asynchronous behavior. Do not use arbitrary sleeps.

### Background Runtime, Persistence, RPC, or Shared Contracts

Run affected tests first, then:

```bash
pnpm test
pnpm coverage
pnpm lint
pnpm typecheck
```

Use the reusable Chrome mock and fake IndexedDB where appropriate.

### Manifest, Vite, Packaging, or Development/Production Build Behavior

Run:

```bash
pnpm check:build
```

This must verify the production Chrome artifact.

### Ladle Story Changes

Run:

```bash
pnpm ladle:build
```

### Broad Cross-Cutting or Final Pre-PR Validation

Run:

```bash
pnpm check
```

`pnpm check` already includes:

- lint
- typecheck
- coverage
- exact duplicate detection
- production build verification

Do not run the same full suite multiple times without a reason.

## Manual Chrome Boundary

Require manual Chrome validation only for behavior that automated tests/build inspection cannot prove, including:

- real service-worker suspension/restart;
- toolbar badge/title rendering;
- context-menu behavior;
- offscreen completion audio;
- popup focus/portal behavior;
- development and production extension coexistence;
- actual unpacked-extension loading.

Do not claim these passed when Chrome was not used.

## Test Quality Rules

Require:

- tests fail for the behavior they protect;
- no weakened assertions merely to pass;
- no global suppression of `console.error`;
- expected errors are locally spied on and asserted;
- no React `act(...)` warnings;
- no `.only` or `.skip` in final source;
- no snapshot as the main proof of interactive behavior;
- deterministic time through Vitest fake timers and `vi.setSystemTime`;
- race tests use controlled deferred promises.

## Coverage Rules

- Current enforced thresholds are authoritative in `vitest.config.ts`.
- Do not exclude difficult production files to improve numbers.
- Do not add tests that only execute lines without asserting behavior.
- Run `pnpm coverage` when changed behavior affects coverage-sensitive production source.
- Duplicate tooling is advisory and is not a substitute for tests.

## Failure Diagnosis

When validation fails:

1. Capture the first useful error.
2. Classify it as implementation, test, environment, or outdated assumption.
3. Fix only the true cause within assigned scope.
4. Do not increase timeouts, suppress logs globally, or alter product behavior to satisfy a test.
5. Report commands not run and why.

## Generated Artifacts

Confirm these stay ignored/untracked:

```text
coverage/
dist_chrome/
build/
tmp/
```

## Output Contract

Report:

1. Exact commands run.
2. Result for each.
3. Focused tests added/changed.
4. Manual Chrome checks performed or not performed.
5. Failures and diagnosis.
6. Validation intentionally omitted and why.

## Related Skills

- organizing-code
- duplicates
