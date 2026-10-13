# SAT Practice Classroom verification scope

## Verification target

One SAT classroom attempt across its required sections: enter the module plan pinned to the published version, accept server answer writes, close Module 1, select or await the permitted Module 2, serve only the selected branch, complete the exact planned module sequence, and release an allowlisted raw score only after successful grading.

The database is the state authority. Route decision, module attempt, completion receipt, and result release are externally observable. The production code may have multiple API instances, retries, and concurrent close/route/finalization workers. The Lean model represents each transition as one atomic step; whether real Go/SQL transitions satisfy that abstraction remains a refinement obligation.

## Requirement interpretation

- **Full adaptive:** Module 1 and exactly one branch selected by the adaptive policy.
- **M1 + Easy / M1 + Hard:** Module 1 and exactly the one branch admitted by the immutable plan.
- **M2-only Easy / M2-only Hard:** only the configured branch; no Module 1 attempt and no route decision.
- **Staff selects:** Module 1 waits without a Module 2 until an authorized staff route commits. This policy is compatible only with a plan that does not fix a branch.
- A route decision is unique per attempt and section. Repeating the same selection replays the committed result, including after sealing; a different selection conflicts.
- A classroom completion requires each declared section's exact sequence, all required modules terminal, and no unresolved staff route. Standard Practice retains its pre-feature completion rule.
- A route and selected module must match the immutable plan. Student-visible branch content must match the branch already opened by the server.
- A released raw score implies a sealed attempt and successful scoring. Score failure leaves a completed/pending result for repair; no score is fabricated.
- For answer inclusion, this review uses the earlier D1 proposal: a write counts only if the authoritative server transaction commits before the close transaction wins the attempt/module lock. The source specification does not yet state that business wording explicitly, and the deployed lock ordering has not been independently audited. A browser click before zero is not treated as a server acceptance guarantee.

## Formal guarantees

The checked Lean theorems establish the corresponding abstract, per-section properties for `Mode.corrected`: route stability, staff-only routing, decision-to-opened-branch fidelity, plan fidelity, close snapshot equality, the section-local completion gate, release-after-score-and-seal, served-branch fidelity, and standalone M2 entry. Exact statements are in `proof/Safety.lean` and `proof/AxiomAudit.lean`.

The proof does not establish multi-section aggregation, wall-clock cutoff behavior, production database serialization, HTTP authorization, the scoring formula, privacy of the full result payload, liveness, throughput, or deployed configuration.

## Exclusions

Authoring and publishing validation, frontend rendering/accessibility, SAT scaled-score conversion, external event delivery, capacity/SLOs, and business approval of cutoff wording are outside the Lean theorem boundary. They remain implementation or production verification obligations where applicable.
