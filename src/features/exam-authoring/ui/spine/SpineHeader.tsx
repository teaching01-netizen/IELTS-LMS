import type { ReactNode } from 'react';
import { ArrowLeft, MoreHorizontal } from 'lucide-react';
import { SatMenu } from '@/src/products/sat/ui/Menu';

export type SpineLifecycleState = 'draft' | 'changes' | 'published';
export interface SpineHeaderProps {
  examTitle: string;
  sectionTitle: string | null;
  moduleTitle: string | null;
  lifecycleState?: SpineLifecycleState;
  workspaceMode: 'build' | 'overview' | 'issues';
  onModeChange: (mode: 'build' | 'overview' | 'issues') => void;
  issueCount: number;
  saveSlot?: ReactNode;
  /**
   * Phase 05 collaboration cluster (WHO is here + the subtle editing label).
   * Receives plain nodes so the header stays presence-agnostic.
   */
  collaborationSlot?: ReactNode;
  workbookImportDisabled: boolean;
  onOpenWorkbookImport: () => void;
  sampleExamDisabled: boolean;
  onOpenSampleExam: () => void;
  onOpenShortcuts: () => void;
  previewDisabled: boolean;
  onOpenFullPreview: () => void;
  onOpenRelease: () => void;
  onBack: () => void;
  /** Compact navigator access must also work when no question is selected. */
  onOpenQueue: () => void;
}

/** Exam actions only. Question readiness belongs beside the question. */
export function SpineHeader({ examTitle, sectionTitle, moduleTitle, lifecycleState = 'draft',
  workspaceMode, onModeChange, issueCount, saveSlot, collaborationSlot, workbookImportDisabled, onOpenWorkbookImport,
  sampleExamDisabled, onOpenSampleExam, onOpenShortcuts, previewDisabled, onOpenFullPreview,
  onOpenRelease, onBack, onOpenQueue }: SpineHeaderProps) {
  const lifecycle = lifecycleState === 'published' ? 'Published' : lifecycleState === 'changes' ? 'Changes' : 'Draft';
  return (
    <header className="sat-spine__header shrink-0 border-b border-border bg-card">
      <div className="flex min-h-16 items-center gap-3 px-4 sm:px-6">
        <button type="button" onClick={onBack} aria-label="Back to SAT Exam Library" className="authoring-button authoring-button--quiet min-h-11 min-w-11">
          <ArrowLeft size={17} aria-hidden="true" /><span className="hidden xl:inline">Exams</span>
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold text-foreground">{examTitle}</h1>
          <p className="truncate text-xs text-muted-foreground">{[sectionTitle, moduleTitle, lifecycle].filter(Boolean).join(' · ')}</p>
        </div>
        {collaborationSlot ? (
          <div className="sat-spine__header-collaboration shrink-0">{collaborationSlot}</div>
        ) : null}
        {saveSlot ? <div className="sat-spine__header-save shrink-0">{saveSlot}</div> : null}
        <button type="button" onClick={onOpenFullPreview} disabled={previewDisabled} aria-label="Open the full SAT preview" className="authoring-button authoring-button--quiet min-h-11">Preview</button>
        <button type="button" onClick={onOpenRelease} className="authoring-button authoring-button--primary min-h-11">Release</button>
        <div className="sat-spine__menu">
          <SatMenu compact label="More authoring actions" icon={MoreHorizontal} align="end" items={[
            { id: 'build', label: 'Question navigator', current: workspaceMode === 'build', onSelect: () => { onModeChange('build'); onOpenQueue(); } },
            { id: 'overview', label: 'Exam overview', current: workspaceMode === 'overview', onSelect: () => onModeChange('overview') },
            { id: 'issues', label: 'Review issues' + (issueCount > 0 ? ' (' + issueCount + ')' : ''), current: workspaceMode === 'issues', onSelect: () => onModeChange('issues') },
            { id: 'workbook', label: 'Import from workbook', separatorBefore: true, disabled: workbookImportDisabled, onSelect: onOpenWorkbookImport },
            { id: 'sample', label: 'Load sample exam…', disabled: sampleExamDisabled, onSelect: onOpenSampleExam },
            { id: 'shortcuts', label: 'Keyboard shortcuts', separatorBefore: true, onSelect: onOpenShortcuts },
          ]} />
        </div>
      </div>
    </header>
  );
}
