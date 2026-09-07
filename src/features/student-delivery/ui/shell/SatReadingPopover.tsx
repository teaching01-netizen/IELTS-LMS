import { X } from "lucide-react";
import { useEffect, useRef, type RefObject } from "react";
import { AnimatePresence } from "motion/react";
import {
  SAT_READING_TEXT_SCALES,
  createSatReadingPreferences,
  isDefaultSatReadingPreferences,
  nextSatReadingTextScale,
  previousSatReadingTextScale,
  type SatReadingPreferences,
} from "../../domain/satReadingPreferences";
import { useSatMediaQuery } from "../useSatMediaQuery";
import { SatPresenceSurface } from "../motion/SatPresenceSurface";

const COMPACT_READING_QUERY = "(max-width: 639px), (max-height: 560px)";

export interface SatReadingPopoverProps {
  open: boolean;
  disabled: boolean;
  preferences: SatReadingPreferences;
  triggerRef: RefObject<HTMLButtonElement | null>;
  onChange: (preferences: SatReadingPreferences) => void;
  onClose: () => void;
}

export function SatReadingPopover(props: SatReadingPopoverProps) {
  const { open, disabled, preferences, triggerRef, onChange, onClose } = props;
  const compact = useSatMediaQuery(COMPACT_READING_QUERY);
  const panelRef = useRef<HTMLDivElement>(null);
  const scaleIndex = SAT_READING_TEXT_SCALES.indexOf(preferences.textScale);
  const canDecrease = scaleIndex > 0 && !disabled;
  const canIncrease = scaleIndex < SAT_READING_TEXT_SCALES.length - 1 && !disabled;
  const percent = Math.round(preferences.textScale * 100);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      if (compact)
        panelRef.current?.querySelector<HTMLElement>("[data-sat-reading-close]")?.focus();
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        triggerRef.current?.focus();
        return;
      }
      if (!compact || event.key !== "Tab" || !panelRef.current) return;
      const focusable = [
        ...panelRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ),
      ];
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [compact, onClose, open, triggerRef]);

  const update = (next: Partial<SatReadingPreferences>) => {
    onChange({ ...preferences, ...next, version: 1 });
  };

  const panel = (
    <SatPresenceSurface
      offsetY={compact ? 6 : 3}
      ref={panelRef}
      role="dialog"
      aria-modal={compact ? true : undefined}
      aria-labelledby="sat-reading-options-title"
      style={{ maxHeight: compact ? 'calc(100dvh - 16px)' : 'calc(100dvh - 140px)', overflowY: 'auto' }}
      className={
        compact
          ? "sat-ui w-full max-w-[520px] overflow-hidden rounded-t-[14px] border border-b-0 border-[var(--sat-divider)] bg-[var(--sat-surface)] shadow-[0_-18px_60px_rgba(0,0,0,0.22)]"
          : "sat-ui absolute right-0 top-[calc(100%+8px)] z-[84] w-[320px] overflow-hidden rounded-[10px] border border-[var(--sat-divider-soft)] bg-[var(--sat-surface)] shadow-[0_18px_50px_rgba(0,0,0,0.18)]"
      }
    >
      <div className="flex min-h-11 items-center justify-between border-b border-[var(--sat-divider-soft)] px-4">
        <div className="min-w-0 py-3">
          <h2
            id="sat-reading-options-title"
            className="text-[15px] font-semibold text-[var(--sat-text)]"
          >
            Reading
          </h2>
          <p className="mt-0.5 text-[12px] leading-4 text-[var(--sat-text-secondary)]">
            Changes only how the exam looks.
          </p>
        </div>
        <button
          type="button"
          data-sat-reading-close
          onClick={() => {
            onClose();
            triggerRef.current?.focus();
          }}
          className="sat-touch-target sat-pressable grid shrink-0 place-items-center rounded-[6px] text-[var(--sat-text)] hover:bg-[var(--sat-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)]"
          aria-label="Close reading options"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      <div className="space-y-5 px-4 py-4">
        <section aria-labelledby="sat-reading-text-size-label">
          <div className="flex items-center justify-between gap-3">
            <h3
              id="sat-reading-text-size-label"
              className="text-[14px] font-semibold text-[var(--sat-text)]"
            >
              Text Size
            </h3>
            <output
              className="sat-tabular text-[12px] text-[var(--sat-text-secondary)]"
              aria-live="polite"
            >
              {percent}%
            </output>
          </div>
          <div className="mt-2 grid grid-cols-[44px_minmax(0,1fr)_44px] items-center overflow-hidden rounded-[9px] border border-[var(--sat-divider)] bg-[var(--sat-surface)]">
            <button
              type="button"
              disabled={!canDecrease}
              onClick={() =>
                update({ textScale: previousSatReadingTextScale(preferences.textScale) })
              }
              className="sat-touch-target sat-pressable text-[17px] font-semibold text-[var(--sat-text)] hover:bg-[var(--sat-surface-hover)] disabled:text-[var(--sat-disabled-text)] focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--sat-focus)]"
              aria-label="Decrease text size"
            >
              A−
            </button>
            <div
              className="grid min-h-11 place-items-center border-x border-[var(--sat-divider-soft)]"
              aria-hidden="true"
            >
              <span
                className="font-semibold leading-none text-[var(--sat-text)]"
                style={{ fontSize: `${16 * preferences.textScale}px` }}
              >
                Aa
              </span>
            </div>
            <button
              type="button"
              disabled={!canIncrease}
              onClick={() => update({ textScale: nextSatReadingTextScale(preferences.textScale) })}
              className="sat-touch-target sat-pressable text-[17px] font-semibold text-[var(--sat-text)] hover:bg-[var(--sat-surface-hover)] disabled:text-[var(--sat-disabled-text)] focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--sat-focus)]"
              aria-label="Increase text size"
            >
              A+
            </button>
          </div>
        </section>

        <section aria-labelledby="sat-reading-line-spacing-label">
          <h3
            id="sat-reading-line-spacing-label"
            className="text-[14px] font-semibold text-[var(--sat-text)]"
          >
            Line Spacing
          </h3>
          <div
            className="mt-2 grid grid-cols-2 rounded-[9px] bg-[var(--sat-surface-subtle)] p-1"
            role="group"
            aria-label="Line spacing"
          >
            {(["standard", "relaxed"] as const).map((spacing) => (
              <button
                type="button"
                key={spacing}
                disabled={disabled}
                aria-pressed={preferences.lineSpacing === spacing}
                onClick={() => update({ lineSpacing: spacing })}
                className={`sat-touch-target sat-pressable sat-state-transition rounded-[7px] px-3 text-[14px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)] ${preferences.lineSpacing === spacing ? "bg-[var(--sat-surface)] text-[var(--sat-text)] shadow-sm" : "text-[var(--sat-text-secondary)] hover:text-[var(--sat-text)]"}`}
              >
                {spacing === "standard" ? "Standard" : "Relaxed"}
              </button>
            ))}
          </div>
        </section>

        <section aria-label="Exam zoom">
          <h3 className="text-sm font-semibold">Exam Zoom</h3>
          <div className="mt-2 flex items-center justify-between gap-3 rounded border border-[var(--sat-divider)]">
            <button type="button" aria-label="Decrease exam zoom" disabled={disabled || (preferences.examZoom ?? 1) <= 1}
              onClick={() => update({ examZoom: Math.max(1, (preferences.examZoom ?? 1) - 0.25) })}
              className="sat-touch-target rounded px-3 focus-visible:outline focus-visible:outline-2">−</button>
            <output aria-live="polite">{Math.round((preferences.examZoom ?? 1) * 100)}%</output>
            <button type="button" aria-label="Increase exam zoom" disabled={disabled || (preferences.examZoom ?? 1) >= 2}
              onClick={() => update({ examZoom: Math.min(2, (preferences.examZoom ?? 1) + 0.25) })}
              className="sat-touch-target rounded px-3 focus-visible:outline focus-visible:outline-2">+</button>
          </div>
        </section>
        <section aria-label="Contrast">
          <h3 className="text-sm font-semibold">Contrast</h3>
          <div className="mt-2 flex gap-2">
            {(['default', 'high-contrast'] as const).map((contrastMode) => <button key={contrastMode} type="button" disabled={disabled}
              aria-pressed={(preferences.contrastMode ?? 'default') === contrastMode} onClick={() => update({ contrastMode })}
              className="sat-touch-target flex-1 rounded border border-[var(--sat-divider)] px-3 aria-pressed:bg-[var(--sat-accent-soft)] focus-visible:outline focus-visible:outline-2">
              {contrastMode === 'default' ? 'Default contrast' : 'High contrast'}
            </button>)}
          </div>
        </section>

        <div className="flex justify-end border-t border-[var(--sat-divider-soft)] pt-3">
          <button
            type="button"
            disabled={disabled || isDefaultSatReadingPreferences(preferences)}
            onClick={() => onChange(createSatReadingPreferences())}
            className="sat-touch-target sat-pressable rounded-full px-4 text-[14px] font-semibold text-[var(--sat-accent-strong)] hover:bg-[var(--sat-accent-soft)] disabled:text-[var(--sat-disabled-text)] disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)]"
          >
            Reset
          </button>
        </div>
      </div>
    </SatPresenceSurface>
  );

  return (
    <AnimatePresence initial={false}>
      {open ? (
        compact ? (
          <SatPresenceSurface
            motionKind="backdrop"
            className="sat-dialog-backdrop fixed inset-0 z-[83] flex items-end justify-center bg-black/20"
            role="presentation"
          >
            {panel}
          </SatPresenceSurface>
        ) : (
          panel
        )
      ) : null}
    </AnimatePresence>
  );
}
