/**
 * Performance optimization utilities
 * Common memoization patterns for React applications
 */

import { useMemo, useCallback, useRef } from 'react';

/**
 * Memoizes a function result based on dependencies
 * Similar to useMemo but for function results
 */
export function useMemoized<T>(
  fn: () => T,
  deps: React.DependencyList
): T {
  return useMemo(fn, deps);
}

/**
 * Memoizes a callback with a stable reference
 * Wrapper around useCallback with additional debugging
 */
export function useStableCallback<T extends (...args: unknown[]) => unknown>(
  callback: T,
  deps: React.DependencyList
): T {
  return useCallback(callback, deps) as T;
}

/**
 * Memoizes a value with a custom comparison function
 * Useful when the default reference equality isn't sufficient
 */
export function useMemoCompare<T>(
  value: T,
  compare: (prev: T | undefined, next: T) => boolean,
  deps: React.DependencyList
): T {
  const prevRef = useRef<T | undefined>(undefined);
  const prevDepsRef = useRef<React.DependencyList | undefined>(undefined);

  if (!prevDepsRef.current || !depsAreEqual(prevDepsRef.current, deps) || !compare(prevRef.current, value)) {
    prevRef.current = value;
    prevDepsRef.current = deps;
  }

  return prevRef.current as T;
}

/**
 * Memoizes a value using deep comparison
 * Note: This has a performance cost, use sparingly
 */
export function useMemoDeep<T>(value: T, deps: React.DependencyList): T {
  return useMemoCompare(
    value,
    (prev, next) => JSON.stringify(prev) === JSON.stringify(next),
    deps
  );
}

/**
 * Memoizes a function result with a cache key
 */
export function useCachedResult<T>(
  key: string,
  fn: () => T,
  deps: React.DependencyList
): T {
  const cacheRef = useRef<Map<string, T>>(new Map());

  return useMemo(() => {
    if (cacheRef.current.has(key)) {
      return cacheRef.current.get(key)!;
    }
    const result = fn();
    cacheRef.current.set(key, result);
    return result;
  }, [key, fn, ...deps]);
}

/**
 * Throttles a function call
 */
export function useThrottle<T extends (...args: unknown[]) => unknown>(
  callback: T,
  delay: number
): T {
  const lastRunRef = useRef<number>(0);

  return useCallback(
    (...args: Parameters<T>) => {
      const now = Date.now();
      if (now - lastRunRef.current >= delay) {
        lastRunRef.current = now;
        callback(...args);
      }
    },
    [callback, delay]
  ) as T;
}

/**
 * Debounces a function call
 */
export function useDebounce<T extends (...args: unknown[]) => unknown>(
  callback: T,
  delay: number
): T {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  return useCallback(
    (...args: Parameters<T>) => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => {
        callback(...args);
      }, delay);
    },
    [callback, delay]
  ) as T;
}

/**
 * Memoizes an array of items based on their IDs
 * Useful for lists where the order might change but items are the same
 */
export function useMemoizeArrayById<T extends { id: string }>(
  items: T[],
  deps: React.DependencyList
): T[] {
  return useMemo(() => {
    const map = new Map(items.map(item => [item.id, item]));
    return Array.from(map.values());
  }, [items, ...deps]);
}

/**
 * Memoizes a sorted array
 */
export function useMemoizedSort<T>(
  array: T[],
  sortFn: (a: T, b: T) => number,
  deps: React.DependencyList
): T[] {
  return useMemo(() => [...array].sort(sortFn), [array, sortFn, ...deps]);
}

/**
 * Memoizes a filtered array
 */
export function useMemoizedFilter<T>(
  array: T[],
  filterFn: (item: T) => boolean,
  deps: React.DependencyList
): T[] {
  return useMemo(() => array.filter(filterFn), [array, filterFn, ...deps]);
}

/**
 * Memoizes a mapped array
 */
export function useMemoizedMap<T, U>(
  array: T[],
  mapFn: (item: T, index: number) => U,
  deps: React.DependencyList
): U[] {
  return useMemo(() => array.map(mapFn), [array, mapFn, ...deps]);
}

/**
 * Memoizes a reduced value
 */
export function useMemoizedReduce<T, U>(
  array: T[],
  reduceFn: (acc: U, item: T, index: number) => U,
  initialValue: U,
  deps: React.DependencyList
): U {
  return useMemo(() => array.reduce(reduceFn, initialValue), [array, reduceFn, initialValue, ...deps]);
}

/**
 * Helper to compare dependency arrays
 */
function depsAreEqual(a: React.DependencyList, b: React.DependencyList): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Creates a memoized selector function
 * Useful for selecting specific data from large objects
 */
export function useMemoizedSelector<T, U>(
  data: T,
  selector: (data: T) => U,
  deps: React.DependencyList
): U {
  return useMemo(() => selector(data), [data, selector, ...deps]);
}

/**
 * Memoizes a computed value based on multiple sources
 */
export function useComputedValue<T>(
  computeFn: () => T,
  sources: React.DependencyList
): T {
  return useMemo(computeFn, sources);
}
