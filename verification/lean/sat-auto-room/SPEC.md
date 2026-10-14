# Verification target

`docs/SAT_Internal_Auto_Version_Create_Room_Implementation.md`, particularly §§4–6 and §11; SAT automatic release selection and one-action room creation. Source is the current dirty working tree above HEAD `b0be8c0e246fc8bb4d71a6bcb9d050ab32c93810`, not that commit alone. See `evidence/source-snapshot.json` for exact file hashes.

## Critical guarantees

| ID | Guarantee | Class |
|---|---|---|
| R1 | One committed business effect per authenticated actor/operation key, regardless of finite retries/interleavings. | Safety |
| R2 | A successful new release, schedule, link, roster and receipt commit together; transaction rejection leaves none of those new effects. | Safety / atomicity |
| R3 | A room pins the selected release; subsequent ordinary authoring/room creation does not repoint it. | Safety |
| R4 | A new operation supplies entity, draft identity and (when applicable) draft revision fences; a stale preparation cannot silently capture another draft. | Ordering |
| R5 | A seal uses the same draft/revision that passed preflight, after locked validation. | Safety |
| R6 | Same-key, same-request replay returns the original response fields; a different request cannot replay under that key. | Safety / consistency |
| R7 | Equivalent effective content and equal effective scope reuse the immutable release. | Deduplication |
| R8 | No unknown outcome authorizes a replacement operation key. | Safety |
| R9 | Authorization is enforced for actor, exam and organization; client controls are not authority. | Security |
| R10 | Supported exam configuration is initialized atomically with the exam. | Safety |
| R11 | Committed operations eventually become observable under stated availability/retry conditions. | Conditional liveness |
| R12 | Multi-instance operation under realistic traffic, crashes, failover, version skew and asset failures meets declared SLOs. | Durability / capacity |

## Scope / production assumptions

The authoritative boundary is the MySQL transaction that claims `(actor_id, operation_key)`, locks the exam and working version, resolves/seals the release, inserts the schedule/link/roster and writes the response snapshot. Arbitrarily many actor IDs and operation keys and arbitrarily long finite interleavings are modeled. Pending requests, preflight reads, saves, explicit reopening, commit, abort, lost ACK/replay and process-local crash/restart are distinguishable. Commit is atomic only under the database assumptions in `ASSUMPTIONS.md`. A crash does not imply that an ACK reached the browser.

The model monitors newly created operations starting with empty operation maps; it permits arbitrary imported draft/release data. Crash recovery retains durable maps rather than resetting them. Existing room/release integrity and migration backfills are separate obligations. Destructive administrative deletion and live metadata changes are outside the invariant's creation ledger; the receipt remains historical evidence, not a promise that a deleted live link still exists.

`payload` is an opaque identity of effective delivery content/configuration after existing SAT publication normalization. It is not literal Go bytes, a verified canonical hash, or a proof of SQL serialization. Read-check-write interleavings before commit are represented by separate preflight/save steps. Writes inside the declared transaction are abstracted to one commit; no mechanized Go/SQL simulation establishes this abstraction.

## Specification inconsistencies to resolve

The document's implemented-deviations paragraph chooses untouched-clone reuse; §4.2 and §11 still require canonical fingerprint reuse and equal scope. Actual `covers(full, math)` is true, whereas §4.3 says different scopes must not reuse the same release. Both cannot describe the same policy. The Lean theorem `full_reuse_is_not_equal_scope` and the real MySQL characterization demonstrate this mismatch. The smaller safety proof deliberately establishes **coverage**, not equal-scope/fingerprint uniqueness.

A no-op question save bumps revision and causes a new release. This demonstrates the ceiling of the untouched-clone optimization. Whether that no-op must share a fingerprint depends on the still-unspecified identity/normalization of question revisions; no canonical-hash equality is claimed from equal question JSON alone.

Two distinct concurrent first-room requests can observe the same draft, then one seals it and invalidates the other's fences. Strict stale-request rejection and unconditional immediate success for both requests cannot both hold. A loser needs a fresh confirmed preparation; do not silently weaken its fences.

The implemented no-draft fence is `expectedDraftVersionId: ""`, not JSON null. Null/omitted fences are now rejected for new operations.

## Exclusions

This is not a verification of timed M1/M2 closure, answer cutoff/inclusion, scoring arithmetic, branch confidentiality, global score conversion, IELTS/ACT behavior, UI accessibility, or capacity. Those remain separate verification targets. Room section coverage is not a proof of adaptive branch access control. The score-report switch intentionally remains live. A local browser click is never equated with server acceptance or a durable save.
