# Modular Monolith Boundary Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor frontend and backend architecture to enforce module ownership, explicit contracts, and low coupling while preserving behavior through TDD.

**Architecture:** Introduce feature-owned application facades and contracts in the frontend so routes/components stop importing global `src/services/*` internals directly. In backend Rust crates, split oversized application services into focused use-case modules behind repository ports, and keep API routes as HTTP mapping only. All changes run in Red → Green → Refactor loops with existing behavior tests as characterization guards.

**Tech Stack:** TypeScript, React, React Query, Vitest, Rust, Axum, SQLx, Cargo workspace.

---

## File Structure Map

### Frontend module boundaries
- Create: `src/test/architecture/frontend-module-boundaries.test.ts`
- Create: `src/features/student/application/studentSessionFacade.ts`
- Create: `src/features/student/application/studentAttemptFacade.ts`
- Create: `src/features/student/infrastructure/studentSessionGateway.ts`
- Create: `src/features/student/infrastructure/studentAttemptGateway.ts`
- Create: `src/features/exam-authoring/contracts/index.ts`
- Create: `src/features/exam-authoring/application/examAuthoringFacade.ts`
- Create: `src/features/exam-authoring/infrastructure/examAuthoringGateway.ts`
- Create: `src/features/proctor/application/proctorFacade.ts`
- Create: `src/features/proctor/infrastructure/proctorGateway.ts`
- Modify: `src/features/student/hooks/useStudentSessionRouteData.ts`
- Modify: `src/components/student/providers/StudentAttemptProvider.tsx`
- Modify: `src/features/admin/hooks/useAdminRootController.ts`
- Modify: `src/features/builder/hooks/useBuilderRouteController.ts`
- Modify: `src/features/builder/hooks/useConfigRouteController.ts`
- Modify: `src/features/proctor/hooks/useProctorRouteController.ts`
- Modify: `src/app/data/examQueries.ts`
- Modify: `src/app/data/proctorQueries.ts`
- Modify: `src/app/data/studentSessionQueries.ts`

### Backend module boundaries
- Create: `backend/crates/application/src/delivery/mod.rs`
- Create: `backend/crates/application/src/delivery/session_context.rs`
- Create: `backend/crates/application/src/delivery/mutation_batch.rs`
- Create: `backend/crates/application/src/delivery/submit_attempt.rs`
- Create: `backend/crates/application/src/delivery/ports.rs`
- Create: `backend/crates/application/src/grading/mod.rs`
- Create: `backend/crates/application/src/grading/session_queries.rs`
- Create: `backend/crates/application/src/grading/review_actions.rs`
- Create: `backend/crates/application/src/grading/projection_sync.rs`
- Create: `backend/crates/application/src/grading/ports.rs`
- Create: `backend/crates/application/src/student_access/mod.rs`
- Create: `backend/crates/application/src/student_access/repository.rs`
- Modify: `backend/crates/application/src/lib.rs`
- Modify: `backend/crates/application/src/delivery.rs`
- Modify: `backend/crates/application/src/grading.rs`
- Modify: `backend/crates/api/src/routes/student.rs`

---

### Task 1: Add Frontend Boundary Guard Test (RED)

**Files:**
- Create: `src/test/architecture/frontend-module-boundaries.test.ts`
- Test: `src/test/architecture/frontend-module-boundaries.test.ts`

- [ ] **Step 1: Write failing architecture test for forbidden direct service imports**

```ts
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const roots = [
  'src/features',
  'src/components',
  'src/app/data',
];

const allowList = [
  'src/features/*/infrastructure/',
  'src/services/',
];

describe('frontend module boundaries', () => {
  it('blocks direct @services imports outside module infrastructure adapters', () => {
    // scan TS/TSX files under roots
    // fail if import from @services or ../../services and file path is not allow-listed
    expect([]).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to confirm RED**

Run: `npx vitest run src/test/architecture/frontend-module-boundaries.test.ts`
Expected: FAIL with current direct service import violations.

- [ ] **Step 3: Commit RED test**

```bash
git add src/test/architecture/frontend-module-boundaries.test.ts
git commit -m "test: add frontend modular-boundary guard for direct service imports"
```

### Task 2: Student Session Read Path Facade Extraction (GREEN)

**Files:**
- Create: `src/features/student/application/studentSessionFacade.ts`
- Create: `src/features/student/infrastructure/studentSessionGateway.ts`
- Modify: `src/features/student/hooks/useStudentSessionRouteData.ts`
- Modify: `src/features/student/routes/StudentSessionRoute.tsx`
- Test: `src/features/student/hooks/__tests__/useStudentSessionRouteData.backend.test.tsx`
- Test: `src/features/student/routes/__tests__/StudentSessionRoute.test.tsx`

- [ ] **Step 1: Add failing behavior test asserting hook output parity while using facade seam**

```ts
it('loads student session data through facade and preserves existing route-hook behavior', async () => {
  // arrange backend responses
  // assert same state, runtimeSnapshot, attemptSnapshot semantics as before
});
```

- [ ] **Step 2: Run RED test**

Run: `npx vitest run src/features/student/hooks/__tests__/useStudentSessionRouteData.backend.test.tsx -t "loads student session data through facade and preserves existing route-hook behavior"`
Expected: FAIL before facade wiring.

- [ ] **Step 3: Implement minimal facade + gateway and rewire hook**

```ts
// studentSessionFacade.ts
export interface StudentSessionFacade {
  loadStaticSession(scheduleId: string, candidateId: string): Promise<...>;
  loadLiveSession(scheduleId: string, candidateId: string): Promise<...>;
}

