import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Bell, LayoutDashboard, LogOut, Search } from 'lucide-react';
import { ProctorProps } from '../../features/proctor/contracts';
import { useAuthSession } from '../../features/auth/authSession';
import { ProctorDashboard } from './ProctorDashboard';
import { AlertPanel } from './AlertPanel';

function getInitials(name: string) {
  const tokens = name.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return 'P';
  }

  if (tokens.length === 1) {
    return tokens[0]?.slice(0, 2).toUpperCase() ?? 'P';
  }

  const first = tokens[0]?.[0] ?? 'P';
  const last = tokens[tokens.length - 1]?.[0] ?? '';
  return `${first}${last}`.toUpperCase();
}

function formatRefreshAge(refreshAt: string | null | undefined, nowMs: number): string | null {
  if (!refreshAt) return null;
  const atMs = Date.parse(refreshAt);
  if (!Number.isFinite(atMs)) return null;
  const ageSeconds = Math.max(0, Math.floor((nowMs - atMs) / 1000));
  return `updated ${ageSeconds}s ago`;
}

export function ProctorApp({
  schedules,
  runtimeSnapshots,
  scheduleMetrics,
  sessions,
  alerts,
  auditLogs,
  notes,
  violationRules,
  connectionError,
  degradedLiveMode,
  wsConnected,
  lastSuccessfulRefreshAt,
  selectedScheduleId,
  onSelectScheduleId,
  onExit,
  onSwitchToSat,
  onUpdateSessions,
  onUpdateAlerts,
  onUpdateNotes,
  onUpdateRules,
  onStartScheduledSession,
  onPauseCohort,
  onResumeCohort,
  onEndSectionNow,
  onExtendCurrentSection,
  onCompleteExam,
  onOpenAnswerHistory,
}: ProctorProps) {
  const { session } = useAuthSession();
  const [searchQuery, setSearchQuery] = useState('');
  const [isAlertsOpen, setIsAlertsOpen] = useState(false);
  const unacknowledgedAlerts = useMemo(() => alerts.filter((alert) => !alert.isAcknowledged), [alerts]);
  const proctorName =
    session?.user.displayName?.trim() ||
    session?.user.email ||
    'Proctor';
  const proctorId = session?.user.id;
  const initials = getInitials(proctorName);
  const [pillNowMs, setPillNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!lastSuccessfulRefreshAt) return;
    const timer = window.setInterval(() => setPillNowMs(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [lastSuccessfulRefreshAt]);

  const degraded = degradedLiveMode === true || wsConnected === false;
  const offline = wsConnected === false && Boolean(connectionError);
  const reconnecting = Boolean(connectionError) && !offline;
  const pillState: 'live' | 'degraded' | 'reconnecting' | 'offline' = offline
    ? 'offline'
    : reconnecting
      ? 'reconnecting'
      : degraded
        ? 'degraded'
        : 'live';
  const refreshAgeLabel = formatRefreshAge(lastSuccessfulRefreshAt, pillNowMs);
  const pillStyles: Record<typeof pillState, { container: string; dot: string; label: string }> = {
    live: {
      container: 'bg-green-50 text-green-700 border-green-100',
      dot: 'bg-green-500 animate-pulse motion-reduce:animate-none',
      label: 'Live',
    },
    degraded: {
      container: 'bg-amber-50 text-amber-700 border-amber-100',
      dot: 'bg-amber-500',
      label: 'Degraded',
    },
    reconnecting: {
      container: 'bg-amber-50 text-amber-700 border-amber-100',
      dot: 'bg-amber-500',
      label: 'Reconnecting',
    },
    offline: {
      container: 'bg-red-50 text-red-700 border-red-100',
      dot: 'bg-red-500',
      label: 'Offline',
    },
  };
  const pillStyle = pillStyles[pillState];

  useEffect(() => {
    if (!isAlertsOpen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsAlertsOpen(false);
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isAlertsOpen]);

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
                <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-400">IELTS</p>
                <div className="flex items-center gap-2">
                  <LayoutDashboard size={16} className="text-slate-500" />
                  <span className="text-sm font-semibold text-slate-900">Proctoring</span>
                </div>
              </div>
            </div>
            {onSwitchToSat ? (
              <button
                type="button"
                onClick={onSwitchToSat}
                className="hidden min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-[10px] font-semibold text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 lg:flex"
              >
                Digital SAT
                <ArrowRight size={12} aria-hidden="true" />
              </button>
            ) : null}
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
              className={`flex items-center gap-2 px-3 py-1 rounded-full border ${pillStyle.container}`}
              role="status"
              aria-live="polite"
              title={connectionError ?? undefined}
            >
              <div
                className={`w-2 h-2 rounded-full ${pillStyle.dot}`}
                aria-hidden="true"
              ></div>
              <span className="text-xs font-bold uppercase tracking-wider">{pillStyle.label}</span>
              {refreshAgeLabel ? (
                <span className="text-[10px] font-medium normal-case tracking-normal opacity-80">{refreshAgeLabel}</span>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => setIsAlertsOpen(true)}
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
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center font-bold text-sm">
                {initials}
              </div>
              <div className="hidden md:block text-sm text-left">
                <p className="font-medium text-gray-900 leading-none">{proctorName}</p>
                <p className="text-xs text-gray-500 mt-1">{session?.user.role ?? 'proctor'}</p>
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
            scheduleMetrics={scheduleMetrics}
            sessions={sessions}
            alerts={alerts}
            currentProctorId={proctorId}
            currentProctorName={proctorName}
            searchQuery={searchQuery}
            railSelection="dashboard"
            auditLogs={auditLogs}
            notes={notes}
            violationRules={violationRules}
            selectedScheduleId={selectedScheduleId}
            onSelectScheduleId={onSelectScheduleId}
            onUpdateSessions={onUpdateSessions}
            onUpdateAlerts={onUpdateAlerts}
            onUpdateNotes={onUpdateNotes}
            onUpdateRules={onUpdateRules}
            onStartScheduledSession={onStartScheduledSession}
            onPauseCohort={onPauseCohort}
            onResumeCohort={onResumeCohort}
            onEndSectionNow={onEndSectionNow}
            onExtendCurrentSection={onExtendCurrentSection}
            onCompleteExam={onCompleteExam}
            onOpenAnswerHistory={onOpenAnswerHistory}
          />
        </main>
      </div>

      {isAlertsOpen ? (
        <div
          className="fixed inset-0 z-50"
          role="dialog"
          aria-modal="true"
          aria-label="Alert management"
        >
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            aria-label="Close alert management"
            onClick={() => setIsAlertsOpen(false)}
          />
          <div
            className="absolute right-0 top-0 h-full w-full max-w-xl bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <AlertPanel
              alerts={alerts}
              onUpdateAlerts={onUpdateAlerts}
              onClose={() => setIsAlertsOpen(false)}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
