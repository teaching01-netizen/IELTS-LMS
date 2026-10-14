# Recommendations

Ranked by correctness severity. R1 was found by this engagement and is already
implemented in the working tree; the rest are open.

## R1 — FIXED: an unresolvable question link stayed in the URL (severity: high)

**What the verification found.** `useAuthoringSelection`'s module branch always
consumes its parameter, even when the shell cannot resolve it (the comment says
so, and `DeepLink.stale_link_is_consumed_without_adopting` is the model of that
rule). The question branch did not: when `?question=` named a question the shell
did not contain, the `if (target?.question)` block was skipped entirely, so
`setSearchParams` never ran and `?question=<stale>&field=<f>` stayed in the
address bar.

**Why it matters.** Two consequences, both in the class this change set exists
to remove. (1) The URL keeps advertising a selection that does not exist, and a
staff member who copies it passes on a link that lies. (2) The parameter is a
live input: the effect re-runs whenever the shell changes, so the moment a shell
contains that question again — after a save, a refresh or a remote coedit
landing — the stale link adopts it and moves the author's selection out from
under an open draft.

**Evidence.** `useAuthoringSelection.test.tsx` — "drops a deep link naming a
question this shell does not contain" (extended) and "drops a stray field link
that names no question" (new). Pre-fix: `2 failed | 4 passed`, with
`expected '?question=eq-does-not-exist&field=prompt' to be ''` and
`expected '?field=prompt' to be ''`. Post-fix: 6/6, and the neighbouring
`AuthoringWorkspace` suite (26 tests) still passes.

**The change.** The question branch now reads the link, adopts it when the shell
can resolve it, and always strips `question`/`field` — the same shape as the
module branch. Behaviour on the resolvable path is unchanged (adopt, then
strip, then return).

**Residual gap.** The model proves the consumption rule for an arbitrary link
payload; the question-id lookup that decides *which* module and question the id
resolves to is reviewed and tested, not proved (A10).

## R2 — Decide what a partially mapped shell means (severity: medium if it ever happens)

`shellDeniesModule` treats any shell that maps modules as authoritative. A
caller that passes a page-scoped shell would make every finding outside the
mapped sections a refusal — the "Fix press that goes nowhere" class of bug this
change removed, reintroduced through the back door. Either keep every caller on
the full authoring shell (document it on `PublishDestinationShell`) or make the
denial section-local: refuse only when the *named* section is mapped and lacks
the module. Today's code and callers agree; a comment and a test pinning the
invariant is the cheap version. Production check: T3.

## R3 — Do not let "any section" evidence accept a foreign module key (severity: low)

`shellContainsModule` falls back to searching every section for the module key
when the named section is absent, mirroring the deep link's own lookup. With
per-section key prefixes (`rw-*`, `math-*`) this is unreachable; without a
uniqueness guarantee it would accept a finding whose section lacks the key.
Consider asserting (section, moduleKey) uniqueness in the SAT validator, or
dropping the fallback from the containment predicate only (the deep link can
keep it). Production check: T4.

## R4 — State the pin's "first snapshot" claim where it can be falsified (severity: low)

`first_snapshot_flow_pin` is conditional in the model because the runtime
ordering is a React fact (A13). The frontend test simulates the rerender rather
than the timer. Run production check T1; if the interval can fire before the
capture effect, pin the target at *query data arrival* instead of in an effect.

## R5 — Close the production-evidence gap before treating this as done

No authenticated live staff UI was available, so every R1–R12 row is
`NOT_TESTED` in production. The four Playwright staff journeys and `sat-a11y`
were not executed. Run `PRODUCTION_TEST_PLAN.md` T1, T2, T5, T8 at minimum.

## What is deliberately not recommended

- **No change to the refusal semantics.** Pointing a refusal at "the first
  module" would make every press do *something*; `Counterexamples.guessing_the_first_module_misroutes`
  is the refutation of that, and the honest refusal is the shipped behaviour.
- **No `native_decide`.** Every kernel-evaluated instance must stay inside what
  the kernel can reduce; a faster proof that adds `Lean.ofReduceBool` would
  trade a soundness artifact for build time.
- **No weakening of the module-path guard to a regex-only route**, which
  `Counterexamples.routing_by_regex_alone_misroutes_a_field_path` refutes.
