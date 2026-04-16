import React, { useState } from 'react';
import { 
  X, 
  Maximize2, 
  AlertTriangle, 
  Pause, 
  Play, 
  XCircle, 
  MessageSquare, 
  Timer, 
  Flag,
  History
} from 'lucide-react';
import { StudentSession } from '../../types';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { motion, AnimatePresence } from 'motion/react';

interface StudentDetailPanelProps {
  student: StudentSession | undefined;
  onClose: () => void;
  onAction: (action: 'warn' | 'pause' | 'resume' | 'terminate', payload?: unknown) => void;
}

export function StudentDetailPanel({ student, onClose, onAction }: StudentDetailPanelProps) {
  const [activeTab, setActiveTab] = useState<'timeline' | 'violations' | 'info'>('timeline');
  const [violationFilter, setViolationFilter] = useState<string>('all');

  if (!student) return null;

  const runtimeSection = student.runtimeCurrentSection ?? student.currentSection;
  const runtimeRemaining = student.runtimeTimeRemainingSeconds ?? student.timeRemaining;
  const runtimeLabel = student.runtimeStatus === 'paused'
    ? 'Paused'
    : student.runtimeWaiting
      ? 'Waiting for next section'
      : student.runtimeStatus
        ? student.runtimeStatus
        : 'Preview';

  return (
    <AnimatePresence>
      {student && (
        <motion.div 
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ type: 'spring', damping: 25, stiffness: 200 }}
          className="absolute bottom-0 left-0 right-0 bg-white shadow-[0_-10px_40px_rgba(0,0,0,0.1)] border-t border-gray-200 z-30 flex flex-col h-[450px]"
        >
          {/* Header */}
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-white sticky top-0 z-10">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center font-bold text-lg">
                {student.name.split(' ').map(n => n[0]).join('').toUpperCase()}
              </div>
              <div>
                <h3 className="text-xl font-bold text-gray-900">{student.name}</h3>
                <p className="text-sm text-gray-500 font-medium">
                  {student.studentId} • {student.email}
                </p>
              </div>
              <div className="ml-4 flex items-center gap-2">
                <Badge variant={student.status === 'active' ? 'success' : (student.status === 'warned' || student.status === 'paused' || student.status === 'terminated' || student.status === 'idle' || student.status === 'connecting' ? 'warning' : 'neutral')}>
                  {student.status.toUpperCase()}
                </Badge>
                <span className="text-xs text-gray-400 font-medium italic">{runtimeLabel}</span>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <button className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-all">
                <Maximize2 size={20} />
              </button>
              <button 
                onClick={onClose}
                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-all"
              >
                <X size={20} />
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-hidden flex">
            {/* Left: Stats & Tabs */}
            <div className="w-80 border-r border-gray-100 flex flex-col">
              <div className="p-6 grid grid-cols-2 gap-4 border-b border-gray-100">
                <div className="space-y-1">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Section</p>
                  <p className="text-sm font-bold text-gray-900 capitalize">{runtimeSection ?? 'Waiting'}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Time Left</p>
                  <p className="text-sm font-bold text-gray-900 font-mono">
                    {Math.floor(runtimeRemaining / 60).toString().padStart(2, '0')}:{(runtimeRemaining % 60).toString().padStart(2, '0')}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Violations</p>
                  <p className="text-sm font-bold text-red-600">{student.violations.length}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Warnings</p>
                  <p className="text-sm font-bold text-amber-600">{student.warnings}</p>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-2 space-y-1">
                <button 
                  onClick={() => setActiveTab('timeline')}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-bold transition-all ${activeTab === 'timeline' ? 'bg-blue-50 text-blue-700' : 'text-gray-500 hover:bg-gray-50'}`}
                >
                  <History size={18} /> Activity Timeline
                </button>
                <button 
                  onClick={() => setActiveTab('violations')}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-bold transition-all ${activeTab === 'violations' ? 'bg-blue-50 text-blue-700' : 'text-gray-500 hover:bg-gray-50'}`}
                >
                  <AlertTriangle size={18} /> Violation Records
                </button>
                <button 
                  onClick={() => setActiveTab('info')}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-bold transition-all ${activeTab === 'info' ? 'bg-blue-50 text-blue-700' : 'text-gray-500 hover:bg-gray-50'}`}
                >
                  <MessageSquare size={18} /> Session Notes
                </button>
              </div>
            </div>

            {/* Right: Tab Content */}
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="flex-1 overflow-y-auto p-6">
                {activeTab === 'timeline' && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="font-bold text-gray-900">Recent Activity</h4>
                      <button className="text-xs font-bold text-blue-600 hover:underline uppercase tracking-wider">Show All Events</button>
                    </div>
                    <div className="space-y-3 relative before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-gray-100">
                      {[
                        { time: '14:32:05', event: 'Mouse click (512, 340)', type: 'info' },
                        { time: '14:32:01', event: "Key pressed: 'a'", type: 'info' },
                        { time: '14:31:58', event: 'Scroll down 3px', type: 'info' },
                        { time: '14:31:55', event: 'Tab switch attempt (warn #2)', type: 'warning' },
                        { time: '14:31:50', event: "Key pressed: 't'", type: 'info' },
                      ].map((item, i) => (
                        <div key={i} className="flex gap-4 relative pl-6">
                          <div className={`absolute left-0 top-1.5 w-4 h-4 rounded-full border-2 border-white shadow-sm ${item.type === 'warning' ? 'bg-amber-500' : 'bg-blue-500'}`}></div>
                          <span className="text-[10px] font-mono text-gray-400 mt-0.5">{item.time}</span>
                          <p className={`text-sm font-medium ${item.type === 'warning' ? 'text-amber-700' : 'text-gray-700'}`}>{item.event}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {activeTab === 'violations' && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="font-bold text-gray-900">Recorded Violations</h4>
                      <select
                        value={violationFilter}
                        onChange={(e) => setViolationFilter(e.target.value)}
                        className="text-xs border border-gray-200 rounded px-2 py-1 outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="all">All Types</option>
                        {Array.from(new Set(student.violations.map(v => v.type))).map(type => (
                          <option key={type} value={type}>{type}</option>
                        ))}
                      </select>
                    </div>
                    {student.violations.length === 0 ? (
                      <p className="text-sm text-gray-500 italic">No violations recorded for this session.</p>
                    ) : (
                      <div className="space-y-3">
                        {student.violations
                          .filter(v => violationFilter === 'all' || v.type === violationFilter)
                          .map((v) => {
                            const severityColors = {
                              low: 'bg-blue-100 text-blue-700 border-blue-200',
                              medium: 'bg-amber-100 text-amber-700 border-amber-200',
                              high: 'bg-orange-100 text-orange-700 border-orange-200',
                              critical: 'bg-red-100 text-red-700 border-red-200',
                            };
                            return (
                              <div key={v.id} className={`p-3 rounded-lg border ${severityColors[v.severity] || severityColors.medium} flex items-start gap-3`}>
                                <AlertTriangle className="mt-0.5" size={16} />
                                <div className="flex-1">
                                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                                    <span className="text-xs font-bold uppercase">{v.type}</span>
                                    <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-white/50">
                                      {v.severity}
                                    </span>
                                    <span className="text-[10px] font-mono opacity-70">
                                      {new Date(v.timestamp).toLocaleTimeString()}
                                    </span>
                                  </div>
                                  <p className="text-xs">{v.description}</p>
                                </div>
                              </div>
                            );
                          })}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Footer: Quick Actions */}
              <div className="p-4 border-t border-gray-100 bg-gray-50 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Button 
                    variant="warning" 
                    size="sm" 
                    leftIcon={<AlertTriangle size={16} />}
                    onClick={() => onAction('warn')}
                  >
                    Warn
                  </Button>
                  {student.status === 'paused' ? (
                    <Button 
                      variant="primary" 
                      size="sm" 
                      leftIcon={<Play size={16} />}
                      onClick={() => onAction('resume')}
                    >
                      Resume
                    </Button>
                  ) : (
                    <Button 
                      variant="secondary" 
                      size="sm" 
                      leftIcon={<Pause size={16} />}
                      onClick={() => onAction('pause')}
                    >
                      Pause
                    </Button>
                  )}
                  <Button 
                    variant="danger" 
                    size="sm" 
                    leftIcon={<XCircle size={16} />}
                    onClick={() => onAction('terminate')}
                  >
                    Terminate
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" leftIcon={<Timer size={16} />}>Extend Time</Button>
                  <Button variant="ghost" size="sm" leftIcon={<Flag size={16} />}>Flag Session</Button>
                  <Button variant="ghost" size="sm" leftIcon={<MessageSquare size={16} />}>Add Note</Button>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
