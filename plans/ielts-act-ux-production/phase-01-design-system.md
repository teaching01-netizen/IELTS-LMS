# Phase 1 — Typography and interaction foundation

Status: planned. Depends on: [Phase 0](phase-00-baseline.md). Next: [Phase 2](phase-02-adaptive-workspace.md).

## Result

One student typography/color/spacing/state system used by IELTS and ACT, with stable text metrics and restrained feedback. The design values are defined in [design-contract.md](design-contract.md); this guide specifies the code changes.

## File ownership

- `src/components/student/accessibilityScale.ts`, `accessibilityPreferences.ts`, `providers/StudentUIProvider.tsx`, `StudentApp.tsx`.
- `src/index.css`; proposed `src/components/student/styles/exam.css` only if extracting existing rules reduces conflicting ownership.
- Presentation class consumers: `StudentHeader.tsx`, `StudentFooter.tsx`, `QuestionNavigator.tsx`, `StudentMaterialWithQuestionPane.tsx`, `StudentWritingPanes.tsx`, and compact header/tools/navigation.
- Existing tests under `src/components/student/__tests__/` for typography, preferences, motion, highlighter selection, and timer announcements.

## Ordered tasks

### P1.1 — Introduce semantic text roles without changing preference storage

1. Keep the public Small/Normal/Large preference values and validation. Replace each role's `vw`-dependent value with a rem-based value from a discrete table.
2. Add explicit answer-label, writing-editor, and writing-prompt roles. Keep passage/question/control/meta roles separate. Use the existing scale-to-CSS-variable mapping in `StudentApp`; do not create a second React provider.
3. Wire every rendered role to its variable, including Writing and inline completion controls. Remove local responsive `text-base md:text-lg` rules that override those role sizes.
4. Treat explicit application zoom separately from font size. Trace the current tablet zoom multiplication first; avoid applying the same user scale twice through CSS zoom and font-size variables.
5. Preserve existing reading-comfort settings, but make the normal measure/line-height agree with the design contract. Do not overwrite a saved user preference merely to apply new defaults.

Done when: changing pane/window size changes wrapping and available space, not the chosen content font size; explicit text-size controls remain effective.

### P1.2 — Scope colors, geometry, and font loading

1. Put the system font on the student shell, overriding inherited remote-font dependence. Keep the staff/SAT font setup unchanged.
2. Consolidate surface, primary/secondary text, control border, selected, warning, focus, and highlight colors. Separate subtle decorative separators from the stronger edges needed to identify controls.
3. Define spacing, control radius, hit target, and overlay elevation in one place. Preserve existing high-contrast selectors and forced-colors behavior when extracting CSS.
4. Import the stylesheet through the common student entry. Remove moved declarations from `src/index.css` in the same commit. Do not append a second override layer as a permanent workaround.
5. Keep authored emphasis, paragraph markers, images, tables, and mathematical formatting intact. No universal descendant font-size reset.

### P1.3 — Implement one complete control-state recipe

| State | Implementation rule |
| --- | --- |
| Rest | Constant border width, no shadow for ordinary controls |
| Hover | Subtle color/border change; only when hover is available |
| Pressed | Immediate fill change; no scaling or vertical movement |
| Focus-visible | Distinct visible outline/ring, independent from selection |
| Selected | Persistent mark/fill plus native/ARIA state |
| Disabled | No activation/hover affordance; clear reason where needed |
| Pending | Stable status slot; answer remains locally selected |
| Error | Associated message and actionable state; no geometry-changing border |

Use a class recipe or an existing component extension first. Add a React wrapper only when it centralizes meaningful behavior. Set native button types explicitly where controls appear near forms. Avoid nested interactive controls.

### P1.4 — Remove distracting movement

Replace active scale classes on toolbar, tab, and navigation buttons. Remove the Writing entrance transform. Replace timer pulsing with the agreed static urgency treatment while preserving warning thresholds and announcements. Cap overlay fades around 120–140ms. Keep scrolling, typing, resize, counters, and navigation immediate.

Scope reduced-motion rules to the student experience and overlays. Do not depend on an animation-end event for cleanup or focus transfer, because reduced motion can remove that event path.

### P1.5 — Stabilize numeric/status geometry

Use tabular numerals and a reserved timer/count width. Keep digits, save messages, flags, and progress indicators from moving adjacent controls. Use intrinsic layout for large text rather than fixed heights that clip it. Update the timer/count element only; do not add interval state to the entire exam shell.

## Targeted checks

Run existing tests, adding behavioral assertions at the corresponding owner:

```sh
npm run test:run -- src/components/student/__tests__/accessibilityScale.test.ts src/components/student/__tests__/accessibilityPreferences.test.ts src/components/student/__tests__/StudentInteractionMotion.test.tsx src/components/student/__tests__/StudentInteractionMotionCss.test.ts src/components/student/__tests__/StudentHeaderTimerAnnouncement.test.tsx
npm run typecheck
```

New assertions: preference migration/clamping; fixed role values independent of viewport; selected and focused states coexist; timer does not announce every second; obsolete scale recipes are removed without deleting functionality tests. Add rendered geometry/contrast checks to the later UI acceptance suite; source strings alone are insufficient.

## Commit boundaries and exit gate

Suggested commits: semantic typography; scoped palette/spacing; control-state/motion consumers. Keep stylesheet extraction in the same commit as its import/removal.

- Every student text role has one source of truth.
- Existing display preferences and high contrast remain valid.
- Ordinary interaction changes no control size or position.
- No answer, timing, scoring, clipboard, or submission rule changed.
- Phase tests and typecheck pass. Visual confirmation remains a later release requirement under the current code-only restriction.
