/**
 * The magnifier's picture: the document's own layout, cloned, sanitised, laid out
 * at the document's own width and in the document's own type, and mapped so that
 * a document coordinate means the same thing inside the lens as it does in the
 * page.
 *
 * The lens shows a CLONE OF RENDERED DOM, not a screenshot: no canvas, no
 * `html2canvas`, no image pipeline to keep in sync with live edits (a highlight
 * applied mid-gesture, a re-rendered paragraph, a live region updating). The clone
 * is taken once per loupe session — never per pointermove — and only the transform
 * of the clone moves afterwards, so following the finger costs one transform write
 * per frame.
 *
 * This module owns the picture; `SelectionLoupe` owns WHEN it is built, measured
 * and painted. The split is what makes the lens's central claim assertable: the
 * one thing it exists to get right is a function from numbers to numbers
 * (`pictureTranslation`), not arithmetic written out inside a render body.
 *
 * THE PICTURE IS THE DOCUMENT'S OWN LAYOUT, MAGNIFIED, AND THAT IS THE WHOLE
 * CONTRACT. A document coordinate has to mean the same thing inside the lens as it
 * does in the page, or the camera is pointed at nothing: the clone is therefore
 * laid out at the SOURCE'S OWN WIDTH, in the SOURCE'S OWN TYPE (both mirrored from
 * the document in `PICTURE_STYLE_PROPERTIES`, because the clone is mounted in a
 * layer at `document.body` and would otherwise inherit the layer's font).
 * Everything followed from getting this wrong once: a clone that lays itself out
 * to the width of the lens wraps its paragraph into the lens's own column, and then
 * the finger-relative transform — hundreds of pixels — slides the whole picture
 * clean out of a 128px circle. The lens still measured, positioned, cloned and
 * smelt correct, and showed the student a blank white disc with their own
 * highlighted text sitting in the page behind it.
 *
 * THE CLONE IS A PICTURE, NOT A SECOND PAGE. Cloning rendered DOM copies more than
 * appearance: it copies the attributes the application ADDRESSES text by. A clone
 * of the SAT prose carries `data-sat-annotation-region`,
 * `data-student-highlightable` and `data-student-owned-touch-selection` with it,
 * and for as long as the magnifier is open the document contains two of each — two
 * SAT regions, two selectable surfaces, two answers to `querySelector` for code
 * that asks where the prose is. That is not a cosmetic problem: it breaks the
 * engine's own invariant of ONE active selection and ONE addressable surface, and
 * it made an e2e locator for the SAT region resolve to two elements mid-gesture.
 * So the clone is sanitised out of every namespace that identifies or describes it,
 * and made unreachable for pointer, focus and assistive technology.
 *
 * WHERE THE PICTURE BEGINS is a collapsed margin rather than the layer's origin,
 * so it is measured from the browser instead of derived — and explained in exactly
 * one place, `pictureOrigin`.
 */

/** The source's border box in viewport coordinates, in the current frame. */
export interface PictureBox {
  left: number;
  top: number;
  /** Untransformed source width in logical CSS pixels. */
  width: number;
  /** Ancestor scale between source CSS pixels and viewport coordinates. */
  visualScale: number;
}

/** The clone's own border box, measured from the LENS'S box, in unmagnified units. */
export interface PictureOrigin {
  x: number;
  y: number;
}

export interface LoupePicture extends PictureBox {
  /** What the picture sits on: the page's own opaque backdrop behind the prose. */
  backdrop: string;
  /** Where the picture's own border box begins inside the lens's box. */
  origin: PictureOrigin;
}

/**
 * The properties the picture is laid out with, copied from the document.
 *
 * Two jobs, and the first one is correctness rather than looks: LINE BREAKING.
 * The clone is a second layout of the same prose, and the lens maps a document
 * coordinate into it, so a clone that breaks its lines somewhere else shows the
 * wrong words under the finger. Type and line breaking have to come from the
 * passage; the rest is what makes the magnified text read as the same ink.
 */
export const PICTURE_STYLE_PROPERTIES = [
  // Type, and therefore where the lines break.
  'font-family', 'font-size', 'font-weight', 'font-style', 'font-variant', 'font-stretch',
  'line-height', 'letter-spacing', 'word-spacing', 'text-rendering',
  // Line breaking and direction.
  'text-align', 'text-indent', 'text-transform', 'direction', 'unicode-bidi',
  'white-space', 'word-break', 'overflow-wrap', 'hyphens', 'tab-size',
  // The box the text sits in, and its ink.
  'color', 'background-color',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'list-style-type',
] as const;

