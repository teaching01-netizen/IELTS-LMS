# Testing Patterns

**Analysis Date:** 2026-07-05

## Test Framework

**Frontend Unit/Integration:**
- Vitest `^2.0.0` — primary test runner for frontend
- Config: `vitest.config.ts` (jsdom environment, globals enabled)
- Setup file: `src/test/setup.ts` — imports `@testing-library/jest-dom/vitest`, runs `cleanup()` after each test, mocks `localStorage` and `scrollIntoView`

**E2E:**
- Playwright `^1.59.1` — end-to-end browser tests
- Config: `playwright.config.ts` (chromium/firefox/webkit projects, 1 worker, sequential)
- Prod smoke config: `playwright.prod-smoke.config.ts`
- Prod load config: `playwright.prod-load.config.ts` (sharding support, configurable workers/timeout)
- Global setup: `e2e/global-setup.ts` — runs `cargo run -p ielts-backend-api --bin e2e_seed` to seed test data, generates auth storage states

**Backend:**
- Built-in Rust `#[tokio::test]` framework — integration and contract tests
- Backend crates: `api`, `application`, `domain`, `infrastructure`, `worker`
- Test database: MySQL (TiDB) via `sqlx` with transaction rollback pattern

**Load Testing:**
- k6 `^1.x` — performance/load tests
- Scripts in `k6/` and `load-runner/k6/`
- Invoked via npm scripts: `k6:exam-day`, `k6:start-exam`, `k6:submit-storm`, etc.

**Storybook:**
- Storybook `^10.3.5` with `@storybook/react-vite` — visual component development
- Stories in `src/stories/` (Button, Dialog, Input, Select, Textarea, Toast, DataTable, Banner)

## Run Commands

```bash
npm test                    # vitest in watch mode
npm run test:run            # vitest single run
npm run test:ui             # vitest UI
npm run test:coverage       # vitest with coverage
npm run playwright          # playwright test (all projects)
npm run playwright:ui       # playwright UI mode
npm run playwright:debug    # playwright debug mode
npm run e2e:prod-smoke      # prod smoke tests
npm run e2e:prod-load       # prod load tests
npm run e2e:live-runner     # live multi-user runner
npm run test:live-runner    # vitest for prod-load unit tests
```

## Vitest Configuration

```typescript
// vitest.config.ts
{
  environment: 'jsdom',
  globals: true,                        // describe/it/expect globally available
  setupFiles: ['./src/test/setup.ts'],  // cleanup + mocks
  exclude: ['node_modules', 'dist', 'e2e'],
  resolve.alias: {
    '@': '.',
    '@app': './src/app',
    '@components': './src/components',
    '@services': './src/services',
    '@admin': './src/features/admin',
    '@builder': './src/features/builder',
    '@proctor': './src/features/proctor',
    '@student': './src/features/student',
    '@shared': './src/shared',
  },
}
```

## Test File Organization

**Frontend (177 test files total):**

All frontend tests live in `__tests__/` directories co-located with the code they test:

