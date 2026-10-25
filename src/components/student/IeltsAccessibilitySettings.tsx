import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Minus, Plus } from 'lucide-react';
import {
  getStudentFontSizeLabel,
  getStudentPassageReadabilityGeometry,
  getStudentPassageReadabilityLabel,
  getStudentTypographyScale,
  type StudentFontSize,
  type StudentPassageReadabilityLevel,
} from './accessibilityScale';
import {
  STUDENT_ZOOM_MAX,
  STUDENT_ZOOM_MIN,
  STUDENT_ZOOM_STEP,
  type AccessibilitySettingsProps,
} from './AccessibilitySettings';

const FONT_SIZES: StudentFontSize[] = ['small', 'normal', 'large'];
const PASSAGE_LEVELS: StudentPassageReadabilityLevel[] = [0, 1, 2];

const sectionLabelClassName = 'px-1 pb-2 text-xs font-semibold uppercase tracking-wide text-gray-600';
const cardClassName = 'rounded-xl bg-white px-4 py-3 shadow-[0_0_0_0.5px_rgb(0_0_0/0.06)]';
const segmentTrackClassName = 'grid gap-1 rounded-xl bg-gray-200/70 p-1';
const segmentClassName =
  'min-h-11 min-w-0 rounded-lg px-2 text-sm font-semibold text-gray-700 transition-colors duration-100 ease-out hover:text-gray-950 aria-pressed:bg-white aria-pressed:text-gray-950 aria-pressed:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700';
const stepperButtonClassName =
  'flex size-11 items-center justify-center rounded-lg bg-gray-100 text-gray-800 transition-colors duration-100 ease-out hover:bg-gray-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-gray-100';

/**
 * IELTS accessibility sheet. A grouped iPad form sheet: the header holds the
 * only dismiss action, the body scrolls, and the footer never scrolls away.
 * Rendered outside the zoomed exam shell so the zoom setting it controls
 * cannot also magnify or clip the sheet itself.
 */
