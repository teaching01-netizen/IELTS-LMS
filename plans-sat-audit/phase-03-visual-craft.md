# Phase 03 — Visual design, craft and tokens (Apple-design Lens 3)

> PLAN/AUDIT ONLY. No source file was edited. The only file written is this plan file.
> Repo root: /Users/rd-cream/Downloads/remix_-ielts-proctoring-system
> Overall plan: plans-sat-audit/overall-plan.md

## 1. Objective

Audit the SAT student exam delivery surface through the Apple-design Visual/craft lens (Lens 3): verify one-color-one-meaning, token-vs-literal discipline, type scale and serif/sans split, hierarchy carriers, icon language, motion inventory, and render a Studio Craft verdict (thesis, point of view, template test, boldness-in-one-place, removal candidate). Produce exact but NOT-applied fix-specs plus a What-works keep-list the later implementation wave must preserve.

## 2. Dependencies

- Overall plan: plans-sat-audit/overall-plan.md (read first; workflow, rating rule, scope).
- Prior code-read audit snapshot (re-verified in section 8, not copied blindly): rating Good, no Critical; High notes = top-bar density + light-only appearance (documented trade-off); Medium = timer pill, reduced-motion, capitalization; Lows = saving text-only, H1/eyebrow naming.
- No dependency on Phase 01/02/04 outputs (Wave 1 parallel, disjoint plan files, shared read-only sources).
- Blocks Phase 05 (registry/integration), which dedupes overlaps with Phases 01/02/04.

## 3. Files read (with line ranges inspected)

Token block + chrome/body split + all assigned components were read fully. No source edits made.

| # | File | Lines inspected | Notes |
|---|---|---|---|
| 1 | src/index.css | 1148-1600 (full .sat-ui token block incl. high-contrast variant, type utilities, motion utilities, answer-choice styles) + spot 410-432, 1730-1816, 2100-2127, 2158-2269, 2626-2635 | Full token inventory; contrast/forced-colors variants; motion class definitions |
| 2 | src/features/student-delivery/ui/SatExamShell.tsx | 1-425 (all) | 3-row grid grid-rows auto/minmax/auto (:245), chrome/body split (:245/:318-319), inert blocked region (:256-260) |
| 3 | src/features/student-delivery/ui/shell/SatExamTopBar.tsx | 1-249 (all) | 3-anchor header grid (:62), timer block (:88-120), tool group (:122-203), TopToolButton (:209-249) |
| 4 | src/features/student-delivery/ui/shell/SatExamFooter.tsx | 1-114 (all) | Primary/quiet button classes (:29-33), 3-col chrome bar (:43-44), neutral-black navigator pill (:54-71) |
| 5 | src/features/student-delivery/ui/shell/SatQuestionNavigator.tsx | 1-199 (all) | Legend (:104-128), cell states (:133-137), cells (:139-163), review CTA (:166-177), footer-anchored wrapper (:181-198) |
| 6 | src/features/student-delivery/ui/question/SatSingleChoiceAnswer.tsx | 1-104 (all) | Answer row (:48), marker (:68), eliminator button (:87-98) |
| 7 | src/features/student-delivery/ui/question/SatQuestionHeader.tsx | 1-73 (all) | Number block (:17-22), Mark-for-Review (:23-42), Eliminator toggle (:48-70) |
| 8 | src/features/student-delivery/ui/question/SatQuestionWorkspace.tsx | 1-112 (all) | Layout segmented group (:62-73), 2px split divider (:81), prose max-widths (:91/:107) |
| 9 | src/features/student-delivery/ui/review/SatReviewPage.tsx | 1-211 (all) | Header (:77-105), H1 (:108), stat strip (:113-120), notice (:126-134), footer (:138-174), confirm modal (:178-208) |
| 10 | src/features/student-delivery/ui/transitions/SatDirectionsScreen.tsx | 1-179 (all) | 720px centered column (:51), begin/leave (:104-135), leave confirm (:145-175) |
| 11 | src/features/student-delivery/ui/feedback/SatSaveStatus.tsx | 1-108 (all) | Saving text (:38-50), warning banner (:52-73), danger/superseded banner (:75-107) |
| 12 | src/features/student-delivery/ui/help/SatHelpModal.tsx | 1-109 (all) | Accordion (:66-96), attention-yellow close (:97-105) |
| 13 | Supporting (narrow grep/read) | — | motion/satMotion.ts 1-10; motion/satPresence.ts 1-28; motion/SatPresenceSurface.tsx 1-30; sweeps for hex literals, var(--sat-*), rgba, text-[...], radius, motion tokens |

HIG pages opened and cited (under Apple-design skill references/hig/):

