import React, { useState, useMemo, useEffect, memo } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Search, Filter, MoreHorizontal, Copy, CheckCircle, Archive, X, Layers, Book, Pen, Headset, Mic, Settings2, LayoutTemplate, GitCommit, XCircle, Download, Trash2, type LucideIcon } from 'lucide-react';
import { StatusBadge } from '../ui/StatusBadge';
import { Exam, ExamConfig } from '../../types';
import { lazyLoad } from '../../app/performance/lazyLoad';
import { ExamEntity, ExamEvent, ExamVersionSummary, BulkOperationResult } from '../../types/domain';
import { getExamStatsFromExam, ExamFilterOptions, ExamSortOptions, DEFAULT_FILTERS, DEFAULT_SORT, hasActiveFilters } from '../../utils/examStats';
import { AdminExamsProps, ExamVersionHistoryProps } from '../../features/admin/contracts';
import { ExamFiltersPanel } from './ExamFiltersPanel';
import { ExamBulkActionBar } from './ExamBulkActionBar';
import { Virtuoso } from 'react-virtuoso';
import { VIRTUAL_LIST_HEIGHTS } from '../../constants/uiConstants';

const ExamVersionHistory = lazyLoad<ExamVersionHistoryProps>(
  () => import('./ExamVersionHistory').then((module) => ({ default: module.ExamVersionHistory })),
  'Loading version history...',
  'ExamVersionHistory'
);

interface ExamGridCardProps {
  exam: Exam;
  stats: ReturnType<typeof getExamStatsFromExam>;
  isSelected: boolean;
  onToggleSelect: (examId: string) => void;
  onEdit: (examId: string) => void;
  onPreview: (examId: string) => void;
  onDropdownClick: (e: React.MouseEvent, examId: string) => void;
  getStatusBadge: (status: string) => React.ReactNode;
  onGoToConfig?: ((examId: string) => void) | undefined;
  onGoToReview?: ((examId: string) => void) | undefined;
}

const ExamGridCard = memo(function ExamGridCard({
  exam,
  stats,
  isSelected,
  onToggleSelect,
  onEdit,
  onPreview,
  onDropdownClick,
  getStatusBadge,
  onGoToConfig,
  onGoToReview
}: ExamGridCardProps) {
  return (
    <div className={`bg-white rounded-xl shadow-sm border overflow-hidden flex flex-col hover:shadow-md transition-shadow ${isSelected ? 'border-blue-500 ring-2 ring-blue-500' : 'border-gray-200'}`}>
      <div className="p-5 flex-1">
        <div className="flex items-start gap-3 mb-3">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => onToggleSelect(exam.id)}
            className="mt-1 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <div className="flex-1 min-w-0">
            <div className="flex justify-between items-start">
              <h3 className="font-semibold text-lg text-gray-900 line-clamp-1" title={exam.title}>{exam.title}</h3>
              {getStatusBadge(exam.status)}
            </div>
          </div>
        </div>

        <div className="space-y-2 mb-4 ml-8">
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Type:</span>
            <span className="font-medium text-gray-900">{exam.type}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Questions:</span>
            <span className="font-medium text-gray-900">{stats.totalQuestions}</span>
          </div>
        </div>

        <div className="pt-4 border-t border-gray-100 space-y-2 ml-8">
          <div className="flex justify-between text-xs text-gray-500">
            <span>Modified: {new Date(exam.lastModified).toLocaleDateString()}</span>
            <span>By: {exam.author}</span>
          </div>
        </div>
      </div>

      <div className="bg-gray-50 px-5 py-3 border-t border-gray-200 flex justify-between items-center">
        <div className="flex gap-2">
          <button
            onClick={() => onEdit(exam.id)}
            className="px-3 py-1.5 bg-white border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Edit
          </button>
          <button
            onClick={() => onPreview(exam.id)}
            className="px-3 py-1.5 bg-white border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Preview
          </button>
        </div>
        <button
          onClick={(e) => onDropdownClick(e, exam.id)}
          className="p-1.5 text-gray-500 hover:bg-gray-200 rounded-md"
        >
          <MoreHorizontal size={18} />
        </button>
      </div>
    </div>
  );
});

interface ExamListItemProps {
  exam: Exam;
  stats: ReturnType<typeof getExamStatsFromExam>;
  isSelected: boolean;
  onToggleSelect: (examId: string) => void;
  onEdit: (examId: string) => void;
  onDropdownClick: (e: React.MouseEvent, examId: string) => void;
  getStatusBadge: (status: string) => React.ReactNode;
  onGoToConfig?: ((examId: string) => void) | undefined;
  onGoToReview?: ((examId: string) => void) | undefined;
}

