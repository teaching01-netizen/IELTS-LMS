/**
 * Exam Filters Panel Component
 * Extracted from AdminExams to reduce component complexity
 */

import { Exam } from '../../types';
import { ExamFilterOptions, ExamSortOptions } from '../../utils/examStats';

interface ExamFiltersPanelProps {
  exams: Exam[];
  filters: ExamFilterOptions;
  sort: ExamSortOptions;
  onAddFilter: (type: keyof ExamFilterOptions, value: string) => void;
  onRemoveFilter: (type: keyof ExamFilterOptions, value: string) => void;
  onSortChange: (sort: ExamSortOptions) => void;
}

export function ExamFiltersPanel({
  exams,
  filters,
  sort,
  onAddFilter,
  onRemoveFilter,
  onSortChange
}: ExamFiltersPanelProps) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Status Filter */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Status</label>
          <div className="space-y-2">
            {['Draft', 'Published', 'Archived'].map(status => (
              <label key={status} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={filters.status.includes(status)}
                  onChange={(e) => {
                    if (e.target.checked) {
                      onAddFilter('status', status);
                    } else {
                      onRemoveFilter('status', status);
                    }
                  }}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700">{status}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Type Filter */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Type</label>
          <div className="space-y-2">
            {['Academic', 'General Training'].map(type => (
              <label key={type} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={filters.type.includes(type)}
                  onChange={(e) => {
                    if (e.target.checked) {
                      onAddFilter('type', type);
                    } else {
                      onRemoveFilter('type', type);
                    }
                  }}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700">{type}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Creator Filter */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Creator</label>
          <div className="space-y-2 max-h-32 overflow-y-auto">
            {Array.from(new Set(exams.map(e => e.author))).map(creator => (
              <label key={creator} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={filters.creator.includes(creator)}
                  onChange={(e) => {
                    if (e.target.checked) {
                      onAddFilter('creator', creator);
                    } else {
                      onRemoveFilter('creator', creator);
                    }
                  }}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700">{creator}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Sort */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Sort By</label>
          <select
            value={`${sort.field}-${sort.direction}`}
            onChange={(e) => {
              const [field, direction] = e.target.value.split('-') as [ExamSortOptions['field'], ExamSortOptions['direction']];
              onSortChange({ field, direction });
            }}
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
          >
            <option value="modified-desc">Last Modified (Newest)</option>
            <option value="modified-asc">Last Modified (Oldest)</option>
            <option value="published-desc">Published (Newest)</option>
            <option value="published-asc">Published (Oldest)</option>
            <option value="created-desc">Created (Newest)</option>
            <option value="created-asc">Created (Oldest)</option>
            <option value="title-asc">Title (A-Z)</option>
            <option value="title-desc">Title (Z-A)</option>
            <option value="questionCount-desc">Question Count (High-Low)</option>
            <option value="questionCount-asc">Question Count (Low-High)</option>
          </select>
        </div>
      </div>
    </div>
  );
}