| HIG page | Headings quoted |
|---|---|
| color.md > Best practices | Avoid using the same color to mean different things. / Make sure all your app's colors work well in light, dark, and increased contrast contexts. |
| color.md > Inclusive color | Avoid relying solely on color to differentiate between objects, indicate interactivity, or communicate essential information. |
| color.md > System colors | Avoid redefining the semantic meanings of dynamic system colors. |
| typography.md > Ensuring legibility | Use font sizes that most people can read easily. + iOS 17pt default / 11pt minimum table |
| typography.md > Conveying hierarchy | Adjust font weight, size, and color as needed to emphasize important information and help people visualize hierarchy. / Minimize the number of typefaces you use |
| layout.md > Best practices | Group related items to help people find the information they want. |
| layout.md > Visual hierarchy | Align components with one another to make them easier to scan / Take advantage of progressive disclosure / Make controls easier to use by providing enough space around them |
| icons.md > Best practices | Maintain visual consistency across all interface icons in your app. / In general, match the weights of interface icons and adjacent text. / Provide a selected-state version of an interface icon only if necessary. |
| materials.md > Standard materials | Choose materials and effects based on semantic meaning and recommended usage. |
| motion.md > Best practices | Add motion purposefully, supporting the experience without overshadowing it. |
| motion.md > Providing feedback | Aim for brevity and precision in feedback animations. / Let people cancel motion. / In apps, generally avoid adding motion to UI interactions that occur frequently. |
| branding.md > Best practices | Ensure branding always defers to content. / Help people feel comfortable by using standard patterns consistently. / Consider choosing an accent color. |
| design-principles.md > Craft | Quality sets the tone. / Care about every detail. |
| design-principles.md > Simplicity | Include just what is necessary. / Establish hierarchy. |
| design-principles.md > Familiarity | Keep visuals and interactions consistent |
| (judgment) | Labeled explicitly wherever no HIG reference covers the point. |

## 4. Token ground truth (read from src/index.css:1199-1307)

Semantic palette (default .sat-ui scope; staff .sat-product tokens out of scope for this delivery surface):

| Semantic | Hex / value | Where used (verified call sites) |
|---|---|---|
| accent royal (primary action) | #3154D7 (--sat-accent, :1214) | Next/Submit/Begin filled pills (Footer :30, Review :156/:202, Directions :110), selected answer border+marker fill (SingleChoice :48/:68), navigator answered fill + current ring (Navigator :134-136), workspace pressed tab (Workspace :64-71) |
| accent hover-strong | #2947BA (--sat-accent-hover/--sat-accent-strong, :1215-1216) | Primary hover, Back quiet text (Footer :33), unanswered-cell text (Navigator :137), review CTA (Navigator :173), help Expand/Collapse (HelpModal :52/:61) |
| accent pressed | #223A98 (--sat-accent-pressed, :1217) | Semantic --sat-control-primary-bg-pressed target; no direct call site in the 11 files read (reserved — see F-08 note) |
| accent soft tint | #E4EAFB (--sat-accent-soft, :1218) | Selected answer row bg (SingleChoice :48), current-tab wash (Workspace :64-71), review notice bg (Review :127/:131) |
| focus blue (distinct from accent) | #005FCC (--sat-focus, :1224) | ALL focus rings in every file, answer :has(input:focus-visible) outline (index.css :1505-1508), 3px width + 2px offset tokens (:1291-1292) |
| chrome shell | #EAF2FD (--sat-chrome/--sat-shell-bg, :1212/:1265) | TopBar bg (TopBar :58), Footer bg (Footer :43), exam shell grid bg (Shell :245) |
| canvas / document body | #FFFFFF (--sat-canvas/--sat-body-bg/--sat-background, :1213/:1201/:1266) | White document main (Shell :319), workspace scroll surfaces (Workspace :47/:76) |
| review red (flag signal) | #C9475C (--sat-review/--sat-review-active, :1225/:1276) | Bookmark fill ONLY — header icon (Header :35), navigator legend+badges (Navigator :122-123/:155-159), review strip (Review :117). Label text stays ink. |
| danger red (destructive/failure) | #b42318 (--sat-danger, :1233) + soft #fff1f0 (:1234) | Leave-for-sure (Directions :169), error notice (Directions :94), failed/superseded save banner + retry (SaveStatus :78-104) |
| warning amber text | #8a4b00 (--sat-warning, :1235) + soft #fff7e6 (:1236) | Paused/waiting notices (Directions :78/:83/:88), offline/retrying save banner (SaveStatus :56-70) |
| attention yellow (Help-close CTA) | #FFD718 (--sat-attention, :1220), hover #F2C900 (:1221), fg #171717 (:1222), border #44484C (:1223) | Help modal close button ONLY (HelpModal :101). NOT danger, NOT accent — pinned by SatHelpModal.test.tsx:52 |
| text ink / secondary | #1d1d1f / #515154 (:1205-1206) | Body + metadata throughout |
| answer border | #74787D (--sat-answer-border, :1229) | Answer rows (SingleChoice :48), notes textarea |
| split / chrome dividers | #777B80 (--sat-split-divider, :1230); #24272A (--sat-divider-strong, :1228); rgba(60,60,67,.36/.18) (:1207-1208) | 2px passage/question divider (Workspace :81); topbar bottom + footer top borders (TopBar :58, Footer :43); section hairlines |
| dark tool chrome | #202022 bg / #ffffff text / rgba(255,255,255,.12) hover (--sat-tool-chrome/text/hover, :1239-1241) | Floating calculator/reference panels (token defined; panels outside assigned files) |
| navy / progress ink | #202B78 (:1226); #191919 (:1227) | Declared; no call site in the 11 files read (reserved/future) |
| scrim / reader mask | rgb(0 0 0 / 72%) / rgb(20 20 20 / 92%) (:1231-1232) | Modal scrims, line-reader dim |
| press overlay | rgba(0,0,0,.075) (:1242) | Universal press feedback (index.css :1427-1430) |
| highlight paper | #FFF2B3 bg / #1d1d1f text (:1254-1255); note header #FFF9D9 (:1256) | Annotation marks (rendering outside assigned files) |
| disabled | bg #e9e9ee / text #616166 (:1237-1238) | Disabled buttons/inputs throughout |
| high-contrast variant | accent/focus #003f87, review #850033, danger #8b0000, warning #603300, text #000 (index.css :1156-1182) + prefers-contrast remap (:1521-1536) + forced-colors mapping (:1538-1575) | Proves the token spine re-themes instead of scattering literals |

