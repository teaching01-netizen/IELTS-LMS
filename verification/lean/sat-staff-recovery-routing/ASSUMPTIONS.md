# Assumptions and unknowns

Every assumption the model needs to stand in for the shipped system. `Critical`
means a theorem's real-world reading depends on it.

| ID | Assumption | Owner (code anchor) | Validation | Critical |
| --- | --- | --- | --- | --- |
| A1 | The TypeScript `resolvePublishIssueDestination` branch order and guards are the model's: prefix test, scoring-policy test, module shape test, then `knownSection` and the denial test. | `src/features/exam-authoring/ui/release/releaseSelectors.ts:378` | Reviewed line by line against the model; the kernel-evaluated instances below reproduce the source's outputs on the real paths. | Yes |
| A2 | `parseIssueLink` refuses a blank id, so a question destination always names a question. | `releaseSelectors.ts:311` | Kernel-evaluated: `resolve_question_link` and `parseQuestion_id_ne_nil`. | Yes |
| A3 | The module-path regex admits any two ASCII slug-shaped segments, so `answer.options` matches it. The model's `moduleParts` is that regex. | `releaseSelectors.ts:340` | Kernel-evaluated: `moduleParts "answer.options"` is `some ("answer","options")` in the counterexample, and the shipped resolver refuses it. | Yes |
| A4 | `shellMapsModules`/`shellContainsModule` are the model's shell predicates, including the source's fallback of searching ANY section for the module key when the named section is absent. | `releaseSelectors.ts:345`, `releaseSelectors.ts:362` | Reviewed. Note the widening it permits: see RECOMMENDATIONS R4. | Yes |
| A5 | Any shell passed to the resolver is either the draft's full section+module map, or carries no modules at all. A *partially* mapped shell is treated as authoritative, so a finding in an unmapped section would be refused. No current caller passes one (`ExamPublishSheet`, `SatDeliveryReleaseRoute`, `AuthoringWorkspace` pass the authoring shell; `ReadinessPanel`, `authoringWorkspaceSurfaces`, `ExamSettingsPage`, `SatAccessRoute` pass nothing). | the six call sites | Reviewed; **UNKNOWN** for future callers. | Yes |
| A6 | The character-sequence literals used as concrete witnesses (`reading-writing`, `rw-m1`, the three paths, the section keys) are the character sequences of the corresponding UI strings. | `Model.lean` literal block | Reviewed by hand. Mechanizing `String.toList` equality is outside what the pinned kernel can reduce: Lean's `String` primitives are `@[extern]`-backed, which is why the model works on `List Char`. | No (witnesses only) |
| A7 | `String.trim` in the source strips Unicode whitespace; the model strips ASCII space, tab, CR and LF. Every path in scope is an ASCII slug or an `examQuestion:` link, so the sets agree on this surface. | `releaseSelectors.ts` + `Model.lean` `trimChars` | Reviewed. | No |
| A8 | The `?module=` deep link's lookup is `moduleForKey`: the `<section>.<module>` pair first, then any module with that key, and nothing for a malformed link. | `src/features/exam-authoring/ui/useAuthoringSelection.ts:197-210` | Reviewed against the model's `moduleForKey`. | Yes |
| A9 | The deep-link effect's consumption is the model's `consume`: a pending link is always stripped, adopted only when this shell resolves it, and a selection that no longer exists falls back to the shell's first module. | `useAuthoringSelection.ts:165-220` | Reviewed; 6 tests in `useAuthoringSelection.test.tsx` pin the outcomes including the two R12 cases. | Yes |
| A10 | The question deep link resolves through the same consumption rule as the module link (post-R12). The question-id **lookup** itself is not modelled; only the consume/strip rule is. | `useAuthoringSelection.ts:167-196` | Reviewed; tests. Residual gap recorded in TRACEABILITY. | Yes |
| A11 | `editorInit` describes a fresh editor: no injections, no adoptions, no pending link. | `Model.lean` `editorInit` | Kernel-evaluated: `Counterexamples.editor_link_trace_is_reachable`. | Yes |
| A12 | The room flow's capture effect (the `if (target || !version) return;` guard) runs on every render with a snapshot and re-captures only when nothing is pinned. | `src/products/sat/routes/SatNewSessionFlow.tsx:110-122` | Reviewed; the republish test drives exactly this interleaving. | Yes |
| A13 | A capture that happens before any *second* snapshot pins the first snapshot. **UNVERIFIED FOR THE REAL RUNTIME**: the model's `observe`/`captureTarget` interleaving is arbitrary, so the strongest assumption-free statement is "a target is set once and never moves" plus "it equals the snapshot observed at the capture". That the capture effect precedes a ~30s poll response is a React scheduling fact the model does not contain. | `SatNewSessionFlow.tsx:105`, the query's polling interval | **NOT VALIDATED** in this engagement; the frontend test simulates the rerender rather than the timer. | Yes (only for R8's "first" reading) |
| A14 | A reopen is a fresh component instance with no pin. | `SatNewSessionFlow.tsx` (unmount/remount on exam change / dialog close) | Reviewed; not mechanized (React component identity). | No |
| A15 | The endpoints and the shell are the only source of a finding's path and a shell's module keys; the model trusts its `Shell`/`ModuleShell` inputs rather than re-reading a server. | backend contract | Assumed; backend suites not run (no contract changed). | No |

## Unknowns carried forward

- **U1** Whether any current or planned caller passes a partially mapped shell
  (A5). If one appears, the denial branch becomes a false dead end for findings
  in the unmapped sections.
- **U2** Whether module keys are unique across sections in every published
  version, which is what makes A4's cross-section fallback harmless.
- **U3** Real timer/scheduling distance between mount, the capture effect and
  the first poll response (A13).
- **U4** Whether the coedit room can inject a `?question=` link for a question
  the local shell lacks at that instant (the R12 scenario in production).
