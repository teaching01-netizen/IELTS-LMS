import React from 'react';
import { createRoot } from 'react-dom/client';
import '../../../src/index.css';
import type { ExamState } from '../../../src/types';
import { createDefaultConfig } from '../../../src/constants/examDefaults';
import { StudentReading } from '../../../src/components/student/StudentReading';
import { StudentUIProvider, useStudentUI } from '../../../src/components/student/providers/StudentUIProvider';
import { StudentHighlightPersistenceProvider } from '../../../src/components/student/highlightV2Persistence';
import { useStudentExamPageLock } from '../../../src/components/student/layout/useStudentExamPageLock';
import { StudentExamInteractionScopeProvider } from '../../../src/shared/ui/touch-selection/StudentExamInteractionScope';
import { StudentTouchSelectionDiagnosticsProvider } from '../../../src/shared/ui/touch-selection/StudentTouchSelectionDiagnostics';
import { SatAccessibilityDebugRoute } from '../../../src/app/router/dev/SatAccessibilityDebugRoute';

const params = new URLSearchParams(location.search);
const owned = params.get('preview') !== '1';
const phrase = 'Alpha beta gamma delta. The student selects this passage.';
// Two fixture-owned paragraphs for the caret-alignment e2e: real Thai clusters
// and a real RTL run, rendered through the same passage path as everything else.
// The literals are duplicated in e2e/student-owned-touch-selection.spec.ts on
// purpose — a page bundle cannot import a Playwright file.
//
// They sit at the FRONT of the content deliberately: the loupe's cloned picture
// strips element classes (privacy contract), so container-scoped paragraph
// spacing — 8px between paragraphs in this pane — is missing from the clone and
// the divergence accumulates 8px per preceding paragraph. Paragraph one has
// none, so source and clone agree exactly where these carets resolve. Closing
// that gap for later paragraphs needs a product fix in buildPicture (preserve
// layout-affecting descendant styles), out of scope for this test-only change.
const rtlPhrase = 'هذا نص عربي بسيط عن الطقس والمدينة والحدائق والشوارع';
const thaiPhrase = 'ภาษาไทย คนในประเทศไทย พูดภาษาไทย ทุกวัน';
const state: ExamState = {
  title: 'Touch selection fixture', type: 'Academic', activeModule: 'reading',
  activePassageId: 'passage-1', activeListeningPartId: null,
  config: createDefaultConfig('Academic', 'Academic'),
  reading: { passages: [{ id: 'passage-1', title: 'Passage 1', content: [rtlPhrase, thaiPhrase, phrase, ...Array(15).fill(phrase)].join('\n\n'), images: [], blocks: [] }] },
  listening: { parts: [] }, writing: { task1Prompt: '', task2Prompt: '' },
  speaking: { part1Topics: [], cueCard: '', part3Discussion: [] },
} as ExamState;

function IeltsReading() {
  const { state: ui, actions } = useStudentUI();
  useStudentExamPageLock(owned);
  return <main className="student-exam-shell" style={{ height: '100dvh', gridTemplateRows: 'auto minmax(0, 1fr) auto' }}>
    <button onClick={actions.toggleHighlightMode} aria-pressed={ui.accessibilitySettings.highlightToolMode === 'highlight'}>Highlight</button>
    <StudentReading state={state} answers={{}} onAnswerChange={() => {}} currentQuestionId={null} onNavigate={() => {}} highlightEnabled tabletMode layoutMode="wide" />
    <input aria-label="Answer" defaultValue="Native editing" />
  </main>;
}

createRoot(document.getElementById('app')!).render(
  <StudentExamInteractionScopeProvider ownedTouchSelection={owned}>
    <StudentTouchSelectionDiagnosticsProvider enabled={params.get('debug') !== '0'}>
      <StudentHighlightPersistenceProvider namespace="touch-browser-test">
        <StudentUIProvider>
          {params.get('product') === 'sat' ? <SatAccessibilityDebugRoute /> : <IeltsReading />}
        </StudentUIProvider>
      </StudentHighlightPersistenceProvider>
    </StudentTouchSelectionDiagnosticsProvider>
  </StudentExamInteractionScopeProvider>,
);
