# Traceability

Status fields are separate on purpose: a proved theorem does not prove the
TypeScript, and neither proves the deployed behaviour.

- **Formal**: `PROVED` / `FAILED` / `NOT_RUN` — about the Lean statement only.
- **Correspondence**: `MECHANIZED` / `REVIEWED_WITH_TESTS` / `UNVERIFIED` / `MISMATCH` — about the mapping to the source.
- **Production**: `VALIDATED_IN_STATED_PROFILE` / `PARTIAL` / `NOT_TESTED` / `FAILED`.

| REQ | Theorem (Lean) | Source anchor | Test oracle | Formal | Correspondence | Production |
| --- | --- | --- | --- | --- | --- | --- |
| R1 | `Routing.question_destination_has_id`, `module_destination_requires_known_section`, `module_destination_is_not_denied_by_the_shell`, `module_destination_is_honourable` | `releaseSelectors.ts:378-415` | `releaseSelectors.test.ts:305` (`resolvePublishIssueDestination`) | PROVED | REVIEWED_WITH_TESTS | NOT_TESTED |
| R2 | `Routing.module_path_resolves_to_that_module`, `Routing.resolve_module_finding_without_a_module_map` | `releaseSelectors.ts:396-410` | `releaseSelectors.test.ts:340-350` (moduleless shell accepts) | PROVED | REVIEWED_WITH_TESTS | NOT_TESTED |
| R3 | `Routing.denied_module_is_refused_not_guessed`, `Routing.resolve_missing_module_is_refused` | `releaseSelectors.ts:401-406` | `releaseSelectors.test.ts:330-360` (refusal + reason) | PROVED | REVIEWED_WITH_TESTS | NOT_TESTED |
| R4 | `Routing.label_none_is_unresolved`, `Routing.actionable_destination_has_a_label`, `Routing.labels_match_the_destinations` | `releaseSelectors.ts:417-431` | `releaseSelectors.test.ts:366-369`; `ReadinessPanel.tsx:159`, `ExamPublishSheet.tsx:368`, `authoringWorkspaceSurfaces.tsx:72` consume the label | PROVED | REVIEWED_WITH_TESTS | NOT_TESTED |
| R5 | `Routing.resolve_leaked_field_path_is_refused` (+ `_without_a_shell_`) | `releaseSelectors.ts:340-408` | `releaseSelectors.test.ts:352-355` | PROVED (kernel-evaluated on `answer.options`) | REVIEWED_WITH_TESTS | NOT_TESTED |
| R6 | `DeepLink.consume_clears_pending`, `stale_link_is_consumed_without_adopting`, `consume_idempotent` | `useAuthoringSelection.ts:197-220` | `useAuthoringSelection.test.tsx:195` (drops a module link this shell lacks) | PROVED | REVIEWED_WITH_TESTS | NOT_TESTED |
| R7 | `DeepLink.reachable_adoption_account`, `reachable_adoptions_le_injections`, `adoption_requires_a_resolvable_link`, `consume_of_settled_no_link` | `useAuthoringSelection.ts:165-220` | `useAuthoringSelection.test.tsx` (adoption path + no re-adopt on rerender); `AuthoringWorkspace.test.tsx` | PROVED | REVIEWED_WITH_TESTS | NOT_TESTED |
| R8 | `Pinning.capture_of_set_target`, `capture_twice_is_capture_once`, `capture_takes_the_observed_version`, `create_ignores_a_later_snapshot`, `same_flow_actions_never_move_the_pin` | `SatNewSessionFlow.tsx:110-122`, `:162` | `SatSessionsRoute.test.tsx` "keeps the version it captured when a background refresh reports a newer release" | PROVED | REVIEWED_WITH_TESTS | NOT_TESTED |
| R9 | `Pinning.reachable_sent_is_the_pinned_target` | `SatNewSessionFlow.tsx:162` | `SatSessionsRoute.test.tsx:197` (`publishedVersionId: 'v-9'`) | PROVED | REVIEWED_WITH_TESTS | NOT_TESTED |
| R10 | `Pinning.reopen_repins_the_current_version` | `SatNewSessionFlow.tsx` (exam change / dialog reopen) | not covered | PROVED (deliberate boundary) | REVIEWED | NOT_TESTED |
| R11 | `Counterexamples.legacy_handler_dead_ends_on_a_module_finding`, `routing_by_regex_alone_misroutes_a_field_path`, `guessing_the_first_module_misroutes`, `refusing_unmapped_modules_dead_ends`, `ignoring_the_link_opens_the_first_module_instead`, `recomputing_the_target_from_every_poll_moves_the_pin`, `the_shipped_pin_survives_a_republish` | the alternatives, not the source | kernel-evaluated | PROVED | n/a (model alternatives; source shapes reviewed) | NOT_TESTED |
| R12 | `DeepLink.stale_link_is_consumed_without_adopting` applied to the question/field link (payload-agnostic), `DeepLink.consume_clears_pending` | `useAuthoringSelection.ts:165-196` | `useAuthoringSelection.test.tsx:205` and `:225` (added by this fix; both failed before it) | PROVED (for the consume rule) | REVIEWED_WITH_TESTS | NOT_TESTED |

## Non-vacuity

- `Routing.resolve_module_finding*` show the resolver accepts the real module
  finding with a full shell, an incomplete map, and no shell at all.
- `Counterexamples.editor_link_trace_is_reachable` and
  `Counterexamples.room_republish_trace_is_reachable` show both reachability
  relations contain the hazardous interleavings; `#eval` prints the states.
- `Routing.resolve_module_finding` is red if the section check is dropped, and
  `resolve_leaked_field_path_is_refused` is red if it is weakened: the pair is a
  discriminating test of the guard, not a restatement of the definition.

## Residual correspondence gaps

1. **The question-id lookup is unmodelled (A10).** The model proves the
   *consumption* rule (strip once, adopt only when resolvable) for an arbitrary
   link payload, which is what both UI paths now implement. Which module a
   question id resolves to is reviewed and tested, not proved.
2. **React effect scheduling is unmodelled (A13).** "The pin is the first
   snapshot" holds in the model up to the interleaving; the runtime reading is
   an assumption.
3. **The string layer is a re-implementation (A6, A7).** Paths are modelled as
   character sequences because the pinned kernel cannot reduce Lean's
   `String` primitives; the three primitives used are transcribed.
4. **The shell is an input, not a state machine (A15).** Shell replacement is
   modelled by consuming with a different shell, not by the shell's own
   refetch/draft lifecycle.
