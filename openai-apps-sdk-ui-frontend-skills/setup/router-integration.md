# Skill: Router Integration

## Purpose

Integrate Apps SDK UI link-capable components with the application's routing
system while preserving semantic navigation and external-link behavior.

## Use This Skill When

- using React Router, Next.js, or another client router;
- `TextLink`, `ButtonLink`, or menu links need internal navigation;
- replacing manual `onClick` navigation;
- distinguishing actions from navigation.

## Mental Model

```text
action → button semantics
navigation → link semantics
internal navigation → application router link
external navigation → anchor semantics
```

Do not convert navigation into buttons merely to reuse styling.

## Provider-Level Configuration

Apps SDK UI can receive the router link component through
`AppsSDKUIProvider`.

Example with React Router:

```tsx
import { AppsSDKUIProvider }
  from "@openai/apps-sdk-ui/components/AppsSDKUIProvider";
import { Link } from "react-router";

declare global {
  interface AppsSDKUIConfig {
    LinkComponent: typeof Link;
  }
}

export function Root() {
  return (
    <AppsSDKUIProvider linkComponent={Link}>
      <App />
    </AppsSDKUIProvider>
  );
}
```

This is useful when many components need consistent application routing.

## Component-Level Configuration

When global configuration is inappropriate, supported link components can be
provided at the component level via the documented `as` API.

Verify the installed component types before copying framework-specific examples.

## Decision Rules

If clicking changes application location:
→ prefer link semantics.

If clicking mutates state/submits/opens a panel:
→ prefer button semantics.

If internal routes are common:
→ configure the provider once.

If only one component needs a special router adapter:
→ prefer component-level configuration.

If opening an external URL:
→ preserve normal anchor behavior and security attributes.

## Anti-Patterns

```tsx
<span onClick={() => location.href = "/settings"}>Settings</span>
```

```tsx
<Button onClick={() => router.push("/dashboard")}>Dashboard</Button>
```

when the interaction is fundamentally navigation and link semantics are
available.

## Accessibility

Link text should describe destination. Button text should describe action.
Do not use generic repeated labels like "Click here" when the destination is
not obvious from context.

## Testing

Verify:

- keyboard activation;
- browser open-in-new-tab behavior where applicable;
- internal route transitions;
- focus behavior after navigation;
- external link attributes;
- no duplicate click handlers around links.

## Production Checklist

- [ ] provider configured if useful
- [ ] internal navigation uses router semantics
- [ ] external links remain anchors
- [ ] actions remain buttons
- [ ] no clickable `div`/`span` navigation
- [ ] exact installed link props verified
