# SAT Internal Workspace UI Redesign

**Status:** Implementation brief  
**Scope:** Staff-facing Digital SAT workspace under `/sat/*`  
**Goal:** Make the existing SAT internal product feel soft, human, confident, calm, and editorial while keeping proctoring and review work fast, precise, and accessible.

## 1. Product interpretation

The target is a calm, well-lit workspace where student work and staff decisions lead. The interface should provide a quiet frame: warm light surfaces, generous spacing, soft geometry, a single restrained accent, and natural language. Live rooms may use one focused dark surface to make the current exam stage feel like a spotlight; the rest of the workspace remains light and calm.

Translate creator-first ideas into this product rather than adding unrelated portfolio UI:

- Exam content, student answers, and real room activity are the human work. Give those artifacts the strongest hierarchy in their respective workflows.
- Counts are useful evidence only when their label, scope, and time context are clear.
- Do not add testimonials, ratings, fabricated activity, stock student portraits, or social-proof badges. Do not add student photos. Preserve privacy; use the existing names and exam data only where the current workflow already allows them.
- Add at most one small human flourish to a surface: a hand-drawn underline beneath an eyebrow or a lightly tilted non-interactive note. It must be decorative, use existing assets/CSS, and never encode status or instructions.
- Keep operational copy calm and direct. Prefer “No rooms yet. Create a room when the exam is ready.” over promotional or institutional language.

## 2. Scope and non-goals

### Included

The staff shell and all staff SAT surfaces, including their empty, loading, error, dialog, and responsive states:

| Surface | Route | Current owner / entry point |
|---|---|---|
| Exam library | `/sat/exams` | `src/products/sat/routes/SatExamLibraryRoute.tsx` |
| Exam authoring, release review, preview, access, settings, exam responses | `/sat/exams/:examId` and its child routes | `src/features/exam-authoring/**`, `src/products/sat/routes/SatAccessRoute.tsx`, `SatExamResponsesRoute.tsx` |
| Room library and room creation | `/sat/sessions` | `src/products/sat/routes/SatSessionsRoute.tsx`, `SatNewSessionFlow.tsx` |
| Live or review room | `/sat/sessions/:scheduleId` | `SatSessionRoomRoute.tsx`, `src/products/sat/ui/room/**`, `sat-session-room.css` |
| Responses by exam, room, and attempt | `/sat/results` and query-state levels | `SatResultsRoute.tsx`, `SatAttemptInspector.tsx` |
| Scored result and saved answers | `/sat/results/:resultId`, `/sat/results/attempts/:attemptId` | `SatResultDetailRoute.tsx`, `SatAttemptAnswersRoute.tsx` |
| Score conversion policy | `/sat/score-conversion` | `SatScoreConversionRoute.tsx` |
| Shared staff shell and primitives | All included routes | `src/products/sat/SatRoot.tsx`, `src/products/sat/ui/SatPage.tsx`, `SatWorkspaceNav.tsx`, `src/index.css` |

### Excluded

- Student exam delivery and the exam-taking surface, including `/student/*` and `src/components/student/**`.
- IELTS routes, authorization rules, APIs, data models, scoring, room lifecycle, question content, and autosave behavior.
- New features, new metrics, new media, or new dependencies.

The exam builder and preview are staff surfaces, but their exam/question content must remain legible and authoritative. Restyle their surrounding SAT chrome only where safe; do not change the rendered exam experience or content contract.

## 3. Existing architecture to preserve

The SAT staff product already has a single shell, role-filtered navigation, shared page/list/form primitives, a measured-width room layout, URL-backed filters, and a response inspector that preserves list state. The redesign should work through these owners rather than creating parallel components.

| Concern | Implementation boundary |
|---|---|
| Shell, role-specific nav, account, route transitions | `SatRoot.tsx` |
| Page width, headings, buttons, fields, lists, statuses, empty/loading/error states | `SatPage.tsx` and `SegmentedControl.tsx` |
| Shared visual values and SAT-specific CSS | `src/index.css`; room layout rules in `sat-session-room.css` |
| Room responsive pane layout and persistent controls | `SatRoomWorkspace.tsx`, `useSatRoomLayout.ts`, `sat-session-room.css` |
| Student work and attempt context | Existing response/detail routes and inspector |

Prefer changing existing `--sat-staff-*` tokens and shared component styles. Keep changes scoped to `.sat-product` / `.sat-staff-root`. Do not repurpose global `--sat-*`, `--color-au-*`, student exam, or IELTS tokens to achieve this look. Keep browser forced-colors and reduced-motion behavior intact.

