# Navigator redesign — verification log

Rebuilt the question navigator around persistent module navigation instead of a dropdown setting.

## Implemented

- **Persistent module tabs**: every module in the current section is always visible and one click away (`ModuleSwitcher.tsx`), with real `role=tablist`/`role=tab` semantics and roving tabindex so arrow keys switch destination.
- **Section tabs**: both sections (Reading & Writing, Math) exposed as tabs when more than one exists — no nested dropdowns.
- **Wider rail**: default 392px, min 340px, max 460px; 360px under 1280px. Optional drag/keyboard resizer with persisted width (`RailResizer.tsx`).
- **Readable rows**: two-line `line-clamp` previews, ~56px single-line rows, zero-padded question numbers, fixed-width trailing status column.
- **Quiet states**: semantic-red issue icon with count, no red-filled rows; no "CURRENT" badge — selection uses accent surface, 2px indicator, and stronger text.
- **Information architecture**: fixed nav region (section title, exam authored count, module tabs, search, filter) with an independently scrolling question list.
- **Separate progress concepts**: exam shows "N of M authored"; modules show "N of M ready".
- **Secondary bulk select**: selection mode reachable via the list overflow menu, not permanent chrome.
- **Keyboard**: Ctrl/Cmd+F focuses search, Arrow/Home/End navigate rows, arrow keys switch modules with tabs semantics, 44px targets, visible focus rings.
- **Per-module memory**: returning to a module restores its last selected question and scroll offset.

## Preserved safeguards

Autosave flush before navigation, mutation fences (`expectedQuestionIds`/`operationKey`), row duplicate/delete confirmation and single-flight guards, overlay stack, release gates, and the inspector contract are unchanged.

## Verification

- Full authoring suite: 66 files / 283 tests pass (`evidence/nav-final.txt`).
- New `NavigatorArchitecture.test.tsx`: 6 tests covering one-click tabs, both sections, arrow-key switching, worded progress, list/nav scroll separation, and per-module memory restoration.
- ESLint: 0 errors (warnings only, annotated where intentional). Build: exit 0.

## Notes

Three previously existing assertions were updated because they pinned the old architecture: the exam progress is now exam-wide wording, and the import entry moved into the list overflow menu. The spine token test was updated to the new rail widths (392/340/460).
