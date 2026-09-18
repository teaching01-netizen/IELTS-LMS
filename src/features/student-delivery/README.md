# Student delivery (SAT)

Structure of the student-facing exam runner. Keep new logic in the layer that
owns the concern — the hook is wiring, not a home for policy.

```
routes/          rendering + the command surface the screens call
hooks/           React wiring: effects, timers, adapters (no policy)
application/     pure logic: reducer, selectors, routing, gates, policy
domain/          SAT domain helpers (timing, responses, tools)
infrastructure/  transport, gateway, device-local stores
contracts/       wire types for the delivery payloads
bootstrap/       parent→controller bootstrap seed handoff
```

## Who owns what

| State / decision | Owner | Notes |
| --- | --- | --- |
| runner phase, answers, review state, tools | `application/satRunnerReducer.ts` | pure reducer; the hook only dispatches |
| authoritative projection (bootstrap payload) | `acceptPayloadAndRoute` in `hooks/useSatExamController.ts` | **only** writer of `dataRef` + `data`; validates identity + monotonic runtime revision |
| durable response queue, blocked/quarantine | `shared/durability/DurableResponseEngine.ts` | provider hooks adapt it; the engine owns the boundary invariant (`assertBoundarySettled`) |
| finalization claim + in-flight | `application/satFinalizationGate.ts` | one instance per controller; claim/release/single-flight/reset |
| which recovery copy a backend rejection gets | `application/satSubmitConflicts.ts` | structured code/`details.reason`, never the HTTP status |
| which phase action a committed payload produces | `application/satCommitRouting.ts` | pure route table, one entry per producer hint |
| pending module to open | `application/satRuntimeSelectors.ts` + `application/satEntry.ts` | selectors are pure; entry decision is pure |
| displayed countdown + expiry authority | `application/satTimingPolicy.ts` (`satCountdown`) | derived together so the two roles cannot drift; legacy → personal clock, cohort-stage → stage clock, cohort-section → section clock (expiry inert on a mismatched stage) |
| stage readiness, expected stage key, break/section-wait clocks | `application/satTimingPolicy.ts` | all answered from the timing model in one place |
| whether a clock is running | `application/satTimingPolicy.ts` (`satSharedClockRunning`, `satPersonalClockRunning`) | one rule for the shared section clock; the personal clock adds the legacy "always runs" case |
| how long until the next recovery poll | `application/satPollCadence.ts` | base cadence + exponential backoff + full jitter |
| seconds left on a given clock | `domain/satTiming.ts` | arithmetic on a payload/attempt; the caller passes the skew and whether the clock runs |

## Data flow

```
gateway / poll / mutation response
        │
        ▼
acceptPayloadAndRoute(payload, hint)      ← identity + monotonic-revision guard
        │  setData + at most one dispatch  (same tick, C1)
        ▼
decideSatCommitRoute(preState, payload, hint, identity)   → SatRunnerAction
        │
        ▼
satRunnerReducer → route renders new phase
```

Recovery effects (finalization, break-end pull, poll cadence) observe committed
data; they never read state back after an `await`.

Clock data flows down one path: `satTimingPolicy` decides *which* clock governs
(walking the timing model), `domain/satTiming` computes *how much* time is left
on it, and the hook supplies the ticking `now`, the skew and the payload reads.

## Rules for later passes

- A mutation response is a payload like any other: route it through
  `acceptPayloadAndRoute` with a hint. It must not write `dataRef` directly.
- New backend conflict reasons go in `satSubmitConflicts.ts`; new phase
  transitions go in `satCommitRouting.ts` + the reducer.
- Finalization has two drivers (module-submit commit path, recovery effect).
  Both must go through the finalization gate; never add a third `useRef` that
  re-implements the claim.
- Policy that is pure belongs in `application/` with a unit test beside it;
  if a rule needs a React harness to test, it is in the wrong layer.
- Clock and cadence questions go to `satTimingPolicy` / `satPollCadence`, not
  into the hook: a new timing model is a change to `satTimingPolicy` plus its
  test, and nothing else.
- `refresh()` resolves even when the fetch failed (callers include bare
  `void refresh(...)`), so the recovery loop gets its failure signal from
  `refresh`'s transport-outcome callback. Poll failures must be reported there —
  inferring them from the resolution silently disables the backoff.
- `domain/` computes seconds on a clock the caller chose; `application/` picks
  the clock. Do not put model branches in `domain/satTiming.ts`.
