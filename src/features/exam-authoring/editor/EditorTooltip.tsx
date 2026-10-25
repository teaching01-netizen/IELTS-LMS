import { cloneElement, useEffect, type ReactElement } from "react";

/**
 * Desktop hover label for icon-only controls.
 *
 * Delayed so the chrome never feels nervous, and self-sufficient: a control can
 * be dropped anywhere in the editor without a provider above it.
 *
 * ONE label for the whole page. An open question mounts seven editors and about
 * a hundred icon controls; a tooltip tree per control (root, popper, anchor,
 * portal, presence) was most of the React work of opening a question. Here a
 * control only carries its words as attributes, and a single delegated layer —
 * installed while any control is mounted — answers hover and focus for all of
 * them.
 *
 * The label is additive by design. Every control already carries an
 * `aria-label`, so the accessible name never depends on a tooltip — and touch,
 * where nothing hovers, still has the words somewhere (see the object controls,
 * which are labelled rather than icon-only).
 */
export function EditorTooltip({
  label,
  shortcut,
  children,
}: {
  label: string;
  shortcut?: string | undefined;
  children: ReactElement<Record<string, unknown>>;
}) {
  useEffect(retainTooltipLayer, []);
  return cloneElement(children, {
    "data-editor-tooltip": label,
    "data-editor-tooltip-shortcut": shortcut,
  });
}

const OPEN_DELAY_MS = 600;
/** Moving straight from one labelled control to the next answers at once. */
const SKIP_DELAY_MS = 300;
const SIDE_OFFSET = 6;
const COLLISION_PADDING = 8;
const TOOLTIP_ID = "sat-editor-tooltip";
const TRIGGER_SELECTOR = "[data-editor-tooltip]";

let mounted = 0;
let surface: HTMLDivElement | null = null;
let hovered: HTMLElement | null = null;
let shownFor: HTMLElement | null = null;
let openTimer: ReturnType<typeof setTimeout> | undefined;
let lastHiddenAt = -Infinity;
let pointerDown = false;

function retainTooltipLayer() {
  if (mounted++ === 0) install();
  return () => {
    // A control's DOM is already gone when its effect cleans up, so this is
    // the moment to drop a label whose trigger was just unmounted.
    if (shownFor && !shownFor.isConnected) hide();
    if (--mounted === 0) uninstall();
  };
}

function triggerOf(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>(TRIGGER_SELECTOR) : null;
}

function onPointerMove(event: PointerEvent) {
  if (event.pointerType === "touch") return;
  const trigger = triggerOf(event.target);
  if (trigger === hovered) return;
  hovered = trigger;
  clearTimeout(openTimer);
  if (!trigger) {
    if (shownFor && shownFor !== document.activeElement) hide();
    return;
  }
  if (shownFor || performance.now() - lastHiddenAt < SKIP_DELAY_MS) {
    show(trigger);
    return;
  }
  openTimer = setTimeout(() => {
    if (hovered === trigger && trigger.isConnected) show(trigger);
  }, OPEN_DELAY_MS);
}

function onPointerOut(event: PointerEvent) {
  if (!hovered || (event.relatedTarget instanceof Node && hovered.contains(event.relatedTarget))) return;
  hovered = null;
  clearTimeout(openTimer);
  if (shownFor && shownFor !== document.activeElement) hide();
}

function onFocusIn(event: FocusEvent) {
  const trigger = triggerOf(event.target);
  // A click that moves focus is a pointer gesture, not a keyboard author asking.
  if (trigger && !pointerDown) show(trigger);
}

function onFocusOut(event: FocusEvent) {
  if (shownFor && event.target === shownFor && hovered !== shownFor) hide();
}

function onPointerDown() {
  pointerDown = true;
  clearTimeout(openTimer);
  hide();
}

function onPointerUp() {
  pointerDown = false;
}

function onKeyDown(event: KeyboardEvent) {
  if (event.key === "Escape" && shownFor) hide();
}

function hideOnViewportChange() {
  hide();
}

