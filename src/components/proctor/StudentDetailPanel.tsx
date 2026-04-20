import React, { useMemo, useState } from 'react';
import { AlertTriangle, History, MessageSquare, Pause, Play, UserX, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import type { ExamGroup, NoteCategory, ProctorAlert, SessionAuditLog, SessionNote, StudentSession } from '../../types';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';

export type StudentDrawerTab = 'timeline' | 'violations' | 'notes' | 'audit';

interface StudentDetailPanelProps {
  student: StudentSession | undefined;
  cohort: ExamGroup | undefined;
  alerts: ProctorAlert[];
  auditLogs: SessionAuditLog[];
  notes: SessionNote[];
  activeTab: StudentDrawerTab;
  onTabChange: (tab: StudentDrawerTab) => void;
  onClose: () => void;
  onAction: (action: 'warn' | 'pause' | 'resume' | 'terminate', payload?: unknown) => void;
  onSaveNote?: (content: string, category: NoteCategory) => void;
  onToggleNote?: (noteId: string) => void;
}

const formatTime = (seconds: number) => {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const remainingSeconds = safe % 60;
  return `${hours > 0 ? `${hours}:` : ''}${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
};

export function StudentDetailPanel({
  student,
  cohort,
  alerts,
  auditLogs,
  notes,
  activeTab,
  onTabChange,
  onClose,
  onAction,
  onSaveNote,
  onToggleNote,
}: StudentDetailPanelProps) {
  const [draftNote, setDraftNote] = useState('');
  const [draftCategory, setDraftCategory] = useState<NoteCategory>('general');

  const studentNotes = useMemo(
    () =>
      notes.filter(
        (note) =>
          note.scheduleId === cohort?.scheduleId &&
          (!student || note.content.toLowerCase().includes(student.name.toLowerCase()) || note.content.includes(student.studentId)),
      ),
    [cohort?.scheduleId, notes, student],
  );
  const studentAuditLogs = useMemo(
    () => auditLogs.filter((log) => !student || !log.targetStudentId || log.targetStudentId === student.id),
    [auditLogs, student],
  );
  const studentAlerts = useMemo(
    () => alerts.filter((alert) => !student || alert.studentId === student.studentId),
    [alerts, student],
  );
  const timelineEvents = useMemo(() => {
    type TimelineEvent = {
      id: string;
      timestamp: string;
      title: string;
      detail: string;
    };

    const events: TimelineEvent[] = [];

    for (const log of studentAuditLogs) {
      events.push({
        id: `audit-${log.id}`,
        timestamp: log.timestamp,
        title: log.actionType,
        detail: log.actor,
      });
    }

    for (const alert of studentAlerts) {
      events.push({
        id: `alert-${alert.id}`,
        timestamp: alert.timestamp,
        title: alert.message,
        detail: `${alert.type} · ${alert.severity}`,
      });
    }

    for (const violation of student?.violations ?? []) {
      events.push({
        id: `violation-${violation.id}`,
        timestamp: violation.timestamp,
        title: violation.type,
        detail: violation.description,
      });
    }

    events.sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime());
    return events;
  }, [student?.violations, studentAlerts, studentAuditLogs]);

  if (!student || !cohort) {
    return (
      <div className="border border-slate-200 bg-white px-6 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-500">
          <div className="flex flex-wrap items-center gap-4">
            <span>{cohort ? `${cohort.cohortName} selected` : 'No cohort selected'}</span>
            <span>{alerts.filter((alert) => !alert.isAcknowledged).length} open alerts</span>
            <span>{notes.length} notes</span>
            <span>{auditLogs.length} audit events</span>
          </div>
          <span>Select a student to expand the activity drawer.</span>
        </div>
      </div>
    );
  }

  const runtimeSection = student.runtimeCurrentSection ?? student.currentSection ?? 'waiting';
  const runtimeRemaining = student.runtimeTimeRemainingSeconds ?? student.timeRemaining;
  const tabClass = (tab: StudentDrawerTab) =>
    `inline-flex items-center gap-2 border-b-2 px-3 py-3 text-sm font-medium ${
      activeTab === tab ? 'border-slate-950 text-slate-950' : 'border-transparent text-slate-500 hover:text-slate-800'
    }`;

  return (
    <AnimatePresence initial={false}>
      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 16 }}
        transition={{ type: 'spring', stiffness: 240, damping: 28 }}
        className="grid h-full min-h-[560px] grid-rows-[auto_auto_1fr_auto] border border-slate-200 bg-white"
      >
        <div className="grid gap-4 border-b border-slate-200 px-6 py-4 lg:grid-cols-[minmax(0,1fr)_auto]">
          <div className="grid gap-3">
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-full bg-slate-100 text-sm font-semibold text-slate-700">
                {student.name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase()}
              </div>
              <div>
                <h3 className="text-lg font-semibold text-slate-950">{student.name}</h3>
                <p className="text-sm text-slate-500">{student.studentId} · {student.email}</p>
              </div>
              <Badge variant={student.status === 'active' ? 'success' : student.status === 'warned' ? 'warning' : student.status === 'paused' ? 'paused' : student.status === 'terminated' ? 'danger' : 'neutral'}>
                {student.status}
              </Badge>
            </div>
            <div className="grid gap-3 text-sm text-slate-600 md:grid-cols-4">
              <div>
                <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Section</p>
                <p className="mt-1 font-medium capitalize text-slate-900">{runtimeSection}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Time left</p>
                <p className="mt-1 font-medium text-slate-900">{formatTime(runtimeRemaining)}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Violations</p>
                <p className="mt-1 font-medium text-slate-900">{student.violations.length}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Warnings</p>
                <p className="mt-1 font-medium text-slate-900">{student.warnings}</p>
              </div>
            </div>
          </div>
          <button onClick={onClose} className="justify-self-end rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900" aria-label="Close student details">
            <X size={18} />
          </button>
        </div>

        <div className="flex items-center gap-1 overflow-x-auto border-b border-slate-200 px-6">
          <button onClick={() => onTabChange('timeline')} className={tabClass('timeline')}><History size={16} />Timeline</button>
          <button onClick={() => onTabChange('violations')} className={tabClass('violations')}><AlertTriangle size={16} />Violations</button>
          <button onClick={() => onTabChange('notes')} className={tabClass('notes')}><MessageSquare size={16} />Notes</button>
          <button onClick={() => onTabChange('audit')} className={tabClass('audit')}><History size={16} />Audit</button>
        </div>

        <div className="min-h-0 overflow-auto px-6 py-4">
          {activeTab === 'timeline' ? (
            <div className="grid gap-3">
              {timelineEvents.length === 0 ? <p className="text-sm text-slate-500">No recent timeline events for this student.</p> : null}
              {timelineEvents.map((event) => (
                <div key={event.id} className="grid gap-1 border-b border-slate-100 pb-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-medium text-slate-900">{event.title}</p>
                    <span className="text-xs text-slate-400">{new Date(event.timestamp).toLocaleString()}</span>
                  </div>
                  <p className="text-sm text-slate-500">{event.detail}</p>
                </div>
              ))}
            </div>
          ) : null}
          {activeTab === 'violations' ? (
            <div className="grid gap-3">
              {student.violations.length === 0 ? <p className="text-sm text-slate-500">No violations recorded for this student.</p> : null}
              {student.violations.map((violation) => (
                <div key={violation.id} className="grid gap-1 border-b border-slate-100 pb-3">
                  <div className="flex items-center gap-2">
                    <Badge variant={violation.severity === 'critical' ? 'danger' : violation.severity === 'medium' ? 'warning' : 'info'}>{violation.severity}</Badge>
                    <p className="font-medium text-slate-900">{violation.type}</p>
                  </div>
                  <p className="text-sm text-slate-500">{violation.description}</p>
                </div>
              ))}
            </div>
          ) : null}
          {activeTab === 'notes' ? (
            <div className="grid gap-4">
              <div className="grid gap-3 rounded-md bg-slate-50 p-4 md:grid-cols-[140px_minmax(0,1fr)_auto]">
                <select value={draftCategory} onChange={(event) => setDraftCategory(event.target.value as NoteCategory)} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none">
                  <option value="general">General</option>
                  <option value="incident">Incident</option>
                  <option value="handover">Handover</option>
                </select>
                <input value={draftNote} onChange={(event) => setDraftNote(event.target.value)} placeholder="Add note to this cohort or student" className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none" />
                <button onClick={() => { if (!draftNote.trim()) return; onSaveNote?.(draftNote.trim(), draftCategory); setDraftNote(''); setDraftCategory('general'); }} className="rounded-md bg-slate-950 px-4 py-2 text-sm font-medium text-white">Save note</button>
              </div>
              <div className="grid gap-3">
                {studentNotes.length === 0 ? <p className="text-sm text-slate-500">No notes scoped to this student yet.</p> : null}
                {studentNotes.map((note) => (
                  <div key={note.id} className="grid gap-1 border-b border-slate-100 pb-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <Badge variant={note.category === 'incident' ? 'danger' : note.category === 'handover' ? 'warning' : 'info'}>{note.category}</Badge>
                        {note.isResolved ? <Badge variant="success">resolved</Badge> : null}
                      </div>
                      <button onClick={() => onToggleNote?.(note.id)} className="text-xs font-medium text-slate-500 hover:text-slate-900">{note.isResolved ? 'Reopen' : 'Resolve'}</button>
                    </div>
                    <p className="text-sm text-slate-900">{note.content}</p>
                    <p className="text-xs text-slate-400">{note.author} · {new Date(note.timestamp).toLocaleString()}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {activeTab === 'audit' ? (
            <div className="grid gap-3">
              {studentAuditLogs.length === 0 ? <p className="text-sm text-slate-500">No audit events scoped to this student.</p> : null}
              {studentAuditLogs.map((log) => (
                <div key={log.id} className="grid gap-1 border-b border-slate-100 pb-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-medium text-slate-900">{log.actionType}</p>
                    <span className="text-xs text-slate-400">{new Date(log.timestamp).toLocaleString()}</span>
                  </div>
                  <p className="text-sm text-slate-500">{log.actor}</p>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-6 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="warning" size="sm" leftIcon={<AlertTriangle size={14} />} onClick={() => onAction('warn')}>Warn</Button>
            {student.status === 'paused' ? (
              <Button variant="primary" size="sm" leftIcon={<Play size={14} />} onClick={() => onAction('resume')}>Resume</Button>
            ) : (
              <Button variant="secondary" size="sm" leftIcon={<Pause size={14} />} onClick={() => onAction('pause')}>Pause</Button>
            )}
            <Button variant="danger" size="sm" leftIcon={<UserX size={14} />} onClick={() => onAction('terminate')}>Terminate</Button>
          </div>
          <div className="text-xs text-slate-400">Activity system scoped to {cohort.cohortName}</div>
        </div>
      </motion.section>
    </AnimatePresence>
  );
}
