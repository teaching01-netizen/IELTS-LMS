Yes. For this pass I would ignore persistence/backend almost completely and treat the SAT selection system as a **touch interaction product**.

The quality bar should be: a student should be able to touch text, understand immediately what is selected, adjust it precisely, and perform Highlight / Underline / Note without ever thinking about “selection mode.”

## 1. Core interaction model

The selection experience should have these visible states:

```text
IDLE
  ↓ long press / intentional drag
SELECTING
  ↓ finger released
SELECTED
  ├─ drag start handle → ADJUSTING_START
  ├─ drag end handle   → ADJUSTING_END
  ├─ tap Highlight     → ACTION
  ├─ tap Underline     → ACTION
  ├─ tap Note          → NOTE
  └─ tap outside       → DISMISSED
```

The major change from the current SAT implementation is:

```text
CURRENT

finger down
→ drag
→ blue overlay
→ finger up
→ blue overlay disappears
→ action UI

TARGET

finger down
→ selection begins
→ blue selection follows finger
→ finger up
→ selection STAYS
→ handles appear
→ contextual menu appears
→ student may adjust selection
→ action
→ selection resolves gracefully
```

That persistence after `pointerup` is what makes the interaction feel deliberate rather than temporary.

---

# 2. Touch-down behavior

A simple tap on prose should do **nothing**.

Do not show a selection, don't flash blue, don't show a toolbar.

For an unarmed SAT reading experience:

```text
tap text
→ nothing
```

For selection initiation, I would support both:

```text
long press
```

and, when Highlights & Notes is explicitly armed:

```text
press → drag
```

### Long press

Suggested timing:

```text
0 ms        pointer down
~120 ms     subtle visual acknowledgement
~320 ms     selection claims gesture
320–380 ms  word becomes selected + loupe appears
```

Don't make 350 ms an absolute magic number. A tolerance around **300–375 ms** feels appropriate.

The student should not need to hold for a full second.

### Movement tolerance

Before selection owns the gesture:

```text
movement < 6–8 px
→ still considered hold
```

Larger vertical movement:

```text
→ browser scroll
```

unless Highlight mode is already armed and the gesture clearly becomes a selection drag.

This is critical. Reading/scrolling must remain easier than selecting.

---

# 3. First selection appearance

Once selection begins, immediately paint the selected word.

Not:

```text
finger down
...
nothing
...
nothing
...
toolbar suddenly appears
```

Instead:

```text
finger down
       ↓
    "climate"
       ↓
  soft selection appears
       ↓
 loupe + selection movement
```

Use a blue selection ink approximately equivalent to:

```css
rgba(0, 122, 255, 0.20–0.26)
```

but adapt it to Warwick/SAT visual tokens rather than hard-coding Apple blue everywhere.

Avoid:

* bright neon blue
* 40–50% opacity
* heavy rounded pills around each line
* glow
* border around selected text

It should feel like ink sitting over typography.

---

# 4. Selection handles

This is one of the most important parts.

Use the familiar shape:

```text
 ●
 │
selected text
             │
             ●
```

But visually keep them refined.

Suggested visible geometry:

```text
stem:        2 px
knob:        9–11 px
visible total: ~18–22 px
```

The actual hit target should be much larger:

```text
44 × 44 px minimum
```

So:

```text
             invisible hit area
        ┌────────────────┐
        │       ●        │
        │       │        │
        └────────────────┘
```

Students should never have to hit the 10px circle itself.

### Handle idle state

No pulse.
No bounce.
No animation loop.

Just stable.

### Pointer down on handle

Immediately:

1. contextual menu disappears
2. handle enlarges very slightly
3. loupe appears
4. selected range remains
5. opposite handle stays fixed

Something like:

```text
scale 1.0 → 1.08
80–100ms
```

Not 1.3x.

---

# 5. Handle dragging

The handle should visually follow the finger, but the text boundary should snap to actual caret positions.

So internally:

```text
finger position
     ↓
visual handle
     ↓
nearest caret
     ↓
DOM Range endpoint
```

Do **not** make the handle visually jump character-to-character.

