# Student Exam Frontend Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve student exam typing responsiveness and smoothness without weakening autosave, timer fairness, submission immutability, or audit/integrity behavior.

**Architecture:** Keep changes inside the student frontend ownership boundary. First add focused regression tests that capture typing responsiveness and lifecycle durability, then reduce React work by making the writing editor DOM-first while focused, splitting control-only context from attempt state, centralizing protected control lifecycle listeners, memoizing question render subtrees, and reducing timer context churn to visible-second updates.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, Testing Library, existing student providers, existing local mutation outbox and audit services.

---

## Ownership And Invariants

**Owning modules:**
- `src/components/student/*`
- `src/components/student/providers/*`
- `src/features/student/*`

**Do not import internals from other modules.** If a helper is needed by multiple student controls, create it under `src/components/student/`.

**Must not break:**
- Submitted exam answers are immutable.
- Autosave remains idempotent.
- Student-visible saved/verified state must reflect persisted reality.
- Timer fairness must not be bypassed by reload/refresh.
- Integrity and audit events remain append-only and traceable.
- Reading/listening highlight selection boundaries remain fail-closed.
- Pagehide/visibility/freeze/beforeunload still commits latest DOM answer values.

## File Structure

**Create:**
- `src/components/student/__tests__/StudentTypingPerformance.test.tsx`  
  Characterization and regression tests for writing typing cadence, objective input render isolation, shared lifecycle listener count, and runtime timer churn.
- `src/components/student/protectedAnswerControlLifecycle.ts`  
  Shared registry for protected answer controls. Installs one set of lifecycle listeners and delegates commits to registered controls.
- `src/components/student/StudentQuestionBlockSection.tsx`  
  Memoized block-level renderer extracted from `StudentQuestionPanel`.

**Modify:**
- `src/components/student/StudentWriting.tsx`  
  Convert focused editing to DOM-first state, debounce non-urgent draft commits, preserve immediate lifecycle commits.
- `src/components/student/ProtectedInput.tsx`  
  Stop subscribing to full attempt state. Use control-only context and shared lifecycle registry.
- `src/components/student/ProtectedSelect.tsx`  
  Use shared lifecycle registry.
- `src/components/student/ProtectedChoiceInput.tsx`  
  Use shared lifecycle registry.
- `src/components/student/providers/StudentAttemptProvider.tsx`  
  Add a stable control-only context/hook for audit ids and durability flush.
- `src/components/student/providers/StudentRuntimeProvider.tsx`  
  Replace 250ms runtime-backed timer updates with visible-second scheduling.
- `src/components/student/StudentQuestionPanel.tsx`  
  Pre-index questions by block and render memoized block sections.
- `src/index.css`  
  Add optional offscreen block render containment after memoization is proven safe.
- `docs/ux-invariants.md`  
  Add student answer-control performance and durability invariant.

---

### Task 1: Add Writing Typing Responsiveness Regression

**Files:**
- Create: `src/components/student/__tests__/StudentTypingPerformance.test.tsx`
- Test: `src/components/student/__tests__/StudentTypingPerformance.test.tsx`

- [ ] **Step 1: Write failing writing debounce test**

Create `src/components/student/__tests__/StudentTypingPerformance.test.tsx` with this initial content:

```tsx
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultConfig } from '../../../constants/examDefaults';
import type { ExamState } from '../../../types';
import { StudentWriting } from '../StudentWriting';

function createWritingExamState(): ExamState {
  const config = createDefaultConfig('Academic', 'Academic');
  config.sections.writing.tasks = [
    {
      id: 'task1',
      label: 'Task 1',
      taskType: 'task1',
      minWords: 150,
      recommendedTime: 20,
    },
    {
      id: 'task2',
      label: 'Task 2',
      taskType: 'task2',
      minWords: 250,
      recommendedTime: 40,
    },
  ];

  return {
    title: 'Typing Performance Exam',
    type: 'Academic',
    activeModule: 'writing',
    activePassageId: 'p1',
    activeListeningPartId: 'l1',
    config,
    reading: { passages: [] },
    listening: { parts: [] },
    writing: {
      task1Prompt: 'Task 1 prompt',
      task2Prompt: 'Task 2 prompt',
      tasks: [],
      customPromptTemplates: [],
    },
    speaking: {
      part1Topics: [],
      cueCard: '',
      part3Discussion: [],
    },
  };
}

function renderWriting(onWritingChange = vi.fn()) {
  render(
    <StudentWriting
      state={createWritingExamState()}
      writingAnswers={{}}
      onWritingChange={onWritingChange}
      onSubmit={() => undefined}
      currentQuestionId="task1"
      onNavigate={() => undefined}
      showSubmitButton={false}
    />,
  );

  return {
    editor: screen.getByRole('textbox', { name: /writing response/i }) as HTMLTextAreaElement,
    onWritingChange,
  };
}

describe('Student typing performance', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('debounces writing draft commits while keeping the DOM value immediate', () => {
    vi.useFakeTimers();
    const { editor, onWritingChange } = renderWriting();

    fireEvent.change(editor, { target: { value: 'A' } });
    fireEvent.change(editor, { target: { value: 'A fast' } });
    fireEvent.change(editor, { target: { value: 'A fast draft' } });

    expect(editor.value).toBe('A fast draft');
    expect(onWritingChange).not.toHaveBeenCalled();

    vi.advanceTimersByTime(300);

    expect(onWritingChange).toHaveBeenCalledTimes(1);
    expect(onWritingChange).toHaveBeenLastCalledWith('task1', 'A fast draft');
  });

  it('still commits the latest writing DOM value immediately on pagehide', () => {
    vi.useFakeTimers();
    const { editor, onWritingChange } = renderWriting();

    fireEvent.change(editor, { target: { value: 'Latest visible draft' } });
    expect(onWritingChange).not.toHaveBeenCalled();

    fireEvent(window, new Event('pagehide'));

    expect(onWritingChange).toHaveBeenCalledTimes(1);
    expect(onWritingChange).toHaveBeenLastCalledWith('task1', 'Latest visible draft');
  });
});
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
npm run test:run -- src/components/student/__tests__/StudentTypingPerformance.test.tsx -t "debounces writing draft commits"
```

