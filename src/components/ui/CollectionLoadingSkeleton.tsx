import React from 'react';

type CollectionLoadingVariant = 'grid' | 'list';

interface CollectionLoadingSkeletonProps {
  variant?: CollectionLoadingVariant | undefined;
  items?: number | undefined;
}

export function CollectionLoadingSkeleton({
  variant = 'grid',
  items,
}: CollectionLoadingSkeletonProps) {
  const count = items ?? (variant === 'grid' ? 6 : 8);

  if (variant === 'list') {
    return (
      <div className="space-y-2">
        {[...Array(count)].map((_, index) => (
          <div
            key={`item-${index}`}
            className="bg-white border border-gray-200 rounded-lg p-4 flex items-center justify-between gap-4"
          >
            <div className="flex-1 min-w-0 space-y-2">
              <div className="h-4 w-2/5 bg-gray-200 rounded animate-pulse" style={{ animationDelay: `${index * 0.04}s` }} />
              <div className="h-3 w-4/5 bg-gray-100 rounded animate-pulse" style={{ animationDelay: `${index * 0.04 + 0.05}s` }} />
            </div>
            <div className="flex items-center gap-2">
              <div className="h-8 w-20 bg-gray-100 rounded animate-pulse" style={{ animationDelay: `${index * 0.04 + 0.08}s` }} />
              <div className="h-8 w-8 bg-gray-100 rounded-full animate-pulse" style={{ animationDelay: `${index * 0.04 + 0.12}s` }} />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {[...Array(count)].map((_, index) => (
        <div
          key={`item-${index}`}
          className="bg-white border border-gray-200 rounded-lg shadow-sm p-4 space-y-3"
        >
          <div className="flex items-start justify-between">
            <div className="h-5 w-16 bg-gray-100 rounded-full animate-pulse" style={{ animationDelay: `${index * 0.05}s` }} />
            <div className="h-4 w-14 bg-gray-100 rounded animate-pulse" style={{ animationDelay: `${index * 0.05 + 0.05}s` }} />
          </div>
          <div className="space-y-2">
            <div className="h-4 w-4/5 bg-gray-200 rounded animate-pulse" style={{ animationDelay: `${index * 0.05 + 0.08}s` }} />
            <div className="h-3 w-full bg-gray-100 rounded animate-pulse" style={{ animationDelay: `${index * 0.05 + 0.12}s` }} />
            <div className="h-3 w-5/6 bg-gray-100 rounded animate-pulse" style={{ animationDelay: `${index * 0.05 + 0.16}s` }} />
          </div>
          <div className="pt-2 border-t border-gray-100 flex items-center justify-between">
            <div className="h-3 w-24 bg-gray-100 rounded animate-pulse" style={{ animationDelay: `${index * 0.05 + 0.2}s` }} />
            <div className="h-8 w-20 bg-gray-100 rounded animate-pulse" style={{ animationDelay: `${index * 0.05 + 0.24}s` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
