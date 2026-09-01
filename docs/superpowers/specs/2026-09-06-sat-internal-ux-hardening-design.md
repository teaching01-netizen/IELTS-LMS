# SAT Internal UX Hardening Design

## Status

Approved design. Scope: implement all P1/P2 findings from the SAT internal workspace audit.

## Goal

Make the SAT staff workspace safer and more predictable for admins, builders, proctors, and graders without changing the existing backend contracts, route model, or SAT/IELTS provider boundaries.

## Change chain

```text
staff workflow
  → SAT route/component state
  → shared dialog/menu and validation behavior
  → mutation guard and feedback
  → rendered status/recovery state
  → focused unit tests
  → SAT E2E verification
```

## Architectural boundaries

- **Shared UI primitives** own keyboard semantics, focus behavior, dismissal, and ARIA contracts.
- **Scheduling form** owns client-side temporal validation; the persistence/API contract remains unchanged.
- **Proctor route/controller boundary** owns freshness/degraded state. The route consumes that state and gates risky actions.
- **Access-link dashboard** owns discoverability and action presentation but delegates mutations to existing query hooks.
- **Results route** owns user-facing filters and derived list presentation; result data contracts remain unchanged.

No new global store, backend endpoint, or duplicate source of truth is introduced.

## Functional design

### 1. Session scheduling validation

Add a pure validation helper for required values, parseable local datetimes, and `end > start`. The form displays errors near the relevant field and an alert summary when submission is blocked. Submitted values remain intact. The Schedule button remains disabled only for incomplete input or an active mutation; semantic validation remains visible on submit.

### 2. Proctor freshness and safety

Expose or derive the last successful detail refresh and degraded state from the existing proctor controller polling/live-update lifecycle. When loaded data is stale or reconnecting:

- show a persistent warning with the last successful update time;
- offer Retry;
- disable pause, resume, extend, terminate, and finish actions;
- keep read-only roster/session information visible;
- restore actions only after a successful refresh.

Normal pending-state duplicate prevention remains in place.

### 3. Accessible menus and dialogs

Use Radix primitives for access-link menus and revoke confirmation. Ensure:

- correct `menu`/`menuitem` semantics;
- Escape and outside-click dismissal;
- focus trap while dialogs are open;
- initial focus on the safe action;
- focus restoration to the trigger;
- descriptive title and consequence text;
- destructive actions remain explicitly labeled.

The existing SAT dialog primitives remain the preferred implementation path.

### 4. Access-link action discoverability

Keep Copy, Share, and More actions available without hover dependency. Maintain the selected-link detail actions as the primary touch-friendly path. Make row action buttons keyboard-visible and provide labels that include the link name.

### 5. Results workflow

Add lightweight client-side filters based on existing result fields:

- all results;
- score available;
- score unavailable;
- optional exam/cohort search remains supported.

Use explicit empty-state messaging for no data versus no filter matches. Do not alter scoring semantics.

### 6. Context and status visibility

Improve proctor detail visibility with last update/freshness information and clearer state language. Preserve current route structure unless a targeted change is required to maintain SAT context. Avoid broad navigation redesign.

## Error behavior

- Validation failures are field-local and preserve input.
- Network/degraded failures preserve visible data, clearly mark it stale, and offer retry.
- Mutation failures remain visible and do not silently dismiss the workflow.
- Destructive actions require explicit confirmation and never rely on color alone.
- Partial/batch behavior is unchanged unless an existing component exposes a missing result summary during verification.

## Testing strategy

Use red-green-refactor for each behavior:

1. Add a failing scheduling validation test; implement the pure validator and form rendering.
2. Add failing proctor degraded-state/action-gating tests; implement freshness state and controls.
3. Add failing menu/dialog keyboard tests; migrate the access-link controls.
4. Add failing touch/discoverability assertions for access-link actions.
5. Add failing result-filter and empty-state tests.
6. Run existing SAT tests after each green cycle.
7. Run typecheck, lint, SAT unit tests, AST parse/reference checks, and relevant E2E tests.

## Acceptance criteria

### Scheduling

Given an end time earlier than the start time, when the user submits, scheduling is blocked, an explanatory error is shown, and entered values remain.

### Proctoring

Given the session loses connectivity after initial load, the UI identifies stale data, shows the last successful update, disables risky mutations, and permits retry. After refresh succeeds, controls become available again.

### Dialog/menu accessibility

Given a user opens an access-link menu or revoke dialog, keyboard navigation, Escape dismissal, focus containment/restoration, and screen-reader semantics work without hover or pointer dependence.

### Access links

Given a touch or keyboard user views a link row, Copy, Share, and More actions are discoverable and operable without hover.

### Results

Given results exist, users can filter score availability and receive an accurate empty state when the filter matches nothing. Existing SAT score labels remain unchanged.

## Non-goals

- No backend schema/API changes.
- No redesign of student delivery.
- No change to SAT scoring or adaptive runtime behavior.
- No migration of all non-SAT internal UI.
- No broad route/navigation rewrite.

## Risks and mitigations

- **Controller freshness ambiguity:** inspect existing polling/live-update lifecycle before choosing the owning state; add tests around initial load, refresh success, and refresh failure.
- **Radix migration regressions:** retain accessible names and add interaction tests for pointer and keyboard paths.
- **Responsive regressions:** verify compact viewport behavior and touch-sized targets in the SAT E2E/accessibility configuration.
- **Dirty working tree:** limit edits to the approved change surface and review the final diff carefully.
