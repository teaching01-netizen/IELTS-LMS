# Skill: Production Review Checklist

## Purpose

Provide the final acceptance gate before an Apps SDK UI implementation is
considered production-ready.

## Design System

- [ ] Correct Apps SDK UI primitive chosen
- [ ] Exact current APIs verified
- [ ] No unnecessary duplicate primitive
- [ ] Semantic tokens used
- [ ] No unnecessary raw colors
- [ ] Typography scale respected
- [ ] No brittle selectors into undocumented internals

## Installation / Integration

- [ ] Apps SDK UI CSS configured
- [ ] Tailwind package `@source` configured
- [ ] global CSS imported correctly
- [ ] production build preserves styles
- [ ] router integration configured where needed

## Interaction

- [ ] Primary action obvious
- [ ] Secondary actions subordinate
- [ ] Menu used only for menu semantics
- [ ] Popover used for contextual arbitrary content
- [ ] navigation uses links
- [ ] async actions show pending state
- [ ] duplicate submit prevented

## Responsive

- [ ] narrow layout works
- [ ] wide layout works
- [ ] long labels work
- [ ] long content works
- [ ] no accidental horizontal scroll
- [ ] fixed controls do not collapse
- [ ] overlays remain visible on-screen

## Theme

- [ ] light verified
- [ ] dark verified
- [ ] hover/focus/selected checked in both
- [ ] custom assets work on both
- [ ] custom product tokens have theme behavior

## Accessibility

- [ ] keyboard workflow works
- [ ] focus visible
- [ ] focus order logical
- [ ] all controls named
- [ ] forms labelled
- [ ] errors associated correctly
- [ ] color is not sole state indicator
- [ ] critical behavior does not depend on hover
- [ ] zoom/reflow works
- [ ] reduced motion remains usable

## States

Review relevant states:

```text
default
hover
focus-visible
active
selected
disabled
inert/read-only
loading
invalid
empty
success
error
partial/stale data
```

## Engineering

- [ ] state ownership clear
- [ ] no duplicated logic
- [ ] no unnecessary abstraction
- [ ] no unnecessary dependency
- [ ] business logic separated from presentation details
- [ ] TypeScript types preserved
- [ ] tests cover user-observable behavior

## Final Review Questions

1. What is the user's primary task?
2. Is the main action immediately discoverable?
3. Are we using the right primitive?
4. Can the task be completed with keyboard only?
5. Does the layout survive narrow width and long content?
6. Does it work in dark mode?
7. What happens when the network is slow or fails?
8. Which custom CSS could be removed?
9. Are any undocumented package internals being depended on?
10. Would a future Apps SDK UI upgrade likely break this implementation?
