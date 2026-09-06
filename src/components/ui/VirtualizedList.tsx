/**
 * Virtualized List Component
 * Uses react-virtuoso for efficient rendering of large lists
 */

import React from 'react';
import { Virtuoso, VirtuosoGrid } from 'react-virtuoso';

interface VirtualizedListProps<T> {
  data: T[];
  renderItem: (item: T, index: number) => React.ReactNode;
  itemHeight?: number;
  className?: string;
  overscan?: number;
  endReached?: () => void;
  loading?: boolean;
  loadingComponent?: React.ReactNode;
  emptyComponent?: React.ReactNode;
}

/**
 * Virtualized vertical list for large datasets
 * Only renders visible items for optimal performance
 */
export function VirtualizedList<T>({
  data,
  renderItem,
  itemHeight = 60,
  className,
  overscan = 200,
  endReached,
  loading,
  loadingComponent,
  emptyComponent,
}: VirtualizedListProps<T>): React.ReactElement {
  void itemHeight;
  if (loading) {
    if (loadingComponent) {
      return <>{loadingComponent}</>;
    }
    return (
      <div role="status" aria-live="polite" aria-busy="true">
        <span className="sr-only">Loading…</span>
      </div>
    );
  }

  if (data.length === 0) {
    if (emptyComponent) {
      return <>{emptyComponent}</>;
    }
    return (
      <div role="status" aria-live="polite" className="flex items-center justify-center p-8 text-sm text-gray-500">
        No items to display
      </div>
    );
  }

  return (
    <Virtuoso
      style={{ height: '100%' }}
      data={data}
      itemContent={(index, item) => renderItem(item, index)}
      overscan={overscan}
      {...(endReached ? { endReached: () => endReached() } : {})}
      {...(className ? { className } : {})}
    />
  );
}

interface VirtualizedGridProps<T> {
  data: T[];
  renderItem: (item: T, index: number) => React.ReactNode;
  itemClassName?: string;
  className?: string;
  overscan?: number;
  endReached?: () => void;
  loading?: boolean;
  loadingComponent?: React.ReactNode;
  emptyComponent?: React.ReactNode;
}

/**
 * Virtualized grid for large datasets
 * Only renders visible items for optimal performance
 */
export function VirtualizedGrid<T>({
  data,
  renderItem,
  itemClassName,
  className,
  overscan = 200,
  endReached,
  loading,
  loadingComponent,
  emptyComponent,
}: VirtualizedGridProps<T>): React.ReactElement {
  if (loading) {
    if (loadingComponent) {
      return <>{loadingComponent}</>;
    }
    return (
      <div role="status" aria-live="polite" aria-busy="true">
        <span className="sr-only">Loading…</span>
      </div>
    );
  }

  if (data.length === 0) {
    if (emptyComponent) {
      return <>{emptyComponent}</>;
    }
    return (
      <div role="status" aria-live="polite" className="flex items-center justify-center p-8 text-sm text-gray-500">
        No items to display
      </div>
    );
  }

  return (
    <VirtuosoGrid
      style={{ height: '100%' }}
      data={data}
      itemContent={(index, item) => renderItem(item, index)}
      overscan={overscan}
      {...(itemClassName ? { itemClassName } : {})}
      {...(endReached ? { endReached: (_index: number) => endReached() } : {})}
      {...(className ? { className } : {})}
    />
  );
}
