import React, { useId } from 'react';

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
  onRowClick?: (row: T, index: number) => void;
  onRowAction?: (row: T, index: number) => React.ReactNode;
  emptyMessage?: string;
  className?: string;
  isLoading?: boolean;
  ariaLabel?: string;
}

export function DataTable<T>({
  columns,
  data,
  onRowClick,
  onRowAction,
  emptyMessage = 'No data available',
  isLoading = false,
  ariaLabel = 'Data table',
  className = '',
}: DataTableProps<T>) {
  const tableId = useId();

  if (isLoading) {
    return (
      <div
        id={tableId}
        className="flex items-center justify-center p-8 bg-white border border-gray-100 rounded-sm"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <div className="text-gray-500 text-sm">Loading...</div>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div
        id={tableId}
        className="flex items-center justify-center p-8 bg-white border border-gray-100 rounded-sm"
        role="status"
        aria-live="polite"
      >
        <div className="text-gray-500 text-sm">{emptyMessage}</div>
      </div>
    );
  }

  const handleKeyDown = (e: React.KeyboardEvent, row: T, index: number) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onRowClick?.(row, index);
    }
  };

  return (
    <div className={`overflow-x-auto bg-white border border-gray-100 rounded-sm ${className}`}>
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
                Actions
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {data.map((row, index) => (
            <tr
              key={index}
              className={`border-b border-gray-50 transition-colors ${
                onRowClick ? 'hover:bg-gray-50 cursor-pointer' : ''
              }`}
              onClick={onRowClick ? () => onRowClick(row, index) : undefined}
              onKeyDown={onRowClick ? (e) => handleKeyDown(e, row, index) : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              role={onRowClick ? 'button' : undefined}
              aria-label={onRowClick ? `Row ${index + 1}` : undefined}
            >
              {columns.map((column) => (
                <td key={column.key} className="px-4 py-3 text-sm text-gray-900">
                  {column.render
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
          ))}
        </tbody>
      </table>
    </div>
  );
}
