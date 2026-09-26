import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { SAT_UNDERLINE_STYLES, type SatUnderlineStyle } from '../../domain/satResponses';
import { SAT_COPY } from '../../domain/satCopy';
import { SAT_ANNOTATION_ACTION, SatActionWash, SatUnderlineGlyph } from './SatAnnotationControls';

/**
 * The underline control and its style menu: `U̲ ⌄`.
 *
 * Two presses, two jobs, on purpose. The U applies an underline in the style in
 * use — the one-tap path, and the only one a student who wants an underline
 * needs. The chevron opens the four styles (solid, dashed, dotted, none), which
 * is how the same span gets drawn differently without deleting and redrawing it.
 *
 * On the bar the two presses are drawn as ONE split control — `U̲ ⌄`, one glyph
 * cluster with no divider and no second outline between them — because that is
 * what the reference has and because two full rings beside each other read as
 * two unrelated actions. Both halves keep their own 44px target; what is shared
 * is the drawing, not the reach.
 *
 * The menu is a `menu` of `menuitemradio`s: one choice, one checked item, and
 * the arrow walk a keyboard user expects from a style picker. It is rendered
 * into the SURFACE rather than next to its trigger inside the surface's body,
 * because that body is the toolbar's own scroll container — a popover drawn
 * inside it would be clipped to the height of the pill it hangs off. Appearing
 * as a sibling of the body also keeps it inside the surface's box, so the
 * placement engine and the caret keep describing where the menu is.
 *
 * Escape belongs to the menu first: when it is open, Escape closes it and hands
 * focus back to the chevron, and only a second Escape reaches the toolbars. That
 * hierarchy is why the key is taken in the WINDOW capture pass — the innermost
 * surface on screen has to read the press before anything arbitrating for the
 * selection underneath it, and `stopPropagation` is what stops one Escape from
 * meaning two things at once.
 */

export type SatUnderlineChoice = SatUnderlineStyle | 'none';

const STYLE_LABEL: Record<SatUnderlineStyle, string> = {
  solid: SAT_COPY.annotations.underlineSolid,
  dashed: SAT_COPY.annotations.underlineDashed,
  dotted: SAT_COPY.annotations.underlineDotted,
};

/** A style option's spoken name; `none` is the absence of an underline. */
export function satUnderlineChoiceLabel(choice: SatUnderlineChoice): string {
  return choice === 'none' ? SAT_COPY.annotations.removeUnderlineStyle : STYLE_LABEL[choice];
}

/** Options in the order the menu draws them: the three lines, then `None`. */
const MENU_OPTIONS: readonly SatUnderlineChoice[] = [...SAT_UNDERLINE_STYLES, 'none'];

