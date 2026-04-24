import React, { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  getEnabledModules,
  getFirstQuestionIdForModule,
  getStudentQuestionsForModule,
  type StudentQuestionDescriptor,
} from '@services/examAdapterService';
import type { ExamState, ModuleType, QuestionAnswer } from '../../types';
import { AccessibilitySettings } from './AccessibilitySettings';
import { QuestionNavigator } from './QuestionNavigator';
import { StudentFooter } from './StudentFooter';
import { StudentHeader } from './StudentHeader';
import { StudentListening } from './StudentListening';
import { StudentReading } from './StudentReading';
import { StudentSpeaking } from './StudentSpeaking';
import { StudentWriting } from './StudentWriting';
import { StudentUIProvider, useStudentUI } from './providers/StudentUIProvider';

interface StudentExamPreviewProps {
  state: ExamState;
  examId: string;
  initialModule?: ModuleType | null | undefined;
}

function isModuleEnabled(
  module: ModuleType,
  enabledModules: ModuleType[],
): boolean {
  return enabledModules.includes(module);
}

function getInitialQuestionId(state: ExamState, module: ModuleType): string | null {
  if (module === 'reading' || module === 'listening') {
    return getFirstQuestionIdForModule(state, module);
  }

  if (module === 'writing') {
    return state.config.sections.writing.tasks[0]?.id ?? 'task1';
  }

  return null;
}