Type scale (tokens, index.css :1245-1251): body 1.0625rem (17px), control-primary 0.9375rem (15px), control-secondary 0.875rem (14px), metadata 0.8125rem (13px), timer 1.25rem (20px), input 1.125rem (18px), reference 1rem (16px). Chrome sans = system stack (:1297-1302); passage serif = Charter/Iowan/Palatino/Georgia via .sat-exam-prose (:1323-1326).

Motion scale (index.css :1244/:1420-1499; JS twins satMotion.ts:6-9): state 130ms (--sat-motion-state), surface-enter 160ms (.sat-surface-enter), backdrop-enter 140ms, tool-surface-enter 120ms, press override 40ms (:1427-1430, answer twin 4.5% :1496-1499), JS exit 110ms (surfaceExit), ease cubic-bezier(0.22,1,0.36,1) everywhere.

## 5. Checklist verdicts

### (a) One-color-one-meaning — PASS with two noted adjacencies

Each hue carries exactly one job (see table above): royal = primary/selected/current; focus-blue = keyboard focus ONLY (never a fill); review-red = flag glyph ONLY (never label text, never destructive); danger-red = destructive/failure ONLY; warning-amber = waiting/offline ONLY; attention-yellow = Help-close CTA ONLY; ink-black = navigator pill + number block + pressed-dot neutrals. Two adjacencies are intentional and fenced, not violations: (1) answered-cell fill reuses accent royal — same meaning (the thing you committed to), paired with a Check glyph + aria-label so color is never alone (HIG color.md > Inclusive color: quote in section 3). (2) --sat-accent-strong doubles as quiet-link ink (Back, help toggles) — same go/do meaning, always on text not fills. The text-white literal in SatDirectionsScreen.tsx:169 rides on a danger fill and should have been --sat-accent-text — filed as F-09 (Low).

### (b) Hard-coded hex / literal audit — CLEAN in assigned files

- Hex grep across all 11 assigned files: ZERO matches. Every color resolves through var(--sat-*) — per-file token-ref counts: Shell 2, TopBar 10, Footer 5, Navigator 16, SingleChoice 4, Header 6, Workspace 9, Review 16, Directions 19, SaveStatus 8, HelpModal 10.
- The single text-white literal (Directions :169) is the only color literal in the 11 files. Two bg-white literals in SatLineReader.tsx:59/:91 sit outside the assigned set (surfaced by sweep; Phase 01 reading-surface pass may take them). Preview scaffolding (SatPreviewControls) is dev-only, out of scope.
- Non-color arbitrary values are geometry, not color debt: radius vocabulary 999px/8px/7px/6px/12px/10px, border-2 selected states, border-l-4 notice bars, decoration-[1.5px], shadow-sm on flag badges (Navigator :157), one bespoke panel shadow shadow-[0_18px_48px_rgba(0,0,0,0.20)] (Navigator :87) — filed as F-07 (Low) because two shadow tokens exist (--sat-shadow-floating/modal, :1294-1295) and the navigator does not consume them.
- Judgment: geometry literals are intentional Tailwind positioning/sizing, not a token violation; no fix-spec proposes tokenizing layout math.

### (c) Type scale verdict — PASS

17/15/14/13 body/control/metadata + 20 timer + 18 input + 30 directions H1 + 18 help/navigator titles, all at or above Apple minimums (typography.md > Ensuring legibility + iOS 17pt default / 11pt minimum). Smallest running size is 12px (review timer Hide/Show pill, ReviewPage :98; footer save indicator) — above the 11pt floor, reserved for subordinate chrome, never passage/answer content. Serif passage (.sat-exam-prose Charter stack, Workspace :91) vs sans chrome (system stack) matches branding.md guidance to keep small-size chrome in the legibility-optimized system face while giving expressive surfaces their own voice. Hierarchy is carried by size+weight+color together (typography.md > Conveying hierarchy), and the two-typeface count respects Minimize the number of typefaces you use. Raw text-[12px]/[13px]/[14px]/[15px]/[16px]/[18px]/[22px]/[30px] literals bypass the 7 type tokens — filed as F-08 (Low), tokenize-or-document.

