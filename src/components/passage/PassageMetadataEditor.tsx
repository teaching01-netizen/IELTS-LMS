import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { PassageMetadata } from '../../types';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';

interface PassageMetadataEditorProps {
  metadata: PassageMetadata | null;
  onSave: (metadata: Omit<PassageMetadata, 'id' | 'createdAt' | 'usageCount'>) => void;
  onClose: () => void;
}

export function PassageMetadataEditor({ metadata, onSave, onClose }: PassageMetadataEditorProps) {
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium');
  const [source, setSource] = useState('');
  const [topic, setTopic] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [wordCount, setWordCount] = useState(0);
  const [estimatedTime, setEstimatedTime] = useState(0);
  const [author, setAuthor] = useState('');

  useEffect(() => {
    if (metadata) {
      setDifficulty(metadata.difficulty);
      setSource(metadata.source);
      setTopic(metadata.topic);
      setTags(metadata.tags);
      setWordCount(metadata.wordCount);
      setEstimatedTime(metadata.estimatedTimeMinutes);
      setAuthor(metadata.author);
    }
  }, [metadata]);

  const handleAddTag = () => {
    if (tagInput.trim() && !tags.includes(tagInput.trim())) {
      setTags([...tags, tagInput.trim()]);
      setTagInput('');
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter(tag => tag !== tagToRemove));
  };

  const handleSave = () => {
    onSave({
      difficulty,
      source,
      topic,
      tags,
      wordCount,
      estimatedTimeMinutes: estimatedTime,
      author
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="border-b px-6 py-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-gray-900">Edit Passage Metadata</h2>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X size={20} />
          </Button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* Difficulty */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Difficulty
            </label>
            <div className="flex gap-3">
              {(['easy', 'medium', 'hard'] as const).map(level => (
                <button
                  key={level}
                  type="button"
                  onClick={() => setDifficulty(level)}
                  className={`
                    px-4 py-2 rounded-md text-sm font-medium capitalize transition-colors
                    ${difficulty === level
                      ? level === 'easy' ? 'bg-green-100 text-green-700 border-2 border-green-500'
                      : level === 'medium' ? 'bg-yellow-100 text-yellow-700 border-2 border-yellow-500'
                      : 'bg-red-100 text-red-700 border-2 border-red-500'
                      : 'bg-gray-100 text-gray-600 border-2 border-transparent hover:border-gray-300'
                    }
                  `}
                >
                  {level}
                </button>
              ))}
            </div>
          </div>

          {/* Source */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Source
            </label>
            <Input
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="e.g., Cambridge IELTS 15, Test 1"
            />
          </div>

          {/* Topic */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Topic
            </label>
            <Input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="e.g., Environment, Technology, Education"
            />
          </div>

          {/* Tags */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Tags
            </label>
            <div className="flex gap-2 mb-2">
              <Input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleAddTag()}
                placeholder="Add a tag..."
              />
              <Button type="button" onClick={handleAddTag}>
                Add
              </Button>
            </div>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {tags.map(tag => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 bg-blue-100 text-blue-700 px-2 py-1 rounded text-sm"
                  >
                    {tag}
                    <button
                      type="button"
                      onClick={() => handleRemoveTag(tag)}
                      className="hover:text-blue-900"
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Word Count */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Word Count
            </label>
            <Input
              type="number"
              value={wordCount}
              onChange={(e) => setWordCount(parseInt(e.target.value) || 0)}
              min="0"
            />
          </div>

          {/* Estimated Time */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Estimated Time (minutes)
            </label>
            <Input
              type="number"
              value={estimatedTime}
              onChange={(e) => setEstimatedTime(parseInt(e.target.value) || 0)}
              min="0"
            />
          </div>

          {/* Author */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Author
            </label>
            <Input
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              placeholder="Author name"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="border-t px-6 py-4 flex items-center justify-between bg-gray-50">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave}>
            Save Metadata
          </Button>
        </div>
      </div>
    </div>
  );
}
