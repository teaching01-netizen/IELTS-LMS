# ADR-004 - SAT provisional two-phase completion

Status - accepted.

Context - SAT completion is not a single write - student submit parks a provisional state and a watchdog later scores and seals.

Decision - student submit on SAT sets submitted phase post-exam with submitted_at and final_submission left NULL. The SAT service scores only when all modules are submitted or locked with a real policy, then seals sat_complete. The provisional OR-branch in the claim predicate enables exactly-once claiming.

Consequences - provisional rows are a real lifecycle state with dashboards and lag metrics. Never synthesize scores to clear backlog.