function install() {
  document.addEventListener("pointermove", onPointerMove, { passive: true });
  document.addEventListener("pointerout", onPointerOut, { passive: true });
  document.addEventListener("pointerdown", onPointerDown, { capture: true, passive: true });
  document.addEventListener("pointerup", onPointerUp, { capture: true, passive: true });
  document.addEventListener("focusin", onFocusIn);
  document.addEventListener("focusout", onFocusOut);
  document.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("scroll", hideOnViewportChange, { capture: true, passive: true });
  window.addEventListener("resize", hideOnViewportChange, { passive: true });
}

function uninstall() {
  hide();
  document.removeEventListener("pointermove", onPointerMove);
  document.removeEventListener("pointerout", onPointerOut);
  document.removeEventListener("pointerdown", onPointerDown, true);
  document.removeEventListener("pointerup", onPointerUp, true);
  document.removeEventListener("focusin", onFocusIn);
  document.removeEventListener("focusout", onFocusOut);
  document.removeEventListener("keydown", onKeyDown, true);
  window.removeEventListener("scroll", hideOnViewportChange, true);
  window.removeEventListener("resize", hideOnViewportChange);
  surface?.remove();
  surface = null;
  hovered = null;
  pointerDown = false;
}

function ensureSurface(): HTMLDivElement {
  if (surface?.isConnected) return surface;
  surface = document.createElement("div");
  surface.id = TOOLTIP_ID;
  surface.setAttribute("role", "tooltip");
  surface.className = "sat-tooltip sat-product";
  surface.style.position = "fixed";
  surface.style.top = "0";
  surface.style.left = "0";
  surface.hidden = true;
  document.body.appendChild(surface);
  return surface;
}

function show(trigger: HTMLElement) {
  clearTimeout(openTimer);
  const label = trigger.dataset["editorTooltip"];
  if (!label) return;
  if (shownFor && shownFor !== trigger) detach(shownFor);
  const node = ensureSurface();
  const shortcut = trigger.dataset["editorTooltipShortcut"];
  const labelNode = document.createElement("span");
  labelNode.textContent = label;
  if (shortcut) {
    const shortcutNode = document.createElement("span");
    shortcutNode.className = "sat-tooltip__shortcut";
    shortcutNode.textContent = shortcut;
    node.replaceChildren(labelNode, " ", shortcutNode);
  } else {
    node.replaceChildren(labelNode);
  }
  // Leaving `hidden` plays the entrance; gliding between controls does not replay it.
  node.hidden = false;
  place(node, trigger);
  if (shownFor !== trigger) {
    const describedBy = trigger.getAttribute("aria-describedby");
    trigger.setAttribute("aria-describedby", describedBy ? `${describedBy} ${TOOLTIP_ID}` : TOOLTIP_ID);
  }
  shownFor = trigger;
}

/** Below the control, flipped above when it would leave the viewport, kept inside the side padding. */
function place(node: HTMLDivElement, trigger: HTMLElement) {
  const anchor = trigger.getBoundingClientRect();
  const width = node.offsetWidth;
  const height = node.offsetHeight;
  const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
  const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
  let top = anchor.bottom + SIDE_OFFSET;
  if (top + height > viewportHeight - COLLISION_PADDING && anchor.top - SIDE_OFFSET - height >= COLLISION_PADDING) {
    top = anchor.top - SIDE_OFFSET - height;
  }
  const centered = anchor.left + anchor.width / 2 - width / 2;
  const left = Math.max(COLLISION_PADDING, Math.min(centered, viewportWidth - COLLISION_PADDING - width));
  node.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
}

function detach(trigger: HTMLElement) {
  const rest = (trigger.getAttribute("aria-describedby") ?? "")
    .split(/\s+/)
    .filter((id) => id && id !== TOOLTIP_ID);
  if (rest.length) trigger.setAttribute("aria-describedby", rest.join(" "));
  else trigger.removeAttribute("aria-describedby");
}

function hide() {
  if (!shownFor) return;
  detach(shownFor);
  shownFor = null;
  lastHiddenAt = performance.now();
  if (surface) surface.hidden = true;
}
