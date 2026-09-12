import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SpineHeader, type SpineHeaderProps } from '../SpineHeader';
function props(overrides: Partial<SpineHeaderProps> = {}): SpineHeaderProps { return {
 examTitle:'SAT Practice 1', sectionTitle:'Reading & Writing', moduleTitle:'Module 1',
 issueCount:2, workspaceMode:'build', onModeChange:vi.fn(), workbookImportDisabled:false, onOpenWorkbookImport:vi.fn(),
 sampleExamDisabled:false, onOpenSampleExam:vi.fn(), onOpenShortcuts:vi.fn(), previewDisabled:false, onOpenFullPreview:vi.fn(), onOpenRelease:vi.fn(), onBack:vi.fn(), onOpenQueue:vi.fn(), ...overrides,
}; }
describe('SpineHeader hierarchy', () => {
 it('keeps the exam title without a second progress or navigation control', () => {
  render(<SpineHeader {...props()} />);
  expect(screen.getByRole('heading',{name:'SAT Practice 1'})).toBeInTheDocument();
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  expect(screen.queryByRole('group',{name:'Authoring view'})).not.toBeInTheDocument();
 });
 it('keeps lifecycle copy truthful in the subtitle', () => {
  const {rerender}=render(<SpineHeader {...props()} />); expect(screen.getByText(/Module 1 · Draft/)).toBeInTheDocument();
  rerender(<SpineHeader {...props({lifecycleState:'published'})} />); expect(screen.getByText(/Module 1 · Published/)).toBeInTheDocument();
 });
 it('routes modes through one overflow menu including the way back to questions', () => {
  const onModeChange=vi.fn(); render(<SpineHeader {...props({onModeChange})} />);
  fireEvent.click(screen.getByRole('button',{name:'More authoring actions'}));
  fireEvent.click(screen.getByRole('menuitem',{name:'Review issues (2)'})); expect(onModeChange).toHaveBeenCalledWith('issues');
  fireEvent.click(screen.getByRole('button',{name:'More authoring actions'})); fireEvent.click(screen.getByRole('menuitem',{name:'Question navigator'})); expect(onModeChange).toHaveBeenCalledWith('build');
 });
 it('restores the sample load entry point and keeps busy guarding', () => {
  const onOpenSampleExam=vi.fn(); const {rerender}=render(<SpineHeader {...props({onOpenSampleExam})} />);
  fireEvent.click(screen.getByRole('button',{name:'More authoring actions'})); fireEvent.click(screen.getByRole('menuitem',{name:/Load sample exam/})); expect(onOpenSampleExam).toHaveBeenCalledOnce();
  rerender(<SpineHeader {...props({sampleExamDisabled:true})} />); fireEvent.click(screen.getByRole('button',{name:'More authoring actions'})); expect(screen.getByRole('menuitem',{name:/Load sample exam/})).toBeDisabled();
 });
});
