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
  if (loading && loadingComponent) {
    return <>{loadingComponent}</>;
  }

  if (data.length === 0 && emptyComponent) {
    return <>{emptyComponent}</>;
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
  if (loading && loadingComponent) {
    return <>{loadingComponent}</>;
  }

  if (data.length === 0 && emptyComponent) {
    return <>{emptyComponent}</>;
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
