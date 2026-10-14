# SAT staff recovery routing — specification

## Verification target

Three behaviours the SAT staff authoring surface shipped together, each of which
decides **where a staff member's recovery action lands**:

1. **Recovery routing.** `resolvePublishIssueDestination` maps every publish
   finding to exactly one destination — a question, a module, the scoring policy
   section — or to an explicit `unresolved` with a reason. Before this change
   only `examQuestion:<id>:<field>` paths produced a destination, so pressing
   *Fix* on a module-count or converter blocker closed the review and went
   nowhere.
2. **Deep-link consumption.** `useAuthoringSelection` treats
   `?question=<id>&field=<f>` and `?module=<section>.<module>` as an INPUT to
   the selection: consumed once, then removed from the URL, with normal
   selection rules applying from then on.
3. **Room target pinning.** `SatNewSessionFlow` captures one published version
   when room setup opens and keeps it for the whole form, while the overview
   query keeps polling and another author may publish.

**Authoritative state.** The published version, the finding list and the shell
belong to the backend. This operation reads projections of them; the only state
it owns is the author's client: the resolver's output, the URL parameters, the
selection, and the pinned target.

**Observable outcome.** (a) A rendered recovery action either has a destination
the loaded draft can honour, or has no action and shows a reason. (b) A pressed
action lands on the exact object the finding named. (c) A created room is
created on the version the flow pinned when it opened.

**Out of scope.** Server-side validation, SQL and transaction behaviour, the
publish POST itself, multi-author linearizability, React reconciliation and
effect scheduling, browser URL history semantics, WCAG conformance, capacity.

## Requirements

| ID | Guarantee | Classification |
| --- | --- | --- |
| R1 | Every finding resolves to exactly one destination; a module destination always names a section the loaded shell recognises and a module that shell does not map as absent. | Safety |
| R2 | A module path whose section is known and whose module the shell does not deny resolves to that module — including when the shell carries sections but no modules (an incomplete map is not evidence of absence). | Safety (completeness) |
| R3 | A shell that maps modules but not this one produces `unresolved` with a reason and no action label — never another module. | Safety |
| R4 | The action label is absent for exactly the destinations that have nowhere to go. | Safety |
| R5 | No path is routed as a module by the module regex alone: a leaked field path such as `answer.options` is refused, with and without a loaded shell. | Safety |
| R6 | A `?module=` link is consumed exactly once: after one run the parameter is gone, and a link naming a module this shell lacks is consumed without adopting. | At-most-once |
| R7 | Adoption requires an injected, resolvable link; no reachable editor state has adopted more links than were injected, so a re-render with no pending link adopts nothing. | At-most-once |
| R8 | A room flow pins exactly one version, taken at capture; a snapshot reporting a republish cannot move it, and create sends the pinned target. | Ordering / consistency |
| R9 | The version a room was created on is always the version its flow pinned (reachable invariant). | Ordering / consistency |
| R10 | An explicit reopen is a new flow: the old pin is discarded and the then-current publication is pinned. | Recovery (deliberate boundary) |
| R11 | The legacy handler, the regex-only router, the guess-first-module router, the refuse-unmapped router, the link-ignoring consumer and the re-derive-every-poll pin each produce their specific bad outcome on real inputs. | Safety (refutation of alternatives) |
| R12 | A question or field deep link this shell cannot honour is consumed and dropped from the URL instead of remaining to fire when the shell contains that question again. | At-most-once / recovery |

R12 was **found by this engagement**: the module link already behaved this way,
the question link did not. See `RECOMMENDATIONS.md`.

## Formal envelope

The Lean project models:

- the finding's path as a character sequence, with the resolver's branch
  structure, its two prefix tests, its module-path shape test, and its two shell
  predicates (`knownSection`, `shellDeniesModule`) transcribed from the source;
- a `ModuleShell` of modules over an `Editor` with a pending link, a selection
  and two ghost counters (links injected, links adopted), with its own
  `EditorReach` relation;
- a `Room` with the latest snapshot, the pinned target, the sent version and a
  ghost first-observed field, with its own `RoomReach` relation.

The model is one client and one flow. It does **not** model React, effect
scheduling, timers, the network, the backend, the shell's own lifecycle, or the
question-id lookup used by the question deep link. `ASSUMPTIONS.md` lists every
assumption these omissions require, with its owner.

Each named theorem is a statement about this model's `resolve`, `consume` and
`roomStep` functions. The concrete theorems under
"Kernel-evaluated instances on the real paths" are additionally the model's
resolver executed by the kernel on the actual product strings.

The following are intentionally **not** formal claims: that the TypeScript is a
semantics-preserving translation of the model (that is a correspondence claim,
reviewed and tested, not mechanized); SQL or API behaviour; at-most-once
database effects; multi-author linearizability; rendering under permanent
failure; capacity; production readiness.
