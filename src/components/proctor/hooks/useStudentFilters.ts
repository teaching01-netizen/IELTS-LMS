import { useState, useMemo, useCallback, useEffect } from 'react';
import { StudentSession, StudentStatus, ModuleType } from '../../../types';

export interface StudentFilterCriteria {
  status?: StudentStatus | undefined;
  section?: ModuleType | undefined;
  minViolations?: number | undefined;
  maxViolations?: number | undefined;
  minTimeRemaining?: number | undefined;
  maxTimeRemaining?: number | undefined;
  searchQuery?: string | undefined;
}

export interface SavedFilter {
  id: string;
  name: string;
  criteria: StudentFilterCriteria;
}

const DEFAULT_FILTERS: SavedFilter[] = [
  {
    id: 'needs-attention',
    name: 'Needs Attention',
    criteria: {
      status: 'warned'
    }
  },
  {
    id: 'high-violations',
    name: '2+ Violations',
    criteria: {
      minViolations: 2
    }
  },
  {
    id: 'paused',
    name: 'Paused',
    criteria: {
      status: 'paused'
    }
  },
  {
    id: 'low-time',
    name: 'Low Time (< 10 min)',
    criteria: {
      maxTimeRemaining: 600
    }
  }
];

export function useStudentFilters(sessions: StudentSession[]) {
  const [filterCriteria, setFilterCriteria] = useState<StudentFilterCriteria>(() => {
    try {
      const saved = sessionStorage.getItem('studentFilterCriteria');
      if (!saved) {
        return {};
      }
      const parsed: unknown = JSON.parse(saved);
      return typeof parsed === 'object' && parsed !== null
        ? (parsed as StudentFilterCriteria)
        : {};
    } catch {
      return {};
    }
  });
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>(DEFAULT_FILTERS);
  const [activeFilterId, setActiveFilterId] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem('activeFilterId') || null;
    } catch {
      return null;
    }
  });

  // Persist filter criteria to session storage
  useEffect(() => {
    try {
      sessionStorage.setItem('studentFilterCriteria', JSON.stringify(filterCriteria));
    } catch {
      // Storage unavailable; filters stay in memory.
    }
  }, [filterCriteria]);

  // Persist active filter ID to session storage
  useEffect(() => {
    try {
      if (activeFilterId) {
        sessionStorage.setItem('activeFilterId', activeFilterId);
      } else {
        sessionStorage.removeItem('activeFilterId');
      }
    } catch {
      // Storage unavailable; filters stay in memory.
    }
  }, [activeFilterId]);

  const parseAdvancedQuery = useCallback((query: string): StudentFilterCriteria => {
    const criteria: StudentFilterCriteria = {};
    const parts = query.split(/\s+/).filter(Boolean);

    parts.forEach(part => {
      if (part.includes(':')) {
        const [rawKey = '', rawValue = ''] = part.split(':', 2);
        const key = rawKey.trim();
        const value = rawValue.trim();

        switch (key.toLowerCase()) {
          case 'status':
            criteria.status = value as StudentStatus;
            break;
          case 'section':
            criteria.section = value as ModuleType;
            break;
          case 'violations':
            const violations = parseInt(value);
            if (!isNaN(violations)) {
              criteria.minViolations = violations;
            }
            break;
          case 'time':
            const time = parseInt(value);
            if (!isNaN(time)) {
              criteria.maxTimeRemaining = time * 60;
            }
            break;
          default:
            criteria.searchQuery = part;
        }
      } else {
        criteria.searchQuery = (criteria.searchQuery || '') + ' ' + part;
      }
    });

    return criteria;
  }, []);

  const filteredSessions = useMemo(() => {
    return sessions.filter(session => {
      // Status filter
      if (filterCriteria.status && session.status !== filterCriteria.status) {
        return false;
      }

      // Section filter
      if (filterCriteria.section) {
        const currentSection = session.runtimeCurrentSection ?? session.currentSection;
        if (currentSection !== filterCriteria.section) {
          return false;
        }
      }

      // Violation count filter
      if (filterCriteria.minViolations !== undefined && session.violations.length < filterCriteria.minViolations) {
        return false;
      }
      if (filterCriteria.maxViolations !== undefined && session.violations.length > filterCriteria.maxViolations) {
        return false;
      }

      // Time remaining filter
      const timeRemaining = session.runtimeTimeRemainingSeconds ?? session.timeRemaining;
      if (filterCriteria.minTimeRemaining !== undefined && timeRemaining < filterCriteria.minTimeRemaining) {
        return false;
      }
      if (filterCriteria.maxTimeRemaining !== undefined && timeRemaining > filterCriteria.maxTimeRemaining) {
        return false;
      }

      // Search query filter
      if (filterCriteria.searchQuery) {
        const query = filterCriteria.searchQuery.toLowerCase().trim();
        const matchesName = session.name.toLowerCase().includes(query);
        const matchesId = session.studentId.toLowerCase().includes(query);
        if (!matchesName && !matchesId) {
          return false;
        }
      }

      return true;
    });
  }, [sessions, filterCriteria]);

  const applySavedFilter = useCallback((filterId: string) => {
    const filter = savedFilters.find(f => f.id === filterId);
    if (filter) {
      setFilterCriteria(filter.criteria);
      setActiveFilterId(filterId);
    }
  }, [savedFilters]);

  const clearFilters = useCallback(() => {
    setFilterCriteria({});
    setActiveFilterId(null);
  }, []);

  const [filterCriteriaVersion, setFilterCriteriaVersion] = useState(0);
  // Clearing the active filter lives OUTSIDE the criteria updater (updaters
  // must be pure): a version bump observed by the effect below clears it
  // when the post-removal criteria are empty.
  useEffect(() => {
    if (filterCriteriaVersion > 0 && Object.keys(filterCriteria).length === 0 && activeFilterId) {
      setActiveFilterId(null);
    }
  }, [filterCriteriaVersion, filterCriteria, activeFilterId]);
  const removeFilter = useCallback((key: keyof StudentFilterCriteria) => {
    setFilterCriteria((prev) => {
      const newCriteria = { ...prev };
      delete newCriteria[key];
      return newCriteria;
    });
    setFilterCriteriaVersion((version) => version + 1);
  }, []);

  const saveCustomFilter = useCallback((name: string) => {
    const newFilter: SavedFilter = {
      id: `custom-${Date.now()}`,
      name,
      criteria: { ...filterCriteria }
    };
    setSavedFilters(prev => [...prev, newFilter]);
    return newFilter.id;
  }, [filterCriteria]);

  const deleteSavedFilter = useCallback((filterId: string) => {
    setSavedFilters(prev => prev.filter(f => f.id !== filterId));
    if (activeFilterId === filterId) {
      setActiveFilterId(null);
    }
  }, [activeFilterId]);

  const hasActiveFilters = Object.keys(filterCriteria).length > 0;

  return {
    filterCriteria,
    setFilterCriteria,
    filteredSessions,
    savedFilters,
    activeFilterId,
    applySavedFilter,
    clearFilters,
    removeFilter,
    saveCustomFilter,
    deleteSavedFilter,
    parseAdvancedQuery,
    hasActiveFilters
  };
}
