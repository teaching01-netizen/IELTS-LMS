# Skill: UI Primitives and Controls

## Purpose

Build buttons, icon buttons, links, inputs, toggles, tabs, segmented controls, and other high-frequency primitives that feel precise and trustworthy.

## Principles

Controls must communicate:

- what they are;
- whether they are interactive;
- current state;
- available action;
- response to interaction.

## Buttons

Use `<button>` for actions and `<a>` for navigation.

A button system should define:

- hierarchy: primary, secondary, quiet, destructive where needed;
- size/density;
- leading/trailing icon behavior;
- loading behavior;
- disabled behavior;
- focus-visible treatment;
- pressed feedback.

Avoid multiple “primary” buttons in the same decision region.

## Icon Buttons

- use only when the icon is recognizable in context;
- provide an accessible name;
- provide a large enough hit area;
- do not rely on tiny glyph bounds as the pointer target;
- show tooltip support when discoverability benefits.

## Inputs

Inputs should have:

- persistent label unless a justified alternative exists;
- clear focus state;
- clear invalid state;
- useful error/help relationship;
- comfortable hit area;
- no surprise format destruction while typing.

Placeholder text is not a replacement for a label.

## Selection Controls

Use the control whose mental model matches the task:

- checkbox: independent on/off selection;
- radio: one of a small set;
- switch: immediate binary setting;
- tabs: switch related views;
- segmented control: compact mutually exclusive choice with few options.

## Premium Craft

- align icon and text optically;
- make pressed response immediate;
- keep state transitions subtle;
- avoid changing dimensions between states;
- keep control height/radius consistent with the system;
- ensure focus ring does not get clipped.

## Anti-Patterns

- clickable divs;
- hover-only affordance;
- disabled controls with no explanation when the reason matters;
- loading buttons that shift width dramatically;
- icon-only destructive actions with weak discoverability;
- labels that disappear after focus.
