# Prod Load E2E (Real Exam Day)

This suite targets a real production environment and is intended for a **dedicated E2E tenant / cohort** only.

## Files

- `e2e/prod-data/prod-target.json` (tracked, **no secrets**): baseURL, scheduleId, examId, 100 students, 10 proctors, 1 editor.
- `e2e/prod-data/prod-creds.json` (untracked, **secrets**): editor + 10 proctor passwords.
  - Copy `e2e/prod-data/prod-creds.example.json` to `e2e/prod-data/prod-creds.json` and fill real values.

## Run (manual / controlled window)

1) Update `e2e/prod-data/prod-target.json` with the real `scheduleId` and `examId`.
2) Create `e2e/prod-data/prod-creds.json` locally (it is gitignored).
3) Start shards close together (within ~1 minute).

Example (6 shards):

```bash
E2E_PROD_RUN_ID=examday-2026-04-20 E2E_PROD_SHARD_COUNT=6 E2E_PROD_WORKERS=1 E2E_PROD_SHARD_INDEX=0 npm run e2e:prod-load
E2E_PROD_RUN_ID=examday-2026-04-20 E2E_PROD_SHARD_COUNT=6 E2E_PROD_WORKERS=1 E2E_PROD_SHARD_INDEX=1 npm run e2e:prod-load
E2E_PROD_RUN_ID=examday-2026-04-20 E2E_PROD_SHARD_COUNT=6 E2E_PROD_WORKERS=1 E2E_PROD_SHARD_INDEX=2 npm run e2e:prod-load
E2E_PROD_RUN_ID=examday-2026-04-20 E2E_PROD_SHARD_COUNT=6 E2E_PROD_WORKERS=1 E2E_PROD_SHARD_INDEX=3 npm run e2e:prod-load
E2E_PROD_RUN_ID=examday-2026-04-20 E2E_PROD_SHARD_COUNT=6 E2E_PROD_WORKERS=1 E2E_PROD_SHARD_INDEX=4 npm run e2e:prod-load
E2E_PROD_RUN_ID=examday-2026-04-20 E2E_PROD_SHARD_COUNT=6 E2E_PROD_WORKERS=1 E2E_PROD_SHARD_INDEX=5 npm run e2e:prod-load
```

Notes:
- Shard `0` runs the control plane by default (editor + 10 proctors). Student shards are `1..N-1`.
- To also run students on shard 0, set `E2E_PROD_RUN_STUDENTS_ON_CONTROL_SHARD=true`.

## Optional Bootstrap (create exam + schedule automatically)

If you want a full loop (create exam + publish + create schedule), run shard `0` with:

```bash
E2E_PROD_BOOTSTRAP=true E2E_PROD_ALLOW_BOOTSTRAP=true npm run e2e:prod-load
```

This writes `e2e/.generated/prod-runtime.json` with the new `examId` and `scheduleId`.
Other shards will automatically pick it up (or override via `E2E_PROD_RUNTIME_PATH`).

Important:
- This creates real data in the target DB. Use only in a dedicated E2E tenant.
- Proctor accounts must be assigned to the created schedule if your backend enforces schedule staff assignments for proctors.

## Provision Editor + Proctors via DB (generates unique passwords)

If you want fully automated staff setup (1 editor + 10 proctors) with unique passwords, use the backend helper.

This requires:
- `DATABASE_URL` pointing at the same DB your `baseURL` deployment uses
- explicit consent: `E2E_ALLOW_PROD_DB_MUTATIONS=true`

Example:

```bash
export DATABASE_URL='mysql://...'
export E2E_ALLOW_PROD_DB_MUTATIONS=true

# after bootstrap, read scheduleId from e2e/.generated/prod-runtime.json and provision:
cd backend
cargo run -p ielts-backend-api --bin e2e_provision_staff -- \
  --schedule-id <SCHEDULE_ID> \
  --target ../e2e/prod-data/prod-target.json \
  --output-creds ../e2e/prod-data/prod-creds.json
```

Then run the Playwright shards (they will use `e2e/prod-data/prod-creds.json` for logins).
