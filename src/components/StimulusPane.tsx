import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bold,
  Heading1,
  Heading2,
  Heading3,
  Image as ImageIcon,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Underline,
} from 'lucide-react';
import { Passage, ExamState, StimulusImageAsset } from '../types';
import { StimulusImageEditor } from './StimulusImageEditor';
import { getPassageMetrics } from '../utils/builderEnhancements';
import { sanitizeHtml } from '../utils/sanitizeHtml';

const metricTone = {
  green: 'text-emerald-700 bg-emerald-50 border-emerald-100',
  yellow: 'text-amber-700 bg-amber-50 border-amber-100',
  red: 'text-red-700 bg-red-50 border-red-100',
};

export function StimulusPane({
  passage,
  state,
  setState,
}: {
  passage: Passage;
  state: ExamState;
  setState: (next: ExamState | ((previous: ExamState) => ExamState)) => void | Promise<void>;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [isImageEditorOpen, setIsImageEditorOpen] = useState(false);
  const passageWordCount = state.config.standards.passageWordCount;
  const metrics = useMemo(
    () => getPassageMetrics(passage.content, passageWordCount),
    [passage.content, passageWordCount],
  );

  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== passage.content) {
      editorRef.current.innerHTML = passage.content;
    }
  }, [passage.content]);

  const updatePassage = (updater: (current: Passage) => Passage) => {
    void setState((previous) => {
      const currentPassage = previous.reading.passages.find((item) => item.id === passage.id);
      if (!currentPassage) {
        return previous;
      }

      const nextPassage = updater(currentPassage);
      const nextMetrics = getPassageMetrics(nextPassage.content, passageWordCount);
      const newPassages = previous.reading.passages.map((item) =>
        item.id === currentPassage.id
          ? {
              ...nextPassage,
              wordCount: nextMetrics.words,
            }
          : item,
      );

      return {
        ...previous,
        reading: { ...previous.reading, passages: newPassages },
      };
    });
  };

  const syncEditor = () => {
    updatePassage((current) => ({
      ...current,
      content: editorRef.current?.innerHTML ?? '',
    }));
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    const clipboard = event.clipboardData;
    if (!clipboard) {
      return;
    }

    event.preventDefault();
    editorRef.current?.focus();

    const html = clipboard.getData('text/html');
    if (html) {
      document.execCommand('insertHTML', false, sanitizeHtml(html));
      syncEditor();
      return;
    }

    const text = clipboard.getData('text/plain');
    if (text) {
      document.execCommand('insertText', false, text);
      syncEditor();
    }
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    const transfer = event.dataTransfer;
    if (!transfer) {
      return;
    }

    const html = transfer.getData('text/html');
    if (html) {
      event.preventDefault();
      editorRef.current?.focus();
      document.execCommand('insertHTML', false, sanitizeHtml(html));
      syncEditor();
    }
  };

  const applyCommand = (command: string, value?: string) => {
    editorRef.current?.focus();
    document.execCommand(command, false, value);
    syncEditor();
  };

  const addParagraphLabels = () => {
    const source = editorRef.current?.innerHTML ?? passage.content;
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div>${source}</div>`, 'text/html');
    const root = doc.body.firstElementChild;

    if (!root) {
      return;
    }

    let index = 0;
    Array.from(root.children).forEach((element) => {
      const text = element.textContent?.trim();
      if (!text) {
        return;
      }

      const label = String.fromCharCode(65 + index);
      if (!text.match(/^[A-Z]\s/)) {
        element.innerHTML = `<strong>${label}</strong> ${element.innerHTML}`;
      }
      index += 1;
    });

    updatePassage((current) => ({
      ...current,
      content: root.innerHTML,
    }));
  };

  const handleInsertLink = () => {
    const url = window.prompt('Paste link URL');
    if (url) {
      applyCommand('createLink', url);
    }
  };

  const handleSaveImage = (image: StimulusImageAsset) => {
    updatePassage((current) => ({
      ...current,
      images: [...(current.images ?? []), image],
    }));
    setIsImageEditorOpen(false);
  };

  return (
    <>
      <div className="flex-1 flex flex-col bg-white overflow-hidden h-full min-h-0">
        <div className="border-b border-gray-100 bg-white px-4 py-3 flex items-center gap-1 flex-wrap">
          <button className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors" onClick={() => applyCommand('bold')}><Bold size={16} /></button>
          <button className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors" onClick={() => applyCommand('italic')}><Italic size={16} /></button>
          <button className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors" onClick={() => applyCommand('underline')}><Underline size={16} /></button>
          <div className="w-px h-6 bg-gray-200 mx-1" />
          <button className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors" onClick={() => applyCommand('formatBlock', 'h1')}><Heading1 size={16} /></button>
          <button className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors" onClick={() => applyCommand('formatBlock', 'h2')}><Heading2 size={16} /></button>
          <button className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors" onClick={() => applyCommand('formatBlock', 'h3')}><Heading3 size={16} /></button>
          <div className="w-px h-6 bg-gray-200 mx-1" />
          <button className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors" onClick={() => applyCommand('insertUnorderedList')}><List size={16} /></button>
          <button className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors" onClick={() => applyCommand('insertOrderedList')}><ListOrdered size={16} /></button>
          <button className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors" onClick={handleInsertLink}><LinkIcon size={16} /></button>
          <button className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors" onClick={() => setIsImageEditorOpen(true)}><ImageIcon size={16} /></button>
          <button
            onClick={addParagraphLabels}
            className="ml-auto text-xs font-semibold text-blue-800 hover:bg-blue-50 px-3 py-2 rounded-lg border border-transparent hover:border-blue-200 transition-all"
          >
            ¶ Add Paragraph Labels
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-8 bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.08),_transparent_34%)]">
          <div
            ref={editorRef}
            contentEditable
            suppressContentEditableWarning
            onInput={syncEditor}
            onPaste={handlePaste}
            onDrop={handleDrop}
            className="min-h-[420px] rounded-[28px] border border-gray-100 bg-white px-8 py-8 outline-none text-gray-900 leading-relaxed font-serif text-base shadow-sm [&_h1]:text-3xl [&_h1]:font-black [&_h1]:mb-4 [&_h2]:text-2xl [&_h2]:font-bold [&_h2]:mb-3 [&_h3]:text-xl [&_h3]:font-bold [&_h3]:mb-2 [&_img]:max-w-full [&_img]:rounded-2xl [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:mb-4"
            data-placeholder="Enter reading passage text here..."
          />

          {(passage.images ?? []).length > 0 && (
            <div className="mt-6 grid gap-4 lg:grid-cols-2">
              {(passage.images ?? []).map((image) => (
                <div key={image.id} className="rounded-[28px] border border-gray-200 bg-white p-4 shadow-sm">
                  <div className="relative aspect-[4/3] overflow-hidden rounded-2xl border border-gray-100 bg-gray-50">
                    <img src={image.src} alt={image.alt} className="h-full w-full object-contain" />
                    {image.annotations.map((annotation) => (
                      <span
                        key={annotation.id}
                        className="absolute"
                        style={{
                          left: `${annotation.x}%`,
                          top: `${annotation.y}%`,
                          width: annotation.width ? `${annotation.width}%` : undefined,
                          height: annotation.height ? `${annotation.height}%` : undefined,
                          transform: 'translate(-50%, -50%)',
                        }}
                      >
                        {annotation.type === 'hotspot' && (
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-red-600 text-white shadow-md">
                            •
                          </span>
                        )}
                        {annotation.type === 'text' && (
                          <span className="rounded-lg bg-white/90 px-2 py-1 text-[11px] font-semibold text-gray-800 border border-gray-200">
                            {annotation.text}
                          </span>
                        )}
                        {annotation.type === 'box' && (
                          <span className="block h-full w-full rounded-lg border-2 border-blue-600 bg-blue-100/10" />
                        )}
                        {annotation.type === 'arrow' && (
                          <span className="rounded-full bg-blue-600 px-2 py-1 text-[10px] font-bold text-white">
                            Arrow
                          </span>
                        )}
                      </span>
                    ))}
                  </div>
                  <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
                    <span>{image.alt}</span>
                    <span>{image.annotations.length} annotations</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-gray-100 bg-gray-50 px-4 py-3 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 text-xs text-gray-500 font-semibold">
            <span>Words: {metrics.words}</span>
            <span>Chars: {metrics.characters}</span>
            <span>Attached Images: {(passage.images ?? []).length}</span>
          </div>
          <div
            title={metrics.tooltip}
            className={`rounded-full border px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.2em] ${metricTone[metrics.tone]}`}
          >
            {metrics.status === 'optimal'
              ? `${passageWordCount.optimalMin}-${passageWordCount.optimalMax} optimal`
              : metrics.status === 'warning'
                ? `${passageWordCount.warningMin}-${passageWordCount.warningMax} warning`
                : 'Outside range'}
          </div>
        </div>
      </div>

      <StimulusImageEditor
        isOpen={isImageEditorOpen}
        onClose={() => setIsImageEditorOpen(false)}
        onSave={handleSaveImage}
      />
    </>
  );
}