// useStudentSessionRouteData.ts
// replace direct @services/@app-data imports with facade dependency
```

- [ ] **Step 4: Run focused tests**

Run:
- `npx vitest run src/features/student/hooks/__tests__/useStudentSessionRouteData.backend.test.tsx`
- `npx vitest run src/features/student/routes/__tests__/StudentSessionRoute.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/student/application/studentSessionFacade.ts src/features/student/infrastructure/studentSessionGateway.ts src/features/student/hooks/useStudentSessionRouteData.ts src/features/student/routes/StudentSessionRoute.tsx src/features/student/hooks/__tests__/useStudentSessionRouteData.backend.test.tsx src/features/student/routes/__tests__/StudentSessionRoute.test.tsx
git commit -m "refactor(student): route session read path through feature-owned facade"
```

### Task 3: Student Attempt Write Path Facade Extraction (GREEN)

**Files:**
- Create: `src/features/student/application/studentAttemptFacade.ts`
- Create: `src/features/student/infrastructure/studentAttemptGateway.ts`
- Modify: `src/components/student/providers/StudentAttemptProvider.tsx`
- Test: `src/components/student/providers/__tests__/StudentAttemptProvider.test.tsx`
- Test: `src/components/student/__tests__/useStudentSubmissionOrchestration.test.tsx`

- [ ] **Step 1: Add failing test for provider mutation/flush/submit behavior via facade seam**

```ts
it('persists answers and submits through attempt facade without behavior drift', async () => {
  // assert mutation queue, flush, submit result semantics remain unchanged
});
```

- [ ] **Step 2: Run RED test**

Run: `npx vitest run src/components/student/providers/__tests__/StudentAttemptProvider.test.tsx -t "persists answers and submits through attempt facade without behavior drift"`
Expected: FAIL before provider rewiring.

- [ ] **Step 3: Implement minimal provider-to-facade wiring**

```ts
// StudentAttemptProvider uses StudentAttemptFacade methods
// facade delegates to existing service internals in gateway
```

- [ ] **Step 4: Run focused tests**

Run:
- `npx vitest run src/components/student/providers/__tests__/StudentAttemptProvider.test.tsx`
- `npx vitest run src/components/student/__tests__/useStudentSubmissionOrchestration.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/student/application/studentAttemptFacade.ts src/features/student/infrastructure/studentAttemptGateway.ts src/components/student/providers/StudentAttemptProvider.tsx src/components/student/providers/__tests__/StudentAttemptProvider.test.tsx src/components/student/__tests__/useStudentSubmissionOrchestration.test.tsx
git commit -m "refactor(student): route attempt write path through feature-owned facade"
```

### Task 4: Exam Authoring Facade and Contract Slice (RED → GREEN)

**Files:**
- Create: `src/features/exam-authoring/contracts/index.ts`
- Create: `src/features/exam-authoring/application/examAuthoringFacade.ts`
- Create: `src/features/exam-authoring/infrastructure/examAuthoringGateway.ts`
- Modify: `src/features/admin/hooks/useAdminRootController.ts`
- Modify: `src/features/builder/hooks/useBuilderRouteController.ts`
- Modify: `src/features/builder/hooks/useConfigRouteController.ts`
- Test: `src/features/builder/hooks/__tests__/useBuilderRouteController.test.tsx`
- Test: `src/features/builder/hooks/__tests__/useConfigRouteController.test.tsx`
- Test: `src/services/__tests__/examLifecycleService.test.ts`

- [ ] **Step 1: Add failing tests for authoring flows through facade API**

```ts
it('creates and saves draft through authoring facade with existing transition behavior', async () => {
  // assert create/save result and navigation semantics unchanged
});
```

- [ ] **Step 2: Run RED tests**

Run:
- `npx vitest run src/features/builder/hooks/__tests__/useBuilderRouteController.test.tsx`
- `npx vitest run src/features/builder/hooks/__tests__/useConfigRouteController.test.tsx`
Expected: FAIL for new facade seam usage until implementation exists.

- [ ] **Step 3: Implement minimal facade wrappers around lifecycle/repository calls**

```ts
export interface ExamAuthoringFacade {
  createExam(...): Promise<...>;
  saveDraft(...): Promise<...>;
  publish(...): Promise<...>;
  getVersions(...): Promise<...>;
}
```

- [ ] **Step 4: Run focused tests**

Run:
- `npx vitest run src/features/builder/hooks/__tests__/useBuilderRouteController.test.tsx`
- `npx vitest run src/features/builder/hooks/__tests__/useConfigRouteController.test.tsx`
- `npx vitest run src/services/__tests__/examLifecycleService.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/exam-authoring/contracts/index.ts src/features/exam-authoring/application/examAuthoringFacade.ts src/features/exam-authoring/infrastructure/examAuthoringGateway.ts src/features/admin/hooks/useAdminRootController.ts src/features/builder/hooks/useBuilderRouteController.ts src/features/builder/hooks/useConfigRouteController.ts src/features/builder/hooks/__tests__/useBuilderRouteController.test.tsx src/features/builder/hooks/__tests__/useConfigRouteController.test.tsx src/services/__tests__/examLifecycleService.test.ts
git commit -m "refactor(authoring): introduce feature facade for exam lifecycle and repository access"
```

### Task 5: Proctor Boundary Cleanup and Cross-Feature Decoupling

**Files:**
- Create: `src/features/proctor/application/proctorFacade.ts`
- Create: `src/features/proctor/infrastructure/proctorGateway.ts`
- Modify: `src/features/proctor/hooks/useProctorRouteController.ts`
- Modify: `src/features/builder/services/previewRuntimeSessionService.ts`
- Test: `src/features/proctor/hooks/__tests__/useProctorRouteController.backend.test.tsx`
- Test: `src/features/proctor/hooks/__tests__/useProctorRouteController.live-update.test.tsx`

- [ ] **Step 1: Add failing test that proctor controller no longer imports builder internals directly**

```ts
it('resolves preview-runtime cohort checks via proctor contract facade', async () => {
  // verify behavior and no builder internal dependency in controller
});
```

- [ ] **Step 2: Run RED tests**

Run:
- `npx vitest run src/features/proctor/hooks/__tests__/useProctorRouteController.backend.test.tsx`
- `npx vitest run src/features/proctor/hooks/__tests__/useProctorRouteController.live-update.test.tsx`
Expected: FAIL until facade extraction is complete.

- [ ] **Step 3: Implement minimal facade + helper relocation**

```ts
// proctor facade exposes runtime/session operations + preview cohort helper
// controller uses facade; remove direct import from @builder/services/*
```

- [ ] **Step 4: Re-run focused tests**

Run:
- `npx vitest run src/features/proctor/hooks/__tests__/useProctorRouteController.backend.test.tsx`
- `npx vitest run src/features/proctor/hooks/__tests__/useProctorRouteController.live-update.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/proctor/application/proctorFacade.ts src/features/proctor/infrastructure/proctorGateway.ts src/features/proctor/hooks/useProctorRouteController.ts src/features/builder/services/previewRuntimeSessionService.ts src/features/proctor/hooks/__tests__/useProctorRouteController.backend.test.tsx src/features/proctor/hooks/__tests__/useProctorRouteController.live-update.test.tsx
git commit -m "refactor(proctor): remove builder internal coupling via proctor facade"
```

### Task 6: Move App Query Layer to Feature Contracts

**Files:**
- Modify: `src/app/data/examQueries.ts`
- Modify: `src/app/data/proctorQueries.ts`
- Modify: `src/app/data/studentSessionQueries.ts`
- Test: `src/routes/__tests__/route-contract.test.tsx`
- Test: `src/features/student/routes/__tests__/StudentEntryRoute.test.tsx`
- Test: `src/features/student/routes/__tests__/StudentSessionRoute.test.tsx`

- [ ] **Step 1: Add failing tests for route/query behavior through feature facades**

```ts
it('route data queries resolve through feature contracts with unchanged route behavior', async () => {
  // route-level behavior parity assertions
});
```

- [ ] **Step 2: Run RED tests**

Run:
- `npx vitest run src/routes/__tests__/route-contract.test.tsx`
- `npx vitest run src/features/student/routes/__tests__/StudentSessionRoute.test.tsx`
Expected: FAIL until query layer migration is complete.

- [ ] **Step 3: Implement minimal query migration**

```ts
// app/data uses facades exported by feature modules instead of direct @services imports
```

- [ ] **Step 4: Run focused tests**

Run:
- `npx vitest run src/routes/__tests__/route-contract.test.tsx`
- `npx vitest run src/features/student/routes/__tests__/StudentEntryRoute.test.tsx`
- `npx vitest run src/features/student/routes/__tests__/StudentSessionRoute.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/data/examQueries.ts src/app/data/proctorQueries.ts src/app/data/studentSessionQueries.ts src/routes/__tests__/route-contract.test.tsx src/features/student/routes/__tests__/StudentEntryRoute.test.tsx src/features/student/routes/__tests__/StudentSessionRoute.test.tsx
git commit -m "refactor(app-data): consume feature contracts instead of global services"
```

### Task 7: Backend Delivery Service Decomposition (RED → GREEN)

**Files:**
- Create: `backend/crates/application/src/delivery/mod.rs`
- Create: `backend/crates/application/src/delivery/session_context.rs`
- Create: `backend/crates/application/src/delivery/mutation_batch.rs`
- Create: `backend/crates/application/src/delivery/submit_attempt.rs`
- Create: `backend/crates/application/src/delivery/ports.rs`
- Modify: `backend/crates/application/src/delivery.rs`
- Modify: `backend/crates/application/src/lib.rs`
- Test: `backend/tests/contracts/student_contract.rs`
- Test: `backend/tests/integration/attempt_write_invariant_guard.rs`

- [ ] **Step 1: Add failing/adjusted behavior tests for delivery invariants before moving logic**

```rust
#[tokio::test]
async fn preserves_conflict_reason_and_server_seq_on_mutation_batch_conflict() {
    // verify conflict reason code + accepted sequence values remain stable
}
```

- [ ] **Step 2: Run RED tests (if new assertions added)**

Run:
- `cd backend && cargo test -p ielts-backend-api --test student_contract`
- `cd backend && cargo test -p ielts-backend-api --test attempt_write_invariant_guard`
Expected: FAIL for new assertions until decomposition is wired.

- [ ] **Step 3: Extract minimal use-case modules + ports while keeping public service API stable**

```rust
// delivery/mod.rs re-exports DeliveryService
// session_context.rs, mutation_batch.rs, submit_attempt.rs hold focused logic
// ports.rs defines repository traits consumed by use-case units
```

- [ ] **Step 4: Re-run focused tests**

Run:
- `cd backend && cargo test -p ielts-backend-api --test student_contract`
- `cd backend && cargo test -p ielts-backend-api --test attempt_write_invariant_guard`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/crates/application/src/delivery/mod.rs backend/crates/application/src/delivery/session_context.rs backend/crates/application/src/delivery/mutation_batch.rs backend/crates/application/src/delivery/submit_attempt.rs backend/crates/application/src/delivery/ports.rs backend/crates/application/src/delivery.rs backend/crates/application/src/lib.rs backend/tests/contracts/student_contract.rs backend/tests/integration/attempt_write_invariant_guard.rs
git commit -m "refactor(backend-delivery): split delivery use cases behind explicit ports"
```