const ExamListItem = memo(function ExamListItem({
  exam,
  stats,
  isSelected,
  onToggleSelect,
  onEdit,
  onDropdownClick,
  getStatusBadge,
  onGoToConfig,
  onGoToReview
}: ExamListItemProps) {
  return (
    <div className={`hover:bg-gray-50 flex items-center ${isSelected ? 'bg-blue-50' : ''}`}>
      <div className="px-6 py-4 w-8">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => onToggleSelect(exam.id)}
          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
        />
      </div>
      <div className="px-6 py-4 flex-1 font-medium text-gray-900">{exam.title}</div>
      <div className="px-6 py-4 w-24 text-gray-500">{exam.type}</div>
      <div className="px-6 py-4 w-36">{getStatusBadge(exam.status)}</div>
      <div className="px-6 py-4 w-20 text-gray-500">{stats.totalQuestions}</div>
      <div className="px-6 py-4 w-32 text-gray-500">{exam.author}</div>
      <div className="px-6 py-4 w-32 text-gray-500">{new Date(exam.lastModified).toLocaleDateString()}</div>
      <div className="px-6 py-4 w-32 text-right overflow-visible flex items-center justify-end gap-2">
        <button
          onClick={() => onEdit(exam.id)}
          className="text-blue-600 hover:text-blue-800 font-medium"
        >
          Edit
        </button>
        <button
          onClick={(e) => onDropdownClick(e, exam.id)}
          className="text-gray-400 hover:text-gray-600"
        >
          <MoreHorizontal size={18} />
        </button>
      </div>
    </div>
  );
});