Its motion can be continuous while the selection boundary itself moves discretely.

This tiny distinction contributes enormously to perceived quality.

---

# 6. Loupe / magnifier

When precision matters, show a loupe.

Only show it while:

* long-press selecting
* dragging a start handle
* dragging an end handle

Don't keep it visible after release.

Suggested dimensions:

```text
diameter: 124–132 px
magnification: ~1.45x
```

Position:

```text
finger
   ↓

     ╭─────────╮
     │ enlarged│
     │  text   │
     ╰─────────╯
         ↑
        gap
         ↑
         ●
```

Keep it about **18–28px above the finger/handle**.

If near the top of the viewport, move it below or slightly lateral instead of clipping it.

### Loupe movement

It should track at screen refresh rate.

No React rerender for every raw pointer event.

Use RAF scheduling:

```text
pointermove
→ save latest position
→ requestAnimationFrame
→ measure
→ update transform
```

### Loupe entrance

Very subtle:

```text
opacity 0 → 1
scale .96 → 1
~100 ms
```

Exit:

```text
opacity 1 → 0
~80 ms
```

Do not make it bounce.

---

# 7. Crossing handles

Students will eventually drag one endpoint across the other.

Don't break the selection.

Example:

```text
START ●──────● END
```

User moves start past end:

```text
           END?
              ●────●
```

The engine should switch semantic roles:

```text
start becomes end
end becomes start
```

without the visual disappearing.

The student's mental model remains:

> I'm extending the side under my finger.

Don't expose the internal direction reversal.

This needs explicit tests.

---

# 8. Word snapping

Initial long press should select the **whole word**, not one character.

Use `Intl.Segmenter`.

Important for your environment because English-only regex assumptions will eventually cause strange behavior with Thai or multilingual text.

Initial:

```text
The researchers discovered...
    ^ press

→ researchers
```

Then dragging a handle should operate at **character/caret precision**, not keep snapping whole words.

This gives:

```text
initial selection = semantic
adjustment = precise
```

which is the right interaction.

---

# 9. Contextual menu

Don't make this another SAT card.

It should feel attached to the selected text.

Something closer to:

```text
╭────────────────────────────────────╮
│ Highlight   Underline   Note   ••• │
╰────────────────────────────────────╯
```

Not:

```text
┌─────────────────────────────────┐
│ Highlight & Notes               │
│                                 │
│ Choose a highlight color        │
│ 🟡 🔵 🟢 🩷                      │
│                                 │
│ Underline     Add note          │
└─────────────────────────────────┘
```

The first version is direct manipulation.

The second feels like a form.

### Menu dimensions

Approximately:

```text
height:        44–48px
border radius: 12–14px
item height:   40px+
horizontal pad: 12–14px
gap:            2–4px
```

Touch target remains ≥44px.

---

# 10. Contextual menu visual language

For your application I'd use a material like:

```css
background:
  color-mix(in srgb, var(--surface) 88%, transparent);

backdrop-filter:
  blur(18px) saturate(1.35);

border:
  1px solid rgba(... very subtle ...);

box-shadow:
  0 8px 30px rgba(...),
  0 1px 2px rgba(...);
```

But be careful: **premium does not mean more blur**.

Most of the quality comes from:

* positioning
* spacing
* typography
* motion
* correct touch behavior

not glassmorphism.

---

# 11. Menu positioning

Default:

```text
        contextual menu
               ↓
      ╭────────────────╮
      ╰────────────────╯

selected sentence here
●────────────────────●
```

Use this priority:

```text
1. Above selection
2. Below selection
3. Shift horizontally into viewport
4. Clamp to visual viewport
```

Never cover the selected words if you can avoid it.

Use:

```text
window.visualViewport
```

not only `window.innerHeight`.

Important on iOS with browser chrome / keyboards.

---

# 12. While handles are being moved

Hide the menu.

```text
SELECTED
menu visible

        ↓ grab handle

ADJUSTING
menu hidden
loupe visible

        ↓ release

SELECTED
loupe hidden
menu returns
```

Don't have:

```text
loupe
+
handles
+
menu
+
note UI
+
color controls
```

