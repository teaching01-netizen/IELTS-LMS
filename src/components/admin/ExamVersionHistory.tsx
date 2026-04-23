import React, { useState, useMemo, useEffect, useRef } from 'react';
import { GitCommit, Clock, User, CheckCircle2, GitCompare, RotateCcw, Upload, Copy, ChevronDown, ChevronRight, FileText, File } from 'lucide-react';
import { ExamAuditTimeline } from './ExamAuditTimeline';
import { VersionCompareView } from './VersionCompareView';
import { formatTimestamp, getRelativeTime, getVersionStatusColor, getVersionStatusLabel, sortVersionsByNumber } from '../../utils/versionUtils';
import { ExamVersionHistoryProps } from '../../features/admin/contracts';
import { normalizeWritingTaskContents } from '../../utils/writingTaskUtils';
import { useVersionHistory } from './hooks/useVersionHistory';
import { hydrateExamState } from '../../services/examAdapterService';
import { examRepository } from '../../services/examRepository';
import type { ExamVersion } from '../../types/domain';

export function ExamVersionHistory({
  exam,
  versions,
  events,
  onRestoreVersion,
  onRepublishVersion,
  onCompareVersions,
  onCloneExam
}: ExamVersionHistoryProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);
  const [loadedVersionsById, setLoadedVersionsById] = useState<Record<string, ExamVersion>>({});
  const [loadingVersionsById, setLoadingVersionsById] = useState<Record<string, boolean>>({});
  const [loadErrorsById, setLoadErrorsById] = useState<Record<string, string | undefined>>({});

  // Version label formatting function
  const getVersionLabel = (version: any): string => {
    const isCurrentPublished = version.id === exam.currentPublishedVersionId;
    
    if (version.isDraft) {
      return `Draft ${version.versionNumber}`;
    } else if (version.isPublished) {
      const publishedVersionNumber = versions.filter(v => v.isPublished).findIndex(v => v.id === version.id) + 1;
      return `Published v${publishedVersionNumber}`;
    }
    return `Version ${version.versionNumber}`;
  };

  const getVersionIcon = (version: any) => {
    if (version.isDraft) {
      return <FileText size={16} className="text-slate-600" aria-hidden="true" />;
    }
    return <File size={16} className="text-emerald-600" aria-hidden="true" />;
  };

  // Build tree structure for visualization
  const versionTree = useMemo(() => {
    const tree: any = {};
    versions.forEach(version => {
      tree[version.id] = {
        version,
        children: [],
        parent: version.parentVersionId
      };
    });
    
    // Build parent-child relationships
    Object.values(tree).forEach((node: any) => {
      if (node.parent && tree[node.parent]) {
        tree[node.parent].children.push(node);
      }
    });
    
    return tree;
  }, [versions]);

  // Get children for a version
  const getVersionChildren = (versionId: string) => {
    return versionTree[versionId]?.children || [];
  };

  // Check if version has children
  const hasChildren = (versionId: string) => {
    return getVersionChildren(versionId).length > 0;
  };

  // Render tree connector lines
  const renderTreeConnector = (version: any, index: number, total: number) => {
    if (!version.parentVersionId) return null;
    
    const isLastChild = index === total - 1;
    
    return (
      <div className="flex items-center" aria-hidden="true">
        <div className="w-6 border-l-2 border-slate-200" />
        <div className="w-4 h-0.5 border-t-2 border-slate-200" />
      </div>
    );
  };

  const {
    selectedVersionId,
    setSelectedVersionId,
    showAuditLog,
    setShowAuditLog,
    isCloning,
    setIsCloning,
    cloneTitle,
    setCloneTitle,
    handleClone,
    compareVersionId,
    setCompareVersionId,
    showCompareModal,
    setShowCompareModal,
    compareDiff,
    setCompareDiff,
    handleCompare,
    handleRestore,
    handleRepublish
  } = useVersionHistory({
    onRestoreVersion,
    onRepublishVersion,
    onCompareVersions,
    onCloneExam,
    examId: exam.id
  });

  const sortedVersions = sortVersionsByNumber(versions);

  const ensureVersionLoaded = async (versionId: string) => {
    if (loadedVersionsById[versionId] || loadingVersionsById[versionId]) {
      return;
    }

    setLoadingVersionsById((current) => ({ ...current, [versionId]: true }));
    setLoadErrorsById((current) => ({ ...current, [versionId]: undefined }));

    try {
      const version = await examRepository.getVersionById(versionId);
      if (version) {
        setLoadedVersionsById((current) => ({ ...current, [versionId]: version }));
      } else {
        setLoadErrorsById((current) => ({ ...current, [versionId]: 'Version not found' }));
      }
    } catch (error) {
      setLoadErrorsById((current) => ({
        ...current,
        [versionId]: error instanceof Error ? error.message : 'Failed to load version details',
      }));
    } finally {
      setLoadingVersionsById((current) => ({ ...current, [versionId]: false }));
    }
  };

  const toggleSelectedVersion = (versionId: string) => {
    const nextSelectedId = selectedVersionId === versionId ? null : versionId;
    setSelectedVersionId(nextSelectedId);
    if (nextSelectedId) {
      void ensureVersionLoaded(nextSelectedId);
    }
  };

  // Focus trap for clone modal
  useEffect(() => {
    if (!isCloning || !modalRef.current) {
      return;
    }

    // Store the previously focused element
    previousActiveElementRef.current = document.activeElement as HTMLElement;
    
    // Focus the first focusable element in the modal
    const firstInput = modalRef.current.querySelector('input') as HTMLInputElement;
    if (firstInput) {
      firstInput.focus();
    }

    // Handle Tab key to trap focus within modal
    const handleTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      
      const focusableElements = modalRef.current?.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      ) as NodeListOf<HTMLElement>;
      
      if (!focusableElements || focusableElements.length === 0) return;
      
      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      
      if (!firstElement || !lastElement) return;
      
      if (e.shiftKey) {
        if (document.activeElement === firstElement) {
          e.preventDefault();
          lastElement.focus();
        }
      } else {
        if (document.activeElement === lastElement) {
          e.preventDefault();
          firstElement.focus();
        }
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsCloning(false);
        setCloneTitle('');
      }
    };

    document.addEventListener('keydown', handleTab);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('keydown', handleTab);
      document.removeEventListener('keydown', handleEscape);
      // Restore focus to previously active element
      previousActiveElementRef.current?.focus();
    };
  }, [isCloning, setIsCloning, setCloneTitle]);


  return (
    <div className="space-y-6">
      {/* Version List */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-900 uppercase tracking-widest flex items-center gap-2" title="View all versions. Drafts are editable. Published versions are immutable.">
            <GitCommit size={16} className="text-blue-500" /> Version History
          </h3>
          <div className="flex gap-2">
            <button
              onClick={() => setShowAuditLog(!showAuditLog)}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-all"
              title="View audit log of all actions taken on this exam."
            >
              <Clock size={14} />
              {showAuditLog ? 'Hide' : 'Show'} Audit Log
            </button>
            {onCloneExam && (
              <button
                onClick={() => {
                  setCloneTitle(`${exam.title} (Copy)`);
                  setIsCloning(true);
                }}
                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-all"
                title="Create a copy of this exam with all its content and versions."
              >
                <Copy size={14} />
                Clone Exam
              </button>
            )}
          </div>
        </div>

        <div className="bg-white border border-gray-100 rounded-xl overflow-hidden shadow-sm">
          {sortedVersions.map((version, index) => {
            const isCurrentDraft = version.id === exam.currentDraftVersionId;
            const isCurrentPublished = version.id === exam.currentPublishedVersionId;
            const isSelected = selectedVersionId === version.id;
            const isCompareTarget = compareVersionId === version.id;
            const loadedVersion = loadedVersionsById[version.id];
            const isLoadingDetails = !!loadingVersionsById[version.id];
            const loadError = loadErrorsById[version.id];
            const hydratedContent =
              isSelected && loadedVersion ? hydrateExamState(loadedVersion.contentSnapshot) : null;
            const children = getVersionChildren(version.id);

            return (
              <div key={version.id} className="border-b border-gray-50 last:border-0">
                <div 
                  className={`p-4 cursor-pointer transition-all ${isSelected ? 'bg-blue-50/50' : 'hover:bg-gray-50'}`}
                  onClick={() => toggleSelectedVersion(version.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      toggleSelectedVersion(version.id);
                    }
                  }}
                  tabIndex={0}
                  role="button"
                  aria-expanded={isSelected}
                  aria-controls={`version-details-${version.id}`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3 flex-1">
                      {renderTreeConnector(version, index, sortedVersions.length)}
                      <button 
                        className="mt-1 p-1 rounded hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleSelectedVersion(version.id);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            e.stopPropagation();
                            toggleSelectedVersion(version.id);
                          }
                        }}
                        aria-label={isSelected ? 'Collapse version details' : 'Expand version details'}
                        aria-expanded={isSelected}
                      >
                        {isSelected ? (
                          <ChevronDown size={16} className="text-gray-400" />
                        ) : (
                          <ChevronRight size={16} className="text-gray-400" />
                        )}
                      </button>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          {getVersionIcon(version)}
                          <span className="font-bold text-gray-900">{getVersionLabel(version)}</span>
                          {version.isPublished && isCurrentPublished && (
                            <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs font-bold rounded flex items-center gap-1">
                              <CheckCircle2 size={10} aria-hidden="true" /> live
                            </span>
                          )}
                          {version.isPublished && !isCurrentPublished && (
                            <span className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs font-bold rounded">archived</span>
                          )}
                          {isCurrentDraft && (
                            <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs font-bold rounded" aria-current="true">current</span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-xs text-gray-500">
                          <span className="flex items-center gap-1">
                            <User size={12} aria-hidden="true" />
                            {version.createdBy}
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock size={12} aria-hidden="true" />
                            {getRelativeTime(version.createdAt)}
                          </span>
                        </div>
                        {version.publishNotes && (
                          <div className="mt-2 text-xs text-gray-600 italic">
                            "{version.publishNotes}"
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-1">
                      {compareVersionId && compareVersionId !== version.id && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCompare(compareVersionId, version.id);
                          }}
                          className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded transition-all"
                          title="Compare with selected version"
                          aria-label="Compare with selected version"
                        >
                          <GitCompare size={14} aria-hidden="true" />
                        </button>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setCompareVersionId(version.id);
                        }}
                        className={`p-1.5 rounded transition-all ${isCompareTarget ? 'text-blue-600 bg-blue-100' : 'text-gray-500 hover:text-blue-600 hover:bg-blue-50'}`}
                        title="Select for comparison"
                        aria-label="Select for comparison"
                        aria-pressed={isCompareTarget}
                      >
                        <GitCompare size={14} aria-hidden="true" />
                      </button>
                      {onRestoreVersion && version.isDraft && !isCurrentDraft && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRestore(version.id);
                          }}
                          className="p-1.5 text-gray-500 hover:text-amber-600 hover:bg-amber-50 rounded transition-all"
                          title="Restore as new draft"
                          aria-label="Restore as new draft"
                        >
                          <RotateCcw size={14} aria-hidden="true" />
                        </button>
                      )}
                      {onRepublishVersion && version.isPublished && !isCurrentPublished && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRepublish(version.id);
                          }}
                          className="p-1.5 text-gray-500 hover:text-green-600 hover:bg-green-50 rounded transition-all"
                          title="Republish version"
                          aria-label="Republish version"
                        >
                          <Upload size={14} aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Expanded Version Details */}
                  {isSelected && (
                    <div id={`version-details-${version.id}`} className="mt-4 pt-4 border-t border-gray-100 pl-7 space-y-3">
                      {isLoadingDetails && (
                        <div className="bg-gray-50 rounded-lg p-3">
                          <span className="sr-only">Loading version details…</span>
                          <div className="h-4 w-48 bg-gray-200 rounded animate-pulse" aria-hidden="true" />
                          <div className="mt-2 h-3 w-72 bg-gray-200 rounded animate-pulse" aria-hidden="true" />
                        </div>
                      )}

                      {loadError && (
                        <div className="bg-red-50 border border-red-100 rounded-lg p-3 text-sm text-red-700">
                          {loadError}
                        </div>
                      )}

                      <div className="grid grid-cols-2 gap-4 text-xs">
                        <div>
                          <span className="text-gray-500">Created:</span>
                          <span className="ml-2 text-gray-900">{formatTimestamp(version.createdAt)}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">Parent Version:</span>
                          <span className="ml-2 text-gray-900">
                            {version.parentVersionId 
                              ? `v${versions.find(v => v.id === version.parentVersionId)?.versionNumber || 'Unknown'}`
                              : 'None (Initial)'}
                          </span>
                        </div>
                      </div>
                      
                      {version.validationSnapshot && (
                        <div className="flex items-center gap-4 text-xs">
                          <div className="flex items-center gap-1">
                            <CheckCircle2 size={12} className={version.validationSnapshot.isValid ? 'text-green-500' : 'text-red-500'} />
                            <span className={version.validationSnapshot.isValid ? 'text-green-600' : 'text-red-600'}>
                              {version.validationSnapshot.isValid ? 'Valid' : 'Invalid'}
                            </span>
                          </div>
                          {version.validationSnapshot.errorCount > 0 && (
                            <span className="text-red-600">{version.validationSnapshot.errorCount} errors</span>
                          )}
                          {version.validationSnapshot.warningCount > 0 && (
                            <span className="text-amber-600">{version.validationSnapshot.warningCount} warnings</span>
                          )}
                        </div>
                      )}

                      {/* Content Stats */}
                      {hydratedContent && (
                        <div className="bg-gray-50 rounded-lg p-3">
                          <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Content Summary</div>
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div className="flex justify-between">
                              <span className="text-gray-500">Reading Passages:</span>
                              <span className="text-gray-900 font-medium">{hydratedContent.reading.passages.length}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-500">Listening Parts:</span>
                              <span className="text-gray-900 font-medium">{hydratedContent.listening.parts.length}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-500">Writing Prompts:</span>
                              <span className="text-gray-900 font-medium">
                                {normalizeWritingTaskContents(
                                  hydratedContent.writing,
                                  hydratedContent.config.sections.writing.tasks,
                                ).filter((task) => task.prompt.trim().length > 0).length}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-500">Speaking Topics:</span>
                              <span className="text-gray-900 font-medium">{hydratedContent.speaking.part1Topics.length}</span>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {sortedVersions.length === 0 && (
            <div className="p-8 text-center text-gray-400 text-sm">
              No versions found
            </div>
          )}
        </div>
      </section>

      {/* Audit Timeline */}
      {showAuditLog && (
        <section className="space-y-4">
          <ExamAuditTimeline events={events} limit={20} />
        </section>
      )}

      {/* Clone Modal */}
      {isCloning && (
        <div className="fixed inset-0 z-50 flex justify-center items-center bg-black/40 animate-in fade-in duration-200">
          <div ref={modalRef} className="w-full max-w-md bg-white rounded-xl shadow-2xl p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-4">Clone Exam</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">New Exam Title</label>
                <input
                  type="text"
                  value={cloneTitle}
                  onChange={(e) => setCloneTitle(e.target.value)}
                  placeholder={`${exam.title} (Copy)`}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => {
                    setIsCloning(false);
                    setCloneTitle('');
                  }}
                  className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={handleClone}
                  disabled={!cloneTitle.trim()}
                  className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Clone Exam
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Version Compare Modal */}
      {showCompareModal && compareDiff && (
        <VersionCompareView
          isOpen={showCompareModal}
          onClose={() => {
            setShowCompareModal(false);
            setCompareDiff(null);
          }}
          diff={compareDiff}
          onRestoreAsDraft={onRestoreVersion}
          onRepublish={onRepublishVersion}
        />
      )}
    </div>
  );
}
