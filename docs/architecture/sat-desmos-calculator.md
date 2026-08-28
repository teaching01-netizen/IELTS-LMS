# SAT Desmos calculator integration

## Purpose

Digital SAT Math uses the official Desmos API. The application does not implement,
parse, or evaluate calculator expressions itself. The host application owns only
tool availability, window chrome, lifecycle, persistence, and exam integrity.

## Runtime ownership

- `loadDesmos.ts` lazily loads Desmos API v1.12 only when the calculator opens.
- `desmosTestingConfig.ts` owns assessment-safe calculator configuration.
- `DesmosCalculator.tsx` owns Desmos instance create/resize/destroy lifecycle.
- `SatCalculatorPanel.tsx` owns Scientific/Graphing mode and opaque state persistence.
- `SatToolWindow.tsx` owns desktop drag behavior and compact full-height presentation.
- `satCalculatorWorkspace.ts` owns per-module sessionStorage isolation and cleanup.
- `SatStudentSessionRoute.tsx` maps backend `toolPolicy` to calculator availability.

## Distribution and environment

Production supports two explicit distribution modes. `desmos-hosted` loads the official
Desmos v1.12 endpoint and requires a browser-delivered partner API key. `self-hosted` is
the recommended exam deployment after Desmos provides the licensed partner distribution.

Hosted rollout:

```dotenv
VITE_DESMOS_MODE="desmos-hosted"
VITE_DESMOS_API_KEY="<partner-api-key>"
```

Self-hosted rollout:

```dotenv
VITE_DESMOS_MODE="self-hosted"
DESMOS_SELF_HOST_SOURCE_DIR="vendor-private/desmos/v1.12"
VITE_DESMOS_API_URL="/vendor/desmos/v1.12/calculator.js"
```

`DESMOS_SELF_HOST_SOURCE_DIR` is build-only and is never exposed to the browser. The entire
official bundle directory is copied so relative vendor assets continue to resolve. The source
directory and generated public vendor directory are gitignored; the licensed distribution must
be injected by an authorized developer or CI artifact step. Do not commit or recreate it.

`npm run dev` and `npm run build` execute `scripts/prepare-desmos-self-host.mjs`. Self-hosted
mode fails the build if the official bundle or `calculator.js` entry is absent, rejects symlinks
and unsafe public paths, copies the complete distribution, and writes a non-secret SHA-256 build
manifest. Hosted mode removes generated self-host assets so stale vendor files are never shipped
by accident. Vite strips `VITE_DESMOS_API_KEY` from self-hosted client bundles even if a stale key
is still present in the build environment.

The self-host URL must remain same-origin under `/vendor/desmos/`. The Rust production server
already serves Vite public assets from the same `dist` directory copied into the Railway image,
so `/vendor/desmos/v1.12/calculator.js` requires no additional browser origin or CDN dependency.
`VITE_DESMOS_API_KEY` is only needed in `desmos-hosted` mode and must be removed from self-hosted
production configuration.

## SAT testing behavior

Math modules advertise `calculator` and `reference_sheet` through immutable module
`toolPolicy`. Reading & Writing modules do not advertise calculator capability.
The graphing calculator disables images, folders, and notes and enables forced Log
Mode regressions, matching the published College Board testing configuration.
Scientific and Graphing calculators remain separate official Desmos instances.

External calculator help links are disabled inside the locked exam surface so the
calculator cannot become an outbound navigation path during a proctored attempt.
Accessibility controls provided by Desmos remain enabled.

## State and lifecycle

Calculator state is treated as opaque. The application only calls `getState()` and
`setState()` and never reads or edits state internals. Scientific and Graphing states
are stored separately and survive close/reopen and mode switching within a module.

State is scoped by schedule, attempt, and module-attempt ID. It is debounced into
`sessionStorage`, capped at 1.5 MB, and failure to persist never blocks exam answers.
The current module workspace is cleared after successful module submission. All
calculator workspaces for the attempt are cleared after final assessment completion.

Calculator state is scratch work. It is never sent as a student response and is never
used by grading.

## Failure behavior

Desmos is loaded on demand rather than on every application route. A CDN/network,
configuration, or feature-entitlement failure is contained inside the tool window;
the active exam, timer, responses, and proctoring continue running. The student sees
a retry action and an instruction to contact the proctor if retry fails.

The loader uses a 20-second timeout, removes failed script nodes, uses a no-referrer
script request policy, and supports retry. Both ScientificCalculator and
GraphingCalculator entitlements are checked before constructing an instance.

## Exam integrity

Opening or closing Desmos does not alter the server timer, question state, answers,
review flags, or response revisions. Existing SAT interaction guards remain active:
visibility changes, restricted shortcuts, clipboard attempts, context menus,
screenshot key detection, secondary display checks, heartbeat, and device continuity.

A Desmos host element is marked `data-sat-trusted-tool="desmos"` for observability and
future scoped integrity policy. The integration does not inspect or mutate vendor DOM.

## Verification

Before deployment run:

```sh
npm run typecheck
npx vitest run src/features/student-delivery
npm run build
```

Production smoke in `desmos-hosted` mode must verify the partner key exposes both
ScientificCalculator and GraphingCalculator. In `self-hosted` mode it must verify
`/vendor/desmos/v1.12/calculator.js` and its relative assets are served from the exam
origin, no request to `desmos.com` occurs during calculator startup, and both official
calculator constructors are available from the licensed bundle.
