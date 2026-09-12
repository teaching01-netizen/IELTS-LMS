# Design and behavior contract

All dimensions below are implementation targets derived from the supplied notes, not claims about official IELTS/ACT pixel specifications. Apply them under the IELTS/ACT student shell. Preserve the existing high-contrast and explicit accessibility preferences.

## Typography and visual hierarchy

Use a local system font stack: `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`. Exam readability must not wait for a Google Fonts request. Do not globally change staff/SAT typography or force platform-specific font smoothing.

Define values through the existing `accessibilityScale.ts` and student CSS variables; avoid independent sizes in each renderer. Use rem-based role values at the normal browser root size, with discrete existing Small/Medium/Large preferences. Layout resize must not change font size.

| Role | Normal target | Weight / constraints |
| --- | --- | --- |
| Passage/task title | 26px / 1.22 | 700; modest tracking adjustment |
| Passage subtitle | 18px / 1.45 | 400 |
| Reading text and Writing prompt | 18px / 1.68 | 400; about 72ch maximum reading measure |
| Question-group heading | 19px / 1.35 | 600–700 |
| Instruction and question stem | 17px / 1.52 | 400; about 68ch maximum |
| Answer label / editable answer | 16px / 1.45 | 400; wrapping allowed |
| Writing editor | 18px / 1.68 | 400; same family as passage; about 78ch maximum effective measure |
| Toolbar control | 15px / 1.25 | 500 |
| Metadata | 12–13px / 1.35 | 400–500; sufficient contrast |
| Timer and counts | 16px timer / role-specific counts | Tabular numerals; reserved width |

The 16px answer target resolves the notes' 15.5px example in favor of readable mobile inputs. Browser text zoom and user text-spacing overrides remain supported. Content headings must retain their semantic hierarchy. Do not restyle mathematical subscripts, superscripts, scientific notation, or authored emphasis as ordinary text.

Paragraph markers A/B/C remain inline scanning anchors. Use roughly 12px paragraph spacing and a 4px spacing scale. Long content wraps; charts and tables may use a deliberate, labeled local overflow region when their meaning requires two dimensions. Do not truncate questions or answer options.

Base palette: near-white surfaces, primary text around `#292927`, secondary text around `#555550`, restrained IELTS blue for active/selected states, and muted yellow highlighting. Derive accessible token pairs rather than copying every grey/alpha value from the notes. A 2px high-contrast focus outline must be visible independently of selection. Forced-colors mode must retain controls, boundaries, and state indicators.

Instructions use a subtle surface or separator, with semantic spacing instead of heavy cards. No routine shadows around passage, questions, or editor. Reserve elevation for overlays. Use small control radii, approximately 4–6px, and 8px overlay corners.

## Adaptive shell

One environment observer supplies actual shell/container width, usable height, pointer capabilities, hover availability, viewport offset/scale, and probable keyboard state. Use `ResizeObserver` on the bounded shell and the existing viewport observer; avoid one observer per control. CSS uses the resulting mode/capabilities for structure. Container queries may refine local spacing, but must not independently choose a contradictory layout mode.

| Available shell geometry | Mode | Work surface | Navigation |
| --- | --- | --- | --- |
| Width >=1180px, stable shell height >=650px, pane-fit passes | Wide | Draggable split; full toolbar | Grouped number navigator |
| Width >=900px, stable shell height >=600px, pane-fit passes | Standard | Draggable split; condensed toolbar | Grouped/condensed number navigator |
| Width >=600px without sufficient split geometry | Compact | Passage/Questions or Task/Response switch | Condensed group navigator if it fits; otherwise previous/current/next |
| Width <600px | Phone | One primary pane | Previous/current/next plus question sheet |
| Any width with insufficient height or enlarged-content pressure | Focus override | One pane; compact chrome | Essential actions remain reachable |

Thresholds are starting values. The 650px/600px height thresholds refer to the outer stable shell after safe-area clearance; separately require enough remaining workspace height for split mode, initially 360px. Keyboard opening affects the visible editing region rather than changing the core mode solely through a temporary keyboard shrink. Pane-fit is decisive: initial outer-pane minimums are around 380px material and 430px questions at normal text size, including each pane's own padding. Subtract the rail once; do not count padding/gutters twice. Increase required space for enlarged text. If minimums cannot fit, select a focus layout; never leave a 48px content pane. Exact calculations are in [Phase 2](phase-02-adaptive-workspace.md).

Header target: 64px at normal density, 56px compact, 48px for short viewports when content fits. Footer target: 60px wide and 56px compact. Allow intrinsic growth for text enlargement and long labels, then recompute usable workspace height. Keep the timer visually stable through a grid with balanced side tracks when space allows; avoid absolute-center collisions with long names/tools.

