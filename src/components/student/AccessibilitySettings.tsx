import React, { useRef, useEffect } from 'react';
import { X, Contrast, Minus, Plus } from 'lucide-react';
import { Button } from '../ui/Button';
import {
  getStudentFontSizeLabel,
  getStudentTypographyScale,
  getStudentPassageReadabilityLabel,
  getStudentPassageReadabilityGeometry,
  type StudentFontSize,
  type StudentPassageReadabilityLevel,
} from './accessibilityScale';
import { STUDENT_PLAYBACK_RATES, type StudentPlaybackRate } from './accessibilityPreferences';

const STUDENT_ZOOM_MIN = 0.85;
const STUDENT_ZOOM_MAX = 1.5;
const STUDENT_ZOOM_STEP = 0.1;

interface AccessibilitySettingsProps {
  isOpen: boolean;
  onClose: () => void;
  fontSize: StudentFontSize;
  highContrast: boolean;
  zoom: number;
  passageReadabilityLevel: StudentPassageReadabilityLevel;
  playbackRate: StudentPlaybackRate;
  onFontSizeChange: (size: StudentFontSize) => void;
  onHighContrastToggle: () => void;
  onZoomChange: (zoom: number) => void;
  onPassageReadabilityChange: (level: StudentPassageReadabilityLevel) => void;
  onPlaybackRateChange: (rate: StudentPlaybackRate) => void;
  onResetDefaults: () => void;
}

