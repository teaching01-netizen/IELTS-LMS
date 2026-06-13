/**
 * Lazy-loading hook for exam versions.
 *
 * Provides two-phase loading:
 * 1. Load metadata immediately (small payload, ~2KB)
 * 2. Load content on demand (large payload, ~8MB)
 *
 * This enables:
 * - Fast initial render with version info
 * - Skeleton UI while content loads
 * - Reduced bandwidth when only metadata is needed
 */

import { useState, useEffect, useCallback } from 'react';
import { hydrateExamState } from '@services/examAdapterService';
import { examRepository } from '@services/examRepository';
import type { ExamVersionMetadata } from '../../../types/domain';
import type { ExamState } from '../../../types';

export interface UseLazyVersionLoadResult {
  /** Version metadata (loaded immediately) */
  metadata: ExamVersionMetadata | null;
  /** Hydrated exam state (loaded on demand) */
  state: ExamState | null;
  /** True while loading metadata */
  isMetadataLoading: boolean;
  /** True while loading content */
  isContentLoading: boolean;
  /** Error from metadata or content load */
  error: Error | null;
  /** Load the full content (called automatically or manually) */
  loadContent: () => Promise<void>;
  /** True if content has been loaded */
  isContentLoaded: boolean;
}

/**
 * Hook for lazy-loading exam version data.
 *
 * @param versionId - The version ID to load
 * @param autoLoadContent - If true, content loads automatically after metadata
 * @returns Metadata, state, loading states, and loadContent function
 *
 * @example
 * ```tsx
 * // Basic usage - content loads automatically
 * const { metadata, state, isMetadataLoading, isContentLoading } =
 *   useLazyVersionLoad(versionId);
 *
 * // Manual content loading
 * const { metadata, loadContent, isContentLoaded } =
 *   useLazyVersionLoad(versionId, false);
 *
 * // Load content when user clicks "Edit"
 * <button onClick={loadContent} disabled={isContentLoaded}>
 *   {isContentLoaded ? 'Editing...' : 'Start Editing'}
 * </button>
 * ```
 */
export function useLazyVersionLoad(
  versionId: string,
  autoLoadContent: boolean = true
): UseLazyVersionLoadResult {
  const [metadata, setMetadata] = useState<ExamVersionMetadata | null>(null);
  const [state, setState] = useState<ExamState | null>(null);
  const [isMetadataLoading, setIsMetadataLoading] = useState(true);
  const [isContentLoading, setIsContentLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Load metadata immediately
  useEffect(() => {
    let cancelled = false;

    const loadMetadata = async () => {
      setIsMetadataLoading(true);
      setError(null);

      try {
        const meta = await examRepository.getVersionMetadata(versionId);
        if (!cancelled) {
          setMetadata(meta);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err as Error);
        }
      } finally {
        if (!cancelled) {
          setIsMetadataLoading(false);
        }
      }
    };

    loadMetadata();

    return () => {
      cancelled = true;
    };
  }, [versionId]);

  // Lazy-load content
  const loadContent = useCallback(async () => {
    if (state || isContentLoading) {
      return; // Already loaded or loading
    }

    setIsContentLoading(true);
    setError(null);

    try {
      const content = await examRepository.getVersionBuilderContent(versionId);
      if (content) {
        // Hydrate the content snapshot into a full ExamState
        const hydrated = hydrateExamState(content.contentSnapshot);
        setState(hydrated);
      }
    } catch (err) {
      setError(err as Error);
    } finally {
      setIsContentLoading(false);
    }
  }, [versionId, state, isContentLoading]);

  // Auto-load content if requested
  useEffect(() => {
    if (autoLoadContent && metadata && !state && !isContentLoading) {
      loadContent();
    }
  }, [autoLoadContent, metadata, state, isContentLoading, loadContent]);

  return {
    metadata,
    state,
    isMetadataLoading,
    isContentLoading,
    error,
    loadContent,
    isContentLoaded: state !== null,
  };
}

/**
 * Simplified hook for cases where you only need metadata.
 *
 * @param versionId - The version ID to load
 * @returns Metadata and loading state
 */
export function useVersionMetadata(versionId: string) {
  const [metadata, setMetadata] = useState<ExamVersionMetadata | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const meta = await examRepository.getVersionMetadata(versionId);
        if (!cancelled) {
          setMetadata(meta);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err as Error);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    load();

    return () => {
      cancelled = true;
    };
  }, [versionId]);

  return { metadata, isLoading, error };
}
