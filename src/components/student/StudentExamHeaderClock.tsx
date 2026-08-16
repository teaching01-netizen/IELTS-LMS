import React from 'react';
import { StudentHeader } from './StudentHeader';
import { CompactStudentHeader } from './layout/CompactStudentHeader';
import type { StudentHighlightColor } from './highlightPalette';
import type { StudentHighlightToolMode } from './providers/StudentUIProvider';
import { useStudentRuntimeClock } from './providers/StudentRuntimeProvider';

interface StudentExamHeaderClockProps {
  compact: boolean;
  moduleLabel: string;
  testTakerId?: string | undefined;
  autoSaveStatus?: 'saved' | 'saving' | 'syncing' | 'offline' | null | undefined;
  highlightEnabled?: boolean | undefined;
  highlightToolMode?: StudentHighlightToolMode | undefined;
  highlightColor?: StudentHighlightColor | undefined;
  onToggleHighlightMode?: (() => void) | undefined;
  onSelectHighlightColor?: ((color: StudentHighlightColor) => void) | undefined;
  onSelectEraseMode?: (() => void) | undefined;
  onOpenAccessibility?: (() => void) | undefined;
  onOpenNavigator?: (() => void) | undefined;
  tabletMode?: boolean | undefined;
  isExamActive?: boolean | undefined;
}

export const StudentExamHeaderClock = React.memo(function StudentExamHeaderClock({
  compact,
  moduleLabel,
  testTakerId,
  autoSaveStatus,
  highlightEnabled,
  highlightToolMode,
  highlightColor,
  onToggleHighlightMode,
  onSelectHighlightColor,
  onSelectEraseMode,
  onOpenAccessibility,
  onOpenNavigator,
  tabletMode,
  isExamActive,
}: StudentExamHeaderClockProps) {
  const timeRemaining = useStudentRuntimeClock();

  if (compact) {
    return (
      <CompactStudentHeader
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
        onOpenAccessibility={onOpenAccessibility}
        onOpenNavigator={onOpenNavigator}
      />
    );
  }

  return (
    <StudentHeader
      testTakerId={testTakerId}
      timeRemaining={timeRemaining}
      autoSaveStatus={autoSaveStatus}
      highlightEnabled={highlightEnabled}
      highlightToolMode={highlightToolMode}
      highlightColor={highlightColor}
      onToggleHighlightMode={onToggleHighlightMode}
      onSelectHighlightColor={onSelectHighlightColor}
      onSelectEraseMode={onSelectEraseMode}
      onOpenAccessibility={onOpenAccessibility}
      onOpenNavigator={onOpenNavigator}
      tabletMode={tabletMode}
      isExamActive={isExamActive}
    />
  );
});
