# Assumptions and unknowns

| ID | Assumption / unknown | Owner and validation | Consequence |
| --- | --- | --- | --- |
| A1 | A successful POST response identifies a committed published version for the requested exam and scope. The UI validates exam identity, version ID/number, published flags, and scope before treating it as a receipt. | Backend contract; contract and database-backed HTTP test | Receipt soundness is conditional on the API contract. The Lean model assumes its `commit`/`acknowledge` transitions represent this boundary. |
| A2 | Backend publish transaction, operation ledger, and DB durability behave as inspected. | Backend/platform; isolated MySQL transaction, crash/restart, and retained-key tests | Not proved by this frontend model. Production durability is UNKNOWN. |
| A3 | The stable React parent/type/key used by this implementation preserves component state through shell projection changes. | Frontend; mount-count integration test and Chromium flow | Reviewed with tests; not mechanically refined from Lean to React. |
| A4 | A publish result is attached only to its initiating exam and live document. | Frontend; exam-change clearing and exact-target integration tests | Old-exam results must not leak into a different workspace. Reload intentionally loses the ephemeral receipt. |
| A5 | After an accepted receipt, the browser remains open and React eventually renders an eligible frame. | Browser/runtime | Needed only to claim eventual visible success. The Lean theorem is a same-transition property, not an unbounded scheduler liveness proof. |
| A6 | Reload eventually obtains an authorized, trustworthy release projection. | API/platform | Needed for reload recovery. If reads fail, the UI cannot claim that a newly loaded document has this operation's receipt. |
| A7 | Existing server permission checks and sealed-version write fences remain authoritative. | Backend security; negative HTTP and stale-write tests | A visible/hidden UI action is not an authorization boundary. |
| A8 | Production topology, database version/isolation/durability, replica consistency, feature flags, retry budgets, and service version skew. | Deployment owner; record deployed configuration and run production-like fault/concurrency profile | UNKNOWN; production correctness and capacity are not established. |

The abstract model treats a publish commit and the matching acknowledgment as distinct actions. It assumes a valid acknowledgment can be matched to the operation's committed target. A lost acknowledgment leaves the client outcome `unknown`; the model does not infer success from a later unrelated current-version read.
