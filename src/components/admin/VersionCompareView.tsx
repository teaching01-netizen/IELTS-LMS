import React from 'react';
import { X, GitCompare, ArrowRight, CheckCircle2, XCircle, Clock, User, FileText, Layers } from 'lucide-react';
import { VersionDiff } from '../../types/domain';
import { summarizeChanges, getChangeCount, formatTimestamp, getVersionStatusLabel, getVersionStatusColor } from '../../utils/versionUtils';

interface VersionCompareViewProps {
  isOpen: boolean;
  onClose: () => void;
  diff: VersionDiff | null;
  onRestoreAsDraft?: ((versionId: string) => void) | undefined;
  onRepublish?: ((versionId: string) => void) | undefined;
}

export function VersionCompareView({ isOpen, onClose, diff, onRestoreAsDraft, onRepublish }: VersionCompareViewProps) {
  if (!isOpen || !diff) return null;

  const changes = summarizeChanges(diff);
  const changeCount = getChangeCount(diff);

  return (
    <div className="fixed inset-0 z-50 flex justify-center items-center bg-black/40 animate-in fade-in duration-200">
      <div className="w-full max-w-5xl bg-white rounded-2xl shadow-2xl flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-300">
        {/* Header */}
        <div className="h-16 px-6 border-b border-gray-100 flex items-center justify-between bg-gray-50 rounded-t-2xl flex-shrink-0">
          <div className="flex items-center gap-3">
            <GitCompare size={20} className="text-blue-600" />
            <span className="text-gray-900 font-bold text-lg">Version Comparison</span>
            {!diff.hasChanges && (
              <span className="px-2 py-1 bg-green-100 text-green-700 text-xs font-bold rounded-full">No Changes</span>
            )}
            {diff.hasChanges && (
              <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs font-bold rounded-full">{changeCount} Change{changeCount !== 1 ? 's' : ''}</span>
            )}
          </div>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-all">
            <X size={20} />
          </button>
        </div>

        {/* Version Headers */}
        <div className="grid grid-cols-2 gap-0 border-b border-gray-100 flex-shrink-0">
          <div className="p-4 border-r border-gray-100 bg-blue-50/30">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Version A</span>
            </div>
            <div className="flex items-center gap-2">
              <span className={`px-2 py-1 text-xs font-bold rounded ${getVersionStatusColor(diff.versionA)}`}>
                {getVersionStatusLabel(diff.versionA)}
              </span>
              <span className="font-bold text-gray-900">v{diff.versionA.versionNumber}</span>
            </div>
            <div className="flex items-center gap-1 text-xs text-gray-500 mt-1">
              <Clock size={12} />
              <span>{formatTimestamp(diff.versionA.createdAt)}</span>
            </div>
            <div className="flex items-center gap-1 text-xs text-gray-500 mt-1">
              <User size={12} />
              <span>{diff.versionA.createdBy}</span>
            </div>
          </div>
          <div className="p-4 bg-green-50/30">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Version B</span>
            </div>
            <div className="flex items-center gap-2">
              <span className={`px-2 py-1 text-xs font-bold rounded ${getVersionStatusColor(diff.versionB)}`}>
                {getVersionStatusLabel(diff.versionB)}
              </span>
              <span className="font-bold text-gray-900">v{diff.versionB.versionNumber}</span>
            </div>
            <div className="flex items-center gap-1 text-xs text-gray-500 mt-1">
              <Clock size={12} />
              <span>{formatTimestamp(diff.versionB.createdAt)}</span>
            </div>
            <div className="flex items-center gap-1 text-xs text-gray-500 mt-1">
              <User size={12} />
              <span>{diff.versionB.createdBy}</span>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Summary */}
          {diff.hasChanges && (
            <section className="space-y-3">
              <h3 className="text-sm font-bold text-gray-900 uppercase tracking-widest flex items-center gap-2">
                <FileText size={16} className="text-blue-500" /> Change Summary
              </h3>
              <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
                <ul className="space-y-2">
                  {changes.map((change, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-sm">
                      <ArrowRight size={16} className="text-blue-500 flex-shrink-0 mt-0.5" />
                      <span className="text-gray-700">{change}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          )}

          {/* Metadata Changes */}
          <section className="space-y-3">
            <h3 className="text-sm font-bold text-gray-900 uppercase tracking-widest flex items-center gap-2">
              <Layers size={16} className="text-blue-500" /> Metadata
            </h3>
            <div className="bg-white border border-gray-100 rounded-xl overflow-hidden shadow-sm">
              <DiffRow
                label="Version Number"
                valueA={`v${diff.versionA.versionNumber}`}
                valueB={`v${diff.versionB.versionNumber}`}
                changed={diff.metadataDiff.versionNumberChanged}
              />
              <DiffRow
                label="Creator"
                valueA={diff.versionA.createdBy}
                valueB={diff.versionB.createdBy}
                changed={diff.metadataDiff.creatorChanged}
              />
              <DiffRow
                label="Created At"
                valueA={formatTimestamp(diff.versionA.createdAt)}
                valueB={formatTimestamp(diff.versionB.createdAt)}
                changed={diff.metadataDiff.createdAtChanged}
              />
              <DiffRow
                label="Publish Notes"
                valueA={diff.versionA.publishNotes || '—'}
                valueB={diff.versionB.publishNotes || '—'}
                changed={diff.metadataDiff.publishNotesChanged}
              />
            </div>
          </section>

          {/* Config Changes */}
          <section className="space-y-3">
            <h3 className="text-sm font-bold text-gray-900 uppercase tracking-widest flex items-center gap-2">
              <SettingsIcon size={16} className="text-blue-500" /> Configuration
            </h3>
            <div className="bg-white border border-gray-100 rounded-xl overflow-hidden shadow-sm">
              <DiffRow
                label="General Settings"
                valueA="—"
                valueB="—"
                changed={diff.configDiff.generalChanged}
                isBinary
              />
              <DiffRow
                label="Listening Module"
                valueA="—"
                valueB="—"
                changed={diff.configDiff.sectionsChanged.listening}
                isBinary
              />
              <DiffRow
                label="Reading Module"
                valueA="—"
                valueB="—"
                changed={diff.configDiff.sectionsChanged.reading}
                isBinary
              />
              <DiffRow
                label="Writing Module"
                valueA="—"
                valueB="—"
                changed={diff.configDiff.sectionsChanged.writing}
                isBinary
              />
              <DiffRow
                label="Speaking Module"
                valueA="—"
                valueB="—"
                changed={diff.configDiff.sectionsChanged.speaking}
                isBinary
              />
              <DiffRow
                label="Progression Rules"
                valueA="—"
                valueB="—"
                changed={diff.configDiff.progressionChanged}
                isBinary
              />
              <DiffRow
                label="Scoring Rules"
                valueA="—"
                valueB="—"
                changed={diff.configDiff.scoringChanged}
                isBinary
              />
              <DiffRow
                label="Security Settings"
                valueA="—"
                valueB="—"
                changed={diff.configDiff.securityChanged}
                isBinary
              />
            </div>
          </section>

          {/* Content Count Changes */}
          <section className="space-y-3">
            <h3 className="text-sm font-bold text-gray-900 uppercase tracking-widest flex items-center gap-2">
              <FileText size={16} className="text-blue-500" /> Content Counts
            </h3>
            <div className="bg-white border border-gray-100 rounded-xl overflow-hidden shadow-sm">
              <DiffRow
                label="Reading Passages"
                valueA={diff.countsDiff.readingPassages.a.toString()}
                valueB={diff.countsDiff.readingPassages.b.toString()}
                changed={diff.countsDiff.readingPassages.changed}
              />
              <DiffRow
                label="Reading Questions"
                valueA={diff.countsDiff.readingQuestions.a.toString()}
                valueB={diff.countsDiff.readingQuestions.b.toString()}
                changed={diff.countsDiff.readingQuestions.changed}
              />
              <DiffRow
                label="Listening Parts"
                valueA={diff.countsDiff.listeningParts.a.toString()}
                valueB={diff.countsDiff.listeningParts.b.toString()}
                changed={diff.countsDiff.listeningParts.changed}
              />
              <DiffRow
                label="Listening Questions"
                valueA={diff.countsDiff.listeningQuestions.a.toString()}
                valueB={diff.countsDiff.listeningQuestions.b.toString()}
                changed={diff.countsDiff.listeningQuestions.changed}
              />
            </div>
          </section>
        </div>

        {/* Footer Actions */}
        <div className="border-t border-gray-100 p-4 bg-gray-50 rounded-b-2xl flex-shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex gap-3">
              {onRestoreAsDraft && diff.versionB.isDraft && (
                <button
                  onClick={() => onRestoreAsDraft(diff.versionA.id)}
                  className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition-all"
                >
                  <ArrowRight size={16} className="rotate-180" />
                  Restore v{diff.versionA.versionNumber} as Draft
                </button>
              )}
              {onRepublish && diff.versionB.isPublished && (
                <button
                  onClick={() => onRepublish(diff.versionA.id)}
                  className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-all"
                >
                  <CheckCircle2 size={16} />
                  Republish v{diff.versionA.versionNumber}
                </button>
              )}
            </div>
            <button
              onClick={onClose}
              className="px-6 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 transition-all"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SettingsIcon({ size, className }: { size: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.1a2 2 0 0 1-1-1.72v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

interface DiffRowProps {
  label: string;
  valueA: string;
  valueB: string;
  changed: boolean;
  isBinary?: boolean;
}

function DiffRow({ label, valueA, valueB, changed, isBinary }: DiffRowProps) {
  return (
    <div className={`flex items-center justify-between p-3 border-b border-gray-50 last:border-0 ${changed ? 'bg-yellow-50/50' : ''}`}>
      <span className="text-sm font-medium text-gray-700">{label}</span>
      <div className="flex items-center gap-4">
        <div className="text-right">
          <span className={`text-xs font-mono ${changed ? 'text-red-600 line-through' : 'text-gray-500'}`}>{valueA}</span>
        </div>
        <ArrowRight size={14} className={`text-gray-300 ${changed ? 'text-blue-500' : ''}`} />
        <div className="text-right">
          {isBinary ? (
            changed ? (
              <CheckCircle2 size={14} className="text-green-600" />
            ) : (
              <XCircle size={14} className="text-gray-300" />
            )
          ) : (
            <span className={`text-xs font-mono ${changed ? 'text-green-600 font-bold' : 'text-gray-500'}`}>{valueB}</span>
          )}
        </div>
      </div>
    </div>
  );
}
