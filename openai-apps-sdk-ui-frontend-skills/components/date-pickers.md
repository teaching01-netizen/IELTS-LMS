# Skill: Date Pickers

## Purpose

Implement date and date-range selection using `DatePicker` and
`DateRangePicker` while keeping calendar semantics, validation, locale, and
business rules clear.

## Mental Model

Separate:

```text
stored date meaning
display formatting
timezone behavior
selection constraints
```

Do not mix them casually.

## Decision Rules

Single date:
→ DatePicker.

Start/end interval:
→ DateRangePicker.

Exact timestamp:
→ date selection plus a time mechanism appropriate to the product.

If business logic uses date-only values:
→ avoid unnecessary timezone conversion that changes the calendar day.

## Constraints

Consider:

- minimum date;
- maximum date;
- disabled dates;
- unavailable ranges;
- start after end;
- open-ended range if allowed;
- locale;
- timezone;
- server serialization.

## UX

- Make current selection obvious.
- Explain unavailable dates when useful.
- Avoid resetting a partially chosen range unexpectedly.
- Keep error feedback near the control.
- Preserve keyboard navigation from the library.

## Anti-Patterns

- hand-built calendar grid without need;
- silently converting a date-only value through UTC and changing the day;
- allowing invalid range then only failing on server;
- using placeholder-only date meaning.

## Testing

Test:

```text
first/last allowed date
disabled dates
range boundaries
month/year transitions
locale formatting
timezone-sensitive values
keyboard navigation
narrow viewport
```
