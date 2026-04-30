import React, { useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { normalizeAnswerForMatching } from '../../utils/acceptedAnswers';

interface AcceptedAnswersEditorProps {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}

export function AcceptedAnswersEditor({
  value,
  onChange,
  placeholder = 'Add an accepted answer...',
}: AcceptedAnswersEditorProps) {
  const [draft, setDraft] = useState('');

  const normalizedValues = useMemo(
    () => new Set(value.map((answer) => normalizeAnswerForMatching(answer))),
    [value],
  );

  const addAnswer = () => {
    const trimmed = draft.trim();
    if (!trimmed) {
      return;
    }

    const key = normalizeAnswerForMatching(trimmed);
    if (!key || normalizedValues.has(key)) {
      setDraft('');
      return;
    }

    onChange([...value, trimmed]);
    setDraft('');
  };

  const removeAnswer = (index: number) => {
    onChange(value.filter((_, currentIndex) => currentIndex !== index));
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {value.map((answer, index) => (
          <span
            key={`${answer}-${index}`}
            className="inline-flex items-center gap-1 rounded border border-gray-300 bg-gray-50 px-2 py-1 text-xs text-gray-700"
          >
            {answer}
            {index === 0 ? <span className="text-[10px] font-semibold text-blue-700">Primary</span> : null}
            <button
              type="button"
              onClick={() => removeAnswer(index)}
              className="rounded p-0.5 text-gray-500 hover:bg-gray-200 hover:text-gray-700"
              aria-label={`Remove accepted answer ${answer}`}
              disabled={value.length <= 1}
              title={value.length <= 1 ? 'At least one answer is required' : 'Remove answer'}
            >
              <X size={12} />
            </button>
          </span>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <input
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              addAnswer();
            }
          }}
          className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder={placeholder}
        />
        <button
          type="button"
          onClick={addAnswer}
          className="inline-flex items-center gap-1 rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          <Plus size={12} />
          Add answer
        </button>
      </div>
    </div>
  );
}
