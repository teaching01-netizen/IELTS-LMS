# Coding Conventions

**Analysis Date:** 2026-07-05

## Languages

**Primary:**
- TypeScript `~5.8.2` — Frontend application (React + Vite)
- Rust `edition 2021, rust-version 1.88` — Backend (API, application, domain, infrastructure, worker crates)

## Naming Patterns

**Files — Frontend:**
- Components: `PascalCase.tsx` — `StudentApp.tsx`, `ProctorDashboard.tsx`
- Hooks: `camelCase.ts` with `use` prefix — `useBuilderRouteController.ts`, `useLiveUpdates.ts`
- Services: `camelCase.ts` — `examLifecycleService.ts`, `gradingService.ts`
- Utilities: `camelCase.ts` — `validationUtils.ts`, `cloneExamContent.ts`
- Types: `camelCase.ts` — `domain.ts`, `studentAttempt.ts`, `grading.ts`
- Tests: `fileName.test.ts` or `fileName.test.tsx` — co-located in `__tests__/` directories
- Stories: `PascalCase.stories.tsx` — in `src/stories/`

**Files — Backend:**
- Modules: `snake_case.rs` — `exam_lifecycle.rs`, `student_contract.rs`
- Tests: `snake_case.rs` — in `tests/contracts/`, `tests/integration/`

**Functions:**
- Frontend: `camelCase` — `validateQuestionBlock()`, `createDefaultConfig()`, `buildExamEntity()`
- Backend: `snake_case` — `with_test_tx()`, `wait_for_outbox()`, `test_id()`

**Variables:**
- Frontend: `camelCase` — `mockNavigate`, `originalFetch`, `backendApiUrl`
- Backend: `snake_case` — `exam_id`, `version_number`, `test_prefix`
- Constants: `SCREAMING_SNAKE_CASE` — `SCHEMA_VERSION`, `GENERATED_DIR`, `DELIVERY_MIGRATIONS`

**Types/Interfaces:**
- PascalCase for types/interfaces — `ExamEntity`, `StudentAttempt`, `BackendE2EManifest`
- Prefixed with `I` for repository interfaces — `IExamRepository`
- Test mock classes: `Mock` prefix — `MockExamRepository`

## Code Style

**Formatting (Prettier):**
```json
{
  "semi": true,
  "trailingComma": "es5",
  "singleQuote": false,
  "printWidth": 100,
  "tabWidth": 2,
  "useTabs": false,
  "arrowParens": "always",
  "endOfLine": "lf"
}
```

**Linting (ESLint — flat config):**
- `eslint.config.js` — TypeScript-ESLint + React Hooks + JSX-A11y
- Test files: `@typescript-eslint/no-explicit-any` OFF, `@typescript-eslint/no-unused-vars` OFF
- Feature routes/hooks: `no-restricted-imports` enforced — no cross-feature imports, no relative `services/` or `components/` imports
- `react-hooks/rules-of-hooks`: error
- `react-hooks/exhaustive-deps`: warn
- `@typescript-eslint/no-explicit-any`: warn (off in tests)

**TypeScript (strict mode):**
- `strict: true`, `strictNullChecks: true`, `noImplicitAny: true`
- `exactOptionalPropertyTypes: true`, `noUncheckedIndexedAccess: true`
- `noImplicitReturns: true`, `noFallthroughCasesInSwitch: true`
- `noImplicitOverride: true`, `noPropertyAccessFromIndexSignature: true`
- Test files excluded from `tsconfig.json` compilation

## Path Aliases

Defined in both `tsconfig.json` and `vitest.config.ts`:

```typescript
'@/*'          → './*'               // Project root
'@app/*'       → './src/app/*'       // App layer
'@components/*'→ './src/components/*' // UI components
'@services/*'  → './src/services/*'  // Business services
'@admin/*'     → './src/features/admin/*'
'@builder/*'   → './src/features/builder/*'
'@proctor/*'   → './src/features/proctor/*'
'@student/*'   → './src/features/student/*'
'@shared/*'    → './src/shared/*'
```

## Import Organization

**Order (observed pattern):**
1. React / third-party libraries
2. Vitest / test utilities (in test files)
3. Local modules using path aliases (`@services/`, `@components/`, etc.)
4. Relative imports for co-located code
5. Type imports (`import type { ... }`)

