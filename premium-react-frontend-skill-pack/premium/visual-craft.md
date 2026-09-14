# Skill: Premium Visual Craft

## Purpose

Add high-end visual refinement after hierarchy, interaction, accessibility, and layout are already correct.

## Mental Model

Premium craft comes from controlling contrast, rhythm, alignment, texture, depth, and state with restraint.

## Hierarchy

Use a hierarchy stack:

1. position and grouping;
2. spacing;
3. typography;
4. tone/color;
5. borders/elevation;
6. motion/decorative detail.

Do not jump directly to shadows and gradients.

## Surfaces

Define a small number of surface roles:

- canvas;
- raised panel;
- interactive surface;
- selected/accented surface;
- modal surface.

Avoid “cardification”: not every section needs a rounded rectangle.

## Borders

Use borders when they clarify structure, not by default.

Subtle separators can outperform a full box around every group.

## Elevation

Elevation should represent layering/interaction, not decoration.

Use stronger elevation for temporary layered UI such as popovers and dialogs than for ordinary static sections.

## Radius

Use a coherent radius family.

Large radii feel soft and friendly but can make dense software look toy-like when overused.

## Color

Use accent color deliberately.

Most of the interface can remain neutral so primary actions and selected states carry weight.

## Iconography

- use one icon family/style;
- keep stroke/fill language coherent;
- align icons optically, not only mathematically;
- avoid decorative icons that do not improve recognition.

## Invisible Craft

Review details such as:

- baseline alignment;
- 1px border continuity;
- icon/text optical spacing;
- focus ring clipping;
- sticky header transitions;
- scrollbar interaction;
- safe-area spacing;
- truncation boundaries;
- selected-row background continuity;
- cursor choice;
- resize affordance visibility;
- scroll shadows only when needed to imply hidden content.

## Anti-Patterns

- shadows on every card;
- gradient text for routine labels;
- multiple competing accent colors;
- giant corner radii everywhere;
- low contrast in pursuit of subtlety;
- decorative blur behind dense reading content;
- excessive glass effects;
- random icon sizes.
