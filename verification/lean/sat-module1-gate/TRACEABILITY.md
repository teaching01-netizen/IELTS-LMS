# TRACEABILITY

| REQ | Lean theorem (proof/) | Code | Test | Formal | Correspondence |
|---|---|---|---|---|---|
| REQ-1 | `m1Hard_shown_requires_threshold`, `m1Hard_qualified_iff` | `terminalization/service.go` `markModule1QualificationTx` | `TestFixedModule2GatesConversionOnModule1` (hard below/at, raw above ops), `TestFixedModule2WithoutRouteDecisionIsUnavailable` | PROVED | REVIEWED_WITH_TESTS |
| REQ-2 | `m1Easy_shown_requires_below`, `m1Easy_qualified_iff` | same | easy below/at, threshold above ops, negative raw | PROVED | REVIEWED_WITH_TESTS |
| REQ-3 | `qualified_seal_shows_cell`, `*_qualified_iff` (← direction) | same + converters | hard at, easy below | PROVED | REVIEWED_WITH_TESTS |
| REQ-4 | `unforced_never_gated` | `ForcedBranch() == ""` → `continue` | `TestFullAdaptiveRouteDecisionHasNoGate` | PROVED | REVIEWED_WITH_TESTS |
| REQ-5 | `gate_matches_routing`, `adaptive_higher`, `adaptive_lower` | gate range checks mirror `chooseAdaptiveRoute` (`start_submit.go:1595`) | range cases above | PROVED | REVIEWED_WITH_TESTS (hand-mirrored, not shared code) |
| REQ-6 | `total_needs_both` | `satconvert.Total` | existing satconvert tests | PROVED | REVIEWED_WITH_TESTS |
| REQ-7 | `reachable_inv`, `shown_gated` | seal → `convertClassroomScoresTx`; read → `Overlay`/`ApplyRevision`; degrade → `stripConversion`; repair → `RepairClassroomResults` | `TestApplyRevisionSkipsUnqualifiedSection`, `TestRepairClassroomResults` | PROVED | REVIEWED_WITH_TESTS |

## Model ↔ code map
| Lean | Go | Equivalence argument | Gap |
|---|---|---|---|
| `adaptive` | `chooseAdaptiveRoute` | same 4 range checks, same `raw ≥ thr → higher` | JSON parsing differs slightly (Unmarshal into int vs Number.Int64): both reject non-integers |
| `Shape.forced` | `Shape.ForcedBranch` | case table | — |
| `gate s d`, `d = none` | LEFT JOIN row with NULL decision columns | `Valid` checks fail → `false` | — |
| `Decision.thr = none` | policy missing / non-integer | Unmarshal error or zero → `thr ≥ 1` fails | — |
| `qualified` | `SectionQualified` | absent ⇒ true | legacy (A6) |
| `convert` | three converters | gate after lookup | A4 |
| `Step.overlay` (any `cell`) | any active revision | cell universally quantified | — |
| ghost `shape`, `dec` | immutable DB rows | A1–A3 | — |
