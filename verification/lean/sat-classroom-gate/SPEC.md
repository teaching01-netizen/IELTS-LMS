# SAT Classroom creation gate verification

## Verification target

This review covers the staff room-creation path: opening the SAT Create room form, reading the runtime capability, selecting Practice or Classroom (including a restored Classroom draft), submitting a one-action room request, and resolving the server response. The authoritative creation boundary is the API instance that handles `POST /v1/sat/exams/{examId}/rooms`; durable room state is the database transaction containing the release, schedule, access link, roster, and operation receipt. Concurrent actors are staff clients and API instances that may receive retries. Network loss may occur before or after commit. Student test delivery and answer scoring are out of scope.

## Exact guarantees

- A new Classroom request to an instance whose effective gate is off returns `SAT_CLASSROOM_DISABLED` and leaves no room-creation effect. Existing committed operation receipts are replayed before checking the current gate.
- Practice remains creatable with the Classroom gate off.
- The defaults endpoint reports the handling instance's effective gate. The form refreshes this capability on mount. A false or unavailable capability disables Classroom and blocks a restored Classroom submission without changing the selected value; Practice remains selectable.
- A definitive `SAT_CLASSROOM_DISABLED` response clears the pending operation key, retains the form draft and selected Classroom value, and disables Classroom for that open form. The user can select Practice.
- An unclassified 5xx remains uncertain. The client retains and reuses the same operation key and request body until it resolves.
- For a fixed `(actor, operationKey)`, the transactional receipt boundary produces at most one room effect. A same-key, same-body retry replays the recorded result.

These are safety and ordering guarantees. Liveness depends on the API, database, and client becoming available. Capacity and latency are not proved.

## Formal predicates

- `StoreSafe`: for every operation key, no receipt implies zero committed room effects; a receipt implies exactly one effect.
- `reachable_at_most_one_room_per_operation`: all states reachable by arbitrary request interleavings preserve `roomEffects key ≤ 1`.
- `disabled_instance_refuses_new_classroom`: for a new key, a disabled target returns the stable refusal and leaves the whole modeled store unchanged.
- `disabled_gate_allows_practice`: Practice commits despite a disabled Classroom gate.
- `classroom_requires_enabled_capability`: Classroom is submit-enabled exactly when capability is enabled; `unknown` and `disabled` fail closed.
- `blocked_restored_classroom_cannot_begin`: submit leaves a restored Classroom selection and draft unchanged while capability is unknown or disabled.
- `begin_submit_preserves_selected_session`: a request can start only when its session matches the current selection, and starting cannot silently change the selection.
- `refresh_preserves_restored_form`: capability refresh changes neither selection nor draft.
- `disabled_refusal_clears_pending_and_preserves_form`: the definitive refusal clears pending state and retains selection and draft.
- `generic_5xx_retains_the_same_pending_attempt`: a generic 5xx retains the pending request and draft.
- `lost_ack_same_key_replays_once`: a concrete commit followed by same-key retry returns the original receipt and leaves one effect.

## Exclusions

The Lean model abstracts a transaction as one atomic function. It does not prove Go/SQL refinement, MySQL transaction behavior, browser storage durability, load-balancer affinity, deployed environment variables, migration state, production DB engine, fleet uniformity, authorization, or production SLOs. Those are listed as correspondence or production obligations below.
