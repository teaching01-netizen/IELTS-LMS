import { Trash2 } from 'lucide-react';
import type { PassageLibraryItem, QuestionBankItem } from '../../../../types';

type PassageCardProps = Readonly<{
  item: PassageLibraryItem;
  onDelete: () => void;
}>;

type QuestionCardProps = Readonly<{
  item: QuestionBankItem;
  onDelete: () => void;
}>;

function difficultyClassName(difficulty: PassageLibraryItem['metadata']['difficulty']): string {
  if (difficulty === 'easy') return 'bg-green-100 text-green-700';
  if (difficulty === 'medium') return 'bg-yellow-100 text-yellow-700';
  return 'bg-red-100 text-red-700';
}

export function PassageCard({ item, onDelete }: PassageCardProps) {
  const wordCount = item.passage.wordCount || item.passage.content.split(/\s+/).length;

  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-sm hover:shadow-md transition-shadow p-4 relative group">
      <button
        onClick={onDelete}
        className="absolute top-2 right-2 p-1 text-gray-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
        title="Delete passage"
      >
        <Trash2 size={16} />
      </button>
      <div className="flex items-start justify-between mb-3 pr-6">
        <span className={`text-xs font-semibold px-2 py-1 rounded ${difficultyClassName(item.metadata.difficulty)}`}>
          {item.metadata.difficulty}
        </span>
        <span className="text-xs text-gray-500">{item.metadata.source}</span>
      </div>
      <div className="mb-3">
        <h3 className="font-medium text-gray-900 mb-1 line-clamp-2">{item.passage.title}</h3>
        <p className="text-sm text-gray-600 line-clamp-3">{item.passage.content.substring(0, 150)}...</p>
      </div>
      <div className="flex flex-wrap gap-1 mb-3">
        {item.metadata.tags.slice(0, 3).map((tag) => (
          <span key={tag} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
            {tag}
          </span>
        ))}
        {item.metadata.tags.length > 3 && (
          <span className="text-xs text-gray-400">+{item.metadata.tags.length - 3}</span>
        )}
      </div>
      <div className="flex items-center justify-between text-xs text-gray-500 border-t pt-3">
        <div className="flex items-center gap-3">
          <span>{wordCount} words</span>
          <span>{item.metadata.usageCount} uses</span>
        </div>
        <span className="text-xs text-gray-400">{new Date(item.metadata.createdAt).toLocaleDateString()}</span>
      </div>
    </div>
  );
}

export function PassageListItem({ item, onDelete }: PassageCardProps) {
  const wordCount = item.passage.wordCount || item.passage.content.split(/\s+/).length;

  return (
    <div className="bg-white border border-gray-200 rounded shadow-sm hover:shadow-md transition-shadow p-4 flex items-center gap-4 group">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className={`text-xs font-semibold px-2 py-1 rounded ${difficultyClassName(item.metadata.difficulty)}`}>
            {item.metadata.difficulty}
          </span>
          <span className="text-sm font-medium text-gray-900 truncate">{item.passage.title}</span>
        </div>
        <p className="text-xs text-gray-600 truncate">{item.passage.content.substring(0, 100)}...</p>
        <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
          <span>{item.metadata.topic}</span>
          <span>{wordCount} words</span>
          <span>{item.metadata.usageCount} uses</span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-400">{new Date(item.metadata.createdAt).toLocaleDateString()}</span>
        <button
          onClick={onDelete}
          className="p-2 text-gray-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
          title="Delete passage"
        >
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  );
}

export function QuestionCard({ item, onDelete }: QuestionCardProps) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-sm hover:shadow-md transition-shadow p-4 relative group">
      <button
        onClick={onDelete}
        className="absolute top-2 right-2 p-1 text-gray-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
        title="Delete question"
      >
        <Trash2 size={16} />
      </button>
      <div className="flex items-start justify-between mb-3 pr-6">
        <span className={`text-xs font-semibold px-2 py-1 rounded ${difficultyClassName(item.metadata.difficulty)}`}>
          {item.metadata.difficulty}
        </span>
        <span className="text-xs font-medium text-blue-600 bg-blue-50 px-2 py-1 rounded">{item.block.type}</span>
      </div>
      <div className="mb-3">
        <h3 className="font-medium text-gray-900 mb-1 line-clamp-2">{item.block.type} Question</h3>
        <p className="text-sm text-gray-600 line-clamp-3">{JSON.stringify(item.block).substring(0, 150)}...</p>
      </div>
      <div className="flex flex-wrap gap-1 mb-3">
        {item.metadata.tags.slice(0, 3).map((tag) => (
          <span key={tag} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
            {tag}
          </span>
        ))}
        {item.metadata.tags.length > 3 && (
          <span className="text-xs text-gray-400">+{item.metadata.tags.length - 3}</span>
        )}
      </div>
      <div className="flex items-center justify-between text-xs text-gray-500 border-t pt-3">
        <div className="flex items-center gap-3">
          <span>{item.metadata.topic}</span>
          <span>{item.metadata.usageCount} uses</span>
        </div>
        <span className="text-xs text-gray-400">{new Date(item.metadata.createdAt).toLocaleDateString()}</span>
      </div>
    </div>
  );
}

export function QuestionListItem({ item, onDelete }: QuestionCardProps) {
  return (
    <div className="bg-white border border-gray-200 rounded shadow-sm hover:shadow-md transition-shadow p-4 flex items-center gap-4 group">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className={`text-xs font-semibold px-2 py-1 rounded ${difficultyClassName(item.metadata.difficulty)}`}>
            {item.metadata.difficulty}
          </span>
          <span className="text-xs font-medium text-blue-600 bg-blue-50 px-2 py-1 rounded">{item.block.type}</span>
          <span className="text-sm font-medium text-gray-900 truncate">{item.metadata.topic}</span>
        </div>
        <p className="text-xs text-gray-600 truncate">{JSON.stringify(item.block).substring(0, 100)}...</p>
        <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
          <span>{item.metadata.usageCount} uses</span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-400">{new Date(item.metadata.createdAt).toLocaleDateString()}</span>
        <button
          onClick={onDelete}
          className="p-2 text-gray-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
          title="Delete question"
        >
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  );
}