```
src/
├── app/
│   ├── __tests__/integration/errorHandling.integration.test.ts
│   ├── __tests__/performance/performanceMonitor.test.ts
│   ├── api/__tests__/apiClient.test.ts
│   ├── error/__tests__/errorTypes.test.ts
│   ├── hooks/__tests__/useLiveUpdates.test.ts
│   └── validation/__tests__/{schemas.session,validateApiResponse}.test.ts
├── components/
│   ├── __tests__/{Header.preview,Header.titleSync,QuestionBuilderPane,Workspace.readingEmpty}.test.tsx
│   ├── admin/__tests__/*.test.ts{,x}          (17 files)
│   ├── answer-history/__tests__/AnswerHistoryPage.test.tsx
│   ├── blocks/__tests__/*.test.tsx             (7 files)
│   ├── builder/__tests__/SubAnswerTreeEditor.test.tsx
│   ├── passage/__tests__/PassageListSidebar.test.tsx
│   ├── proctor/__tests__/*.test.ts{,x}         (2 files)
│   ├── student/__tests__/*.test.ts{,x}         (35+ files)
│   ├── student/highlight/__tests__/selectionObserver.test.ts
│   ├── student/providers/__tests__/*.test.tsx   (6 files)
│   ├── ui/__tests__/Dialog.test.tsx
│   ├── workspaces/__tests__/WritingWorkspace.test.tsx
│   └── writing/__tests__/WritingChartPreview.test.tsx
├── constants/__tests__/examDefaults.test.ts
├── features/
│   ├── admin/routes/__tests__/LibraryRoute.test.tsx
│   ├── auth/__tests__/*.test.tsx                (3 files)
│   ├── builder/components/__tests__/*.test.tsx  (4 files)
│   ├── builder/hooks/__tests__/*.test.tsx       (3 files)
│   ├── builder/routes/__tests__/*.test.tsx      (4 files)
│   ├── builder/services/__tests__/previewRuntimeSessionService.test.ts
│   ├── builder/utils/__tests__/*.test.ts        (2 files)
│   ├── proctor/hooks/__tests__/*.test.tsx       (3 files)
│   ├── student/__tests__/liveSnapshotFreshness.test.ts
│   ├── student/hooks/__tests__/*.test.ts{,x}    (2 files)
│   └── student/routes/__tests__/*.test.tsx      (2 files)
├── hooks/__tests__/useUndoRedo.test.tsx
├── routes/__tests__/route-contract.test.tsx
├── services/__tests__/*.test.ts                 (30+ files)
├── test/
│   ├── setup.ts
│   ├── architecture/frontend-module-boundaries.test.ts
│   └── developmentEnvironment.test.ts
└── utils/__tests__/*.test.ts                    (25+ files)
```

**E2E (34 spec files):**

```
e2e/
├── *.spec.ts                                     (27 spec files)
├── prod-load/
│   ├── 00-control-plane.spec.ts
│   ├── 05-student-entry-smoke.spec.ts
│   ├── 10-student-shard.spec.ts
│   └── live-multi-user-runner.unit.test.ts
├── prod-smoke/
│   └── grading-sessions.spec.ts
├── support/
│   ├── backendE2e.ts            (manifest reader, storage state paths)
│   ├── studentUi.ts             (student page helpers: screen stubs, cookie utils)
│   ├── prodBootstrap.ts
│   ├── prodData.ts
│   ├── prodOrchestration.ts
│   └── prodProgress.ts
├── global-setup.ts              (seeds test data via Rust binary)
└── TEST_STATUS.md               (known issues and selector mismatches)
```

**Backend (25 test files):**

```
backend/
├── tests/
│   ├── contracts/
│   │   ├── answer_history_contract.rs
│   │   ├── auth_contract.rs
│   │   ├── builder_contract.rs
│   │   ├── grading_contract.rs
│   │   ├── proctor_contract.rs
│   │   ├── scheduling_contract.rs
│   │   └── student_contract.rs
│   ├── integration/
│   │   ├── attempt_write_invariant_guard.rs
│   │   ├── exam_enum_decode.rs
│   │   ├── exam_lifecycle.rs
│   │   ├── grading_enum_decode.rs
│   │   ├── idempotency_smoke.rs
│   │   ├── mutation_replay.rs
│   │   ├── outbox_smoke.rs
│   │   ├── registration_flow.rs
│   │   ├── revision_tracking.rs
│   │   ├── rls_smoke.rs
│   │   └── submission_unanswered_policy.rs
│   ├── support/
│   │   ├── mod.rs              (with_test_tx, wait_for_outbox, test_id, cleanup_test_data)
│   │   ├── fixtures.rs         (MySQL fixture builders)
│   │   ├── mysql.rs
│   │   └── postgres.rs
│   └── frontend_static.rs
├── crates/worker/tests/
│   └── retention_smoke.rs
```

**k6 Load Tests:**

```
k6/
├── prod-exam-day.js
├── prod-start-exam-200.js
├── prod-section-transition-200.js
├── prod-submit-storm-200.js
├── prod-resume-100.js
├── prod-auto-submit-200.js
├── prod-load-helpers.js
└── README.md

load-runner/k6/               (duplicate/alternate load test scripts)
├── prod-transition-reconciliation-200.js
├── prod-start-exam-200.js
├── prod-load-helpers.js
├── prod-submit-storm-200.js
├── prod-resume-100.js
├── prod-section-transition-200.js
├── prod-exam-day.js
└── prod-auto-submit-200.js
```