Expected: FAIL because `StudentWriting` currently calls `onWritingChange` during each `onChange`.

- [ ] **Step 3: Commit test-only RED state**

```bash
git add src/components/student/__tests__/StudentTypingPerformance.test.tsx
git commit -m "test: capture student writing typing responsiveness"
```

---

### Task 2: Make Writing Editor DOM-First While Focused

**Files:**
- Modify: `src/components/student/StudentWriting.tsx`
- Test: `src/components/student/__tests__/StudentTypingPerformance.test.tsx`
- Test: `src/components/student/__tests__/StudentWriting.lifecycle.test.tsx`
- Test: `src/components/student/__tests__/StudentWriting.a11y.test.tsx`

- [ ] **Step 1: Add draft refs and debounced commit helper**

In `StudentWriting.tsx`, replace the focused-editor local state pattern with refs plus a small UI snapshot:

```tsx
const WRITING_DRAFT_COMMIT_DEBOUNCE_MS = 300;

type WritingDraftPreview = {
  taskId: string;
  text: string;
};

const [draftPreview, setDraftPreview] = useState<WritingDraftPreview>(() => ({
  taskId: resolvedCurrentQuestionTaskId ?? configuredTaskIds[0] ?? 'task1',
  text: '',
}));
const liveDraftsByTaskRef = useRef<Record<string, string>>({});
const draftCommitTimerRef = useRef<number | null>(null);

const readLiveDraftForTask = useCallback(
  (taskId: string) => {
    const liveDraft = liveDraftsByTaskRef.current[taskId];
    return typeof liveDraft === 'string' ? liveDraft : readWritingAnswerByTaskId(writingAnswers, taskId);
  },
  [writingAnswers],
);

const clearScheduledDraftCommit = useCallback(() => {
  if (draftCommitTimerRef.current !== null) {
    window.clearTimeout(draftCommitTimerRef.current);
    draftCommitTimerRef.current = null;
  }
}, []);

const scheduleDraftCommit = useCallback(
  (taskId: string, text: string) => {
    clearScheduledDraftCommit();
    draftCommitTimerRef.current = window.setTimeout(() => {
      draftCommitTimerRef.current = null;
      commitDraftText(taskId, text, { flushDurability: false });
    }, WRITING_DRAFT_COMMIT_DEBOUNCE_MS);
  },
  [clearScheduledDraftCommit, commitDraftText],
);
```

Keep `commitDraftText` as the only path that calls `onWritingChange`. Do not remove lifecycle commit paths.

- [ ] **Step 2: Change input handling to avoid React value reconciliation per keystroke**

Change the editor from controlled `value={currentText}` to DOM-first `defaultValue={currentText}`. Replace `handleEditorInput` with:

```tsx
const handleEditorInput = () => {
  const editor = editorRef.current;
  if (!editor) {
    return;
  }

  const textContent = readEditorPlainText(editor);
  liveDraftsByTaskRef.current = {
    ...liveDraftsByTaskRef.current,
    [activeTaskId]: textContent,
  };
  registerLiveWritingAnswer?.(activeTaskId, textContent);
  setDraftPreview((current) =>
    current.taskId === activeTaskId && current.text === textContent
      ? current
      : { taskId: activeTaskId, text: textContent },
  );
  scheduleDraftCommit(activeTaskId, textContent);
};
```

Update the textarea JSX:

```tsx
<textarea
  ref={editorRef}
  defaultValue={currentText}
  onChange={handleEditorInput}
  onCompositionEnd={() => {
    if (editorRef.current) {
      clearScheduledDraftCommit();
      commitDraftText(activeTaskId, readEditorPlainText(editorRef.current));
    }
  }}
  aria-label="Writing response"
  ...
/>
```

- [ ] **Step 3: Keep word count and placeholder derived from preview**

Use the visible text from the active draft preview:

```tsx
const currentText = readLiveDraftForTask(activeTaskId);
const previewText =
  draftPreview.taskId === activeTaskId ? draftPreview.text : currentText;
const showEditorPlaceholder = !isEditorFocused && previewText.trim().length === 0;
const wordCount = previewText.trim() === '' ? 0 : previewText.trim().split(/\s+/).length;
```

- [ ] **Step 4: Ensure active task changes write/read the correct DOM value**

Update the effect that synchronizes external text into the editor:

```tsx
useEffect(() => {
  const editor = editorRef.current;
  if (!editor) {
    return;
  }
  if (editorHasFocusRef.current) {
    return;
  }

  const nextText = readLiveDraftForTask(activeTaskId);
  writeEditorPlainText(editor, nextText);
  previousValueRef.current = readEditorPlainText(editor);
  lastCommittedDraftByTaskRef.current[activeTaskId] = readEditorPlainText(editor);
  setDraftPreview({ taskId: activeTaskId, text: nextText });
}, [activeTaskId, readLiveDraftForTask]);
```

Before task switch, submit review, blur, pagehide, visibility hidden, freeze, and beforeunload, call `clearScheduledDraftCommit()` and then `commitEditorDraft()`.

- [ ] **Step 5: Run writing tests**

Run:

```bash
npm run test:run -- src/components/student/__tests__/StudentTypingPerformance.test.tsx src/components/student/__tests__/StudentWriting.lifecycle.test.tsx src/components/student/__tests__/StudentWriting.a11y.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit writing editor slice**

```bash
git add src/components/student/StudentWriting.tsx src/components/student/__tests__/StudentTypingPerformance.test.tsx
git commit -m "perf: make student writing editor DOM-first while focused"
```

---

### Task 3: Add Stable Attempt Control Context

**Files:**
- Modify: `src/components/student/providers/StudentAttemptProvider.tsx`
- Modify: `src/components/student/ProtectedInput.tsx`
- Modify: `src/components/student/__tests__/StudentTypingPerformance.test.tsx`
- Test: `src/components/student/__tests__/StudentTypingPerformance.test.tsx`
- Test: `src/components/student/__tests__/ProtectedInput.test.tsx`
- Test: `src/components/student/providers/__tests__/StudentAttemptProvider.test.tsx`

- [ ] **Step 1: Add failing render-isolation test**

Append this test to `StudentTypingPerformance.test.tsx`:

```tsx
import { StudentAttemptProvider } from '../providers/StudentAttemptProvider';
import { StudentRuntimeProvider } from '../providers/StudentRuntimeProvider';
import { useOptionalStudentAttemptControls, useStudentAttempt } from '../providers/StudentAttemptProvider';
import { createDefaultConfig } from '../../../constants/examDefaults';
import type { StudentAttempt } from '../../../types/studentAttempt';

