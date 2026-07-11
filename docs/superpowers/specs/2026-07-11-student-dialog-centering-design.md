# Student Dialog Centering Design

## Problem

Native dialogs in the student exam render against the viewport edge because Tailwind preflight resets element margins to zero. The shared dialog base styles restore sizing and backdrop behavior but do not restore the browser's automatic dialog margins.

## Ownership and scope

The shared native-dialog CSS contract is owned by `src/index.css`. Its student consumers are Question Navigator, Accessibility Settings, and Time Extension. Custom exam overlays already center themselves with fixed flex layouts and remain unchanged.

## Design

Restore `margin: auto` on open native dialogs in the shared base rule. Preserve native `showModal()` top-layer behavior, focus handling, backdrop, maximum viewport dimensions, content scrolling, and every exam-runtime interaction.

## Verification

Add a focused CSS regression test that reads the owning stylesheet and asserts that the open-dialog rule restores automatic margins. Run the relevant student component tests, typecheck, and build. Where the local browser fixture is available, verify dialog geometry at tablet viewport dimensions.

