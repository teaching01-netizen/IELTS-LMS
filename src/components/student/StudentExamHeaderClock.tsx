import React from 'react';
import { StudentHeader } from './StudentHeader';
import { CompactStudentHeader } from './layout/CompactStudentHeader';
import type { StudentHighlightColor } from './highlightPalette';
import type { StudentHighlightToolMode } from './providers/StudentUIProvider';
import type { ExamType } from '../../types';
import { useStudentRuntimeClock } from './providers/StudentRuntimeProvider';

interface StudentExamHeaderClockProps {
  compact: boolean;
  examType?: ExamType | undefined;
  moduleLabel: string;
  testTakerId?: string | undefined;
  autoSaveStatus?: 'saved' | 'saving' | 'syncing' | 'offline' | 'error' | null | undefined;
  highlightEnabled?: boolean | undefined;
  highlightToolMode?: StudentHighlightToolMode | undefined;
  highlightColor?: StudentHighlightColor | undefined;
  onToggleHighlightMode?: (() => void) | undefined;
  onSelectHighlightColor?: ((color: StudentHighlightColor) => void) | undefined;
  onSelectEraseMode?: (() => void) | undefined;
  choiceEliminationAvailable?: boolean | undefined;
  choiceEliminationEnabled?: boolean | undefined;
  onToggleChoiceElimination?: (() => void) | undefined;
  onOpenAccessibility?: (() => void) | undefined;
  onOpenNavigator?: (() => void) | undefined;
  tabletMode?: boolean | undefined;
  isExamActive?: boolean | undefined;
}

export const StudentExamHeaderClock = React.memo(function StudentExamHeaderClock({
  compact,
  examType = 'Academic',
  moduleLabel,
  testTakerId,
  autoSaveStatus,
  highlightEnabled,
  highlightToolMode,
  highlightColor,
  onToggleHighlightMode,
  onSelectHighlightColor,
  onSelectEraseMode,
  choiceEliminationAvailable,
  choiceEliminationEnabled,
  onToggleChoiceElimination,
  onOpenAccessibility,
  onOpenNavigator,
  tabletMode,
  isExamActive,
}: StudentExamHeaderClockProps) {
  const timeRemaining = useStudentRuntimeClock();

  if (compact) {
    return (
      <CompactStudentHeader
        examType={examType}
        moduleLabel={moduleLabel}
        testTakerId={testTakerId}
        timeRemaining={timeRemaining}
        autoSaveStatus={autoSaveStatus}
        highlightEnabled={highlightEnabled}
        highlightToolMode={highlightToolMode}
        highlightColor={highlightColor}
        onToggleHighlightMode={onToggleHighlightMode}
        onSelectHighlightColor={onSelectHighlightColor}
        onSelectEraseMode={onSelectEraseMode}
        choiceEliminationAvailable={choiceEliminationAvailable}
        choiceEliminationEnabled={choiceEliminationEnabled}
        onToggleChoiceElimination={onToggleChoiceElimination}
        onOpenAccessibility={onOpenAccessibility}
        onOpenNavigator={onOpenNavigator}
      />
    );
  }

  return (
    <StudentHeader
      examType={examType}
      testTakerId={testTakerId}
      timeRemaining={timeRemaining}
      autoSaveStatus={autoSaveStatus}
      highlightEnabled={highlightEnabled}
      highlightToolMode={highlightToolMode}
      highlightColor={highlightColor}
      onToggleHighlightMode={onToggleHighlightMode}
      onSelectHighlightColor={onSelectHighlightColor}
      onSelectEraseMode={onSelectEraseMode}
      choiceEliminationAvailable={choiceEliminationAvailable}
      choiceEliminationEnabled={choiceEliminationEnabled}
      onToggleChoiceElimination={onToggleChoiceElimination}
      onOpenAccessibility={onOpenAccessibility}
      onOpenNavigator={onOpenNavigator}
      tabletMode={tabletMode}
      isExamActive={isExamActive}
    />
  );
});
