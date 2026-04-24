import React, { useState, useRef, useEffect } from 'react';
import { ExamState, ListeningPart, QuestionBlock } from '../../types';
import { QuestionBuilderPane } from '../QuestionBuilderPane';
import { Play, Square, Rewind, FastForward, Volume2, MapPin, Plus, Trash2, Link as LinkIcon, ChevronLeft, ChevronRight } from 'lucide-react';
import { normalizeAudioUrl } from '../../utils/audioUrl';
import { createId } from '../../utils/idUtils';
import { getBlockQuestionCount as getBlockQuestionCountFromUtils } from '../../utils/examUtils';

interface ListeningWorkspaceProps {
  state: ExamState;
  setState: (state: ExamState) => void;
}

export function ListeningWorkspace({ state, setState }: ListeningWorkspaceProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(80);
  const [editingPinId, setEditingPinId] = useState<string | null>(null);
  const [audioInputMode, setAudioInputMode] = useState<'googleDrive' | 'direct'>('googleDrive');
  const [isQuestionBuilderCollapsed, setIsQuestionBuilderCollapsed] = useState(() => {
    const saved = localStorage.getItem('listening-question-builder-collapsed');
    return saved === 'true';
  });
  const [isQuestionFocusMode, setIsQuestionFocusMode] = useState(() => {
    const saved = localStorage.getItem('listening-question-focus-mode');
    return saved === 'true';
  });

  // Update audio volume when volume state changes
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume / 100;
    }
  }, [volume]);

  useEffect(() => {
    localStorage.setItem('listening-question-builder-collapsed', isQuestionBuilderCollapsed.toString());
  }, [isQuestionBuilderCollapsed]);

  useEffect(() => {
    localStorage.setItem('listening-question-focus-mode', isQuestionFocusMode.toString());
  }, [isQuestionFocusMode]);

  const activePart = state.listening.parts.find(p => p.id === state.activeListeningPartId);
  if (!activePart) return null;

  const getBlockQuestionCount = (block: QuestionBlock): number => {
    switch (block.type) {
      case 'MULTI_MCQ':
        return block.requiredSelections || 1;
      case 'SINGLE_MCQ':
        return 1;
      case 'DIAGRAM_LABELING':
        return block.labels.length;
      case 'FLOW_CHART':
        return block.steps.length;
      case 'TABLE_COMPLETION':
        return block.cells.length;
      case 'CLASSIFICATION':
        return block.items.length;
      case 'MATCHING_FEATURES':
        return block.features.length;
      case 'TFNG':
      case 'CLOZE':
      case 'MATCHING':
      case 'MAP':
      case 'SHORT_ANSWER':
        return 'questions' in block ? block.questions.length : 0;
      case 'SENTENCE_COMPLETION':
      case 'NOTE_COMPLETION':
        return getBlockQuestionCountFromUtils(block);
      default:
        return 0;
    }
  };

  const partIndex = state.listening.parts.findIndex(p => p.id === activePart.id);
  let startNumber = 1;
  for (let i = 0; i < partIndex; i++) {
    const part = state.listening.parts[i];
    if (!part) {
      continue;
    }
    for (const block of part.blocks) {
      startNumber += getBlockQuestionCount(block);
    }
  }

  const updateBlocks: React.Dispatch<React.SetStateAction<QuestionBlock[]>> = (value) => {
    const currentBlocks =
      state.listening.parts.find((part) => part.id === activePart.id)?.blocks ?? [];
    const nextBlocks = typeof value === 'function' ? value(currentBlocks) : value;

    const newParts = state.listening.parts.map(p => 
      p.id === activePart.id ? { ...p, blocks: nextBlocks } : p
    );
    setState({ ...state, listening: { ...state.listening, parts: newParts } });
  };

  const updatePart = (updates: Partial<ListeningPart>) => {
    const newParts = state.listening.parts.map(p => 
      p.id === activePart.id ? { ...p, ...updates } : p
    );
    setState({ ...state, listening: { ...state.listening, parts: newParts } });
  };

  const handleAudioUrlChange = (value: string) => {
    updatePart({ audioUrl: normalizeAudioUrl(value) });
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const parsePinTime = (timeStr: string): number => {
    const match = timeStr.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return 0;
    const minutes = match[1];
    const seconds = match[2];
    if (!minutes || !seconds) {
      return 0;
    }
    return parseInt(minutes, 10) * 60 + parseInt(seconds, 10);
  };

  const addPin = () => {
    const newPin = {
      id: createId('pin'),
      time: formatTime(currentTime),
      label: `Pin ${activePart.pins.length + 1}`
    };
    updatePart({ pins: [...activePart.pins, newPin] });
    setEditingPinId(newPin.id);
  };

  const updatePin = (pinId: string, updates: { time?: string; label?: string }) => {
    const newPins = activePart.pins.map(p => 
      p.id === pinId ? { ...p, ...updates } : p
    );
    updatePart({ pins: newPins });
  };

  const removePin = (pinId: string) => {
    const newPins = activePart.pins.filter(p => p.id !== pinId);
    updatePart({ pins: newPins });
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!audioRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percent = x / rect.width;
    const newTime = percent * duration;
    audioRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const handlePlayPause = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration);
    }
  };

  return (
    <div className="flex-1 flex overflow-hidden relative">
      <audio
        ref={audioRef}
        src={activePart.audioUrl}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={() => setIsPlaying(false)}
      />

      {/* Question Focus Mode Toggle Button */}
      <button
        onClick={() => setIsQuestionFocusMode(!isQuestionFocusMode)}
        className={`absolute bottom-4 z-30 bg-white border border-gray-200 shadow-sm hover:bg-gray-50 hover:border-blue-300 transition-all duration-200 rounded-md px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 ${
          isQuestionFocusMode ? 'left-4 text-blue-800 border-blue-300' : 'right-4 text-gray-600'
        }`}
        aria-label={isQuestionFocusMode ? 'Exit question focus mode' : 'Enter question focus mode'}
      >
        {isQuestionFocusMode ? (
          <>
            <ChevronLeft size={14} />
            Exit Focus
          </>
        ) : (
          <>
            <ChevronRight size={14} />
            Focus on Questions
          </>
        )}
      </button>

      <div className={`flex-shrink-0 flex flex-col bg-white overflow-hidden border-r border-gray-200 transition-all duration-300 ease-in-out ${isQuestionFocusMode ? 'w-0 overflow-hidden' : 'flex-1'}`}>
        <div className="h-12 border-b border-gray-200 flex items-center px-6 bg-gray-50 flex-shrink-0">
          <h2 className="font-medium text-gray-800">Audio Workspace: {activePart.title}</h2>
        </div>
        <div className="p-8 flex flex-col items-center overflow-y-auto">
          <div className="w-full max-w-lg">
            <div className="mb-6">
              <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest block mb-2">
                Audio Source
              </span>
              <div className="mb-3 inline-flex rounded-md border border-gray-200 bg-gray-50 p-1 text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => setAudioInputMode('googleDrive')}
                  className={`rounded px-3 py-1.5 transition-colors ${
                    audioInputMode === 'googleDrive'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                  aria-pressed={audioInputMode === 'googleDrive'}
                >
                  Google Drive URL
                </button>
                <button
                  type="button"
                  onClick={() => setAudioInputMode('direct')}
                  className={`rounded px-3 py-1.5 transition-colors ${
                    audioInputMode === 'direct'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                  aria-pressed={audioInputMode === 'direct'}
                >
                  Direct URL
                </button>
              </div>
              <div className="relative">
                <LinkIcon size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="url"
                  aria-label="Audio URL"
                  value={activePart.audioUrl || ''}
                  onChange={(e) => handleAudioUrlChange(e.target.value)}
                  placeholder={
                    audioInputMode === 'googleDrive'
                      ? 'Paste a Google Drive share link'
                      : 'Paste a direct audio URL'
                  }
                  className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-sm text-sm outline-none focus:border-blue-700 focus:ring-1 focus:ring-blue-700 transition-colors text-gray-800"
                />
              </div>
              <p className="mt-2 text-xs text-gray-500">
                Google Drive share links are converted to a direct playback URL when possible. The file must be shared so anyone with the link can access it.
              </p>
            </div>

            {activePart.audioUrl && (
              <div className="bg-gray-900 rounded-xl p-6 shadow-lg text-white">
                <div className="flex justify-between text-xs text-gray-400 mb-2 font-mono">
                  <span>{formatTime(currentTime)}</span>
                  <span>{formatTime(duration)}</span>
                </div>

                <div
                  className="h-2 bg-gray-700 rounded-full overflow-hidden cursor-pointer mb-4"
                  onClick={handleSeek}
                >
                  <div
                    className="h-full bg-blue-500 rounded-full transition-all"
                    style={{ width: `${duration ? (currentTime / duration) * 100 : 0}%` }}
                  />
                </div>

                <div className="flex justify-center items-center gap-6">
                  <button
                    onClick={() => audioRef.current && (audioRef.current.currentTime -= 10)}
                    className="text-gray-400 hover:text-white transition-colors"
                    title="Rewind 10s"
                  >
                    <Rewind size={20} />
                  </button>
                  <button
                    onClick={handlePlayPause}
                    className="bg-blue-600 hover:bg-blue-500 text-white p-3 rounded-full transition-colors"
                  >
                    {isPlaying ? <Square size={24} /> : <Play size={24} className="ml-1" />}
                  </button>
                  <button
                    onClick={() => audioRef.current && (audioRef.current.currentTime += 10)}
                    className="text-gray-400 hover:text-white transition-colors"
                    title="Forward 10s"
                  >
                    <FastForward size={20} />
                  </button>
                </div>

                <div className="flex items-center justify-center gap-4 mt-4">
                  <Volume2 size={18} className="text-gray-400" />
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={volume}
                    onChange={(e) => setVolume(parseInt(e.target.value))}
                    className="w-24 h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                  />
                </div>
              </div>
            )}

            {!activePart.audioUrl && (
              <div className="bg-gray-50 border-2 border-dashed border-gray-200 rounded-xl p-12 text-center">
                <div className="text-gray-400 mb-2">
                  <Volume2 size={48} className="mx-auto" />
                </div>
                <p className="text-gray-600 font-medium">Enter an audio URL above to enable playback</p>
              </div>
            )}
          </div>

          <div className="w-full max-w-lg mt-8">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-semibold text-gray-700 flex items-center gap-2">
                <MapPin size={18} className="text-blue-500"/>
                Timestamp Pins
              </h3>
              <button
                onClick={addPin}
                className="text-sm text-blue-600 font-medium hover:underline flex items-center gap-1"
              >
                <Plus size={14} /> Add Pin at {formatTime(currentTime)}
              </button>
            </div>
            <div className="space-y-2">
              {activePart.pins.map((pin, i) => (
                <div
                  key={pin.id}
                  className={`flex items-center gap-4 p-3 border rounded-lg transition-colors ${editingPinId === pin.id ? 'border-blue-400 bg-blue-50' : 'border-gray-200 bg-white hover:border-blue-300 cursor-pointer'}`}
                  onClick={() => {
                    if (editingPinId === pin.id) {
                      setEditingPinId(null);
                    } else {
                      setEditingPinId(pin.id);
                      if (audioRef.current && pin.time) {
                        audioRef.current.currentTime = parsePinTime(pin.time);
                      }
                    }
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center text-xs font-bold">
                      {i + 1}
                    </span>
                    {editingPinId === pin.id ? (
                      <input
                        type="text"
                        value={pin.time}
                        onChange={(e) => updatePin(pin.id, { time: e.target.value })}
                        className="w-16 border border-gray-200 rounded px-2 py-1 text-sm font-mono text-gray-700 outline-none focus:border-blue-500"
                        placeholder="mm:ss"
                      />
                    ) : (
                      <span className="font-mono text-sm text-blue-600 bg-blue-100 px-2 py-0.5 rounded">
                        {pin.time}
                      </span>
                    )}
                  </div>
                  {editingPinId === pin.id ? (
                    <input
                      type="text"
                      value={pin.label}
                      onChange={(e) => updatePin(pin.id, { label: e.target.value })}
                      className="flex-1 border border-gray-200 rounded px-3 py-1 text-sm text-gray-700 outline-none focus:border-blue-500"
                      placeholder="Pin label..."
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <span className="flex-1 text-sm text-gray-700">{pin.label}</span>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removePin(pin.id);
                    }}
                    className="text-gray-400 hover:text-red-600 p-1 transition-colors"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
              {activePart.pins.length === 0 && (
                <div className="text-sm text-gray-500 italic p-4 text-center border border-dashed border-gray-200 rounded-lg">
                  No pins added yet. Click "Add Pin" to mark a timestamp.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {!isQuestionFocusMode && !isQuestionBuilderCollapsed && <div className="w-px bg-gray-200" />}

      {/* Question Builder Pane with Collapse Toggle */}
      <div className={`flex-shrink-0 transition-all duration-300 ease-in-out ${isQuestionBuilderCollapsed ? 'w-0 overflow-hidden' : isQuestionFocusMode ? 'flex-1' : 'w-[480px]'}`}>
        <QuestionBuilderPane
          blocks={activePart.blocks}
          title={activePart.title}
          updateBlocks={updateBlocks}
          startNumber={startNumber}
        />
      </div>

      {!isQuestionFocusMode && (
        <>
          {/* Question Builder Collapse Toggle Button */}
          {!isQuestionBuilderCollapsed && (
            <button
              onClick={() => setIsQuestionBuilderCollapsed(true)}
              className="absolute right-[480px] top-1/2 -translate-y-1/2 z-20 bg-white border border-gray-200 shadow-sm hover:bg-gray-50 hover:border-blue-300 transition-all duration-200 rounded-l-md p-1 group"
              style={{ right: '30rem' }}
              aria-label="Collapse question builder"
            >
              <ChevronRight size={16} className="text-gray-600 group-hover:text-blue-600 transition-colors" />
            </button>
          )}

          {isQuestionBuilderCollapsed && (
            <button
              onClick={() => setIsQuestionBuilderCollapsed(false)}
              className="absolute right-0 top-1/2 -translate-y-1/2 z-20 bg-white border border-gray-200 shadow-sm hover:bg-gray-50 hover:border-blue-300 transition-all duration-200 rounded-l-md p-1 group"
              aria-label="Expand question builder"
            >
              <ChevronLeft size={16} className="text-gray-600 group-hover:text-blue-600 transition-colors" />
            </button>
          )}
        </>
      )}
    </div>
  );
}
