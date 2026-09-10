import type { RefObject } from "react";
import {
  SAT_READING_TEXT_SCALES,
  createSatReadingPreferences,
  isDefaultSatReadingPreferences,
  nextSatReadingTextScale,
  previousSatReadingTextScale,
  type SatReadingPreferences,
} from "../../domain/satReadingPreferences";
import { SAT_COPY } from "../../domain/satCopy";
import { SatPopoverShell } from "../primitives/SatPopoverShell";

export interface SatReadingPopoverProps {
  open: boolean;
  disabled: boolean;
  preferences: SatReadingPreferences;
  triggerRef: RefObject<HTMLButtonElement | null>;
  onChange: (preferences: SatReadingPreferences) => void;
  onClose: () => void;
}

/**
 * Display settings popover (Phase 5 copy applied early: Display, not Reading).
 *
 * "Reading" is reserved for exam content (Reading and Writing section,
 * passage pane). This panel only changes presentation, so it is named
 * Display with a safety promise in the subtitle (copy table). Focus contract
 * via SatPopoverShell: focus-in on every open, focus-back on every close.
 */
export function SatReadingPopover(props: SatReadingPopoverProps) {
  const { open, disabled, preferences, triggerRef, onChange, onClose } = props;
  const scaleIndex = SAT_READING_TEXT_SCALES.indexOf(preferences.textScale);
  const canDecrease = scaleIndex > 0 && !disabled;
  const canIncrease = scaleIndex < SAT_READING_TEXT_SCALES.length - 1 && !disabled;
  const percent = Math.round(preferences.textScale * 100);

  const update = (next: Partial<SatReadingPreferences>): void => {
    onChange({ ...preferences, ...next, version: 1 });
  };

  return (
    <SatPopoverShell
      open={open}
      title={SAT_COPY.displaySettings.title}
      triggerRef={triggerRef}
      onClose={onClose}
      closeLabel={SAT_COPY.displaySettings.close}
      anchoredClassName="sat-ui sat-popover-anchored fixed right-[calc(1rem+var(--student-safe-right))] top-[calc(var(--student-safe-top)+98px)] z-[84] w-[320px] max-h-[calc(100dvh-140px)] overflow-y-auto rounded-[8px] border border-[var(--sat-divider-soft)] bg-[var(--sat-surface)] shadow-[var(--sat-shadow-floating)]"
      compactClassName="sat-ui w-full max-w-[520px] max-h-[calc(100dvh-16px)] overflow-y-auto rounded-t-[14px] border border-b-0 border-[var(--sat-divider)] bg-[var(--sat-surface)] shadow-[var(--sat-shadow-floating)]"
      backdropClassName="sat-dialog-backdrop fixed inset-0 z-[83] flex items-end justify-center bg-black/20"
    >
      <div className="px-4 pb-2 pt-1">
        <p className="text-[12px] leading-4 text-[var(--sat-text-secondary)]">{SAT_COPY.displaySettings.subtitle}</p>
      </div>
      <div className="space-y-5 px-4 py-4">
        <section aria-labelledby="sat-display-text-size-label">
          <div className="flex items-center justify-between gap-3">
            <h3
              id="sat-display-text-size-label"
              className="text-[14px] font-semibold text-[var(--sat-text)]"
            >
              {SAT_COPY.displaySettings.textSize}
              <span className="ml-1 font-normal text-[var(--sat-text-secondary)]">({SAT_COPY.displaySettings.textSizeHint})</span>
            </h3>
            <output className="sat-tabular text-[12px] text-[var(--sat-text-secondary)]" aria-live="polite">
              {percent}%
            </output>
          </div>
          <div className="mt-2 grid grid-cols-[44px_minmax(0,1fr)_44px] items-center overflow-hidden rounded-[9px] border border-[var(--sat-divider)] bg-[var(--sat-surface)]">
            <button
              type="button"
              disabled={!canDecrease}
              onClick={() => update({ textScale: previousSatReadingTextScale(preferences.textScale) })}
              className="sat-touch-target sat-pressable text-[17px] font-semibold text-[var(--sat-text)] hover:bg-[var(--sat-surface-hover)] disabled:text-[var(--sat-disabled-text)] focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--sat-focus)]"
              aria-label={SAT_COPY.displaySettings.decreaseTextSize}
            >
              A\u2212
            </button>
            <div className="grid min-h-11 place-items-center border-x border-[var(--sat-divider-soft)]" aria-hidden="true">
              <span className="font-semibold leading-none text-[var(--sat-text)]" style={{ fontSize: (16 * preferences.textScale) + "px" }}>
                Aa
              </span>
            </div>
            <button
              type="button"
              disabled={!canIncrease}
              onClick={() => update({ textScale: nextSatReadingTextScale(preferences.textScale) })}
              className="sat-touch-target sat-pressable text-[17px] font-semibold text-[var(--sat-text)] hover:bg-[var(--sat-surface-hover)] disabled:text-[var(--sat-disabled-text)] focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--sat-focus)]"
              aria-label={SAT_COPY.displaySettings.increaseTextSize}
            >
              A+
            </button>
          </div>
        </section>

        <section aria-labelledby="sat-display-line-spacing-label">
          <h3 id="sat-display-line-spacing-label" className="text-[14px] font-semibold text-[var(--sat-text)]">
            {SAT_COPY.displaySettings.lineSpacing}
          </h3>
          <div className="mt-2 grid grid-cols-2 rounded-[9px] bg-[var(--sat-surface-subtle)] p-1" role="group" aria-label={SAT_COPY.displaySettings.lineSpacing}>
            {(["standard", "relaxed"] as const).map((spacing) => (
              <button
                type="button"
                key={spacing}
                disabled={disabled}
                aria-pressed={preferences.lineSpacing === spacing}
                onClick={() => update({ lineSpacing: spacing })}
                className={"sat-touch-target sat-pressable sat-state-transition rounded-[7px] px-3 text-[14px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)] " + (preferences.lineSpacing === spacing ? "bg-[var(--sat-surface)] text-[var(--sat-text)] shadow-sm" : "text-[var(--sat-text-secondary)] hover:text-[var(--sat-text)]")}
              >
                {spacing === "standard" ? "Standard" : "Relaxed"}
              </button>
            ))}
          </div>
        </section>

        <section aria-label={SAT_COPY.displaySettings.screenZoom}>
          <h3 className="text-sm font-semibold">
            {SAT_COPY.displaySettings.screenZoom}
            <span className="ml-1 font-normal text-[var(--sat-text-secondary)]">({SAT_COPY.displaySettings.screenZoomHint})</span>
          </h3>
          <div className="mt-2 flex items-center justify-between gap-3 rounded border border-[var(--sat-divider)]">
            <button type="button" aria-label={SAT_COPY.displaySettings.decreaseZoom} disabled={disabled || (preferences.examZoom ?? 1) <= 1}
              onClick={() => update({ examZoom: Math.max(1, (preferences.examZoom ?? 1) - 0.25) })}
              className="sat-touch-target rounded px-3 focus-visible:outline focus-visible:outline-2">\u2212</button>
            <output aria-live="polite">{Math.round((preferences.examZoom ?? 1) * 100)}%</output>
            <button type="button" aria-label={SAT_COPY.displaySettings.increaseZoom} disabled={disabled || (preferences.examZoom ?? 1) >= 2}
              onClick={() => update({ examZoom: Math.min(2, (preferences.examZoom ?? 1) + 0.25) })}
              className="sat-touch-target rounded px-3 focus-visible:outline focus-visible:outline-2">+</button>
          </div>
        </section>
        <section aria-label={SAT_COPY.displaySettings.contrast}>
          <h3 className="text-sm font-semibold">{SAT_COPY.displaySettings.contrast}</h3>
          <div className="mt-2 flex gap-2">
            {(["default", "high-contrast"] as const).map((contrastMode) => (
              <button
                key={contrastMode}
                type="button"
                disabled={disabled}
                aria-pressed={(preferences.contrastMode ?? "default") === contrastMode}
                onClick={() => update({ contrastMode })}
                className="sat-touch-target flex-1 rounded border border-[var(--sat-divider)] px-3 aria-pressed:bg-[var(--sat-accent-soft)] focus-visible:outline focus-visible:outline-2"
              >
                {contrastMode === "default" ? SAT_COPY.displaySettings.contrastDefault : SAT_COPY.displaySettings.contrastHigh}
              </button>
            ))}
          </div>
        </section>

        {/* Line Reader lives in More (Bluebook parity) — no second toggle here. */}
        <div className="flex justify-end border-t border-[var(--sat-divider-soft)] pt-3">
          <button
            type="button"
            disabled={disabled || isDefaultSatReadingPreferences(preferences)}
            onClick={() => onChange(createSatReadingPreferences())}
            className="sat-touch-target sat-pressable rounded-full px-4 text-[14px] font-semibold text-[var(--sat-accent-strong)] hover:bg-[var(--sat-accent-soft)] disabled:text-[var(--sat-disabled-text)] disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)]"
          >
            {SAT_COPY.displaySettings.reset}
          </button>
        </div>
      </div>
    </SatPopoverShell>
  );
}
