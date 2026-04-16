import React, { useState, useMemo } from 'react';
import {
  FileText,
  Plus,
  Trash2,
  Filter,
  AlertTriangle,
  MessageSquare,
  Users,
  X,
  Clock,
  Check
} from 'lucide-react';
import { SessionNote, NoteCategory } from '../../types';
import { Badge } from '../ui/Badge';

interface SessionNotesPanelProps {
  notes: SessionNote[];
  scheduleId: string;
  currentProctor: string;
  onUpdateNotes: (notes: SessionNote[]) => void;
  onClose: () => void;
}

export function SessionNotesPanel({ notes, scheduleId, currentProctor, onUpdateNotes, onClose }: SessionNotesPanelProps) {
  const [filter, setFilter] = useState<NoteCategory | 'all'>('all');
  const [showNewNote, setShowNewNote] = useState(false);
  const [newNoteContent, setNewNoteContent] = useState('');
  const [newNoteCategory, setNewNoteCategory] = useState<NoteCategory>('general');

  const filteredNotes = useMemo(() => {
    return notes
      .filter(note => {
        if (filter !== 'all' && note.category !== filter) return false;
        return true;
      })
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [notes, filter]);

  const categoryIcons: Record<NoteCategory, React.ElementType> = {
    general: MessageSquare,
    incident: AlertTriangle,
    handover: Users
  };

  const categoryColors: Record<NoteCategory, string> = {
    general: 'bg-blue-100 text-blue-800 border-blue-200',
    incident: 'bg-red-100 text-red-800 border-red-200',
    handover: 'bg-orange-100 text-orange-800 border-orange-200'
  };

  const handleSaveNote = () => {
    if (!newNoteContent.trim()) return;

    const newNote: SessionNote = {
      id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
      scheduleId,
      author: currentProctor,
      timestamp: new Date().toISOString(),
      content: newNoteContent,
      category: newNoteCategory,
      isResolved: false
    };

    onUpdateNotes([...notes, newNote]);
    setNewNoteContent('');
    setShowNewNote(false);
    setNewNoteCategory('general');
  };

  const handleDeleteNote = (noteId: string) => {
    const updatedNotes = notes.filter(note => note.id !== noteId);
    onUpdateNotes(updatedNotes);
  };

  const handleToggleResolved = (noteId: string) => {
    const updatedNotes = notes.map(note =>
      note.id === noteId ? { ...note, isResolved: !note.isResolved } : note
    );
    onUpdateNotes(updatedNotes);
  };

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleString([], {
      hour: '2-digit',
      minute: '2-digit',
      day: '2-digit',
      month: 'short'
    });
  };

  const formatRelativeTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="p-6 border-b border-gray-200">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Session Notes</h2>
            <p className="text-sm text-gray-500 mt-1">
              {notes.length} notes for this session
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-500 hover:bg-gray-100 rounded-md transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Filter Controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setFilter('all')}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              filter === 'all' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            All
          </button>
          <button
            onClick={() => setFilter('general')}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              filter === 'general' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            General
          </button>
          <button
            onClick={() => setFilter('incident')}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              filter === 'incident' ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Incidents
          </button>
          <button
            onClick={() => setFilter('handover')}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              filter === 'handover' ? 'bg-orange-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Handovers
          </button>
          <div className="flex-1" />
          <button
            onClick={() => setShowNewNote(!showNewNote)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            <Plus size={16} />
            New Note
          </button>
        </div>
      </div>

      {/* New Note Form */}
      {showNewNote && (
        <div className="p-4 bg-gray-50 border-b border-gray-200">
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                Category
              </label>
              <div className="flex gap-2">
                <button
                  onClick={() => setNewNoteCategory('general')}
                  className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    newNoteCategory === 'general' ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <MessageSquare size={14} />
                  General
                </button>
                <button
                  onClick={() => setNewNoteCategory('incident')}
                  className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    newNoteCategory === 'incident' ? 'bg-red-600 text-white' : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <AlertTriangle size={14} />
                  Incident
                </button>
                <button
                  onClick={() => setNewNoteCategory('handover')}
                  className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    newNoteCategory === 'handover' ? 'bg-orange-600 text-white' : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <Users size={14} />
                  Handover
                </button>
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                Note Content
              </label>
              <textarea
                value={newNoteContent}
                onChange={(e) => setNewNoteContent(e.target.value)}
                placeholder="Enter your note here..."
                rows={4}
                className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setShowNewNote(false);
                  setNewNoteContent('');
                  setNewNoteCategory('general');
                }}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-md text-sm font-medium hover:bg-gray-300 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveNote}
                disabled={!newNoteContent.trim()}
                className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
              >
                Save Note
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Notes List */}
      <div className="flex-1 overflow-y-auto">
        {filteredNotes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400">
            <FileText size={48} className="mb-4 opacity-20" />
            <p className="text-lg font-medium">No notes found</p>
            <p className="text-sm">Create a note to document session events</p>
          </div>
        ) : (
          <div className="p-6 space-y-4">
            {filteredNotes.map(note => {
              const CategoryIcon = categoryIcons[note.category];
              return (
                <div
                  key={note.id}
                  className={`p-4 rounded-lg border ${
                    note.isResolved ? 'bg-gray-50 border-gray-200 opacity-60' : 'bg-white border-gray-200 shadow-sm'
                  }`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <Badge className={categoryColors[note.category]}>
                        <div className="flex items-center gap-1">
                          <CategoryIcon size={12} />
                          {note.category}
                        </div>
                      </Badge>
                      {note.category === 'handover' && (
                        <span className="px-2 py-1 bg-orange-100 text-orange-800 text-xs font-bold rounded-full">
                          HANDOVER
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleToggleResolved(note.id)}
                        className={`p-1.5 rounded-md transition-colors ${
                          note.isResolved
                            ? 'bg-green-100 text-green-700'
                            : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                        }`}
                        title={note.isResolved ? 'Mark as unresolved' : 'Mark as resolved'}
                      >
                        <Check size={16} />
                      </button>
                      <button
                        onClick={() => handleDeleteNote(note.id)}
                        className="p-1.5 text-gray-400 hover:bg-red-100 hover:text-red-700 rounded-md transition-colors"
                        title="Delete note"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                  
                  <p className="text-sm text-gray-900 mb-3 whitespace-pre-wrap">{note.content}</p>
                  
                  <div className="flex items-center justify-between text-xs text-gray-500">
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-1">
                        <Clock size={12} />
                        <span>{formatTime(note.timestamp)}</span>
                        <span className="text-gray-400">· {formatRelativeTime(note.timestamp)}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Users size={12} />
                        <span>{note.author}</span>
                      </div>
                    </div>
                    {note.isResolved && (
                      <span className="text-green-600 font-medium">Resolved</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
