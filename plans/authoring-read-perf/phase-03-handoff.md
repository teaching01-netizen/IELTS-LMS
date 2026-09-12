# Phase 03 to Phase 04 Handoff Note (Main Agent verification)

Gate result: Phase 03 PASSED. Independently verified by the Main Agent.

## Verified evidence

- Shell() cut over to bulkShell: same signature, no provider gate, exact 404 strings.
- Preview() single-build: identity once in snapshot, sat 422 BEFORE cache, bulk loader plus GetChecked.
- Cache: app.go threads shared deliverySvc plus previewCacheOrNil; SetDeliveryService/SetPreviewCache chainable nil-safe.
- OpenShell option (a): clone CAS plus version_created untouched; N=20 concurrency tests pass.
- Equivalence plus Goldens: 17/17 PASS on gated run.
- Statement budget: shell 5, openshell 7, preview 4 cache-off. Payload bytes unchanged (90962/220573).
- cmd/api Authoring/Contract/OpenShell suites: ok.
- gofmt scope files clean except two pre-existing delivery files from other sessions.

## Live counts

Shell 13 to 5 (gate <=8). Preview 22 to 4 cache-off, 1 on hit (gate <=12). OpenShell 15 to 7 (gate <=10).

## Notes for Phase 04

1. useAuthoringShell still POSTs openShell on mount plus every refetch past staleTime 30s — now 7 stmts plus write-Tx FOR UPDATE per refresh even with a draft. Phase 04 switches refreshes to GET getShell (5 stmts, no write Tx) and reserves POST for explicit draft-open.
2. Optimistic mutations patch shell from mutation results; backend shape is byte-identical, so only transport (queryFn) plus an explicit ensure-draft mutation change.
3. Preview cache is server-side per-version-plus-revision with authz in handlers; no frontend change needed.
4. No API or JSON change in Phase 03: getShell/openShell client functions unchanged.
