# SAT post-publish verification report

## Verdict

**Formal model:** selected abstract lifecycle theorems are **PROVED** by the pinned Lean 4.19.0 kernel and have been audited. **Correspondence:** **REVIEWED_WITH_TESTS** for R1–R5 and the exercised R7 focus behavior; not mechanized. **Production evidence:** **PARTIAL**. Overall production correctness is **NOT ESTABLISHED**.

The model is one exam/one client and proves properties of its own `step` function, extended with a commit-history provenance wrapper. It does not prove the React or TypeScript implementation, backend transaction, database behavior, deployment, or capacity. R6 is outside the model; local pending-work export through shell loss is tested, while the two-real-context collaborative publication scenario remains untested. Manual screen-reader and actual 200% browser zoom checks remain unrun.

## Reproducible Lean evidence

Run from `verification/lean/sat-post-publish/`:

```text
lean-toolchain: leanprover/lean4:v4.19.0
Lake project: satPostPublish 0.1.0
Dependencies: Lean core only; lake-manifest.json has no external package dependency
Lean: Lean (version 4.19.0, arm64-apple-darwin23.6.0, commit 6caaee842e94, Release)
Lake: Lake version 5.0.0-6caaee8 (Lean version 4.19.0)
```

Command:

```bash
lake build SatPostPublish Model Safety Liveness Traces Counterexamples Provenance AxiomAudit
lake env lean AxiomAudit.lean
```

Exit status: **0**. Every declared project root built. The audit contains `#check` and `#print axioms` for every theorem in the report. The standard logical axioms observed are `propext` and `Quot.sound`; no custom axiom, `sorryAx`, `sorry`, or `admit` occurs in the project sources. Several definitional/equational lemmas report no axioms. The audit's first broad reachability theorem uses `[propext, Quot.sound]`; other audited theorems use either `[propext]` or none. No unsupported native-evaluation proof shortcut is used.

The pinned Lean 4.19.0 installation does **not** include a `leanchecker` binary (`lake env leanchecker --help` returns “does not have the binary”). The successful Lake build and `#print axioms` audit are the available checks; no separate leanchecker result is claimed.

## Proved theorem groups

- Reachable states preserve the model's receipt-exam association: `all_reachable_receipts_belong_to_active_exam`.
- Shell projection changes preserve modeled sheet mounted/open/instance fields: `shell_answer_preserves_sheet_identity`.
- Release read success, failure, and held states preserve the receipt: `receipt_survives_release_success`, `receipt_survives_release_failure`, `receipt_survives_held_release_read`.
- A matching committed acknowledgment makes success visible while the modeled sheet is open: `valid_ack_shows_success_if_sheet_is_open`, `delivered_ack_makes_success_visible`.
- A room uses the acknowledged target, including after a newer modeled remote publication: `create_room_uses_acknowledged_target`, `create_room_stays_pinned_after_remote_publish`.
- Done preserves the ephemeral receipt; reload clears it without opening a draft; read transitions do not increment draft-open posts.
- Malformed/invalid acknowledgments do not fabricate a receipt; a lost acknowledgment yields `unknown`.
- Concrete reachable traces establish that the model admits success, lost acknowledgment, and rejected publication, avoiding an empty reachable set.
- `Counterexamples.lean` computes two finite legacy-policy traces: POST commit then projection-read failure reported as failure; and shell removal clearing the local success sheet before continuation.

No theorem proves unconditional liveness. `delivered_ack_makes_success_visible` is a transition-local result. The model does not model fairness or an infinite schedule.

## Source identity

The repository base at the start of this implementation was `2c319e59a7de3c15345e8ac575142d9254acb22a`. At report generation the application changes and verification artifacts are in the working tree and are uncommitted. The Lean model source, this report, and test output therefore describe the current working-tree snapshot, not an immutable commit. Final SHA-256 values and status are recorded in the task evidence; rerun the command after any proof-source changes.

Base HEAD: `2c319e59a7de3c15345e8ac575142d9254acb22a`. Earlier implementation SHA-256 values are retained below; the final follow-up identities, including `Provenance.lean`, are in `evidence/source-snapshot.json`:

```text
57e8b7f83e0dbd96fe40c780f4612dc439baa23e13b67329a450255212dbcc8c  Model.lean
2e434958484fa8649f13b6bbae7a5cabed16a645d38964144b29fba6c1fae6c6  Safety.lean
0fe6d35902ee140f7dd635b2c47ed503e3a50e20dfdea05f14385324f610d650  Liveness.lean
10ad5316c70c07571c0b2d2a5cea47163cbda8a856912c1d36cedef1c72fc43c  Traces.lean
66099a2dd71ecb3605bcc7ed5f5ab71857e90660c3674b2cf97f7d16628b7e9c  Counterexamples.lean
f89d171eea894de3685e3d08fea0dcbc04f29b9134a5869d89eda13df88186c4  AxiomAudit.lean
55e97be96000b5e9e290c9e74482e5e317861499a5540353ce845471bded8cea  lean-toolchain
```