/**
 * Drop one attribute from the picture. Everything the application ADDRESSES or
 * DESCRIBES by goes; class and style stay, because they are the rendering.
 */
export function sanitizePictureAttribute(element: HTMLElement, name: string, isRoot: boolean): void {
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

/**
 * Whether a computed color paints anything at all.
 *
 * `rgba(0, 0, 0, 0)` is the common "no background declared" answer and must not be
 * used as the lens's backdrop — a see-through lens would show the student the
 * un-magnified page through the magnified one.
 */
function isOpaqueInk(value: string): boolean {
  if (!value || value === 'transparent') return false;
  const match = /^rgba?\(([^)]+)\)$/.exec(value);
  const channels = match?.[1];
  if (channels === undefined) return true;
  const parts = channels.split(/[,/]/).map((part) => part.trim());
  const alphaChannel = parts[3];
  if (alphaChannel === undefined) return true;
  const alpha = Number(alphaChannel.replace('%', ''));
  return !Number.isFinite(alpha) || alpha >= 1;
}

/**
 * The first opaque color at or above the source.
 *
 * The prose usually declares no background of its own — the page, the card or the
 * pane behind it does — so the lens's backdrop is a walk up the document rather
 * than one read, bounded so a pathological tree cannot make this expensive.
 */
export function pictureBackdrop(element: HTMLElement): string {
  if (typeof getComputedStyle !== 'function') return '#fff';
  let node: Element | null = element;
  for (let depth = 0; node && depth < 8; depth += 1, node = node.parentElement) {
    const value = getComputedStyle(node).backgroundColor;
    if (isOpaqueInk(value)) return value;
  }
  return '#fff';
}

/**
 * Where the clone's own border box sits inside its parent, borrowed from a parent
 * that is guaranteed to have a layout.
 *
 * The reading the lens wants is `offsetLeft`/`offsetTop` in the layer the picture
 * is really laid out in. That reading is only available when the page has laid
 * that layer out, and this runs in the commit that first paints it — and a popover
 * that has not been opened yet is `display: none`, where a box with no layout
 * answers 0 to every geometry question. 0 is also the honest answer for a passage
 * that begins with a margin-free block, so the two are indistinguishable, and the
 * lens would be pointed 8 document pixels off in exactly the case this exists for.
 * Hence a probe: invisible but LAID OUT (hence `visibility`, never `display`),
 * fixed at the page's origin, and — like the layer the picture ends up in — a
 * formatting context root, so the same leading margin is trapped in the same place
 * in both. The clone is moved back to its host either way: one clone, and nothing
 * left on the page.
 */
function measureLeadingMargin(host: HTMLElement, copy: HTMLElement, width: number): PictureOrigin {
  const doc = host.ownerDocument;
  if (!doc?.body) return { x: 0, y: 0 };
  const probe = doc.createElement('div');
  probe.setAttribute('aria-hidden', 'true');
  probe.style.cssText = 'position: fixed; top: 0; left: 0; visibility: hidden; pointer-events: none; display: flow-root;';
  // The document's own width, so the clone wraps exactly as the picture will.
  probe.style.width = `${width}px`;
  doc.body.append(probe);
  probe.append(copy);
  const margin = { x: copy.offsetLeft, y: copy.offsetTop };
  host.append(copy);
  probe.remove();
  return margin;
}

