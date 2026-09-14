# Skill: React State Architecture

## Purpose

Own state boundaries, controlled/uncontrolled behavior, async state, and the
separation between product state and component presentation.

## Mental Model

State belongs at the lowest layer that must coordinate it.

```text
local ephemeral UI state
→ local component

shared feature state
→ feature owner

server state
→ server-data layer

global application preference
→ app/global store
```

Do not infer state from DOM appearance.

Bad:

```tsx
const selected = el.classList.contains("selected");
```

Good:

```tsx
const [selected, setSelected] = useState(false);
```

## Controlled vs Uncontrolled

Use controlled behavior when:

- the application owns the value;
- validation depends on it;
- multiple components coordinate around it;
- persistence/URL/server state exists.

Use uncontrolled/local behavior when:

- state is purely temporary;
- no external observer needs it;
- the component already manages the behavior safely.

## Async State

Prefer explicit state models:

```text
idle
pending
success
error
```

For complex workflows, consider state machines or discriminated unions before
adding many independent booleans.

Example:

```ts
type SaveState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "success" }
  | { status: "error"; message: string };
```

## Decision Rules

If UI state affects URL/shareability:
→ consider router/search state.

If state represents server data:
→ avoid duplicating it unnecessarily in local state.

If several booleans can form impossible combinations:
→ use a discriminated union/state machine.

If component props already expose controlled value/onChange:
→ use them instead of DOM synchronization.

## Anti-Patterns

- `isLoading`, `isSuccess`, `isError` all independently true-able;
- storing derived values separately;
- synchronizing props to state with effects without need;
- feature logic embedded inside style wrapper components.

## Performance

Do not memoize everything. Optimize after identifying actual render cost.

Prefer:

- stable component boundaries;
- derived values computed cheaply;
- colocated state;
- avoiding global state for local interactions.

## Testing

Test meaningful state transitions:

```text
idle → pending → success
idle → pending → error → retry
invalid → valid
open → close
```
