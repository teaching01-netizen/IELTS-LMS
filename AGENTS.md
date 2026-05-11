# Codebase Guide for AI Agents

## System Type
This repository is a modularizing monolith for an online exam platform.

## Mission
Do not only patch code. Improve the repository's memory so future changes are safer.

## Main Rule
Never change behavior before identifying the owning module and invariants.

## Required Development Loop
1. Map ownership and boundaries.
2. Reproduce with a focused test or script.
3. Implement the smallest safe change.
4. Verify with relevant tests/checks.
5. Add memory artifact (test/doc/script/log policy).
6. Compress if local complexity is growing.

## Dependency Rules
- Prefer module-local changes over cross-cutting edits.
- Do not import another module's internal files.
- Expose inter-module behavior via explicit public interfaces.
- Keep dependency direction one-way where possible:
  - `ui -> application -> domain`
  - `infrastructure` implements domain/application interfaces.

## Critical Invariants
- Submitted exam answers are immutable.
- Autosave must be idempotent.
- Student-visible "saved/verified" state must match persisted reality.
- Timer fairness must not be bypassed by reload/refresh.
- Integrity and audit events must be append-only and traceable.

## Dangerous Areas
- Exam submission and autosave flows.
- Session recovery/reconnect behavior.
- Grading mutation and publication workflows.
- Permission/role boundary checks.
- Payment confirmation and retries.

## Mandatory Before/After Checklist
Before editing:
1. Read module docs and relevant tests.
2. Identify "must not break" behavior.
3. Add or update failing characterization test when behavior is unclear.

After editing:
1. Run targeted tests and report results.
2. Add or update at least one memory artifact:
   - regression test
   - failure-case note
   - diagnostic script
   - architecture decision note
3. If behavior changed, update module docs.

## Compression Rule
If 3+ tactical patches accumulate in one area, stop patching and propose a local abstraction/refactor.
