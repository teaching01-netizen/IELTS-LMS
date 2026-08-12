# Student adaptive layout contract

This module owns presentation environment facts only. It must not read or mutate
answers, timer state, flags, submission state, or persistence state.

## Policy

- `compact`: fewer than 700 effective CSS pixels.
- `medium`: 700 through 1199 effective CSS pixels.
- `wide`: 1200 pixels or wider.
- `primaryPointer`, `hasTouch`, `hasHover`, and `orientation` are independent facts.

## Invariants

1. A viewport resize or orientation change may change presentation, but never owns or
   reinterprets an answer control's value.
2. Compact presentation must keep the timer visible and expose every enabled tool
   without horizontal toolbar scrolling.
3. Primary exam actions use a 44px minimum hit area and target 48px where space allows.
4. The shell owns safe-area clearance and the primary scroll boundary; child panels may
   own their deliberate content scroll regions.
5. Next/previous navigation is separate from submit and cannot submit at the boundary.
