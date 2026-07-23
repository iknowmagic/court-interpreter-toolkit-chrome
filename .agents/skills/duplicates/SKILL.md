---
name: duplicates
description: Use when reviewing or reducing duplicated Court Interpreter Toolkit TypeScript or React code reported by pnpm duplicates. Covers exact jscpd clones and structural similarity findings across background runtime, popup, options, shared code, utilities, and tests while preserving behavior and choosing ownership deliberately. Trigger for duplicate code, dedupe, jscpd, similarity-ts, repeated React structures, repeated TypeScript logic, or shared extraction.
---

# Duplicates: Court Interpreter Toolkit

Use this skill to review exact and structural duplicate candidates, reduce duplication in small verified families, preserve behavior and architecture, and reject forced abstraction.

Detector output is evidence, not an order to abstract.

## Shared Doctrine

1. Exact token clones do not prove shared semantics.
2. Structural similarity does not prove shared ownership.
3. Compare inputs, outputs, state ownership, errors, timing, browser side effects, accessibility, and tests before extraction.
4. Preserve product behavior.
5. Work one related clone family at a time.
6. Rerun detection and proportionate validation after each family.
7. Intentional duplicates and false positives may remain.
8. Never deform code merely to reach zero findings.
9. Prefer the smallest behaviorally complete extracted declaration.
10. Use a clear domain-and-behavior name.

## Start Workflow

Run:

```bash
git status --short
pnpm duplicates
ls -t ./tmp/duplicates-*.txt | head -1
```

Then:

1. Read the newest report.
2. Inspect every referenced file and line range.
3. Read `AGENTS.md`.
4. Consult `organizing-code`.
5. Consult `validating-features`.
6. Classify the candidate before editing.

Do not touch unrelated files or clean the entire report in one giant refactor.

## Report Explanation

```text
pnpm duplicates
  -> scripts/duplicates-report.py
  -> pnpm detect-duplicates (jscpd exact token clones)
  -> pnpm similarity (similarity-ts structural similarity)
  -> tmp/duplicates-<timestamp>.txt
```

The report contains:

```text
Exact duplicates
Structural similarity
```

The command can succeed while findings exist. Findings require review.

If `similarity-ts` is missing, install it so the executable exists at:

```text
$HOME/.cargo/bin/similarity-ts
```

and ensure that directory is on `PATH`.

## Clone Classification

Require one of:

- same file
- same popup surface
- same background/runtime surface
- same shared domain/persistence area
- cross-surface infrastructure
- React presentation
- type/contract shape
- test fixture/setup
- false positive or intentional repetition

## Same-File Rule

Extract the smallest behaviorally complete declaration, which may be:

- local function;
- hook helper;
- constant;
- type alias;
- private React subcomponent;
- deterministic transition helper.

Do not make one existing function call another merely because names are similar.

## Placement Hierarchy

Use:

1. same file;
2. same page/runtime folder;
3. `src/shared/` for framework-neutral domain/persistence behavior;
4. `src/utils/` for narrow cross-surface infrastructure;
5. a new focused area only when separate owners genuinely share the concern.

Do not create vague catch-alls.

## Extension-Specific Cautions

Preserve:

- `sessionManager` background runtime authority;
- persisted deadline semantics;
- single-flight timer materialization;
- retryable initialization;
- read-only history;
- popup/background RPC boundary;
- pause-before-mutation;
- IndexedDB behavior;
- Chrome storage keys and shapes;
- toolbar/context-menu side effects;
- alarm behavior;
- user-visible copy;
- focus and accessibility;
- test intent.

Do not extract matching code across popup and background when doing so would blur authority.

## React Duplication

- Extract props/types before UI when that clarifies a real common contract.
- Extract UI only when behavior, focus, disabled state, accessibility, and error placement are the same.
- Two visually similar fragments may remain local.
- Repeated behavior or accessibility wiring deserves earlier extraction.
- Do not create a generic component with many mode flags merely to silence a detector.

## Types and Contracts

Share types only when they describe the same durable contract and must evolve together.

Structurally identical message payloads, view models, storage records, and UI props may remain distinct if their responsibilities differ.

## Test Duplication

Tests are included in exact-clone detection but excluded from structural similarity by the package commands.

- Repeated test setup may be intentional for readability.
- Extract focused factories/builders only when semantics are genuinely shared.
- Do not make production APIs more generic for test convenience.
- Do not hide scenario differences behind an over-configurable test helper.
- Residual test clones may be reported as intentional.

## Required Dedupe Loop

For each assigned clone family:

```bash
pnpm lint
pnpm typecheck
pnpm test -- <focused-test-file>
pnpm duplicates
```

Use `pnpm check` only for a broad or final cross-cutting dedupe pass.

After rerunning, inspect the newest report. Do not assume a lower count means better architecture.

## Final Report Contract

Report:

1. Report file inspected.
2. Clone families changed.
3. Declarations extracted and owners.
4. Why placement is local, page-level, background-level, shared, or utility-level.
5. Focused validation commands/results.
6. Newest duplicate report path.
7. Remaining actionable findings.
8. Intentional duplicates/false positives.
9. Git status.

## Related Skills

- organizing-code
- validating-features
