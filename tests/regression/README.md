# Regression Tests

Use this directory for tests created from real failures.

## Rule
For every serious bug fix, add at least one regression test that would fail before the fix.

## Naming
- Prefer behavior-first names:
  - `autosave-hash-verification.spec.ts`
  - `submission-immutability.spec.ts`
  - `reading-highlight-boundary.spec.ts`

## Scope
- Keep tests close to the owning module when practical.
- Place cross-module or historical incident tests here.

## Minimum Metadata in Test Description
- Scenario.
- Invariant being protected.
- Why the previous bug happened.
