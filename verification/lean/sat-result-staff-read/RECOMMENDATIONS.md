# Recommendations

## Completed fixes

1. Clear the list's stored estimate when the active conversion-revision read fails, matching the staff detail overlay's raw-only degradation.
2. Treat only renderable classroom raw counts as score-available; make the SQL filter null-safe and reject invalid count relationships.
3. Preserve JSON number kinds in Go so `42.0` cannot be accepted as an integer count while SQL rejects it.
4. Align MySQL signed/unsigned JSON integer classification with signed-int64 Go response fields; reject overflow.
5. Fail closed if raw-correct or operational section sums would overflow int64.
6. Suppress a synthesized section route when the module rows disagree on higher/lower branch.

## Remaining release evidence

1. Run the filter query on the supported MySQL 8.4 engine. The local MySQL 9.6 expression check is useful syntax/behavior evidence, not a substitute for the supported server profile.
2. Run a staff-authenticated browser flow and authorization-negative test in a provisioned local/deployment-like environment. No authenticated session was available here.
3. Exercise policy activation and result-list reads concurrently with barriers on the deployed DB topology; capture the policy observed by each request and inspect returned ranges.
4. Declare a production topology and read SLO, then run representative multi-instance load and failure tests. Until then production correctness is not established for that environment.

`ListSATAttempts` counts rows, fetches the page, and reads the active policy without one read transaction. The current specification does not require a stable pagination snapshot, so no transaction change is recommended. If consumers require a count/page snapshot, the smallest justified fix is a consistent-read transaction around both queries; the active policy would still need an explicit consistency contract.
