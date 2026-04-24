# Real-Time Student Security Overlays (TAB_SWITCH, FULLSCREEN_EXIT, SECONDARY_SCREEN)

Date: 2026-04-23

## Goal

Show immediate student-facing warning overlays for:

- `TAB_SWITCH`
- `FULLSCREEN_EXIT`
- `SECONDARY_SCREEN`

While keeping detection accurate (avoid false positives on close/reload), and preventing event storms from spamming violations or audit logs.

## Current State (Key Facts)

- Student violations are recorded via `runtimeActions.addViolation()` (client state) and also best-effort logged via `saveStudentAuditEvent()` (HTTP).
- `TAB_SWITCH` overlay already exists in `StudentApp`, driven by `runtimeState.violations`.
- `FULLSCREEN_EXIT` and `SECONDARY_SCREEN` currently produce violations but do not drive a student overlay.
- A global per-type cooldown (5s) can silently drop repeated violations.
- Tab-switch detection is intentionally delayed via close-signal delay + debounce, to avoid misclassifying browser close/reload signals.
- Secondary-screen detection is periodic.

## Design Overview

### 1) Fast `TAB_SWITCH` detection

- Keep close/reload suppression semantics (pagehide/beforeunload signals should not become tab-switch).
- Reduce close-signal delay to a small value.
- Remove the tab-switch debounce delay so violations are recorded immediately (still deduped).

### 2) `FULLSCREEN_EXIT` overlay (sticky with grace window)

- Always record a `FULLSCREEN_EXIT` violation when fullscreen is lost (even if auto-reentry succeeds).
- Student overlay opens only if fullscreen is still lost after a tiny grace window (prevents flicker).
- Overlay stays open until fullscreen is restored.
- Overlay provides an explicit user-gesture action to re-enter fullscreen.

### 3) `SECONDARY_SCREEN` overlay (non-sticky)

- Show a warning overlay immediately when a new `SECONDARY_SCREEN` violation is recorded.
- Dismissal acknowledges that specific violation id; a subsequent new violation id can re-open.

### 4) Cooldown policy (per type)

- Preserve the existing default per-type cooldown for noisy violations.
- Use per-type overrides so `TAB_SWITCH` and `FULLSCREEN_EXIT` are never blocked by a 5s cooldown.
- Keep `SECONDARY_SCREEN` on a longer cooldown to avoid repeated high-severity increments during frequent checks.

### 5) Tests

- Update timing-based proctoring tests to align with the new smaller delays.
- Preserve the test that ensures close/reload signals do not trigger `TAB_SWITCH`.

## Success Criteria

- Tab-switch overlays appear quickly after `visibilitychange`/`blur` while still ignoring close/reload signals.
- Fullscreen overlay appears only when fullscreen remains lost past the grace window; it stays until fullscreen returns.
- Secondary-screen overlay appears on detection without spamming repeated violations.

