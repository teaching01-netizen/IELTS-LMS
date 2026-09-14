# Skill: Upgrades and Migrations

## Purpose

Upgrade Apps SDK UI safely while minimizing breakage from stale assumptions,
private APIs, or copied component source.

## Source-of-Truth Priority

When exact behavior is uncertain:

```text
1. installed TypeScript definitions
2. current official documentation
3. current Storybook examples
4. current component source
5. existing app wrappers
6. memory/assumptions
```

Do not reverse this order.

## Upgrade Workflow

1. Record current package version.
2. Read package/release changes when available.
3. Upgrade in an isolated branch.
4. Typecheck.
5. Build production bundle.
6. Fix public API changes.
7. Run component/integration tests.
8. Review visual regressions in both themes.
9. Re-test keyboard/focus behavior.
10. Remove obsolete workarounds.

## Safe Customization

Prefer:

```text
documented prop
→ semantic utility
→ small wrapper around public API
```

Avoid:

```text
copying package source
deep internal selector
monkey patch
private export
```

## Migration Heuristics

If many feature files directly depend on a volatile API:
→ consider one thin app-level adapter.

If only styling changed:
→ first inspect token/component changes before adding overrides.

If old custom primitive now exists in Apps SDK UI:
→ migrate progressively rather than maintaining duplicate behavior forever.

## Anti-Patterns

- upgrading package and ignoring CSS setup changes;
- pinning forever because of one undocumented override;
- copying old component implementation into the app;
- suppressing TypeScript errors with `any`;
- visual checking only one theme/viewport.

## Testing

Every meaningful upgrade should include:

```text
typecheck
production build
critical user flows
light/dark
narrow/wide
keyboard/focus
visual regression for critical UI
```

## Production Checklist

- [ ] exact installed version known
- [ ] public APIs only
- [ ] no new type errors hidden
- [ ] build succeeds
- [ ] style scanning still works
- [ ] critical flows pass
- [ ] both themes reviewed
- [ ] workarounds re-evaluated
