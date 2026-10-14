# SAT staff recovery routing — verification report

## Verdict

- **Formal model:** `PROVED`. Every statement in `Safety.lean` and
  `Counterexamples.lean` is checked by the pinned Lean 4.19.0 kernel; the axiom
  audit shows only `propext` (or nothing) in each dependency chain.
- **Correspondence:** `REVIEWED_WITH_TESTS`. The resolver, the module-link
  lookup and the pinning guard were compared with the source line by line, and
  the kernel-evaluated instances reproduce the source's outputs on the real
  paths. It is **not** mechanized: the TypeScript is not extracted from the
  model.
- **Production evidence:** `NOT_TESTED`. No authenticated live staff UI was
  available; the four Playwright staff journeys need MySQL, the Go API/worker
  and the coedit service and were not executed here.

**Overall production correctness: NOT ESTABLISHED.** Overall readiness for the
declared risk threshold: **CONDITIONAL** — see `RECOMMENDATIONS.md`.

What the model does **not** prove: SQL or API behaviour; the publish POST;
multi-author linearizability; React effect scheduling (so "the pin is the first
snapshot" is an assumption, A13); the question-id lookup behind the question
deep link (A10); rendering under permanent failure; capacity.

## Reproducible Lean evidence

Run from `verification/lean/sat-staff-recovery-routing/`:

```text
lean-toolchain: leanprover/lean4:v4.19.0
Lake project: satStaffRecoveryRouting 0.1.0
Dependencies: Lean core only; no external package
Lean: 4.19.0 (arm64-apple-darwin23.6.0)
```

```bash
lake build SatStaffRecoveryRouting Model Safety Counterexamples AxiomAudit
lake env lean AxiomAudit.lean
lake env lean Counterexamples.lean
```

Exit status: **0** for all three; transcripts in `evidence/lean-build.txt`,
`evidence/axiom-audit.txt` and `evidence/counterexamples-trace.txt`.

### Axiom audit

74 theorems are audited with `#check` and `#print axioms`:

- 51 depend on `[propext]` only.
- 23 depend on no axioms at all.
- No `Quot.sound`, no custom axiom, no `sorryAx`, no `sorry`, `admit`,
  `native_decide` or `unsafe` anywhere in `Model.lean`, `Safety.lean` or
  `Counterexamples.lean` (scanned).

The pinned 4.19.0 toolchain **does not ship `leanchecker`**
(`lake env leanchecker --help` → "does not have the binary"), so no independent
proof-checker result is claimed; the successful kernel build plus the axiom
audit are the available checks. `lake build` was run for every declared root.

## Proved theorem groups

**Routing — a Fix press always has an honourable destination**

- `question_destination_has_id`, `parseQuestion_id_ne_nil`: a question
  destination always names a non-empty question.
- `module_destination_requires_known_section`: a module destination names a
  section the loaded shell (or the SAT section contract) recognises.
- `module_destination_is_not_denied_by_the_shell` and the pair
  `module_destination_is_honourable`: it is never a module the shell maps as
  absent.
- `module_path_resolves_to_that_module` / `denied_module_is_refused_not_guessed`:
  completeness and refusal for the branches the caller reaches, with the prefix
  hypotheses discharged by evaluation below.
- `label_none_is_unresolved` / `actionable_destination_has_a_label`: the action
  label exists exactly for the actionable destinations.
- Kernel-evaluated on the real strings: `resolve_module_finding`,
  `resolve_module_finding_without_a_module_map`,
  `resolve_module_finding_without_a_shell`, `resolve_missing_module_is_refused`,
  `resolve_leaked_field_path_is_refused` (+ without a shell),
  `resolve_question_link`, `resolve_scoring_policy` (+ subsection),
  `resolve_unrecognised_path_is_refused`, `labels_match_the_destinations`.

**DeepLink — one consumption per link**

- `consume_clears_pending`: the parameter is gone after any run.
- `consume_idempotent`, `consume_of_settled_no_link`, `fallback_of_settled`:
  a second run is a no-op; a settled selection is never moved by a re-render.
- `consume_settled`, `fallback_settled`, `moduleForKey_mem` (+ section/key
  membership lemmas): after a run the selection is always usable.
- `stale_link_is_consumed_without_adopting`: a link this shell cannot resolve
  is stripped, adopts nothing, and moves nothing.
- `found_link_selects_its_own_module`, `module_link_opens_the_named_module`,
  `link_pressed_twice_adopts_once`, `adoption_requires_a_resolvable_link`.
- `reachable_adoption_account` + `reachable_adoptions_le_injections`: the
  initiation/consecution/reachability induction for the accounting invariant
  (every injected link is either still pending or already adopted).

**Pinning — one target per flow**

- `capture_of_set_target`, `capture_twice_is_capture_once`,
  `capture_takes_the_observed_version`, `observe_does_not_touch_the_target`.
- `create_sends_the_target`, `create_ignores_a_later_snapshot`: a poll that
  reports a republish cannot change what create sends.
- `same_flow_actions_never_move_the_pin`: consecution over the room machine for
  every same-flow action.
- `reachable_sent_is_the_pinned_target`: the reachable invariant relating the
  sent version to the pin.
- `reopen_repins_the_current_version`: the deliberate new-flow boundary.

**Counterexamples — refutations and non-vacuity**

`legacy_handler_dead_ends_on_a_module_finding`,
`routing_by_regex_alone_misroutes_a_field_path`,
`guessing_the_first_module_misroutes`,
`refusing_unmapped_modules_dead_ends`,
`ignoring_the_link_opens_the_first_module_instead`,
`the_shipped_pin_survives_a_republish`,
`recomputing_the_target_from_every_poll_moves_the_pin`,
`editor_link_trace_is_reachable`, `room_republish_trace_is_reachable`,
`reachable_republish_state_keeps_the_first_version`.

## Adversarial schedules considered

| Hazard | Outcome |
| --- | --- |
| A link injected over an already-pending link (two Fix presses) | **Covered** by R7's accounting invariant: the discarded link cannot produce an extra adoption. |
| The same link consumed twice (effect re-run, rerender, strict mode) | **Covered**: `consume_idempotent`, `consume_clears_pending`. |
| A link whose target disappeared between navigation and consumption | **Covered**: `stale_link_is_consumed_without_adopting`. |
| A slower file's question link arriving before its shell loads | Modelled as consuming with the shell that is present; the effect returns early without stripping when no shell is loaded (reviewed, tested). |
| A republish racing the open room setup (snapshot between capture and create) | **Covered**: `create_ignores_a_later_snapshot`, `same_flow_actions_never_move_the_pin`. |
| A republish arriving before the capture effect runs | **Open**: A13 — the model's interleaving allows the pin to take the later snapshot; the runtime claim rests on the effect running before the first poll response. |
| A partially mapped shell handed to the resolver | **Open**: A5/U1 — would turn R2 into a false dead end. |
| A module key duplicated across sections | **Open**: A4/U2 — the shell's cross-section fallback would then accept a key that lives under another section (the deep link resolves it the same way, so the press still lands on a real row). |
| Two staff members publishing by hand while a third sets up a room | Server-side, out of scope; the snapshot/pin behaviour is covered. |
| Network failure, retries, timeouts, crash mid-flow | Out of scope for this engagement (no network in the model). |
| Two rapid `?module=` navigations before the first is consumed | Modelled as one injection replacing another; R7 still bounds adoptions. |

## Source identity

- Base HEAD at the start of the engagement: `52517c270616cc445025914f5ed425cd9951df25`.
- HEAD at report generation: `160bf0ad` (branch `feat/sat-bluebook-overlays-tools`).
  Intermediate commits by the user while this ran: `8cef0afc`, `454da50d`,
  `160bf0ad`.
- Working tree at report generation: `useAuthoringSelection.ts`, its test file
  and `Counterexamples.lean` are uncommitted (the R12 fix and its tests).
- SHA-256 for every Lean and TypeScript file in scope:
  `evidence/source-snapshot.json`.

Re-run the commands above after any change to the Lean sources; the statements
describe the model, and the model describes the sources at these hashes.

## Frontend evidence (same working tree)

| Command | Result |
| --- | --- |
| `bunx vitest run src/…/useAuthoringSelection.test.tsx …` (focused) | exit 0; 6/6 in the hook's file. Pre-fix: 2 failed / 4 passed, reproducing R12. |
| `bun run test:run` | exit 0; 792 files, 6776 passed, 2 skipped |
| `bun run typecheck` | exit 0 |
| `bun run lint` | exit 0, 0 errors (warnings pre-existing repo-wide) |
| `bun run build` | exit 0, built in 17.69s |
| `e2e/sat-staff-room-ux.spec.ts`, `sat-authoring-lifecycle`, `sat-product-workspace`, `sat-adaptive-identity` | **NOT RUN** — need MySQL, the Go API/worker, the coedit service and global setup |
| `e2e:sat-a11y` | **NOT RUN** |
| Go suites | **NOT RUN** — no backend contract changed |
