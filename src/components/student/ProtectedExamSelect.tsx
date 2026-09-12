import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Select as RadixSelect } from 'radix-ui';
import { Check, ChevronDown } from 'lucide-react';
import { useOptionalStudentAttemptControls } from './providers/StudentAttemptProvider';
import { registerProtectedAnswerControlLifecycle } from './protectedAnswerControlLifecycle';

/**
 * P3.3/P3.4 — value-oriented protected select.
 *
 * One value adapter with two presentations sharing one controller:
 *   - desktop/tablet: Radix Select anchored menu (wide/standard space)
 *   - phone/compact: an inline choice sheet on the existing dialog pattern
 *
 * The component is value-oriented: it never fabricates a change event and
 * never requires an HTMLSelectElement. The lifecycle registry still sees a
 * real HTMLElement (the control root), and commits read the latest committed
 * ref synchronously — before React renders.
 *
 * Three distinct values (phase-03-controls-navigation.md P3.3):
 *   - committed:   the current answer in the application/draft path
 *   - highlighted: the option keyboard navigation points at while open —
 *                  never committed; Escape/outside click discards it
 *   - latest ref:  synchronously readable committed value for lifecycle
 *                  commits (here it equals the committed value at all times,
 *                  so the registry registration keeps pagehide/visibility/
 *                  freeze coverage wired without a rescue replay)
 *
 * Empty value: Radix forbids empty item values, so the cleared state renders
 * the placeholder in the trigger and a dedicated clear item maps directly to
 * the application's empty string. The Radix-only sentinel below is intercepted
 * before commit and can therefore never collide with an authored option ID.
 */

/** Radix-internal value for the clear action; intercepted, never committed. */
const CLEAR_ITEM_VALUE = '__protected-exam-select-clear__';

export interface ProtectedExamSelectOption {
  /** Stable persisted value (answer scalar). Never label-derived. */
  readonly value: string;
  /** Display label. Duplicated labels are fine — identity is the value. */
  readonly label: string;
  /** Optional secondary description rendered under the label. */
  readonly description?: string | undefined;
  /** Disabled options stay visible but cannot be committed. */
  readonly disabled?: boolean | undefined;
}

interface ProtectedExamSelectProps {
  /** Stable accessible name, e.g. "Heading selection for question 3". */
  ariaLabel: string;
  /** Committed value from the existing answer path ('' = cleared). */
  value: string;
  /** Stable option list (values are IDs; labels may repeat). */
  options: readonly ProtectedExamSelectOption[];
  /** Placeholder shown when value is '' (e.g. "Choose heading…"). */
  placeholder: string;
  /** Single application commit path — called once per committed change. */
  onValueChange: (value: string) => void;
  /** Live registry update on commit (same moment, before persistence). */
  onLiveValueChange?: ((value: string) => void) | undefined;
  /** Phone/compact sheet presentation instead of the anchored menu. */
  compact?: boolean | undefined;
  disabled?: boolean | undefined;
  required?: boolean | undefined;
  className?: string | undefined;
  testId?: string | undefined;
}

const MENU_CONTENT_CLASS =
  'student-exam-select-menu z-50 max-h-[min(60vh,20rem)] min-w-[10rem] overflow-y-auto rounded-md border border-[rgba(41,41,39,0.24)] bg-white p-1 shadow-md';
const ITEM_CLASS =
  'student-touch-target flex w-full cursor-pointer select-none items-start justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-[length:var(--student-control-font-size,1rem)] leading-snug text-[#292927] outline-none data-[highlighted]:bg-[rgba(47,95,208,0.12)] data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40';

interface SelectItemProps {
  readonly value: string;
  readonly disabled?: boolean | undefined;
  readonly children: React.ReactNode;
}

function RadixOptionItem({ value, disabled, children }: SelectItemProps) {
  return (
    <RadixSelect.Item
      value={value}
      disabled={disabled ?? false}
      className={ITEM_CLASS}
      data-testid={`protected-exam-select-item-${value}`}
    >
      <RadixSelect.ItemText>{children}</RadixSelect.ItemText>
      <RadixSelect.ItemIndicator className="mt-0.5 inline-flex">
        <Check size={14} aria-hidden="true" />
      </RadixSelect.ItemIndicator>
    </RadixSelect.Item>
  );
}