all visible at once.

Apple-like interaction quality comes heavily from **progressive disclosure**.

---

# 13. Highlight interaction

I'd simplify SAT's action substantially.

Initial menu:

```text
[ Highlight ] [ Underline ] [ Note ]
```

Tap Highlight:

```text
[ ● Yellow ] [ ● Green ] [ ● Blue ] [ ● Pink ]
```

or:

```text
       ┌─────────────┐
       │ ● ● ● ●     │
       └─────────────┘
```

The student doesn't need color choices before deciding they want a highlight.

### Default color

Give Highlight a remembered/default color.

So tapping Highlight itself could immediately apply:

```text
Highlight
→ yellow
```

while tapping its chevron / long press exposes colors.

Potential control:

```text
[ Highlight ⌄ ]
```

One tap = default.

Chevron = colors.

This is considerably faster during an exam.

---

# 14. Applying an action

When Highlight is applied:

Do not abruptly remove everything in the same frame.

Use a transition:

```text
blue temporary selection
        ↓
yellow persisted highlight
        ↓
handles fade
toolbar fades
```

Approximately:

```text
temporary selection → annotation: 120–160 ms
toolbar exit: 80–120 ms
```

The text should visually appear to **become the highlight**.

This communicates:

> Your action succeeded.

without a toast.

That is stronger UX than displaying "Highlight added."

---

# 15. Underline interaction

Same idea:

```text
temporary blue selection
        ↓
underline draws in / appears
        ↓
temporary selection fades
```

Don't animate the underline stroke across a 3-line passage.

Simple opacity is enough.

---

# 16. Note interaction

When Note is tapped, keep the relationship to the text visible.

Don't immediately erase the selection and make a disconnected panel appear.

Better:

```text
selected phrase remains softly highlighted

       ↓

note composer appears
```

On tablet/desktop, this can use your existing note side/panel pattern.

On narrow screens, use a compact sheet.

But visually preserve:

```text
selected text ↔ note
```

The student should always know what the note belongs to.

---

# 17. Tap outside

When selection is active:

```text
tap unrelated prose
→ selection dismissed
```

But be careful:

```text
tap inside menu
→ command
```

```text
tap selection handle
→ adjustment
```

```text
tap selected text
→ keep selection
```

I'd allow a second tap on selected text to keep the menu open rather than dismissing it.

---

# 18. Scroll while selection exists

This is subtle.

After selection is established:

```text
two-finger / ordinary content scroll
→ selection remains
→ handles reposition
→ toolbar follows selection
```

If selection scrolls fully offscreen:

```text
toolbar fades out
handles disappear visually
selection state remains
```

When the text returns:

```text
handles/menu can return
```

Don't pin the contextual toolbar to the viewport like a floating unrelated control.

---

# 19. Drag selection toward screen edge

Add autoscroll.

If the finger approaches:

```text
top 36–48 px
bottom 36–48 px
```

start scrolling progressively.

Not:

```text
inside → no movement
1px past threshold → 400px/s
```

Use a velocity curve.

Example:

```text
edge distance 48px → very slow
24px → medium
4px  → fast
```

Cap the speed so it remains controllable.

---

# 20. Pointer capture

Once a handle or selection drag is claimed:

```ts
element.setPointerCapture(pointerId)
```

This is important.

The user can drag slightly outside the text, handle, passage, or even component and the selection remains coherent.

Then:

```text
pointerup
pointercancel
unmount
mode disabled
```

must always release/reset correctly.

No stuck-selection state.

---

# 21. iPad + trackpad

Do not treat an iPad as universally "touch."

Pointer type matters more than device identity.

### Finger

Use:

```text
custom Range selection
custom handles
custom loupe
```

### Trackpad / mouse

Keep desktop behavior:

```text
native drag selection
```

or progressively map it into your custom toolbar after selection.

Do not show big touch handles under a mouse.

---

# 22. Samsung / Android

Same custom touch UI.

Android can technically expose vibration through:

```ts
navigator.vibrate()
```

but I would **not make haptic feedback a requirement**.

If used:

