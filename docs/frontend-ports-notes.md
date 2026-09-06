# Frontend Ports Notes

New additive modules for the feature ports architecture (plan 74-107).

## Layout (plan 76)

- domain/attempt.ts: V2 snapshot meta, terminal delivery set (14, 79).
- domain/response.ts: full aggregate, visible-version invariant, accept,
  installServer, applyAck, coalesce (17, 79-82).
- domain/conflicts.ts: typed 409 classifier, no collapsing (84, 100).
- domain/state-machine.ts: durable sync states (78, 80).
- application/saveResponse.ts: accept, persist, enqueue, epoch quarantine.
- application/flushResponses.ts: one cmd per question per drain, same
  write-id retry (80, 82).
- application/recoverAttempt.ts: serialized merge, exact write-id clears,
  else EPOCH_STALE, STALE_HYDRATION, TERMINAL_CONFLICT (83).
- application/submitAttempt.ts: single-flight flush then submit, same
  submission id retry, UI only from receipt (85-86).
- application/takeoverAttempt.ts: rotate session, adopt lease, recover (24).
- ports/AttemptGateway.ts, ports/ResponseOutbox.ts, ports/CredentialStore.ts.
- infrastructure/HttpAttemptGateway.ts: REST details only (99).
- infrastructure/IndexedDbResponseOutbox.ts: warwick drafts plus LS (81).
- infrastructure/BrowserCredentialStore.ts: session-scoped memory (106).
- react/AttemptProvider.tsx: thin shell, no fencing logic (77).
- react/hooks.ts: narrow selectors for render stability (104).
- __tests__/invariant.test.ts: 10 characterization gates (79-86, 114).

## Shared

- shared/api-client/client.ts: typed fetch wrapper (99).
- shared/api-client/errors.ts: ApiError with category and requestId (100).
- shared/providers.ts: ExamProviderDefinition union ielts, sat, act with
  ACT defaults 40 questions and one 40-minute Science section (91, 94).

## Gates preserved

Existing StudentAttemptProvider plus v2 tests, DurableResponseEngine, SAT
v1 outbox, builder autosave durability, SAT authoring, ACT Science suites
and Playwright flows stay untouched. New modules converge on the same wire
contract in api/openapi/openapi.yaml.
