/**
 * React Query Client Configuration
 * Provides centralized data fetching, caching, and state management
 */

import { QueryClient, QueryCache, MutationCache } from '@tanstack/react-query';
import { logError } from '../error/errorLogger';

/**
 * Default stale time for queries (5 minutes)
 * Data is considered fresh for 5 minutes after fetch
 */
const DEFAULT_STALE_TIME = 5 * 60 * 1000;

/**
 * Default cache time for queries (10 minutes)
 * Unused data is garbage collected after 10 minutes
 */
const DEFAULT_CACHE_TIME = 10 * 60 * 1000;

export const liveQueryPolicy = {
  staleTime: 15 * 1000,
  gcTime: 2 * 60 * 1000,
} as const;

export const staticQueryPolicy = {
  staleTime: 30 * 60 * 1000,
  gcTime: 60 * 60 * 1000,
} as const;

/**
 * Default retry configuration
 * Retry failed requests up to 3 times with exponential backoff
 */
const DEFAULT_RETRY_CONFIG = {
  retry: 3,
  retryDelay: (attemptIndex: number) => Math.min(1000 * 2 ** attemptIndex, 30000),
};

/**
 * Query keys for different data types
 * Using a structured approach for cache key management
 */
export const queryKeys = {
  // Exam-related queries
  exams: {
    all: ['exams'] as const,
    lists: () => [...queryKeys.exams.all, 'list'] as const,
    details: (id: string) => [...queryKeys.exams.all, 'detail', id] as const,
    versions: (examId: string) => [...queryKeys.exams.all, examId, 'versions'] as const,
    events: (examId: string) => [...queryKeys.exams.all, examId, 'events'] as const,
  },

  // Schedule-related queries
  schedules: {
    all: ['schedules'] as const,
    lists: () => [...queryKeys.schedules.all, 'list'] as const,
    details: (id: string) => [...queryKeys.schedules.all, 'detail', id] as const,
    active: () => [...queryKeys.schedules.all, 'active'] as const,
  },

  // Session-related queries
  sessions: {
    all: ['sessions'] as const,
    lists: (scheduleId: string) => [...queryKeys.sessions.all, scheduleId, 'list'] as const,
    details: (id: string) => [...queryKeys.sessions.all, 'detail', id] as const,
    students: (scheduleId: string) => [...queryKeys.sessions.all, scheduleId, 'students'] as const,
  },

  // Grading-related queries
  grading: {
    all: ['grading'] as const,
    sessions: () => [...queryKeys.grading.all, 'sessions'] as const,
    submissions: (sessionId: string) => [...queryKeys.grading.all, sessionId, 'submissions'] as const,
    submission: (id: string) => [...queryKeys.grading.all, 'submission', id] as const,
    review: (submissionId: string) => [...queryKeys.grading.all, submissionId, 'review'] as const,
  },

  // Student-related queries
  students: {
    all: ['students'] as const,
    lists: () => [...queryKeys.students.all, 'list'] as const,
    details: (id: string) => [...queryKeys.students.all, 'detail', id] as const,
  },

  // Proctoring-related queries
  proctoring: {
    all: ['proctoring'] as const,
    alerts: (scheduleId: string) => [...queryKeys.proctoring.all, scheduleId, 'alerts'] as const,
    audit: (scheduleId: string) => [...queryKeys.proctoring.all, scheduleId, 'audit'] as const,
    runtime: (scheduleId: string) => [...queryKeys.proctoring.all, scheduleId, 'runtime'] as const,
  },
};

/**
 * Create and configure the QueryClient
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: DEFAULT_STALE_TIME,
        gcTime: DEFAULT_CACHE_TIME,
        retry: DEFAULT_RETRY_CONFIG.retry,
        retryDelay: DEFAULT_RETRY_CONFIG.retryDelay,
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
        refetchOnMount: true,
      },
      mutations: {
        retry: 1,
      },
    },
    queryCache: new QueryCache({
      onError: (error) => {
        logError(error, { context: 'QueryCache' });
      },
    }),
    mutationCache: new MutationCache({
      onError: (error) => {
        logError(error, { context: 'MutationCache' });
      },
    }),
  });
}

/**
 * Singleton query client instance
 */
export const queryClient = createQueryClient();

/**
 * Invalidate queries by key pattern
 * Useful for cache invalidation after mutations
 */
export function invalidateQueries(key: readonly unknown[]): void {
  queryClient.invalidateQueries({ queryKey: key });
}

/**
 * Invalidate all queries
 * Useful for logout or full refresh scenarios
 */
export function invalidateAllQueries(): void {
  queryClient.invalidateQueries();
}

/**
 * Prefetch queries for better UX
 * Load data before it's needed
 */
export async function prefetchQuery<T>(
  key: readonly unknown[],
  queryFn: () => Promise<T>
): Promise<void> {
  await queryClient.prefetchQuery({
    queryKey: key,
    queryFn,
  });
}

/**
 * Cancel ongoing queries
 * Useful for cleanup on unmount
 */
export function cancelQueries(key: readonly unknown[]): void {
  queryClient.cancelQueries({ queryKey: key });
}

/**
 * Reset queries to initial state
 * Removes cached data and refetches on next access
 */
export function resetQueries(key: readonly unknown[]): void {
  queryClient.resetQueries({ queryKey: key });
}

/**
 * Set query data manually
 * Useful for optimistic updates
 */
export function setQueryData<T>(key: readonly unknown[], data: T): void {
  queryClient.setQueryData(key, data);
}

/**
 * Get query data from cache
 */
export function getQueryData<T>(key: readonly unknown[]): T | undefined {
  return queryClient.getQueryData<T>(key);
}