```text
initial selection claim → tiny 8–12ms vibration
```

only where supported.

Never vibrate repeatedly as every character changes.

iOS web won't give you equivalent native haptics, so visual feedback must be sufficient on its own.

---

# 23. Finger occlusion

Don't put critical feedback directly underneath the finger.

For handle dragging:

```text
actual caret     │
                 ●
                  \
                   finger center
```

You can offset visual feedback a few pixels so the handle remains readable.

The loupe solves the more important precision issue.

---

# 24. Motion system

Use `motion`, which the repo already has, but animation should be nearly invisible.

Recommended motion vocabulary:

| Interaction       | Motion                         |
| ----------------- | ------------------------------ |
| selection appears | 70–100ms opacity               |
| handle appears    | 90–120ms opacity + scale .94→1 |
| menu appears      | 100–140ms opacity + y 4→0      |
| menu disappears   | 70–100ms                       |
| loupe appears     | 80–110ms opacity + scale       |
| handle release    | spring settle                  |
| action completed  | 120–160ms crossfade            |

For spring settles:

```ts
{
  type: "spring",
  stiffness: 500,
  damping: 38,
  mass: 0.65
}
```

As a starting point, not a sacred value.

Avoid:

* overshoot
* rubbery bounce
* slow 300ms transitions
* menu flying across the screen

---

# 25. Reduced motion

Honor:

```css
@media (prefers-reduced-motion: reduce)
```

Change transitions into almost immediate opacity changes.

Selection functionality should never depend on movement.

---

# 26. Context menu microstates

Each action needs four states:

```text
rest
pressed
selected/current
disabled
```

Pressed should be visible immediately.

For example:

```text
pointerdown
background becomes ~6–8% darker
scale 1 → .98
```

```text
pointerup
scale .98 → 1
```

Very small.

Do not implement large button bounce.

---

# 27. Highlight tool state

This is especially important because you've already had UX problems here.

The SAT header control must clearly communicate:

```text
Highlights & Notes OFF
```

versus:

```text
Highlights & Notes ON
```

When ON:

* icon/state changes
* background/ink state changes
* possibly tiny animated transition
* `aria-pressed=true`

Don't rely on a tooltip.

Example:

```text
OFF

[ 🖍 Highlights & Notes ]


ON

[ 🖍 Highlights & Notes ✓ ]
```

or active tint without the literal checkmark if that looks cleaner.

The state itself must be visually unmistakable.

---

# 28. Don't show instructions

Avoid:

> “Drag over text to highlight it.”

> “Long press to select a word.”

> “Use the handles to adjust your selection.”

If the interaction needs all that, the interaction is wrong.

At most, for the **first-ever activation** of Highlight mode, one transient message could say:

```text
Select text to highlight or add a note
```

and disappear after first successful use.

After that, never show it again.

---

# 29. What happens on mistakes

Everything should be cheap to recover from.

### Selected wrong text

Drag handles.

### Changed mind

Tap outside.

### Wrong highlight color

Tap existing highlight → color control.

### Wrong note

Tap marked text / note marker → edit.

### Selection gets weird

Escape / outside tap resets it.

Never force the student through confirmation dialogs.

---

# 30. Keyboard

Even though this pass is touch-focused, don't regress keyboard.

Desktop behavior:

```text
Shift + Arrow
→ browser/custom selection

selection finished
→ contextual actions available
```

Toolbar:

```text
Tab
Arrow keys
Enter / Space
Escape
```

Escape hierarchy:

```text
color palette open
→ close palette

menu active
→ close menu

selection active
→ clear selection
```

One Escape level at a time.

---

# 31. Accessibility hit regions

Handles are unusual controls, so expose usable semantics where possible.

Visually:

```text
●
```

Interactively:

```text
44×44 px button-like target
```

For screen reader users, don't force them to manipulate visual drag handles. Keep the keyboard/native selection path as the accessible alternative.

The loupe and blue selection overlays should be:

```tsx
aria-hidden="true"
```

---

# 32. Selection across paragraphs

For SAT, I would intentionally constrain touch selection to the same semantic text block initially, because your anchor model already works this way.

