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

import { useState, useEffect, useCallback, useRef } from 'react';
import { examRepository, hydrateExamState } from '../../exam-authoring/api/examAuthoringGateway';
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
  const generationRef = useRef(0);
  const contentRequestRef = useRef<{ versionId: string; promise: Promise<void> } | null>(null);

  // Load metadata immediately
  useEffect(() => {
    let cancelled = false;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    contentRequestRef.current = null;

    setMetadata(null);
    setState(null);
    setIsContentLoading(false);
    setError(null);

    const loadMetadata = async () => {
      setIsMetadataLoading(true);

      try {
        const meta = await examRepository.getVersionMetadata(versionId);
        if (!meta) {
          throw new Error(`Version ${versionId} not found`);
        }
        if (!cancelled && generationRef.current === generation) {
          setMetadata(meta);
        }
      } catch (err) {
        if (!cancelled && generationRef.current === generation) {
          setError(err as Error);
        }
      } finally {
        if (!cancelled && generationRef.current === generation) {
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
  const loadContent = useCallback((): Promise<void> => {
    if (state) {
      return Promise.resolve();
    }

    const existingRequest = contentRequestRef.current;
    if (existingRequest?.versionId === versionId) {
      return existingRequest.promise;
    }

    const generation = generationRef.current;
    setIsContentLoading(true);
    setError(null);

    const request = (async () => {
      try {
        const content = await examRepository.getVersionBuilderContent(versionId);
        if (!content) {
          throw new Error(`Version ${versionId} content not found`);
        }
        if (generationRef.current !== generation) {
          return;
        }
        const hydrated = hydrateExamState({
          ...content.contentSnapshot,
          config: content.configSnapshot ?? content.contentSnapshot.config,
        });
        setState(hydrated);
      } catch (err) {
        if (generationRef.current === generation) {
          setError(err as Error);
        }
      } finally {
        if (generationRef.current === generation) {
          setIsContentLoading(false);
          contentRequestRef.current = null;
        }
      }
    })();

    contentRequestRef.current = { versionId, promise: request };
    return request;
  }, [versionId, state]);

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
        if (!meta) {
          throw new Error(`Version ${versionId} not found`);
        }
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