**Examples from test files:**
```typescript
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { examLifecycleService } from '@services/examLifecycleService';
import type { ExamEntity } from '../../types/domain';
```

**Feature boundary rules (enforced by ESLint):**
- Feature routes/hooks must NOT import from `../../../services/*`, `../../../components/*`, or `../../../features/*`
- Use path aliases: `@services/*`, `@components/*`
- Features must NOT import directly from other features
- Only `infrastructure/` adapters within features may import from `@services/`

## Error Handling

**Frontend patterns:**
```typescript
// Service methods return nullable or throw
async getExamById(id: string): Promise<ExamEntity | null> {
  return this.exams.find(e => e.id === id) || null;
}

// Component-level error boundaries
<RouteErrorBoundary /> at `src/routes/RouteErrorBoundary.tsx`

// Toast notifications for user-facing errors
import { toast } from 'sonner';
toast.error('Failed to save');
```

**Backend patterns:**
```rust
// Result-based error handling
let resp = app.oneshot(req).await.unwrap();
assert_eq!(resp.status(), StatusCode::OK);

// Test assertions on error conditions
let tx = pool.begin().await.expect("begin transaction");
```

## Comments

**When to Comment:**
- Test files include block comments explaining test phase/purpose:
  ```typescript
  /**
   * Tests for Exam Lifecycle Service - Phase 3: Versioning, Clone, Rollback, Audit
   * 
   * Note: Run with `npm test` - vitest types are available at runtime
   */
  ```
- Helper functions documented with JSDoc in test support files
- Backend test constants annotated with migration file lists

**JSDoc/TSDoc:**
- Used in `e2e/support/` utility files for interface documentation
- Used in test fixture builders for parameter descriptions

## Function Design

**Test helper functions:**
- Prefixed with `build`, `create`, or `json` — `buildExamEntity()`, `createTestExam()`, `jsonResponse()`
- Use `Partial<T>` for override parameters:
  ```typescript
  function buildExamEntity(overrides: Partial<ExamEntity> = {}): ExamEntity {
    return { ...defaultValues, ...overrides };
  }
  ```
- Return constructed objects, not classes

**Mock factories:**
- `vi.fn()` with `.mockResolvedValue()` or `.mockReturnValue()`
- Mock classes implement the full interface for type safety:
  ```typescript
  class MockExamRepository implements IExamRepository { ... }
  ```

## Module Design

**Frontend architecture layers:**
```
ui → components → features → services → app
         ↓              ↓
      (stores)     (infrastructure adapters)
```

**Feature module structure:**
```
src/features/{feature}/
├── application/     # Application services
├── contracts/       # Type contracts/interfaces
├── components/      # Feature-specific UI components
├── hooks/           # Feature-specific hooks
├── infrastructure/  # Adapters (may import @services/)
├── routes/          # Route components
└── utils/           # Feature-specific utilities
```

**Exports:**
- Barrel files NOT used — direct imports preferred
- Services export singleton instances: `export const examLifecycleService = new ExamLifecycleService()`
- Repository interfaces prefixed with `I`: `IExamRepository`

## Cross-Cutting Concerns

**Validation:**
- Zod `^4.3.6` for schema validation
- Validation schemas in `src/app/validation/`
- `react-hook-form` `^7.72.1` with `@hookform/resolvers` `^5.2.2`

**State Management:**
- Zustand `^5.0.12` for client state (`src/store/useAuthStore.ts`, `src/store/useUIStore.ts`)
- React Query (`@tanstack/react-query` `^5.99.0`) for server state

**Styling:**
- Tailwind CSS `^4.1.14` with `tailwind-merge` `^3.5.0`
- `class-variance-authority` `^0.7.1` for component variants
- `clsx` `^2.1.1` for conditional classes

**Accessibility:**
- `eslint-plugin-jsx-a11y` with recommended rules as warnings
- Accessibility tests: `StudentListening.a11y.test.tsx`, `StudentSpeaking.a11y.test.tsx`, `StudentWriting.a11y.test.tsx`
- `AccessibilitySettings.test.tsx`, `accessibilityScale.test.ts`

---

*Convention analysis: 2026-07-05*
