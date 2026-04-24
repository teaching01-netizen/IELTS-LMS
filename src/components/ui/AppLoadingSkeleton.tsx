import React from 'react';

interface AppLoadingSkeletonProps {
  label?: string | undefined;
}

export function AppLoadingSkeleton({ label }: AppLoadingSkeletonProps) {
  return (
    <div className="flex flex-col h-screen bg-gray-50">
      <div className="h-16 border-b border-gray-200 bg-white px-6 flex items-center">
        <div className="h-8 w-32 bg-gray-200 rounded animate-pulse" />
      </div>
      <div className="flex-1 p-6">
        <div className="max-w-7xl mx-auto space-y-6">
          {label ? (
            <p className="text-xs font-medium text-gray-500">{label}</p>
          ) : null}
          <div className="h-8 w-64 bg-gray-200 rounded animate-pulse" />
          <div className="flex gap-4 h-10">
            <div className="h-10 w-48 bg-gray-200 rounded animate-pulse" />
            <div className="h-10 w-32 bg-gray-200 rounded animate-pulse" />
          </div>
          <div className="bg-white border border-gray-200 rounded-sm overflow-hidden">
            <div className="h-12 border-b border-gray-100 bg-gray-50 flex items-center px-4">
              <div className="h-4 w-full bg-gray-200 rounded animate-pulse" />
            </div>
            <div className="space-y-2 p-4">
              {[...Array(5)].map((_, index) => (
                <div
                  key={`row-${index}`}
                  className="h-12 bg-gray-100 rounded animate-pulse"
                  style={{ animationDelay: `${index * 0.1}s` }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
