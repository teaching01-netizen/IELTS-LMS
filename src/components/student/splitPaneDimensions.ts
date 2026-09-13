export const STUDENT_TABLET_SPLIT_DIVIDER_WIDTH_PX = 8;
export const STUDENT_TABLET_SPLIT_HIT_TARGET_WIDTH_PX = 32;
export const STUDENT_DESKTOP_SPLIT_DIVIDER_WIDTH_PX = 16;

// P2.4 interaction model ("a physical seam between two panes, not a control").
// The visible line stays hairline-thin; the INTERACTIVE area is deliberately
// much wider so a student never has to aim at a pixel. All values are CSS px.

/**
 * Pointer hit target around the desktop splitter. The rail keeps its layout
 * width (10px) and an invisible overlay extends the grabbable area to this.
 */
export const STUDENT_SPLIT_POINTER_HIT_TARGET_WIDTH_PX = 24;
/** Touch hit target around the splitter (Apple HIG 44pt minimum). */
export const STUDENT_SPLIT_TOUCH_HIT_TARGET_WIDTH_PX = 48;
/** Pointer travel before PRESSED becomes DRAGGING. */
export const STUDENT_SPLIT_DRAG_START_THRESHOLD_PX = 3;
/**
 * Touch is ambiguous: there is no hover, the finger is imprecise, and the
 * panes scroll vertically all day. Nothing resizes until the pointer has
 * travelled this far, and the dominant axis at that moment decides the
 * gesture: mostly horizontal engages the splitter, mostly vertical belongs
 * to scrolling. Once engaged the gesture stays locked to the splitter until
 * release, so it never feels slippery mid-drag.
 */
export const STUDENT_SPLIT_TOUCH_INTENT_THRESHOLD_PX = 8;
/** Stationary hover before the one-time "Drag to resize" hint appears. */
export const STUDENT_SPLIT_HINT_DELAY_MS = 700;
/** Short settle animation when the split returns to the recommended layout. */
export const STUDENT_SPLIT_RESET_DURATION_MS = 200;
/**
 * Magnetic settle around the recommended split, in percent of the workspace.
 * Applied when a gesture ends, so it never fights the pointer mid-drag.
 */
export const STUDENT_SPLIT_SNAP_THRESHOLD_PERCENT = 1.5;
/** Keyboard nudge per arrow press (Shift uses the large step). */
export const STUDENT_SPLIT_KEYBOARD_STEP_PX = 12;
export const STUDENT_SPLIT_KEYBOARD_LARGE_STEP_PX = 32;
