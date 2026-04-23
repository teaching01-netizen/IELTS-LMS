import React from 'react';
import { GripVertical, Plus, Trash2, Edit, BookOpen } from 'lucide-react';
import { Passage } from '../../types';
import { Button } from '../ui/Button';
import { countWords } from '../../utils/builderEnhancements';

interface PassageListSidebarProps {
  passages: Passage[];
  activePassageId: string;
  onPassageSelect: (passageId: string) => void;
  onPassageAdd: () => void;
  onPassageDelete: (passageId: string) => void;
  onPassageReorder: (fromIndex: number, toIndex: number) => void;
  onPassageEdit: (passageId: string) => void;
  onAddToLibrary?: (passageId: string) => void;
}

export function PassageListSidebar({
  passages,
  activePassageId,
  onPassageSelect,
  onPassageAdd,
  onPassageDelete,
  onPassageReorder,
  onPassageEdit,
  onAddToLibrary
}: PassageListSidebarProps) {
  const [draggedIndex, setDraggedIndex] = React.useState<number | null>(null);

  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;
  };

  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === dropIndex) return;
    onPassageReorder(draggedIndex, dropIndex);
    setDraggedIndex(null);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
  };

  return (
    <div className="w-64 bg-white border-r border-gray-200 flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-gray-200">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-gray-900">Passages</h2>
          <span className="text-xs text-gray-500">{passages.length}</span>
        </div>
        <Button size="sm" fullWidth onClick={onPassageAdd}>
          <Plus size={16} className="mr-2" />
          Add Passage
        </Button>
      </div>

      {/* Passage List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {passages.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <p className="text-sm">No passages yet</p>
            <p className="text-xs mt-1">Add a passage to get started</p>
          </div>
        ) : (
          passages.map((passage, index) => (
            <PassageCard
              key={passage.id}
              passage={passage}
              index={index}
              isActive={passage.id === activePassageId}
              isDragging={draggedIndex === index}
              onSelect={() => onPassageSelect(passage.id)}
              onDelete={() => onPassageDelete(passage.id)}
              onEdit={() => onPassageEdit(passage.id)}
              onDragStart={() => handleDragStart(index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDrop={(e) => handleDrop(e, index)}
              onDragEnd={handleDragEnd}
              {...(onAddToLibrary && { onAddToLibrary: () => onAddToLibrary(passage.id) })}
            />
          ))
        )}
      </div>
    </div>
  );
}

interface PassageCardProps {
  passage: Passage;
  index: number;
  isActive: boolean;
  isDragging: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onAddToLibrary?: () => void;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onDragEnd: () => void;
}

function PassageCard({
  passage,
  index,
  isActive,
  isDragging,
  onSelect,
  onDelete,
  onEdit,
  onAddToLibrary,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd
}: PassageCardProps) {
  const wordCount = passage.wordCount ?? countWords(passage.content);

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      className={`
        relative border rounded-lg p-3 cursor-pointer transition-all
        ${isActive ? 'border-blue-500 bg-blue-50 shadow-sm' : 'border-gray-200 bg-white hover:border-gray-300'}
        ${isDragging ? 'opacity-50' : ''}
      `}
      onClick={onSelect}
    >
      {/* Drag Handle */}
      <div
        className="absolute left-2 top-1/2 transform -translate-y-1/2 text-gray-400 cursor-grab hover:text-gray-600"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <GripVertical size={16} />
      </div>

      {/* Content */}
      <div className="ml-6">
        <div className="flex items-start justify-between mb-1">
          <h3 className="font-medium text-sm text-gray-900 line-clamp-1">
            {index + 1}. {passage.title}
          </h3>
          <div className="flex items-center gap-1">
            {onAddToLibrary && (
              <button
                onClick={(e) => { e.stopPropagation(); onAddToLibrary(); }}
                className="p-1 hover:bg-blue-50 rounded text-gray-400 hover:text-blue-600"
                title="Add to library"
              >
                <BookOpen size={14} />
              </button>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); onEdit(); }}
              className="p-1 hover:bg-gray-100 rounded text-gray-400 hover:text-gray-600"
              title="Edit metadata"
            >
              <Edit size={14} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              className="p-1 hover:bg-red-50 rounded text-gray-400 hover:text-red-600"
              title="Delete passage"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs text-gray-500">
          <span>{wordCount} words</span>
          {passage.blocks.length > 0 && (
            <span>• {passage.blocks.length} question block{passage.blocks.length !== 1 ? 's' : ''}</span>
          )}
        </div>
      </div>
    </div>
  );
}