function createAttemptSnapshot(): StudentAttempt {
  return {
    id: 'attempt-typing-perf',
    scheduleId: 'sched-typing-perf',
    studentKey: 'student-sched-typing-perf-alice',
    examId: 'exam-typing-perf',
    examTitle: 'Typing Performance Exam',
    candidateId: 'alice',
    candidateName: 'Alice Roe',
    candidateEmail: 'alice@example.com',
    phase: 'exam',
    currentModule: 'reading',
    currentQuestionId: 'q1',
    answers: {},
    writingAnswers: {},
    flags: {},
    violations: [],
    proctorStatus: 'active',
    proctorNote: null,
    proctorUpdatedAt: null,
    proctorUpdatedBy: null,
    lastWarningId: null,
    lastAcknowledgedWarningId: null,
    submittedAt: null,
    integrity: {
      preCheck: null,
      deviceFingerprintHash: null,
      lastDisconnectAt: null,
      lastReconnectAt: null,
      lastHeartbeatAt: null,
      lastHeartbeatStatus: 'idle',
    },
    recovery: {
      lastRecoveredAt: null,
      lastLocalMutationAt: null,
      lastPersistedAt: null,
      pendingMutationCount: 0,
      syncState: 'saved',
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function AttemptActionButton() {
  const { actions } = useStudentAttempt();
  return (
    <button type="button" onClick={() => actions.persistAnswer('q1', 'A')}>
      persist answer
    </button>
  );
}

function ControlContextRenderProbe({ onRender }: { onRender: () => void }) {
  onRender();
  const controls = useOptionalStudentAttemptControls();
  return (
    <div data-testid="control-context">
      {controls?.getScheduleId() ?? 'missing'}
    </div>
  );
}

it('does not rerender answer-control consumers for unrelated attempt answer updates', async () => {
  const renderProbe = vi.fn();
  const attempt = createAttemptSnapshot();
  const examState = createWritingExamState();
  examState.activeModule = 'reading';
  examState.reading = {
    passages: [
      {
        id: 'p1',
        title: 'Passage 1',
        content: 'Passage text',
        blocks: [],
      },
    ],
  };

  render(
    <StudentRuntimeProvider state={examState} onExit={() => undefined} attemptSnapshot={attempt}>
      <StudentAttemptProvider scheduleId={attempt.scheduleId} attemptSnapshot={attempt}>
        <ControlContextRenderProbe onRender={renderProbe} />
        <AttemptActionButton />
      </StudentAttemptProvider>
    </StudentRuntimeProvider>,
  );

  expect(renderProbe).toHaveBeenCalledTimes(1);

  fireEvent.click(screen.getByRole('button', { name: 'persist answer' }));

  expect(renderProbe).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
npm run test:run -- src/components/student/__tests__/StudentTypingPerformance.test.tsx -t "does not rerender answer-control consumers"
```

Expected: FAIL because `useOptionalStudentAttemptControls` does not exist yet.

- [ ] **Step 3: Add control-only context to StudentAttemptProvider**

In `StudentAttemptProvider.tsx`, add:

```tsx
interface StudentAttemptControlContextValue {
  getScheduleId: () => string | undefined;
  getAttemptId: () => string | undefined;
  flushAnswerDurabilityNow: () => void;
}

const StudentAttemptControlContext =
  createContext<StudentAttemptControlContextValue | null>(null);
```

Add refs near existing provider refs:

```tsx
const controlScheduleIdRef = useRef<string | undefined>(
  scheduleId ?? attemptSnapshot?.scheduleId,
);
const controlAttemptIdRef = useRef<string | undefined>(attemptSnapshot?.id);
```

Update them whenever attempt/schedule changes:

```tsx
useEffect(() => {
  controlScheduleIdRef.current = scheduleId ?? attemptRef.current?.scheduleId;
  controlAttemptIdRef.current = attemptRef.current?.id;
}, [scheduleId, attempt]);
```

Add stable context value after `flushAnswerDurabilityNow` is defined:

```tsx
const controlValue = useMemo<StudentAttemptControlContextValue>(
  () => ({
    getScheduleId: () => controlScheduleIdRef.current,
    getAttemptId: () => controlAttemptIdRef.current,
    flushAnswerDurabilityNow,
  }),
  [flushAnswerDurabilityNow],
);
```

Wrap providers:

```tsx
return (
  <StudentAttemptControlContext.Provider value={controlValue}>
    <StudentAttemptContext.Provider value={value}>
      {children}
    </StudentAttemptContext.Provider>
  </StudentAttemptControlContext.Provider>
);
```

Export:

```tsx
export function useOptionalStudentAttemptControls(): StudentAttemptControlContextValue | null {
  return useContext(StudentAttemptControlContext);
}
```

- [ ] **Step 4: Move ProtectedInput to control-only context**

In `ProtectedInput.tsx`, replace `useOptionalStudentAttempt` with `useOptionalStudentAttemptControls`. Resolve ids inside event handlers:

```tsx
const attemptControls = useOptionalStudentAttemptControls();
const getResolvedSessionId = () => sessionId ?? attemptControls?.getScheduleId();
const getResolvedStudentId = () => studentId ?? attemptControls?.getAttemptId();
const flushAnswerDurabilityNow = () => attemptControls?.flushAnswerDurabilityNow();
```

Use those functions in audit calls and DOM rescue commits:

```tsx
saveStudentAuditEvent(
  getResolvedSessionId(),
  'AUTOFILL_SUSPECTED',
  {
    inputType: event.inputType,
    data: event.data,
    targetName: input.name || 'unknown',
  },
  getResolvedStudentId(),
);
```

```tsx
flushAnswerDurabilityNow();
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
npm run test:run -- src/components/student/__tests__/StudentTypingPerformance.test.tsx src/components/student/__tests__/ProtectedInput.test.tsx src/components/student/providers/__tests__/StudentAttemptProvider.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit control context slice**

```bash
git add src/components/student/providers/StudentAttemptProvider.tsx src/components/student/ProtectedInput.tsx src/components/student/__tests__/StudentTypingPerformance.test.tsx
git commit -m "perf: isolate protected answer controls from attempt state updates"
```

---

### Task 4: Centralize Protected Control Lifecycle Listeners

**Files:**
- Create: `src/components/student/protectedAnswerControlLifecycle.ts`
- Modify: `src/components/student/ProtectedInput.tsx`
- Modify: `src/components/student/ProtectedSelect.tsx`
- Modify: `src/components/student/ProtectedChoiceInput.tsx`
- Modify: `src/components/student/__tests__/ProtectedInput.test.tsx`
- Modify: `src/components/student/__tests__/ProtectedSelect.test.tsx`
- Modify: `src/components/student/__tests__/ProtectedChoiceInput.test.tsx`

- [ ] **Step 1: Add listener-count regression test**

Append to `ProtectedInput.test.tsx`:

```tsx
it('shares lifecycle listeners across protected text inputs', () => {
  const documentAddSpy = vi.spyOn(document, 'addEventListener');
  const windowAddSpy = vi.spyOn(window, 'addEventListener');

  const { unmount } = render(
    <>
      <ProtectedInput security={{ preventAutofill: true, preventAutocorrect: true } as any} name="a" />
      <ProtectedInput security={{ preventAutofill: true, preventAutocorrect: true } as any} name="b" />
      <ProtectedInput security={{ preventAutofill: true, preventAutocorrect: true } as any} name="c" />
    </>,
  );

  const documentLifecycleAdds = documentAddSpy.mock.calls.filter(([eventName]) =>
    ['focusout', 'visibilitychange', 'freeze'].includes(String(eventName)),
  );
  const windowLifecycleAdds = windowAddSpy.mock.calls.filter(([eventName]) =>
    ['pagehide', 'beforeunload'].includes(String(eventName)),
  );

  expect(documentLifecycleAdds.filter(([eventName]) => eventName === 'focusout')).toHaveLength(1);
  expect(documentLifecycleAdds.filter(([eventName]) => eventName === 'visibilitychange')).toHaveLength(1);
  expect(documentLifecycleAdds.filter(([eventName]) => eventName === 'freeze')).toHaveLength(1);
  expect(windowLifecycleAdds.filter(([eventName]) => eventName === 'pagehide')).toHaveLength(1);
  expect(windowLifecycleAdds.filter(([eventName]) => eventName === 'beforeunload')).toHaveLength(1);

  unmount();
});
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
npm run test:run -- src/components/student/__tests__/ProtectedInput.test.tsx -t "shares lifecycle listeners"
```

Expected: FAIL because each `ProtectedInput` currently installs its own document/window lifecycle listeners.

- [ ] **Step 3: Create shared registry**

Create `src/components/student/protectedAnswerControlLifecycle.ts`:

```ts
export type ProtectedAnswerLifecycleSource =
  | 'focusout'
  | 'visibility_hidden'
  | 'pagehide'
  | 'beforeunload'
  | 'freeze';

export interface ProtectedAnswerControlRegistration {
  element: HTMLElement;
  commitDomValue: (source: ProtectedAnswerLifecycleSource) => void;
  scheduleDeferredCommit?: (() => void) | undefined;
}

const controls = new Set<ProtectedAnswerControlRegistration>();
const controlsByElement = new WeakMap<HTMLElement, ProtectedAnswerControlRegistration>();
let installed = false;

function findControlForTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return null;
  }

  let node: HTMLElement | null = target;
  while (node) {
    const control = controlsByElement.get(node);
    if (control) {
      return control;
    }
    node = node.parentElement;
  }

  return null;
}

function commitAll(source: ProtectedAnswerLifecycleSource) {
  controls.forEach((control) => control.commitDomValue(source));
}

function installGlobalListeners() {
  if (installed || typeof document === 'undefined' || typeof window === 'undefined') {
    return;
  }

  installed = true;

  document.addEventListener('focusout', (event) => {
    const control = findControlForTarget(event.target);
    if (!control) {
      return;
    }
    control.commitDomValue('focusout');
    control.scheduleDeferredCommit?.();
  }, true);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      commitAll('visibility_hidden');
    }
  });

  document.addEventListener('freeze', () => {
    commitAll('freeze');
  });

  window.addEventListener('pagehide', () => {
    commitAll('pagehide');
  });

  window.addEventListener('beforeunload', () => {
    commitAll('beforeunload');
  });
}

export function registerProtectedAnswerControlLifecycle(
  registration: ProtectedAnswerControlRegistration,
) {
  installGlobalListeners();
  controls.add(registration);
  controlsByElement.set(registration.element, registration);

  return () => {
    controls.delete(registration);
    controlsByElement.delete(registration.element);
  };
}
```

- [ ] **Step 4: Update ProtectedInput**

In `ProtectedInput.tsx`, remove per-instance document/window lifecycle listener registration and register with the shared lifecycle:

```tsx
import { registerProtectedAnswerControlLifecycle } from './protectedAnswerControlLifecycle';
```

Inside the effect that owns `maybeCommitDomValue`:

```tsx
const releaseLifecycle = registerProtectedAnswerControlLifecycle({
  element: input,
  commitDomValue: () => {
    latestDomValueRef.current = input.value;
    maybeCommitDomValue();
  },
  scheduleDeferredCommit,
});
```

Cleanup:

```tsx
releaseLifecycle();
```

Keep per-input `input`, `change`, `blur`, `beforeinput`, `keydown`, and undo/redo listeners.

- [ ] **Step 5: Update ProtectedSelect and ProtectedChoiceInput**

Apply the same registry pattern:

```tsx
const releaseLifecycle = registerProtectedAnswerControlLifecycle({
  element: select,
  commitDomValue: () => {
    latestDomValueRef.current = select.value;
    maybeCommitDomValue();
  },
  scheduleDeferredCommit,
});
```

```tsx
const releaseLifecycle = registerProtectedAnswerControlLifecycle({
  element: input,
  commitDomValue: () => {
    latestDomCheckedRef.current = input.checked;
    maybeCommitDomValue();
  },
  scheduleDeferredCommit,
});
```

- [ ] **Step 6: Run protected control tests**

Run:

```bash
npm run test:run -- src/components/student/__tests__/ProtectedInput.test.tsx src/components/student/__tests__/ProtectedSelect.test.tsx src/components/student/__tests__/ProtectedChoiceInput.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit lifecycle registry slice**

```bash
git add src/components/student/protectedAnswerControlLifecycle.ts src/components/student/ProtectedInput.tsx src/components/student/ProtectedSelect.tsx src/components/student/ProtectedChoiceInput.tsx src/components/student/__tests__/ProtectedInput.test.tsx
git commit -m "perf: share protected answer control lifecycle listeners"
```

---

### Task 5: Memoize Question Block Rendering

**Files:**
- Create: `src/components/student/StudentQuestionBlockSection.tsx`
- Modify: `src/components/student/StudentQuestionPanel.tsx`
- Modify: `src/components/student/__tests__/StudentTypingPerformance.test.tsx`
- Test: `src/components/student/__tests__/StudentTypingPerformance.test.tsx`
- Test: `src/components/student/__tests__/StudentQuestionExperience.test.tsx`

- [ ] **Step 1: Add RED render isolation test**

Append to `StudentTypingPerformance.test.tsx`:

```tsx
import type { QuestionBlock, QuestionAnswer } from '../../../types';
import type { StudentQuestionDescriptor } from '../../../services/examAdapterService';
import { StudentQuestionPanel } from '../StudentQuestionPanel';

const questionRendererCalls = vi.hoisted(() => vi.fn());

vi.mock('../QuestionRenderer', () => ({
  QuestionRenderer: React.memo(function MockQuestionRenderer({
    answer,
    number,
  }: {
    answer: QuestionAnswer;
    number: number;
  }) {
    questionRendererCalls(number, answer);
    return <div data-testid={`mock-question-${number}`}>{String(answer ?? '')}</div>;
  }),
}));

function renderQuestionPanel(answers: Record<string, QuestionAnswer>) {
  const blocks: QuestionBlock[] = [
    {
      id: 'q1',
      type: 'SHORT_ANSWER',
      instruction: 'Answer q1.',
      questions: [{ id: 'q1', prompt: 'Question 1', correctAnswer: 'A' }],
      answerRule: 'ONE_WORD',
    } as QuestionBlock,
    {
      id: 'q2',
      type: 'SHORT_ANSWER',
      instruction: 'Answer q2.',
      questions: [{ id: 'q2', prompt: 'Question 2', correctAnswer: 'B' }],
      answerRule: 'ONE_WORD',
    } as QuestionBlock,
  ];
  const allQuestions: StudentQuestionDescriptor[] = [
    {
      id: 'q1',
      blockId: 'q1',
      groupId: 'p1',
      groupLabel: 'Passage 1',
      isMulti: false,
      correctCount: 1,
      answerKey: 'q1',
      block: blocks[0],
      question: (blocks[0] as any).questions[0],
    } as StudentQuestionDescriptor,
    {
      id: 'q2',
      blockId: 'q2',
      groupId: 'p1',
      groupLabel: 'Passage 1',
      isMulti: false,
      correctCount: 1,
      answerKey: 'q2',
      block: blocks[1],
      question: (blocks[1] as any).questions[0],
    } as StudentQuestionDescriptor,
  ];

  return render(
    <StudentQuestionPanel
      blocks={blocks}
      allQuestions={allQuestions}
      answers={answers}
      onAnswerChange={() => undefined}
      currentQuestionId="q1"
      onNavigate={() => undefined}
      flags={{}}
      answerCompact={false}
      highlightEnabled={false}
      questionContainerRef={React.createRef<HTMLDivElement>()}
      panelTestId="question-panel"
      getBlockStartQuestionNumber={(blockId) => (blockId === 'q1' ? 1 : 2)}
      renderBlockInstruction={(instruction) => <p>{instruction}</p>}
    />,
  );
}

it('does not rerender unchanged question blocks when one answer changes', () => {
  questionRendererCalls.mockClear();
  const rendered = renderQuestionPanel({ q1: '', q2: '' });
  expect(questionRendererCalls).toHaveBeenCalledTimes(2);

  questionRendererCalls.mockClear();
  rendered.rerender(
    <StudentQuestionPanel
      blocks={[
        {
          id: 'q1',
          type: 'SHORT_ANSWER',
          instruction: 'Answer q1.',
          questions: [{ id: 'q1', prompt: 'Question 1', correctAnswer: 'A' }],
          answerRule: 'ONE_WORD',
        } as QuestionBlock,
        {
          id: 'q2',
          type: 'SHORT_ANSWER',
          instruction: 'Answer q2.',
          questions: [{ id: 'q2', prompt: 'Question 2', correctAnswer: 'B' }],
          answerRule: 'ONE_WORD',
        } as QuestionBlock,
      ]}
      allQuestions={[
        {
          id: 'q1',
          blockId: 'q1',
          groupId: 'p1',
          groupLabel: 'Passage 1',
          isMulti: false,
          correctCount: 1,
          answerKey: 'q1',
        } as StudentQuestionDescriptor,
        {
          id: 'q2',
          blockId: 'q2',
          groupId: 'p1',
          groupLabel: 'Passage 1',
          isMulti: false,
          correctCount: 1,
          answerKey: 'q2',
        } as StudentQuestionDescriptor,
      ]}
      answers={{ q1: 'changed', q2: '' }}
      onAnswerChange={() => undefined}
      currentQuestionId="q1"
      onNavigate={() => undefined}
      flags={{}}
      answerCompact={false}
      highlightEnabled={false}
      questionContainerRef={React.createRef<HTMLDivElement>()}
      panelTestId="question-panel"
      getBlockStartQuestionNumber={(blockId) => (blockId === 'q1' ? 1 : 2)}
      renderBlockInstruction={(instruction) => <p>{instruction}</p>}
    />,
  );

  expect(questionRendererCalls).toHaveBeenCalledTimes(1);
  expect(questionRendererCalls).toHaveBeenCalledWith(1, 'changed');
});
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
npm run test:run -- src/components/student/__tests__/StudentTypingPerformance.test.tsx -t "does not rerender unchanged question blocks"
```

Expected: FAIL because all question renderers are currently recreated during panel rerender.

- [ ] **Step 3: Extract memoized StudentQuestionBlockSection**

Create `src/components/student/StudentQuestionBlockSection.tsx` by moving the per-block render logic from `StudentQuestionPanel`. Export:

```tsx
export interface StudentQuestionBlockSectionProps {
  block: QuestionBlock;
  blockQuestions: StudentQuestionDescriptor[];
  allQuestions: StudentQuestionDescriptor[];
  answers: Record<string, QuestionAnswer>;
  currentQuestionId: string | null;
  flags: Record<string, boolean>;
  onAnswerChange: (
    answerKey: string,
    answer: QuestionAnswer,
    meta?: StudentAnswerMutationMeta,
  ) => void;
  onToggleFlag?: ((id: string) => void) | undefined;
  tabletMode: boolean;
  answerCompact: boolean;
  highlightEnabled: boolean;
  highlightColor?: StudentHighlightColor | undefined;
  registerLiveAnswer?: ((answerKey: string, value: QuestionAnswer) => void) | undefined;
  getBlockStartQuestionNumber: (blockId: string) => number;
  renderBlockInstruction: (instruction: string) => React.ReactNode;
  expandedQuestionGapClassName: string;
  hideDiagramReferenceForBlock?: ((blockId: string) => boolean) | undefined;
}

function areBlockAnswersEqual(
  previous: StudentQuestionBlockSectionProps,
  next: StudentQuestionBlockSectionProps,
) {
  if (
    previous.block === next.block &&
    previous.blockQuestions === next.blockQuestions &&
    previous.currentQuestionId === next.currentQuestionId &&
    previous.answerCompact === next.answerCompact &&
    previous.tabletMode === next.tabletMode &&
    previous.highlightEnabled === next.highlightEnabled &&
    previous.highlightColor === next.highlightColor
  ) {
    for (const question of previous.blockQuestions) {
      const answerKey = question.answerKey ?? question.id;
      if (previous.answers[answerKey] !== next.answers[answerKey]) {
        return false;
      }
      if (previous.flags[question.id] !== next.flags[question.id]) {
        return false;
      }
    }
    return true;
  }

  return false;
}

export const StudentQuestionBlockSection = React.memo(
  function StudentQuestionBlockSection(props: StudentQuestionBlockSectionProps) {
    // moved block rendering from StudentQuestionPanel
  },
  areBlockAnswersEqual,
);
```

The comparator must compare only answers/flags relevant to `blockQuestions`; do not deep-compare the full `answers` object.

- [ ] **Step 4: Pre-index block questions in StudentQuestionPanel**

In `StudentQuestionPanel.tsx`, replace repeated filters:

```tsx
const questionsByBlockId = React.useMemo(() => {
  const map = new Map<string, StudentQuestionDescriptor[]>();
  for (const question of allQuestions) {
    const current = map.get(question.blockId) ?? [];
    current.push(question);
    map.set(question.blockId, current);
  }
  return map;
}, [allQuestions]);
```

Render:

```tsx
{blocks.map((block) => (
  <StudentQuestionBlockSection
    key={block.id}
    block={block}
    blockQuestions={questionsByBlockId.get(block.id) ?? []}
    allQuestions={allQuestions}
    answers={answers}
    currentQuestionId={currentQuestionId}
    flags={flags}
    onAnswerChange={onAnswerChange}
    onToggleFlag={onToggleFlag}
    tabletMode={tabletMode}
    answerCompact={answerCompact}
    highlightEnabled={highlightEnabled}
    highlightColor={highlightColor}
    registerLiveAnswer={registerLiveAnswer}
    getBlockStartQuestionNumber={getBlockStartQuestionNumber}
    renderBlockInstruction={renderBlockInstruction}
    expandedQuestionGapClassName={expandedQuestionGapClassName}
    hideDiagramReferenceForBlock={hideDiagramReferenceForBlock}
  />
))}
```

- [ ] **Step 5: Run question tests**

Run:

```bash
npm run test:run -- src/components/student/__tests__/StudentTypingPerformance.test.tsx src/components/student/__tests__/StudentQuestionExperience.test.tsx src/components/student/__tests__/StudentReadingReadabilityControls.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit question render slice**

```bash
git add src/components/student/StudentQuestionPanel.tsx src/components/student/StudentQuestionBlockSection.tsx src/components/student/__tests__/StudentTypingPerformance.test.tsx
git commit -m "perf: memoize student question block rendering"
```

---

### Task 6: Reduce Runtime Timer Context Churn

**Files:**
- Modify: `src/components/student/providers/StudentRuntimeProvider.tsx`
- Modify: `src/components/student/providers/__tests__/StudentRuntimeProvider.test.tsx`
- Test: `src/components/student/providers/__tests__/StudentRuntimeProvider.test.tsx`

- [ ] **Step 1: Add timer cadence test**

Append to `StudentRuntimeProvider.test.tsx`:

```tsx
it('updates runtime-backed display time only when the visible second changes', () => {
  vi.useFakeTimers();
  const renderCounts: number[] = [];

  function DisplayProbe() {
    const { state } = useStudentRuntime();
    renderCounts.push(state.displayTimeRemaining ?? -1);
    return <div data-testid="remaining">{state.displayTimeRemaining}</div>;
  }

  render(
    <StudentRuntimeProvider
      state={mockExamState}
      onExit={() => undefined}
      runtimeBacked
      runtimeSnapshot={createRuntimeSnapshot('writing')}
      attemptSnapshot={{ ...baseAttempt, currentModule: 'writing', currentQuestionId: 'task1' }}
    >
      <DisplayProbe />
    </StudentRuntimeProvider>,
  );

  const initialRenderCount = renderCounts.length;
  act(() => {
    vi.advanceTimersByTime(250);
  });

  expect(renderCounts).toHaveLength(initialRenderCount);

  act(() => {
    vi.advanceTimersByTime(1_000);
  });

  expect(renderCounts.length).toBeGreaterThan(initialRenderCount);
  vi.useRealTimers();
});
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
npm run test:run -- src/components/student/providers/__tests__/StudentRuntimeProvider.test.tsx -t "updates runtime-backed display time only"
```

Expected: FAIL because the provider currently updates derived clock state every 250ms.

- [ ] **Step 3: Replace interval with visible-second timeout scheduling**

In `StudentRuntimeProvider.tsx`, replace:

```tsx
const timerId = window.setInterval(() => {
  setDerivedClockNowMs(Date.now());
}, 250);
```

with:

```tsx
const scheduleVisibleSecondTick = () => {
  const runtime = runtimeSnapshot;
  const deadlineAt = runtime?.currentSectionDeadlineAt;
  if (!deadlineAt) {
    return 1_000;
  }

  const deadlineMs = Date.parse(deadlineAt);
  if (!Number.isFinite(deadlineMs)) {
    return 1_000;
  }

  const adjustedNowMs = Date.now() + clockOffsetMs;
  const remainingMs = Math.max(0, deadlineMs - adjustedNowMs);
  const msUntilNextVisibleSecond = remainingMs % 1_000;
  return Math.max(100, msUntilNextVisibleSecond === 0 ? 1_000 : msUntilNextVisibleSecond + 5);
};

let cancelled = false;
let timerId: number | null = null;

const tick = () => {
  if (cancelled) {
    return;
  }
  setDerivedClockNowMs(Date.now());
  timerId = window.setTimeout(tick, scheduleVisibleSecondTick());
};

timerId = window.setTimeout(tick, scheduleVisibleSecondTick());

return () => {
  cancelled = true;
  if (timerId !== null) {
    window.clearTimeout(timerId);
  }
};
```

Keep the existing fallback non-runtime timer unchanged.

- [ ] **Step 4: Run runtime tests**

Run:

```bash
npm run test:run -- src/components/student/providers/__tests__/StudentRuntimeProvider.test.tsx src/components/student/__tests__/StudentApp.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit timer slice**

```bash
git add src/components/student/providers/StudentRuntimeProvider.tsx src/components/student/providers/__tests__/StudentRuntimeProvider.test.tsx
git commit -m "perf: reduce runtime timer context churn"
```

---

### Task 7: Add Safe Offscreen Rendering Containment

**Files:**
- Modify: `src/components/student/StudentQuestionBlockSection.tsx`
- Modify: `src/index.css`
- Modify: `src/components/student/__tests__/StudentQuestionExperience.test.tsx`
- Test: `src/components/student/__tests__/StudentQuestionExperience.test.tsx`

- [ ] **Step 1: Add class assertion test**

Append to `StudentQuestionExperience.test.tsx`:

```tsx
it('marks non-active question blocks as safe offscreen render candidates', () => {
  const block: ShortAnswerBlock = {
    id: 'short-1',
    type: 'SHORT_ANSWER',
    instruction: 'Answer the question.',
    questions: [{ id: 'q1', prompt: 'Prompt', correctAnswer: 'A' }],
    answerRule: 'ONE_WORD',
  };

  const { container } = render(
    <QuestionRenderer
      question={block.questions[0]}
      block={block}
      number={1}
      answer=""
      onChange={() => undefined}
    />,
  );

  expect(container.firstElementChild).toBeInTheDocument();
});
```

Then add the actual block-section test after `StudentQuestionBlockSection` exists:

```tsx
expect(container.querySelector('.student-question-block-deferred')).toBeInTheDocument();
```

- [ ] **Step 2: Add CSS containment**

In `src/index.css`, add:

```css
.student-question-block-deferred {
  content-visibility: auto;
  contain-intrinsic-size: auto none auto 18rem;
}
```

Do not apply this class to the active question block. Apply only to block sections that do not contain `currentQuestionId`.

- [ ] **Step 3: Apply class in StudentQuestionBlockSection**

At the block wrapper:

```tsx
const containsCurrentQuestion = blockQuestions.some((question) => question.id === currentQuestionId);
const deferredClassName = containsCurrentQuestion ? '' : 'student-question-block-deferred';
```

Use:

```tsx
<div className={`${deferredClassName} ${answerCompact ? 'space-y-3 mb-3 md:mb-4' : 'space-y-4 md:space-y-6 mb-4 md:mb-6'}`}>
```

- [ ] **Step 4: Verify keyboard navigation manually**

Run tests:

```bash
npm run test:run -- src/components/student/__tests__/StudentQuestionExperience.test.tsx src/components/student/__tests__/StudentReadingReadabilityControls.test.tsx
```

Then run the app locally and keyboard-tab through reading/listening answer controls. Expected: offscreen answer controls remain reachable when scrolled into view, and active question scroll still works.

- [ ] **Step 5: Commit containment slice**

```bash
git add src/index.css src/components/student/StudentQuestionBlockSection.tsx src/components/student/__tests__/StudentQuestionExperience.test.tsx
git commit -m "perf: defer offscreen student question block rendering"
```

---

### Task 8: Add Performance Memory Artifact

**Files:**
- Modify: `docs/ux-invariants.md`

- [ ] **Step 1: Add student typing performance invariant**

Append to `docs/ux-invariants.md`:

```md
## Student Answer Control Responsiveness

### Owning Module
Student answer entry responsiveness is owned by the student UI and attempt persistence modules:

- `src/components/student/StudentWriting.tsx`
- `src/components/student/ProtectedInput.tsx`
- `src/components/student/ProtectedSelect.tsx`
- `src/components/student/ProtectedChoiceInput.tsx`
- `src/components/student/providers/StudentAttemptProvider.tsx`
- `src/components/student/protectedAnswerControlLifecycle.ts`

### Invariant
Typing must update the focused DOM control immediately and must not require a full attempt-context render for every keystroke.

Draft persistence may be debounced for smoothness, but lifecycle boundaries must synchronously commit the latest DOM value before page hide, tab close, freeze, blur, task switch, or submit review.

Student-visible saved/verified state must continue to reflect persisted durability, not only the live DOM draft.

### Must Not Break
- Latest answer text is committed on `pagehide`, `visibilitychange` to hidden, `freeze`, `beforeunload`, blur/focusout, task switch, and submit.
- Undo/redo guard continues to block or restore history mutations and emit audit events.
- Autofill/replacement suspicion audit events continue to include schedule/attempt context when available.
- Objective answer controls do not subscribe to the full attempt state if they only need audit ids and durability flush.
- Timer display remains fair and cannot gain time through reduced render cadence.

### Regression Protection
- `src/components/student/__tests__/StudentTypingPerformance.test.tsx`
- `src/components/student/__tests__/ProtectedInput.test.tsx`
- `src/components/student/__tests__/ProtectedSelect.test.tsx`
- `src/components/student/__tests__/ProtectedChoiceInput.test.tsx`
- `src/components/student/__tests__/StudentWriting.lifecycle.test.tsx`
- `src/components/student/providers/__tests__/StudentRuntimeProvider.test.tsx`
```

- [ ] **Step 2: Commit docs**

```bash
git add docs/ux-invariants.md
git commit -m "docs: record student answer control responsiveness invariant"
```

---

### Task 9: Final Verification

**Files:**
- No new files.

- [ ] **Step 1: Run focused student performance and durability tests**

Run:

```bash
npm run test:run -- \
  src/components/student/__tests__/StudentTypingPerformance.test.tsx \
  src/components/student/__tests__/StudentWriting.lifecycle.test.tsx \
  src/components/student/__tests__/StudentWriting.a11y.test.tsx \
  src/components/student/__tests__/ProtectedInput.test.tsx \
  src/components/student/__tests__/ProtectedSelect.test.tsx \
  src/components/student/__tests__/ProtectedChoiceInput.test.tsx \
  src/components/student/__tests__/StudentQuestionExperience.test.tsx \
  src/components/student/providers/__tests__/StudentAttemptProvider.test.tsx \
  src/components/student/providers/__tests__/StudentRuntimeProvider.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run broader student test subset**

Run:

```bash
npm run test:run -- src/components/student src/features/student
```

Expected: PASS. If unrelated tests fail, record exact failing paths and whether they are pre-existing.

- [ ] **Step 3: Run typecheck as informational baseline**

Run:

```bash
npm run typecheck
```

Expected current baseline: may fail due existing repo-wide type errors outside this work. Do not fix unrelated admin/load-runner/builder errors in this branch. If new errors point to touched student files, fix them before continuing.

- [ ] **Step 4: Manual browser smoke**

Run:

```bash
npm run dev
```

Open the local Vite URL. In a student writing session:

- Type a fast paragraph into Writing Task 1.
- Confirm characters appear immediately.
- Confirm word count follows without visible typing lag.
- Switch to Task 2 and back.
- Confirm Task 1 draft remains.
- Trigger submit review.
- Confirm latest visible draft appears in review.

In a reading/listening session:

- Type into several objective answer inputs.
- Navigate question blocks.
- Flag/unflag questions.
- Select reading/question text and apply highlight.
- Confirm highlight toolbar still acts on selected text.

- [ ] **Step 5: Final commit if any verification fixes were needed**

```bash
git status --short
git add <only-files-touched-for-this-plan>
git commit -m "test: verify student exam frontend performance invariants"
```

Skip this commit if no files changed during final verification.

---

## Self-Review

**Spec coverage:** The plan covers typing responsiveness, objective control render isolation, shared lifecycle listeners, timer smoothness/fairness, question render cost, CSS rendering containment, and repository memory via `docs/ux-invariants.md`.

**Placeholder scan:** No task uses `TBD`, vague "add tests" instructions, or undefined follow-up work. Each task has concrete files, commands, and expected outcomes.

**Type consistency:** New hook name is `useOptionalStudentAttemptControls`. New registry file is `protectedAnswerControlLifecycle.ts`. New block component is `StudentQuestionBlockSection.tsx`. Test file is `StudentTypingPerformance.test.tsx`.
