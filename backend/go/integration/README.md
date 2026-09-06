# Integration Tests (plan 110-112)

Run against real MySQL and, where supported, TiDB. SQLite is not a substitute.

## Harness

- `docker compose up tidb mysql` (see `backend/docker-compose.yml`).
- `go test -tags integration ./integration/...` with `TEST_MYSQL_DSN` set.
- Every test: migrate up via `cmd/migrate`, run case, migrate down.

## Mandatory scenarios (plan 111)

V2: same write concurrently; same version different write; takeover vs old
writer; pause vs response; submit vs response; submit vs submit.
Terminalization: submit vs terminate; auto-submit vs student submit; repair vs
real seal; same-outcome replay; cross-outcome conflict.
Runtime: extend vs advance; pause vs resume; complete vs student write.
SAT: provisional submit vs terminate; completion vs timeout; watchdog vs direct
completion.

## Migration matrix (plan 112)

Empty DB; shared 0031 state; epic lineage; ACT fork lineage;
hybrid/simulated combined state; production-like snapshot.