### (d) Hierarchy carriers — PASS (style carries hierarchy, not size)

Space/size/weight/border all work: 3-row shell grid with white document inside pale chrome (Shell :245/:318-319); 2px hard split divider (Workspace :81 via --sat-split-divider); question number in an ink block (Header :17-22); selected answer = 2px accent border + soft tint, flooded-blue explicitly refused (SingleChoice :42-48 comment never flooded blue); footer = one filled royal pill per bar, Back quiet, navigator pill neutral black (Footer :24-33 comment style — not size — carries the hierarchy); review = H1 + stat strip + status grid + accent-bar notice (Review :108-134); directions = 720px centered measure with border-y rules (Directions :51). Pill-vs-quiet discipline holds across footer, review, directions, help. Navigator pill neutrality holds (ink fill, no accent). Progressive disclosure (layout.md > Visual hierarchy) is the navigator/review/notes/more pattern, not visual hiding. Filed nits: review-header vs module-timer Hide/Show are the same job in two shapes (F-05, Medium); saving state is text-only with no shape carrier (F-10, Low, overlaps Phase 01/04).

### (e) Icon language — PASS with one weight-mismatch nit

Single Lucide set everywhere in assigned files (TopBar: BookOpen/Calculator/ChevronDown/EllipsisVertical/Highlighter/Pencil; Footer: ChevronDown/ChevronLeft/ChevronRight/ListChecks; Navigator: Bookmark/Check/MapPin/X; SingleChoice: CircleSlash2; Header: Bookmark/ListX; Review: Bookmark; Help: Minus/Plus) — satisfies icons.md Maintain visual consistency across all interface icons in your app. Sizes are disciplined: h-4 w-4 (16px) inline/adjacent-to-text, h-5 w-5 (20px) standalone tool glyphs, h-6 w-6 help accordion vs 18px titles. Selected state is glyph+fill+aria, never icon-redraw (icons.md: Provide a selected-state version of an interface icon only if necessary — correctly not provided). Icon-only states are labeled (aria-label on eliminator, mark, close, timer toggle). One nit: help accordion h-6 w-6 (24px) glyphs against 18px titles (HelpModal :77-84) break In general, match the weights of interface icons and adjacent text — filed as F-06 (Low). The Aa display glyph is a 15px text span, not an icon — correct per icons.md Include text in your design only when it is essential (text-formatting concept). No emoji, no hardware replicas, no custom-icon vector-format question (Lucide ships SVG).

### (f) Motion inventory — PASS on craft, RE-VERIFY on guarantee (prior Medium confirmed as documentation gap, not behavior gap)

| Motion | Value / site | HIG read |
|---|---|---|
| State transitions (pressable, answer rows, markers, tool hovers) | 130ms expo ease (index.css :1420-1446/:1489-1494; JS twin satMotion.state 0.13) | Brief + precise (motion.md > Providing feedback) |
| Surface enter (banners, save status) | 160ms + 4px rise (index.css :1448-1469; JS twin satMotion.surface 0.16) | Same |
| Backdrop enter | 140ms opacity-only (index.css :1452-1478) | Same |
| Floating-tool enter | 120ms opacity-only (index.css :1456-1487) | Same |
| Press overlay | ink 7.5% inset flood, 40ms on press (index.css :1427-1430; answer twin 4.5% :1496-1499) | Realistic tactile feedback (motion.md > Providing feedback) |
| Surface exit | 110ms (satMotion.ts:9, JS-driven via SatPresenceSurface) | Cancellable-by-design: AnimatePresence exits interruptible; Escape/pointer-out closes in Navigator :56-78 (motion.md: Let people cancel motion.) |
| Route fade | animation: none + reduced-motion opacity-1 gate (index.css :2155-2164) | Opt-out respected |

Reduced-motion story: SatPresenceSurface reads useReducedMotion() and collapses enter/exit to duration-0 (satPresence.ts:3-28); MotionConfig reducedMotion=user at SAT roots (main.tsx:30, SatRoot.tsx:58); generic star-selector guard (index.css :419-432) zeroes durations globally. BUT no prefers-reduced-motion block is scoped to the .sat-ui motion classes themselves — every scoped guard found targets .sat-product/authoring (:1739/:2158/:2255/:2626). The prior no reduced-motion guard Medium is therefore re-verified as a guarantee/documentation gap: behavior is covered by the global guard + MotionConfig, but a reader of the .sat-ui block alone cannot prove it, and a future narrowing of the global rule would silently re-animate the exam surface. Filed as F-04 (Medium) with a scoped-guard fix-spec. No frequent-interaction animation abuse (motion.md: In apps, generally avoid adding motion to UI interactions that occur frequently — 130ms state fades are the system minimum, not flourishes). Nothing communicates by motion alone (motion.md > Best practices: Make motion optional — every animated state has a text/aria twin).

### (g) STUDIO CRAFT lens — verdict