export function AdminExams({
  onNavigate,
  exams,
  onEditExam,
  onGoToConfig,
  onGoToReview,
  onCreateExam,
  onCloneExam,
  onCreateFromTemplate,
  onDeleteExam,
  examEntities,
  versions, // eslint-disable-line @typescript-eslint/no-unused-vars
  events, // eslint-disable-line @typescript-eslint/no-unused-vars
  onGetVersions,
  onGetEvents,
  onRestoreVersion,
  onRepublishVersion,
  onCompareVersions,
  onBulkPublish,
  onBulkUnpublish,
  onBulkArchive,
  onBulkDuplicate,
  onBulkExport,
  onBulkDelete
}: AdminExamsProps) {
  // View state
  const [view, setView] = useState<'grid' | 'list'>('list');
  
  // Modal states
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showCloneModal, setShowCloneModal] = useState(false);
  const [selectedExamForClone, setSelectedExamForClone] = useState<Exam | null>(null);
  const [cloneTitle, setCloneTitle] = useState('');
  const [cloneMode, setCloneMode] = useState<'clone' | 'template'>('clone');
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  const [dropdownPosition, setDropdownPosition] = useState<{ top: number; left: number } | null>(null);
  const [newExamTitle, setNewExamTitle] = useState('');
  const [newExamType, setNewExamType] = useState<'Academic' | 'General Training'>('Academic');
  const [newExamPreset, setNewExamPreset] = useState<ExamConfig['general']['preset']>('Academic');
  const [includeScheduling, setIncludeScheduling] = useState(false);
  const [scheduleData, setScheduleData] = useState({
    cohort: 'Elite 2025-A',
    start: '2025-01-20T09:00',
    end: '2025-01-20T12:00'
  });
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [selectedExamForHistory, setSelectedExamForHistory] = useState<ExamEntity | null>(null);
  const [examVersions, setExamVersions] = useState<ExamVersionSummary[]>([]);
  const [examEvents, setExamEvents] = useState<ExamEvent[]>([]);
  
  // Phase 4: Filter, sort, and selection state
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState<ExamFilterOptions>(DEFAULT_FILTERS);
  const [sort, setSort] = useState<ExamSortOptions>(DEFAULT_SORT);
  const [selectedExamIds, setSelectedExamIds] = useState<Set<string>>(new Set());
  const [showFilters, setShowFilters] = useState(false);
  const [bulkOperationResult, setBulkOperationResult] = useState<BulkOperationResult | null>(null);
  const [showBulkResult, setShowBulkResult] = useState(false);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = () => {
      if (activeDropdown) {
        setActiveDropdown(null);
        setDropdownPosition(null);
      }
    };

    if (activeDropdown) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
    return undefined;
  }, [activeDropdown]);

  // Phase 4: Filter and sort logic
  const filteredAndSortedExams = useMemo(() => {
    let filtered = [...exams];
    
    // Apply search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(exam =>
        exam.title.toLowerCase().includes(query) ||
        exam.type.toLowerCase().includes(query) ||
        exam.author.toLowerCase().includes(query)
      );
    }
    
    // Apply status filter
    if (filters.status.length > 0) {
      filtered = filtered.filter(exam => filters.status.includes(exam.status));
    }
    
    // Apply type filter
    if (filters.type.length > 0) {
      filtered = filtered.filter(exam => filters.type.includes(exam.type));
    }
    
    // Apply creator filter
    if (filters.creator.length > 0) {
      filtered = filtered.filter(exam => filters.creator.includes(exam.author));
    }
    
    // Apply date range filter
    if (filters.dateRange?.start || filters.dateRange?.end) {
      filtered = filtered.filter(exam => {
        const examDate = new Date(exam.lastModified);
        if (filters.dateRange?.start && examDate < new Date(filters.dateRange.start)) {
          return false;
        }
        if (filters.dateRange?.end && examDate > new Date(filters.dateRange.end)) {
          return false;
        }
        return true;
      });
    }
    
    // Apply question count filter
    if (filters.questionCount?.min !== undefined || filters.questionCount?.max !== undefined) {
      filtered = filtered.filter(exam => {
        const stats = getExamStatsFromExam(exam);
        if (filters.questionCount?.min !== undefined && stats.totalQuestions < filters.questionCount.min) {
          return false;
        }
        if (filters.questionCount?.max !== undefined && stats.totalQuestions > filters.questionCount.max) {
          return false;
        }
        return true;
      });
    }
    
    // Apply sorting
    filtered.sort((a, b) => {
      let comparison = 0;
      
      switch (sort.field) {
        case 'title':
          comparison = a.title.localeCompare(b.title);
          break;
        case 'modified':
          comparison = new Date(a.lastModified).getTime() - new Date(b.lastModified).getTime();
          break;
        case 'published': {
          const aPublished = a.status === 'Published' ? new Date(a.lastModified).getTime() : 0;
          const bPublished = b.status === 'Published' ? new Date(b.lastModified).getTime() : 0;
          comparison = aPublished - bPublished;
          break;
        }
        case 'created':
          comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          break;
        case 'questionCount': {
          const aStats = getExamStatsFromExam(a);
          const bStats = getExamStatsFromExam(b);
          comparison = aStats.totalQuestions - bStats.totalQuestions;
          break;
        }
      }
      
      return sort.direction === 'desc' ? -comparison : comparison;
    });
    
    return filtered;
  }, [exams, searchQuery, filters, sort]);
  
  // Phase 4: Selection handlers
  const toggleSelectAll = () => {
    if (selectedExamIds.size === filteredAndSortedExams.length) {
      setSelectedExamIds(new Set());
    } else {
      setSelectedExamIds(new Set(filteredAndSortedExams.map(e => e.id)));
    }
  };
  
  const toggleSelectExam = (examId: string) => {
    const newSelection = new Set(selectedExamIds);
    if (newSelection.has(examId)) {
      newSelection.delete(examId);
    } else {
      newSelection.add(examId);
    }
    setSelectedExamIds(newSelection);
  };
  
  const clearSelection = () => {
    setSelectedExamIds(new Set());
  };
  
  // Phase 4: Bulk action handlers
  const handleBulkPublish = async () => {
    if (!onBulkPublish || selectedExamIds.size === 0) return;
    
    const result = await onBulkPublish(Array.from(selectedExamIds));
    setBulkOperationResult(result);
    setShowBulkResult(true);
    clearSelection();
  };
  
  const handleBulkUnpublish = async () => {
    if (!onBulkUnpublish || selectedExamIds.size === 0) return;
    
    const result = await onBulkUnpublish(Array.from(selectedExamIds));
    setBulkOperationResult(result);
    setShowBulkResult(true);
    clearSelection();
  };
  
  const handleBulkArchive = async () => {
    if (!onBulkArchive || selectedExamIds.size === 0) return;
    
    const result = await onBulkArchive(Array.from(selectedExamIds));
    setBulkOperationResult(result);
    setShowBulkResult(true);
    clearSelection();
  };
  
  const handleBulkDuplicate = async () => {
    if (!onBulkDuplicate || selectedExamIds.size === 0) return;
    
    const result = await onBulkDuplicate(Array.from(selectedExamIds));
    setBulkOperationResult(result);
    setShowBulkResult(true);
    clearSelection();
  };
  
  const handleBulkExport = async () => {
    if (!onBulkExport || selectedExamIds.size === 0) return;
    
    const result = await onBulkExport(Array.from(selectedExamIds));
    setBulkOperationResult(result);
    setShowBulkResult(true);
    clearSelection();
  };

  const handleBulkDelete = async () => {
    if (!onBulkDelete || selectedExamIds.size === 0) return;

    const count = selectedExamIds.size;
    if (!confirm(`Delete ${count} exam${count !== 1 ? 's' : ''}? This cannot be undone.`)) {
      return;
    }

    const result = await onBulkDelete(Array.from(selectedExamIds));
    setBulkOperationResult(result);
    setShowBulkResult(true);
    clearSelection();
  };
  
  // Phase 4: Filter handlers
  const addFilter = (type: keyof ExamFilterOptions, value: string) => {
    setFilters(prev => {
      const current = prev[type] as string[];
      if (current.includes(value)) return prev;
      return { ...prev, [type]: [...current, value] };
    });
  };
  
  const removeFilter = (type: keyof ExamFilterOptions, value: string) => {
    setFilters(prev => ({
      ...prev,
      [type]: (prev[type] as string[]).filter(v => v !== value)
    }));
  };
  
  const clearAllFilters = () => {
    setFilters(DEFAULT_FILTERS);
    setSearchQuery('');
  };

  const presets: { id: ExamConfig['general']['preset'], label: string, icon: LucideIcon, description: string }[] = [
    { id: 'Academic', label: 'Academic Full', icon: Layers, description: 'Standard 4-module academic exam' },
    { id: 'General Training', label: 'GT Full', icon: Layers, description: 'Standard 4-module general training' },
    { id: 'Listening', label: 'Listening Drill', icon: Headset, description: 'Section-only listening practice' },
    { id: 'Reading', label: 'Reading Drill', icon: Book, description: 'Section-only reading practice' },
    { id: 'Writing', label: 'Writing Drill', icon: Pen, description: 'Section-only writing practice' },
    { id: 'Speaking', label: 'Speaking Drill', icon: Mic, description: 'Section-only speaking practice' },
    { id: 'Custom', label: 'Custom Build', icon: Settings2, description: 'Blank slate with custom modules' },
  ];

  const getStatusBadge = (status: string) => {
    const variant = status === 'Published' ? 'published' : 
                    status === 'Draft' ? 'draft' : 
                    status === 'Archived' ? 'warning' : 'neutral';
    return status === 'Published' 
      ? <StatusBadge variant={variant} size="sm" context="Live">{status}</StatusBadge>
      : <StatusBadge variant={variant} size="sm">{status}</StatusBadge>;
  };

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onCreateExam(
      newExamTitle || 'Untitled Exam', 
      newExamType,
      newExamPreset
    );
    setShowCreateModal(false);
  };

  const handleDropdownClick = (e: React.MouseEvent, examId: string) => {
    e.stopPropagation();
    if (activeDropdown === examId) {
      setActiveDropdown(null);
      setDropdownPosition(null);
    } else {
      const button = e.currentTarget as HTMLElement;
      const rect = button.getBoundingClientRect();
      setDropdownPosition({ top: rect.bottom + window.scrollY, left: rect.right - 192 + window.scrollX });
      setActiveDropdown(examId);
    }
  };

  const handleCloneClick = (exam: Exam) => {
    setSelectedExamForClone(exam);
    setCloneTitle(`${exam.title} (Copy)`);
    setCloneMode('clone');
    setShowCloneModal(true);
  };

  const handleCreateFromTemplateClick = (exam: Exam) => {
    setSelectedExamForClone(exam);
    setCloneTitle(`${exam.title} (from template)`);
    setCloneMode('template');
    setShowCloneModal(true);
  };

  const handleCloneSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedExamForClone || !cloneTitle.trim()) return;

    if (cloneMode === 'clone' && onCloneExam) {
      onCloneExam(selectedExamForClone.id, cloneTitle);
    } else if (cloneMode === 'template' && onCreateFromTemplate) {
      onCreateFromTemplate(selectedExamForClone.id, cloneTitle);
    }

    setShowCloneModal(false);
    setSelectedExamForClone(null);
    setCloneTitle('');
  };

  const handleViewVersionHistory = async (exam: Exam) => {
    const examEntity = examEntities?.find(e => e.id === exam.id);
    if (!examEntity) return;

    setSelectedExamForHistory(examEntity);
    
    // Load versions and events
    if (onGetVersions) {
      const loadedVersions = await onGetVersions(exam.id);
      setExamVersions(loadedVersions);
    }
    if (onGetEvents) {
      const loadedEvents = await onGetEvents(exam.id);
      setExamEvents(loadedEvents);
    }
    
    setShowVersionHistory(true);
  };

  const handleRestoreVersion = async (versionId: string) => {
    if (onRestoreVersion) {
      await onRestoreVersion(versionId);
      // Reload versions after restore
      if (selectedExamForHistory && onGetVersions) {
        const loadedVersions = await onGetVersions(selectedExamForHistory.id);
        setExamVersions(loadedVersions);
      }
    }
  };

  const handleRepublishVersion = async (versionId: string) => {
    if (onRepublishVersion) {
      await onRepublishVersion(versionId);
      // Reload versions after republish
      if (selectedExamForHistory && onGetVersions) {
        const loadedVersions = await onGetVersions(selectedExamForHistory.id);
        setExamVersions(loadedVersions);
      }
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h1 className="text-2xl font-bold text-gray-900">Exam Library</h1>
        
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-64">
            <Search className="absolute left-3 top-2.5 text-gray-400" size={16} />
            <input 
              type="text" 
              placeholder="Search exams..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>
          <button 
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-2 px-3 py-2 border rounded-md text-sm font-medium transition-colors ${
              showFilters || hasActiveFilters(filters) 
                ? 'bg-blue-50 border-blue-600 text-blue-700' 
                : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
            }`}
          >
            <Filter size={16} />
            Filters
            {hasActiveFilters(filters) && (
              <span className="ml-1 px-1.5 py-0.5 bg-blue-600 text-white text-xs rounded-full">
                {[filters.status, filters.type, filters.creator].flat().length}
              </span>
            )}
          </button>
          <button 
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md font-medium transition-colors"
          >
            <Plus size={18} />
            Create Exam
          </button>
          <div className="flex border border-gray-300 rounded-md overflow-hidden bg-white">
            <button 
              onClick={() => setView('grid')}
              className={`px-3 py-2 text-sm font-medium ${view === 'grid' ? 'bg-gray-100 text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
            >
              Grid
            </button>
            <button 
              onClick={() => setView('list')}
              className={`px-3 py-2 text-sm font-medium border-l border-gray-300 ${view === 'list' ? 'bg-gray-100 text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
            >
              List
            </button>
          </div>
        </div>
      </div>

      {/* Phase 4: Filter Chips */}
      {hasActiveFilters(filters) && (
        <div className="flex flex-wrap items-center gap-2">
          {filters.status.map(status => (
            <button
              key={status}
              onClick={() => removeFilter('status', status)}
              className="inline-flex items-center gap-1 px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm font-medium hover:bg-blue-200 transition-colors"
            >
              {status}
              <X size={14} />
            </button>
          ))}
          {filters.type.map(type => (
            <button
              key={type}
              onClick={() => removeFilter('type', type)}
              className="inline-flex items-center gap-1 px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm font-medium hover:bg-green-200 transition-colors"
            >
              {type}
              <X size={14} />
            </button>
          ))}
          {filters.creator.map(creator => (
            <button
              key={creator}
              onClick={() => removeFilter('creator', creator)}
              className="inline-flex items-center gap-1 px-3 py-1 bg-purple-100 text-purple-800 rounded-full text-sm font-medium hover:bg-purple-200 transition-colors"
            >
              {creator}
              <X size={14} />
            </button>
          ))}
          <button
            onClick={clearAllFilters}
            className="text-sm text-gray-500 hover:text-gray-700 font-medium"
          >
            Clear all
          </button>
        </div>
      )}

      {/* Phase 4: Filter Panel */}
      {showFilters && (
        <ExamFiltersPanel
          exams={exams}
          filters={filters}
          sort={sort}
          onAddFilter={addFilter}
          onRemoveFilter={removeFilter}
          onSortChange={setSort}
        />
      )}

      {/* Phase 4: Bulk Action Bar */}
      {selectedExamIds.size > 0 && (
        <ExamBulkActionBar
          selectedCount={selectedExamIds.size}
          onClearSelection={clearSelection}
          onBulkPublish={onBulkPublish ? handleBulkPublish : undefined}
          onBulkUnpublish={onBulkUnpublish ? handleBulkUnpublish : undefined}
          onBulkArchive={onBulkArchive ? handleBulkArchive : undefined}
          onBulkDelete={onBulkDelete ? handleBulkDelete : undefined}
          onBulkDuplicate={onBulkDuplicate ? handleBulkDuplicate : undefined}
          onBulkExport={onBulkExport ? handleBulkExport : undefined}
        />
      )}

      {view === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredAndSortedExams.map((exam) => {
            const stats = getExamStatsFromExam(exam);
            const isSelected = selectedExamIds.has(exam.id);
            
            return (
              <ExamGridCard
                key={exam.id}
                exam={exam}
                stats={stats}
                isSelected={isSelected}
                onToggleSelect={toggleSelectExam}
                onEdit={onEditExam}
                onPreview={(examId) => {
                  onEditExam(examId);
                  onNavigate('student');
                }}
                onDropdownClick={handleDropdownClick}
                getStatusBadge={getStatusBadge}
              />
            );
          })}
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200">
          {/* Table Header */}
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider border-b border-gray-200">
                <th className="px-6 py-3 font-medium w-8">
                  <input 
                    type="checkbox" 
                    checked={selectedExamIds.size === filteredAndSortedExams.length && filteredAndSortedExams.length > 0}
                    onChange={toggleSelectAll}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                </th>
                <th className="px-6 py-3 font-medium">Title</th>
                <th className="px-6 py-3 font-medium">Type</th>
                <th className="px-6 py-3 font-medium w-36">Status</th>
                <th className="px-6 py-3 font-medium">Questions</th>
                <th className="px-6 py-3 font-medium">Creator</th>
                <th className="px-6 py-3 font-medium">Modified</th>
                <th className="px-6 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
          </table>

          {/* Virtualized Table Body */}
          {filteredAndSortedExams.length > 0 ? (
            <Virtuoso
              style={{ height: VIRTUAL_LIST_HEIGHTS.EXAM_LIST }}
              data={filteredAndSortedExams}
              itemContent={(index: number, exam: Exam) => {
                const stats = getExamStatsFromExam(exam);
                const isSelected = selectedExamIds.has(exam.id);

                return (
                  <div className="divide-y divide-gray-200 text-sm">
                    <ExamListItem
                      exam={exam}
                      stats={stats}
                      isSelected={isSelected}
                      onToggleSelect={toggleSelectExam}
                      onEdit={onEditExam}
                      onDropdownClick={handleDropdownClick}
                      getStatusBadge={getStatusBadge}
                      onGoToConfig={onGoToConfig}
                      onGoToReview={onGoToReview}
                    />
                  </div>
                );
              }}
            />
          ) : (
            <div className="px-6 py-12 text-center text-gray-500">
              No exams found matching your filters
            </div>
          )}
        </div>
      )}

      {/* Create Exam Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              <h2 className="text-xl font-bold text-gray-900">Create New Exam</h2>
              <button onClick={() => setShowCreateModal(false)} className="text-gray-400 hover:text-gray-600 p-1">
                <X size={20} />
              </button>
            </div>
            
            <form onSubmit={handleCreateSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Exam Title</label>
                <input 
                  type="text" 
                  value={newExamTitle}
                  onChange={(e) => setNewExamTitle(e.target.value)}
                  placeholder="e.g. Academic Practice Test 5"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  autoFocus
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Select Preset</label>
                <div className="grid grid-cols-2 gap-2 max-h-60 overflow-y-auto p-1 border border-gray-100 rounded-lg">
                  {presets.map((preset) => {
                    const Icon = preset.icon;
                    const isActive = newExamPreset === preset.id;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => {
                          setNewExamPreset(preset.id);
                          if (preset.id === 'General Training') setNewExamType('General Training');
                          else if (preset.id === 'Academic') setNewExamType('Academic');
                        }}
                        className={`flex flex-col items-center gap-2 p-3 rounded-lg border text-left transition-all ${
                          isActive 
                            ? 'bg-blue-50 border-blue-600 ring-1 ring-blue-600' 
                            : 'bg-white border-gray-200 hover:border-blue-300 hover:bg-gray-50'
                        }`}
                      >
                        <div className={`p-1.5 rounded-md ${isActive ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500'}`}>
                          <Icon size={16} />
                        </div>
                        <div className="text-center">
                          <p className={`text-xs font-bold ${isActive ? 'text-blue-900' : 'text-gray-900'}`}>{preset.label}</p>
                          <p className="text-[10px] text-gray-500 line-clamp-1">{preset.description}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Standard Type</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    disabled={newExamPreset === 'General Training'}
                    onClick={() => setNewExamType('Academic')}
                    className={`px-3 py-2 rounded-md text-sm font-medium border ${newExamType === 'Academic' ? 'bg-blue-50 border-blue-600 text-blue-700' : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed'}`}
                  >
                    Academic
                  </button>
                  <button
                    type="button"
                    disabled={newExamPreset === 'Academic'}
                    onClick={() => setNewExamType('General Training')}
                    className={`px-3 py-2 rounded-md text-sm font-medium border ${newExamType === 'General Training' ? 'bg-blue-50 border-blue-600 text-blue-700' : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed'}`}
                  >
                    General Training
                  </button>
                </div>
              </div>

              <div className="pt-2">
                <label className="flex items-center gap-2 cursor-pointer group">
                  <input 
                    type="checkbox" 
                    checked={includeScheduling}
                    onChange={(e) => setIncludeScheduling(e.target.checked)}
                    className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm font-medium text-gray-700 group-hover:text-gray-900">Add to schedule immediately</span>
                </label>
              </div>

              {includeScheduling && (
                <div className="p-4 bg-gray-50 rounded-lg border border-gray-200 space-y-3 animate-in slide-in-from-top-2 duration-200">
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Class / Cohort</label>
                    <select 
                      value={scheduleData.cohort}
                      onChange={(e) => setScheduleData({...scheduleData, cohort: e.target.value})}
                      className="w-full px-3 py-1.5 border border-gray-300 rounded bg-white text-sm outline-none"
                    >
                      <option>Elite 2025-A</option>
                      <option>Morning Batch B</option>
                      <option>Weekend Intensive</option>
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Start Time</label>
                      <input 
                        type="datetime-local" 
                        value={scheduleData.start}
                        onChange={(e) => setScheduleData({...scheduleData, start: e.target.value})}
                        className="w-full px-2 py-1 border border-gray-300 rounded text-xs outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">End Time</label>
                      <input 
                        type="datetime-local" 
                        value={scheduleData.end}
                        onChange={(e) => setScheduleData({...scheduleData, end: e.target.value})}
                        className="w-full px-2 py-1 border border-gray-300 rounded text-xs outline-none"
                      />
                    </div>
                  </div>
                </div>
              )}

              <div className="pt-4 flex gap-3">
                <button 
                  type="button" 
                  onClick={() => setShowCreateModal(false)}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm font-medium shadow-sm transition-colors"
                >
                  Create & Open Builder
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Clone/Create from Template Modal */}
      {showCloneModal && selectedExamForClone && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              <h2 className="text-xl font-bold text-gray-900">
                {cloneMode === 'clone' ? 'Clone Exam' : 'Create from Template'}
              </h2>
              <button onClick={() => setShowCloneModal(false)} className="text-gray-400 hover:text-gray-600 p-1">
                <X size={20} />
              </button>
            </div>
            
            <form onSubmit={handleCloneSubmit} className="p-6 space-y-4">
              <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
                <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Source Exam</p>
                <p className="font-medium text-gray-900">{selectedExamForClone.title}</p>
                <p className="text-xs text-gray-500">{selectedExamForClone.type} • {selectedExamForClone.status}</p>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  {cloneMode === 'clone' ? 'New Exam Title' : 'Template Name'}
                </label>
                <input 
                  type="text" 
                  value={cloneTitle}
                  onChange={(e) => setCloneTitle(e.target.value)}
                  placeholder="Enter title..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  autoFocus
                  required
                />
              </div>

              <div className="pt-4 flex gap-3">
                <button 
                  type="button" 
                  onClick={() => setShowCloneModal(false)}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm font-medium shadow-sm transition-colors"
                >
                  {cloneMode === 'clone' ? 'Clone' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Bulk Operation Result Modal */}
      {showBulkResult && bulkOperationResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              <h2 className="text-xl font-bold text-gray-900">
                Bulk Operation Result
              </h2>
              <button onClick={() => setShowBulkResult(false)} className="text-gray-400 hover:text-gray-600 p-1">
                <X size={20} />
              </button>
            </div>
            
            <div className="p-6">
              <div className="flex items-center gap-4 mb-4">
                <div className={`flex items-center justify-center w-12 h-12 rounded-full ${bulkOperationResult.success ? 'bg-green-100' : 'bg-red-100'}`}>
                  {bulkOperationResult.success ? (
                    <CheckCircle size={24} className={bulkOperationResult.succeeded === bulkOperationResult.total ? 'text-green-600' : 'text-yellow-600'} />
                  ) : (
                    <XCircle size={24} className="text-red-600" />
                  )}
                </div>
                <div>
                  <p className="font-semibold text-gray-900">
                    {bulkOperationResult.succeeded === bulkOperationResult.total 
                      ? 'All operations completed successfully' 
                      : 'Some operations failed'}
                  </p>
                  <p className="text-sm text-gray-500">
                    {bulkOperationResult.succeeded} of {bulkOperationResult.total} succeeded
                    {bulkOperationResult.failed > 0 && ` (${bulkOperationResult.failed} failed)`}
                  </p>
                </div>
              </div>

              {bulkOperationResult.failed > 0 && (
                <div className="mt-4 max-h-60 overflow-y-auto border border-gray-200 rounded-lg">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="px-4 py-2 text-left font-medium text-gray-700">Exam</th>
                        <th className="px-4 py-2 text-left font-medium text-gray-700">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {bulkOperationResult.results.map((result, idx: number) => (
                        <tr key={idx} className={result.success ? 'bg-white' : 'bg-red-50'}>
                          <td className="px-4 py-2 text-gray-900">{result.examTitle}</td>
                          <td className="px-4 py-2">
                            {result.success ? (
                              <span className="text-green-600 flex items-center gap-1">
                                <CheckCircle size={14} /> Success
                              </span>
                            ) : (
                              <span className="text-red-600" title={result.error}>
                                <XCircle size={14} /> Failed
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="px-6 py-4 bg-gray-50 border-t border-gray-100">
              <button
                onClick={() => setShowBulkResult(false)}
                className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md font-medium transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Version History Modal */}
      {showVersionHistory && selectedExamForHistory && (
        <div className="fixed inset-0 z-50 flex justify-center items-center bg-black/40 animate-in fade-in duration-200">
          <div className="w-full max-w-4xl bg-white rounded-2xl shadow-2xl flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-300">
            <div className="h-16 px-6 border-b border-gray-100 flex items-center justify-between bg-gray-50 rounded-t-2xl flex-shrink-0">
              <div className="flex items-center gap-3">
                <GitCommit size={20} className="text-blue-600" />
                <div>
                  <span className="text-gray-900 font-bold text-lg">Version History</span>
                  <span className="text-gray-500 text-sm ml-2">{selectedExamForHistory.title}</span>
                </div>
              </div>
              <button 
                onClick={() => {
                  setShowVersionHistory(false);
                  setSelectedExamForHistory(null);
                  setExamVersions([]);
                  setExamEvents([]);
                }} 
                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-all"
              >
                <X size={20} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              <ExamVersionHistory
                exam={selectedExamForHistory}
                versions={examVersions}
                events={examEvents}
                onRestoreVersion={handleRestoreVersion}
                onRepublishVersion={handleRepublishVersion}
                onCompareVersions={onCompareVersions}
                onCloneExam={onCloneExam}
              />
            </div>
          </div>
        </div>
      )}

      {/* Portal-rendered dropdown */}
      {activeDropdown && dropdownPosition && createPortal(
        <div 
          className="fixed w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-[9999]"
          style={{ top: dropdownPosition.top, left: dropdownPosition.left }}
        >
          <div className="p-1">
            {onCloneExam && (
              <button
                onClick={() => {
                  const exam = exams.find(e => e.id === activeDropdown);
                  if (exam) {
                    handleCloneClick(exam);
                    setActiveDropdown(null);
                    setDropdownPosition(null);
                  }
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded"
              >
                <Copy size={14} />
                Clone Exam
              </button>
            )}
            {examEntities && onGetVersions && (
              <button
                onClick={() => {
                  const exam = exams.find(e => e.id === activeDropdown);
                  if (exam) {
                    handleViewVersionHistory(exam);
                    setActiveDropdown(null);
                    setDropdownPosition(null);
                  }
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded"
              >
                <GitCommit size={14} />
                Version History
              </button>
            )}
            {onCreateFromTemplate && (
              <button
                onClick={() => {
                  const exam = exams.find(e => e.id === activeDropdown);
                  if (exam) {
                    handleCreateFromTemplateClick(exam);
                    setActiveDropdown(null);
                    setDropdownPosition(null);
                  }
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded"
              >
                <LayoutTemplate size={14} />
                Create from Template
              </button>
            )}
            {onDeleteExam && (
              <button
                onClick={() => {
                  const exam = exams.find(e => e.id === activeDropdown);
                  if (exam && confirm(`Are you sure you want to delete "${exam.title}"?`)) {
                    onDeleteExam(exam.id);
                    setActiveDropdown(null);
                    setDropdownPosition(null);
                  }
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded"
              >
                <Trash2 size={14} />
                Delete Exam
              </button>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
