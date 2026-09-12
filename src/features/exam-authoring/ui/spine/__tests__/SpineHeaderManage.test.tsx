import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SpineHeader, type SpineHeaderProps } from '../SpineHeader';
function props(overrides: Partial<SpineHeaderProps> = {}): SpineHeaderProps { return {
 examTitle:'SAT Practice 1', sectionTitle:'Reading & Writing', moduleTitle:'Module 1',
 issueCount:2, workspaceMode:'build', onModeChange:vi.fn(), workbookImportDisabled:false, onOpenWorkbookImport:vi.fn(),
 sampleExamDisabled:false, onOpenSampleExam:vi.fn(), onOpenShortcuts:vi.fn(), previewDisabled:false, onOpenFullPreview:vi.fn(), onOpenRelease:vi.fn(), onBack:vi.fn(), onOpenQueue:vi.fn(), ...overrides,
}; }
describe('SpineHeader actions',()=>{
 it('keeps one preview and release action, with imports behind overflow',()=>{
 const onOpenWorkbookImport=vi.fn(), onOpenFullPreview=vi.fn(), onOpenRelease=vi.fn();
 render(<SpineHeader {...props({onOpenWorkbookImport,onOpenFullPreview,onOpenRelease})} />);
 fireEvent.click(screen.getByRole('button',{name:'More authoring actions'})); fireEvent.click(screen.getByRole('menuitem',{name:'Import from workbook'}));
 fireEvent.click(screen.getByRole('button',{name:'Open the full SAT preview'})); fireEvent.click(screen.getByRole('button',{name:'Release'}));
 expect(onOpenWorkbookImport).toHaveBeenCalledOnce(); expect(onOpenFullPreview).toHaveBeenCalledOnce(); expect(onOpenRelease).toHaveBeenCalledOnce();
 });
 it('never renders zero-error filler',()=>{render(<SpineHeader {...props({issueCount:0})} />); fireEvent.click(screen.getByRole('button',{name:'More authoring actions'})); expect(screen.getByRole('menuitem',{name:'Review issues'})).toBeInTheDocument(); expect(screen.queryByText(/issues \(0\)/i)).not.toBeInTheDocument();});
});