- Design thesis (one sentence): A pale-blue examination document with a calm royal-blue action voice, where ink-black structure and paper-tint selection keep a timed test feeling orderly instead of urgent.
- Point of view: Restraint as respect — the surface refuses flooded-blue selections, refuses to shout save text, carries zero brand marks in the exam surface (branding.md: Ensure branding always defers to content. + Resist the temptation to display your logo), and spends its one loud color (attention-yellow) on a Help close button rather than any exam action. The 2px ink/split dividers + black number block + black navigator pill form a quiet monochrome skeleton that lets royal mean exactly one thing.
- Signature element: The answer system — 52px rows, 8px radius, 1px warm-grey border, 28px letter marker whose fill is the ONLY flooded blue on the surface, selected row calm-tinted never flooded (SingleChoice :42-68 + tokens :1281-1286). It is the one place the design allows itself to feel designed.
- Template test (cream-serif/acid-dark/broadsheet/hero-number/01-02-03 markers): None found. No cream/paper-texture background (chrome is cool pale-blue #EAF2FD, not cream), no acid-dark inverted hero, no broadsheet masthead/rules, no oversized hero numerals (question numbers are 15px semibold in 44px ink blocks, Header :17-22; directions H1 is 30px tight-tracking section label, Directions :53), no 01-02-03 step markers. Serif is confined to passage prose (Workspace :91), never display typography. Verdict: not templated; Bluebook-neutral by requirement, executed with discipline rather than default-Tailwind sameness (custom 2px dividers, custom marker system, custom three-anchor header).
- Typography personality: Quietly institutional with one humanist note — system sans for all chrome/controls, Charter-serif for passages. Personality 6/10 by choice; an exam surface should not perform typographically, and it does not. No fix proposed.
- Boldness-in-one-place: The attention-yellow Help close (HelpModal :101) is the single high-chroma moment on the surface — defensible (a stranded-in-help student must find the exit instantly) and fenced by test. Keep.
- One-removal candidate: The footer candidate-name + save-noun cluster (Footer :45-52, hidden below sm) is the weakest element: it duplicates the save banner truth, vanishes on the smallest screens (so it cannot carry meaning), and spends left-column chrome on identity instead of orientation. Removal spec (NOT applied): delete the hidden sm:flex name/save cell and let the navigator pill center on its own at all sizes; surface candidate identity once on the directions screen instead. If retained, it needs no restyle — this is a subtraction proposal only, and the later wave may equally resolve it as already lean, keep. Either resolution must be recorded in Phase 05.

## 6. Findings table (severity + What file:line + numbers + Why HIG-cite-or-judgment + Fix-spec NOT applied)

Severity scale per overall plan: Critical (a11y failure, unusable at some size) / High (real friction, foreign-on-platform, templated) / Medium (suboptimal, inconsistency) / Low (polish, edge). No Critical. No High from the Lens-3 read (the two prior Highs are re-verified in section 8, not re-filed).

| ID | Severity | What (file:line + numbers) | Why (HIG cite + quote or judgment) | Fix-spec (exact, NOT applied) |
|---|---|---|---|
| F-01 | Medium | Timer Hide/Show affordance reads as a 13px bordered pill (SatExamTopBar.tsx:110-119: rounded-full border border-[var(--sat-text)] px-3 py-1 sat-type-metadata = 13px semibold) guarding a 20px sat-type-timer readout (:90). Re-verifies prior timer pill Medium. | layout.md > Visual hierarchy: Make controls easier to use by providing enough space around them and grouping them in logical sections. + judgment: the smallest control on the bar guards the most-anxious object (the clock); visual weight inverts importance. | In TopToolButton style (TopBar :237): replace the :116 pill span with the quiet text-button treatment of Directions (:74, underline on hover, no border); keep aria-label Hide/Show toggle + sat-touch-target 44px; timer readout keeps sat-type-timer 20px tabular. Do NOT enlarge the pill — demote the control, promote calm. |
| F-02 | Medium | Top-bar tool density: up to 6 tool entries + More in one right-anchored group (SatExamTopBar.tsx:122-203); 96px desktop bar (:62), 2-row mobile stack (:62), labels hidden below 420px (:240 hidden min-[420px]:inline). Re-verifies prior top-bar density High as Medium through Lens 3 (craft/density observation, not breakage; 44px + aria floor holds). | layout.md > Best practices: Make essential information easy to find by giving it sufficient space. + layout.md > Visual hierarchy: Make controls easier to use by providing enough space around them — at 320-420px the bar is two crowded rows of icon-only 44px targets. | No geometry change in the fix wave: (1) confirm 320px screenshot shows zero horizontal overflow with all 6 tools + More mounted (R&W Math-with-calculator worst case); (2) if overflow, move Reference behind More first (lowest-frequency tool), never Calculator. Record decision + screenshot in Phase 05 verification. |
| F-03 | Medium | Light-only appearance: .sat-ui color-scheme: light (src/index.css:1200) with full high-contrast + forced-colors variants (:1156-1182/:1521-1575) but no dark --sat-* variant; dark tokens exist only for tool chrome (--sat-tool-chrome #202022, :1239) and reader mask. Re-verifies prior single appearance note as documented trade-off, Medium at most. | color.md > Best practices: Make sure all your app's colors work well in light, dark, and increased contrast contexts. + Even if your app ships in a single appearance mode, provide both light and dark colors to support Liquid Glass adaptivity in these contexts. Counterweight: exam-validity (passage contrast stability, annotation paper semantics) is a legitimate reason to ship one appearance — HIG itself scopes with When possible. | Document, do not build: add a docs/ note (later wave, not this workflow) stating exam surface stays light-only for contrast-stability; high-contrast + forced-colors remain the adaptation path; dark tool chrome is floating-layer only. No dark .sat-ui variant in the fix wave. Close as accepted trade-off in Phase 05. |
| F-04 | Medium | No .sat-ui-scoped prefers-reduced-motion guard: the 130/160/140/120ms classes (src/index.css:1420-1499) have zero covering media query in .sat-ui scope — all scoped guards target .sat-product/authoring (:1739/:2158/:2255/:2626); coverage today comes only from the global star guard (:419-432) + MotionConfig reducedMotion=user + useReducedMotion in SatPresenceSurface. Re-verifies prior reduced-motion Medium as guarantee gap, not behavior gap. | motion.md > Best practices: Make motion optional. — optional must be provable at the surface scope, not inherited from a global rule a later refactor could narrow. + design-principles.md > Craft: Care about every detail. | Append (later wave) a scoped block after :1499 scoped to .sat-ui pressable/state-transition/answer-choice (transition-duration 0.01ms !important) and .sat-ui surface/backdrop/tool-surface-enter (animation none !important). Zero visual change when the preference is off. |
| F-05 | Medium | Two Hide/Show pill shapes for one job: module timer toggle is a 13px bordered pill on ink border (SatExamTopBar.tsx:116) while review timer toggle is a 12px bordered pill (SatReviewPage.tsx:98: text-[12px] border-[var(--sat-text)]). Same verb, two sizes, two contexts. | design-principles.md > Familiarity: Keep visuals and interactions consistent — one verb should wear one shape. | Normalize (later wave) both to the F-01 target: quiet text-button treatment, sat-type-metadata 13px, no border, 44px target retained, aria-label unchanged. Touch ReviewPage :98-99 and TopBar :116 together; screenshot both. |
| F-06 | Low | Help accordion glyphs outweigh titles: Minus/Plus h-6 w-6 (24px) against 18px medium titles (SatHelpModal.tsx:77-84). Elsewhere inline icons sit at 16px (h-4) against 13-15px text and tool glyphs at 20px (h-5) against 13-14px labels. | icons.md > Best practices: In general, match the weights of interface icons and adjacent text. — 24px strokes beside 18px titles emphasize the control over the content. | Change (later wave) HelpModal :81/:83 h-6 w-6 to h-5 w-5; keep 78px row height (:77) so targets do not shrink. |
| F-07 | Low | Navigator panel shadow bypasses elevation tokens: bespoke shadow-[0_18px_48px_rgba(0,0,0,0.20)] (SatQuestionNavigator.tsx:87) while the system defines exactly two shadows — --sat-shadow-floating and --sat-shadow-modal (index.css :1293-1295, comment only two shadows exist). Flag badges add shadow-sm (:157), a third elevation. | materials.md > Standard materials: Choose materials and effects based on semantic meaning and recommended usage. + design-principles.md > Craft: Quality sets the tone. | Replace (later wave) Navigator :87 shadow with shadow-[var(--sat-shadow-modal)] (dialog-sized surface); replace :157 shadow-sm with no shadow (badge already carries review-red fill + white surround). Screenshot compact + anchored presentations. |
| F-08 | Low | Raw px type literals bypass the 7 type tokens: text-[12px] (Review :98, footer save), [13px] (TopBar :240, Navigator :104, Directions :101/:137, SaveStatus :41), [14px] (pervasive — marker, cells, review, directions), [15px] (TopBar Aa :154, Directions :57/:65), [16px] (Review :80), [18px] (Review :87, Navigator :90, Directions :54, Help :77), [22px] (timer warning), [30px] (Directions H1 :53). Tokens --sat-type-* cover 13/14/15/17/18/20 but call sites use literals. | typography.md > Conveying hierarchy (hierarchy should read through the token scale) + judgment: literals work today but the scale cannot be re-tuned from one place. | Tokenize-or-document (later wave): map text-[13px] to sat-type-metadata, [14px] to sat-type-control-secondary, [15px] to sat-type-control-primary, [18px] to sat-type-input; keep [12px]/[16px]/[22px]/[30px] only where no token exists and annotate each with a scale-exception comment. No size changes — class-name swap only, screenshot diff must be pixel-identical. |
| F-09 | Low | One color literal on the destructive action: text-white on the danger fill (SatDirectionsScreen.tsx:169). Token --sat-accent-text #ffffff (:1219) exists and is used for every other white-on-fill label (Footer :30, Review :156). | color.md > System colors: Avoid redefining the semantic meanings of dynamic system colors. (by analogy: do not re-state a token value as a literal) + judgment: a future off-white text token would leave this one button behind. | Replace (later wave) Directions :169 text-white with text-[var(--sat-accent-text)]. Pixel-identical today. |
| F-10 | Low | Saving state is text-only with no shape carrier: 13px secondary text, no icon, no tint (SatSaveStatus.tsx:38-50), while siblings carry border+soft-fill shapes (warning :56, danger :78). Overlaps Phase 01 (polite-live) / Phase 04 (copy) — owned here only for the visual-carrier gap. | color.md > Inclusive color: Avoid relying solely on color to differentiate between objects (inverse case: the calm state differentiates by nothing — no shape, no glyph — so low-vision scan cannot find it) + judgment: calm should still be findable. | Add (later wave) a 16px neutral pending glyph (Lucide LoaderCircle or CloudUpload, h-4 w-4, aria-hidden) + keep text string identical; no color change, no live-region change. Phase 01 confirms SR impact before merge. |
| F-11 | Low | H1/eyebrow naming: review H1 renders SAT_COPY.review.eyebrow (SatReviewPage.tsx:108) with the section eyebrow line above it (:80-83) — two near-identical strings in the heading hierarchy. Re-verifies prior Low; Lens-3 impact is hierarchy-clarity only. | typography.md > Conveying hierarchy: Adjust font weight, size, and color as needed to emphasize important information — two adjacent same-register strings blur which is the heading. | Copy-owned (Phase 04 decides strings); Lens-3 spec only: keep the 24px semibold tight treatment (:108) on whichever string Phase 04 keeps as H1; demote the other to metadata style. No change proposed here beyond the constraint. |

Out-of-scope observations (not filed, recorded so Phase 05 does not re-discover them): --sat-accent-pressed #223A98 / --sat-exam-navy #202B78 / --sat-progress #191919 declared without call sites in the 11 files (reserved tokens, not debt); SatPreviewControls literals are dev-only scaffolding; SatLineReader bg-white/text-white literals sit outside the assigned set and belong to Phase 01 reading-surface pass if anyone wants them.

## 7. What-works keep-list (patterns the later wave MUST preserve)

1. One-color-one-meaning spine — royal=action, focus-blue=focus-only, review-red=glyph-only, danger=destructive, warning=waiting, attention-yellow=Help-close-only. Any re-tokenization must keep these six jobs on six hues (section 4 table is the contract).
2. Zero-hex discipline in delivery components — no # literals in any of the 11 files; all color through var(--sat-*). Later wave must keep hex grep at zero for these files (F-09 is the single exception to fix, not a license).
3. Calm selection, never flooded blue — selected answer = 2px accent border + --sat-accent-soft tint + marker-only fill (SingleChoice :48/:68). Pinned by test (SatSingleChoiceAnswer.test.tsx:60 asserts no bg-[var(--sat-accent)] on the row).
4. Style-carries-hierarchy footer — one filled royal pill per bar, quiet Back, neutral-ink navigator pill (Footer :29-71). Never promote the navigator pill to accent; never give Back a fill.
5. 2px structural dividers — split divider via --sat-split-divider (Workspace :81), chrome borders via --sat-divider-strong (TopBar :58, Footer :43). Borders carry structure (only two shadows exist, :1293).
6. Focus-blue ring contract — 3px --sat-focus + 2px offset on every interactive element, answer rows via :has(input:focus-visible) (:1505-1508). Never substitute accent for focus.
7. Serif-passage / sans-chrome split — Charter stack for passages (Workspace :91), system sans for chrome. Never set chrome in serif, never set passages in sans.
8. Brief-motion vocabulary — 130 state / 160 surface-enter / 120 tool-enter / 140 backdrop / 40 press, one expo ease, MotionConfig + useReducedMotion opt-outs. Later wave adds the F-04 scoped guard but changes no value.
9. Flag-glyph discipline — review-red fill on the Bookmark glyph ONLY, label stays ink (Header :35, Navigator :122-123/:155-159, Review :117), always paired with text/aria — never color-alone.
10. Attention-yellow fenced to Help-close — HelpModal :101 only, pinned by test (SatHelpModal.test.tsx:52 asserts attention; SatShortcutsModal.test.tsx:26-30 asserts NOT attention). Never spread yellow to exam actions.
11. Pill-vs-quiet button language — filled royal pill = commit/advance (Next/Submit/Begin), bordered pill = secondary, quiet text = retreat (Back/Leave/Keep-checking). Keep the three tiers distinct.
12. Reading measures — 720px directions (Directions :51) + 900px review (Review :107) + 660/650px passage/question max-widths (Workspace :91/:107). Never full-bleed prose.

## 8. Prior-audit re-verification (do not copy blindly — each claim re-checked)

| Prior note | Lens-3 verdict | Evidence |
|---|---|---|
| High: top-bar density | Confirmed, graded Medium through Lens 3 (craft/density, floor holds) | TopBar :62/:122-203/:240; filed as F-02 with screenshot-gated spec, not a rebuild |
| High: light-only appearance (documented trade-off) | Confirmed as accepted trade-off, Medium at most | index.css :1200 vs :1156-1182/:1521-1575 variants; filed as F-03 document-do-not-build |
| Medium: timer pill | Confirmed Medium | TopBar :90/:110-119; filed as F-01 (+ F-05 consistency twin) |
| Medium: reduced-motion | Confirmed as guarantee gap, Medium (behavior covered, scope proof missing) | Section 5(f) inventory; no .sat-ui-scoped guard; filed as F-04 |
| Medium: capitalization | Not a Lens-3 finding — owned by Phase 04 (copy). No visual-craft claim made here. | — |
| Low: saving text-only | Confirmed Low, visual-carrier slice only | SaveStatus :38-50 vs :56/:78; filed as F-10, SR/copy slices deferred to 01/04 |
| Low: H1/eyebrow naming | Confirmed Low, hierarchy-clarity slice only | Review :80-83/:108; filed as F-11, strings deferred to Phase 04 |

No prior note was upgraded to High or Critical on Lens-3 evidence. No new High or Critical was found on Lens-3 evidence.

## 9. Edge cases

1. 320px + all-tools-mounted (R&W Math-with-calculator): 6 tools + More in a 2-row 44px grid — F-02 screenshot gate must use this configuration, not the sparse Math layout.
2. 200 percent text / Dynamic Type large: type-token map (F-08) must be verified pixel-identical at default size AND non-overflowing at 200 percent; 12-13px metadata may wrap under the navigator pill — acceptable if no overlap.
3. High-contrast + forced-colors: F-07 shadow swap and F-09 literal swap must be re-checked in data-sat-contrast=high-contrast, prefers-contrast: more, and forced-colors: active — shadows collapse to none/system there by design (:1538-1575), so the fix must not introduce a High-contrast-only regression.
4. Reduced-motion on: F-04 scoped guard must be verified with the OS setting on — enter animations gone, focus rings instant, no stuck mid-fade content (route-fade gate :2155-2164 covers chrome).
5. Blocked/paused shell: disabled token treatments (--sat-disabled-*) already cover Back/Next/tools; F-01/F-05 restyles must preserve disabled states.
6. Elimination + selection combined: selected-and-eliminated rows stack tint + strikethrough (SingleChoice :48/:77) — no color change proposed, but any answer-token touch must screenshot this combination.
7. Attention-yellow in dark/High-contrast environments: yellow close is fenced to default scope; forced-colors maps chrome to Canvas/system (:1538-1575) — F-06/F-10 must not leak yellow or new glyphs into that mapping.
8. Navigator compact vs anchored: F-07 touches both presentations (Navigator :87 ternary) — verify at max-width 639px / max-height 560px (compact, 12px radius) and desktop (anchored, 10px radius).

## 10. Verification section (for the later implementation wave — nothing executed here)

- Hex grep across the 11 section-3 files returns zero (F-09 is a named-color literal, not hex; hex stays zero throughout).
- Contrast recompute (WCAG formula) after F-07/F-09/F-10: body >= 16, secondary >= 7, white-on-accent >= 6, accent-strong-on-white >= 7, danger >= 6, warning-on-soft >= 6, review-on-white >= 4.5 — record table in Phase 05 (prior computed values in overall-plan section 2.26 are the baseline).
- Typecheck + lint clean; unit targets SatSingleChoiceAnswer.test (row-tint + no-flood assertions), SatHelpModal.test (attention-fenced), SatShortcutsModal.test (attention-absent) all green.
- Screenshot pairs (default + high-contrast + 320px + 200 percent + reduced-motion) for: topbar timer control (F-01), full tool row worst-case (F-02), review timer toggle (F-05), help accordion (F-06), navigator both presentations (F-07), save states triple (F-10).
- Keyboard + SR script (shared with Phase 01): focus rings visible on every restyled control; timer toggle + review toggle announce identically; help accordion glyph change announces nothing new.
- Device-only measurements (cannot verify in code-read): 320px physical overflow, bright-sunlight amber/yellow legibility (color.md: Test your app's color scheme under a variety of lighting conditions.), True Tone white-point drift on chrome #EAF2FD — listed for Phase 05 device pass.
- Zero-source-changes confirmation for THIS workflow: git status --porcelain shows no modification under src/ (this phase wrote only plans-sat-audit/phase-03-visual-craft.md).

## 11. Definition of done

- [x] This file exists at plans-sat-audit/phase-03-visual-craft.md with objective, dependencies, files-read list (line ranges), findings table (severity + What file:line + numbers + Why HIG-cite-or-judgment + unapplied Fix-spec), edge cases, verification section, and definition of done.
- [x] Checklist (a)-(g) addressed with verdicts; semantic-vs-literal audit with per-file token counts; motion inventory with values; craft verdict with thesis/POV/template-test/boldness/removal-candidate.
- [x] What-works keep-list with 12 preservable patterns recorded for the later wave.
- [x] Prior audit notes re-verified with file:line evidence (no blind copies); no finding above Medium from Lens 3.
- [x] Every finding carries an HIG file.md > Heading + short quote or an explicit judgment label.
- [x] Zero source edits (nothing under src/, no CSS values, no copy changes); only this plan file written.
- [ ] Parent notified via send_message with severity counts + file path (final step).
