import React, { useMemo, useState } from 'react';
import { Bell, LayoutDashboard, LogOut, Search } from 'lucide-react';
import { ProctorProps } from '../../features/proctor/contracts';
import { ProctorDashboard } from './ProctorDashboard';

export function ProctorApp({
  schedules,
  runtimeSnapshots,
  sessions,
  alerts,
  auditLogs,
  notes,
  onExit,
  onUpdateSessions,
  onUpdateAlerts,
  onUpdateNotes,
  onStartScheduledSession,
  onPauseCohort,
  onResumeCohort,
  onEndSectionNow,
  onExtendCurrentSection,
  onCompleteExam,
}: ProctorProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const unacknowledgedAlerts = useMemo(() => alerts.filter((alert) => !alert.isAcknowledged), [alerts]);

  return (
    <div className="flex h-screen w-full bg-gray-50 text-gray-900 font-sans overflow-hidden">
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <header
          className="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-6 flex-shrink-0"
          role="banner"
        >
          <div className="flex items-center gap-4 flex-1">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-8 h-8 bg-slate-900 rounded flex items-center justify-center text-white font-bold">
                P
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-400">Workspace</p>
                <div className="flex items-center gap-2">
                  <LayoutDashboard size={16} className="text-slate-500" />
                  <span className="text-sm font-semibold text-slate-900">Monitoring</span>
                </div>
              </div>
            </div>
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
            <button
              onClick={onExit}
              className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800"
            >
              <LogOut size={16} />
              <span className="hidden sm:inline">Exit Proctor</span>
            </button>
          </div>
        </header>

        <main id="main-content" className="flex-1 overflow-hidden bg-gray-50" role="main">
          <ProctorDashboard
            schedules={schedules}
            runtimeSnapshots={runtimeSnapshots}
            sessions={sessions}
            alerts={alerts}
            searchQuery={searchQuery}
            railSelection="dashboard"
            auditLogs={auditLogs}
            notes={notes}
            onUpdateSessions={onUpdateSessions}
            onUpdateAlerts={onUpdateAlerts}
            onUpdateNotes={onUpdateNotes}
            onStartScheduledSession={onStartScheduledSession}
            onPauseCohort={onPauseCohort}
            onResumeCohort={onResumeCohort}
            onEndSectionNow={onEndSectionNow}
            onExtendCurrentSection={onExtendCurrentSection}
            onCompleteExam={onCompleteExam}
          />
        </main>
      </div>
    </div>
  );
}