## Test Structure

**Frontend unit test pattern:**

```typescript
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

describe('ComponentName', () => {
  it('does specific behavior', () => {
    render(<ComponentName {...props} />);
    expect(screen.getByText('expected')).toBeInTheDocument();
  });
});
```

**Backend contract test pattern:**

```rust
use axum::http::{Request, StatusCode};
use tower::ServiceExt;

#[tokio::test]
async fn endpoint_returns_expected_response() {
    let app = build_router(state);
    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/resource")
        .body(Body::empty())
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
}
```

**Backend integration test pattern (transaction rollback):**

```rust
#[tokio::test]
async fn lifecycle_test() {
    let pool = get_test_pool().await;
    with_test_tx(&pool, |tx| async move {
        // test logic using transactional connection
        // tx is rolled back automatically after test
    }).await;
}
```

## Mocking

**Frontend mocking patterns:**

```typescript
// Module mocking
vi.mock('@services/examRepository', () => ({
  getExam: vi.fn().mockResolvedValue(mockExam),
}));

// Component mocking
vi.mock('@components/SomeComponent', () => ({
  SomeComponent: () => <div data-testid="mock" />,
}));

// Hook mocking
vi.mock('./useCustomHook', () => ({
  useCustomHook: () => ({ data: mockData, isLoading: false }),
}));

// Timer mocking
vi.useFakeTimers();
vi.advanceTimersByTime(1000);

// DOM API mocking (in setup.ts)
Object.defineProperty(window, 'localStorage', { value: localStorageMock });
Object.defineProperty(Element.prototype, 'scrollIntoView', { value: () => {} });
```

**Backend mocking patterns:**

```rust
// No mocking framework — uses real MySQL with transaction rollback
// Fixture builders in backend/tests/support/fixtures.rs provide test data
use crate::support::fixtures::{create_test_exam, create_test_attempt};
```

## Test Utilities and Fixtures

**Frontend test setup (`src/test/setup.ts`):**
- `@testing-library/jest-dom/vitest` for DOM matchers
- Automatic `cleanup()` after each test
- `localStorage` mock
- `scrollIntoView` stub

**Backend test support (`backend/tests/support/`):**
- `fixtures.rs`: MySQL fixture builders for exams, versions, schedules, registrations, attempts, passages, idempotency keys, outbox events
- `mod.rs`: `with_test_tx()` for transactional rollback tests, `wait_for_outbox()` for async event processing, `test_id()` for unique IDs, `cleanup_test_data()` for teardown
- `mysql.rs`: MySQL connection pool setup
- `postgres.rs`: PostgreSQL connection pool setup

**E2E test support (`e2e/support/`):**
- `backendE2e.ts`: Manifest path constants, storage state paths, `readBackendE2EManifest()` for reading seeded test data
- `studentUi.ts`: `deterministicWcode()` for unique student codes, `stubScreenDetails()` for media stream stubs, `grantStrictProctoringPermissions()` for camera/mic
- `prodBootstrap.ts`, `prodData.ts`, `prodOrchestration.ts`, `prodProgress.ts`: Production test orchestration helpers

**Architecture guard test (`src/test/architecture/frontend-module-boundaries.test.ts`):**
- Enforces module boundary rules: feature hooks/routes must not import `@services/` directly
- Only `infrastructure/` adapters within features may import services

**Development environment test (`src/test/developmentEnvironment.test.ts`):**
- Verifies Vite dev server proxies `/api` to `http://127.0.0.1:4000`
- Validates backend docker-compose, env files, and Makefile are consistent

## Naming Conventions

**Frontend:**
- Unit/component tests: `ComponentName.test.tsx`
- Utility tests: `utilityName.test.ts`
- Hook tests: `useHookName.test.tsx`
- Service tests: `serviceName.test.ts` or `serviceName.policy.test.ts`
- Integration tests: `featureName.integration.test.ts`
- Performance tests: `featureName.performance.test.ts`

