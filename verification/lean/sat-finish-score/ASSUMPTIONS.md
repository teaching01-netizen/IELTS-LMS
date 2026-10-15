# Assumptions and unknowns

| ID | Assumption / owner | Anchor and validation | Criticality / status |
|---|---|---|---|
| A1 | DB commits/rollbacks and attempt row locks have their advertised semantics; database operator | platform/tx/tx.go withTxLevel; sat.lockAttempt; terminalization.SealInTx; real MySQL integration tests | Critical; local tests only |
| A2 | The shared db handle reads a primary with read-after-write visibility; deployment owner | completion uses s.db after WithTxRetry; bootstrap uses delivery db handle | Critical; deployed routing/replicas UNKNOWN |
| A3 | Published revisions are immutable and cache entries have no mutation; backend/DB owners | migration 0087 triggers/CHECKs; satscoring.ActiveRevision pointer read + checksum-verified cache; policy tests | Critical; reviewed, local tests |
| A4 | Each loadResult JSON decode owns its maps; backend owner | sat.loadResult json.Unmarshal into fresh local map | Critical; reviewed; race tests exercise concurrent calls |
| A5 | Go refinement to model, SQL driver and JSON encoding behave as reviewed; backend/toolchain owners | TRACEABILITY.md, source-snapshot.json, Go regression tests | Critical; REVIEWED_WITH_TESTS, not mechanized |
| A6 | Requests may fail, be canceled, or lose ACK after commit | model failure/crash; commit-failure and replay tests | Explicit fault allowance; no eventual-response promise |
| A7 | Completion and refresh can see different policies, flags, errors, or repaired reports | satscoring.activeID; live gate query; RepairClassroomResults | Explicit allowance; equality requires identical observations |
| A8 | Lean 4.19.0 kernel/core imports are sound | pinned toolchain, axiom audit and replay evidence | Trusted computing base |
| U1 | Instance count, engine/version, replication, isolation overrides, DB durability/fsync, failover, rolling deploy version skew | Production configuration not supplied | UNKNOWN; production correctness NOT ESTABLISHED |
| U2 | Real workload, pool limits, timeouts, p99/SLO, overload policy | No production load profile supplied | UNKNOWN; no capacity claim |

Raw identity in Lean encodes the whole persisted raw report as an opaque Nat; it does not validate the Go report parser. Conversion includes separate optional section ranges, total range and revision; lookup arithmetic is abstract. Standard logical axioms are accepted only if listed in the actual transitive audit.
