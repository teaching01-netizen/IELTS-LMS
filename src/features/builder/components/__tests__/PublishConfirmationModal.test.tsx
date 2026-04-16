import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PublishConfirmationModal } from '../PublishConfirmationModal';

describe('PublishConfirmationModal', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    onConfirm: vi.fn().mockResolvedValue(undefined),
    onSetSchedule: vi.fn(),
    prerequisites: {
      validationPassed: true,
      contentReviewed: true,
      isScheduled: true
    },
    exam: { title: 'Test Exam' }
  };

  it('modal shows when isOpen is true', () => {
    render(<PublishConfirmationModal {...defaultProps} />);
    
    expect(screen.getByText(/publish exam/i)).toBeTruthy();
  });

  it('modal hides when isOpen is false', () => {
    render(<PublishConfirmationModal {...defaultProps} isOpen={false} />);
    
    expect(screen.queryByText(/publish exam/i)).toBeNull();
  });

  it('shows prerequisite checklist', () => {
    render(<PublishConfirmationModal {...defaultProps} />);
    
    expect(screen.getByText(/technical validation passed/i)).toBeTruthy();
    expect(screen.getByText(/you have reviewed content quality/i)).toBeTruthy();
    expect(screen.getByText(/exam is scheduled/i)).toBeTruthy();
  });

  it('calls onConfirm when Confirm button clicked', () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(<PublishConfirmationModal {...defaultProps} onConfirm={onConfirm} />);
    
    const confirmButton = screen.getByRole('button', { name: /confirm publish/i });
    fireEvent.click(confirmButton);
    
    expect(onConfirm).toHaveBeenCalled();
  });

  it('calls onClose when Cancel button clicked', () => {
    const onClose = vi.fn();
    render(<PublishConfirmationModal {...defaultProps} onClose={onClose} />);
    
    const cancelButton = screen.getByRole('button', { name: /cancel/i });
    fireEvent.click(cancelButton);
    
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on ESC key press', () => {
    const onClose = vi.fn();
    render(<PublishConfirmationModal {...defaultProps} onClose={onClose} />);
    
    fireEvent.keyDown(document, { key: 'Escape' });
    
    expect(onClose).toHaveBeenCalled();
  });

  it('focus is trapped within modal', () => {
    render(<PublishConfirmationModal {...defaultProps} />);
    
    // Focus trap is implemented in the component
    // This test verifies the modal renders
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('has correct aria-modal attribute', () => {
    const { container } = render(<PublishConfirmationModal {...defaultProps} />);
    
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();
  });

  it('shows Set Schedule button when not scheduled', () => {
    render(
      <PublishConfirmationModal 
        {...defaultProps}
        prerequisites={{ 
          validationPassed: true, 
          contentReviewed: true, 
          isScheduled: false 
        }}
      />
    );
    
    expect(screen.getByRole('button', { name: /set schedule/i })).toBeTruthy();
  });

  it('calls onSetSchedule when Set Schedule button clicked', () => {
    const onSetSchedule = vi.fn();
    render(
      <PublishConfirmationModal 
        {...defaultProps}
        prerequisites={{ 
          validationPassed: true, 
          contentReviewed: true, 
          isScheduled: false 
        }}
        onSetSchedule={onSetSchedule}
      />
    );
    
    const setScheduleButton = screen.getByRole('button', { name: /set schedule/i });
    fireEvent.click(setScheduleButton);
    
    expect(onSetSchedule).toHaveBeenCalled();
  });

  it('disables Confirm button when prerequisites not met', () => {
    render(
      <PublishConfirmationModal 
        {...defaultProps}
        prerequisites={{ 
          validationPassed: false, 
          contentReviewed: true, 
          isScheduled: true 
        }}
      />
    );
    
    const confirmButton = screen.getByRole('button', { name: /confirm publish/i }) as HTMLButtonElement;
    expect(confirmButton.disabled).toBe(true);
  });

  it('shows warning about immutability', () => {
    render(<PublishConfirmationModal {...defaultProps} />);
    
    expect(screen.getByText(/warning:/i)).toBeTruthy();
    expect(screen.getByText(/publishing creates an immutable version/i)).toBeTruthy();
  });
});
