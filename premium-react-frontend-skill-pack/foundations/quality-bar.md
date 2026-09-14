# Skill: Premium Frontend Quality Bar

## Purpose

Define what “advanced”, “modern”, and “premium” should mean in a real product so the implementation does not confuse fashion with quality.

## Use This Skill When

- setting design direction;
- reviewing an existing UI;
- deciding whether a redesign is actually better;
- comparing multiple frontend implementation options;
- turning vague quality requests into measurable criteria.

## Mental Model

Premium quality is accumulated precision.

Users notice the result as a feeling, but that feeling is produced by concrete details: predictable layout, readable text, clean hierarchy, instant feedback, coherent states, excellent control behavior, stability, continuity, and restraint.

## Quality Dimensions

### 1. Clarity

A user should quickly understand:

- where they are;
- what matters most;
- what they can do;
- what changed after an action;
- what to do after an error.

### 2. Coherence

Similar things behave similarly. The same visual role should not change meaning across the product.

### 3. Craft

Edges line up. Text wraps intentionally. Icons sit optically centered. Loading does not jump. Menus open from believable anchors. Focus does not disappear. Pressed states respond immediately.

### 4. Restraint

Use fewer strong visual elements. Every accent competes for attention.

### 5. Robustness

The UI survives:

- long text;
- empty data;
- slow data;
- failed requests;
- zoom;
- keyboard input;
- touch input;
- narrow widths;
- large widths;
- reduced motion;
- localization.

## Decision Rules

If the design needs many borders to separate content → hierarchy or spacing is probably weak.

If several elements are “primary” → none are primary.

If the user must hover to discover an essential action → redesign the affordance.

If a layout only looks good with ideal content → it is not production-ready.

If an effect does not improve hierarchy, context, feedback, or delight without adding friction → remove it.

## Anti-Patterns

- glassmorphism everywhere;
- random gradients used as a shortcut for “modern”;
- oversized rounded rectangles around every section;
- low-contrast gray text on gray surfaces;
- icon-only interfaces where labels would improve comprehension;
- excessive center alignment for dense or operational content;
- animation on every state change;
- desktop layouts simply squeezed onto mobile;
- giant hero spacing in productivity interfaces;
- shadow systems with no elevation semantics.

## Review Heuristics

Ask:

- Can I identify the primary action in under three seconds?
- Can I distinguish interactive from static content?
- Does the layout still work at 200% zoom?
- Does content remain readable with realistic text lengths?
- Is any motion blocking the task?
- Are loading and failure states as carefully designed as success?
- Does the page feel like one system rather than many locally designed widgets?

## Production Checklist

- clear hierarchy;
- consistent component behavior;
- semantic state system;
- accessible contrast and focus;
- responsive adaptation;
- stable layout;
- resilient content handling;
- minimal visual noise;
- predictable motion;
- error recovery;
- tested keyboard/touch behavior.