**Backend:**
- Contract tests: `domain_contract.rs` (HTTP endpoint contracts)
- Integration tests: `feature_name.rs` (service-level integration with real DB)

**E2E:**
- Spec files: `feature-name.spec.ts`
- Unit tests within e2e: `feature.unit.test.ts`

## Areas with NO or LOW Test Coverage

### Frontend — Untested Components/Modules

**`src/store/`:**
- `useAuthStore.ts` — no tests
- `useUIStore.ts` — no tests
- Both are Zustand stores; no unit tests exist for store logic

**`src/types/`:**
- `answers.ts`, `domain.ts`, `grading.ts`, `studentAttempt.ts`, `utility.ts` — no type tests
- (Acceptable — pure types don't need unit tests, but type guards might)

**`src/components/listening/`:**
- `ListeningPartListSidebar.tsx` — no tests

**`src/components/scoring/`:**
- `BandScoreMatrix.tsx` — no tests
- `GradingRubricPanel.tsx` — no tests
- `GradingWorkspace.tsx` — no tests

**`src/components/questionbank/`:**
- `QuestionBankLibrary.tsx` — no tests
- `QuestionDetailModal.tsx` — no tests

**`src/components/answer-history/`:**
- `AnswerHistoryPage.test.tsx` exists, but the feature contracts (`src/features/answer-history/contracts/`) are untested

**`src/features/exam-authoring/`:**
- `application/`, `contracts/`, `infrastructure/` — entirely untested at the unit level
- This appears to be a newer feature module with no test coverage

**`src/components/questionbank/` and `src/components/scoring/`:**
- No tests at all

**`src/components/` root level:**
- `AppShell.tsx`, `CommandPalette.tsx`, `ConfirmModal.tsx`, `GlobalToast.tsx`, `Sidebar.tsx`, `StimulusImageEditor.tsx`, `StimulusPane.tsx`, `PromptTemplateLibrary.tsx`, `WritingTaskPanel.tsx` — no tests
- Only `Header.tsx` has tests (preview and titleSync variants)

**`src/stories/`:**
- Storybook stories for Button, Dialog, Input, Select, Textarea, Toast, DataTable, Banner — visual only, no automated interaction tests

### E2E — Known Issues

From `e2e/TEST_STATUS.md`:
- **Smoke tests: 16 passed, 14 failed** — health endpoint mismatch (`/healthz` not `/api/v1/health`)
- **Proctor workflow tests: 21 failed (all)** — UI selectors don't match actual implementation
- Selector mismatches across multiple test files (e.g., "Monitor" button vs actual "Start Exam", "Alerts" tab vs "Filters" button)
- Newly created test files may also have selector mismatches

### Backend — Coverage Gaps

**`backend/tests/frontend_static.rs`:**
- Appears to be a static file serving test — minimal coverage

**No unit tests within crates:**
- `crates/api/`, `crates/application/`, `crates/domain/`, `crates/infrastructure/` — no `#[cfg(test)]` modules found in source files
- All backend testing is done via integration/contract tests in `backend/tests/`
- Domain logic within crates relies on integration tests hitting real MySQL

### Regression Tests

**`tests/regression/`:**
- Contains only `README.md` — no actual regression tests
- README describes the intended policy: "For every serious bug fix, add at least one regression test"

## Testing Conventions to Follow

1. **Co-locate tests**: Place `__tests__/` directories next to the code being tested
2. **Use vitest globals**: `describe`, `it`, `expect` are available without imports
3. **Import testing-library**: Use `@testing-library/react` for component rendering
4. **Mock at module boundary**: Use `vi.mock()` for external dependencies
5. **Use `.policy.test.ts` suffix**: For tests that verify business rules/policies (e.g., `examStatusTransitions.policy.test.ts`)
6. **Use `.backend.test.ts` suffix**: For tests that interact with backend APIs
7. **Use `.integration.test.ts` suffix**: For multi-module integration tests
8. **Backend tests use transaction rollback**: Never commit test data to the database
9. **E2E tests are sequential**: `workers: 1`, `fullyParallel: false`
10. **Architecture guard tests exist**: Verify module boundaries in `src/test/architecture/`

---

*Testing analysis: 2026-07-05*
