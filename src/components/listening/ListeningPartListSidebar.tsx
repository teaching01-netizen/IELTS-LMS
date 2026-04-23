import React from 'react';
import { GripVertical, Plus, Trash2, Edit } from 'lucide-react';
import { ListeningPart } from '../../types';
import { Button } from '../ui/Button';

interface ListeningPartListSidebarProps {
  parts: ListeningPart[];
  activePartId: string;
  onPartSelect: (partId: string) => void;
  onPartAdd: () => void;
  onPartDelete: (partId: string) => void;
  onPartReorder: (fromIndex: number, toIndex: number) => void;
  onPartRename: (partId: string, nextTitle: string) => void;
}

export function ListeningPartListSidebar({
  parts,
  activePartId,
  onPartSelect,
  onPartAdd,
  onPartDelete,
  onPartReorder,
  onPartRename,
}: ListeningPartListSidebarProps) {
  const [draggedIndex, setDraggedIndex] = React.useState<number | null>(null);
  const [editingPartId, setEditingPartId] = React.useState<string | null>(null);
  const [draftTitle, setDraftTitle] = React.useState('');

  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (event: React.DragEvent, index: number) => {
    event.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;
  };

  const handleDrop = (event: React.DragEvent, dropIndex: number) => {
    event.preventDefault();
    if (draggedIndex === null || draggedIndex === dropIndex) return;
    onPartReorder(draggedIndex, dropIndex);
    setDraggedIndex(null);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
  };

  const beginEdit = (part: ListeningPart) => {
    setEditingPartId(part.id);
    setDraftTitle(part.title);
  };

  const commitEdit = (part: ListeningPart) => {
    const nextTitle = draftTitle.trim();
    if (nextTitle && nextTitle !== part.title) {
      onPartRename(part.id, nextTitle);
    }
    setEditingPartId(null);
  };

  const cancelEdit = () => {
    setEditingPartId(null);
  };

  return (
    <div className="w-64 bg-white border-r border-gray-200 flex flex-col h-full">
      <div className="p-4 border-b border-gray-200">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-gray-900">Parts</h2>
          <span className="text-xs text-gray-500">{parts.length}</span>
        </div>
        <Button size="sm" fullWidth onClick={onPartAdd}>
          <Plus size={16} className="mr-2" />
          Add Part
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {parts.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <p className="text-sm">No parts yet</p>
            <p className="text-xs mt-1">Add a part to get started</p>
          </div>
        ) : (
          parts.map((part, index) => (
            <ListeningPartCard
              key={part.id}
              part={part}
              index={index}
              isActive={part.id === activePartId}
              isDragging={draggedIndex === index}
              isEditing={editingPartId === part.id}
              draftTitle={draftTitle}
              setDraftTitle={setDraftTitle}
              onSelect={() => onPartSelect(part.id)}
              onDelete={() => onPartDelete(part.id)}
              onEdit={() => beginEdit(part)}
              onCommit={() => commitEdit(part)}
              onCancel={cancelEdit}
              onDragStart={() => handleDragStart(index)}
              onDragOver={(event) => handleDragOver(event, index)}
              onDrop={(event) => handleDrop(event, index)}
              onDragEnd={handleDragEnd}
            />
          ))
        )}
      </div>
    </div>
  );
}

interface ListeningPartCardProps {
  part: ListeningPart;
  index: number;
  isActive: boolean;
  isDragging: boolean;
  isEditing: boolean;
  draftTitle: string;
  setDraftTitle: (next: string) => void;
  onSelect: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onCommit: () => void;
  onCancel: () => void;
  onDragStart: () => void;
  onDragOver: (event: React.DragEvent) => void;
  onDrop: (event: React.DragEvent) => void;
  onDragEnd: () => void;
}

function ListeningPartCard({
  part,
  index,
  isActive,
  isDragging,
  isEditing,
  draftTitle,
  setDraftTitle,
  onSelect,
  onDelete,
  onEdit,
  onCommit,
  onCancel,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: ListeningPartCardProps) {
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
      <div
        className="absolute left-2 top-1/2 transform -translate-y-1/2 text-gray-400 cursor-grab hover:text-gray-600"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <GripVertical size={16} />
      </div>

      <div className="ml-6">
        <div className="flex items-start justify-between mb-1">
          <div className="min-w-0 flex-1">
            {isEditing ? (
              <input
                autoFocus
                type="text"
                value={draftTitle}
                onChange={(event) => setDraftTitle(event.target.value)}
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    onCommit();
                  } else if (event.key === 'Escape') {
                    event.preventDefault();
                    onCancel();
                  }
                }}
                onBlur={onCommit}
                className="w-full border border-gray-200 rounded px-2 py-1 text-sm text-gray-900 outline-none focus:border-blue-500 bg-white"
                aria-label={`Rename part ${index + 1}`}
              />
            ) : (
              <h3 className="font-medium text-sm text-gray-900 line-clamp-1">
                {index + 1}. {part.title}
              </h3>
            )}
          </div>

          {!isEditing && (
            <div className="flex items-center gap-1">
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  onEdit();
                }}
                className="p-1 hover:bg-gray-100 rounded text-gray-400 hover:text-gray-600"
                title="Rename part"
                aria-label="Rename part"
              >
                <Edit size={14} />
              </button>
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  onDelete();
                }}
                className="p-1 hover:bg-red-50 rounded text-gray-400 hover:text-red-600"
                title="Delete part"
                aria-label="Delete part"
              >
                <Trash2 size={14} />
              </button>
            </div>
          )}
        </div>

        {!isEditing && (
          <div className="flex items-center gap-3 text-xs text-gray-500">
            {part.blocks.length > 0 && (
              <span>
                {part.blocks.length} question block{part.blocks.length !== 1 ? 's' : ''}
              </span>
            )}
            {part.blocks.length === 0 && <span>No question blocks</span>}
          </div>
        )}
      </div>
    </div>
  );
}