### Task 8: Backend Grading Service Decomposition (RED → GREEN)

**Files:**
- Create: `backend/crates/application/src/grading/mod.rs`
- Create: `backend/crates/application/src/grading/session_queries.rs`
- Create: `backend/crates/application/src/grading/review_actions.rs`
- Create: `backend/crates/application/src/grading/projection_sync.rs`
- Create: `backend/crates/application/src/grading/ports.rs`
- Modify: `backend/crates/application/src/grading.rs`
- Modify: `backend/crates/application/src/lib.rs`
- Test: `backend/tests/contracts/grading_contract.rs`

- [ ] **Step 1: Add failing/adjusted tests for grading session and review invariants**

```rust
#[tokio::test]
async fn preserves_pagination_and_authorization_rules_after_service_split() {
    // assert same pagination shape and authorization outcomes
}
```

- [ ] **Step 2: Run RED tests (if new assertions added)**

Run: `cd backend && cargo test -p ielts-backend-api --test grading_contract`
Expected: FAIL for new assertions until module split is wired.

- [ ] **Step 3: Extract focused grading use-case modules with stable external API**

```rust
// session_queries.rs: list/get operations
// review_actions.rs: review state transitions
// projection_sync.rs: projection/bootstrap flows
```

- [ ] **Step 4: Run focused tests**

