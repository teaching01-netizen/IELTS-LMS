# Production test plan — executed evidence and remaining scenarios

## Executed (this engagement)

| Check | Command | Transcript | Result |
| --- | --- | --- | --- |
| Lean build (all roots) | `lake build InsertedImagesDelivery Model Safety Counterexamples AxiomAudit` | [lean-build.txt](evidence/lean-build.txt) | exit 0 — `Build completed successfully` |
| Statement + axiom audit | `lake env lean AxiomAudit.lean` | [lean-axiom-audit.txt](evidence/lean-axiom-audit.txt) | exit 0 — 32 theorem audits, only `propext` / `Quot.sound` / `Classical.choice` or none |
| Student + block + adapter suites | `bunx vitest run src/components/student src/components/blocks src/services/__tests__/examAdapterService.test.ts` | [unit-suite.txt](evidence/unit-suite.txt) | exit 0 — 122 files, 950 tests passed |
| Focused delivery-rendering + hydration suites | `bunx vitest run src/components/student/__tests__/StudentInsertedImages.test.tsx src/services/__tests__/examAdapterService.test.ts` | [focused-suite.txt](evidence/focused-suite.txt) | exit 0 — 2 files, 14 tests passed |
| Discriminating-failure probe | temporarily reverted the key to id-only and re-ran the focused suite | recorded in [focused-suite.txt](evidence/focused-suite.txt) note below | failed as expected (`same key` warning surfaced), then restored; final run passes |
| Typecheck | `bunx tsc --noEmit` | [typecheck.txt](evidence/typecheck.txt) | exit 0 |
| Lint (changed files) | `bunx eslint <4 changed files>` | [eslint.txt](evidence/eslint.txt) | exit 0, no findings |

The discriminating probe is the reason R7 is listed as
`VALIDATED_IN_STATED_PROFILE`: the regression test does not merely pass, it was
shown to fail when the hazard is reintroduced.

## Not executed (and why)

| Scenario | Why not | What it would prove |
| --- | --- | --- |
| Browser section preview showing the diagram | No local Go API on `:4000`; `ExamPreviewRoute` provisions a real schedule/attempt for an author session, which this engagement did not have | That the compiled component, real hydration and the runtime preview together produce the diagram (the correspondence claim, end to end) |
| Student route with a published version containing `insertedImages` | Same backend/session prerequisite, plus seeded content | Delivery parity beyond the preview shell |
| Real Google Drive fetch through the candidate chain | Needs an authored, shared link and network access to Google | U1/U2: that an image actually paints, and which candidate succeeds |
| Multi-image / large diagram visual pass, 200 % zoom, tablet and phone layouts | Needs the running app | That the new node does not disturb pane layout, zoom, or the flag column |
| Blank-instruction listening block, real route | Component-level shape is tested; the listening route itself needs the backend | R2 end to end through `StudentListening` |
| Published-snapshot content audit for the field (U3) | Requires database access | That existing published exams will start rendering images after deploy — a visible change staff should expect |

## Recommended production validation sequence

1. Start the local Go API against MySQL, author one `SHORT_ANSWER` block with a
   shared Drive diagram, publish, then open the section preview and the student
   route: confirm the image appears between the instruction box and question 11,
   and that tapping it opens the zoom dialog with the same source chain.
2. Author a second block with a private (unshared) Drive link: confirm the
   surface degrades without layout damage and that no empty container is left.
3. Add a listening block with a blank instruction and one image: confirm R2's
   shape in the real renderer.
4. Run a read-only query over published `content_snapshot`s for `insertedImages`
   to size the visible-change surface (U3) before rollout.
5. Spot-check the three delivery surfaces that are **not** covered by this fix —
   SAT delivery (`SatQuestionRenderer`), the structured `ExamQuestionRenderer`
   surfaces and `StudentWritingPanes` — and record that their content models
   carry no `insertedImages` field (so they neither regress nor gain the slot).
