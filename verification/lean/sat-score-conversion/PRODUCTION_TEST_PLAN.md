# Production test plan

## Executed (MySQL 9.6.0 scratch DB, one host)

| Schedule | Test | Result |
| --- | --- | --- |
| 6 concurrent publishers on one base (barrier) | `TestConcurrentPublishOnSameBaseOneWins` | exactly one winner, 5 `STALE_BASE`; pointer = winner, number 2 |
| same, 30× under `-race` with idempotent/monotonic/restore | `evidence/go-concurrency-soak.txt` | 60/60 |
| lost ACK retry; superseded retry; restore | `TestPublishIdempotentMonotonicAndRestore` | idempotent; 409; number 3, v1 content |
| immutability, append-only audit, singleton pointer | `TestPublishedRevisionIsImmutable…`, `TestMigrationIsRerunnable` | pass |
| corrupted revision | `TestCorruptedRevisionFails…` | `ErrIntegrity`, raw-only, no number |
| retroactive display on both read paths, stored row unchanged | `TestSATGlobalScoreConversionIsRetroactiveMySQL` | pass |
| impact over 1,508 results (2 keyset batches) | `TestImpactReportIsBoundedAndMatchesTheOverlay` | exact counts, bounded output, no writes |
| HTTP contract (412/428/422/409/200, blueprint 25/20) | `TestSATScoreConversionHandlersMySQL` | pass |
| browser: create, paste 26×26, save, validate, publish, history, lookup | manual smoke against the real API | pass |

## Remaining before READY

1. **P-1 multi-instance**: two API processes on one MySQL; barrier-synchronised publishes from both; assert one winner and a linear chain via `SELECT revision_number, base_revision_id …`.
2. **P-2 MySQL 8.4 + production `transaction_isolation`**: re-run the suite and the 30× soak.
3. **P-3 crash points**: kill the API after `UPDATE revisions` and before `COMMIT` (fault-injection hook or `kill -9` under a held lock); assert no published row without a pointer move.
4. **P-4 load**: result-read path with the overlay at production request mix; record p50/p95/p99 (NFR-2 target `+5 ms p95` is *proposed*), pointer-read share of DB time, cache hit rate.
5. **P-5 impact at volume**: run `Impact` on a production-sized copy during peak-like load; record duration and lock waits (45 s timeout).
6. **P-6 invariant query in production** (periodic): published numbers contiguous and unique; `active` = max number; each base = previous number; `content_sha256` verifies.
7. **Observability**: alert on `sat_score_conversion_overlay_total{status="integrity"} > 0`, `…{status="error"}` rate, publish outcomes `stale_base`/`invalid` spikes; gauge `sat_score_conversion_active_revision` unchanged after a failed publish.