Earlier implementation validation passed the full unit suite (783 files, 6,654 passed, 2 skipped), focused post-publish compatibility suite (8 files, 102 passed), six Chromium authoring scenarios, typecheck, build, changed-file ESLint, and diff checks. The follow-up below supersedes those counts for the final reviewed implementation. The repository remains uncommitted and pre-existing changes are preserved.

## Follow-up execution — 2026-10-11, Asia/Bangkok

The pre-existing implementation was reviewed before modifying it. Two new parent regressions were observed failing: stale published metadata hid a shell-read error, and draft-shell removal hid export controls for pending local work. Both now pass. A further failing assertion exposed hidden clipboard feedback in the no-shell branch; copy/failure notices now remain visible there. Existing collaborative/device recovery surfaces are reused through that branch, with no automatic save or draft-open command.

The stronger model adds `PublicationProvenance`, established at startup and preserved for every operational action. `acknowledged_receipt_has_commit` proves every reachable receipt has a matching modeled commit in retained history. `tracked_success_is_reachable` provides a successful reachable witness for an arbitrary target. Ghost-history erasure refines the original Lean step; this is a checked relation between Lean models and does not mechanize the TypeScript implementation.

| Check | Command / evidence | Result |
| --- | --- | --- |
| All Lean roots | `lake build SatPostPublish Model Safety Liveness Traces Counterexamples Provenance AxiomAudit`; [build transcript](evidence/lean-build.txt) | Exit 0; all roots built, including the new provenance module. |
| Direct statement/axiom audit | `lake env lean AxiomAudit.lean`; [audit transcript](evidence/lean-axiom-audit.txt) | Exit 0; new provenance theorems use only `propext` and `Quot.sound`, or no axioms. The arbitrary-target witness uses `propext`. No `sorryAx` or custom/native-evaluation axiom was accepted. |
| Full unit suite | `bun run test:run -- --silent`; [transcript](evidence/unit-suite.txt) | Exit 0; 783 files, 6,656 tests passed, 2 skipped. |
| Focused receipt/workspace/recovery tests | Eight relevant suites, including `publishMutationReceipt`, workspace, release, query effects, conflict recovery and save routing | Exit 0; 104 tests passed. |
| Final recovery/error/status and settings compatibility checks | Workspace, no-draft, conflict-recovery, save-routing and settings-page suites | Exit 0; 70 tests passed (overlaps the preceding run; counts are not additive). |
| Browser lifecycle | `bunx playwright test --config=playwright.sat-authoring.config.ts` | Exit 0; six Chromium tests passed, including success → Done → reload → exact room target, focus and axe assertions. |
| TypeScript / production build | `bun run typecheck`, `bun run build`; [typecheck](evidence/typecheck.txt), [build](evidence/build.txt) | Both exit 0. |
| Lint / whitespace | ESLint on the changed workspace and regression files; `git diff --check` | Both exit 0; no lint findings. |
| Isolated DB migration | `go run ./cmd/migrate`; [transcript](evidence/mysql-migrate.txt) | Exit 0; fresh schema migrated through 0081. |
| Real publish compatibility | `go test ./cmd/api -run 'TestSATPublish(OperationKeyReplaysOneRelease\|PreservesRevisionFences)MySQL' -count=1 -v`; [transcript](evidence/mysql-publish.txt) | Exit 0; identical retained-key replay and three revision-fence subcases passed without skips. |
| Real concurrent draft opening | `go test ./internal/authoring -run 'TestOpenShellConcurrent' -count=1 -v`; [transcript](evidence/mysql-open.txt) | Exit 0; three scenarios passed without skips. Twenty concurrent openers of a published/no-draft exam returned one cloned draft, with source content intact. |

DB profile: Homebrew MySQL 9.6.0 in a newly initialized temporary data directory, local UNIX socket, networking disabled, separate `sat_post_publish` database, canonical migrations and the existing REPEATABLE READ runner. Throwaway test credentials/configuration were used; the existing development/production database was untouched. The temporary server was shut down after testing. This differs from CI's MySQL 8.4 and does not establish deployed durability, failover, replica consistency or multi-instance capacity.

Final source/tool identities are captured in [source-snapshot.json](evidence/source-snapshot.json). The evidence relates to this uncommitted tree; rerun if the relevant source hashes change. Formal status for the selected model theorems is PROVED; implementation correspondence remains REVIEWED_WITH_TESTS/PARTIAL; overall production correctness remains NOT ESTABLISHED. Unbounded scheduler liveness, R6 formalization, two-tab live collaborative publication, process-crash/failover and multi-API-instance tests remain outside the executed evidence.

## Anti-vacuity and limits

`Init` allows shell states for ready/loading/no-draft/missing/forbidden/error and arbitrary initial durable/release projections. A reachable success trace, loss trace, and rejection trace are compiled. Receipt provenance is not assumed as an initial condition; induction establishes the model invariant. However, the model is deliberately small: no arbitrary actor set, database transactions, multiple concurrent clients, message queue, dirty payload, version records, authorization decision, or scheduler is modeled. Counterexamples are witnesses for the declared `LegacyClient` transition system, not a formal refinement relation to an earlier binary. These limits prevent any production-readiness conclusion.
