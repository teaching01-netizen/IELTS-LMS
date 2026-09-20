import React, { useEffect, useMemo, useRef, type CSSProperties, type ReactNode, type RefObject } from 'react';

/**
 * The exam's contextual menu: one surface, one interaction grammar, product
 * controls.
 *
 * This is the single menu in the tree, and it owns exactly the parts that must
 * not differ between products: the toolbar role and its accessible name, the
 * rows, the arrow-key walk, and the outside press that dismisses it. The product
 * injects what the actions ARE and what the surface LOOKS like — the controls,
 * the material, the caret, the geometry, and how the rows scroll.
 *
 * There is deliberately no generic button renderer and no progressive disclosure
 * here. Each was written for the shared path and then had no caller: the only
 * menu in production is SAT's selection toolbar, whose controls (labelled colour
 * swatches with 44px targets, an underline, a note, a written way out) are the
 * exam's teaching surface.
 *
 * Nor does it place itself. It used to take the placement decision and write that
 * decision into `left/top/width/maxHeight/visibility` — and every one of those
 * values was then overwritten by the product's own chrome, which maps the same
 * decision for the mark's edit surface as well (a surface this component does not
 * render). So there was one mapping from a decision to CSS in the tree, and this
 * component held a second copy of it that production never saw. The decision is
 * still made once, by `placeSelectionMenu`; the product maps it once.
 *
 * What is NOT here matters too: the menu never paints a selection, never resolves
 * a caret, and never decides what an action means. It is attached to a selection,
 * not a page the student navigates to.
 */

export interface SelectionMenuAction {
  /** Identity of the action, for keys and for tests that need a stable handle. */
  id: string;
  /** Which row of the surface it sits in. Default: the first row. */
  row?: number | undefined;
  /** The product's control. The menu never draws an action itself. */
  render: ReactNode;
}

/** The product's share of the surface: how it is dressed and how its rows read. */
export interface SelectionMenuChrome {
  /** Surface classes: position, material, product tokens. */
  className: string;
  /**
   * The surface's shape, including where the placement put it. The product's,
   * because it maps the placement decision for every surface it renders — the
   * toolbar and the mark's edit dock are the same object in two states.
   */
  style?: CSSProperties | undefined;
  /** Extra DOM attributes for the surface, so a product can mark its own toolbar. */
  attributes?: Record<string, string | undefined> | undefined;
  /** Drawn inside the surface, against the anchored line: the caret. */
  caret?: ReactNode | undefined;
  /** Above the rows. */
  heading?: ReactNode | undefined;
  /** Tallest the rows may be, in px: the bound the placement measured. */
  bodyMaxHeight?: number | null | undefined;
  /**
   * How the rows scroll. The product owns the body, because the bound it scrolls
   * inside is part of its own chrome — the caret is drawn outside the surface's
   * border box, and a scroll container would clip it.
   */
  renderBody: (content: ReactNode, maxHeight: number | null) => ReactNode;
  /** One row's classes. `row` is 0-based; `last` is the final row. */
  rowClassName: (row: number, last: boolean) => string;
}

export interface SelectionActionMenuProps {
  actions: readonly SelectionMenuAction[];
  /** Accessible name for the toolbar. */
  label?: string | undefined;
  chrome: SelectionMenuChrome;
  /** The caller's node: its own measurement and autofocus use this surface. */
  containerRef?: RefObject<HTMLDivElement | null> | undefined;
  /**
   * Dismissal, for the press that lands outside the menu: this surface's own box
   * is the whole test for "was that a command". Escape is deliberately NOT here —
   * the key is arbitrated by whatever owns the selection, and a second handler
   * would make one keypress mean two things.
   */
  onDismiss?: (() => void) | undefined;
}

/** Rows in order, each with the actions that belong to it. */
function groupRows(actions: readonly SelectionMenuAction[]): Array<readonly SelectionMenuAction[]> {
  const rows = new Map<number, SelectionMenuAction[]>();
  for (const action of actions) {
    const row = Math.max(0, Math.trunc(action.row ?? 0));
    const existing = rows.get(row);
    if (existing) existing.push(action);
    else rows.set(row, [action]);
  }
  return [...rows.entries()].sort(([a], [b]) => a - b).map(([, row]) => row);
}

export function SelectionActionMenu({
  actions,
  label = 'Selection actions',
  chrome,
  containerRef,
  onDismiss,
}: SelectionActionMenuProps) {
  const ownNode = useRef<HTMLDivElement | null>(null);
  const node = containerRef ?? ownNode;
  const rows = useMemo(() => groupRows(actions), [actions]);
  const maxHeight = chrome.bodyMaxHeight && chrome.bodyMaxHeight > 0 ? chrome.bodyMaxHeight : null;

  // The latest callback through a ref: a re-render must never re-bind the
  // listener mid-gesture, and no stale closure may close the wrong surface.
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;

  useEffect(() => {
    if (!onDismiss) return;
    // Capture phase, containment only, and no preventDefault: a press outside is
    // the student leaving, and it must not break the press it was reading — the
    // native selection, an answer button, the mark that was about to open.
    const onPointerDown = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && node.current?.contains(target)) return;
      dismiss.current?.();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [node, onDismiss]);

  /**
   * The keyboard walk, on the document so it works whether the caret arrived by
   * tap or by Tab. It reads the surface rather than the model, so it covers the
   * product's own controls (SAT's swatches, its note and close buttons) with one
   * rule — and the way out stays in the walk, because a keyboard-only student
   * still has to be able to leave.
   */
  useEffect(() => {
    const keys = ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
    const onKeyDown = (event: KeyboardEvent) => {
      if (!keys.includes(event.key) || event.defaultPrevented) return;
      // Only when the caret is already inside this surface: a toolbar that is up
      // while the student types a note must not steal their arrow keys.
      const surface = node.current;
      if (!surface || !surface.contains(document.activeElement)) return;
      const items = Array.from(surface.querySelectorAll<HTMLButtonElement>('button:not([disabled])'));
      const index = items.findIndex((item) => item === document.activeElement);
      if (index === -1) return;
      event.preventDefault();
      const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
      const next = event.key === 'Home' ? 0
        : event.key === 'End' ? items.length - 1
          : (index + step + items.length) % items.length;
      items[next]?.focus();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [node]);

  return (
    <div
      ref={node}
      role="toolbar"
      aria-label={label}
      aria-orientation="horizontal"
      data-selection-action-menu="true"
      {...(chrome.attributes ?? {})}
      // The menu's own presses are commands: nothing above it may read them as
      // the student leaving the selection.
      onPointerDown={(event) => event.stopPropagation()}
      className={chrome.className}
      // The product's shape, and then the one property the menu owes its own
      // controls: a surface whose buttons cannot be pressed is not a menu.
      style={{ ...chrome.style, pointerEvents: 'auto' }}
    >
      {chrome.caret}
      {chrome.renderBody(
        <>
          {chrome.heading}
          {rows.map((row, index) => (
            <div key={index} data-selection-menu-row={index} className={chrome.rowClassName(index, index === rows.length - 1)}>
              {row.map((action) => (
                <React.Fragment key={action.id}>{action.render}</React.Fragment>
              ))}
            </div>
          ))}
        </>,
        maxHeight,
      )}
    </div>
  );
}
