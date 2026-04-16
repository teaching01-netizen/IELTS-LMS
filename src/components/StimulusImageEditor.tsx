import React, { useEffect, useRef, useState } from 'react';
import { Upload, Move, CircleDot, ArrowRight, Type, Square, ZoomIn } from 'lucide-react';
import { Dialog } from './ui/Dialog';
import type {
  StimulusAnnotation,
  StimulusAnnotationTool,
  StimulusImageAsset,
} from '../types';

interface StimulusImageEditorProps {
  initialImage?: StimulusImageAsset;
  isOpen: boolean;
  onClose: () => void;
  onSave: (image: StimulusImageAsset) => void;
}

const toolConfig: Array<{
  icon: typeof Move;
  id: StimulusAnnotationTool;
  label: string;
}> = [
  { id: 'pointer', label: 'Pointer', icon: Move },
  { id: 'hotspot', label: 'Hotspot', icon: CircleDot },
  { id: 'arrow', label: 'Arrow', icon: ArrowRight },
  { id: 'text', label: 'Text', icon: Type },
  { id: 'box', label: 'Box', icon: Square },
  { id: 'zoom', label: 'Zoom', icon: ZoomIn },
];

const createEmptyImage = (): StimulusImageAsset => ({
  id: `stimulus-image-${Date.now()}`,
  alt: 'Stimulus image',
  annotations: [],
  crop: {
    x: 0,
    y: 0,
    width: 100,
    height: 100,
  },
  height: 520,
  src: '',
  width: 840,
  zoom: 1,
});

