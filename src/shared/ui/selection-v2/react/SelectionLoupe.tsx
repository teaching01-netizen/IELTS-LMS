import React, { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { motion } from 'motion/react';
import {
  buildPicture,
  lensPlacement,
  pictureTranslation,
  readPictureBox,
  settlePicture,
  type LoupePicture,
} from './loupePicture';
import { useLoupeMotion } from './useSelectionMotion';
import '../styles/selection.css';

/**
 * The magnifier: a camera pointed at the document at the point the student is
 * choosing, shown exactly while they are establishing or moving an endpoint.
 *
 * This contributes more to the interaction feeling like the platform's own than
 * any amount of styling does: a finger covers the character it is choosing, and
 * the loupe is the only feedback that says which one the engine resolved. It is
 * shown while a hold is claiming text and while a handle is being dragged, and
 * nowhere else — a magnifier that lingers after the selection is settled is noise
 * on top of the words the student is trying to read.
 *
 * THE PICTURE LIVES IN `loupePicture`. What is cloned and what is stripped from the
 * clone, how the copy is laid out, where its box begins inside the lens, and the
 * arithmetic that reconciles a document coordinate with the lens are all functions
 * there, over elements and numbers. This file owns WHEN they run: one picture per
 * session, its box re-read on the commit that paints, and the lens placed on every
 * pointer frame. The contract those functions keep — the picture is the document's
 * own layout, magnified, so a page coordinate is the same coordinate in the lens —
 * is stated once, there.
 *
 * THE LENS'S BOX IS NEVER ANIMATED. The outer element is the positioning box: its
 * size and its inline transform are what the suite measures, and what
 * `lensPlacement` is derived from, so it is written directly and never tweened. The
 * scale-in happens on the FRAME inside it — a second element that carries the
 * material and clips the picture — which is why the magnifier can grow without any
 * measured geometry moving on any frame, at rest or mid-entrance.
 *
 * THE COLUMN TICK. A 2px tick at the lens's centre marks the column the finger is
 * on, which is the question the lens exists to answer ("which character boundary is
 * this?"). It is drawn in the FRAME, not in the picture, so the magnification never
 * scales the mark itself, and it is the only part of the lens that is not the
 * document: a precision instrument needs an index, not a decoration.
 */

/** A phone's lens: big enough to read a character in, never a panel. */
const LOUPE_DIAMETER_MIN = 120;
const LOUPE_DIAMETER_MAX = 150;

/**
 * The lens diameter for a viewport, in CSS pixels.
 *
 * Responsive rather than hard-coded around one iPhone: a 320pt phone gets the
 * floor and a 430pt phone approaches the ceiling, so the lens keeps roughly the
 * same relationship to the line of text it is magnifying instead of turning into
 * a disc that covers the passage on a small screen. Pure and exported so the
 * sizing rule is assertable without a browser.
 */
export function resolveLoupeDiameter(viewport: { width: number; height: number }): number {
  const shortest = Math.min(viewport.width, viewport.height);
  return Math.round(Math.min(LOUPE_DIAMETER_MAX, Math.max(LOUPE_DIAMETER_MIN, shortest * 0.34)));
}

function currentViewport(): { width: number; height: number } {
  if (typeof window === 'undefined') return { width: 390, height: 844 };
  return { width: window.innerWidth || 390, height: window.innerHeight || 844 };
}

export interface SelectionLoupeProps {
  open: boolean;
  /** Where the finger is, in viewport coordinates. */
  point: { x: number; y: number };
  /** The element whose rendered text is magnified. */
  sourceRef: RefObject<HTMLElement | null>;
  /** Override the responsive lens size, in CSS pixels. */
  diameter?: number | undefined;
  magnification?: number | undefined;
  /** Distance between the finger and the lens's centre, in CSS pixels. */
  offset?: number | undefined;
}

export function SelectionLoupe({
  open,
  point,
  sourceRef,
  diameter,
  magnification = 1.5,
  offset,
}: SelectionLoupeProps) {
  const frame = useRef<HTMLDivElement | null>(null);
  const mount = useRef<HTMLDivElement | null>(null);
  const [picture, setPicture] = useState<LoupePicture | null>(null);
  const [viewportDiameter, setViewportDiameter] = useState(() => resolveLoupeDiameter(currentViewport()));
  const loupe = useLoupeMotion();

  /**
   * One picture per session: the clone, its type, and where the source sits.
   *
   * A layout effect, not an effect, because the lens must be showing the prose on
   * its very first painted frame — an empty white disc for one frame at the start
   * of every gesture is exactly the artefact this component exists to not have.
   * Keyed on whether the loupe is open at all, so moving the finger cannot rebuild
   * the DOM under it (and cannot re-read the document's computed style per frame).
   */
  useLayoutEffect(() => {
    const host = mount.current;
    if (!host) return;
    host.replaceChildren();
    const element = sourceRef.current;
    if (!open || !element) {
      setPicture(null);
      return;
    }
    setPicture(buildPicture(element, host, frame.current));
  }, [open, sourceRef]);

  /**
   * Put the source's CURRENT box into the state the picture is translated by.
   *
   * Every commit while the lens is open, because the page can move the passage
   * without announcing it — `readPictureBox` in the picture module measures why that
   * is not a value this component may remember. An unchanged box returns the same
   * state object, so a gesture that is not moving the page still renders once per
   * frame and no more.
   */
  const measureSource = useCallback(() => {
    const box = readPictureBox(sourceRef.current);
    if (box) setPicture((previous) => (previous ? settlePicture(previous, box) : previous));
  }, [sourceRef]);

  // The commit that paints, while the lens is open: the box the picture is
  // translated by is the box the passage has on the frame the student sees.
  useLayoutEffect(() => {
    if (open) measureSource();
  });

  /**
   * And the moves the platform DOES announce.
   *
   * These are not redundant with the read above: they cover the frames where the
   * page moves and no commit follows — an edge auto-scroll while the finger is
   * held still, a pane being dragged by something else, a text-size change from
   * the exam's own controls.
   */
  useLayoutEffect(() => {
    if (!open) return;
    measureSource();
    window.addEventListener('scroll', measureSource, true);
    window.addEventListener('resize', measureSource);
    const viewport = window.visualViewport ?? null;
    viewport?.addEventListener('scroll', measureSource);
    viewport?.addEventListener('resize', measureSource);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measureSource);
    const element = sourceRef.current;
    if (element) observer?.observe(element);
    return () => {
      window.removeEventListener('scroll', measureSource, true);
      window.removeEventListener('resize', measureSource);
      viewport?.removeEventListener('scroll', measureSource);
      viewport?.removeEventListener('resize', measureSource);
      observer?.disconnect();
    };
  }, [open, measureSource, sourceRef]);

  // The lens size for the device the gesture is happening on, read when the loupe
  // opens and re-read if the viewport changes under it (rotation, a keyboard, a
  // browser chrome collapse) — never per frame.
  useEffect(() => {
    if (!open) return;
    const update = () => setViewportDiameter(resolveLoupeDiameter(currentViewport()));
    update();
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, [open]);

  if (!open) return null;

  const lens = diameter ?? viewportDiameter;
  const { left, top } = lensPlacement(point, lens, offset ?? lens / 2);
  const content = picture ? pictureTranslation(picture, point, lens, magnification) : null;

  const { initial, animate, transition, ...witness } = loupe;

  return (
    <div
      aria-hidden="true"
      data-selection-loupe="true"
      className="selection-v2 selection-v2-loupe"
      style={{
        width: lens,
        height: lens,
        transform: `translate3d(${left}px, ${top}px, 0)`,
        pointerEvents: 'none',
      }}
    >
      <motion.div
        ref={frame}
        data-selection-loupe-frame="true"
        className="selection-v2-loupe-frame"
        style={{ backgroundColor: picture?.backdrop ?? '#fff' }}
        initial={initial}
        animate={animate}
        transition={transition}
        {...witness}
      >
        <div
          ref={mount}
          data-selection-loupe-content="true"
          className="selection-v2-loupe-content"
          style={{
            width: picture ? picture.width : 0,
            transform: `translate3d(${content?.left ?? 0}px, ${content?.top ?? 0}px, 0) scale(${magnification})`,
            pointerEvents: 'none',
          }}
        />
        {/* The column the finger is on, unscaled and never part of the picture. */}
        <span aria-hidden="true" data-selection-loupe-marker="true" className="selection-v2-loupe-marker" />
      </motion.div>
    </div>
  );
}
