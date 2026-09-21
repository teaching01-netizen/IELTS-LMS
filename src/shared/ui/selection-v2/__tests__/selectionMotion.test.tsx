import React from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { authoringMotion, selectionMotion } from '@shared/motion';
import { SelectionHandle } from '../react/SelectionHandle';
import { SelectionLoupe } from '../react/SelectionLoupe';
import { resolveGripMotion, resolveLoupeMotion } from '../react/useSelectionMotion';

/**
 * The overlay's motion, and its two non-negotiables.
 *
 * 1. ONE VOCABULARY. The numbers are the shared springs in `@shared/motion`, not
 *    values invented per component; a test asserts the identity rather than a
 *    copy of the numbers, so a component that starts carrying its own spring
 *    fails here instead of drifting quietly. The magnifier is the one moment that
 *    is deliberately NOT a spring: a transient lens on a 120ms tween, which the
 *    second test below pins as a duration rather than a feel.
 * 2. THE MEASURED BOXES NEVER MOVE. Whatever animates does so strictly inside the
 *    handle's 44px target and the loupe's lens: those two boxes are where the
 *    engine's measurements and a student's aim live, so they carry exact inline
 *    transforms and no motion at all.
 *
 * Reduced motion is a pure function of the platform's answer, asserted here for
 * both answers; that the browser's answer REACHES it is asserted in the touch
 * spec, under a real `emulateMedia` — motion reads the preference once per
 * document, so jsdom cannot vary it and a real browser can.
 */

describe('the overlay motion policy', () => {
  it('takes its springs from the shared vocabulary instead of inventing them', () => {
    expect(selectionMotion.grip).toBe(authoringMotion.snap);
  });

  it('opens the magnifier on a tween inside the entrance budget, never a spring', () => {
    // A spring's settle time is whatever its stiffness says (~280ms for the
    // default UI spring); the lens is dismissed as "modal arriving" at that
    // length, so it is a duration, and the duration is bounded.
    expect(selectionMotion.loupe).toMatchObject({ ease: [0.22, 1, 0.36, 1] });
    expect(selectionMotion.loupe).not.toHaveProperty('type');
    const duration = (selectionMotion.loupe as { duration: number }).duration;
    expect(duration).toBeGreaterThan(0);
    expect(duration).toBeLessThanOrEqual(0.15);
  });

  it('starts a grip small and fades it in, then springs back from a held endpoint', () => {
    expect(resolveGripMotion(false, false)).toMatchObject({
      initial: { scale: selectionMotion.gripEnterScale, opacity: 0 },
      animate: { scale: 1, opacity: 1 },
      'data-selection-motion': 'full',
      transition: { type: 'spring', stiffness: 640, damping: 50 },
    });

    // While this endpoint is the one being dragged, the grip swells — and it is
    // the release from that state that settles. Nothing here moves a position.
    expect(resolveGripMotion(true, false)).toMatchObject({
      animate: { scale: selectionMotion.gripHeldScale, opacity: 1 },
    });
  });

  it('scales the magnifier in, and settles it at its full size', () => {
    expect(resolveLoupeMotion(false)).toMatchObject({
      initial: { scale: selectionMotion.loupeEnterScale, opacity: 0 },
      animate: { scale: 1, opacity: 1 },
      'data-selection-motion': 'full',
      transition: { duration: 0.12 },
    });
    // A presence, not a pop: the target is what it settles at and it gives up no
    // more than a few percent of its size to get there.
    expect(selectionMotion.loupeEnterScale).toBeGreaterThan(0.9);
  });

  it('resolves reduced motion into the targets, so nothing starts half-size or hidden', () => {
    // `initial: false` is motion's "start at the animate values": the platform
    // asked for less motion, so there is no entrance to skip past a first frame.
    expect(resolveGripMotion(false, true)).toMatchObject({
      initial: false,
      animate: { scale: 1, opacity: 1 },
      'data-selection-motion': 'reduced',
    });
    expect(resolveLoupeMotion(true)).toMatchObject({
      initial: false,
      animate: { scale: 1, opacity: 1 },
      'data-selection-motion': 'reduced',
    });

    // And an endpoint under the finger is not enlarged either: no scale state is
    // left that would have to animate its way back.
    expect(resolveGripMotion(true, true)).toMatchObject({ animate: { scale: 1, opacity: 1 } });
  });
});

describe('what the overlay animates, and what it must not', () => {
  const handle = { edge: 'end', x: 120, y: 240, direction: 'ltr', stem: 'down' } as const;

  it('keeps the handle target exactly where the engine measured it', () => {
    render(<SelectionHandle handle={handle} label="Adjust selection end" onPointerDown={() => {}} />);

    // The thing a finger aims at: the measurement, written straight through.
    const target = document.querySelector('[data-student-selection-handle="end"]') as HTMLElement;
    expect(target).toHaveStyle({ transform: 'translate3d(120px, 240px, 0) translate(-50%, -50%)' });
    // The animation lives inside it, on the dot.
    const grip = target.querySelector('.selection-v2-grip') as HTMLElement;
    expect(grip).toHaveAttribute('data-selection-motion', 'full');
    expect(grip.style.transform).toContain(String(selectionMotion.gripEnterScale));
  });

  it('leaves the magnifier lens at its measured box, animating only the frame inside', () => {
    const source = document.createElement('div');
    source.textContent = 'alpha beta';
    document.body.append(source);
    render(<SelectionLoupe open point={{ x: 100, y: 300 }} sourceRef={{ current: source }} diameter={120} offset={60} />);

    const lens = document.querySelector('[data-selection-loupe]') as HTMLElement;
    expect(lens).toHaveStyle({ transform: 'translate3d(40px, 180px, 0)' });
    // The picture's own magnification is a fact, not an animation.
    expect(document.querySelector('[data-selection-loupe-content]')).toHaveStyle({
      transform: 'translate3d(-90px, -390px, 0) scale(1.5)',
    });
    const frame = document.querySelector('[data-selection-loupe-frame]') as HTMLElement;
    expect(frame).toHaveAttribute('data-selection-motion', 'full');
    expect(frame.style.transform).toContain(String(selectionMotion.loupeEnterScale));
  });

});