## 4. Visual system

Treat the following as the target palette. Implement them as semantic CSS custom properties in the existing staff token layer; components consume roles, not literal colors. Values are targets, subject to contrast verification during implementation.

| Role | Target | Usage |
|---|---|---|
| Warm canvas | `#F6F3EE` | Main page background |
| Soft surface | `#FFFEFB` | Main lists and content panels |
| Raised surface | `#FFFFFF` | Dialogs, floating inspector, popovers |
| Primary ink | `#2D302C` | Headings and essential data |
| Secondary ink | `#555B55` | Body copy, metadata with meaning |
| Tertiary ink | `#686E67` | Supporting metadata; keep readable |
| Hairline | `#E5E0D7` | Quiet section boundaries only |
| Pine accent | `#356456` | Primary actions, active navigation, links |
| Pine hover / pressed | `#2D574B` / `#25483F` | Interactive accent states |
| Accent tint | `#E8F0EB` | Selected controls, quiet active surfaces |
| Warm detail | `#A75F42` | Rare decorative emphasis; not a second action color |
| Dark spotlight | `#28312E` | Current live stage panel only |
| Spotlight text | `#FBF9F3` | Text on dark spotlight |
| Spotlight secondary | `#D8DED7` | Supporting text on dark spotlight |

Status color remains semantic and understated: success `#2E684F`, warning `#86530F`, danger `#A63E38`, info `#315D82`, neutral `#686E67`. Pair each with an accessible text label and shape/icon; never use color alone. Keep errors and destructive actions unmistakable, but reserve strong red for actual error/destructive states.

### Geometry, elevation, and spacing

- Use a 4 px base spacing unit. Align page gutters, field groups, list columns, and card padding to multiples of 4.
- Use a consistent content measure: existing list max-width (about 1180 px), settings max-width (about 920 px), and full-width only for the room/workbench layouts that need it.
- Target radii: chips/pills `999 px`; small controls `12 px`; fields and standard cards `16 px`; dialogs/large sheets `22 px`. Avoid square corners and mixed arbitrary radii.
- Main cards should read from warm surface contrast and whitespace. Use soft, low-opacity shadows on floating overlays and at most a faint card lift; do not outline every container or add strong shadows to every row.
- Keep list rows airy and scannable. Use gentle separators between groups, not boxed table cells. Preserve numeric alignment and tabular numerals for scores, counts, timers, and timestamps.
- Provide at least 44 px interactive targets. Keep all existing focus rings visible against warm and dark surfaces.

### Typography and voice

- Keep the existing system sans stack and avoid adding a remote font dependency. Use a restrained title scale: page title 30–34 px, section title 20–22 px, body 15–16 px, metadata no smaller than 13 px.
- Use medium/semibold weights, relaxed line-height, and slight negative tracking only on large headings. Avoid all-caps labels except a small optional eyebrow.
- Write for a person doing focused work: short, specific, non-promotional labels; explain consequential states in plain language; keep policy/technical details available without making them the first thing seen.
- Do not use playful copy in warnings, exam controls, student result contexts, or policy settings.

## 5. Layout and surface requirements

### 5.1 Staff shell

- Keep the desktop left navigation, compact mobile header, and mobile bottom navigation. Preserve current role-based item visibility and the SAT/IELTS switch.
- Give the shell a warm canvas and soft white surfaces. Make the selected route a rounded, low-contrast tint with a clear active label/icon; avoid a hard high-chroma bar.
- Keep navigation visually quiet and stable across route changes. Maintain the existing full-bleed exam detail behavior and the room/result-detail shell behavior.
- Keep account identity subtle. Retain staff initials/name and sign-out; do not add profile photography or extra account controls.
- The mobile bottom bar must respect safe-area insets and never obscure page actions or dialog controls.

### 5.2 First-level lists: Exams, Rooms, Responses

Use the same page grammar on `/sat/exams`, `/sat/sessions`, and `/sat/results`: title/short description, primary action when authorized, filter toolbar, contextual count, then an open list surface.

- Preserve each list’s current data, filters, tabs, sorting, URL behavior, result counts, row destinations, and role permissions.
- Give the heading area more breathing room. Align toolbar controls to a shared baseline; wrap to two calm rows on narrow screens rather than compressing fields.
- Use generous clickable rows with a clear primary label, one secondary context line, optional quiet status, and a consistent trailing affordance. Keep important information visible at mobile widths; move secondary metadata below the title instead of hiding essential status.
- Treat count strips as context, not KPI tiles: use plain labels, tabular numbers, and a soft surface with no oversized saturated numerals. Hide only genuinely redundant counts on narrow layouts.
- Keep segmented status controls as a soft pill track. Selected state uses tint, clear text, and selected semantics; unselected state remains readable.
- Empty states should say what belongs here and give the next useful action only when the user can take it. Search-empty and genuinely-empty cases remain distinct.