export function AccessibilitySettings({
  isOpen,
  onClose,
  fontSize,
  highContrast,
  zoom,
  passageReadabilityLevel,
  playbackRate,
  onFontSizeChange,
  onHighContrastToggle,
  onZoomChange,
  onPassageReadabilityChange,
  onPlaybackRateChange,
  onResetDefaults,
}: AccessibilitySettingsProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen && !dialog.open) {
      if (typeof dialog.showModal === 'function') {
        dialog.showModal();
      } else {
        dialog.setAttribute('open', '');
      }
    } else if (!isOpen && dialog.open) {
      if (typeof dialog.close === 'function') {
        dialog.close();
      } else {
        dialog.removeAttribute('open');
      }
    }

    return () => {
      if (dialog.open) {
        if (typeof dialog.close === 'function') {
          dialog.close();
        } else {
          dialog.removeAttribute('open');
        }
      }
    };
  }, [isOpen]);

  const fontSizes = [
    {
      value: 'small' as const,
      label: getStudentFontSizeLabel('small'),
      preview: getStudentTypographyScale('small').previewFontSize,
      description: 'Compact for a fuller page view',
    },
    {
      value: 'normal' as const,
      label: getStudentFontSizeLabel('normal'),
      preview: getStudentTypographyScale('normal').previewFontSize,
      description: 'Balanced for most screens',
    },
    {
      value: 'large' as const,
      label: getStudentFontSizeLabel('large'),
      preview: getStudentTypographyScale('large').previewFontSize,
      description: 'Easier to read on iPad and desktop',
    },
  ];

  const passageLayouts: Array<{
    value: StudentPassageReadabilityLevel;
    label: string;
    description: string;
  }> = [
    {
      value: 0,
      label: getStudentPassageReadabilityLabel(0),
      description: 'Tighter lines for a fuller page',
    },
    {
      value: 1,
      label: getStudentPassageReadabilityLabel(1),
      description: 'Balanced for most screens',
    },
    {
      value: 2,
      label: getStudentPassageReadabilityLabel(2),
      description: 'More spacing, narrower column',
    },
  ];

  const zoomPercent = Math.round(Math.min(STUDENT_ZOOM_MAX, Math.max(STUDENT_ZOOM_MIN, zoom)) * 100);
  const zoomAtMin = zoom <= STUDENT_ZOOM_MIN + 1e-9;
  const zoomAtMax = zoom >= STUDENT_ZOOM_MAX - 1e-9;

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      className="rounded-lg shadow-xl w-full max-w-md backdrop:bg-black/50"
      aria-labelledby="accessibility-title"
    >
      <div className="flex items-center justify-between p-4 sm:p-6 border-b border-gray-200">
        <div className="flex items-center gap-2 md:gap-3">
          <div className="p-1.5 md:p-2 bg-gray-100 rounded-lg">
            <Contrast size={20} className="text-gray-700" />
          </div>
          <h2 id="accessibility-title" className="text-lg md:text-xl font-bold text-gray-900">Accessibility</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 md:p-2 text-gray-500 hover:bg-gray-100 rounded-md transition-colors"
          aria-label="Close accessibility settings"
        >
          <X size={18} />
        </button>
      </div>

      <div className="p-4 sm:p-6 space-y-4 md:space-y-6 max-h-[70vh] overflow-y-auto">
        <div>
          <h3 className="font-semibold text-gray-900 mb-3">Text Size</h3>
          <div className="grid gap-3 sm:grid-cols-3">
            {fontSizes.map((size) => (
              <button
                key={size.value}
                type="button"
                onClick={() => onFontSizeChange(size.value)}
                aria-pressed={fontSize === size.value}
                data-testid={`font-size-option-${size.value}`}
                className={`rounded-lg border p-4 text-left transition-[scale,background-color,border-color] duration-150 ease-out active:scale-[0.96] ${
                  fontSize === size.value
                    ? 'bg-blue-50 border-blue-600 text-gray-900'
                    : 'bg-white border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50'
                }`}
                style={{ fontSize: size.preview }}
              >
                <span className="block text-xs font-semibold uppercase tracking-wide text-gray-500">
                  {size.label}
                </span>
                <span
                  data-testid={`font-size-preview-${size.value}`}
                  className="mt-2 block font-serif text-gray-900"
                  style={{ fontSize: size.preview, lineHeight: 1.35 }}
                >
                  The quick brown fox reads the passage comfortably.
                </span>
                <span className="mt-2 block text-[0.75rem] font-medium text-gray-600">
                  {size.description}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <h3 className="font-semibold text-gray-900 mb-3">Passage Layout</h3>
          <div className="grid gap-3 sm:grid-cols-3">
            {passageLayouts.map((layout) => {
              const geometry = getStudentPassageReadabilityGeometry(layout.value);
              const isActive = passageReadabilityLevel === layout.value;
              return (
                <button
                  key={layout.value}
                  type="button"
                  onClick={() => onPassageReadabilityChange(layout.value)}
                  aria-pressed={isActive}
                  data-testid={`passage-layout-option-${layout.value}`}
                  className={`rounded-lg border p-4 text-left transition-[scale,background-color,border-color] duration-150 ease-out active:scale-[0.96] ${
                    isActive
                      ? 'bg-blue-50 border-blue-600 text-gray-900'
                      : 'bg-white border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  <span className="block text-xs font-semibold uppercase tracking-wide text-gray-500">
                    {layout.label}
                  </span>
                  <span
                    data-testid={`passage-layout-preview-${layout.value}`}
                    className="mt-2 block font-serif text-gray-900 text-sm"
                    style={{
                      lineHeight: (1.5 * geometry.lineHeightFactor).toFixed(2),
                      maxWidth: geometry.measure,
                    }}
                  >
                    Comfortable reading lines keep your place in long passages.
                  </span>
                  <span className="mt-2 block text-[0.75rem] font-medium text-gray-600">
                    {layout.description}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <h3 className="font-semibold text-gray-900 mb-3">Display</h3>
          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200">
            <div>
              <div className="font-medium text-gray-900">High Contrast Mode</div>
              <div className="text-sm text-gray-600">Increase color contrast for better readability</div>
            </div>
            <button
              type="button"
              onClick={onHighContrastToggle}
              className={`relative w-12 h-6 rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
                highContrast ? 'bg-blue-600' : 'bg-gray-300'
              }`}
              role="switch"
              aria-checked={highContrast}
              aria-label="Toggle high contrast mode"
            >
              <div
                className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${
                  highContrast ? 'translate-x-7' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          <div className="mt-3 flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200">
            <div>
              <div className="font-medium text-gray-900">Zoom</div>
              <div className="text-sm text-gray-600">
                Magnify the whole exam surface
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  onZoomChange(
                    Math.round(Math.max(STUDENT_ZOOM_MIN, zoom - STUDENT_ZOOM_STEP) * 100) / 100,
                  )
                }
                disabled={zoomAtMin}
                data-testid="zoom-decrease"
                aria-label="Zoom out"
                className="w-8 h-8 rounded-md border border-gray-200 bg-white flex items-center justify-center text-gray-700 transition-[scale,background-color,opacity] duration-150 ease-out hover:bg-gray-100 active:scale-[0.96] disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100"
              >
                <Minus size={14} />
              </button>
              <span
                data-testid="zoom-value"
                className="min-w-[3rem] text-center text-sm font-bold tabular-nums text-gray-900"
              >
                {zoomPercent}%
              </span>
              <button
                type="button"
                onClick={() =>
                  onZoomChange(
                    Math.round(Math.min(STUDENT_ZOOM_MAX, zoom + STUDENT_ZOOM_STEP) * 100) / 100,
                  )
                }
                disabled={zoomAtMax}
                data-testid="zoom-increase"
                aria-label="Zoom in"
                className="w-8 h-8 rounded-md border border-gray-200 bg-white flex items-center justify-center text-gray-700 transition-[scale,background-color,opacity] duration-150 ease-out hover:bg-gray-100 active:scale-[0.96] disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100"
              >
                <Plus size={14} />
              </button>
              {zoom !== 1 ? (
                <button
                  type="button"
                  onClick={() => onZoomChange(1)}
                  data-testid="zoom-reset"
                  className="ml-1 text-sm font-medium text-blue-700 underline-offset-2 hover:underline"
                >
                  Reset
                </button>
              ) : null}
            </div>
          </div>
        </div>

        <div>
          <h3 className="font-semibold text-gray-900 mb-3">Listening</h3>
          <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="font-medium text-gray-900">Playback Speed</div>
                <div className="text-sm text-gray-600">Applies to listening audio</div>
              </div>
              <div className="flex items-center gap-1" role="group" aria-label="Playback speed">
                {STUDENT_PLAYBACK_RATES.map((rate) => {
                  const isActive = playbackRate === rate;
                  return (
                    <button
                      key={rate}
                      type="button"
                      onClick={() => onPlaybackRateChange(rate)}
                      aria-pressed={isActive}
                      data-testid={`playback-rate-${rate}`}
                      className={`px-2.5 py-1.5 rounded-md border text-sm font-semibold transition-[scale,background-color,border-color] duration-150 ease-out active:scale-[0.96] ${
                        isActive
                          ? 'bg-blue-50 text-blue-900 border-blue-600'
                          : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-100'
                      }`}
                    >
                      {rate}×
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between pt-1">
          <button
            type="button"
            onClick={onResetDefaults}
            data-testid="reset-preferences"
            className="text-sm font-medium text-gray-500 underline-offset-2 hover:text-gray-900 hover:underline"
          >
            Reset to defaults
          </button>
          <p className="text-sm text-gray-600">
            Saved automatically — applies to your next exam.
          </p>
        </div>
      </div>

      <div className="p-4 sm:p-6 border-t border-gray-200 bg-gray-50 rounded-b-lg">
        <Button
          type="button"
          onClick={onClose}
          className="w-full text-sm md:text-base"
        >
          Done
        </Button>
      </div>
    </dialog>
  );
}