The active exam shell owns page locking and safe areas. Use `100dvh` with the existing measured-height fallback. Only intended panes and overlay lists scroll. Entry, registration, pre-check, and completion may use ordinary document scrolling. Do not apply `overflow:hidden` globally or hide overflow to mask inaccessible content.

Phone/focus tabs are always visible primary navigation, with accurate selected semantics, logical focus order, and keyboard activation. Questions navigation must reveal the question pane and focus a stable question heading/control. A resize alone must not steal focus.

## Splitter

- One measured rail width for both CSS and bounds calculation: target 10px wide / 8px standard; a quiet 1–2px line within it.
- Interaction target 32px with a fine pointer, at least 44px with touch. Reserve nearby content clearance so this target cannot intercept answer fields or text selection.
- Default 50/50 for new preferences; preserve valid existing ratios. Preferred 32–68% travel is intersected with the measured minimum-width bounds.
- Use Pointer Events and pointer capture. Handle pointerup, pointercancel, lost capture, unmount, and resize during drag. No document listeners left after cancellation.
- No animation of pane width. Coalesce writes to one per animation frame where needed; persist the preference at drag completion, not synchronously on every move.
- Use a labeled focusable separator controlling the material pane, with real min/max/current values. Arrow keys move 2%, Shift+arrow 5%, Home/End move to valid bounds. Provide a click/tap-accessible reset/narrow/widen action so dragging is not the only pointer interaction.
- Grip stays discoverable without hover; percentage feedback appears on focus/drag and occupies an overlay that cannot move content.

## State continuity and keyboard

Keep the same pane roots and textarea mounted across modes. Hide inactive panes with native hidden/inert behavior as appropriate; never leave invisible controls in the tab order. Keep audio ownership above any toggled pane. Do not duplicate live inputs for mobile and desktop.

Preserve view state by attempt, published version, module, and passage/task: split preference, active pane, active question, scroll anchor, and practical editor selection/scroll. Use a stable content anchor plus pixel offset for reflow; raw scrollTop is a fallback. Restore only after layout settles and only if a newer user action has not superseded the restoration.

During software-keyboard changes, preserve the shell's stable chrome baseline when appropriate, but size/pad the editable scroll region to the actually visible viewport. A frozen tall shell alone is insufficient. Keep the current writing line visible; do not scroll the page or call scrollIntoView on every keystroke. Native textarea caret scrolling should be the first mechanism after bounding its viewport. Distinguish keyboard inference from pinch zoom, browser chrome, and window resizing using focus and viewport scale/offset. Handle focus moving while the keyboard remains open, keyboard dismissal, rotation, and missing VisualViewport support.

## Controls and navigation

Common state recipe: rest, hover, pressed, focus-visible, selected, disabled, pending, and error. State changes may alter fill/outline/icon/text, but not control geometry. Immediate press, roughly 90ms hover/release, at most 120–140ms overlay fade, and no movement for typing, timer ticks, question navigation, or direct manipulation. Reduced motion disables nonessential transitions within the exam scope.

Answer rows activate once when their label/background is clicked. Radio and checkbox semantics remain native wherever practical. Separate flag/elimination buttons from the answer label so they cannot accidentally select an answer. Preserve multi-select cardinality, shared-answer keys, slot order, and server answer IDs. Selecting an extra option must not silently replace a previous answer unless the existing question rule explicitly requires it.

`ProtectedSelect` replacement must support label/description/error association, empty value, clear/reset if currently permitted, disabled options, long options, typeahead, arrows, Home/End, commit, cancel, and focus restoration. Use installed Radix primitives for desktop placement and an accessible dialog/list of choices on phone when needed. Both presentations share one value controller. Highlighting an option is distinct from committing it. Escape cancels a pending selection. Portals must inherit exam tokens, remain inside the correct modal scope, and stay within the visible viewport.

Navigator states remain composable: current, answered, unanswered, partially answered where applicable, flagged, and unavailable. Use outline/fill/marker/icon plus accessible text; do not rely only on green/amber/blue distinctions. Numbering is data-driven, including grouped/multi-slot questions and ACT fixtures with counts other than 40. Next/previous never submits at a boundary. Submission controls only appear when the delivery policy allows them.

## Module-specific behavior

**Reading:** Stable readable column; intact authored paragraphs/emphasis; independent source/question scroll; accurate shared slot numbering; flag target separated from text; selectable content with persistent annotations.

**Listening:** Same question primitives and navigation. Playback, seeking, speed, transcript visibility, and replay stay governed by current exam configuration. Preserve active media/position across layout and pane changes. Handle blocked autoplay, loading, stall, network error, and missing media with useful status. Never silently restart audio or manufacture a transcript/caption that exposes answers.

