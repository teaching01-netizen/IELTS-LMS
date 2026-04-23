import React from 'react';

interface TableLoadingSkeletonProps {
  rows?: number | undefined;
}

export function TableLoadingSkeleton({ rows = 6 }: TableLoadingSkeletonProps) {
  return (
    <div className="p-4 space-y-3">
      <div className="h-10 bg-gray-50 border border-gray-100 rounded animate-pulse" />
      <div className="space-y-2">
        {[...Array(rows)].map((_, index) => (
          <div
            key={`row-${index}`}
            className="h-12 bg-gray-100 rounded animate-pulse"
            style={{ animationDelay: `${index * 0.06}s` }}
          />
        ))}
      </div>
    </div>
  );
}
