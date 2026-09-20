import React, { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { motion } from 'motion/react';
import { useLoupeMotion } from './useSelectionMotion';
import '../styles/selection.css';

/**
 * The magnifier, shown exactly while the student is establishing or moving an
 * endpoint.
 *
 * This contributes more to the interaction feeling like the platform's own than
 * any amount of styling does: a finger covers the character it is choosing, and
 * the loupe is the only feedback that says which one the engine resolved. It is
 * shown while a hold is claiming text and while a handle is being dragged, and
 * nowhere else — a magnifier that lingers after the selection is settled is
 * noise on top of the words the student is trying to read.
 *
 * The content is CLONED RENDERED DOM, not a screenshot: no canvas, no
 * `html2canvas`, no image pipeline to keep in sync with live edits (a highlight
 * applied mid-gesture, a re-rendered paragraph, a live region updating). The
 * clone is taken once per loupe session — never per pointermove — and only the
 * transform of the clone moves afterwards, so following the finger costs one
 * transform write per frame.
 *
 * THE CLONE IS A PICTURE, NOT A SECOND PAGE. Cloning rendered DOM copies more
 * than appearance: it copies the attributes the application ADDRESSES text by.
 * A clone of the SAT prose carries `data-sat-annotation-region`,
 * `data-student-highlightable` and `data-student-owned-touch-selection` with it,
 * and for as long as the magnifier is open the document contains two of each —
 * two SAT regions, two selectable surfaces, two answers to `querySelector` for
 * code that asks where the prose is. That is not a cosmetic problem: it breaks
 * the engine's own invariant of ONE active selection and ONE addressable
 * surface, and it made an e2e locator for the SAT region resolve to two elements
 * mid-gesture.
 *
 * So the clone is sanitised out of every namespace that identifies or describes
 * it — all `data-*` (the application's addressing), `id`/`name`/`for`
 * (identity), `role` and `aria-*` (semantics) — and the whole subtree is made
 * unreachable for pointer, focus and assistive technology (`inert` plus
 * `aria-hidden`). Only `class` and `style` survive, because those are what make
 * the magnified text LOOK like the text: the ink of a highlight is painted by
 * inline style, not by any attribute that was removed.
 *
 * THE LENS'S BOX IS NEVER ANIMATED. The outer element is the positioning box:
 * its size and its inline transform are what the suite measures, and what the
 * finger-relative arithmetic (`top` one lens-height above the finger, centred on
 * it) is derived from, so it is written directly and never tweened. The scale-in
 * happens on the FRAME inside it — a second element that carries the material and
 * clips the picture — which is why the magnifier can grow without any measured
 * geometry moving on any frame, at rest or mid-entrance.
 */

/**
 * Drop one attribute from the picture. Everything the application ADDRESSES or
 * DESCRIBES by goes; class and style stay, because they are the rendering.
 */
function sanitizeAttribute(element: HTMLElement, name: string, isRoot: boolean): void {
  const attribute = name.toLowerCase();
  // The loupe's own source marker is the only `data-*` attribute on it that is
  // not the application's; the caller stamps it after this pass.
  if (attribute.startsWith('data-')) {
    if (!isRoot || attribute !== 'data-selection-loupe-source') element.removeAttribute(name);
    return;
  }
  if (attribute.startsWith('aria-') || attribute === 'role' || attribute === 'id' || attribute === 'name' || attribute === 'for') {
    element.removeAttribute(name);
  }
}

export interface SelectionLoupeProps {
  open: boolean;
  /** Where the finger is, in viewport coordinates. */
  point: { x: number; y: number };
  /** The element whose rendered text is magnified. */
  sourceRef: RefObject<HTMLElement | null>;
  diameter?: number | undefined;
  magnification?: number | undefined;
  /** Distance between the finger and the loupe's centre, in CSS pixels. */
  offset?: number | undefined;
}

export function SelectionLoupe({
  open,
  point,
  sourceRef,
  diameter = 128,
  magnification = 1.5,
  offset = 64,
}: SelectionLoupeProps) {
  const mount = useRef<HTMLDivElement | null>(null);
  const [sourceBox, setSourceBox] = useState<{ left: number; top: number } | null>(null);
  const loupe = useLoupeMotion();

  // One clone per session. Keyed on whether the loupe is open at all, so moving
  // the finger cannot rebuild the DOM under it.
  useEffect(() => {
    const host = mount.current;
    const source = sourceRef.current;
    if (!host) return;
    host.replaceChildren();
    if (!open || !source) return;

    const copy = source.cloneNode(true) as HTMLElement;
    for (const element of [copy, ...Array.from(copy.querySelectorAll<HTMLElement>('*'))]) {
      for (const name of element.getAttributeNames()) sanitizeAttribute(element, name, element === copy);
      // Belt and braces beside `inert`: some engines expose the attribute before
      // they honour it, and a magnified copy of a button must never be a tab
      // stop even then.
      if (element.matches('button, a, input, textarea, select, [tabindex]')) element.setAttribute('tabindex', '-1');
    }
    // The loupe's own markers are stamped AFTER sanitising, so they are the only
    // attributes on the picture that belong to anybody.
    copy.setAttribute('inert', '');
    copy.setAttribute('aria-hidden', 'true');
    copy.setAttribute('data-selection-loupe-source', 'true');
    copy.style.margin = '0';
    host.append(copy);
  }, [open, sourceRef]);

  // Where the source sits in the viewport, re-measured while the loupe is open so
  // a scroll, a reflow or a text-size change moves the magnified content with the
  // page instead of leaving it behind.
  useLayoutEffect(() => {
    if (!open) {
      setSourceBox(null);
      return;
    }
    const source = sourceRef.current;
    if (!source || typeof source.getBoundingClientRect !== 'function') return;
    const box = source.getBoundingClientRect();
    setSourceBox({ left: box.left, top: box.top });
  }, [open, point.x, point.y, sourceRef]);

  if (!open) return null;

  const centreX = point.x;
  const centreY = point.y - offset;
  const left = centreX - diameter / 2;
  const top = centreY - diameter / 2;
  const contentLeft = sourceBox ? -(point.x - sourceBox.left) * magnification + diameter / 2 : 0;
  const contentTop = sourceBox ? -(point.y - sourceBox.top) * magnification + diameter / 2 : 0;

  const { initial, animate, transition, ...witness } = loupe;

  return (
    <div
      aria-hidden="true"
      data-selection-loupe="true"
      className="selection-v2 selection-v2-loupe"
      style={{
        width: diameter,
        height: diameter,
        transform: `translate3d(${left}px, ${top}px, 0)`,
        pointerEvents: 'none',
      }}
    >
      <motion.div
        data-selection-loupe-frame="true"
        className="selection-v2-loupe-frame"
        initial={initial}
        animate={animate}
        transition={transition}
        {...witness}
      >
        <div
          ref={mount}
          data-selection-loupe-content="true"
          className="selection-v2-loupe-content"
          style={{ transform: `translate3d(${contentLeft}px, ${contentTop}px, 0) scale(${magnification})`, pointerEvents: 'none' }}
        />
      </motion.div>
    </div>
  );
}