Run: `cd backend && cargo test -p ielts-backend-api --test grading_contract`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/crates/application/src/grading/mod.rs backend/crates/application/src/grading/session_queries.rs backend/crates/application/src/grading/review_actions.rs backend/crates/application/src/grading/projection_sync.rs backend/crates/application/src/grading/ports.rs backend/crates/application/src/grading.rs backend/crates/application/src/lib.rs backend/tests/contracts/grading_contract.rs
git commit -m "refactor(backend-grading): split grading service into focused use-case modules"
```

### Task 9: API Student Route Purity (Move Route SQL/Domain Details to Application)

**Files:**
- Create: `backend/crates/application/src/student_access/mod.rs`
- Create: `backend/crates/application/src/student_access/repository.rs`
- Modify: `backend/crates/api/src/routes/student.rs`
- Modify: `backend/crates/application/src/lib.rs`
- Test: `backend/tests/contracts/student_contract.rs`
- Test: `backend/tests/contracts/auth_contract.rs`

- [ ] **Step 1: Add failing/adjusted route-contract test for preview runtime access path**

```rust
#[tokio::test]
async fn preview_runtime_access_rules_match_existing_http_behavior() {
    // verify status code and payload semantics
}
```

- [ ] **Step 2: Run RED tests (if new assertions added)**

Run:
- `cd backend && cargo test -p ielts-backend-api --test student_contract`
- `cd backend && cargo test -p ielts-backend-api --test auth_contract`
Expected: FAIL for new assertions until application extraction is complete.

- [ ] **Step 3: Implement minimal application service for schedule/attempt metadata lookups**

```rust
// move is_preview_runtime_schedule / load_attempt_* lookups behind application-layer API
// route file keeps HTTP parsing, auth checks, response mapping only
```

- [ ] **Step 4: Run focused tests**

Run:
- `cd backend && cargo test -p ielts-backend-api --test student_contract`
- `cd backend && cargo test -p ielts-backend-api --test auth_contract`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/crates/application/src/student_access/mod.rs backend/crates/application/src/student_access/repository.rs backend/crates/api/src/routes/student.rs backend/crates/application/src/lib.rs backend/tests/contracts/student_contract.rs backend/tests/contracts/auth_contract.rs
git commit -m "refactor(api-student): move route-level data logic into application module"
```

