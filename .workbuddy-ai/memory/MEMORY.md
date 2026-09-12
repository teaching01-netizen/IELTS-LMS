# Project Memory — remix_-ielts-proctoring-system

## Conventions

### Plan trees live in `plans/`
Two layouts are in use; prefer **nested** (`plans/<initiative>/overall-plan.md` + `phase-NN-<slug>.md`)
once more than one initiative exists, so `phase-01` is never ambiguous.

- Nested: `plans/authoring-read-perf/` — read-path performance initiative (overall + phase-01..05).
- Flat: `plans/` — UI design-system initiative (overall + phase-01..05, with 04a/04b parallel split).
  Verification evidence is kept in a separate `phase-05-verification-log.md`, apart from the plan.

Phase docs in this repo follow a 12–14 section template (Objective, Dependencies, Behavioral contract,
Acceptance linkage, Design decisions, Detailed TODOs, File-by-file plan, Error/edge matrix,
Test strategy, Observability, Rollout/rollback, Definition of done). Acceptance scenarios are frozen
as `AT-01…AT-07` in phase 01 and referenced by ID in later phases.

The `ai-planning-workflow` skill (`~/.workbuddy-ai/skills/`) encodes this workflow and can scaffold
new plan trees with `scripts/scaffold_plan_tree.py`.

## Stack notes

- Backend: Go (`backend/go/`), chi router, MySQL, `api/openapi/openapi.yaml` as the contract source.
- Frontend: React + TypeScript (`src/`), Vite build (`dist/`).
- Tests: Playwright (`playwright*.config.ts`), k6 load scripts (`k6/`), e2e (`e2e/`).
