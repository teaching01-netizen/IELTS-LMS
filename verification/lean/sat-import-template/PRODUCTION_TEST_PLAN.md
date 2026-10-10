# Production and Integration Test Plan

## Completed local checks

| Command | Result | Evidence |
| --- | --- | --- |
| lake build SatImportTemplate | PASS, exit 0 | All Lean modules and AxiomAudit built under Lean 4.19.0 |
| lake env lean AxiomAudit.lean | PASS, exit 0 | Exact theorem types printed; all 23 audited theorems reported no axiom dependencies |
| go test ./cmd/api -run 'TestSATWorkbook' -count=1 | PASS, exit 0 | Generated workbook shape, content, text cell kinds, active sheet, completed/blank parser round-trip, hostile rows, image placement, and XML text round-trip |
| go test ./internal/authoring -count=1 | PASS, exit 0 | Existing parser and authoring-package behavior, including workbook import tests |
| bun run test:run -- src/features/exam-authoring/import/__tests__/SatWorkbookImportSheet.test.tsx | PASS, 9 tests | Download hint and import-sheet behavior |

The local commands ran on macOS arm64 with Go 1.26.3, Bun 1.3.14, and Excelize v2.11.0. No production database profile or deployed service was used.

## Remaining release checks

1. Open a newly generated workbook in the supported Excel-compatible desktop application. Verify AI Instructions is selected, B4 is a readable copyable text cell, line breaks and Unicode display correctly, and _SAT stays hidden without changing sheet order.
2. Exercise the actual authenticated and unauthenticated template-download route in the integrated API environment. Confirm the same endpoint, attachment name, content type, private/no-store header, and SAT exam authorization.
3. Run the import UI and authoring-service revision-conflict scenario against the target environment. Confirm stale drafts still conflict and replacement still requires explicit confirmation.
4. For staff content review, compare the Guide/prompt with current parser rules and verify the rendered workbook is understandable at the intended zoom and width.
5. At release, rebuild the proof and test suite against the exact committed source snapshot; record the commit and hashes.

## Not applicable to this change

No synthetic worker interleavings, queue replay, crash schedule, throughput test, or DB load test is planned for the workbook generator. It adds no shared mutable state or database transition. Existing commit concurrency is not newly proved and remains a regression concern for the surrounding authoring flow.