export function IeltsAccessibilitySettings({
  isOpen,
  onClose,
  fontSize,
  highContrast,
  systemHighContrast = false,
  zoom,
  passageReadabilityLevel,
  onFontSizeChange,
  onHighContrastToggle,
  onZoomChange,
  onPassageReadabilityChange,
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

  const zoomPercent = Math.round(Math.min(STUDENT_ZOOM_MAX, Math.max(STUDENT_ZOOM_MIN, zoom)) * 100);
  const zoomAtMin = zoom <= STUDENT_ZOOM_MIN + 1e-9;
  const zoomAtMax = zoom >= STUDENT_ZOOM_MAX - 1e-9;
  const highContrastOn = highContrast || systemHighContrast;
  const selectedGeometry = getStudentPassageReadabilityGeometry(passageReadabilityLevel);

  const dialog = (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      className="m-auto flex max-h-[min(calc(100dvh_-_2rem),46rem)] w-[min(34rem,calc(100vw_-_2rem))] flex-col overflow-hidden rounded-2xl border-0 bg-gray-100 p-0 text-gray-900 shadow-2xl backdrop:bg-gray-900/40 open:flex"
      aria-labelledby="accessibility-title"
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-3">
        <h2 id="accessibility-title" className="text-lg font-semibold text-gray-900">
          Accessibility
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="min-h-11 rounded-lg px-3 text-base font-semibold text-blue-700 hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
        >
          Done
        </button>
      </header>

      <div className="grow min-h-0 space-y-6 overflow-y-auto overscroll-contain p-4">
        <section aria-labelledby="accessibility-text-size">
          <h3 id="accessibility-text-size" className={sectionLabelClassName}>
            Text Size
          </h3>
          <div
            role="group"
            aria-labelledby="accessibility-text-size"
            className={`${segmentTrackClassName} grid-cols-3`}
          >
            {FONT_SIZES.map((size) => (
              <button
                key={size}
                type="button"
                onClick={() => onFontSizeChange(size)}
                aria-pressed={fontSize === size}
                data-testid={`font-size-option-${size}`}
                className={segmentClassName}
              >
                {getStudentFontSizeLabel(size)}
              </button>
            ))}
          </div>
          <div className={`${cardClassName} mt-2`}>
            <p
              data-testid={`font-size-preview-${fontSize}`}
              className="font-sans text-gray-900"
              style={{
                fontSize: getStudentTypographyScale(fontSize).previewFontSize,
                lineHeight: 1.35,
              }}
            >
              The quick brown fox reads the passage comfortably.
            </p>
          </div>
        </section>

        <section aria-labelledby="accessibility-passage-layout">
          <h3 id="accessibility-passage-layout" className={sectionLabelClassName}>
            Passage Layout
          </h3>
          <div
            role="group"
            aria-labelledby="accessibility-passage-layout"
            className={`${segmentTrackClassName} grid-cols-3`}
          >
            {PASSAGE_LEVELS.map((level) => (
              <button
                key={level}
                type="button"
                onClick={() => onPassageReadabilityChange(level)}
                aria-pressed={passageReadabilityLevel === level}
                data-testid={`passage-layout-option-${level}`}
                className={segmentClassName}
              >
                {getStudentPassageReadabilityLabel(level)}
              </button>
            ))}
          </div>
          <div className={`${cardClassName} mt-2`}>
            <p
              data-testid={`passage-layout-preview-${passageReadabilityLevel}`}
              className="font-sans text-gray-900"
              style={{
                fontSize: '0.9375rem',
                lineHeight: (1.5 * selectedGeometry.lineHeightFactor).toFixed(2),
                maxWidth: selectedGeometry.measure,
              }}
            >
              Comfortable reading lines keep your place in long passages.
            </p>
          </div>
        </section>

        <section aria-labelledby="accessibility-display">
          <h3 id="accessibility-display" className={sectionLabelClassName}>
            Display
          </h3>
          <div className="overflow-hidden rounded-xl bg-white">
            <button
              type="button"
              role="switch"
              aria-checked={highContrastOn}
              aria-label="High contrast mode"
              aria-describedby="student-high-contrast-description"
              disabled={systemHighContrast}
              onClick={onHighContrastToggle}
              className="flex min-h-14 w-full items-center justify-between gap-4 px-4 py-3 text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-blue-700 disabled:cursor-default"
            >
              <span>
                <span className="block font-medium text-gray-900">High Contrast Mode</span>
                <span id="student-high-contrast-description" className="block text-sm text-gray-600">
                  {systemHighContrast
                    ? 'On while your device’s Increase Contrast setting is on'
                    : 'Increase color contrast for better readability'}
                </span>
              </span>
              <span
                aria-hidden="true"
                className={`relative inline-flex h-[31px] w-[51px] flex-shrink-0 rounded-full transition-colors ${
                  highContrastOn ? 'bg-green-700' : 'bg-gray-300'
                }`}
              >
                <span
                  className={`absolute top-[2px] h-[27px] w-[27px] rounded-full bg-white shadow transition-transform ${
                    highContrastOn ? 'translate-x-[22px]' : 'translate-x-[2px]'
                  }`}
                />
              </span>
            </button>

            <div className="flex min-h-14 items-center justify-between gap-4 border-t border-gray-200 px-4 py-3">
              <div className="min-w-0">
                <div className="font-medium text-gray-900">Zoom</div>
                <div className="text-sm text-gray-600">Magnify the whole exam surface</div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    onZoomChange(Math.round(Math.max(STUDENT_ZOOM_MIN, zoom - STUDENT_ZOOM_STEP) * 100) / 100)
                  }
                  disabled={zoomAtMin}
                  data-testid="zoom-decrease"
                  aria-label="Zoom out"
                  className={stepperButtonClassName}
                >
                  <Minus size={16} aria-hidden="true" />
                </button>
                <span
                  data-testid="zoom-value"
                  className="min-w-[3.25rem] text-center text-sm font-bold tabular-nums text-gray-900"
                >
                  {zoomPercent}%
                </span>
                <button
                  type="button"
                  onClick={() =>
                    onZoomChange(Math.round(Math.min(STUDENT_ZOOM_MAX, zoom + STUDENT_ZOOM_STEP) * 100) / 100)
                  }
                  disabled={zoomAtMax}
                  data-testid="zoom-increase"
                  aria-label="Zoom in"
                  className={stepperButtonClassName}
                >
                  <Plus size={16} aria-hidden="true" />
                </button>
                {zoom !== 1 ? (
                  <button
                    type="button"
                    onClick={() => onZoomChange(1)}
                    data-testid="zoom-reset"
                    className="ml-1 min-h-11 rounded-lg px-2 text-sm font-semibold text-blue-700 hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
                  >
                    Reset
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </section>

        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-1">
          <button
            type="button"
            onClick={onResetDefaults}
            data-testid="reset-preferences"
            className="min-h-11 rounded-lg px-1 text-sm font-semibold text-gray-700 underline-offset-2 hover:text-gray-950 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
          >
            Reset to defaults
          </button>
          <p className="text-sm text-gray-600">Saved automatically — applies to your next exam.</p>
        </div>
      </div>
    </dialog>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(dialog, document.body);
}