If student begins:

```text
Paragraph A...
       ↓
drags into Paragraph B
```

don't suddenly clear selection.

Clamp to the valid boundary:

```text
Paragraph A selected until its final character
```

This feels much less broken.

If later you want cross-block selection, change the anchor model deliberately rather than faking it in the UI.

---

# 33. Math / images / answer controls

Selection should never swallow controls.

Exclude:

```text
button
input
textarea
select
links where appropriate
contenteditable
math controls
images
answer options
annotation toolbar
note editor
```

Dragging across an image should either skip it or stop at the text boundary.

Do not allow the custom Range engine to turn answer UI into selectable prose.

---

# 34. Visual hierarchy

At any moment, the student should see at most:

### Selecting

```text
selection
handle/finger feedback
loupe
```

### Selected

```text
selection
2 handles
context menu
```

### Adjusting

```text
selection
2 handles
loupe
```

### Choosing color

```text
selection
2 handles
color palette
```

### Editing note

```text
persisted text anchor
note UI
```

This is the rule I would enforce:

> **Never show every selection control simultaneously.**

That will make the experience feel much calmer.

---

# 35. Component design

For the frontend, I would target this composition:

```tsx
<SelectionFloatingLayer>
  <SelectionHighlight />

  <SelectionHandle
    edge="start"
  />

  <SelectionHandle
    edge="end"
  />

  {state === "adjusting" && (
    <SelectionLoupe />
  )}

  {state === "selected" && (
    <SelectionActionMenu>
      <HighlightAction />
      <UnderlineAction />
      <NoteAction />
      <MoreAction />
    </SelectionActionMenu>
  )}

  {state === "choosing-highlight-color" && (
    <HighlightColorPalette />
  )}
</SelectionFloatingLayer>
```

The visual layer should not know how SAT annotations are persisted.

It gets:

```ts
selection
geometry
state
actions
```

and renders the interaction.

---

# 36. UI tokens I'd establish

Instead of component-specific magic numbers:

```ts
selectionUI = {
  handleVisualSize: 10,
  handleHitSize: 44,

  menuHeight: 46,
  menuRadius: 13,
  menuGap: 8,

  loupeSize: 128,
  loupeScale: 1.5,

  edgeAutoScrollZone: 44,

  longPressMs: 340,
  movementTolerance: 8,

  motionFast: 90,
  motionNormal: 130,
}
```

Use shared tokens so IELTS and SAT feel like the same product.

---

# 37. Most important microinteraction sequence

If I were reviewing this as the UX acceptance test, this is the sequence I would care about most:

```text
Student touches "researchers"
        ↓
holds ~340ms
        ↓
"researchers" softly turns blue
        ↓
small loupe appears
        ↓
student moves finger
        ↓
selection follows naturally
        ↓
finger released
        ↓
loupe disappears
        ↓
two handles settle into place
        ↓
floating contextual menu fades in
        ↓
student grabs right handle
        ↓
menu disappears instantly
        ↓
loupe returns
        ↓
range extends precisely
        ↓
release
        ↓
loupe disappears
        ↓
menu returns in its new position
        ↓
tap Highlight
        ↓
blue selection becomes yellow highlight
        ↓
handles/menu dissolve
```

If **that one sequence feels excellent**, most of the system will feel excellent.

## What I would specifically avoid

Do not recreate iOS visually pixel-for-pixel while ignoring interaction quality. Avoid giant cards, text-heavy helper copy, menus that cover the selection, handles that are difficult to touch, `getClientRects()` + React state on every raw pointer event, toolbar movement while the finger is dragging, selection disappearing on pointerup, full-screen bottom sheets for simple Highlight actions, independent SAT and IELTS selection UI implementations, or a custom visual language on mobile and a completely different interaction grammar on iPad.

The right direction is **native-feeling behavior with Warwick's visual identity**, not an Apple screenshot copied into the browser.

For the next implementation pass, I would treat **selection highlight + handles + loupe + contextual menu + all pointer states as one shared UI system**, and keep SAT responsible only for what `Highlight`, `Underline`, and `Note` actually do.
