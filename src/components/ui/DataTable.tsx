import React, { useId } from 'react';
import { TableLoadingSkeleton } from './TableLoadingSkeleton';

export interface Column<T> {
  key: string;
  header: string;
  render?: (value: unknown, row: T, index: number) => React.ReactNode;
  sortable?: boolean;
  width?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  /** Optional stable key per row. Falls back to the `id` field, then index. */
  getRowKey?: ((row: T, index: number) => string) | undefined;
  onRowClick?: (row: T, index: number) => void;
  onRowAction?: (row: T, index: number) => React.ReactNode;
  emptyMessage?: string;
  className?: string;
  isLoading?: boolean;
  isError?: boolean;
  errorMessage?: string;
  onRetry?: (() => void) | undefined;
  ariaLabel?: string;
}

function defaultRowKey<T>(row: T, index: number): string {
  if (typeof row === 'object' && row !== null && 'id' in row) {
    const id = (row as { id?: unknown }).id;
    if (typeof id === 'string' && id.length > 0) return id;
    if (typeof id === 'number' && Number.isFinite(id)) return `row-${String(id)}`;
  }
  return `row-${index}`;
}

interface DataTableRefProps {
  ref?: React.Ref<HTMLDivElement>;
}

function DataTableInner<T>({
  columns,
  data,
  getRowKey,
  onRowClick,
  onRowAction,
  emptyMessage = 'No data available',
  isLoading = false,
  isError = false,
  errorMessage = 'Something went wrong loading this table.',
  onRetry,
  ariaLabel = 'Data table',
  className = '',
  ref,
}: DataTableProps<T> & DataTableRefProps) {
  const tableId = useId();

  if (isLoading) {
    return (
      <div
        id={tableId}
        ref={ref}
        className="bg-white border border-gray-100 rounded-sm"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <span className="sr-only">Loading…</span>
        <TableLoadingSkeleton />
      </div>
    );
  }

  if (isError) {
    return (
      <div
        id={tableId}
        ref={ref}
        className="flex flex-col items-center justify-center gap-3 p-8 bg-white border border-gray-100 rounded-sm"
        role="alert"
      >
        <div className="text-gray-700 text-sm font-medium">{errorMessage}</div>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="px-3 py-1.5 text-sm font-medium text-blue-700 border border-blue-200 rounded-sm hover:bg-blue-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600/25"
          >
            Retry
          </button>
        )}
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div
        id={tableId}
        ref={ref}
        className="flex items-center justify-center p-8 bg-white border border-gray-100 rounded-sm"
        role="status"
        aria-live="polite"
      >
        <div className="text-gray-500 text-sm">{emptyMessage}</div>
      </div>
    );
  }

  // Space keydown on a row *button* already fires click natively; handling it
  // again would double-invoke onRowClick. Enter is handled for inner spans.
  const handleRowKeyDown = (e: React.KeyboardEvent, row: T, index: number) => {
    if (e.key !== 'Enter') return;
    if (e.target !== e.currentTarget) return;
    e.preventDefault();
    onRowClick?.(row, index);
  };

  return (
    <div ref={ref} className={`overflow-x-auto bg-white border border-gray-100 rounded-sm ${className}`}>
      <table
        id={tableId}
        className="w-full"
        aria-label={ariaLabel}
      >
        <thead>
          <tr className="border-b border-gray-100 bg-gray-50">
            {columns.map((column) => (
              <th
                key={column.key}
                className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-gray-700"
                style={{ width: column.width }}
                scope="col"
              >
                {column.header}
              </th>
            ))}
            {onRowAction && (
              <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-gray-700 w-16" scope="col">
                <span className="sr-only">Row actions</span>
                <span aria-hidden="true">Actions</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {data.map((row, index) => {
            const rowKey = getRowKey ? getRowKey(row, index) : defaultRowKey(row, index);
            const rowLabel = `Row ${index + 1}`;
            return (
              <tr
                key={rowKey}
                className={`border-b border-gray-50 transition-colors ${
                  onRowClick
                    ? 'hover:bg-gray-50 focus-within:bg-gray-50'
                    : ''
                }`}
              >
                {columns.map((column) => (
                  <td key={column.key} className="px-4 py-3 text-sm text-gray-900">
                    {onRowClick ? (
                      <button
                        type="button"
                        onClick={() => onRowClick(row, index)}
                        onKeyDown={(e) => handleRowKeyDown(e, row, index)}
                        aria-label={`${column.header}: ${rowLabel}`}
                        className="block w-full text-left rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600/60 focus-visible:-outline-offset-2 cursor-pointer"
                      >
                        {column.render
                          ? column.render((row as Record<string, unknown>)[column.key], row, index)
                          : (row as Record<string, unknown>)[column.key] as React.ReactNode}
                      </button>
                    ) : column.render
                      ? column.render((row as Record<string, unknown>)[column.key], row, index)
                      : (row as Record<string, unknown>)[column.key] as React.ReactNode}
                  </td>
                ))}
                {onRowAction && (
                  <td className="px-4 py-3 text-sm text-gray-900">
                    {onRowAction(row, index)}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// S4-C7: ref forwarding for DataTable (outer container).
export const DataTable = React.forwardRef(function DataTableForwarded<T>(
  props: DataTableProps<T>,
  ref: React.Ref<HTMLDivElement>,
) {
  return <DataTableInner {...props} ref={ref} />;
}) as <T>(props: DataTableProps<T> & { ref?: React.Ref<HTMLDivElement> }) => React.ReactElement;
