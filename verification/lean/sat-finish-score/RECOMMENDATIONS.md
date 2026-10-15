# Findings and smallest fixes

1. Original finish mismatch: fixed by post-commit satscoring.Overlay in CompleteAssessment. Keep it outside WithTxRetry; commit failures cannot expose the candidate result.
2. Related release/privacy defect found: deliverySubmitAssessmentHandler returned the internal stored result directly, while bootstrap enforced the live score-report switch and stripped the terminal snapshot. Fixed by extracting delivery.StudentSATResult and using it from both response paths. Disabled reports keep their completion receipt; gate query errors fail closed; released responses omit snapshot.
3. No requirement to freeze estimates across future publishes. Scores are read-time estimates; unchanged raw data may legitimately produce different conversions after a publish or policy-read failure. Do not persist the overlay or add a stale per-result conversion cache.
4. No further production-code changes justified by this bounded audit. Deployment owners must validate primary read routing, immutability constraints and version rollout before stronger production claims. Multi-instance crash/failover/load evidence remains outstanding.

5. Expanded cmd/api testing surfaced three unresolved failures outside the finish/projection change (answered-paper burst mismatch, converter fixture operational-count mismatch, and a workbook-import test querying a missing table). See PROOF_REPORT.md and the exact log. Baseline attribution was not established; resolve them separately before claiming a clean repository-wide API test gate.