export function StimulusImageEditor({
  initialImage,
  isOpen,
  onClose,
  onSave,
}: StimulusImageEditorProps) {
  const [draft, setDraft] = useState<StimulusImageAsset>(initialImage ?? createEmptyImage());
  const [tool, setTool] = useState<StimulusAnnotationTool>('pointer');
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      setDraft(initialImage ?? createEmptyImage());
      setTool('pointer');
      setSelectedAnnotationId(null);
    }
  }, [initialImage, isOpen]);

  useEffect(() => {
    if (!selectedAnnotationId) {
      return;
    }

    const handleMouseMove = (event: MouseEvent) => {
      if (!previewRef.current) {
        return;
      }

      const rect = previewRef.current.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width) * 100;
      const y = ((event.clientY - rect.top) / rect.height) * 100;

      setDraft((current) => ({
        ...current,
        annotations: current.annotations.map((annotation) =>
          annotation.id === selectedAnnotationId
            ? {
                ...annotation,
                x: Math.min(96, Math.max(4, x)),
                y: Math.min(96, Math.max(4, y)),
              }
            : annotation,
        ),
      }));
    };

    const handleMouseUp = () => setSelectedAnnotationId(null);

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [selectedAnnotationId]);

  const loadFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      setDraft((current) => ({
        ...current,
        src: String(reader.result ?? ''),
        alt: file.name,
      }));
    };
    reader.readAsDataURL(file);
  };

  const addAnnotation = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!previewRef.current || !draft.src || tool === 'pointer' || tool === 'zoom') {
      return;
    }

    const rect = previewRef.current.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    const y = ((event.clientY - rect.top) / rect.height) * 100;

    const baseAnnotation: StimulusAnnotation = {
      id: `annotation-${Date.now()}`,
      type: tool,
      x,
      y,
      width: tool === 'box' ? 18 : undefined,
      height: tool === 'box' ? 12 : undefined,
      text: tool === 'text' ? window.prompt('Label text', 'Label') ?? 'Label' : undefined,
      color: tool === 'hotspot' ? '#dc2626' : '#2563eb',
    };

    setDraft((current) => ({
      ...current,
      annotations: [...current.annotations, baseAnnotation],
    }));
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Stimulus Image Editor"
      size="full"
      className="rounded-[32px]"
    >
      <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
        <div className="space-y-4">
          <div className="rounded-3xl border border-gray-200 bg-gray-50 p-4">
            <p className="text-xs font-black text-gray-400 uppercase tracking-[0.22em] mb-3">
              Annotation Tools
            </p>
            <div className="grid grid-cols-2 gap-2">
              {toolConfig.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    onClick={() => setTool(item.id)}
                    className={`rounded-2xl border px-3 py-3 text-sm font-semibold transition-colors flex items-center gap-2 ${
                      tool === item.id
                        ? 'border-blue-200 bg-blue-50 text-blue-700'
                        : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    <Icon size={16} />
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-3xl border border-gray-200 bg-white p-4 space-y-3">
            <p className="text-xs font-black text-gray-400 uppercase tracking-[0.22em]">
              Crop / Resize
            </p>
            <label className="block text-xs text-gray-500">
              Zoom
              <input
                type="range"
                min={1}
                max={2}
                step={0.05}
                value={draft.zoom}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    zoom: Number(event.target.value),
                  }))
                }
                className="mt-2 w-full"
              />
            </label>
            <label className="block text-xs text-gray-500">
              Width
              <input
                type="range"
                min={40}
                max={100}
                value={draft.crop.width}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    crop: { ...current.crop, width: Number(event.target.value) },
                  }))
                }
                className="mt-2 w-full"
              />
            </label>
            <label className="block text-xs text-gray-500">
              Height
              <input
                type="range"
                min={40}
                max={100}
                value={draft.crop.height}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    crop: { ...current.crop, height: Number(event.target.value) },
                  }))
                }
                className="mt-2 w-full"
              />
            </label>
          </div>

          <div className="rounded-3xl border border-gray-200 bg-white p-4 space-y-3">
            <p className="text-xs font-black text-gray-400 uppercase tracking-[0.22em]">
              Metadata
            </p>
            <input
              value={draft.alt}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  alt: event.target.value,
                }))
              }
              placeholder="Alternative text"
              className="w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm outline-none focus:border-blue-500"
            />
            <button
              onClick={() => onSave(draft)}
              disabled={!draft.src}
              className="w-full rounded-2xl bg-gray-900 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40"
            >
              Save Annotations
            </button>
          </div>
        </div>

        <div className="rounded-[32px] border border-gray-200 bg-gray-50 p-4">
          {!draft.src ? (
            <label
              onDrop={(event) => {
                event.preventDefault();
                const file = event.dataTransfer.files[0];
                if (file) {
                  loadFile(file);
                }
              }}
              onDragOver={(event) => event.preventDefault()}
              className="h-[560px] rounded-[28px] border-2 border-dashed border-gray-300 bg-white flex flex-col items-center justify-center gap-3 text-center cursor-pointer"
            >
              <Upload size={28} className="text-gray-400" />
              <div>
                <p className="text-sm font-semibold text-gray-800">Drop image here</p>
                <p className="text-xs text-gray-500 mt-1">or click to upload a chart, map, or diagram</p>
              </div>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    loadFile(file);
                  }
                }}
              />
            </label>
          ) : (
            <div
              ref={previewRef}
              onClick={addAnnotation}
              className="relative h-[560px] rounded-[28px] overflow-hidden bg-white border border-gray-200"
            >
              <div className="absolute inset-0 overflow-hidden">
                <img
                  src={draft.src}
                  alt={draft.alt}
                  className="absolute inset-0 h-full w-full object-contain"
                  style={{
                    transform: `scale(${draft.zoom})`,
                  }}
                />
              </div>

              {draft.annotations.map((annotation) => (
                <button
                  key={annotation.id}
                  type="button"
                  onMouseDown={(event) => {
                    event.stopPropagation();
                    setSelectedAnnotationId(annotation.id);
                  }}
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
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-red-600 text-white shadow-lg">
                      •
                    </span>
                  )}
                  {annotation.type === 'arrow' && (
                    <span className="flex items-center gap-1 rounded-full bg-blue-600 px-3 py-1 text-xs font-semibold text-white shadow-lg">
                      <ArrowRight size={12} /> Arrow
                    </span>
                  )}
                  {annotation.type === 'text' && (
                    <span className="rounded-xl bg-white/90 px-3 py-1.5 text-xs font-semibold text-gray-900 shadow-lg border border-gray-200">
                      {annotation.text}
                    </span>
                  )}
                  {annotation.type === 'box' && (
                    <span className="block h-full w-full rounded-xl border-2 border-blue-600 bg-blue-100/15" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}