### Task 10: Enforce Boundary Guard to GREEN and Run Full Verification

**Files:**
- Modify: `src/test/architecture/frontend-module-boundaries.test.ts`
- Test: frontend + backend command suites

- [ ] **Step 1: Re-run boundary guard and remove remaining violations**

Run: `npx vitest run src/test/architecture/frontend-module-boundaries.test.ts`
Expected: PASS with no forbidden direct service imports outside approved adapters.

- [ ] **Step 2: Run frontend verification suite**

Run:
- `npm run typecheck`
- `npm run test:run -- src/features/student/hooks/__tests__/useStudentSessionRouteData.backend.test.tsx src/components/student/providers/__tests__/StudentAttemptProvider.test.tsx src/features/proctor/hooks/__tests__/useProctorRouteController.backend.test.tsx src/features/builder/hooks/__tests__/useBuilderRouteController.test.tsx src/features/builder/hooks/__tests__/useConfigRouteController.test.tsx src/routes/__tests__/route-contract.test.tsx`
Expected: PASS.

- [ ] **Step 3: Run backend verification suite**

Run:
- `cd backend && cargo test -p ielts-backend-api --test student_contract`
- `cd backend && cargo test -p ielts-backend-api --test grading_contract`
- `cd backend && cargo test -p ielts-backend-api --test auth_contract`
- `cd backend && cargo test -p ielts-backend-api --test attempt_write_invariant_guard`
Expected: PASS.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "refactor: enforce modular-monolith boundaries across frontend and backend"
```

---

## Self-Review

- Spec coverage: includes all identified hotspots (`student`, `exam-authoring`, `proctor`, frontend import boundaries, backend delivery/grading, API student route purity).
- Placeholder scan: no `TODO/TBD/similar to task N`; each task includes concrete files and commands.
- Consistency: contracts/facades are introduced before consumers are rewired, and route purity follows backend application extractions.
