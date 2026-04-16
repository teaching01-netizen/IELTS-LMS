import React from 'react';
import { Outlet } from 'react-router-dom';

/**
 * AppShell - Thin Composition Layer
 * 
 * This is now a thin composition layer that renders child routes.
 * All domain orchestration logic has been moved to individual feature routes.
 * 
 * Previous responsibilities (moved to feature routes):
 * - Exam initialization and migration → AdminRoot
 * - Grading data seeding → AdminRoot (or dedicated dev fixture)
 * - Schedule loading → AdminRoot, ProctorRoot
 * - Runtime polling → ProctorRoot, StudentSessionRoute
 * - Manual pathname parsing → Router configuration
 * - Domain state management → Feature routes
 * 
 * Current responsibilities:
 * - Render child routes via Outlet
 * - Future: Global error boundary
 * - Future: Global providers (theme, error reporting)
 */
export function AppShell() {
  return <Outlet />;
}