**Writing:** Full-pane textarea, stable inset, native caret/selection/IME, an ordinary matching placeholder, and a quiet fixed-width word-count region. Keep the existing 300ms draft commit and live-draft/durability integration until measured evidence requires a change. Preserve task IDs, draft commits on transitions, server reconciliation, and current clipboard/undo restrictions. Word-count messaging must not imply grading correctness. Per-task timing/progress indicators stay only when their configured semantics warrant them; the section deadline remains authoritative.

**Speaking:** Align instructions, cue card, focus, timing display, and disabled proctor controls with the shared shell. Propagate responsive capabilities instead of forcing desktop mode. The inspected component exposes disabled call controls and local preparation/speaking counters; this plan does not invent a working recording/video transport. Clearly distinguish local advisory counters from any server-controlled section deadline.

**ACT Science:** Reuse shared mechanics while retaining ACT identity, Science grouping, stimulus/question/choice images, option IDs, and elimination behavior. Tables, legends, equations, and diagrams must remain legible. Image zoom preserves aspect ratio, gives keyboard close/restore focus, and handles missing/failed assets. Selection, flagging, elimination, and image enlargement remain separate actions. Scoring and terminalization continue through the existing ACT/Go contract.

## Highlights, underline, notes

Extend the existing normalized-offset engine and namespace, rather than persisting DOM ranges or rewriting highlighted HTML. Add a versioned discriminated annotation type for highlight, underline, and plain-text note anchors. Bind annotations to canonical content hash, version, and surface identity; validate shape, bounds, color/kind, and configured size/count limits on restore.

Read existing V2 highlights and migrate safely to the new representation. Retain recoverable old data until the new write succeeds. On content mismatch, do not apply stale offsets to different text; retain recoverable data for the session with an honest notice where appropriate.

Desktop tools remain anchored to their trigger; mobile uses the persistent toolbar/sheet without fighting native selection handles. Capture normalized selection before toolbar focus moves. Tool actions must be keyboard-operable; notes need labeled input, save/cancel, Escape, and focus restoration. Erase affects only the targeted annotation; Escape exits erase mode. Reload restores annotations, not an active erase mode or an open dialog.

Persistence in this scope is same-browser recovery through the existing local annotation mechanism, with explicit failure feedback. Do not promise cross-device note sync without a separate authenticated server contract. Notes never render as HTML and never appear in telemetry. Clear another candidate's view state on identity change; answer/draft cleanup remains governed by verified persistence/receipt policy.

## Saving and failure language

Keep one stable status region. Normal success is quiet. Announce meaningful state transitions, not every keystroke, timer tick, or save acknowledgment.

| State | Candidate experience |
| --- | --- |
| Local edit accepted; network save pending | Immediate local answer; unobtrusive pending state |
| Server acknowledged current revision | Quiet saved state backed by actual acknowledgment |
| Offline and local checkpoint succeeded | Continue according to existing runtime policy; “Saved on this device. Waiting to sync.” |
| Local storage failed | Preserve the live draft; prominent recovery guidance; stop accepting unsafe edits through existing blocking policy |
| Stale/expired session or conflicting owner | Preserve work; show the appropriate recover/re-authenticate/proctor action without leaking tokens |
| Deadline/proctor transition while edits pending | Existing commit/flush/terminalization barrier owns the sequence; no optimistic completion |
| Submission response lost | Show pending verification and retry/reconcile idempotently; never tell the candidate to resubmit a new attempt |
| Verified completion | Provider-correct receipt/summary; no stale edit controls |

## Accessibility target

Target WCAG 2.2 AA for applicable web flows: semantic labels, logical keyboard order, visible/unobscured focus, contrast, non-color states, reflow, text resizing/spacing, and accessible dialogs/status. Adopt 44px primary targets and 48px touch targets as product targets; WCAG's AA target-size minimum is not universally 44px. Include a non-drag pointer alternative for resizing. Test 200% text enlargement and 320-CSS-pixel reflow, including a 1280px viewport at 400% zoom. Two-dimensional stimuli may scroll locally without forcing the entire page sideways. See the [WCAG recommendation](https://www.w3.org/TR/WCAG22/), [splitter pattern](https://www.w3.org/WAI/ARIA/apg/patterns/windowsplitter/), and [combobox pattern](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/).

Official feature inventories are inputs to future parity fixtures, not proof of parity: [British Council computer-test features](https://takeielts.britishcouncil.org/what-is-ielts/how-it-works/test-modes/ielts-on-computer) and [ACT's official practice-test entry points](https://www.act.org/content/act/en/products-and-services/the-act/test-preparation/free-act-test-prep.html). No further browser inspection is part of this code-only planning task.
