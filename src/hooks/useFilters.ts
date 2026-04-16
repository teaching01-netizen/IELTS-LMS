/**
 * Custom hook for exam filtering and sorting logic
 * Extracted from AdminExams to reduce component complexity
 */

import { useState, useMemo } from 'react';
import { Exam } from '../types';
import {
  ExamFilterOptions,
  ExamSortOptions,
  DEFAULT_FILTERS,
  DEFAULT_SORT,
  hasActiveFilters,
  getExamStatsFromExam
} from '../utils/examStats';

interface UseFiltersProps {
  exams: Exam[];
}

interface UseFiltersReturn {
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  filters: ExamFilterOptions;
  setFilters: (filters: ExamFilterOptions) => void;
  sort: ExamSortOptions;
  setSort: (sort: ExamSortOptions) => void;
  showFilters: boolean;
  setShowFilters: (show: boolean) => void;
  filteredAndSortedExams: Exam[];
  addFilter: (type: keyof ExamFilterOptions, value: string) => void;
  removeFilter: (type: keyof ExamFilterOptions, value: string) => void;
  clearAllFilters: () => void;
  hasActiveFiltersFlag: boolean;
}

export function useFilters({ exams }: UseFiltersProps): UseFiltersReturn {
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState<ExamFilterOptions>(DEFAULT_FILTERS);
  const [sort, setSort] = useState<ExamSortOptions>(DEFAULT_SORT);
  const [showFilters, setShowFilters] = useState(false);

  // Filter and sort logic
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

  // Filter handlers
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

  const hasActiveFiltersFlag = hasActiveFilters(filters);

  return {
    searchQuery,
    setSearchQuery,
    filters,
    setFilters,
    sort,
    setSort,
    showFilters,
    setShowFilters,
    filteredAndSortedExams,
    addFilter,
    removeFilter,
    clearAllFilters,
    hasActiveFiltersFlag
  };
}
