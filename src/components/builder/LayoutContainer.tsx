import React, { useState, useEffect } from 'react';
import { ExamState } from '../../types';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export interface LayoutContainerProps {
  state: ExamState;
  leftPanel?: React.ReactNode;
  centerPanel?: React.ReactNode;
  rightPanel?: React.ReactNode;
  asidePanel?: React.ReactNode;
  className?: string;
}

/**
 * LayoutContainer - Responsive grid layout container for builder panels
 * 
 * This component manages the responsive grid behavior for the builder interface,
 * adapting the layout based on screen size and available panels.
 * 
 * Layout structure:
 * - Left panel (navigation/passage list): Fixed width, collapsible on smaller screens
 * - Center panel (content editor): Flexible, takes available space
 * - Right panel (questions): Fixed width, collapsible on smaller screens
 * - Aside panel (scoring/grading): Fixed width, optional
 * 
 * Responsive behavior:
 * - Desktop (> 1024px): All panels visible with resizable dividers
 * - Tablet (768px - 1024px): Left and right panels collapsible
 * - Mobile (< 768px): Single panel visible at a time with drawer navigation
 */
export function LayoutContainer({
  leftPanel,
  centerPanel,
  rightPanel,
  asidePanel,
  className = ''
}: LayoutContainerProps) {
  return (
    <div className={`flex-1 flex overflow-hidden transition-opacity duration-200 ${className}`}>
      {/* Left Panel */}
      {leftPanel && (
        <>
          {leftPanel}
          <div className="w-1 bg-gray-200 hover:bg-blue-400 cursor-col-resize transition-colors z-10" />
        </>
      )}

      {/* Center Panel */}
      {centerPanel && (
        <>
          {centerPanel}
          {rightPanel && <div className="w-1 bg-gray-200 hover:bg-blue-400 cursor-col-resize transition-colors z-10" />}
        </>
      )}

      {/* Right Panel */}
      {rightPanel && rightPanel}

      {/* Aside Panel (optional, e.g., scoring) */}
      {asidePanel && asidePanel}
    </div>
  );
}
