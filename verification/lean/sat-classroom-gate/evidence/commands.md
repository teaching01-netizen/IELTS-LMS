# Verification command log

Local validation outputs captured from 2026-10-14 18:16:08 to 18:20:35 UTC (2026-10-15 01:16:08 to 01:20:35 Asia/Bangkok).

| Command | Result | Captured output |
| --- | --- | --- |
| `lake clean && lake build SatClassroomGate` | PASS, exit 0 | `lean-build.txt` |
| `lake env lean proof/AxiomAudit.lean` | PASS, exit 0 | `axiom-audit.txt` |
| `lake env leanchecker` | Unavailable, exit 1; pinned distribution has no `leanchecker` binary | `leanchecker.txt` |
| `go test ./internal/exams ./internal/platform/apperrors ./internal/platform/config` | PASS | `go-unit.txt` |
| `go test -v ./cmd/api -run 'TestSatConfigDefaultsMatchBlueprint\|TestSatRoomsClassroomDisabledRollsBackMySQL' -count=1` | PASS; defaults case passed and MySQL rollback case skipped because `TEST_MYSQL_DSN` is unset | `go-api-gate.txt` |
| `bun run typecheck` | PASS | `frontend-typecheck.txt` |
| `bunx vitest run src/features/exam-authoring/ui/publish/__tests__/SatCreateRoomFlow.test.tsx src/features/exam-authoring/ui/publish/__tests__/SatCreateRoomRecoveryVerification.test.tsx src/products/sat/routes/__tests__/SatExamLibraryRoute.test.tsx` | PASS, 3 files / 38 tests | `frontend-vitest.txt` |
| `git diff --check` | PASS | command output was empty |
| `command -v railway` | Railway CLI unavailable | Production state could not be inspected through the local CLI |

No Railway or production database mutation was performed.