### 5.3 Exam authoring and preview workspace

- Retain its full-bleed, persistent header, tabs, save state, and Publish action. Preserve the exam workspace navigation shape while moving among Questions, Rooms/access, Responses, Settings, Review, and Preview.
- Warm the chrome and shared controls while keeping actual passages, questions, diagrams, answer choices, and student-facing preview surfaces neutral and high-contrast. Content authored or taken by people stays the visual focus.
- Give writing/reading content a clear measure and quiet surrounding canvas. Do not add decorative imagery behind question text or controls.
- Keep autosave state honest and visible in plain language. A saving/saved/error indicator must not rely on color alone.
- For release review and score/policy configuration, group related settings with headings and concise explanations. Preserve validation, issue links, review gating, and publish confirmation behavior.

### 5.4 Room library and room creation

- Keep upcoming/live/finished buckets, search, sorting, timezone explanation, create flow, and room row navigation intact.
- Make the current bucket feel like a calm workspace filter, not a switchboard. Distinguish `Running`, `Paused`, `Not started`, `Finished`, and `Cancelled` with readable dot+label semantics and a restrained tint.
- Let create-room flow feel welcoming and progressive: one task per step, clear field labels/help, a visible progress/step cue, and a calm summary before creation. Preserve exam readiness issues, route-to-fix behavior, validation, and role access.
- Avoid an oversized promotional hero or invented operational metrics.

### 5.5 Live room: focused dark spotlight

The room is the highest-attention staff surface. Keep its existing roster/context/inspector model and measured-width transitions. Use one warm dark spotlight surface for the current stage and clock in the room context column; keep roster, attention details, and secondary panels light.

- The spotlight contains the current section/module/stage, the authoritative time remaining, and only the most relevant stage status. It must not duplicate the clock elsewhere with equal visual weight.
- Use a warm charcoal/green-black background (`#28312E`), warm-white primary text, readable muted supporting text, and a pale green accent. Keep all text and controls above contrast requirements.
- Live, paused, stale/reconnecting, and finished states must be communicated in copy/iconography as well as color. The live pulse is subtle and stops under reduced motion.
- Preserve priority ordering: before start, joining/entry and start readiness; while live, active stage and open attention items; review mode, student work and room outcomes. Do not put a decorative feature ahead of a time-critical action.
- Keep pause/resume/extend/complete controls grouped and visually distinct from navigation. Confirmation dialogs must retain the exact action context and safe cancel path.
- On narrow layouts, stack panes in the existing measured layout order and keep high-priority actions reachable without horizontal scrolling. Never shrink the roster below a readable row size to preserve a decorative card.
- Retain stale-data blocking, reconnecting indicators, room-clock behavior, student selection, focus restoration, and inspector sizing.

### 5.6 Responses and student review

- Preserve the exam → room → attempt hierarchy, URL-backed filters, pagination, timezone labels, export scope messaging, and list-return behavior.
- Keep actual student responses, score details, and answer history visually primary. Use the light canvas around them and avoid turning scores into competitive leaderboard cards.
- Use the existing side inspector as a soft raised sheet with a rounded leading edge and gentle shadow. Keep its close, previous/next, open-as-page, keyboard, and focus-restoration behavior.
- Student names and scores are sensitive operational data: do not add avatars, inferred identity, share links, or expose additional fields. Keep results visually neutral and contextual; do not imply official SAT scores when the data is an estimate.
- Represent outcome states with text plus icon/dot. Preserve distinctions among running, completed, ended/invalidated, scored, and unavailable.
- Keep export errors and completion announcements adjacent to the export control and available to assistive technology.

### 5.7 Score conversion and policy settings

- Present policy configuration as a quiet, focused form with grouped sections, clear current values, and restrained explanations of what each setting changes.
- Reserve the strongest action styling for Save/Apply/Publish. Make destructive or irreversible changes clearly labeled and confirm them using the existing policy.
- Preserve validation, persisted values, admin-only route access, and score conversion semantics. Do not invent sample scores or imply the conversion is official.

### 5.8 Dialogs, menus, transient states

