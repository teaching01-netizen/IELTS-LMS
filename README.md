# IELTS Proctoring System

Frontend monolith for IELTS administration, builder, proctoring, and student delivery.

## Verified Architecture

- Admin is the active route-driven surface under `/admin/*`.
- Builder is the active route `/builder/:examId`.
- Proctor currently has one active monitoring route: `/proctor`.
- Student delivery currently has one active schedule-backed route: `/student/:scheduleId`.
- Student `pre-check`, `lobby`, `exam`, and `complete` are internal runtime phases, not child routes.
- `/proctor/settings` is not part of the active route tree.

## Current Quality Gate Truth

- `npm run typecheck` is expected to pass.
- Student runtime tests and route contract tests exist and should stay green.
- `npm run lint` is not green yet.
- Do not describe the repo as RFC-complete or production-ready while lint and broader gates are failing.

## Active Docs

- [Route Truth](docs/architecture/route-truth.md)
- [Import Boundaries](docs/architecture/import-boundaries.md)
- [Legacy Status](docs/architecture/legacy-status.md)

## Development Commands

```bash
npm install
npm run dev
npm run typecheck
npm run lint
npm run test:run
npm run build
```

## Full-Stack Dev

```bash
cd backend
make db-up
make api
make worker
```

- The frontend dev server now proxies `/api/*` to `http://127.0.0.1:4000` by default.
- Override the proxy target with `VITE_BACKEND_API_URL` when the backend runs elsewhere.

## Working Rules

- Treat route behavior as the source of truth.
- Keep direct persistence access inside repositories/services, not routes or UI components.
- Mark inactive shells and unfinished surfaces as legacy or in-progress instead of implying they are live.

## Device Support (Student Delivery)

- **Secure mode** (fullscreen and/or secondary-screen detection enabled) is strongest on **desktop/laptop** browsers.
- **iPad secure mode** is best-effort: Safari/Chrome on iPadOS may temporarily leave fullscreen while typing or while the viewport settles after scrolling, and the student may need to tap to restore fullscreen.
- **Other mobile** devices are supported only in **non-secure mode**, meaning both:
  - `config.security.requireFullscreen = false`
  - `config.security.detectSecondaryScreen = false`
