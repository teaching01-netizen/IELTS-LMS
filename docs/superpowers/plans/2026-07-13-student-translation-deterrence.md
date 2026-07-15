# Student Translation Deterrence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Strengthen best-effort translation deterrence on personal devices, especially iOS selected-text Translate, without breaking the student highlight workflow.

**Architecture:** Keep ownership in the student UI. Extract the translation guard from the general proctoring provider, retain the existing violation/audit pipeline, and scope the iOS callout rule to active highlightable exam text only.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, Playwright, CSS/WebKit extensions.

---

### Task 1: Translation guard behavior

- [x] Add failing provider/guard tests for active-phase and configuration gating, marker restoration, violation deduplication, and cleanup.
- [x] Run the focused tests and confirm they fail for the missing behavior.
- [x] Extract a module-local translation guard that owns the `translate="no"`, `notranslate`, Google meta, active CSS class, mutation observation, restoration, and known Google marker detection.
- [x] Keep `TRANSLATION_DETECTED` medium-severity and route it through the existing append-only violation/audit flow.
- [x] Run the focused tests and confirm they pass.

### Task 2: iOS callout scope and highlight compatibility

- [x] Add failing tests proving the callout guard is scoped to active, highlightable exam text and does not disable text selection or answer controls.
- [x] Run the focused tests and confirm they fail for the missing CSS behavior.
- [x] Apply `-webkit-touch-callout: none` beneath the active translation-guard class while preserving `user-select: text`, native selection events, and the custom highlight toolbar.
- [x] Run focused highlight and readability regression tests. The Playwright iPad run is blocked by the pre-existing E2E seed validation failure recorded below.

### Task 3: Product copy and repository memory

- [x] Update builder/admin translation setting copy to say “best effort” and avoid claiming arbitrary extensions are blocked.
- [x] Update UX invariants and failure-case memory with the iOS policy, the highlighting priority, and the unmanaged-device limitation.
- [x] Run the builder security-setting tests.

### Task 4: Verification and review

- [x] Run targeted Vitest suites, lint, build, and typecheck. Typecheck remains red on pre-existing unrelated repository errors.
- [ ] Run relevant Chromium/WebKit Playwright checks. Blocked in global setup because the existing seeded fixture has no Writing Task 1/2 prompts.
- [x] Review the diff for spec compliance, code quality, security, reliability, and accidental changes to pre-existing dirty files.
- [x] Record the remaining real-device iOS verification gap explicitly.