- Apply the same surface, radius, spacing, and focus treatment to create/edit flows, confirmations, menus, share/present sheets, error banners, loading skeletons, and empty states.
- Use one primary action per dialog; secondary/cancel is visually quiet but never hidden. Keep destructive actions visually distinct and labeled by their consequence.
- Banners should be soft tinted surfaces, concise, and in normal reading order. Use alert/live-region semantics already required by the state.
- Skeletons should match final content geometry and use low-motion, low-contrast shimmer; provide a reduced-motion/final-static form.

## 6. Responsive, accessibility, and motion contract

- Design from 320 px wide through large desktop. At narrow widths, use a single-column reading flow, 16 px minimum side gutters, no horizontal page scrolling, and content-first wrapping. Test the live room against its measured container widths, not only viewport breakpoints.
- At tablet and desktop widths, expand list columns progressively. Preserve readable line lengths and avoid using empty width for oversized decorative cards.
- Meet WCAG 2.2 AA contrast for normal text (4.5:1) and large text (3:1); meaningful icons and state indicators need 3:1 against adjacent colors. Verify the exact rendered pairs for light, accent, dark spotlight, warning, and error surfaces.
- Keep semantic headings, landmarks, accessible labels, visible keyboard focus, logical tab order, Escape/close behavior, screen-reader status announcements, and existing skip link behavior.
- Ensure text remains usable at 200% zoom and with increased text spacing. In forced-colors mode, retain boundaries and state labels without relying on shadow or tint.
- Respect `prefers-reduced-motion`. New movement is limited to quick opacity/color/elevation feedback, capped at 200 ms; no ambient animation, large parallax, or decorative motion. Do not animate live clocks.
- Ensure the dark spotlight remains readable in high contrast and never becomes a dark-mode requirement for the rest of the app.

## 7. Functional invariants

Visual work must not change these behaviors:

1. Role-based access and nav visibility remain exact (`admin`, `builder`, `proctor`, `grader`).
2. URL query state, deep links, browser back, filters, pagination, and the selected attempt inspector continue to restore the same work context.
3. Exam and room creation, authoring save/publish, access links, proctor controls, share/present, export, result review, and score conversion preserve existing request and confirmation semantics.
4. Live-room stale-state safety remains authoritative: risky actions stay blocked until data is current; errors do not imply success.
5. Student work, score calculations, official/estimated score labels, privacy boundaries, and exam rendering remain unchanged.
6. Keyboard and focus behavior (including sheet focus restoration, inspector navigation, and dialog cancellation) remains unchanged.

Do not solve visual inconsistency with route-specific inline colors. Reuse the shared staff tokens and primitives so every affected caller crosses the same visual boundary.

## 8. Implementation sequence

1. **Token pass:** Update only the staff SAT token values and the shared primitive styles. Check buttons, fields, select/search, segmented controls, status pills, lists, dialogs, and text hierarchy together.
2. **Shell and list pass:** Restyle `SatRoot` and the Exams, Rooms, and Responses index layouts. Confirm role-specific nav and narrow-screen behavior.
3. **Authoring pass:** Apply the same chrome to exam workspace and settings/review/access surfaces while protecting question/preview content and autosave behavior.
4. **Live-room pass:** Restyle `SatRoomHeader`, context/stage, roster, needs-attention panels, run sheet, inspector, and confirmation/share surfaces using the one-dark-spotlight rule. Keep measured layout ownership in `useSatRoomLayout`/CSS.
5. **Review and policy pass:** Restyle result detail, saved answers, response inspector, and score conversion.
6. **State and responsive pass:** Review loading, empty, error, selected, disabled, pending, stale, success, reduced-motion, forced-colors, and mobile states on every included surface.

Keep the change visual and local. Reuse existing components and dependencies; do not duplicate primitives, introduce a theme framework, or move business logic across route boundaries.

## 9. Completion criteria

The redesign is complete only when all are true:

- Every included `/sat/*` staff route follows the same warm, soft, human visual system, including deep links and overlay states.
- The light surfaces feel open and quiet; only the live room’s current-stage panel uses a focused dark treatment.
- Actual questions, responses, answers, room attention, and meaningful scores lead each surface; decorative UI never competes with them.
- No ratings, fake proof, stock portraits, or new student imagery have been introduced.
- Navigation, role access, URL state, forms, autosave, exports, room controls, timers, and confirmations retain their existing behavior.
- No status is conveyed by color alone; text remains legible at mobile and zoomed layouts; keyboard, reduced-motion, and forced-colors modes remain usable.
- No new package or remote font/media dependency is required.
- A route-by-route before/after visual review covers the rows in the scope table, including desktop, narrow viewport, populated, empty, loading, and failure states where each applies.