function PreviewModal({
  isOpen,
  title,
  description,
  actionLabel = 'OK',
  onClose,
}: {
  isOpen: boolean;
  title: string;
  description: string;
  actionLabel?: string | undefined;
  onClose: () => void;
}) {
  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/70 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="max-w-md w-full bg-white rounded-sm border border-gray-100 shadow-2xl p-6 md:p-8">
        <h2 className="text-xl font-black text-gray-900 mb-3">{title}</h2>
        <p className="text-sm text-gray-700 leading-6 mb-6">{description}</p>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-gray-800 text-white font-bold text-sm rounded-sm"
          >
            {actionLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function StudentExamPreviewInner({
  state,
  examId,
  initialModule,
}: StudentExamPreviewProps) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { state: uiState, actions: uiActions } = useStudentUI();

  const enabledModules = useMemo(() => getEnabledModules(state.config), [state.config]);
  const resolvedInitialModule: ModuleType = useMemo(() => {
    if (initialModule && isModuleEnabled(initialModule, enabledModules)) {
      return initialModule;
    }

    const fromQuery = searchParams.get('module')?.trim().toLowerCase() as ModuleType | undefined;
    if (fromQuery && isModuleEnabled(fromQuery, enabledModules)) {
      return fromQuery;
    }

    return enabledModules[0] ?? 'reading';
  }, [enabledModules, initialModule, searchParams]);

  const [currentModule, setCurrentModule] = useState<ModuleType>(resolvedInitialModule);
  const [currentQuestionId, setCurrentQuestionId] = useState<string | null>(() =>
    getInitialQuestionId(state, resolvedInitialModule),
  );
  const [answers, setAnswers] = useState<Record<string, QuestionAnswer>>({});
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [writingAnswers, setWritingAnswers] = useState<Record<string, string>>({});
  const [submitWarningOpen, setSubmitWarningOpen] = useState(false);

  const totalSecondsForModule = state.config.sections[currentModule]?.duration * 60;
  const timeRemaining = Number.isFinite(totalSecondsForModule) ? totalSecondsForModule : 0;

  const questions = useMemo<StudentQuestionDescriptor[]>(
    () => getStudentQuestionsForModule(state, currentModule),
    [currentModule, state],
  );

  const handleExit = () => {
    window.close();
    navigate(`/builder/${examId}/builder`, { replace: true });
  };

  const handleModuleChange = (nextModule: ModuleType) => {
    if (nextModule === currentModule) {
      return;
    }

    setCurrentModule(nextModule);
    setCurrentQuestionId(getInitialQuestionId(state, nextModule));

    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('module', nextModule);
    setSearchParams(nextParams, { replace: true });

    uiActions.setShowNavigator(false);
  };

  const handleReset = () => {
    setAnswers({});
    setFlags({});
    setWritingAnswers({});
    setCurrentQuestionId(getInitialQuestionId(state, currentModule));
    uiActions.setShowNavigator(false);
  };

  const handleAnswerChange = (answerKey: string, answer: QuestionAnswer) => {
    setAnswers((current) => ({
      ...current,
      [answerKey]: answer,
    }));
  };

  const handleFlagToggle = (slotId: string) => {
    setFlags((current) => ({
      ...current,
      [slotId]: !current[slotId],
    }));
  };

  const handleWritingChange = (taskId: string, text: string) => {
    setWritingAnswers((current) => ({
      ...current,
      [taskId]: text,
    }));
  };

  const handleSubmit = () => {
    setSubmitWarningOpen(true);
  };

  return (
    <div
      className={`flex flex-col h-screen w-full bg-gray-50 font-sans text-gray-900 transition-all ${
        uiState.accessibilitySettings.highContrast ? 'high-contrast' : ''
      }`}
      style={{
        fontSize:
          uiState.accessibilitySettings.fontSize === 'small'
            ? '14px'
            : uiState.accessibilitySettings.fontSize === 'large'
              ? '18px'
              : '16px',
      }}
    >
      <div className="h-10 border-b border-gray-200 bg-white flex items-center justify-between px-3 md:px-4 lg:px-6 flex-shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-[10px] font-black uppercase tracking-[0.22em] text-gray-500">
            Preview (not saved)
          </span>
          <a
            href={`/builder/${examId}/builder`}
            className="text-xs font-semibold text-blue-700 hover:text-blue-800"
          >
            Back to Builder
          </a>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold text-gray-600">
            <span className="sr-only">Module</span>
            <select
              value={currentModule}
              onChange={(event) => handleModuleChange(event.target.value as ModuleType)}
              className="ml-2 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-semibold text-gray-800"
              aria-label="Preview module"
            >
              {enabledModules.map((module) => (
                <option key={module} value={module}>
                  {module.charAt(0).toUpperCase() + module.slice(1)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={handleReset}
            className="rounded-md bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-800 hover:bg-gray-200"
          >
            Reset responses
          </button>
        </div>
      </div>

      <StudentHeader
        onExit={handleExit}
        timeRemaining={timeRemaining}
        onOpenAccessibility={() => uiActions.setShowAccessibility(true)}
        onOpenNavigator={
          currentModule === 'reading' || currentModule === 'listening'
            ? () => uiActions.setShowNavigator(true)
            : undefined
        }
        isExamActive={false}
      />

      <main id="main-content" className="flex-1 overflow-hidden relative flex flex-col" role="main">
        {currentModule === 'reading' ? (
          <StudentReading
            state={state}
            answers={answers}
            onAnswerChange={handleAnswerChange}
            currentQuestionId={currentQuestionId}
            onNavigate={setCurrentQuestionId}
            flags={flags}
            onToggleFlag={handleFlagToggle}
          />
        ) : null}

        {currentModule === 'listening' ? (
          <StudentListening
            state={state}
            answers={answers}
            onAnswerChange={handleAnswerChange}
            currentQuestionId={currentQuestionId}
            onNavigate={setCurrentQuestionId}
            flags={flags}
            onToggleFlag={handleFlagToggle}
          />
        ) : null}

        {currentModule === 'writing' ? (
          <StudentWriting
            state={state}
            writingAnswers={writingAnswers}
            onWritingChange={handleWritingChange}
            onSubmit={handleSubmit}
            currentQuestionId={currentQuestionId}
            onNavigate={setCurrentQuestionId}
            timeRemaining={timeRemaining}
          />
        ) : null}

        {currentModule === 'speaking' ? (
          <StudentSpeaking
            state={state}
            onSubmit={handleSubmit}
            currentQuestionId={currentQuestionId}
            onNavigate={setCurrentQuestionId}
          />
        ) : null}
      </main>

      {currentModule === 'reading' || currentModule === 'listening' ? (
        <StudentFooter
          questions={questions}
          currentQuestionId={currentQuestionId}
          onNavigate={setCurrentQuestionId}
          answers={answers}
          flags={flags}
          onToggleFlag={handleFlagToggle}
          onSubmit={handleSubmit}
        />
      ) : null}

      {uiState.showNavigator ? (
        <QuestionNavigator
          questions={questions}
          answers={answers}
          flags={flags}
          currentQuestionId={currentQuestionId}
          onNavigate={(id) => {
            setCurrentQuestionId(id);
            uiActions.setShowNavigator(false);
          }}
          onClose={() => uiActions.setShowNavigator(false)}
        />
      ) : null}

      <AccessibilitySettings
        isOpen={uiState.showAccessibility}
        onClose={() => uiActions.setShowAccessibility(false)}
        fontSize={uiState.accessibilitySettings.fontSize}
        highContrast={uiState.accessibilitySettings.highContrast}
        onFontSizeChange={uiActions.setFontSize}
        onHighContrastToggle={uiActions.toggleHighContrast}
      />

      <PreviewModal
        isOpen={submitWarningOpen}
        title="Preview mode"
        description="Submission is disabled in preview. Use the builder to edit and publish."
        onClose={() => setSubmitWarningOpen(false)}
      />
    </div>
  );
}

export function StudentExamPreview(props: StudentExamPreviewProps) {
  return (
    <StudentUIProvider>
      <StudentExamPreviewInner {...props} />
    </StudentUIProvider>
  );
}
