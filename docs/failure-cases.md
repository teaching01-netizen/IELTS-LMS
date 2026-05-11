# Failure Cases

Purpose: turn incidents and bug fixes into durable memory for humans and AI agents.

## Entry Template

```
## YYYY-MM-DD: <short title>

### Symptom
<what users/operators observed>

### Scope
<which modules/flows were affected>

### Root Cause
<specific technical reason>

### Fix
<what changed>

### Regression Protection
- Tests: <paths>
- Diagnostics: <paths>
- Rules/Docs updated: <paths>

### Invariant
<what must remain true going forward>
```

---

## 2026-05-11: Desktop Reading Highlight Selection Escapes Passage

### Symptom
Desktop text selection in reading could extend into the question pane. Native blue selection disappeared or highlighted too broadly.

### Scope
Student reading highlight UX and highlight snapshot logic.

### Root Cause
Selection handling mixed live browser selection with post-mouseup/button events, and out-of-container endpoints were clipped back into passage text. That could expand user intent into broad ranges and produce unstable highlight apply behavior.

### Fix
- Reject any selection whose start/end endpoints are not both inside the highlightable passage container.
- Reject cross-block (cross-paragraph) highlight requests instead of auto-splitting them.
- Prefer applying from the latest captured selection snapshot before re-reading live selection on mouseup/manual apply.

### Regression Protection
- Tests: `src/components/student/__tests__/highlightPersistence.test.tsx`
- Tests: `src/components/student/__tests__/highlightSelection.test.ts`
- Rules/Docs: `AGENTS.md`

### Invariant
Highlighting is fail-closed: no endpoint clipping, no cross-block expansion, and no highlight apply based on stale/collapsed live selection if a stable snapshot exists.

---

## 2026-05-11: Reading Passage Selection Blocked By Drag Guard

### Symptom
Students could see text selection collapse/disappear when drag-selecting reading passage text, especially when selection started on the passage title.

### Scope
Student reading passage selection behavior under exam anti-cheat drag/drop guard.

### Root Cause
Global `dragstart` blocking exempted only elements inside `[data-student-highlightable="true"]`. The reading title sat outside that boundary, so native selection gestures could be canceled.

### Fix
- Marked the full reading passage pane container as `data-student-highlightable="true"` so title and body are covered by the drag-selection exemption.

### Regression Protection
- Tests: `src/components/student/__tests__/StudentReadingReadabilityControls.test.tsx`
- Rules/Docs: `docs/failure-cases.md`

### Invariant
Reading passage text selection (title and body) must remain native-selectable during exam mode while non-passage drag/drop restrictions remain enforced.