export function ProtectedExamSelect({
  ariaLabel,
  value,
  options,
  placeholder,
  onValueChange,
  onLiveValueChange,
  compact = false,
  disabled = false,
  required = false,
  className,
  testId,
}: ProtectedExamSelectProps) {
  const attemptControls = useOptionalStudentAttemptControls();
  const triggerId = useId();
  const listLabelId = useId();
  const ownerTestId = testId ?? 'protected-exam-select';

  const optionsRef = useRef(options);
  optionsRef.current = options;
  const onValueChangeRef = useRef(onValueChange);
  onValueChangeRef.current = onValueChange;
  const onLiveValueChangeRef = useRef(onLiveValueChange);
  onLiveValueChangeRef.current = onLiveValueChange;
  const flushAnswerDurabilityNowRef = useRef(() => attemptControls?.flushAnswerDurabilityNow());
  flushAnswerDurabilityNowRef.current = () => attemptControls?.flushAnswerDurabilityNow();

  // Latest committed value, readable synchronously by lifecycle commits.
  // Seeded from props on every render so hydration/answer changes stay true.
  const latestCommittedValueRef = useRef<string>(value);
  latestCommittedValueRef.current = value;
  // FIX-02 analogue: stale rescues cannot replay older values over fresh
  // hydration because the ref IS the truth — there is no rescue replay.
  const lastCommittedToAppRef = useRef<string | null>(null);

  const triggerRef = useRef<HTMLButtonElement>(null);
  // Root element registered with the lifecycle registry (the whole control,
  // so a focus move into the option portal is not a blur of the control).
  const [rootElement, setRootElement] = useState<HTMLSpanElement | null>(null);
  const [open, setOpen] = useState(false);

  const isValidValue = useCallback((candidate: string): boolean => {
    if (candidate === '') {
      // Clearing mirrors the old select's "" option — always permitted.
      return true;
    }
    return optionsRef.current.some((option) => option.value === candidate && !option.disabled);
  }, []);

  const commitValue = useCallback(
    (nextValue: string) => {
      if (!isValidValue(nextValue)) {
        return;
      }
      if (lastCommittedToAppRef.current === nextValue) {
        return;
      }
      latestCommittedValueRef.current = nextValue;
      lastCommittedToAppRef.current = nextValue;
      onLiveValueChangeRef.current?.(nextValue);
      // Existing application command path — exactly once per user commit.
      onValueChangeRef.current(nextValue);
      flushAnswerDurabilityNowRef.current?.();
    },
    [isValidValue],
  );

  // If the parent replaces the answer (hydration, restore, task switch),
  // drop the duplicate-commit guard so a deliberate user change still flows.
  const lastSeenPropValueRef = useRef<string>(value);
  useEffect(() => {
    if (lastSeenPropValueRef.current !== value) {
      lastSeenPropValueRef.current = value;
      lastCommittedToAppRef.current = null;
    }
  }, [value]);

  // P3.3 — lifecycle registration: the registry holds the control root.
  // The committed ref already equals the application value at all times, so
  // commitDomValue has nothing to rescue; the registration preserves
  // pagehide/visibility/freeze coverage for the durability flush path and
  // guarantees a focus move into the option portal can never commit the
  // highlighted-but-unselected value (the ref only holds committed values).
  useEffect(() => {
    if (!rootElement) {
      return;
    }
    return registerProtectedAnswerControlLifecycle({
      element: rootElement,
      commitDomValue: () => {
        /* committed ref is authoritative; nothing pending to rescue */
      },
    });
  }, [rootElement]);

  const selectedOption = useMemo(
    () => options.find((option) => option.value === value),
    [options, value],
  );

  // Radix cannot represent the empty value as an item, so the cleared state
  // renders the placeholder in the trigger and the clear item maps straight
  // to the application's empty value.
  const displayLabel = selectedOption ? selectedOption.label : placeholder;

  const handleRootValueChange = (nextValue: string) => {
    setOpen(false);
    commitValue(nextValue === CLEAR_ITEM_VALUE ? '' : nextValue);
  };

  const handleSheetPick = (optionValue: string) => {
    setOpen(false);
    commitValue(optionValue);
    // Sheet commits return focus to the trigger (phase-03 placement rules).
    queueMicrotask(() => triggerRef.current?.focus());
  };

  const handleSheetClear = () => {
    setOpen(false);
    commitValue('');
    queueMicrotask(() => triggerRef.current?.focus());
  };

  const handleSheetCancel = () => {
    setOpen(false);
    queueMicrotask(() => triggerRef.current?.focus());
  };

  // The compact sheet lives outside Radix's open state, so it closes itself
  // on Escape and outside pointer contact (dialog-pattern parity).
  useEffect(() => {
    if (!compact || !open || !rootElement) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        handleSheetCancel();
      }
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootElement.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('pointerdown', handlePointerDown, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compact, open, rootElement]);

  const triggerClassName =
    'student-touch-target flex min-h-[2.75rem] w-full items-center justify-between gap-2 rounded-md border border-[rgba(41,41,39,0.24)] bg-white px-3 py-2 text-left text-[length:var(--student-control-font-size,1rem)] text-[#292927] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2f5fd0] disabled:cursor-not-allowed disabled:opacity-40';

  return (
    <span
      ref={setRootElement}
      className={`relative inline-block ${className ?? ''}`}
      data-testid={ownerTestId}
      data-protected-exam-select-value={value}
    >
      <RadixSelect.Root
        open={compact ? false : open}
        onOpenChange={setOpen}
        // Fully controlled from the application path; Radix never writes the
        // answer directly. The clear sentinel keeps the empty state a legal
        // item value; commits flow through handleRootValueChange.
        value={value === '' ? CLEAR_ITEM_VALUE : value}
        onValueChange={handleRootValueChange}
        disabled={disabled}
        required={required}
      >
        <RadixSelect.Trigger
          ref={triggerRef}
          id={triggerId}
          aria-label={ariaLabel}
          className={triggerClassName}
          data-testid={`${ownerTestId}-trigger`}
          data-placeholder={selectedOption ? undefined : 'true'}
        >
          <span className={selectedOption ? '' : 'text-gray-500'}>{displayLabel}</span>
          <ChevronDown size={16} aria-hidden="true" className="shrink-0 text-gray-500" />
        </RadixSelect.Trigger>

        {!compact ? (
          <RadixSelect.Portal>
            <RadixSelect.Content
              position="popper"
              sideOffset={4}
              avoidCollisions
              className={MENU_CONTENT_CLASS}
              aria-labelledby={listLabelId}
              data-testid={`${ownerTestId}-menu`}
              // Escape/outside click close without committing; Radix returns
              // focus to the trigger and discards the highlighted option.
            >
              <span id={listLabelId} className="sr-only">
                {ariaLabel}
              </span>
              <RadixSelect.Viewport>
                <RadixOptionItem value={CLEAR_ITEM_VALUE}>
                  <span className="text-gray-500">{placeholder}</span>
                </RadixOptionItem>
                {options.map((option) => (
                  <RadixOptionItem
                    key={option.value}
                    value={option.value}
                    disabled={option.disabled}
                  >
                    <span className="flex flex-col">
                      <span>{option.label}</span>
                      {option.description ? (
                        <span className="text-xs text-gray-500">{option.description}</span>
                      ) : null}
                    </span>
                  </RadixOptionItem>
                ))}
              </RadixSelect.Viewport>
            </RadixSelect.Content>
          </RadixSelect.Portal>
        ) : null}
      </RadixSelect.Root>

      {compact && open ? (
        <span
          className="absolute left-0 top-full z-40 mt-1 flex w-max max-w-[min(90vw,24rem)] flex-col rounded-md border border-[rgba(41,41,39,0.24)] bg-white p-1 shadow-md"
          role="listbox"
          aria-label={ariaLabel}
          data-testid={`${ownerTestId}-sheet`}
        >
          <button
            type="button"
            className={ITEM_CLASS}
            onClick={handleSheetClear}
            data-testid={`${ownerTestId}-clear`}
          >
            <span className="text-gray-500">{placeholder}</span>
            {value === '' ? <Check size={14} aria-hidden="true" /> : null}
          </button>
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              className={ITEM_CLASS}
              disabled={option.disabled}
              aria-selected={option.value === value}
              onClick={() => {
                handleSheetPick(option.value);
              }}
              data-testid={`protected-exam-select-item-${option.value}`}
            >
              <span className="flex flex-col">
                <span>{option.label}</span>
                {option.description ? (
                  <span className="text-xs text-gray-500">{option.description}</span>
                ) : null}
              </span>
              {option.value === value ? <Check size={14} aria-hidden="true" /> : null}
            </button>
          ))}
          <button
            type="button"
            className={`${ITEM_CLASS} justify-center text-xs font-semibold text-gray-600`}
            onClick={handleSheetCancel}
            data-testid={`${ownerTestId}-cancel`}
          >
            Cancel
          </button>
        </span>
      ) : null}
    </span>
  );
}