/**
 * Where the picture's own border box begins inside the lens's box, in unmagnified
 * units: the single home of the one correction the lens cannot derive.
 *
 * THE PICTURE'S BOX IS THE SOURCE'S BOX — the clone is laid out at the source's
 * width, in the source's type, and its leading margin collapses out of it exactly
 * as the source's does — but its ORIGIN is not the origin of the layer the
 * transform is written on. The clone's first block carries a top margin, that
 * margin collapses out of the clone, and the layer it lands in is absolutely
 * positioned, so it cannot collapse out of that either. It therefore sits above
 * the picture, inside the layer, and pushes the clone down by its own height — 8px
 * of a typical passage's paragraph spacing, in a lens that magnifies everything by
 * 1.5. The picture's box was still exactly the source's box, which is what made
 * this invisible: every measurement that looked at the box agreed, while the words
 * under the finger sat 12 screen pixels from the column the lens indexes.
 *
 * That displacement is one collapsed MARGIN, so it is a property of the clone's own
 * subtree and not of anything around it, and it is measured rather than derived:
 * which margins collapse through a box depends on wrappers, padding, marks and
 * lists, and the browser is the only thing that knows. Read in the lens itself
 * whenever the lens has been laid out, and otherwise borrowed from a probe that is
 * guaranteed to have been — see `measureLeadingMargin` for why the two are the same
 * number, and for why 0 cannot be told from "not laid out yet".
 *
 * The frame's hairline is the rest of it, and comes from the frame's computed
 * style rather than from `clientTop`, for the same reason: the layer that holds the
 * lens is a popover, and this runs in the commit that first paints it, while a
 * popover that has not been opened yet is `display: none` — an element with no
 * layout at all, which answers 0 to `clientTop` and to every other geometry
 * question about it.
 */
export function pictureOrigin(
  host: HTMLElement,
  copy: HTMLElement,
  frame: HTMLElement | null,
  width: number,
  visualScale = 1,
): PictureOrigin {
  // The lens's own answer whenever it has one to give. It does not in the commit
  // that first paints the layer — a popover that has not been opened has no box at
  // all, and `offsetParent` is how the platform says so — and then the same reading
  // is borrowed from a probe rather than taken as 0.
  const displacement = host.offsetParent
    ? { x: copy.offsetLeft, y: copy.offsetTop }
    : measureLeadingMargin(host, copy, width);
  const hairline = frame ? getComputedStyle(frame) : null;
  return {
    x: (Number.parseFloat(hairline?.borderLeftWidth ?? '') || 0) / visualScale + displacement.x,
    y: (Number.parseFloat(hairline?.borderTopWidth ?? '') || 0) / visualScale + displacement.y,
  };
}

/** The clone's own subtree, sanitised and stamped, before it is laid out. */
function dressPicture(copy: HTMLElement): void {
  for (const node of [copy, ...Array.from(copy.querySelectorAll<HTMLElement>('*'))]) {
    for (const name of node.getAttributeNames()) sanitizePictureAttribute(node, name, node === copy);
    // Belt and braces beside `inert`: some engines expose the attribute before
    // they honour it, and a magnified copy of a button must never be a tab stop
    // even then.
    if (node.matches('button, a, input, textarea, select, [tabindex]')) node.setAttribute('tabindex', '-1');
  }
  // The loupe's own markers are stamped AFTER sanitising, so they are the only
  // attributes on the picture that belong to anybody.
  copy.setAttribute('inert', '');
  copy.setAttribute('aria-hidden', 'true');
  copy.setAttribute('data-selection-loupe-source', 'true');
}

/**
 * Clone the source into the lens and report the box the picture is translated by.
 *
 * One picture per session: the clone, its type, and where the source sits. The
 * caller mounts its host first, so this is synchronous work on the commit that
 * paints.
 */
export function buildPicture(
  source: HTMLElement,
  host: HTMLElement,
  frame: HTMLElement | null,
  visualScale = 1,
): LoupePicture {
  const copy = source.cloneNode(true) as HTMLElement;
  dressPicture(copy);

  // The document's own type and box, so this second layout of the prose breaks its
  // lines where the first one did. What is NOT copied is any height: the clone's
  // height has to be the height its own content produces, or the picture and the
  // page disagree about where the last line ends.
  if (typeof getComputedStyle === 'function') {
    const computed = getComputedStyle(source);
    for (const property of PICTURE_STYLE_PROPERTIES) {
      const value = computed.getPropertyValue(property);
      if (value) copy.style.setProperty(property, value);
    }
  }
  // The picture's border box IS the source's border box, so the two coordinate
  // systems are the same one. Border-box is set rather than mirrored: the host is
  // as wide as the source's border box, and this makes padding and borders eat into
  // that width instead of adding to it.
  const safeScale = Number.isFinite(visualScale) && visualScale > 0 ? visualScale : 1;
  const renderedSourceBox = source.getBoundingClientRect();
  const sourceWidth = source.offsetWidth > 0 ? source.offsetWidth : renderedSourceBox.width / safeScale;
  host.style.width = `${sourceWidth}px`;
  copy.style.boxSizing = 'border-box';
  copy.style.margin = '0';
  copy.style.width = '100%';
  copy.style.maxWidth = 'none';
  host.append(copy);

  return {
    left: renderedSourceBox.left,
    top: renderedSourceBox.top,
    width: sourceWidth,
    visualScale: safeScale,
    backdrop: pictureBackdrop(source),
    // Where the picture's own border box begins, measured from the LENS'S box,
    // which is the box the finger is mapped onto. See `pictureOrigin`.
    origin: pictureOrigin(host, copy, frame, sourceWidth, safeScale),
  };
}

