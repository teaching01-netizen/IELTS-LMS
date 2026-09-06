# Runbook: object storage failure

Signals: media upload/complete errors; `CompleteUpload` checksum or
size rejections spike; asset reads 404/slow; exam content missing
images/audio.

## Triage
1. Separate control plane (DB rows: pending/finalized/orphaned) from
   blob plane (bytes): `GetAsset` failing with row present = blob
   outage; row missing = app/retention issue.
2. Check caps: single object cap 16MB (`MaxUploadBytes`); oversized
   client payloads are rejected by design, not an outage.
3. Check orphan growth: `RunMedia` marks pending>24h orphaned and
   deletes past `delete_after_at`; a stalled cleaner mimics a leak.
4. Exam impact: missing media blocks content render, never answer
   writes — answers still persist via the V2 path.

## Mitigation
- Blob outage: uploads stay `pending`; clients retry `CompleteUpload`
  idempotently (finalized replay is safe). No DB cleanup until the
  blob plane recovers — orphans older than grace delete themselves.
- Do not delete `pending` rows to "reset" uploads; the idempotent
  complete path is the recovery mechanism.