export function SatUnderlineStyleControl({
  current,
  disabled,
  onApply,
  onChoose,
}: {
  /** The style in use: the U's line, and the option the menu checks. */
  current: SatUnderlineChoice;
  disabled?: boolean | undefined;
  /**
   * The one-tap path. Receives the style the U is drawing — `solid` when there
   * is no underline yet, because a bare "underline this" has to pick something.
   */
  onApply: (style: SatUnderlineStyle) => void;
  /** A menu choice: a style to draw the underline in, or `'none'` to drop it. */
  onChoose: (choice: SatUnderlineChoice) => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const applyStyle: SatUnderlineStyle = current === 'none' ? 'solid' : current;

  // The surface is the positioning context the menu must not be clipped by.
  // Resolved at render time rather than in an effect: `open` only ever flips in
  // a press, so the ref is populated by then, and the menu never renders a frame
  // in the wrong place.
  const portalTarget = open
    ? (triggerRef.current?.closest('[data-sat-annotation-surface]') as HTMLElement | null)
    : null;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: Event) => {
      const target = event.target as Node | null;
      if (target && (menuRef.current?.contains(target) || triggerRef.current?.contains(target))) return;
      // A press anywhere else is the student moving on. Propagation is left
      // alone: a press outside the whole toolbar is still the toolbar's own
      // dismissal to read, and a press on another control still acts.
      setOpen(false);
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open]);

  // Opening puts the caret on the style in use: the student can see where they
  // are, arrow to another, and Enter without reaching for the pointer.
  useEffect(() => {
    if (!open) return;
    menuRef.current
      ?.querySelector<HTMLButtonElement>(`[data-sat-underline-style-option="${current}"]`)
      ?.focus();
  }, [open, current]);

  const walk = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? []);
    if (items.length === 0) return;
    event.preventDefault();
    const index = items.findIndex((item) => item === document.activeElement);
    const step = event.key === 'ArrowDown' ? 1 : -1;
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? items.length - 1
        : index === -1 ? 0
          : (index + step + items.length) % items.length;
    items[next]?.focus();
  };

  const menu = open ? (
    <div
      ref={menuRef}
      id={menuId}
      role="menu"
      aria-label={SAT_COPY.annotations.underlineStyle}
      // Focusable container, never a tab stop: focus lands on the option in use
      // (see below), and the container exists so the pattern is whole.
      tabIndex={-1}
      data-sat-underline-style-menu="true"
      // Sits just under the toolbar, centred on it: the menu belongs to the
      // whole control row, and centring keeps it clear of the swatches it would
      // otherwise cover when the toolbar is narrow.
      className="sat-ui absolute left-1/2 top-full z-[90] mt-1 grid -translate-x-1/2 gap-1 rounded-[10px] border border-[var(--sat-answer-border)] bg-[var(--sat-surface)] p-1 shadow-[var(--sat-shadow-floating)]"
      // A press inside the popover is still a press on the toolbar: it must not
      // read as the student leaving the selection.
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.preventDefault()}
      onKeyDown={walk}
    >
      {MENU_OPTIONS.map((option) => {
        const checked = option === current;
        return (
          <button
            key={option}
            type="button"
            role="menuitemradio"
            aria-checked={checked}
            aria-label={satUnderlineChoiceLabel(option)}
            title={satUnderlineChoiceLabel(option)}
            data-sat-underline-style-option={option}
            disabled={disabled === true}
            onClick={() => {
              onChoose(option);
              setOpen(false);
              triggerRef.current?.focus();
            }}
            // One selected-state indicator, not three: the row in use carries a
            // quiet surface tint, and every row is otherwise identical.
            className={
              'sat-pressable grid h-11 min-w-11 place-items-center rounded-[8px] px-1 text-[var(--sat-text)] hover:bg-[var(--sat-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--sat-focus)] '
              + (checked ? 'bg-[var(--sat-surface-selected,rgba(0,0,0,0.06))]' : '')
            }
          >
            {option === 'none' ? (
              <span className="sat-type-metadata px-1 font-medium">{SAT_COPY.annotations.underlineNone}</span>
            ) : (
              <SatUnderlineGlyph style={option} />
            )}
          </button>
        );
      })}
    </div>
  ) : null;

  return (
    <>
      {/* One control, two presses: the two targets are contiguous, so the U and
          its chevron share one piece of chrome and the row does not pay a
          separate gap for a disclosure. */}
      <span className="flex shrink-0 items-center">
        <button
          type="button"
          data-sat-annotation-action="underline"
          aria-label={SAT_COPY.annotations.underline}
          title={SAT_COPY.annotations.underline}
          disabled={disabled === true}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onApply(applyStyle)}
          className={SAT_ANNOTATION_ACTION}
        >
          <SatActionWash>
            <SatUnderlineGlyph style={applyStyle} />
          </SatActionWash>
        </button>
        <button
          ref={triggerRef}
          type="button"
          data-sat-annotation-action="underline-style"
          aria-label={SAT_COPY.annotations.underlineStyle}
          title={SAT_COPY.annotations.underlineStyle}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          disabled={disabled === true}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setOpen((current) => !current)}
          // Same 44px target as every other action: the chevron is a second
          // press, not a smaller one, and two widths on one element would leave
          // the rendered box to stylesheet order. What makes it read as part of
          // the U is the drawing around it, not a smaller box.
          className={SAT_ANNOTATION_ACTION}
        >
          <SatActionWash>
            <ChevronDown
              className={'sat-state-transition h-4 w-4 shrink-0 ' + (open ? 'rotate-180' : '')}
              aria-hidden="true"
            />
          </SatActionWash>
        </button>
      </span>
      {menu && portalTarget ? createPortal(menu, portalTarget) : menu}
    </>
  );
}