/**
 * The source's CURRENT box, or null when the document cannot be measured at all.
 *
 * Read from live layout, and read on the commit that paints, because the page can
 * move the passage without announcing it: a banner appearing above it, a panel
 * collapsing, a font swap changing an earlier paragraph's height. That is a pure
 * translation — no scroll, and no change to the passage's own size, so a
 * `ResizeObserver` on the source (which watches exactly its size) never fires and
 * neither does anything else. Measured: a 56px shift of the passage left the
 * picture translated for where the passage used to be, 84.5px of error that no
 * later frame corrected and only a scroll event cleared. What that looks like is
 * the whole defect this component exists to prevent: the words under the tick a
 * line away from the words under the finger.
 *
 * The cost is one `getBoundingClientRect()` per painted frame, in a frame whose
 * layout the engine has already read (it resolves the caret and measures the range
 * there), and the transform this feeds is composited, so the read forces no reflow
 * of its own.
 */
export function readPictureBox(source: HTMLElement | null, visualScale = 1): PictureBox | null {
  if (!source || typeof source.getBoundingClientRect !== 'function') return null;
  const safeScale = Number.isFinite(visualScale) && visualScale > 0 ? visualScale : 1;
  const box = source.getBoundingClientRect();
  const width = source.offsetWidth > 0 ? source.offsetWidth : box.width / safeScale;
  return { left: box.left, top: box.top, width, visualScale: safeScale };
}

/**
 * The next picture for a frame's box read: the SAME object when the prose did not
 * move, so a frame that changed nothing cannot re-render the lens.
 */
export function settlePicture(picture: LoupePicture, box: PictureBox): LoupePicture {
  const settled =
    Math.abs(picture.left - box.left) < 0.5 &&
    Math.abs(picture.top - box.top) < 0.5 &&
    Math.abs(picture.width - box.width) < 0.5 &&
    picture.visualScale === box.visualScale;
  return settled ? picture : { ...picture, ...box };
}

/**
 * THE MAPPING. The point the lens is LOOKING AT — the caret the engine
 * resolved, snapped to a character boundary — moved to the centre of the lens:
 * the picture is the document's layout, and this is the one place the two
 * coordinate systems are reconciled.
 *
 * It is deliberately not the finger. The lens's own box already follows the
 * finger (see `lensPlacement`), and a lens whose content followed it too would
 * be an instrument with no index: everything it showed would slide continuously
 * with the hand, including the whitespace between two characters. Pointing the
 * content at the resolved caret is what makes the words inside hold still while
 * the finger moves within one glyph and SNAP when it crosses into the next.
 *
 * The picture's measured origin is part of the distance, because the layer the
 * transform is written on is not where the picture begins. Both terms are needed
 * and neither may be skipped: drop the origin and the lens is a line off, drop the
 * box and it is a gesture off.
 */
export function pictureTranslation(
  picture: LoupePicture,
  point: { x: number; y: number },
  lens: number,
  magnification: number,
): { left: number; top: number } {
  return {
    left: lens / 2 - magnification * (picture.visualScale * picture.origin.x + point.x - picture.left),
    top: lens / 2 - magnification * (picture.visualScale * picture.origin.y + point.y - picture.top),
  };
}

/**
 * The lens's own positioning box: centred under the finger, lifted above it so the
 * lens is not sitting under the hand that is holding it.
 *
 * The instrument follows the hand; what it SHOWS does not (see
 * `pictureTranslation`). Two positions, two jobs.
 */
export function lensPlacement(
  finger: { x: number; y: number },
  lens: number,
  lift: number,
): { left: number; top: number } {
  return { left: finger.x - lens / 2, top: finger.y - lift - lens / 2 };
}
