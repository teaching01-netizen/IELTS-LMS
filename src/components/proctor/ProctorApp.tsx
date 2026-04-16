import React, { useState, useMemo } from 'react';
import { Bell, LayoutDashboard, LogOut, Menu, Search, AlertTriangle, FileText, MessageSquare } from 'lucide-react';
import { ProctorProps } from '../../features/proctor/contracts';
import { ProctorDashboard } from './ProctorDashboard';
import { AlertPanel } from './AlertPanel';
import { AuditLogPanel } from './AuditLogPanel';
import { SessionNotesPanel } from './SessionNotesPanel';
import { SessionAuditLog, SessionNote } from '../../types';

export function ProctorApp({
  schedules,
  runtimeSnapshots,
  sessions,
  alerts,
  onExit,
  onUpdateSessions,
  onUpdateAlerts,
  onStartScheduledSession,
  onPauseCohort,
  onResumeCohort,
  onEndSectionNow,
  onExtendCurrentSection,
  onCompleteExam,
}: ProctorProps) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentView, setCurrentView] = useState<'dashboard' | 'alerts' | 'audit' | 'notes'>('dashboard');
  const [auditLogs, setAuditLogs] = useState<SessionAuditLog[]>([]);
  const [sessionNotes, setSessionNotes] = useState<SessionNote[]>([]);

  const unacknowledgedAlerts = useMemo(() => alerts.filter((alert) => !alert.isAcknowledged), [alerts]);
  const unresolvedNotes = useMemo(() => sessionNotes.filter((note) => !note.isResolved), [sessionNotes]);

  return (
    <div className="flex h-screen w-full bg-gray-50 text-gray-900 font-sans overflow-hidden">
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      <aside
        className={`flex flex-col bg-slate-900 text-slate-300 transition-all duration-300 ${
          sidebarOpen ? 'w-64' : 'w-16'
        }`}
        role="navigation"
        aria-label="Proctor navigation"
      >
        <div className="h-14 flex items-center justify-between px-4 border-b border-slate-800">
          {sidebarOpen ? (
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-blue-600 rounded flex items-center justify-center text-white font-bold">
                P
              </div>
              <span className="font-bold text-white truncate">IELTS Proctor</span>
            </div>
          ) : null}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-1 hover:bg-slate-800 rounded text-slate-400"
            aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
          >
            <Menu size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto py-4">
          <nav className="space-y-1 px-2" aria-label="Main navigation">
            <button
              onClick={() => setCurrentView('dashboard')}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${
                currentView === 'dashboard' ? 'bg-blue-600 text-white' : 'hover:bg-slate-800'
              }`}
              aria-current={currentView === 'dashboard' ? 'page' : undefined}
            >
              <LayoutDashboard size={20} />
              {sidebarOpen ? <span className="text-sm font-medium">Monitoring</span> : null}
            </button>
            <button
              onClick={() => setCurrentView('alerts')}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${
                currentView === 'alerts' ? 'bg-blue-600 text-white' : 'hover:bg-slate-800'
              }`}
              aria-current={currentView === 'alerts' ? 'page' : undefined}
            >
              <AlertTriangle size={20} />
              {sidebarOpen ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">Alerts</span>
                  {unacknowledgedAlerts.length > 0 && (
                    <span className="px-1.5 py-0.5 bg-red-500 text-white text-xs font-bold rounded-full">
                      {unacknowledgedAlerts.length}
                    </span>
                  )}
                </div>
              ) : null}
              {!sidebarOpen && unacknowledgedAlerts.length > 0 && (
                <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full" />
              )}
            </button>
            <button
              onClick={() => setCurrentView('audit')}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${
                currentView === 'audit' ? 'bg-blue-600 text-white' : 'hover:bg-slate-800'
              }`}
              aria-current={currentView === 'audit' ? 'page' : undefined}
            >
              <FileText size={20} />
              {sidebarOpen ? <span className="text-sm font-medium">Audit Trail</span> : null}
            </button>
            <button
              onClick={() => setCurrentView('notes')}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${
                currentView === 'notes' ? 'bg-blue-600 text-white' : 'hover:bg-slate-800'
              }`}
              aria-current={currentView === 'notes' ? 'page' : undefined}
            >
              <MessageSquare size={20} />
              {sidebarOpen ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">Notes</span>
                  {unresolvedNotes.length > 0 && (
                    <span className="px-1.5 py-0.5 bg-orange-500 text-white text-xs font-bold rounded-full">
                      {unresolvedNotes.length}
                    </span>
                  )}
                </div>
              ) : null}
              {!sidebarOpen && unresolvedNotes.length > 0 && (
                <span className="absolute top-1 right-1 w-2 h-2 bg-orange-500 rounded-full" />
              )}
            </button>
          </nav>
        </div>

        <div className="p-4 border-t border-slate-800">
          <button
            onClick={onExit}
            className="w-full flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 text-white py-2 rounded-md text-sm transition-colors"
          >
            <LogOut size={16} />
            {sidebarOpen ? <span>Exit Proctor</span> : null}
          </button>
        </div>
      </aside>

      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <header
          className="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-6 flex-shrink-0"
          role="banner"
        >
          <div className="flex items-center gap-4 flex-1">
            <div className="relative w-64">
              <Search className="absolute left-2.5 top-2 text-gray-400" size={16} />
              <input
                type="text"
                placeholder="Search students..."
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                className="w-full pl-9 pr-4 py-1.5 bg-gray-100 border-transparent rounded-md text-sm focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition-all"
                aria-label="Search students"
              />
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div
              className="flex items-center gap-2 px-3 py-1 bg-green-50 text-green-700 rounded-full border border-green-100"
              role="status"
              aria-live="polite"
            >
              <div
                className="w-2 h-2 bg-green-500 rounded-full animate-pulse"
                aria-hidden="true"
              ></div>
              <span className="text-xs font-bold uppercase tracking-wider">Live</span>
            </div>
            <button
              className="relative p-2 text-gray-500 hover:bg-gray-100 rounded-full"
              aria-label={`Notifications, ${unacknowledgedAlerts.length} unacknowledged`}
              aria-live="polite"
              aria-atomic="true"
            >
              <Bell size={20} />
              {unacknowledgedAlerts.length > 0 ? (
                <span
                  className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full border border-white"
                  aria-hidden="true"
                ></span>
              ) : null}
            </button>
            <div className="flex items-center gap-2 cursor-pointer">
              <div className="w-8 h-8 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center font-bold text-sm">
                SK
              </div>
              <div className="hidden md:block text-sm text-left">
                <p className="font-medium text-gray-900 leading-none">Sarah K.</p>
                <p className="text-xs text-gray-500 mt-1">Proctor</p>
              </div>
            </div>
          </div>
        </header>

        <main id="main-content" className="flex-1 overflow-hidden bg-gray-50" role="main">
          {currentView === 'dashboard' ? (
            <ProctorDashboard
              schedules={schedules}
              runtimeSnapshots={runtimeSnapshots}
              sessions={sessions}
              alerts={alerts}
              searchQuery={searchQuery}
              onUpdateSessions={onUpdateSessions}
              onUpdateAlerts={onUpdateAlerts}
              onStartScheduledSession={onStartScheduledSession}
              onPauseCohort={onPauseCohort}
              onResumeCohort={onResumeCohort}
              onEndSectionNow={onEndSectionNow}
              onExtendCurrentSection={onExtendCurrentSection}
              onCompleteExam={onCompleteExam}
            />
          ) : currentView === 'alerts' ? (
            <AlertPanel
              alerts={alerts}
              onUpdateAlerts={onUpdateAlerts}
              onClose={() => setCurrentView('dashboard')}
            />
          ) : currentView === 'audit' ? (
            <AuditLogPanel
              auditLogs={auditLogs}
              sessionId={schedules[0]?.id || ''}
              onClose={() => setCurrentView('dashboard')}
            />
          ) : (
            <SessionNotesPanel
              notes={sessionNotes}
              scheduleId={schedules[0]?.id || ''}
              currentProctor="Sarah K."
              onUpdateNotes={setSessionNotes}
              onClose={() => setCurrentView('dashboard')}
            />
          )}
        </main>
      </div>
    </div>
  );
}
