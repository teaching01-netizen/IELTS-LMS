import React from 'react';
import { FileText } from 'lucide-react';

interface StudentModuleEmptyStateProps {
  label: string;
}

export function StudentModuleEmptyState({ label }: StudentModuleEmptyStateProps) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-white p-6">
      <div className="w-full max-w-sm rounded-xl border border-gray-200 bg-gray-50 px-6 py-10 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-gray-200 bg-white shadow-sm">
          <FileText size={22} className="text-gray-500" aria-hidden="true" />
        </div>
        <h2 className="text-lg font-bold tracking-tight text-gray-900">Nothing to display yet</h2>
        <p className="mt-2 text-sm leading-6 text-gray-500">
          The {label.toLowerCase()} section has no content. Please contact your proctor if you
          expected material here.
        </p>
      </div>
    </div>
  );
}
